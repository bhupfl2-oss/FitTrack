import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { callAI } from '@/lib/callAI';
import {
  getActiveRacePlan, getCurrentWeekEntry, getPlanDayForDate,
  type PlanDay, type RunType,
} from '@/services/racePlanService';
import { getActiveGoalPlan, type FatLossPlanDay, type FatLossSessionType } from '@/services/goalPlansService';

export interface WorkoutRecommendation {
  type: string;
  title: string;
  subtitle: string;
  emoji: string;
  reason: string;
}

export type RecommendationSource = 'gym' | 'running';

export interface TaggedRecommendation extends WorkoutRecommendation {
  source: RecommendationSource;
}

interface WorkoutSession {
  id: string;
  date: string;
  template: string;
  [key: string]: any;
}

// ── Local date helpers ──────────────────────────────────────────────────────
// Never use toISOString() for calendar-day strings — it converts to UTC and
// shifts the date for IST (same lesson documented in AICoach.tsx / racePlanService.ts).
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  return toLocalDateStr(new Date());
}

// Mon=0 .. Sun=6, so a weekly rhythm is anchored consistently regardless of
// JS Date's Sun=0 convention.
function isoWeekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function mondayOfWeek(d: Date): Date {
  const monday = new Date(d);
  monday.setDate(monday.getDate() - isoWeekdayIndex(d));
  return monday;
}

// Evenly spreads `runDays` marks across a 7-day week (Bresenham-style
// distribution) so the same weekday always resolves the same way without
// needing to store an explicit per-day list.
function isEvenSpreadRunDay(runDays: number, weekdayIndex: number): boolean {
  const n = Math.min(Math.max(runDays, 0), 7);
  const prevMark = Math.floor((weekdayIndex * n) / 7);
  const nextMark = Math.floor(((weekdayIndex + 1) * n) / 7);
  return nextMark > prevMark;
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

// ── Gym-side recommendation ─────────────────────────────────────────────────
export async function getWorkoutRecommendation(
  uid: string,
  sessions: WorkoutSession[],
  profile: any,
  bodyStats: any[],
  referenceDate: string = todayStr()
): Promise<WorkoutRecommendation[]> {
  // Future dates get real-today's suggestion (and its cache) — there's no
  // "future" gym history to reason about, unlike the running plan which
  // genuinely projects forward.
  const effectiveDate = referenceDate > todayStr() ? todayStr() : referenceDate;
  const isToday = effectiveDate === todayStr();
  const relevantSessions = sessions.filter(s => s.date <= effectiveDate);

  try {
    // ── Check Firestore cache (today only — a past/future lookup must never
    // read or overwrite the real "today" cached pick) ──────────────────────
    const cacheRef = doc(db, 'users', uid, 'aiInsights', 'daily');
    if (isToday) {
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        const cached = cacheSnap.data();
        const rec = cached?.workoutRecommendation;
        if (rec?.generatedAt) {
          const ageHrs = (Date.now() - new Date(rec.generatedAt).getTime()) / 3_600_000;
          if (ageHrs < 24 && rec.type && rec.title) {
            return [rec as WorkoutRecommendation];
          }
        }
      }
    }

    // ── Build session context (last 10 distinct days on/before effectiveDate) ─
    const byDate = new Map<string, string[]>();
    for (const s of relevantSessions) {
      const existing = byDate.get(s.date) ?? [];
      byDate.set(s.date, [...existing, s.template]);
    }
    const sortedDates = [...byDate.keys()].sort().reverse().slice(0, 10);
    const sessionContext = sortedDates
      .map(d => `${d}: ${byDate.get(d)!.join(', ')}`)
      .join('\n');

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

Date to plan for: ${effectiveDate}${isToday ? ' (today)' : ''}
What should I do on that day?`;

    const systemInstruction = `You are a personal fitness coach. Analyze the user's workout pattern over the last 10 days — including days where they logged multiple sessions (e.g. strength + cardio on the same day) — and recommend the single best workout for today. Consider muscle recovery, training frequency per muscle group, and the user's goals. Return ONLY a JSON object, no markdown, no preamble:
{ "type": "push|pull|legs|upper|lower|fullbody|running|yoga|stretching|cycling|hiit", "title": "e.g. Pull Day", "subtitle": "e.g. Back · Biceps · Forearms", "emoji": "single emoji", "reason": "one sentence, max 12 words, explaining why this is the right choice today" }`;

    // ROLLBACK: previous Anthropic implementation
    // const response = await fetch('https://api.anthropic.com/v1/messages', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
    //     'anthropic-version': '2023-06-01',
    //     'anthropic-dangerous-direct-browser-access': 'true',
    //   },
    //   body: JSON.stringify({
    //     model: 'claude-haiku-4-5',
    //     max_tokens: 250,
    //     system: systemInstruction,
    //     messages: [{ role: 'user', content: userMessage }],
    //   }),
    // });
    // if (!response.ok) throw new Error(`API error ${response.status}`);
    // const data = await response.json();
    // const raw = (data.content?.[0]?.text ?? '').replace(/```json|```/g, '').trim();

    const { text: callResult } = await callAI({
      model: 'gemini-flash-lite-latest',
      systemInstruction,
      contents: userMessage,
      maxTokens: 250,
      thinkingBudget: 0,
    });
    const raw = callResult.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.type || !parsed.title) throw new Error('Invalid response shape');

    const result: WorkoutRecommendation = {
      type: parsed.type,
      title: parsed.title,
      subtitle: parsed.subtitle ?? '',
      emoji: parsed.emoji ?? '💪',
      reason: parsed.reason ?? '',
    };

    // ── Write to Firestore cache (today only) ──────────────────────────────
    if (isToday) {
      await setDoc(
        cacheRef,
        { workoutRecommendation: { ...result, generatedAt: new Date().toISOString() } },
        { merge: true }
      );
    }

    return [result];
  } catch (e) {
    console.error('getWorkoutRecommendation failed, using fallback:', e);
    return [fallback(relevantSessions)];
  }
}

// ── Running-side recommendation ─────────────────────────────────────────────

export const RUN_TYPE_META: Record<RunType, { title: string; emoji: string }> = {
  recovery: { title: 'Recovery Run', emoji: '🏃' },
  tempo: { title: 'Tempo Run', emoji: '⚡' },
  long_run: { title: 'Long Run', emoji: '🏃‍♂️' },
  intervals: { title: 'Intervals', emoji: '🔁' },
  race: { title: 'Race Day', emoji: '🏁' },
  rest: { title: 'Rest Day', emoji: '😴' },
};

function planDayToRecommendation(day: PlanDay): WorkoutRecommendation {
  const meta = RUN_TYPE_META[day.runType];
  const subtitle = [
    day.targetDistanceKm != null ? `${day.targetDistanceKm}km` : null,
    day.targetPaceMinPerKm != null ? `${day.targetPaceMinPerKm.toFixed(2)} min/km` : null,
  ].filter(Boolean).join(' · ');

  return {
    type: day.runType,
    title: meta.title,
    subtitle,
    emoji: meta.emoji,
    reason: day.note || '',
  };
}

// ── Fat-loss structured-plan day → recommendation ───────────────────────────

const FAT_LOSS_SESSION_META: Record<FatLossSessionType, { title: string; emoji: string }> = {
  cardio: { title: 'Cardio', emoji: '🏃' },
  strength: { title: 'Strength', emoji: '🏋️' },
  rest: { title: 'Rest Day', emoji: '😴' },
};

function fatLossDayToRecommendation(day: FatLossPlanDay): WorkoutRecommendation {
  const meta = FAT_LOSS_SESSION_META[day.sessionType];
  return {
    type: day.sessionType,
    title: meta.title,
    subtitle: `${day.targetCalories} kcal target`,
    emoji: meta.emoji,
    reason: day.note || '',
  };
}

// Gym-side week strip (RUN_TYPE_META/Workouts.tsx) has no "strength" concept —
// RunType is purely running-oriented. This mirrors buildRhythmWeek's existing
// convention below (a gym/strength day already renders as runType: 'rest' in
// that view today), so a structured strength day doesn't regress to something
// worse than what rhythm-based goal plans already show.
const FAT_LOSS_TO_RUN_TYPE: Record<FatLossSessionType, RunType> = {
  cardio: 'recovery',
  strength: 'rest',
  rest: 'rest',
};

function fatLossDayToPlanDay(day: FatLossPlanDay): PlanDay {
  return {
    date: day.date,
    runType: FAT_LOSS_TO_RUN_TYPE[day.sessionType],
    targetDistanceKm: null,
    targetPaceMinPerKm: null,
    note: day.note,
  };
}

function rhythmToRecommendation(runDays: number, today: Date): WorkoutRecommendation {
  const isRunDay = isEvenSpreadRunDay(runDays, isoWeekdayIndex(today));
  if (isRunDay) {
    return {
      type: 'running',
      title: 'Run',
      subtitle: '',
      emoji: '🏃',
      reason: `Part of your ${runDays}-day weekly running rhythm.`,
    };
  }
  return {
    type: 'rest',
    title: 'Rest Day',
    subtitle: '',
    emoji: '😴',
    reason: 'Not a scheduled run day this week.',
  };
}

export async function getRunningRecommendationForDate(
  uid: string,
  date: string = todayStr()
): Promise<WorkoutRecommendation | null> {
  const racePlan = await getActiveRacePlan(uid);
  if (racePlan) {
    const day = getPlanDayForDate(racePlan, date);
    return day ? planDayToRecommendation(day) : null;
  }

  const goalPlan = await getActiveGoalPlan(uid);

  if (goalPlan?.type === 'performance_target' && goalPlan.hasStructuredPlan && goalPlan.weeklyPlan) {
    const structuredDay = goalPlan.weeklyPlan.find(d => d.date === date);
    if (structuredDay) return fatLossDayToRecommendation(structuredDay);
    // No entry for this date (e.g. outside startDate–targetDate) — fall
    // through to the rhythm-based computation below, exactly as today.
  }

  if (
    goalPlan &&
    (goalPlan.type === 'performance_target' || goalPlan.type === 'existing_routine') &&
    goalPlan.daySplit
  ) {
    return rhythmToRecommendation(goalPlan.daySplit.runDays, new Date(date + 'T00:00:00'));
  }

  return null;
}

// ── Combined "today" resolver ───────────────────────────────────────────────
export async function getTodayRecommendations(
  uid: string,
  sessions: WorkoutSession[],
  profile: any,
  bodyStats: any[]
): Promise<TaggedRecommendation[]> {
  const [gymRecs, runningRec] = await Promise.all([
    getWorkoutRecommendation(uid, sessions, profile, bodyStats),
    getRunningRecommendationForDate(uid),
  ]);

  const result: TaggedRecommendation[] = gymRecs.map(r => ({ ...r, source: 'gym' as const }));
  if (runningRec) result.push({ ...runningRec, source: 'running' as const });

  return result.slice(0, 2);
}

// ── Logged-session lookup ────────────────────────────────────────────────────

async function getSessionsOnDate(uid: string, date: string): Promise<WorkoutSession[]> {
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'workoutSessions'), where('date', '==', date))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession));
}

// ── Date-aware "Today's Pick" orchestrator ───────────────────────────────────

export interface DayPick {
  gym: { status: 'completed'; sessions: WorkoutSession[] } | { status: 'suggested'; recommendation: WorkoutRecommendation };
  run: { status: 'completed'; sessions: WorkoutSession[] } | { status: 'suggested'; recommendation: WorkoutRecommendation | null };
}

export async function getDayPick(
  uid: string,
  date: string,
  sessions: WorkoutSession[],
  profile: any,
  bodyStats: any[]
): Promise<DayPick> {
  const logged = await getSessionsOnDate(uid, date);
  const gymLogged = logged.filter(s => s.type !== 'running');
  const runLogged = logged.filter(s => s.type === 'running');

  const gym: DayPick['gym'] = gymLogged.length > 0
    ? { status: 'completed', sessions: gymLogged }
    : { status: 'suggested', recommendation: (await getWorkoutRecommendation(uid, sessions, profile, bodyStats, date))[0] };

  const run: DayPick['run'] = runLogged.length > 0
    ? { status: 'completed', sessions: runLogged }
    : { status: 'suggested', recommendation: await getRunningRecommendationForDate(uid, date) };

  return { gym, run };
}

// ── Week-ahead read helper ──────────────────────────────────────────────────

function buildRhythmWeek(runDays: number, weekOffset: number): PlanDay[] {
  const monday = mondayOfWeek(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);

  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const isRunDay = isEvenSpreadRunDay(runDays, i);
    days.push({
      date: toLocalDateStr(d),
      runType: isRunDay ? 'recovery' : 'rest',
      targetDistanceKm: null,
      targetPaceMinPerKm: null,
      note: isRunDay ? 'Scheduled run (per weekly rhythm)' : '',
    });
  }
  return days;
}

export async function getWeekSchedule(uid: string, weekOffset: number): Promise<PlanDay[] | null> {
  const racePlan = await getActiveRacePlan(uid);
  if (racePlan) {
    const currentWeek = getCurrentWeekEntry(racePlan);
    const currentWeekNumber = currentWeek?.weekNumber ?? 1;
    const targetWeekNumber = currentWeekNumber + weekOffset;
    const entry = racePlan.weeklyPlan.find(w => w.weekNumber === targetWeekNumber);
    return entry ? entry.days : null;
  }

  const goalPlan = await getActiveGoalPlan(uid);
  if (
    goalPlan &&
    (goalPlan.type === 'performance_target' || goalPlan.type === 'existing_routine') &&
    goalPlan.daySplit
  ) {
    const rhythmWeek = buildRhythmWeek(goalPlan.daySplit.runDays, weekOffset);

    if (goalPlan.type === 'performance_target' && goalPlan.hasStructuredPlan && goalPlan.weeklyPlan) {
      // Overlay per-date: any day the structured plan doesn't cover (outside
      // startDate–targetDate) keeps its rhythm-computed fallback, exactly as
      // today — this is never all-or-nothing across the week.
      const structuredByDate = new Map(goalPlan.weeklyPlan.map(d => [d.date, d]));
      return rhythmWeek.map(day => {
        const structured = structuredByDate.get(day.date);
        return structured ? fatLossDayToPlanDay(structured) : day;
      });
    }

    return rhythmWeek;
  }

  return null;
}
