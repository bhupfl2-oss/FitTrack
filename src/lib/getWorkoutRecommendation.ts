import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { callAI } from '@/lib/callAI';
import {
  getActiveRacePlan, getCurrentWeekEntry, getPlanDayForDate, getGymSplitForDate,
  type PlanDay, type RunType, type RacePlan,
} from '@/services/racePlanService';
import { getActiveGoalPlan, type FatLossPlanDay, type FatLossSessionType, type GoalPlan } from '@/services/goalPlansService';

export interface WorkoutRecommendation {
  type: string;
  title: string;
  subtitle: string;
  emoji: string;
  reason: string;
  // Only ever set to false by plan-derived gym-split tiles whose label didn't
  // resolve to a real workout template — every AI-suggested tile leaves this
  // undefined, which renders identically to true (see Workouts.tsx Start-button gate).
  startable?: boolean;
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
    byDate.set(s.date, [...existing, (s.template ?? '').toLowerCase()]);
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
      model: 'gemini-3.1-flash-lite', // Pinned 2026-07-23, see functions/src/index.ts for pin policy
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

// Pure variant — takes already-fetched plan objects instead of reading them,
// so a caller that already has activeRacePlan/activeGoalPlan in state (e.g.
// Workouts.tsx) can reuse this without a redundant Firestore round-trip.
export function getRunningRecommendationForDateFromPlans(
  racePlan: RacePlan | null,
  goalPlan: GoalPlan | null,
  date: string
): WorkoutRecommendation | null {
  if (racePlan) {
    const day = getPlanDayForDate(racePlan, date);
    return day ? planDayToRecommendation(day) : null;
  }

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

export async function getRunningRecommendationForDate(
  uid: string,
  date: string = todayStr()
): Promise<WorkoutRecommendation | null> {
  // Sequential, not Promise.all — a goal plan is never read once a race plan
  // is found, matching the original inline implementation exactly.
  const racePlan = await getActiveRacePlan(uid);
  if (racePlan) return getRunningRecommendationForDateFromPlans(racePlan, null, date);
  const goalPlan = await getActiveGoalPlan(uid);
  return getRunningRecommendationForDateFromPlans(null, goalPlan, date);
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

// ── Plan-covered "today" resolver (no AI call) ──────────────────────────────
// Mirrors the keyword rules Workouts.tsx's detectWorkoutTemplate uses so a
// free-typed gymSplitPattern label (e.g. "Push", "Push Day") maps onto the
// same fixed set of startable workout-session templates.
export function normalizeGymSplitLabel(label: string): 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'fullbody' | null {
  const lower = label.toLowerCase();
  if (lower.includes('push') || lower.includes('chest') || lower.includes('tricep') || lower.includes('shoulder')) return 'push';
  if (lower.includes('pull') || lower.includes('back') || lower.includes('bicep') || lower.includes('lat')) return 'pull';
  if (lower.includes('leg') || lower.includes('squat') || lower.includes('quad') || lower.includes('hamstring') || lower.includes('glute')) return 'legs';
  if (lower.includes('upper')) return 'upper';
  if (lower.includes('lower')) return 'lower';
  if (lower.includes('full body') || lower.includes('fullbody')) return 'fullbody';
  return null;
}

// Ordinal rest-day-counting gym-split lookup for a generic PlanDay[] — shared
// by the week strip (Workouts.tsx) and getPlanCoveredPick below, so the two
// views can never disagree about which gym-split label lands on which date.
export function resolveGymSplitLabel(days: PlanDay[], gymSplitPattern: string[] | null, date: string): string | null {
  if (!gymSplitPattern || gymSplitPattern.length === 0) return null;
  const day = days.find(d => d.date === date);
  if (!day || day.runType !== 'rest') return null;
  const ordinal = days.filter(d => d.runType === 'rest').findIndex(d => d.date === date);
  return gymSplitPattern[ordinal % gymSplitPattern.length];
}

// Pure "is today covered by an active plan" resolver — returns null when
// neither plan applies to `date` (caller should fall back to the AI-driven
// getTodayRecommendations), or 1-2 tiles derived entirely from already-fetched
// plan data otherwise. Race plan takes precedence over goal plan whenever
// present, matching getRunningRecommendationForDateFromPlans/the status strip
// convention elsewhere in Workouts.tsx.
export function getPlanCoveredPick(
  racePlan: RacePlan | null,
  goalPlan: GoalPlan | null,
  date: string
): TaggedRecommendation[] | null {
  const base = getRunningRecommendationForDateFromPlans(racePlan, goalPlan, date);
  if (!base) return null;

  // A structured fat-loss "strength" day is deliberately treated the same as
  // a "rest" day here — fatLossDayToPlanDay already overlays gymSplitPattern
  // onto both for the week strip (see that function's comment), so Today's
  // Pick must resolve a gym-split label the same way to avoid disagreeing
  // with the week strip on the same date.
  if (base.type === 'rest' || base.type === 'strength') {
    let gymSplitLabel: string | null = null;
    if (racePlan) {
      gymSplitLabel = getGymSplitForDate(racePlan, date);
    } else if (goalPlan) {
      const weekSchedule = buildGoalPlanWeekSchedule(goalPlan, 0);
      if (weekSchedule) gymSplitLabel = resolveGymSplitLabel(weekSchedule.days, weekSchedule.gymSplitPattern, date);
    }

    // A day with an assigned gym split is a gym day, not a rest day — the
    // gym-split tile REPLACES the rest/strength tile rather than sitting
    // alongside it (matches the week strip, which already shows the gym-split
    // label *instead of* the rest emoji for the same date, never both).
    if (gymSplitLabel) {
      const normalized = normalizeGymSplitLabel(gymSplitLabel);
      return [{
        type: normalized ?? gymSplitLabel,
        title: `${gymSplitLabel} Day`,
        subtitle: base.subtitle,
        emoji: '💪',
        reason: base.reason,
        source: 'gym',
        startable: normalized != null,
      }];
    }
  }

  return [{ ...base, source: 'running' }];
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

export interface WeekSchedule {
  days: PlanDay[];
  gymSplitPattern: string[] | null;
}

// Pure variant of getWeekSchedule's goal-plan branch — takes an already-fetched
// GoalPlan so a caller with plan state in hand (Workouts.tsx) can build "this
// week" (weekOffset 0) without a redundant Firestore read.
function buildGoalPlanWeekSchedule(goalPlan: GoalPlan, weekOffset: number): WeekSchedule | null {
  if (
    !((goalPlan.type === 'performance_target' || goalPlan.type === 'existing_routine') && goalPlan.daySplit)
  ) {
    return null;
  }

  const rhythmWeek = buildRhythmWeek(goalPlan.daySplit.runDays, weekOffset);

  if (goalPlan.type === 'performance_target' && goalPlan.hasStructuredPlan && goalPlan.weeklyPlan) {
    // Overlay per-date: any day the structured plan doesn't cover (outside
    // startDate–targetDate) keeps its rhythm-computed fallback, exactly as
    // today — this is never all-or-nothing across the week.
    const structuredByDate = new Map(goalPlan.weeklyPlan.map(d => [d.date, d]));
    const days = rhythmWeek.map(day => {
      const structured = structuredByDate.get(day.date);
      return structured ? fatLossDayToPlanDay(structured) : day;
    });
    return { days, gymSplitPattern: goalPlan.gymSplitPattern };
  }

  return { days: rhythmWeek, gymSplitPattern: goalPlan.gymSplitPattern };
}

export async function getWeekSchedule(uid: string, weekOffset: number): Promise<WeekSchedule | null> {
  const racePlan = await getActiveRacePlan(uid);
  if (racePlan) {
    const currentWeek = getCurrentWeekEntry(racePlan);
    const currentWeekNumber = currentWeek?.weekNumber ?? 1;
    const targetWeekNumber = currentWeekNumber + weekOffset;
    const entry = racePlan.weeklyPlan.find(w => w.weekNumber === targetWeekNumber);
    return entry ? { days: entry.days, gymSplitPattern: racePlan.gymSplitPattern } : null;
  }

  const goalPlan = await getActiveGoalPlan(uid);
  if (goalPlan) {
    const schedule = buildGoalPlanWeekSchedule(goalPlan, weekOffset);
    if (schedule) return schedule;
  }

  return null;
}
