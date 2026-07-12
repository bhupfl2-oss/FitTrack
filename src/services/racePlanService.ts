import {
  doc, getDoc, getDocs, addDoc, updateDoc,
  collection, query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

// ── Types ──────────────────────────────────────────────────────────────────

export type RaceType = '5k' | '10k' | 'half_marathon' | 'full_marathon' | 'custom';
export type RunType = 'easy' | 'tempo' | 'long' | 'rest' | 'race';
export type RacePlanStatus = 'active' | 'completed' | 'abandoned';
export type RacePlanSource = 'profile' | 'ai_coach' | 'runner_tab';

export interface PlanDay {
  date: string; // YYYY-MM-DD
  runType: RunType;
  targetDistanceKm: number | null;
  targetPaceMinPerKm: number | null;
  note: string;
}

export interface WeeklyPlanEntry {
  weekNumber: number;
  days: PlanDay[];
}

export interface RacePlan {
  id: string;
  raceType: RaceType;
  raceName: string;
  raceDate: string;    // YYYY-MM-DD
  startDate: string;   // YYYY-MM-DD
  totalWeeks: number;
  status: RacePlanStatus;
  createdAt?: any;
  createdBy: RacePlanSource;
  weeklyPlan: WeeklyPlanEntry[];
  aiSummary: string;
  raceDistanceKm: number;
  targetFinishTime: string | null;   // as entered, e.g. "1:59:00" or "22:30"
  targetPaceMinPerKm: number | null; // derived
}

export interface AdherenceResult {
  completed: number;
  total: number;
  weekNumber: number;
}

// ── Local date helper ────────────────────────────────────────────────────
// Never use toISOString() for calendar-day strings — it converts to UTC and
// shifts the date for IST (same lesson documented in AICoach.tsx).
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

function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

const STANDARD_RACE_DISTANCES_KM: Record<Exclude<RaceType, 'custom'>, number> = {
  '5k': 5,
  '10k': 10,
  half_marathon: 21.0975,
  full_marathon: 42.195,
};

// Accepts "H:MM:SS" (2 colons) or "MM:SS" (1 colon) — detected by part count
// after splitting on ':'. Returns null (never throws) on empty input or any
// unparseable shape, so a malformed target never blocks plan generation.
function parseTargetPace(targetFinishTime: string | undefined, raceDistanceKm: number): number | null {
  if (!targetFinishTime?.trim()) return null;
  const parts = targetFinishTime.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  let totalMinutes: number;
  if (parts.length === 3) totalMinutes = parts[0] * 60 + parts[1] + parts[2] / 60;      // H:MM:SS
  else if (parts.length === 2) totalMinutes = parts[0] + parts[1] / 60;                  // MM:SS
  else return null;
  if (totalMinutes <= 0 || raceDistanceKm <= 0) return null;
  return totalMinutes / raceDistanceKm;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getActiveRacePlan(uid: string): Promise<RacePlan | null> {
  try {
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'racePlans'), where('status', '==', 'active'), limit(1))
    );
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as RacePlan;
  } catch (e) {
    console.warn('[RacePlan] Failed to fetch active plan:', e);
    return null;
  }
}

// ── AI generation ────────────────────────────────────────────────────────

interface GenerateRacePlanInput {
  raceType: RaceType;
  raceName: string;
  raceDate: string; // YYYY-MM-DD
  targetFinishTime?: string; // e.g. "1:59:00" or "22:30"
  customDistanceKm?: number; // required when raceType === 'custom'
}

export async function generateRacePlan(
  uid: string,
  input: GenerateRacePlanInput,
  createdBy: RacePlanSource
): Promise<RacePlan> {
  const { raceType, raceName, raceDate, targetFinishTime, customDistanceKm } = input;
  const startDate = todayStr();

  if (raceDate <= startDate) {
    throw new Error('Race date must be in the future');
  }

  let raceDistanceKm: number;
  if (raceType === 'custom') {
    if (customDistanceKm == null || customDistanceKm <= 0) {
      throw new Error('Custom race distance (km) is required for a custom race type');
    }
    raceDistanceKm = customDistanceKm;
  } else {
    raceDistanceKm = STANDARD_RACE_DISTANCES_KM[raceType];
  }
  const targetPaceMinPerKm = parseTargetPace(targetFinishTime, raceDistanceKm);
  const finalTargetFinishTime = targetPaceMinPerKm != null ? targetFinishTime!.trim() : null;

  // +1 because the skeleton below is 0-indexed by day offset from startDate —
  // without it, a race exactly N*7 days out lands one day past the last
  // generated week and never appears in weeklyPlan.
  const totalWeeks = Math.max(1, Math.ceil((daysBetween(startDate, raceDate) + 1) / 7));

  // ── Step 1: fetch context in parallel ───────────────────────────────────
  const profileSnap = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  const profile = profileSnap.exists() ? profileSnap.data() as any : {};

  // Last 15 running sessions — composite query (type == 'running' + orderBy date),
  // same try/catch-then-client-sort fallback pattern as WorkoutSession.tsx:262-278
  // since this repo has no pre-provisioned firestore.indexes.json.
  let runSessions: any[] = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workoutSessions'),
      where('type', '==', 'running'),
      orderBy('date', 'desc'),
      limit(15)
    ));
    runSessions = snap.docs.map(d => d.data());
  } catch {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workoutSessions'),
      where('type', '==', 'running'),
      limit(50)
    ));
    runSessions = snap.docs
      .map(d => d.data())
      .sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
      .slice(0, 15);
  }

  // ── Step 2: build context strings ───────────────────────────────────────
  const profileParts = [
    profile.gender && `gender ${profile.gender}`,
    profile.heightCm && `height ${profile.heightCm}cm`,
    profile.activityLevel && `activity level ${profile.activityLevel}`,
    profile.primaryGoal && `primary goal ${profile.primaryGoal}`,
    profile.fitnessFocus?.length && `focus: ${profile.fitnessFocus.join(', ')}`,
    profile.fitnessTarget && `target: ${profile.fitnessTarget}`,
  ].filter(Boolean);
  const profileStr = profileParts.join(', ') || 'not provided';

  const runsStr = runSessions.length > 0
    ? runSessions.map((s: any) => {
        const parts = [s.date];
        if (s.distanceKm != null) parts.push(`${s.distanceKm}km`);
        if (s.durationMins != null) parts.push(`${Math.round(s.durationMins)}min`);
        if (s.paceMinPerKm != null) parts.push(`${s.paceMinPerKm.toFixed(2)} min/km pace`);
        if (s.effortType) parts.push(s.effortType);
        if (s.surface) parts.push(s.surface);
        return parts.join(', ');
      }).join('\n')
    : 'no recent running sessions';

  // ── Step 3: pre-compute the date skeleton ───────────────────────────────
  // Dates are computed deterministically here (not by the AI) so a long
  // multi-week plan can't come back with wrong/inconsistent calendar dates.
  // The AI only fills in runType/targetDistanceKm/targetPaceMinPerKm/note
  // per weekNumber+dayIndex, which we merge onto this skeleton below.
  const skeleton: { weekNumber: number; dayIndex: number; date: string }[] = [];
  for (let week = 1; week <= totalWeeks; week++) {
    for (let day = 0; day < 7; day++) {
      const offset = (week - 1) * 7 + day;
      const date = addDays(startDate, offset);
      if (date > raceDate) continue;
      skeleton.push({ weekNumber: week, dayIndex: day, date });
    }
  }

  // ── Step 4: call Claude API ─────────────────────────────────────────────
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
      max_tokens: 16000,
      system: `You are an expert running coach building a periodized training plan. You will be given a runner's profile, recent running history, and a race target. Build a day-by-day plan for every day between today and race day.

Consider:
- Build volume gradually (10% rule), taper in the final 1-2 weeks before the race
- Mix easy runs, one tempo run/week, one long run/week, rest days, and a race day on the final date
- If a GOAL PACE is provided below, calibrate every day's targetPaceMinPerKm relative to it: race day should be at (or very close to) the goal pace, tempo runs moderately faster than easy pace and close to the goal pace, easy and long runs meaningfully slower than goal pace (roughly 45-90 sec/km slower) — let recent running history refine these paces, but the goal pace is the anchor, not history alone
- If no GOAL PACE is provided, base target distances/paces on the runner's actual recent running history when available, otherwise use sensible beginner-safe defaults for the race distance
- Keep notes short (max 12 words), specific, and encouraging

Return ONLY valid JSON, no markdown, no explanation, matching this exact shape:
{"days":[{"weekNumber":1,"dayIndex":0,"runType":"easy|tempo|long|rest|race","targetDistanceKm":number|null,"targetPaceMinPerKm":number|null,"note":"short note"}],"aiSummary":"max 25 words describing the plan's overall approach"}
The "days" array must include exactly one entry for every (weekNumber, dayIndex) pair given in DAY SKELETON below — no more, no fewer.`,
      messages: [{
        role: 'user',
        content: `RACE: ${raceName} (${raceType}, ${raceDistanceKm}km) on ${raceDate}${targetPaceMinPerKm != null ? `\nGOAL PACE: ${targetPaceMinPerKm.toFixed(2)} min/km (target finish time ${finalTargetFinishTime})` : ''}
TODAY: ${startDate}
TOTAL WEEKS: ${totalWeeks}

RUNNER PROFILE:
${profileStr}

RECENT RUNNING HISTORY (last ${runSessions.length}, newest first):
${runsStr}

DAY SKELETON (weekNumber, dayIndex — fill in runType/targetDistanceKm/targetPaceMinPerKm/note for each):
${skeleton.map(s => `week ${s.weekNumber}, day ${s.dayIndex}`).join('\n')}

Build the training plan.`,
      }],
    }),
  });

  if (!response.ok) {
    console.warn('[RacePlan] AI request failed:', response.status);
    throw new Error(`AI request failed with status ${response.status}`);
  }

  let aiSummary = '';
  let filledDays: Map<string, { runType: RunType; targetDistanceKm: number | null; targetPaceMinPerKm: number | null; note: string }>;
  try {
    const data = await response.json();
    const raw = data.content?.[0]?.text ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in AI response');
    const parsed = JSON.parse(jsonMatch[0]) as {
      days: { weekNumber: number; dayIndex: number; runType: RunType; targetDistanceKm: number | null; targetPaceMinPerKm: number | null; note: string }[];
      aiSummary: string;
    };
    if (!parsed.days || !Array.isArray(parsed.days)) throw new Error('Invalid AI response shape — missing days array');

    aiSummary = parsed.aiSummary || '';
    filledDays = new Map(parsed.days.map(d => [`${d.weekNumber}-${d.dayIndex}`, {
      runType: d.runType,
      targetDistanceKm: d.targetDistanceKm ?? null,
      targetPaceMinPerKm: d.targetPaceMinPerKm ?? null,
      note: d.note || '',
    }]));
  } catch (e) {
    console.warn('[RacePlan] Failed to parse AI plan response:', e);
    throw new Error("Couldn't generate your plan right now. Please try again.");
  }

  // ── Step 5: merge AI content onto the date skeleton ─────────────────────
  const weeksMap = new Map<number, PlanDay[]>();
  for (const slot of skeleton) {
    const filled = filledDays.get(`${slot.weekNumber}-${slot.dayIndex}`);
    const day: PlanDay = {
      date: slot.date,
      runType: filled?.runType ?? 'rest',
      targetDistanceKm: filled?.targetDistanceKm ?? null,
      targetPaceMinPerKm: filled?.targetPaceMinPerKm ?? null,
      note: filled?.note ?? '',
    };
    if (!weeksMap.has(slot.weekNumber)) weeksMap.set(slot.weekNumber, []);
    weeksMap.get(slot.weekNumber)!.push(day);
  }
  const weeklyPlan: WeeklyPlanEntry[] = [...weeksMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekNumber, days]) => ({ weekNumber, days }));

  // ── Step 6: abandon any existing active plan(s) ─────────────────────────
  // Only one active plan at a time is supported today — flagging that this
  // won't hold if the product later wants overlapping plans (e.g. a tune-up
  // 10k block inside a marathon block), but implementing single-active as
  // specified for now.
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'racePlans'), where('status', '==', 'active'))
    );
    await Promise.all(existingSnap.docs.map(d => updateDoc(d.ref, { status: 'abandoned' })));
  } catch (e) {
    console.warn('[RacePlan] Failed to abandon existing active plan(s):', e);
  }

  // ── Step 7: save and return ──────────────────────────────────────────────
  const planData = {
    raceType, raceName, raceDate, startDate, totalWeeks,
    status: 'active' as RacePlanStatus,
    createdAt: serverTimestamp(),
    createdBy,
    weeklyPlan,
    aiSummary,
    raceDistanceKm,
    targetFinishTime: finalTargetFinishTime,
    targetPaceMinPerKm,
  };
  const ref = await addDoc(collection(db, 'users', uid, 'racePlans'), cleanData(planData));
  console.log('[RacePlan] Generated and saved plan:', ref.id);

  return { id: ref.id, ...planData };
}

// ── Adherence (pure, no Firestore) ──────────────────────────────────────────

export function getCurrentWeekEntry(plan: RacePlan): WeeklyPlanEntry | null {
  const today = todayStr();
  return plan.weeklyPlan.find(w => w.days.some(d => d.date === today))
    ?? plan.weeklyPlan.find(w => w.days.length > 0 && today >= w.days[0].date && today <= w.days[w.days.length - 1].date)
    ?? null;
}

export function computeAdherence(plan: RacePlan, workoutSessions: any[]): AdherenceResult {
  const week = getCurrentWeekEntry(plan);
  if (!week) return { completed: 0, total: 0, weekNumber: 0 };

  // Only ever rely on .type and .date — thin quick-logged running docs
  // (from Workouts.tsx's inline AI chat) may be missing distanceKm,
  // paceMinPerKm, caloriesBurned, and effortType entirely.
  const ranOnDate = new Set(
    workoutSessions.filter(s => s.type === 'running' && s.date).map(s => s.date)
  );

  const planned = week.days.filter(d => d.runType !== 'rest');
  const completed = planned.filter(d => ranOnDate.has(d.date)).length;

  return { completed, total: planned.length, weekNumber: week.weekNumber };
}
