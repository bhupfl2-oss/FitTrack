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

  // ── Step 4: call Gemini via the callAI proxy ────────────────────────────
  const model = 'gemini-3.5-flash'; // Pinned 2026-07-23, see functions/src/index.ts for pin policy
  const systemInstruction = `You are an expert fat-loss coach building a day-by-day plan alternating cardio, strength, and rest sessions, each with a daily calorie target. You will be given a user's profile, recent body composition trend, recent training history, their day-split preference, and their target metric.

Consider:
- Calorie targets should support gradual, sustainable fat loss (a moderate deficit, never extreme) — vary day to day around a sensible weekly average rather than a flat number every day (e.g. slightly higher on strength days, slightly lower on rest days is a reasonable pattern, but use judgment)
- Distribute cardio and strength sessions across the week per the day-split preference given; rest days still get a calorie target (typically at or near maintenance/slight deficit, not the lowest number of the week)
- Use the current baseline calorie goal provided below as a sanity-check anchor — daily targets should be in a plausible range around it, not wildly different, unless the day-split or body comp trend clearly justifies otherwise
- Keep notes short (max 12 words), specific, and encouraging

Structure the plan in phases across its full duration — you decide how many phases and where the boundaries fall, based on the plan's total length below (e.g. a ~12-week plan might warrant 2-3 phases; a ~17-20 week plan more, each phase roughly 3-5 weeks). Each phase must have a genuinely different average calorie target and/or cardio/strength emphasis than the phase before it — a step down in average calorie target and/or a shift in cardio/strength balance as the plan progresses is a common pattern, but decide what's right given the target and body comp trend. The change between phases must be clearly visible in the numbers, not +/-10 kcal noise repeated identically week after week — someone comparing week 1 to the final week should see the plan actually progressed. Every "note" must reflect which phase that day is actually in — its language should cohere with that phase's real calorie/intensity shift, not generic motivational filler disconnected from the numbers.

Return ONLY valid JSON, no markdown, no explanation, matching this exact shape:
{"days":[{"dayIndex":0,"sessionType":"cardio|strength|rest","targetCalories":number,"note":"short note"}],"aiSummary":"max 25 words describing the plan's overall approach"}
The "days" array must include exactly one entry for every dayIndex given in DAY SKELETON below — no more, no fewer.`;
  const userContent = `TARGET: ${targetStr}
TODAY: ${startDate}
PLAN END DATE: ${targetDate}
PLAN LENGTH: ${skeleton.length} days (~${Math.round(skeleton.length / 7)} weeks) — use this to decide how many phases the plan needs
DAY-SPLIT PREFERENCE: ${splitStr}
CURRENT BASELINE CALORIE GOAL: ${currentGoals.calorieGoal ?? 'not set'}

PROFILE:
${profileStr}

RECENT BODY COMPOSITION (newest first):
${bodyStr}

RECENT TRAINING (last ${recentSessions.length}, newest first):
${sessionsStr}

DAY SKELETON (dayIndex — fill in sessionType/targetCalories/note for each):
${skeleton.map(s => `day ${s.dayIndex}`).join('\n')}
${feedback ? `\nADDITIONAL USER INSTRUCTION: ${feedback}. Incorporate this into the plan you build from scratch, alongside the existing phase-progression requirements above.\n` : ''}
Build the fat-loss plan.`;

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
  //     model: 'claude-sonnet-4-6',
  //     max_tokens: 8000,
  //     system: systemInstruction,
  //     messages: [{ role: 'user', content: userContent }],
  //   }),
  // });
  // if (!response.ok) {
  //   console.warn('[FatLossPlan] AI request failed:', response.status);
  //   throw new Error(`AI request failed with status ${response.status}`);
  // }
  // const data = await response.json();
  // const raw = data.content?.[0]?.text ?? '';
  // const usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };

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
  let filledDays: Map<number, { sessionType: FatLossSessionType; targetCalories: number; note: string }>;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in AI response');
    const parsed = JSON.parse(jsonMatch[0]) as {
      days: { dayIndex: number; sessionType: FatLossSessionType; targetCalories: number; note: string }[];
      aiSummary: string;
    };
    if (!parsed.days || !Array.isArray(parsed.days)) throw new Error('Invalid AI response shape — missing days array');

    aiSummary = parsed.aiSummary || '';
    filledDays = new Map(parsed.days.map(d => [d.dayIndex, {
      sessionType: d.sessionType,
      targetCalories: d.targetCalories,
      note: d.note || '',
    }]));
  } catch (e) {
    console.warn('[FatLossPlan] Failed to parse AI plan response:', e);
    throw new Error("Couldn't generate your plan right now. Please try again.");
  }

  // ── Step 5: merge AI content onto the date skeleton ─────────────────────
  const fallbackCalories = currentGoals.calorieGoal ?? 2000;
  const weeklyPlan: FatLossPlanDay[] = skeleton.map(slot => {
    const filled = filledDays.get(slot.dayIndex);
    return {
      date: slot.date,
      sessionType: filled?.sessionType ?? 'rest',
      targetCalories: filled?.targetCalories ?? fallbackCalories,
      note: filled?.note ?? '',
    };
  });

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
