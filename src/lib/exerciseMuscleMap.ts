import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface MuscleResult {
  name: string;
  sets: number;
  category?: string;
  source: 'learned' | 'ai';
}

interface ExerciseMuscleMapDoc {
  exerciseName: string;
  primaryMuscle: string;
  primarySets: number;
  secondaryMuscle: string | null;
  secondarySets: number | null;
  source: 'ai' | 'user_edit';
  updatedAt: unknown;
}

const STANDARD_MUSCLES = 'Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Core, Cardio, Other';

export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function muscleMapDocRef(uid: string, exerciseName: string) {
  return doc(db, 'users', uid, 'exerciseMuscleMap', normalizeExerciseName(exerciseName));
}

async function lookupLearnedMapping(uid: string, exerciseName: string): Promise<ExerciseMuscleMapDoc | null> {
  try {
    const snap = await getDoc(muscleMapDocRef(uid, exerciseName));
    return snap.exists() ? (snap.data() as ExerciseMuscleMapDoc) : null;
  } catch (e) {
    console.error('Failed to look up exerciseMuscleMap entry:', e);
    return null;
  }
}

async function writeLearnedMapping(
  uid: string,
  exerciseName: string,
  primaryMuscle: string,
  primarySets: number,
  secondaryMuscle: string | null,
  secondarySets: number | null,
  source: 'ai' | 'user_edit'
): Promise<void> {
  try {
    await setDoc(muscleMapDocRef(uid, exerciseName), {
      exerciseName,
      primaryMuscle,
      primarySets,
      secondaryMuscle,
      secondarySets,
      source,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('Failed to write exerciseMuscleMap entry:', e);
  }
}

// ── AI muscle classification for unknown exercises only ────────────────────
async function classifyExercisesWithAI(
  exercises: Array<{ name: string; setCount: number }>
): Promise<Map<string, { primaryMuscle: string; primarySets: number; secondaryMuscle: string | null; secondarySets: number | null; category?: string }>> {
  const result = new Map<string, { primaryMuscle: string; primarySets: number; secondaryMuscle: string | null; secondarySets: number | null; category?: string }>();
  if (exercises.length === 0) return result;

  try {
    const exerciseList = exercises.map(e => `${e.name}: ${e.setCount} sets`).join('\n');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Classify each exercise below into a PRIMARY muscle group, and optionally a SECONDARY muscle group if the exercise meaningfully works a second muscle. Use standard names: ${STANDARD_MUSCLES}

Exercises:
${exerciseList}

Rules:
- primarySets and secondarySets are NOT a split of the exercise's total set count — they are NOT required to sum to the total. If an exercise has N sets, primarySets = N. If a secondary muscle applies, secondarySets = N as well — the full count, same as primary, not a fraction of it. Each muscle gets FULL, independent credit for every set. If there's no meaningful secondary muscle, set secondaryMuscle to null and secondarySets to null.
- Example: a push-up exercise with 3 sets, primary Chest and secondary Triceps, should return primarySets: 3, secondarySets: 3 — both equal to the full set count, not split between them.
- If an exercise name is unusual or custom, make your best guess and set category to "Other"
- Be consistent: the same exercise name should always get the same classification

Return ONLY this JSON, no markdown, no other text:
{"exercises":[{"name":"Incline Dumbbell Press","primaryMuscle":"Chest","primarySets":3,"secondaryMuscle":"Shoulders","secondarySets":3,"category":null}]}`,
        }],
      }),
    });

    if (!response.ok) return result;
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text.trim());

    for (const item of parsed.exercises ?? []) {
      result.set(normalizeExerciseName(item.name), {
        primaryMuscle: item.primaryMuscle,
        primarySets: item.primarySets ?? 0,
        secondaryMuscle: item.secondaryMuscle ?? null,
        secondarySets: item.secondarySets ?? null,
        category: item.category ?? undefined,
      });
    }
  } catch (e) {
    console.error('AI muscle classification failed:', e);
  }
  return result;
}

// ── Calorie estimation (unchanged logic, decoupled from muscle classification) ─
export async function estimateCaloriesBurned(
  exerciseList: Array<{ name: string; sets: Array<{ reps: number; weight: number | null }> }>,
  templateName: string,
  durationMins: number
): Promise<number | null> {
  try {
    const exerciseSummary = exerciseList
      .filter(ex => ex.sets.some(s => s.reps > 0))
      .map(ex => {
        const validSets = ex.sets.filter(s => s.reps > 0);
        const avgWeight = validSets.reduce((s, v) => s + (v.weight || 0), 0) / validSets.length;
        return `${ex.name}: ${validSets.length} sets × ~${Math.round(validSets.reduce((s, v) => s + v.reps, 0) / validSets.length)} reps${avgWeight > 0 ? ` @ ${avgWeight.toFixed(1)}kg` : ''}`;
      })
      .join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `You are a fitness calorie estimator. Calculate the actual calories burned for this specific workout.

Template: ${templateName}
Duration: ${Math.round(durationMins)} minutes

Exercises (name: sets × avg_reps @ avg_weight):
${exerciseSummary}

Instructions:
- Calculate calories burned based on the actual exercises, weights, sets, reps, and duration listed above.
- Do NOT return a default or example number — compute from the data.
- Typical strength training: 200–500 kcal/hour depending on intensity and load.
- Heavier compound lifts (squats, deadlifts, bench) burn more than isolation exercises.
- Return a realistic, varied estimate — it will almost never be exactly 320.

Respond with ONLY valid JSON (no markdown, no explanation):
{"caloriesBurned": <your_calculated_integer>}`,
        }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.content?.[0]?.text || '';
    console.log('[estimateCaloriesBurned] raw response:', raw);
    // Extract the number directly — avoids JSON.parse failures when Claude adds reasoning text
    const match = raw.match(/"caloriesBurned"\s*:\s*(\d+)/);
    const calories = match ? parseInt(match[1], 10) : null;
    console.log('[estimateCaloriesBurned] parsed caloriesBurned:', calories);
    return calories;
  } catch (e) {
    console.error('Calorie estimation failed:', e);
    return null;
  }
}

// ── Main entry point: classify all exercises in a session into muscle groups ─
export async function classifyWorkoutMuscles(
  uid: string,
  exerciseList: Array<{ name: string; sets: Array<{ reps: number; weight: number | null }> }>
): Promise<MuscleResult[]> {
  const distinctExercises = new Map<string, { name: string; setCount: number }>();
  for (const ex of exerciseList) {
    const setCount = ex.sets.filter(s => s.reps > 0).length;
    if (setCount === 0) continue;
    const norm = normalizeExerciseName(ex.name);
    const existing = distinctExercises.get(norm);
    if (existing) existing.setCount += setCount;
    else distinctExercises.set(norm, { name: ex.name, setCount });
  }

  const unknown: Array<{ name: string; setCount: number }> = [];
  const learned = new Map<string, ExerciseMuscleMapDoc>();

  await Promise.all(
    [...distinctExercises.entries()].map(async ([norm, ex]) => {
      const mapping = await lookupLearnedMapping(uid, ex.name);
      if (mapping) learned.set(norm, mapping);
      else unknown.push(ex);
    })
  );

  const freshlyClassified = await classifyExercisesWithAI(unknown);

  // Persist freshly-classified mappings for future reuse
  await Promise.all(
    unknown.map(async (ex) => {
      const norm = normalizeExerciseName(ex.name);
      const classification = freshlyClassified.get(norm);
      if (!classification) return;
      await writeLearnedMapping(
        uid,
        ex.name,
        classification.primaryMuscle,
        classification.primarySets,
        classification.secondaryMuscle,
        classification.secondarySets,
        'ai'
      );
    })
  );

  // Combine learned + freshly-classified into a flat muscle -> sets breakdown
  const muscleCounts = new Map<string, { sets: number; category?: string; source: 'learned' | 'ai' }>();

  const addMuscle = (muscle: string, sets: number, category: string | undefined, source: 'learned' | 'ai') => {
    if (!muscle || sets <= 0) return;
    const existing = muscleCounts.get(muscle);
    if (existing) existing.sets += sets;
    else muscleCounts.set(muscle, { sets, category, source });
  };

  for (const mapping of learned.values()) {
    addMuscle(mapping.primaryMuscle, mapping.primarySets, undefined, 'learned');
    if (mapping.secondaryMuscle && mapping.secondarySets) {
      addMuscle(mapping.secondaryMuscle, mapping.secondarySets, undefined, 'learned');
    }
  }

  for (const ex of unknown) {
    const norm = normalizeExerciseName(ex.name);
    const classification = freshlyClassified.get(norm);
    if (!classification) continue;
    addMuscle(classification.primaryMuscle, classification.primarySets, classification.category, 'ai');
    if (classification.secondaryMuscle && classification.secondarySets) {
      addMuscle(classification.secondaryMuscle, classification.secondarySets, classification.category, 'ai');
    }
  }

  return [...muscleCounts.entries()]
    .map(([name, v]) => ({ name, sets: v.sets, category: v.category, source: v.source }))
    .sort((a, b) => b.sets - a.sets);
}

// ── User correction: called by UI in a later prompt ─────────────────────────
export async function saveExerciseMuscleCorrection(
  uid: string,
  exerciseName: string,
  primaryMuscle: string,
  primarySets: number,
  secondaryMuscle: string | null,
  secondarySets: number | null,
  sessionDocId?: string
): Promise<void> {
  try {
    await setDoc(muscleMapDocRef(uid, exerciseName), {
      exerciseName,
      primaryMuscle,
      primarySets,
      secondaryMuscle,
      secondarySets,
      source: 'user_edit',
      updatedAt: serverTimestamp(),
    });
    console.log('Saved exercise muscle correction for', exerciseName);

    if (sessionDocId) {
      const sessionRef = doc(db, 'users', uid, 'workoutSessions', sessionDocId);
      const sessionSnap = await getDoc(sessionRef);
      if (sessionSnap.exists()) {
        const data = sessionSnap.data();
        const existingMuscles: MuscleResult[] = data.aiMuscles ?? [];
        const updatedMuscles = [...existingMuscles];
        const upsert = (name: string, sets: number) => {
          const idx = updatedMuscles.findIndex(m => m.name === name);
          if (idx >= 0) updatedMuscles[idx] = { ...updatedMuscles[idx], sets, source: 'learned' };
          else updatedMuscles.push({ name, sets, source: 'learned' });
        };
        upsert(primaryMuscle, primarySets);
        if (secondaryMuscle && secondarySets) upsert(secondaryMuscle, secondarySets);

        await updateDoc(sessionRef, { aiMuscles: updatedMuscles });
      }
    }
    console.log('Updated current session aiMuscles after correction');
  } catch (e) {
    console.error('Failed to save exercise muscle correction:', e);
    throw e;
  }
}
