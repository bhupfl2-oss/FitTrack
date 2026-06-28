import { useState, useEffect } from 'react';
import {
  doc, getDoc, setDoc, onSnapshot,
  collection, query, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ── Types ──────────────────────────────────────────────────────────────────

export interface UserGoals {
  calorieGoal?: number;
  proteinGoal?: number;
  carbGoal?: number;
  fatGoal?: number;
  stepsGoal?: number;
  caloriesBurnGoal?: number;
  sleepGoal?: number;   // hours
  waterGoal?: number;   // litres
  updatedAt?: string;
  updatedBy?: 'ai_coach' | 'ai_coach_recommendation' | 'ai_body_stats' | 'manual' | 'profile_change';
  aiSummary?: string;
}

export const DEFAULT_GOALS: Required<Pick<UserGoals,
  'calorieGoal' | 'proteinGoal' | 'carbGoal' | 'fatGoal' |
  'stepsGoal' | 'caloriesBurnGoal' | 'sleepGoal' | 'waterGoal'
>> = {
  calorieGoal: 2000,
  proteinGoal: 120,
  carbGoal: 220,
  fatGoal: 65,
  stepsGoal: 8000,
  caloriesBurnGoal: 400,
  sleepGoal: 7.5,
  waterGoal: 2.5,
};

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getGoals(uid: string): Promise<UserGoals> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'goals', 'current'));
    if (snap.exists()) return snap.data() as UserGoals;
    return { ...DEFAULT_GOALS };
  } catch {
    return { ...DEFAULT_GOALS };
  }
}

export async function saveGoals(
  uid: string,
  partial: Partial<UserGoals>,
  source: string
): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'goals', 'current'),
    { ...partial, updatedAt: new Date().toISOString(), updatedBy: source as UserGoals['updatedBy'] },
    { merge: true }
  );
}

// ── React hook ─────────────────────────────────────────────────────────────

export function useGoals(uid: string | undefined): {
  goals: UserGoals;
  loading: boolean;
  refetch: () => void;
} {
  const [goals, setGoals] = useState<UserGoals>({ ...DEFAULT_GOALS });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, 'users', uid, 'goals', 'current'),
      snap => {
        setGoals(snap.exists() ? (snap.data() as UserGoals) : { ...DEFAULT_GOALS });
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsubscribe;
  }, [uid]);

  // refetch is a no-op now that goals stay live via onSnapshot; kept for API compatibility.
  return { goals, loading, refetch: () => {} };
}

// ── AI full-context calculation ────────────────────────────────────────────

export async function calculateGoalsWithAI(
  uid: string,
  context: { trigger: 'body_stats_saved' | 'ai_coach_conversation' | 'manual_refresh' }
): Promise<UserGoals> {
  try {
    // ── Step 1: fetch all context in parallel ───────────────────────────
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const [profileSnap, bodyStatsSnap, workoutSnap, labsSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid, 'profile', 'data')),
      getDocs(query(
        collection(db, 'users', uid, 'bodyComp'),
        orderBy('date', 'desc'),
        limit(20)
      )),
      getDocs(query(
        collection(db, 'users', uid, 'workoutSessions'),
        orderBy('date', 'desc'),
        limit(10)
      )),
      getDocs(query(
        collection(db, 'users', uid, 'labs'),
        orderBy('date', 'desc'),
        limit(20)
      )),
    ]);

    const profile = profileSnap.exists() ? profileSnap.data() as any : {};

    // ── Step 2: filter body stats to last 3 months ──────────────────────
    const bodyStats = bodyStatsSnap.docs
      .map(d => d.data() as any)
      .filter(d => d.date && new Date(d.date) >= threeMonthsAgo);

    // ── Step 3: build context strings ───────────────────────────────────

    // Age from DOB
    let age: number | null = null;
    if (profile.dob) {
      const birth = new Date(profile.dob);
      const now = new Date();
      age = now.getFullYear() - birth.getFullYear();
      if (now.getMonth() < birth.getMonth() ||
        (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    }

    const profileParts: string[] = [];
    if (age != null)              profileParts.push(`age ${age}`);
    if (profile.heightCm)         profileParts.push(`height ${profile.heightCm}cm`);
    if (profile.gender)           profileParts.push(`gender ${profile.gender}`);
    if (profile.activityLevel)    profileParts.push(`activity level ${profile.activityLevel}`);
    if (profile.foodPreference)   profileParts.push(`diet preference ${profile.foodPreference}`);
    if (profile.primaryGoal)      profileParts.push(`health goal ${profile.primaryGoal}`);
    const profileStr = profileParts.join(', ') || 'not provided';

    // Body composition trend (newest first)
    const bodyStr = bodyStats.length > 0
      ? bodyStats.map(s => {
          const parts = [s.date];
          if (s.weightKg != null) parts.push(`${s.weightKg}kg`);
          if (s.pbf != null) parts.push(`${s.pbf}% fat`);
          if (s.smm != null) parts.push(`SMM ${s.smm}kg`);
          if (s.visceralFat != null) parts.push(`visceral ${s.visceralFat}`);
          if (s.metabolicAge != null) parts.push(`met.age ${s.metabolicAge}`);
          return parts.join(', ');
        }).join('\n')
      : 'no recent data';

    // Workouts
    const workouts = workoutSnap.docs.map(d => d.data() as any);
    const workoutStr = workouts.length > 0
      ? workouts.map(s => {
          const parts = [s.date, s.template];
          if (s.durationMins) parts.push(`${Math.round(s.durationMins)}min`);
          if (s.caloriesBurned) parts.push(`${s.caloriesBurned}kcal`);
          if (s.type === 'running' && s.distanceKm) parts.push(`${s.distanceKm}km`);
          return parts.filter(Boolean).join(', ');
        }).join('\n')
      : 'no recent sessions';

    // avg sessions/week and dominant type
    const runCount = workouts.filter(s => s.type === 'running' || (s.template || '').toLowerCase().includes('run')).length;
    const liftCount = workouts.length - runCount;
    const weeksSpanned = workouts.length > 0 ? 2 : 1; // assume 2 weeks for last 10
    const avgPerWeek = (workouts.length / weeksSpanned).toFixed(1);
    const dominantType = runCount > liftCount ? 'running' : liftCount > runCount ? 'strength' : 'mixed';

    // Labs — group by test name, latest value per test
    const labsByTest = new Map<string, { value: number; date: string; unit: string }>();
    labsSnap.docs.forEach(d => {
      const labDoc = d.data() as any;
      const date = labDoc.date || '';
      (labDoc.results || []).forEach((r: any) => {
        if (!r.testName || r.value == null) return;
        const existing = labsByTest.get(r.testName);
        if (!existing || date > existing.date) {
          labsByTest.set(r.testName, { value: r.value, date, unit: r.unit || '' });
        }
      });
    });
    const labStr = labsByTest.size > 0
      ? [...labsByTest.entries()]
          .map(([name, { value, date, unit }]) => {
            const d = new Date(date);
            const dateLabel = isNaN(d.getTime()) ? date : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return `${name}: ${value}${unit} (${dateLabel})`;
          })
          .join(', ')
      : 'no lab data';

    // ── Step 4: call Claude API ─────────────────────────────────────────
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
        system: `You are a precision health coach with access to the user's complete health picture. Calculate ALL their optimal daily goals based on body composition trends, workout history, lab results, and profile.
Consider:
- Protein: based on lean mass and training frequency
- Calories: TDEE adjusted for actual workout output and body comp trend
- Steps and calorie burn: based on current activity pattern
- Sleep: adjusted if metabolic age or labs suggest recovery issues (e.g. low testosterone, high HbA1c, low Vitamin D)
- Water: based on weight, activity level, and training volume (return in litres)
- Carbs and fat: based on diet preference and energy needs
- If lab results indicate deficiencies or risks, factor into goals
Return ONLY valid JSON, no markdown, no explanation:
{"calorieGoal":number,"proteinGoal":number,"carbGoal":number,"fatGoal":number,"stepsGoal":number,"caloriesBurnGoal":number,"sleepGoal":number,"waterGoal":number,"aiSummary":"max 25 words, mention key data points used"}`,
        messages: [{
          role: 'user',
          content: `PROFILE:
${profileStr}

BODY COMPOSITION TREND (last 3 months, newest first):
${bodyStr}

RECENT WORKOUTS (last 10 sessions):
${workoutStr}
Average: ${avgPerWeek} sessions/week, dominant type: ${dominantType}

LAB RESULTS (latest per test):
${labStr}

Calculate my optimal daily health goals.`,
        }],
      }),
    });

    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    const raw = data.content?.[0]?.text ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    const result = JSON.parse(jsonMatch[0]) as UserGoals;

    if (!result.calorieGoal || !result.proteinGoal) throw new Error('Invalid response shape');

    // ── Step 5: save and return ─────────────────────────────────────────
    await saveGoals(uid, result, context.trigger);
    console.log('[Goals] AI calculated with full context:', result);
    return result;

  } catch (e) {
    console.warn('[Goals] AI calculation failed, using existing goals:', e);
    return await getGoals(uid);
  }
}
