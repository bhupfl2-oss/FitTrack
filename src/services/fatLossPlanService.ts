import {
  doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  collection, query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { callAI } from '@/lib/callAI';
import { saveGoals, getGoals } from '@/services/goalsService';
import type {
  GoalPlan, GoalPlanType, GoalPlanStatus, FatLossPlanDay, FatLossSessionType,
} from '@/services/goalPlansService';
import { resolveGymSplitLabel } from '@/lib/getWorkoutRecommendation';
import type { PlanDay, RunType } from '@/services/racePlanService';
import { computeTDEE, MIN_CALORIE_GOAL } from '@/lib/calculateNutritionGoals';

// ── Local date helpers ───────────────────────────────────────────────────
// Never use toISOString() for calendar-day strings — it converts to UTC and
// shifts the date for IST (same lesson documented in racePlanService.ts /
// AICoach.tsx). racePlanService.ts's date helpers are module-private and not
// exported, so they're duplicated here rather than imported.
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  return toLocalDateStr(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalDateStr(dt);
}

// Mon=0..Sun=6 — same convention as getWorkoutRecommendation.ts's
// isoWeekdayIndex, duplicated here as a date-string variant since that one
// takes a Date and is private to that module.
function isoWeekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// Sun=0..Sat=6 — the indexing convention for a phase's weekSessionPattern
// (distinct from isoWeekdayIndex above, which is Monday-anchored and used
// only for gym-split week grouping). Native Date.getDay() already returns
// Sun=0..Sat=6, so this just gives it a name at the call site.
function dayOfWeekSunFirst(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ~4 months — the midpoint of the locked 3–6 month range. This is a
// placeholder heuristic; real AI-driven target-date reasoning (e.g. based on
// how much fat loss the user's target implies) belongs in the goal-intake
// prompt in a follow-up, not this generation layer.
const TARGET_DAYS_OUT = 122;

// ── Types ──────────────────────────────────────────────────────────────────

export interface FatLossPlanScalarFields {
  metric?: string;
  targetValue?: number;
  daySplit?: { runDays: number; gymDays: number } | null;
  gymSplitPattern?: string[] | null;
  // Persist-only — generateFatLossPlan ignores this; persistFatLossPlan uses it.
  regenerationsUsed?: number;
}

export type GenerateFatLossPlanInput = FatLossPlanScalarFields;

// Mirrors FAT_LOSS_TO_RUN_TYPE in getWorkoutRecommendation.ts (private to
// that module) — only the "does this count as a rest/gym slot" classification
// matters here, not that module's full recommendation pipeline.
const FAT_LOSS_SESSION_TO_RUN_TYPE: Record<FatLossSessionType, RunType> = {
  cardio: 'recovery',
  strength: 'rest',
  rest: 'rest',
};

// ── Phase-rules AI output shape ─────────────────────────────────────────────
// The AI authors 3 of these (one per phase), not one entry per calendar day —
// the full FatLossPlanDay[] gets expanded from these rules mathematically,
// see Step 5 below.
interface FatLossPhase {
  phaseIndex: number;
  weekSessionPattern: FatLossSessionType[]; // length 7, index 0=Sun..6=Sat
  baseCalories: number;                     // week-1-of-phase calorie target
  caloriesDeltaPercentPerWeek: number;      // e.g. -2 meaning -2%/week, compounding
  noteVariants: Record<FatLossSessionType, string[]>; // 2-3 short notes each, cycled by week number
}

const PHASE_COUNT = 3;

// Even-as-possible day ranges for PHASE_COUNT phases across `totalDays` —
// e.g. 123 days -> [0, 41, 82, 123] (three 41-day phases). Any remainder
// days go to the earlier phases so no phase is ever empty.
function computePhaseBoundaries(totalDays: number): number[] {
  const baseSize = Math.floor(totalDays / PHASE_COUNT);
  const remainder = totalDays % PHASE_COUNT;
  const boundaries = [0];
  for (let i = 0; i < PHASE_COUNT; i++) {
    boundaries.push(boundaries[boundaries.length - 1] + baseSize + (i < remainder ? 1 : 0));
  }
  return boundaries;
}

function phaseIndexForDay(dayIndex: number, boundaries: number[]): number {
  for (let p = 0; p < PHASE_COUNT; p++) {
    if (dayIndex < boundaries[p + 1]) return p;
  }
  return PHASE_COUNT - 1;
}

export interface GeneratedFatLossPlan {
  startDate: string;  // YYYY-MM-DD, local
  targetDate: string; // YYYY-MM-DD, local
  weeklyPlan: FatLossPlanDay[];
  aiSummary: string;
}

// ── Pure generation (no writes) ─────────────────────────────────────────────

// Calls the AI exactly once per invocation. The AI's fill is not guaranteed
// deterministic, so the caller must treat the returned object as the single
// source of truth for what gets shown to the user AND what gets persisted —
// never call this twice expecting the same plan back.
export async function generateFatLossPlan(
  uid: string,
  input: GenerateFatLossPlanInput,
  feedback?: string
): Promise<GeneratedFatLossPlan> {
  const startDate = todayStr();
  const targetDate = addDays(startDate, TARGET_DAYS_OUT);

  // ── Step 1: fetch context in parallel-ish (read-only) ───────────────────
  const profileSnap = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  const profile = profileSnap.exists() ? profileSnap.data() as any : {};

  const currentGoals = await getGoals(uid);

  let bodyStats: any[] = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'bodyComp'),
      orderBy('date', 'desc'),
      limit(5)
    ));
    bodyStats = snap.docs.map(d => d.data());
  } catch (e) {
    console.warn('[FatLossPlan] Failed to fetch body comp history:', e);
  }

  let recentSessions: any[] = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workoutSessions'),
      orderBy('date', 'desc'),
      limit(10)
    ));
    recentSessions = snap.docs.map(d => d.data());
  } catch (e) {
    console.warn('[FatLossPlan] Failed to fetch recent sessions:', e);
  }

  // ── Step 2: build context strings ───────────────────────────────────────
  const profileParts = [
    profile.gender && `gender ${profile.gender}`,
    profile.heightCm && `height ${profile.heightCm}cm`,
    profile.activityLevel && `activity level ${profile.activityLevel}`,
    profile.foodPreference && `diet preference ${profile.foodPreference}`,
    profile.primaryGoal && `primary goal ${profile.primaryGoal}`,
  ].filter(Boolean);
  const profileStr = profileParts.join(', ') || 'not provided';

  const bodyStr = bodyStats.length > 0
    ? bodyStats.map((s: any) => {
        const parts = [s.date];
        if (s.weightKg != null) parts.push(`${s.weightKg}kg`);
        if (s.pbf != null) parts.push(`${s.pbf}% fat`);
        if (s.smm != null) parts.push(`SMM ${s.smm}kg`);
        return parts.join(', ');
      }).join('\n')
    : 'no recent body comp data';

  const sessionsStr = recentSessions.length > 0
    ? recentSessions.map((s: any) => {
        const parts = [s.date, s.template];
        if (s.type) parts.push(s.type);
        if (s.durationMins) parts.push(`${Math.round(s.durationMins)}min`);
        return parts.filter(Boolean).join(', ');
      }).join('\n')
    : 'no recent sessions';

  const splitStr = input.daySplit
    ? `${input.daySplit.runDays} cardio-leaning day(s) and ${input.daySplit.gymDays} strength-leaning day(s) per week (reusing the existing run/gym day-split field for cardio/strength balance)`
    : 'no preference stated — use a balanced default';

  const targetStr = input.metric && input.targetValue != null
    ? `${input.metric} → ${input.targetValue}`
    : 'no specific metric target stated — general fat loss';

  // ── Step 3: pre-compute the date skeleton ───────────────────────────────
  // Dates are computed deterministically here (not by the AI) — same
  // defensive pattern racePlanService.ts's generateRacePlan uses. The AI
  // only fills in sessionType/targetCalories/note per dayIndex, which we
  // merge onto this skeleton below.
  const skeleton: { dayIndex: number; date: string }[] = [];
  {
    let cursor = startDate;
    let dayIndex = 0;
    while (cursor <= targetDate) {
      skeleton.push({ dayIndex, date: cursor });
      dayIndex++;
      cursor = addDays(startDate, dayIndex);
    }
  }

  const phaseBoundaries = computePhaseBoundaries(skeleton.length);
  const phaseSizes = Array.from({ length: PHASE_COUNT }, (_, i) => phaseBoundaries[i + 1] - phaseBoundaries[i]);

  // ── Step 4: call Gemini via the callAI proxy ────────────────────────────
  // Asks for 3 phase-level rules, not one entry per calendar day — a full
  // ~4-month plan authored day-by-day reproducibly truncated Gemini's JSON
  // output (thinking tokens + verbose per-day text exceeded maxTokens well
  // before the array finished). The full per-day array is instead expanded
  // mathematically from these rules in Step 5, below.
  const model = 'gemini-3.5-flash'; // Pinned 2026-07-23, see functions/src/index.ts for pin policy
  const systemInstruction = `You are an expert fat-loss coach designing a phase-based fat-loss plan. You will be given a user's profile, recent body composition trend, recent training history, their day-split preference, and their target metric.

The plan spans ${skeleton.length} days, split into exactly 3 phases (early/mid/late). You do NOT enumerate individual days — you design each phase's rules, and the exact daily calorie numbers get computed mathematically from those rules afterward.

For each phase, decide:
- weekSessionPattern: an array of exactly 7 values ("cardio"|"strength"|"rest"), one weekly template that repeats every week of that phase — index 0 is Sunday, index 6 is Saturday. Respect the day-split preference given below (cardio-leaning vs strength-leaning day counts); rest days are still part of the weekly rhythm.
- baseCalories: the calorie target for week 1 of this phase. Use the current baseline calorie goal provided below as a sanity-check anchor for phase 0's baseCalories.
- caloriesDeltaPercentPerWeek: a percentage (can be negative, e.g. -2 for a 2%/week step down), applied compounding week over week within this phase — the trajectory across the whole phase should be clearly visible by its last week, not +/-10 kcal noise, but must stay a sustainable, moderate change, never extreme.
- noteVariants: for "cardio", "strength", and "rest" each, provide 2-3 short (max 12 words), specific, encouraging notes that fit this phase's real intensity/calorie trajectory. These get cycled week to week within the phase, so each should read naturally on its own — don't reference a specific week number.

Each phase must be genuinely different from the one before it — a real step in calorie trajectory and/or cardio/strength emphasis, not a copy with a different label.

Return ONLY valid JSON, no markdown, no explanation, matching this exact shape:
{"phases":[{"phaseIndex":0,"weekSessionPattern":["cardio","strength","rest","cardio","strength","cardio","rest"],"baseCalories":number,"caloriesDeltaPercentPerWeek":number,"noteVariants":{"cardio":["...","..."],"strength":["...","..."],"rest":["...","..."]}}],"aiSummary":"max 25 words describing the plan's overall approach"}
The "phases" array must include exactly one entry for each of phaseIndex 0, 1, 2 — no more, no fewer.`;
  const userContent = `TARGET: ${targetStr}
TODAY: ${startDate}
PLAN END DATE: ${targetDate}
PLAN LENGTH: ${skeleton.length} days (~${Math.round(skeleton.length / 7)} weeks) across 3 phases:
${phaseSizes.map((size, i) => `  Phase ${i}: ${size} days (~${Math.round(size / 7)} weeks)`).join('\n')}
DAY-SPLIT PREFERENCE: ${splitStr}
CURRENT BASELINE CALORIE GOAL: ${currentGoals.calorieGoal ?? 'not set'}

PROFILE:
${profileStr}

RECENT BODY COMPOSITION (newest first):
${bodyStr}

RECENT TRAINING (last ${recentSessions.length}, newest first):
${sessionsStr}
${feedback ? `\nADDITIONAL USER INSTRUCTION: ${feedback}. Incorporate this into the plan you build from scratch, alongside the existing phase-progression requirements above.\n` : ''}
Design the 3 phases for this fat-loss plan.`;

  const { text: raw, usage } = await callAI({
    model,
    systemInstruction,
    contents: userContent,
    maxTokens: 8000,
  });

  // Best-effort usage log — must never block plan generation. Written via a
  // direct addDoc (not cleanData()) since cleanData() strips serverTimestamp()
  // sentinels down to plain objects (known bug, out of scope to fix here).
  try {
    await addDoc(collection(db, 'users', uid, 'aiUsageLogs'), {
      callType: feedback ? 'fatloss_plan_regenerate' : 'fatloss_plan_generate',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model,
      planId: null, // pre-persist draft — no plan id exists yet at this point
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[FatLossPlan] Failed to write usage log:', e);
  }

  let aiSummary = '';
  let phases: Map<number, FatLossPhase>;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in AI response');
    const parsed = JSON.parse(jsonMatch[0]) as { phases: FatLossPhase[]; aiSummary: string };
    if (!parsed.phases || !Array.isArray(parsed.phases)) throw new Error('Invalid AI response shape — missing phases array');

    aiSummary = parsed.aiSummary || '';
    phases = new Map(parsed.phases.map(p => [p.phaseIndex, p]));
  } catch (e) {
    console.warn('[FatLossPlan] Failed to parse AI plan response:', e);
    throw new Error("Couldn't generate your plan right now. Please try again.");
  }

  // ── Step 5: expand phase rules into the full per-day plan ────────────────
  // Mathematical expansion, not AI authorship — this is what keeps the AI's
  // JSON payload tiny regardless of plan length. Every downstream consumer
  // (preview card, persist, getEffectiveCalorieGoal) reads the same
  // FatLossPlanDay[] shape it always has, so nothing downstream changes.
  const fallbackCalories = currentGoals.calorieGoal ?? 2000;
  const tdee = await computeTDEE(uid);
  const weeklyPlan: FatLossPlanDay[] = skeleton.map(slot => {
    const phaseIdx = phaseIndexForDay(slot.dayIndex, phaseBoundaries);
    const phase = phases.get(phaseIdx);
    if (!phase) {
      return { date: slot.date, sessionType: 'rest', targetCalories: fallbackCalories, note: '' };
    }

    const dayOfWeek = dayOfWeekSunFirst(slot.date); // 0=Sun..6=Sat
    const sessionType = phase.weekSessionPattern?.[dayOfWeek] ?? 'rest';

    // 1-indexed week number within this phase, resetting at each phase boundary.
    const weekNum = Math.floor((slot.dayIndex - phaseBoundaries[phaseIdx]) / 7) + 1;

    const rawCalories = (phase.baseCalories ?? fallbackCalories) *
      Math.pow(1 + (phase.caloriesDeltaPercentPerWeek ?? 0) / 100, weekNum - 1);
    const rounded = Math.round(rawCalories / 50) * 50; // matches calculateNutritionGoals.ts's rounding convention
    const targetCalories = Math.min(tdee, Math.max(MIN_CALORIE_GOAL, rounded));

    const variants = phase.noteVariants?.[sessionType];
    const note = variants && variants.length > 0
      ? variants[(weekNum - 1) % variants.length]
      : '';

    return { date: slot.date, sessionType, targetCalories, note };
  });

  // ── Step 5b: overwrite notes on gym-split days ───────────────────────────
  // Same rationale as racePlanService.ts's generateRacePlanDraft: the AI
  // can't know a day's gym-split label at note-writing time, since that
  // label depends on the AI's own rest/strength choices in this same
  // response. Resolve it after the fact with the exact function the UI uses
  // (resolveGymSplitLabel), grouped into the same Monday–Sunday calendar
  // weeks buildGoalPlanWeekSchedule groups by, so generation-time notes
  // always agree with what gets displayed later.
  const pattern = input.gymSplitPattern ?? null;
  if (pattern && pattern.length > 0) {
    const weekGroups = new Map<string, FatLossPlanDay[]>();
    for (const day of weeklyPlan) {
      const weekStart = addDays(day.date, -isoWeekdayIndex(day.date));
      if (!weekGroups.has(weekStart)) weekGroups.set(weekStart, []);
      weekGroups.get(weekStart)!.push(day);
    }
    for (const weekDays of weekGroups.values()) {
      const planDays: PlanDay[] = weekDays.map(d => ({
        date: d.date,
        runType: FAT_LOSS_SESSION_TO_RUN_TYPE[d.sessionType],
        targetDistanceKm: null,
        targetPaceMinPerKm: null,
        note: d.note,
      }));
      for (const day of weekDays) {
        const splitLabel = resolveGymSplitLabel(planDays, pattern, day.date);
        if (splitLabel) day.note = `${splitLabel} day.`;
      }
    }
  }

  // Deliberately no id/createdAt/updatedAt, and no Firestore writes above —
  // this is the pre-review, in-memory state. Per investigation, a real id
  // and a resolved createdAt only meaningfully exist after persistFatLossPlan
  // writes the doc.
  return { startDate, targetDate, weeklyPlan, aiSummary };
}

// ── Persistence (never re-calls the AI) ─────────────────────────────────────

export async function persistFatLossPlan(
  uid: string,
  generated: GeneratedFatLossPlan,
  fields: FatLossPlanScalarFields
): Promise<GoalPlan> {
  // Only one active goal plan at a time — same abandon pattern createGoalPlan
  // uses internally today. This function owns that step itself (rather than
  // delegating to createGoalPlan) so the generate→persist boundary stays
  // entirely inside this file, with no Firestore writes happening until here.
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'goalPlans'), where('status', '==', 'active'))
    );
    await Promise.all(existingSnap.docs.map(d => updateDoc(d.ref, { status: 'replaced' })));
  } catch (e) {
    console.warn('[FatLossPlan] Failed to replace existing active plan(s):', e);
  }

  const planData = {
    type: 'performance_target' as GoalPlanType,
    status: 'active' as GoalPlanStatus,
    racePlanId: null,
    daySplit: fields.daySplit ?? null,
    bodyCompTarget: fields.metric && fields.targetValue != null
      ? { metric: fields.metric, targetValue: fields.targetValue }
      : null,
    routineDescription: null,
    trackMode: null,
    gymSplitPattern: fields.gymSplitPattern ?? null,
    startDate: generated.startDate,
    targetDate: generated.targetDate,
    hasStructuredPlan: true,
    weeklyPlan: generated.weeklyPlan,
    regenerationsUsed: fields.regenerationsUsed ?? 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'users', uid, 'goalPlans'), cleanData(planData));

  // activeGoalPlanId isn't a nutrition field, so this never trips the
  // conflict check inside saveGoals.
  await saveGoals(uid, { activeGoalPlanId: ref.id }, 'goal_plan_creation');

  // Sync today's calorie target from the plan's first day only. Bypasses
  // saveGoals's active-goal-plan conflict check on purpose — this plan now
  // owns calorieGoal, so writing its own day-1 value isn't an external
  // overwrite requiring confirmation. Keeping calorieGoal correct on day 2+
  // as the plan progresses is unresolved — see investigation notes in the
  // response accompanying this change.
  const firstDayCalories = generated.weeklyPlan[0]?.targetCalories;
  if (firstDayCalories != null) {
    await setDoc(
      doc(db, 'users', uid, 'goals', 'current'),
      { calorieGoal: firstDayCalories, updatedAt: new Date().toISOString(), updatedBy: 'goal_plan_creation' },
      { merge: true }
    );
  }

  console.log('[FatLossPlan] Generated and persisted plan:', ref.id);
  return { id: ref.id, ...planData };
}
