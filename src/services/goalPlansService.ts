import {
  getDocs, addDoc, updateDoc,
  collection, query, where, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { saveGoals } from '@/services/goalsService';

// ── Types ──────────────────────────────────────────────────────────────────

export type GoalPlanType = 'race' | 'performance_target' | 'existing_routine';
export type GoalPlanStatus = 'active' | 'replaced';

export type GoalPlanTrackMode = 'as_is' | 'ai_suggested';

export type FatLossSessionType = 'cardio' | 'strength' | 'rest';

export interface FatLossPlanDay {
  date: string; // YYYY-MM-DD, local
  sessionType: FatLossSessionType;
  targetCalories: number;
  note: string;
}

export interface GoalPlan {
  id: string;
  type: GoalPlanType;
  status: GoalPlanStatus;
  racePlanId: string | null;
  daySplit: { runDays: number; gymDays: number } | null;
  bodyCompTarget: { metric: string; targetValue: number } | null;
  // existing_routine only — the schema has no other place to keep what the user
  // actually described, or whether they want it left as-is vs AI-improved.
  routineDescription: string | null;
  trackMode: GoalPlanTrackMode | null;
  // Ordered rotation for gym days, e.g. ['Push','Pull','Legs'] — null until the
  // user has named one (via goal intake or the edit flow).
  gymSplitPattern: string[] | null;
  // performance_target structured weekly plan only — null/false for every other
  // goal-plan kind and for any performance_target created without one.
  startDate: string | null;   // YYYY-MM-DD, local — set only when weeklyPlan exists
  targetDate: string | null;  // YYYY-MM-DD, local — AI-picked, 3-6 months out
  hasStructuredPlan: boolean; // true only when weeklyPlan below is populated
  weeklyPlan: FatLossPlanDay[] | null;
  // How many times this plan was regenerated (with feedback) before being
  // saved — meaningful only for hasStructuredPlan plans. Mirrors
  // RacePlan.regenerationsUsed in racePlanService.ts.
  regenerationsUsed: number;
  createdAt?: any;
  updatedAt?: any;
}

interface CreateGoalPlanInput {
  type: GoalPlanType;
  racePlanId?: string | null;
  daySplit?: { runDays: number; gymDays: number } | null;
  bodyCompTarget?: { metric: string; targetValue: number } | null;
  routineDescription?: string | null;
  trackMode?: GoalPlanTrackMode | null;
  gymSplitPattern?: string[] | null;
  startDate?: string | null;
  targetDate?: string | null;
  hasStructuredPlan?: boolean;
  weeklyPlan?: FatLossPlanDay[] | null;
  regenerationsUsed?: number;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getActiveGoalPlan(uid: string): Promise<GoalPlan | null> {
  try {
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'goalPlans'), where('status', '==', 'active'), limit(1))
    );
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as GoalPlan;
  } catch (e) {
    console.warn('[GoalPlan] Failed to fetch active plan:', e);
    return null;
  }
}

export async function createGoalPlan(uid: string, input: CreateGoalPlanInput): Promise<GoalPlan> {
  // Only one active goal plan at a time — replace any existing one, same
  // pattern as racePlanService.ts abandoning prior active race plans.
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'goalPlans'), where('status', '==', 'active'))
    );
    await Promise.all(existingSnap.docs.map(d => updateDoc(d.ref, { status: 'replaced' })));
  } catch (e) {
    console.warn('[GoalPlan] Failed to replace existing active plan(s):', e);
  }

  const planData = {
    type: input.type,
    status: 'active' as GoalPlanStatus,
    racePlanId: input.racePlanId ?? null,
    daySplit: input.daySplit ?? null,
    bodyCompTarget: input.bodyCompTarget ?? null,
    routineDescription: input.routineDescription ?? null,
    trackMode: input.trackMode ?? null,
    gymSplitPattern: input.gymSplitPattern ?? null,
    startDate: input.startDate ?? null,
    targetDate: input.targetDate ?? null,
    hasStructuredPlan: input.hasStructuredPlan ?? false,
    weeklyPlan: input.weeklyPlan ?? null,
    regenerationsUsed: input.regenerationsUsed ?? 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'users', uid, 'goalPlans'), cleanData(planData));

  // activeGoalPlanId isn't a nutrition field, so this never trips the
  // conflict check inside saveGoals.
  await saveGoals(uid, { activeGoalPlanId: ref.id }, 'goal_plan_creation');

  console.log('[GoalPlan] Created and activated plan:', ref.id);
  return { id: ref.id, ...planData };
}

// ── Gym split lookup (pure) ──────────────────────────────────────────────────
// Never use toISOString() for calendar-day strings — it converts to UTC and
// shifts the date for IST (same lesson documented in racePlanService.ts).
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mon=0..Sun=6, matches the convention in getWorkoutRecommendation.ts.
function isoWeekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function getGymSplitForDate(plan: GoalPlan, date: string): string | null {
  const pattern = plan.gymSplitPattern;
  const gymDays = plan.daySplit?.gymDays ?? 0;
  if (!pattern || pattern.length === 0 || gymDays <= 0) return null;
  if (!plan.createdAt?.toDate) return null; // not yet resolved (e.g. straight off addDoc)

  const startDateStr = toLocalDateStr(plan.createdAt.toDate());
  if (date < startDateStr) return null;

  // Evenly place gymDays slots across the 7-day week.
  const slots = new Set<number>();
  for (let i = 0; i < gymDays; i++) slots.add(Math.round((i * 7) / gymDays) % 7);

  if (!slots.has(isoWeekdayIndex(new Date(date + 'T00:00:00')))) return null;

  // Ordinal count of gym-day slots from startDate through date, inclusive.
  let ordinal = -1;
  const cursor = new Date(startDateStr + 'T00:00:00');
  const target = new Date(date + 'T00:00:00');
  while (cursor <= target) {
    if (slots.has(isoWeekdayIndex(cursor))) ordinal++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return pattern[ordinal % pattern.length];
}
