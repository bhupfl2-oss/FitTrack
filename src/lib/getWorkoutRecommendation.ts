import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface WorkoutRecommendation {
  type: string;
  title: string;
  subtitle: string;
  emoji: string;
  reason: string;
}

interface WorkoutSession {
  id: string;
  date: string;
  template: string;
  [key: string]: any;
}

// ── Hardcoded fallback rotation ────────────────────────────────────────────
function fallback(sessions: WorkoutSession[]): WorkoutRecommendation {
  // Group by date, look at the most recent distinct day
  const byDate = new Map<string, string[]>();
  for (const s of sessions) {
    const existing = byDate.get(s.date) ?? [];
    byDate.set(s.date, [...existing, s.template.toLowerCase()]);
  }
  const lastTemplates = byDate.size > 0 ? [...byDate.values()][0] : [];
  const joined = lastTemplates.join(' ');

  if (joined.includes('push') || joined.includes('chest')) {
    return { type: 'pull', title: 'Pull Day', subtitle: 'Back · Biceps · Forearms', emoji: '🏋️', reason: 'Pull muscles are fresh after push day.' };
  } else if (joined.includes('pull') || joined.includes('back')) {
    return { type: 'legs', title: 'Legs Day', subtitle: 'Quads · Hamstrings · Glutes', emoji: '🦵', reason: 'Lower body ready after upper body session.' };
  } else if (joined.includes('leg')) {
    return { type: 'push', title: 'Push Day', subtitle: 'Chest · Shoulders · Triceps', emoji: '💪', reason: 'Push muscles recovered after leg day.' };
  } else {
    return { type: 'fullbody', title: 'Full Body', subtitle: 'Compound · Functional', emoji: '⚡', reason: 'Full body is a great all-round choice today.' };
  }
}

// ── Main export ─────────────────────────────────────────────────────────────
export async function getWorkoutRecommendation(
  uid: string,
  sessions: WorkoutSession[],
  profile: any,
  bodyStats: any[]
): Promise<WorkoutRecommendation | null> {
  try {
    // ── Check Firestore cache ──────────────────────────────────────────────
    const cacheRef = doc(db, 'users', uid, 'aiInsights', 'daily');
    const cacheSnap = await getDoc(cacheRef);
    if (cacheSnap.exists()) {
      const cached = cacheSnap.data();
      const rec = cached?.workoutRecommendation;
      if (rec?.generatedAt) {
        const ageHrs = (Date.now() - new Date(rec.generatedAt).getTime()) / 3_600_000;
        if (ageHrs < 24 && rec.type && rec.title) {
          return rec as WorkoutRecommendation;
        }
      }
    }

    // ── Build session context (last 10 distinct days) ──────────────────────
    const byDate = new Map<string, string[]>();
    for (const s of sessions) {
      const existing = byDate.get(s.date) ?? [];
      byDate.set(s.date, [...existing, s.template]);
    }
    const sortedDates = [...byDate.keys()].sort().reverse().slice(0, 10);
    const sessionContext = sortedDates
      .map(d => `${d}: ${byDate.get(d)!.join(', ')}`)
      .join('\n');

    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const latestBody = bodyStats[0];
    const bodyLine = latestBody
      ? `Weight: ${latestBody.weightKg ?? '?'}kg, Body fat: ${latestBody.pbf ?? '?'}%, Muscle: ${latestBody.smm ?? '?'}kg`
      : 'No body stats available';

    const userMessage = `Last 10 days of training:
${sessionContext || 'No recent sessions'}

Profile:
Goal: ${profile?.primaryGoal ?? 'not set'}
Fitness focus: ${(profile?.fitnessFocus ?? []).join(', ') || 'not set'}
Activity level: ${profile?.activityLevel ?? 'not set'}

Body stats (latest):
${bodyLine}

Today's date: ${todayStr}
What should I do today?`;

    // ── Claude API call ────────────────────────────────────────────────────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 250,
        system: `You are a personal fitness coach. Analyze the user's workout pattern over the last 10 days — including days where they logged multiple sessions (e.g. strength + cardio on the same day) — and recommend the single best workout for today. Consider muscle recovery, training frequency per muscle group, and the user's goals. Return ONLY a JSON object, no markdown, no preamble:
{ "type": "push|pull|legs|upper|lower|fullbody|running|yoga|stretching|cycling|hiit", "title": "e.g. Pull Day", "subtitle": "e.g. Back · Biceps · Forearms", "emoji": "single emoji", "reason": "one sentence, max 12 words, explaining why this is the right choice today" }`,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    const raw = (data.content?.[0]?.text ?? '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.type || !parsed.title) throw new Error('Invalid response shape');

    const result: WorkoutRecommendation = {
      type: parsed.type,
      title: parsed.title,
      subtitle: parsed.subtitle ?? '',
      emoji: parsed.emoji ?? '💪',
      reason: parsed.reason ?? '',
    };

    // ── Write to Firestore cache ───────────────────────────────────────────
    await setDoc(
      cacheRef,
      { workoutRecommendation: { ...result, generatedAt: new Date().toISOString() } },
      { merge: true }
    );

    return result;
  } catch (e) {
    console.error('getWorkoutRecommendation failed, using fallback:', e);
    return fallback(sessions);
  }
}
