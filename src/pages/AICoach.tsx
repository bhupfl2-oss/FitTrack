import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, Pencil } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { callAI, type ContentTurn } from '@/lib/callAI';
import { useAsyncCall } from '@/hooks/useAsyncCall';
import { saveGoals, calculateGoalsWithAI } from '@/services/goalsService';
import { getActiveRacePlan, getCurrentWeekEntry, generateRacePlanDraft, persistRacePlan, type RacePlan, type RaceType, type RunType, type GeneratedRacePlan } from '@/services/racePlanService';
import { getActiveGoalPlan, createGoalPlan, type GoalPlan, type GoalPlanType, type GoalPlanTrackMode, type FatLossSessionType, type FatLossPlanDay } from '@/services/goalPlansService';
import { generateFatLossPlan, persistFatLossPlan, type GeneratedFatLossPlan } from '@/services/fatLossPlanService';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  showWorkoutLoad?: boolean;
  isContextError?: boolean;
}

interface ContextData {
  profile: any;
  bodyStats: any[];
  labResults: any[];
  tests: any[];
  workoutSessions: any[];
  nutritionLogs: any[];
  racePlan: RacePlan | null;
  activeGoalPlan: GoalPlan | null;
}

// ── Goal-intake types (topic === 'goal') ────────────────────────────────────

interface GoalPrefill {
  activeRacePlan: RacePlan | null;
  activeGoalPlan: GoalPlan | null;
}

interface GoalPlanProposal {
  goalPlanKind: GoalPlanType;
  // race
  raceType?: RaceType;
  raceName?: string;
  raceDate?: string;
  targetFinishTime?: string | null;
  customDistanceKm?: number | null;
  generatedRacePlan?: GeneratedRacePlan | null;
  // performance_target
  metric?: string;
  targetValue?: number;
  wantsStructuredPlan?: boolean;
  generatedFatLossPlan?: GeneratedFatLossPlan | null;
  // existing_routine
  routineDescription?: string;
  trackMode?: GoalPlanTrackMode;
  // shared
  daySplit?: { runDays: number; gymDays: number } | null;
  gymSplitPattern?: string[] | null;
  assumptions?: string[];
  // Regenerate-with-feedback loop (step 4) — lives only in this in-memory
  // draft (no plan doc is ever updated in place; persist always creates a new
  // doc). Seeded from the replaced plan's persisted regenerationsUsed (if any)
  // at proposal creation, incremented per regenerate, and written onto the
  // new doc's regenerationsUsed field at persist time — see confirmProposal.
  regenerationCount: number;
}

interface PendingGoalProposal {
  plan: GoalPlanProposal | null;
  nutritionUpdate: Record<string, number> | null;
  conflict: { type: 'race' | 'goalPlan'; label: string } | null;
}

// labRanges removed — reference ranges now come from tests collection

// Serializes a Date's LOCAL calendar day to YYYY-MM-DD — never use toISOString()
// for calendar-day purposes, it converts to UTC and shifts the date for IST.
const toLocalDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayLocalStr = () => toLocalDateStr(new Date());

const calculateAge = (dob: string) => {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
};

const describeGoalPlan = (gp: GoalPlan): string => {
  if (gp.type === 'performance_target') {
    return gp.bodyCompTarget ? `${gp.bodyCompTarget.metric} → ${gp.bodyCompTarget.targetValue}` : 'Performance target';
  }
  return gp.routineDescription || 'Your routine';
};

// ── Plan-body preview (race + fat-loss regenerate-with-feedback loop) ──────

interface PreviewDay {
  date: string;
  typeLabel: string;
  typeDotClass: string;
  note: string;
  keyNumber: string;
}

// Same color family RunnerPlanView's RUN_TYPE_STYLES uses for race day types,
// as a single dot rather than a full bg/border badge here.
const RACE_TYPE_DOT: Record<RunType, string> = {
  recovery: 'bg-emerald-400',
  tempo: 'bg-orange-400',
  long_run: 'bg-blue-400',
  intervals: 'bg-purple-400',
  race: 'bg-red-400',
  rest: 'bg-slate-600',
};
const RACE_TYPE_LABEL: Record<RunType, string> = {
  recovery: 'Recovery',
  tempo: 'Tempo',
  long_run: 'Long run',
  intervals: 'Intervals',
  race: 'Race',
  rest: 'Rest',
};
const FAT_LOSS_TYPE_DOT: Record<FatLossSessionType, string> = {
  cardio: 'bg-blue-400',
  strength: 'bg-purple-400',
  rest: 'bg-slate-600',
};
const FAT_LOSS_TYPE_LABEL: Record<FatLossSessionType, string> = {
  cardio: 'Cardio',
  strength: 'Strength',
  rest: 'Rest',
};

// fatLossPlanService's weeklyPlan is a flat day array (no weekNumber field) —
// chunked here into groups of 7 purely for pagination display, not stored.
function chunkFatLossWeeklyPlan(days: FatLossPlanDay[]): FatLossPlanDay[][] {
  const chunks: FatLossPlanDay[][] = [];
  for (let i = 0; i < days.length; i += 7) chunks.push(days.slice(i, i + 7));
  return chunks;
}

function formatPreviewDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`;
}

const quickChips: Record<string, string[]> = {
  workout: ["Suggest today's workout", "Why is my SMM dropping?", "How many days rest?"],
  food: ["What should I eat today?", "High protein veg meals", "Best pre-workout meal"],
  labs: ["Explain my results", "What should I retest?", "What affects Vitamin D?", "Is this package suitable for my needs?"],
  body: ["How's my body comp trending?", "Am I on track with my goals?", "What should I focus on next?", "Why is my SMM dropping?"],
  runner: ["How's my training going?", "Adjust this week's plan", "Should I run today?"],
  goal: ["I'm training for a 10K in December", "I want to hit 15% body fat", "I already run 3x a week, just track it"],
  general: ["How am I doing overall?", "Plan my week", "What should I focus on?", "Log something", "What should I eat today?"],
};

// Shared verbatim with the goal-intake system prompt so the flat-numeric path
// (Profile/Body/Workout/Food/Labs/General) behaves identically either way.
const GOAL_UPDATE_INSTRUCTIONS = `GOAL UPDATES: If — and only if — you are recommending the user change one of their daily targets (calorie, protein, carb, fat, steps, sleep, or water goal), append a structured block at the very end of your reply, after all the text you want shown to the user:
<<<GOAL_UPDATE>>>{"calorieGoal":2000,"proteinGoal":140}<<<END_GOAL_UPDATE>>>
Only include keys for goals you are actually recommending changing (valid keys: calorieGoal, proteinGoal, carbGoal, fatGoal, stepsGoal, sleepGoal, waterGoal). Never include this block when you are simply restating today's logged intake or making general commentary — it must only appear when you are proposing a new target.`;

const GOAL_PLAN_INTAKE_INSTRUCTIONS = `You are helping the user set up or edit a single active training goal — exactly one of three kinds. Figure out which kind fits from what they say, then gather the required info conversationally before proposing anything.

CONFLICT CHECK: before proposing any new goal, check USER CONTEXT for an existing active race plan or active goal plan of a different kind than what you're about to propose. If one exists, explicitly state in your reply — before the summary/confirm block, in plain language — that confirming this will replace/abandon that existing plan (compound goals aren't supported yet). Do this regardless of which direction the conflict runs (a new race replacing an active goal plan, or a new goal plan replacing an active race plan) — never let your reply imply both will coexist.

RACE: they name a specific race or race distance/date they're training for.
Required: race name (or a reasonable name if truly unnamed, e.g. "10K Race"), race date, race type (5k/10k/half_marathon/full_marathon/custom — infer from distance if given, customDistanceKm required if custom), and ideally a target finish time and weekly day-split (run days vs gym days). If the race date is incomplete (e.g. "December" with no day), never silently pick a day without saying so — either ask for the missing part, or if you default one, explicitly say what you assumed in your reply and list it in the assumptions array. Once you know gymDays > 0, also ask what split they want for their gym days — offer Push/Pull/Legs, Upper/Lower, or Full body as presets, and let them name their own pattern if none fit. Capture the answer as an ordered gymSplitPattern array (e.g. ["Push","Pull","Legs"]).

PERFORMANCE TARGET: they name a specific number/metric they want to hit that isn't a race (e.g. body fat %, a lift number, a pace).
Required: the metric name, their current value (for your own context only — it is never saved, so it's fine to just ask), their target value, and ideally a weekly day-split. Once you know gymDays > 0, also ask what split they want for their gym days — offer Push/Pull/Legs, Upper/Lower, or Full body as presets, and let them name their own pattern if none fit. Capture the answer as an ordered gymSplitPattern array (e.g. ["Push","Pull","Legs"]). Also ask explicitly whether they want a structured day-by-day plan generated for them (daily calorie targets plus a cardio/strength/rest schedule for the next few months) or would rather just have the number tracked with no day-by-day plan. This is required before the block is emitted — never default it silently; if they don't answer, ask again. Capture the answer as a boolean wantsStructuredPlan.

EXISTING ROUTINE: they describe a routine they already follow and just want tracked, not changed.
Parse the days/schedule exactly as they describe it — never invent structure they didn't mention. If any day of the week is left unstated, say so explicitly in your reply (e.g. "Sunday wasn't mentioned — I'll assume rest") and list it in the assumptions array; never silently fill a gap. Always ask explicitly: "Should I track this exactly as you described, or would you like AI to suggest improvements?" If the user doesn't answer that question, default trackMode to "as_is". Don't ask a separate question about the gym split — if what they described implies a rotating pattern (e.g. they mention push/pull/legs or upper/lower days), derive gymSplitPattern from that directly; if no rotating pattern is evident, leave it out.

Only emit the structured block below once you have the minimum required info for whichever kind applies — keep asking plain-text questions otherwise, no block yet.

COMPOUND GOALS: if the user's message also includes a body-composition or nutrition target (e.g. "...and I want to hit 15% body fat" or "...also up my protein"), include BOTH the goal-plan fields AND the flat numeric UserGoals fields (calorieGoal, proteinGoal, carbGoal, fatGoal, stepsGoal, sleepGoal, waterGoal) in the SAME JSON block below — never emit two separate blocks.

When ready, append exactly one block at the very end of your reply, after all the text you want shown to the user. Shape depends on goalPlanKind:
Race: <<<GOAL_UPDATE>>>{"goalPlanKind":"race","raceType":"10k","raceName":"...","raceDate":"YYYY-MM-DD","targetFinishTime":"55:00","daySplit":{"runDays":3,"gymDays":2},"gymSplitPattern":["Push","Pull","Legs"],"assumptions":["..."]}<<<END_GOAL_UPDATE>>>
Performance target: <<<GOAL_UPDATE>>>{"goalPlanKind":"performance_target","metric":"body fat %","targetValue":15,"wantsStructuredPlan":true,"daySplit":{"runDays":3,"gymDays":2},"gymSplitPattern":["Push","Pull","Legs"],"assumptions":[]}<<<END_GOAL_UPDATE>>>
Existing routine: <<<GOAL_UPDATE>>>{"goalPlanKind":"existing_routine","routineDescription":"as the user described it","trackMode":"as_is","daySplit":{"runDays":3,"gymDays":2},"gymSplitPattern":["Push","Pull","Legs"],"assumptions":["..."]}<<<END_GOAL_UPDATE>>>
For a compound goal, add any of the flat numeric UserGoals keys (calorieGoal, proteinGoal, etc.) alongside the goalPlanKind fields in that same object — do not emit them in a second block.
"assumptions" is always an array of short strings describing anything you inferred rather than the user stating outright; use an empty array if nothing was assumed.`;

const renderInline = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let key = 0;

  const boldSplit = text.split(/(\*\*.+?\*\*)/);
  boldSplit.forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      parts.push(<strong key={key++} className="font-semibold text-white">{part.slice(2, -2)}</strong>);
    } else {
      const italicSplit = part.split(/(\*.+?\*)/);
      italicSplit.forEach((subPart) => {
        if (subPart.startsWith('*') && subPart.endsWith('*')) {
          parts.push(<em key={key++} className="italic">{subPart.slice(1, -1)}</em>);
        } else {
          parts.push(<span key={key++}>{subPart}</span>);
        }
      });
    }
  });

  return parts;
};

const renderMarkdown = (text: string): React.ReactNode[] => {
  const paragraphs = text.split('\n\n');

  return paragraphs.map((para, i) => {
    const lines = para.split('\n');
    const allBullets = lines.length > 0 && lines.every((line) => line.startsWith('- '));

    if (allBullets) {
      return (
        <ul key={i} className="list-disc list-inside space-y-1 my-1 pl-1">
          {lines.map((line, j) => (
            <li key={j}>{renderInline(line.slice(2))}</li>
          ))}
        </ul>
      );
    }

    return <p key={i} className="mb-2 last:mb-0">{renderInline(para)}</p>;
  });
};

// Row + pencil-edit pattern, mirroring WorkoutPosterModal's inline-edit rows —
// closest existing convention in the app for a per-field editable summary.
function EditableRow({
  label, value, multiline, type = 'text', onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  type?: 'text' | 'number' | 'date';
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="flex items-start justify-between gap-2 py-1.5">
        <span className="text-[11px] text-slate-500 flex-shrink-0 pt-1.5">{label}</span>
        <div className="flex items-center gap-1.5 flex-1 justify-end">
          {multiline ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={2}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          ) : (
            <input
              type={type}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          )}
          <button onClick={() => { onSave(draft); setEditing(false); }} className="text-emerald-400 hover:text-emerald-300 text-xs">✓</button>
          <button onClick={() => { setDraft(value); setEditing(false); }} className="text-slate-500 hover:text-white text-xs">✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-white font-medium">{value || 'not set'}</span>
        <button onClick={() => { setDraft(value); setEditing(true); }} className="text-slate-500 hover:text-emerald-400">
          <Pencil size={11} />
        </button>
      </div>
    </div>
  );
}

export default function AICoach() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const topic = new URLSearchParams(location.search).get('topic') || 'general';
  const prefill = (location.state as { prefill?: GoalPrefill } | null)?.prefill;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [systemContext, setSystemContext] = useState('');
  const contextCall = useAsyncCall<ContextData>();
  const [messageCount, setMessageCount] = useState(0);
  const [pendingProposal, setPendingProposal] = useState<PendingGoalProposal | null>(null);
  // Separate from pendingProposal on purpose — generateFatLossPlan runs to
  // completion BEFORE setPendingProposal is ever called for that proposal
  // (see sendMessage), so this is the only state available to show a loading
  // card in the meantime.
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  // Distinct from generatingPlan on purpose — generatingPlan today only ever
  // gates the standalone "Generating your plan…" bubble that appears BEFORE
  // pendingProposal exists (first generation). Reusing it for regenerate
  // would still leave the confirm card visible (the two blocks aren't
  // nested), but it would conflate two different UI moments and prevent
  // localizing the in-progress state to the regenerate button/preview
  // itself, where the user can see the previous plan is being replaced.
  const [regeneratingPlan, setRegeneratingPlan] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState('');
  // 1-indexed "week" page for the plan-body preview — reset to 1 whenever
  // the currently-previewed generated plan's identity changes (see effect
  // below), which covers both first generation and every regenerate.
  const [previewWeekIndex, setPreviewWeekIndex] = useState(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const DAILY_LIMIT = 10;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Build context string from fetched data
  const buildContext = (data: ContextData) => {
    const parts: string[] = [];

    if (data.profile) {
      const age = calculateAge(data.profile.dob);
      const p = data.profile;
      const profileParts = [
        p.name && `Name: ${p.name}`,
        age && `Age: ${age}`,
        p.gender && `Gender: ${p.gender}`,
        p.heightCm && `Height: ${p.heightCm} cm`,
        p.foodPreference && `Diet: ${p.foodPreference}`,
        p.allergies && `Allergies: ${p.allergies}`,
        p.activityLevel && `Activity: ${p.activityLevel}`,
        p.primaryGoal && `Goal: ${p.primaryGoal}`,
        p.chronicConditions?.length && `Conditions: ${p.chronicConditions.join(', ')}`,
      ].filter(Boolean);
      if (profileParts.length) parts.push('PROFILE:\n' + profileParts.join('\n'));
    }

    if (data.bodyStats.length > 0) {
      const cur = data.bodyStats[0];
      const prev = data.bodyStats.length > 1 ? data.bodyStats[1] : null;
      const bodyParts = [
        cur.weightKg != null && `Weight: ${cur.weightKg} kg`,
        cur.pbf != null && `PBF: ${cur.pbf}%`,
        cur.smm != null && `SMM: ${cur.smm} kg`,
        prev?.weightKg != null && cur.weightKg != null && `Weight change: ${(cur.weightKg - prev.weightKg).toFixed(1)} kg`,
        prev?.pbf != null && cur.pbf != null && `PBF change: ${(cur.pbf - prev.pbf).toFixed(1)}%`,
      ].filter(Boolean);
      if (bodyParts.length) parts.push('BODY STATS (latest):\n' + bodyParts.join('\n'));
    }

    if (data.workoutSessions.length > 0) {
      const last10 = data.workoutSessions.slice(0, 10);
      parts.push('LAST 10 WORKOUTS:\n' + last10.map((s: any) => {
        const extras = [
          s.type === 'running' && ' (running)',
          s.distanceKm != null && `, ${s.distanceKm}km`,
          s.paceMinPerKm != null && `, ${s.paceMinPerKm.toFixed(2)} min/km`,
          s.effortType && `, ${s.effortType}`,
        ].filter(Boolean).join('');
        return `- ${s.date}: ${s.template}${extras}`;
      }).join('\n'));
    }

    if (data.racePlan) {
      const rp = data.racePlan;
      const week = getCurrentWeekEntry(rp);
      const [ry, rm, rd] = rp.raceDate.split('-').map(Number);
      const [ty, tm, td] = todayLocalStr().split('-').map(Number);
      const daysToRace = Math.max(0, Math.round((new Date(ry, rm - 1, rd).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000));
      const planParts = [
        `Race: ${rp.raceName} (${rp.raceType}) on ${rp.raceDate} — ${daysToRace} days away`,
        week && `Week ${week.weekNumber} of ${rp.totalWeeks}:`,
        week && week.days.map(d => `  - ${d.date} (${d.runType})${d.targetDistanceKm != null ? `: ${d.targetDistanceKm}km` : ''}${d.targetPaceMinPerKm != null ? ` @ ${d.targetPaceMinPerKm.toFixed(2)} min/km` : ''}${d.note ? ` — ${d.note}` : ''}`).join('\n'),
        rp.aiSummary && `Plan approach: ${rp.aiSummary}`,
      ].filter(Boolean);
      parts.push('RACE PLAN:\n' + planParts.join('\n'));
    }

    if (data.activeGoalPlan) {
      const gp = data.activeGoalPlan;
      const planParts = [
        `Type: ${gp.type}`,
        gp.bodyCompTarget && `Target: ${gp.bodyCompTarget.metric} → ${gp.bodyCompTarget.targetValue}`,
        gp.daySplit && `Day split: ${gp.daySplit.runDays} run · ${gp.daySplit.gymDays} gym / week`,
        gp.routineDescription && `Routine: ${gp.routineDescription}`,
        gp.trackMode && `Track mode: ${gp.trackMode}`,
      ].filter(Boolean);
      parts.push('ACTIVE GOAL PLAN:\n' + planParts.join('\n'));
    }

    if (data.nutritionLogs.length > 0) {
      const sumMacros = (items: any[]) => items.reduce((acc, it) => {
        const q = it.quantity || 1;
        return {
          calories: acc.calories + (it.calories || 0) * q,
          protein: acc.protein + (it.protein || 0) * q,
          carbs: acc.carbs + (it.carbs || 0) * q,
          fat: acc.fat + (it.fat || 0) * q,
          fibre: acc.fibre + (it.fibre || 0) * q,
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 });

      const today = todayLocalStr();
      const todayLog = data.nutritionLogs.find((l: any) => l.date === today);
      if (todayLog && todayLog.items?.length > 0) {
        const m = sumMacros(todayLog.items);
        parts.push(`TODAY'S NUTRITION (${today}):\n${m.calories} kcal, ${m.protein}g protein, ${m.carbs}g carbs, ${m.fat}g fat, ${m.fibre}g fibre\nMeals: ${todayLog.items.map((it: any) => it.name).join(', ')}`);
      } else {
        parts.push(`TODAY'S NUTRITION (${today}):\nNo meals logged yet today.`);
      }

      const recentLogs = data.nutritionLogs.filter((l: any) => l.date !== today && l.items?.length > 0).slice(0, 9);
      if (recentLogs.length > 0) {
        parts.push('RECENT NUTRITION:\n' + recentLogs.map((l: any) => {
          const m = sumMacros(l.items);
          return `- ${l.date}: ${m.calories} kcal, ${m.protein}g protein`;
        }).join('\n'));
      }
    }

    if (data.tests.length > 0) {
      // Use tests collection (new) — includes latest reading per test
      const testsWithReadings = data.tests.filter((t: any) => t.latestReading);
      if (testsWithReadings.length > 0) {
        const outOfRange = testsWithReadings.filter((t: any) => {
          const v = t.latestReading?.value;
          const low = t.referenceRangeLow;
          const high = t.referenceRangeHigh;
          if (v == null || (low == null && high == null)) return false;
          return (low != null && v < low) || (high != null && v > high);
        });
        const labLines = testsWithReadings.slice(0, 10).map((t: any) =>
          `- ${t.name}: ${t.latestReading.value} ${t.unit}`
        ).join('\n');
        if (outOfRange.length > 0) {
          parts.push(`LABS (${outOfRange.length} out of range):\n` +
            outOfRange.map((t: any) => `- ${t.name}: ${t.latestReading.value} ${t.unit}`).join('\n'));
        } else {
          parts.push(`LABS (all in range):\n${labLines}`);
        }
      }
    }

    if (data.tests.length > 0) {
      const upcoming = data.tests.filter((t: any) => t.nextDueDate);
      if (upcoming.length > 0) {
        parts.push(`UPCOMING TESTS:\n${upcoming.map((t: any) => `- ${t.testName}: ${t.nextDueDate}`).join('\n')}`);
      }
    }

    return parts.join('\n\n');
  };

  // Fetch all context data
  const loadContext = () => {
    if (!user) return;
    setContextLoaded(false);

    const fetchContext = async (): Promise<ContextData> => {
      const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
        const profile = profileSnap.exists() ? profileSnap.data() : null;

        const bodyQuery = query(
          collection(db, 'users', user.uid, 'bodyComp'),
          orderBy('date', 'desc'),
          limit(3)
        );
        const bodySnap = await getDocs(bodyQuery);
        const bodyStats = bodySnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const labsQuery = query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'),
          limit(5)
        );
        const labsSnap = await getDocs(labsQuery);
        const labResults = labsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const testsQuery = query(
          collection(db, 'users', user.uid, 'tests'),
          orderBy('nextDueDate', 'asc')
        );
        const testsSnap = await getDocs(testsQuery);
        const tests = testsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const sessionsQuery = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(10)
        );
        const sessionsSnap = await getDocs(sessionsQuery);
        const workoutSessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        let nutritionLogs: any[] = [];
        try {
          // nutritionLogs docs are keyed by local YYYY-MM-DD date string (no auto-increment id),
          // so a collection query ordered by documentId() needs a composite index Firestore
          // doesn't provision by default. Fetch the last 10 calendar days directly by id instead —
          // same pattern as Home.tsx's fetchWeeklyNutrition.
          const last10Dates = Array.from({ length: 10 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return toLocalDateStr(d);
          });
          const nutritionDocs = await Promise.all(
            last10Dates.map(dateStr => getDoc(doc(db, 'users', user.uid, 'nutritionLogs', dateStr)))
          );
          nutritionLogs = nutritionDocs
            .filter(snap => snap.exists())
            .map(snap => ({ id: snap.id, ...snap.data() }));
        } catch (e) {
          console.error('Error loading nutrition logs:', e);
        }

        const [racePlan, activeGoalPlan] = await Promise.all([
          getActiveRacePlan(user.uid),
          getActiveGoalPlan(user.uid),
        ]);

        const data: ContextData = { profile, bodyStats, labResults, tests, workoutSessions, nutritionLogs, racePlan, activeGoalPlan };

        // Load daily usage count — best-effort, not context-critical
        try {
          const usageSnap = await getDoc(doc(db, 'users', user.uid, 'aiUsage', 'coach'));
          const today = todayLocalStr();
          if (usageSnap.exists() && usageSnap.data().date === today) {
            setMessageCount(usageSnap.data().count || 0);
          } else {
            setMessageCount(0);
          }
        } catch (_) {
          setMessageCount(0);
        }

        return data;
    };

    contextCall.execute(fetchContext, { callType: 'ai_coach_context' }).then(data => {
      if (data) {
        setContextData(data);
        setSystemContext(buildContext(data));
      }
      setContextLoaded(true);
    });
  };

  useEffect(() => {
    loadContext();
  }, [user]);

  // Generate opening message after context loads
  useEffect(() => {
    if (!contextLoaded) return;
    if (messages.length > 0) return;

    if (contextCall.error) {
      setMessages([{
        role: 'assistant',
        content: `Couldn't load your data — check your connection and try again.`,
        isContextError: true,
      }]);
      return;
    }

    const name = contextData?.profile?.name?.split(' ')[0] || 'there';

    if (!topic || topic === 'general') {
      setMessages([{
        role: 'assistant',
        content: `Hey ${name}! I have your full health context loaded. What would you like to work on today?`,
      }]);
      return;
    }

    if (topic === 'goal') {
      // Deterministic opener (no API call) — references the specific active
      // plan by name when prefilled, so it can't misstate a number the LLM
      // might get wrong from context alone.
      if (prefill?.activeRacePlan) {
        const rp = prefill.activeRacePlan;
        setMessages([{
          role: 'assistant',
          content: `Let's update your **${rp.raceName}** plan (${rp.raceDate}). What would you like to change — the race details, target pace, or weekly split?`,
        }]);
      } else if (prefill?.activeGoalPlan) {
        const gp = prefill.activeGoalPlan;
        const label = gp.type === 'performance_target'
          ? (gp.bodyCompTarget ? `your ${gp.bodyCompTarget.metric} target` : 'your performance target')
          : 'your routine';
        setMessages([{
          role: 'assistant',
          content: `Let's update ${label}. What would you like to change?`,
        }]);
      } else {
        setMessages([{
          role: 'assistant',
          content: `Let's set up your training goal. Are you training for a **race**, chasing a **performance target** (like a body composition or strength number), or do you already have a **routine** you just want tracked? Tell me about it — race name and date, your target, or your weekly split.`,
        }]);
      }
      return;
    }

    // Topic-specific opener via API
    const openerPrompts: Record<string, string> = {
      workout: 'Based on the user\'s workout history and body stats, give a 2-3 sentence personalized workout insight and ask what they\'d like help with. Be specific about their data.',
      food: 'Based on the user\'s diet preference, body stats and goals, give a 2-3 sentence personalized food insight and ask what they\'d like help with.',
      labs: 'Based on the user\'s lab results (or lack thereof), give a 2-3 sentence insight and ask what they\'d like to know more about.',
      body: 'Based on the user\'s body composition trend (weight, body fat %, SMM), give a 2-3 sentence personalized insight and ask what they\'d like help with. Be specific about their data.',
      runner: 'Based on the user\'s active race plan (if any) and running history, give a 2-3 sentence personalized training insight and ask what they\'d like help with. Be specific about their data.',
    };

    const generateOpener = async () => {
      setLoading(true);
      const systemInstruction = `You are a personal health coach. ${openerPrompts[topic] || openerPrompts.general}

USER CONTEXT:
${systemContext}`;

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
      //     max_tokens: 400,
      //     system: systemInstruction,
      //     messages: [],
      //   }),
      // });
      // if (response.ok) {
      //   const data = await response.json();
      //   const text = data.content?.[0]?.text || 'How can I help you today?';
      //   ...
      // } else {
      //   setMessages([{ role: 'assistant', content: `How can I help you today?` }]);
      // }

      try {
        // Anthropic's call used an empty messages array with all context in
        // `system` — Gemini's generateContent requires non-empty contents, so
        // a minimal placeholder trigger stands in for the (nonexistent) user
        // turn; the actual instructions live entirely in systemInstruction.
        const { text } = await callAI({
          model: 'gemini-3.5-flash', // Pinned 2026-07-23, see functions/src/index.ts for pin policy
          systemInstruction,
          contents: 'Generate the opening message.',
          maxTokens: 400,
          thinkingBudget: 0,
        });
        setMessages([{ role: 'assistant', content: text || 'How can I help you today?' }]);
        // increment opener count
        const newCount = messageCount + 1;
        setMessageCount(newCount);
        if (user) {
          try {
            await setDoc(doc(db, 'users', user.uid, 'aiUsage', 'coach'), {
              date: todayLocalStr(),
              count: newCount,
            });
          } catch (_) {}
        }
      } catch (e) {
        setMessages([{ role: 'assistant', content: `How can I help you today?` }]);
      } finally {
        setLoading(false);
      }
    };

    generateOpener();
  }, [contextLoaded, contextCall.error, topic, messages.length, contextData, prefill]);

  // Reset the plan-preview pagination and feedback textarea whenever the
  // currently-previewed generated plan's identity changes — covers both the
  // first generation (undefined → object) and every regenerate (object →
  // new object), without needing to set these explicitly in every call site.
  useEffect(() => {
    setPreviewWeekIndex(1);
    setRegenerateFeedback('');
  }, [pendingProposal?.plan?.generatedRacePlan, pendingProposal?.plan?.generatedFatLossPlan]);

  const detectWorkoutSuggestion = (text: string): { name: string; sets: number; reps: number }[] | null => {
    const lines = text.split('\n');
    const exercises: { name: string; sets: number; reps: number }[] = [];

    for (const line of lines) {
      // Match patterns like: "Squats 4×8", "Bench Press: 3 sets of 10", "Deadlift - 4x8"
      const pattern1 = /^(?:\d+\.\s*)?(.+?)\s*[\-–:]\s*(\d+)\s*(?:sets?\s*(?:of|×|x)?\s*)?(\d+)/i;
      const pattern2 = /^(?:\d+\.\s*)?(.+?)\s+(\d+)\s*(?:×|x)\s*(\d+)/i;
      const match = line.match(pattern1) || line.match(pattern2);
      if (match) {
        const name = match[1].trim().replace(/^[-–\d\.\s]+/, '').trim();
        const sets = parseInt(match[2]) || 3;
        const reps = parseInt(match[3]) || 8;
        if (name.length > 2) exercises.push({ name, sets, reps });
      }
    }

    return exercises.length >= 2 ? exercises : null;
  };

  const loadWorkoutToDraft = async (exercises: { name: string; sets: number; reps: number }[]) => {
    if (!user) return;
    try {
      const draftExercises = exercises.map(ex => ({
        name: ex.name,
        hasWeight: true,
        sets: Array.from({ length: ex.sets }, () => ({ reps: String(ex.reps), weight: '' })),
      }));
      await setDoc(doc(db, 'users', user.uid, 'draftSessions', 'aiSuggested'), {
        type: 'AI Suggested',
        aiGenerated: true,
        exercises: draftExercises,
        sessionDate: new Date().toISOString().split('T')[0],
        savedAt: new Date().toISOString(),
      });
      navigate('/workout-session', { state: { template: 'aisuggested', aiWorkout: true } });
    } catch (e) {
      console.error('Error saving draft:', e);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');

    if (messageCount >= DAILY_LIMIT) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "You've reached your 10 message daily limit. Come back tomorrow!",
      }]);
      return;
    }

    setLoading(true);

    try {
      const conversationHistory = updatedMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const defaultSystemPrompt = `You are a personal health coach for this user. Always use their actual data in responses. Be concise (max 3-4 sentences). Never give medical diagnoses. Friendly, direct tone.

When the user wants to log something, suggest the right page naturally:
- Log food / meal / calories → suggest going to Food page
- Log workout / exercise / run → suggest going to Workouts page
- Log weight / body stats → suggest going to Body page
- Upload lab report / blood test → suggest going to Labs page
- Log water / steps / sleep → suggest going to Home page (wellness section)
Say something like "Head to the Food page to log that — tap Food in the nav bar." Keep it brief.

TEST PACKAGE COVERAGE: If the user asks whether a lab test package suits their needs but hasn't named the package or listed its tests yet, ask them to share the package name, paste the list of tests it includes, or describe it — give 2-3 popular examples (e.g. Dr Lal PathLabs Aarogyam, Thyrocare Aarogyam C, 1mg Full Body Checkup) to make replying easy. Once they give you the package's tests, compare it against their tracked tests and upcoming/overdue tests from their context, and clearly state what's covered and what's missing.

${GOAL_UPDATE_INSTRUCTIONS}

USER CONTEXT:
${systemContext}`;

      const goalSystemPrompt = `You are a personal training-goal coach for this user. Always use their actual data in responses. Be concise. Never give medical diagnoses. Friendly, direct tone.

${GOAL_PLAN_INTAKE_INSTRUCTIONS}

${GOAL_UPDATE_INSTRUCTIONS}

USER CONTEXT:
${systemContext}`;

      // Gemini requires the turn sequence to start with role 'user' (unlike
      // Anthropic, which tolerated this app's leading assistant-role opener
      // greeting) — strip any leading non-user turns before mapping, since
      // the canned opener carries no information the model needs to retain.
      const firstUserIdx = conversationHistory.findIndex(m => m.role === 'user');
      const geminiContents: ContentTurn[] = (firstUserIdx === -1 ? [] : conversationHistory.slice(firstUserIdx))
        .map(m => ({
          role: m.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        }));

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
      //     max_tokens: 500,
      //     system: topic === 'goal' ? goalSystemPrompt : defaultSystemPrompt,
      //     messages: conversationHistory,
      //   }),
      // });
      // if (!response.ok) throw new Error('AI request failed');
      // const data = await response.json();
      // const rawText = data.content?.[0]?.text || 'Sorry, I had trouble responding. Try again?';

      const { text: rawTextResult } = await callAI({
        model: 'gemini-3.5-flash', // Pinned 2026-07-23, see functions/src/index.ts for pin policy
        systemInstruction: topic === 'goal' ? goalSystemPrompt : defaultSystemPrompt,
        contents: geminiContents,
        maxTokens: 500,
        thinkingBudget: 0,
      });
      const rawText = rawTextResult || 'Sorry, I had trouble responding. Try again?';

      // Structured goal-update block: the model emits this only when it's
      // recommending a changed target, never when restating logged intake.
      const goalUpdateMatch = rawText.match(/<<<GOAL_UPDATE>>>([\s\S]*?)<<<END_GOAL_UPDATE>>>/);
      let aiText = rawText;
      if (goalUpdateMatch) aiText = aiText.replace(goalUpdateMatch[0], '').trim();

      const workoutExercises = detectWorkoutSuggestion(aiText);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: aiText,
        showWorkoutLoad: !!workoutExercises,
      }]);

      if (user && goalUpdateMatch) {
        try {
          const parsed = JSON.parse(goalUpdateMatch[1]) as Record<string, any>;
          // Shape-based branch: plan-shaped keys route to the confirm-card flow
          // instead of writing immediately; whatever numeric UserGoals keys are
          // left over take the exact same path this always has (saveGoals).
          // Whitelisted, not a catch-all spread — the goal-intake prompt can
          // return extra keys the model invented on its own (e.g. targetDate)
          // that must never be mistaken for a UserGoals field.
          const {
            goalPlanKind, raceType, raceName, raceDate, targetFinishTime, customDistanceKm,
            metric, targetValue, wantsStructuredPlan, routineDescription, trackMode, daySplit, gymSplitPattern, assumptions,
          } = parsed;
          const numericFields: Record<string, number> = {};
          for (const key of ['calorieGoal', 'proteinGoal', 'carbGoal', 'fatGoal', 'stepsGoal', 'sleepGoal', 'waterGoal']) {
            if (typeof parsed[key] === 'number') numericFields[key] = parsed[key];
          }

          if (goalPlanKind) {
            const conflict = contextData?.racePlan
              ? { type: 'race' as const, label: `${contextData.racePlan.raceName} (${contextData.racePlan.raceDate})` }
              : contextData?.activeGoalPlan
                ? { type: 'goalPlan' as const, label: describeGoalPlan(contextData.activeGoalPlan) }
                : null;

            // Fires exactly once per proposal — awaited to completion here,
            // before setPendingProposal is called for this proposal at all,
            // so no re-render can ever trigger a second (billed,
            // non-deterministic) generation call for the same proposal.
            let generatedFatLossPlan: GeneratedFatLossPlan | null = null;
            if (goalPlanKind === 'performance_target' && wantsStructuredPlan === true) {
              setGeneratingPlan(true);
              try {
                generatedFatLossPlan = await generateFatLossPlan(user.uid, { metric, targetValue, daySplit, gymSplitPattern });
              } catch (e) {
                console.error('[FatLossPlan] Generation failed:', e);
                // generatedFatLossPlan stays null — confirmProposal falls back
                // to the plain performance_target save path (createGoalPlan),
                // same as if the user hadn't asked for a structured plan.
              } finally {
                setGeneratingPlan(false);
              }
            }

            // Same fire-once-before-setPendingProposal pattern as fat-loss
            // above. Unlike performance_target, a race goal has no plain
            // no-plan fallback — a race IS the plan — so a failure here
            // leaves generatedRacePlan null and confirmProposal blocks Save
            // with an error rather than silently falling back to anything.
            let generatedRacePlan: GeneratedRacePlan | null = null;
            if (goalPlanKind === 'race') {
              setGeneratingPlan(true);
              try {
                generatedRacePlan = await generateRacePlanDraft(user.uid, { raceType, raceName, raceDate, targetFinishTime, customDistanceKm });
              } catch (e) {
                console.error('[RacePlan] Generation failed:', e);
              } finally {
                setGeneratingPlan(false);
              }
            }

            // Seed the regeneration count from the plan this draft would
            // replace (if any, and of the same kind) — so a plan that already
            // used its free regeneration doesn't get a fresh allowance just
            // because the user re-opened the goal-intake flow.
            const seededRegenerationCount = goalPlanKind === 'race'
              ? contextData?.racePlan?.regenerationsUsed ?? 0
              : goalPlanKind === 'performance_target' && wantsStructuredPlan === true && contextData?.activeGoalPlan?.type === 'performance_target' && contextData.activeGoalPlan.hasStructuredPlan
                ? contextData.activeGoalPlan.regenerationsUsed ?? 0
                : 0;

            setPendingProposal({
              plan: {
                goalPlanKind, raceType, raceName, raceDate, targetFinishTime, customDistanceKm,
                generatedRacePlan,
                metric, targetValue, wantsStructuredPlan, generatedFatLossPlan,
                routineDescription, trackMode, daySplit, gymSplitPattern,
                assumptions: assumptions ?? [],
                regenerationCount: seededRegenerationCount,
              },
              nutritionUpdate: Object.keys(numericFields).length > 0 ? numericFields : null,
              conflict,
            });
          } else if (Object.keys(numericFields).length > 0) {
            await saveGoals(user.uid, numericFields, 'ai_coach_recommendation');
            console.log('[Goals] AI coach recommended goal update, saved:', numericFields);
          }
        } catch (_) { /* silent */ }
      }

      // Full recalculation if user was asking about goals/macros/nutrition targets
      if (user) {
        const goalKeywords = /goals?|targets?|macros?|how much protein|what should i eat|calories i need|nutrition plan/i;
        if (goalKeywords.test(text)) {
          calculateGoalsWithAI(user.uid, { trigger: 'ai_coach_conversation' }).catch(() => {});
        }
      }

      // increment count on successful response
      const newCount = messageCount + 1;
      setMessageCount(newCount);
      if (user) {
        try {
          await setDoc(doc(db, 'users', user.uid, 'aiUsage', 'coach'), {
            date: todayLocalStr(),
            count: newCount,
          });
        } catch (_) {}
      }
    } catch (e) {
      console.error('Chat error:', e);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleChipClick = (chipText: string) => {
    sendMessage(chipText);
  };

  // ── Goal-plan confirm card ──────────────────────────────────────────────
  const updateProposalPlanField = (field: keyof GoalPlanProposal, value: any) => {
    setPendingProposal(prev => prev && prev.plan ? { ...prev, plan: { ...prev.plan, [field]: value } } : prev);
  };

  const updateProposalDaySplit = (key: 'runDays' | 'gymDays', value: number) => {
    setPendingProposal(prev => {
      if (!prev?.plan) return prev;
      const current = prev.plan.daySplit ?? { runDays: 0, gymDays: 0 };
      return { ...prev, plan: { ...prev.plan, daySplit: { ...current, [key]: value } } };
    });
  };

  const updateProposalNutritionField = (field: string, value: number) => {
    setPendingProposal(prev => prev ? { ...prev, nutritionUpdate: { ...(prev.nutritionUpdate ?? {}), [field]: value } } : prev);
  };

  const cancelProposal = () => {
    setPendingProposal(null);
    setProposalError(null);
  };

  // Fresh regenerate, not true revision — the feedback is appended as an
  // extra instruction on the same "build from scratch" prompt (per locked
  // decision), not serialized against the previous plan. Reads the intake
  // fields straight off pendingProposal.plan at call time, so any edits made
  // via the EditableRow fields before hitting regenerate are honored too.
  const regeneratePlanWithFeedback = async () => {
    if (!user || !pendingProposal?.plan) return;
    const feedback = regenerateFeedback.trim();
    if (!feedback) return; // no empty-feedback regenerate calls — each is a billed AI call
    const p = pendingProposal.plan;

    // Fresh-read the plan this draft would replace right before the call —
    // same "state could be stale" defensive pattern confirmProposal uses —
    // rather than trusting local state that may be minutes old. Falls back to
    // the in-memory count when there's no persisted plan yet (brand new draft).
    let effectiveRegenerationsUsed = p.regenerationCount;
    if (p.goalPlanKind === 'race') {
      const freshRacePlan = await getActiveRacePlan(user.uid);
      if (freshRacePlan) effectiveRegenerationsUsed = freshRacePlan.regenerationsUsed ?? 0;
    } else if (p.goalPlanKind === 'performance_target' && p.wantsStructuredPlan) {
      const freshGoalPlan = await getActiveGoalPlan(user.uid);
      if (freshGoalPlan?.type === 'performance_target' && freshGoalPlan.hasStructuredPlan) {
        effectiveRegenerationsUsed = freshGoalPlan.regenerationsUsed ?? 0;
      }
    }
    // Soft cap — this only warns, it never blocks. The user always gets to
    // proceed, so alert() (ack-only) is used rather than confirm() (which
    // would imply a Cancel path that doesn't actually exist here).
    if (effectiveRegenerationsUsed >= 1) {
      window.alert("You've already used your one free regeneration for this plan. Further regenerations aren't guaranteed to stay free.");
    }

    setRegeneratingPlan(true);
    setProposalError(null);
    try {
      if (p.goalPlanKind === 'race' && p.raceType && p.raceName && p.raceDate) {
        const generatedRacePlan = await generateRacePlanDraft(
          user.uid,
          {
            raceType: p.raceType,
            raceName: p.raceName,
            raceDate: p.raceDate,
            targetFinishTime: p.targetFinishTime ?? undefined,
            customDistanceKm: p.customDistanceKm ?? undefined,
          },
          feedback
        );
        setPendingProposal(prev => prev?.plan ? {
          ...prev,
          plan: { ...prev.plan, generatedRacePlan, regenerationCount: prev.plan.regenerationCount + 1 },
        } : prev);
      } else if (p.goalPlanKind === 'performance_target' && p.wantsStructuredPlan) {
        const generatedFatLossPlan = await generateFatLossPlan(
          user.uid,
          { metric: p.metric, targetValue: p.targetValue, daySplit: p.daySplit, gymSplitPattern: p.gymSplitPattern },
          feedback
        );
        setPendingProposal(prev => prev?.plan ? {
          ...prev,
          plan: { ...prev.plan, generatedFatLossPlan, regenerationCount: prev.plan.regenerationCount + 1 },
        } : prev);
      }
      setRegenerateFeedback('');
    } catch (e) {
      console.error('[GoalPlan] Regeneration failed:', e);
      setProposalError("Couldn't regenerate the plan. Please try again.");
    } finally {
      setRegeneratingPlan(false);
    }
  };

  // Bypasses saveGoals's active-goal-plan conflict check on purpose — that
  // check exists to require confirmation before overwriting nutrition targets
  // a plan owns, and the user just gave that confirmation by clicking Save on
  // this exact combined card.
  const applyConfirmedNutritionUpdate = async (uid: string, partial: Record<string, number>) => {
    await setDoc(
      doc(db, 'users', uid, 'goals', 'current'),
      { ...partial, updatedAt: new Date().toISOString(), updatedBy: 'ai_coach_recommendation' },
      { merge: true }
    );
  };

  const confirmProposal = async () => {
    if (!pendingProposal?.plan || !user) return;
    setSavingProposal(true);
    setProposalError(null);
    try {
      const p = pendingProposal.plan;

      // Re-verify right before writing — state could be stale if minutes
      // passed since the card was rendered.
      const [freshRacePlan, freshGoalPlan] = await Promise.all([
        getActiveRacePlan(user.uid),
        getActiveGoalPlan(user.uid),
      ]);

      if (p.goalPlanKind === 'race') {
        if (!p.raceName || !p.raceDate || !p.raceType) {
          throw new Error('Missing race name, date, or type — tell the coach the missing details first.');
        }
        if (!p.generatedRacePlan) {
          throw new Error("Plan generation didn't finish — cancel and ask the coach to try again.");
        }
        if (freshGoalPlan) {
          await updateDoc(doc(db, 'users', user.uid, 'goalPlans', freshGoalPlan.id), { status: 'replaced' });
        }
        await persistRacePlan(user.uid, p.generatedRacePlan, {
          createdBy: 'ai_coach',
          gymSplitPattern: p.gymSplitPattern ?? null,
          regenerationsUsed: p.regenerationCount,
        });
      } else {
        if (freshRacePlan) {
          await updateDoc(doc(db, 'users', user.uid, 'racePlans', freshRacePlan.id), { status: 'abandoned' });
        }
        if (p.goalPlanKind === 'performance_target' && p.generatedFatLossPlan) {
          await persistFatLossPlan(user.uid, p.generatedFatLossPlan, {
            metric: p.metric,
            targetValue: p.targetValue,
            daySplit: p.daySplit ?? null,
            gymSplitPattern: p.gymSplitPattern ?? null,
            regenerationsUsed: p.regenerationCount,
          });
        } else {
          await createGoalPlan(user.uid, {
            type: p.goalPlanKind,
            daySplit: p.daySplit ?? null,
            bodyCompTarget: p.goalPlanKind === 'performance_target' && p.metric && p.targetValue != null
              ? { metric: p.metric, targetValue: p.targetValue }
              : null,
            routineDescription: p.goalPlanKind === 'existing_routine' ? (p.routineDescription ?? null) : null,
            trackMode: p.goalPlanKind === 'existing_routine' ? (p.trackMode ?? 'as_is') : null,
            gymSplitPattern: p.gymSplitPattern ?? null,
          });
        }
      }

      if (pendingProposal.nutritionUpdate) {
        await applyConfirmedNutritionUpdate(user.uid, pendingProposal.nutritionUpdate);
      }

      const [racePlan, activeGoalPlan] = await Promise.all([
        getActiveRacePlan(user.uid),
        getActiveGoalPlan(user.uid),
      ]);
      setContextData(prev => prev ? { ...prev, racePlan, activeGoalPlan } : prev);

      setMessages(prev => [...prev, { role: 'assistant', content: '✅ Saved! Your goal is set.' }]);
      setPendingProposal(null);
    } catch (e: any) {
      console.error('Error confirming goal proposal:', e);
      setProposalError(e?.message || 'Failed to save. Please try again.');
    } finally {
      setSavingProposal(false);
    }
  };

  const hasUserSent = messages.some(m => m.role === 'user');
  const chips = quickChips[topic] || quickChips.general;

  // ── Plan-body preview data (shown for both race + fat-loss whenever a
  // generated plan exists in pendingProposal) ─────────────────────────────
  let previewKind: 'race' | 'fat_loss' | null = null;
  let previewPages: PreviewDay[][] = [];
  const previewRacePlan = pendingProposal?.plan?.generatedRacePlan;
  const previewFatLossPlan = pendingProposal?.plan?.generatedFatLossPlan;
  if (previewRacePlan) {
    previewKind = 'race';
    previewPages = previewRacePlan.weeklyPlan.map(week => week.days.map(d => ({
      date: d.date,
      typeLabel: RACE_TYPE_LABEL[d.runType],
      typeDotClass: RACE_TYPE_DOT[d.runType],
      note: d.note,
      keyNumber: d.targetDistanceKm != null
        ? `${d.targetDistanceKm}km${d.targetPaceMinPerKm != null ? ` · ${d.targetPaceMinPerKm.toFixed(2)}/km` : ''}`
        : '',
    })));
  } else if (previewFatLossPlan) {
    previewKind = 'fat_loss';
    previewPages = chunkFatLossWeeklyPlan(previewFatLossPlan.weeklyPlan).map(week => week.map(d => ({
      date: d.date,
      typeLabel: FAT_LOSS_TYPE_LABEL[d.sessionType],
      typeDotClass: FAT_LOSS_TYPE_DOT[d.sessionType],
      note: d.note,
      keyNumber: `${d.targetCalories} kcal`,
    })));
  }
  const totalPreviewPages = previewPages.length;
  const clampedPreviewWeekIndex = Math.min(Math.max(previewWeekIndex, 1), Math.max(totalPreviewPages, 1));
  const currentPreviewDays = previewPages[clampedPreviewWeekIndex - 1] ?? [];

  const contextChips: string[] = [];
  if (contextData && contextData.profile) contextChips.push('Profile');
  if (contextData && contextData.bodyStats.length > 0) contextChips.push('Body stats');
  if (contextData && contextData.tests.length > 0) contextChips.push(`${contextData.tests.length} tests tracked`);
  if (contextData && contextData.workoutSessions.length > 0) contextChips.push(`Last ${contextData.workoutSessions.length} workouts`);
  if (contextData && contextData.nutritionLogs.length > 0) contextChips.push(`Last ${contextData.nutritionLogs.length} days food`);

  return (
    <div className="fixed inset-0 bg-slate-950 text-white z-50 flex flex-col" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-base font-semibold">AI Coach</h1>
        </div>
        {contextLoaded && (
          <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
            ✦ Context loaded
          </span>
        )}
      </div>

      {/* Context bar */}
      {contextChips.length > 0 && (
        <div className="bg-emerald-500/5 border-b border-emerald-500/10 px-4 py-2 flex-shrink-0">
          <div className="flex flex-wrap gap-1">
            {contextChips.map((chip, i) => (
              <span key={i} className="bg-emerald-500/10 text-emerald-400 text-xs px-2 py-0.5 rounded-full">
                {chip}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-emerald-500 text-white rounded-2xl rounded-tr-sm ml-auto'
                  : 'bg-slate-800 text-slate-200 rounded-2xl rounded-tl-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div>{renderMarkdown(msg.content)}</div>
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
              {msg.isContextError && (
                <button
                  onClick={() => { setMessages([]); loadContext(); }}
                  className="bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg mt-2 inline-block hover:bg-emerald-600 transition-colors"
                >
                  Retry
                </button>
              )}
              {msg.showWorkoutLoad && (
                <button
                  onClick={() => {
                    const exercises = detectWorkoutSuggestion(msg.content);
                    if (exercises) loadWorkoutToDraft(exercises);
                  }}
                  className="bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg mt-2 inline-block hover:bg-emerald-600 transition-colors"
                >
                  ⚡ Load to Workouts
                </button>
              )}
            </div>
          </div>
        ))}

        {generatingPlan && (
          <div className="bg-slate-800 border border-emerald-500/30 rounded-2xl p-4 max-w-[95%] text-xs text-slate-400">
            Generating your plan…
          </div>
        )}

        {pendingProposal?.plan && (
          <div className="bg-slate-800 border border-emerald-500/30 rounded-2xl p-4 max-w-[95%]">
            {pendingProposal.conflict && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3 text-xs text-amber-300">
                ⚠️ Replaces your active {pendingProposal.conflict.type === 'race' ? 'race' : 'goal'}: {pendingProposal.conflict.label}
              </div>
            )}

            <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider mb-2">
              {pendingProposal.plan.goalPlanKind === 'race' ? 'Race Goal'
                : pendingProposal.plan.goalPlanKind === 'performance_target' ? 'Performance Target'
                : 'Existing Routine'}
            </div>

            <div className="divide-y divide-slate-700/50">
              {pendingProposal.plan.goalPlanKind === 'race' && (
                <>
                  <EditableRow label="Race name" value={pendingProposal.plan.raceName ?? ''} onSave={v => updateProposalPlanField('raceName', v)} />
                  <EditableRow label="Race date" type="date" value={pendingProposal.plan.raceDate ?? ''} onSave={v => updateProposalPlanField('raceDate', v)} />
                  <EditableRow label="Race type" value={pendingProposal.plan.raceType ?? ''} onSave={v => updateProposalPlanField('raceType', v)} />
                  <EditableRow label="Target finish time" value={pendingProposal.plan.targetFinishTime ?? ''} onSave={v => updateProposalPlanField('targetFinishTime', v || null)} />
                </>
              )}
              {pendingProposal.plan.goalPlanKind === 'performance_target' && (
                <>
                  <EditableRow label="Metric" value={pendingProposal.plan.metric ?? ''} onSave={v => updateProposalPlanField('metric', v)} />
                  <EditableRow label="Target value" type="number" value={pendingProposal.plan.targetValue != null ? String(pendingProposal.plan.targetValue) : ''} onSave={v => updateProposalPlanField('targetValue', parseFloat(v) || 0)} />
                </>
              )}
              {pendingProposal.plan.goalPlanKind === 'existing_routine' && (
                <>
                  <EditableRow label="Routine" multiline value={pendingProposal.plan.routineDescription ?? ''} onSave={v => updateProposalPlanField('routineDescription', v)} />
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[11px] text-slate-500">Track mode</span>
                    <div className="flex gap-1.5">
                      {(['as_is', 'ai_suggested'] as const).map(mode => (
                        <button key={mode} onClick={() => updateProposalPlanField('trackMode', mode)}
                          className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                            (pendingProposal.plan!.trackMode ?? 'as_is') === mode
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-400'
                          }`}>
                          {mode === 'as_is' ? 'As-is' : 'AI-suggested'}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {pendingProposal.plan.daySplit != null && (
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[11px] text-slate-500">Day split</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={7} value={pendingProposal.plan.daySplit.runDays}
                      onChange={e => updateProposalDaySplit('runDays', parseInt(e.target.value) || 0)}
                      className="w-12 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-white text-center" />
                    <span className="text-[10px] text-slate-500">run ·</span>
                    <input type="number" min={0} max={7} value={pendingProposal.plan.daySplit.gymDays}
                      onChange={e => updateProposalDaySplit('gymDays', parseInt(e.target.value) || 0)}
                      className="w-12 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-white text-center" />
                    <span className="text-[10px] text-slate-500">gym</span>
                  </div>
                </div>
              )}
              {pendingProposal.plan.daySplit != null && pendingProposal.plan.daySplit.gymDays > 0 && (
                <EditableRow
                  label="Gym split"
                  value={(pendingProposal.plan.gymSplitPattern ?? []).join(', ')}
                  onSave={v => updateProposalPlanField('gymSplitPattern', v.split(',').map(s => s.trim()).filter(Boolean))}
                />
              )}
              {pendingProposal.nutritionUpdate && Object.entries(pendingProposal.nutritionUpdate).map(([key, val]) => (
                <EditableRow key={key} label={key} type="number" value={String(val)}
                  onSave={v => updateProposalNutritionField(key, parseFloat(v) || 0)} />
              ))}
            </div>

            {pendingProposal.plan.assumptions && pendingProposal.plan.assumptions.length > 0 && (
              <div className="mt-2 text-[10px] text-slate-500 italic">
                Assumed: {pendingProposal.plan.assumptions.join(' · ')}
              </div>
            )}

            {previewKind && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    Plan preview — Week {clampedPreviewWeekIndex} of {totalPreviewPages}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewWeekIndex(n => Math.max(1, n - 1))}
                      disabled={clampedPreviewWeekIndex === 1}
                      className="text-slate-500 hover:text-white disabled:opacity-20 disabled:hover:text-slate-500 transition-colors text-xs px-1"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewWeekIndex(n => Math.min(totalPreviewPages, n + 1))}
                      disabled={clampedPreviewWeekIndex === totalPreviewPages}
                      className="text-slate-500 hover:text-white disabled:opacity-20 disabled:hover:text-slate-500 transition-colors text-xs px-1"
                    >
                      →
                    </button>
                  </div>
                </div>

                <div className={`space-y-1 transition-opacity ${regeneratingPlan ? 'opacity-40 pointer-events-none' : ''}`}>
                  {currentPreviewDays.map(day => (
                    <div key={day.date} className="flex items-center gap-2 py-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${day.typeDotClass}`} />
                      <span className="text-[10px] text-slate-500 flex-shrink-0">{formatPreviewDayLabel(day.date)}</span>
                      <span className="text-xs text-slate-300 flex-shrink-0">{day.typeLabel}</span>
                      <span className="text-[10px] text-slate-500 truncate flex-1">{day.note}</span>
                      <span className="text-xs text-white font-medium flex-shrink-0">{day.keyNumber}</span>
                    </div>
                  ))}
                </div>

                {regeneratingPlan && (
                  <div className="text-[10px] text-emerald-400 mt-1">Regenerating…</div>
                )}

                <div className="mt-3">
                  <textarea
                    value={regenerateFeedback}
                    onChange={e => setRegenerateFeedback(e.target.value)}
                    placeholder="e.g. make Sundays full rest, reduce long-run distance by 20%…"
                    rows={2}
                    disabled={regeneratingPlan}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-[10px] ${pendingProposal.plan.regenerationCount >= 1 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {pendingProposal.plan.regenerationCount >= 1
                        ? "Free regeneration used · further regenerations aren't guaranteed to stay free"
                        : '1 free regeneration available for this plan'}
                    </span>
                    <button
                      type="button"
                      onClick={regeneratePlanWithFeedback}
                      disabled={!regenerateFeedback.trim() || regeneratingPlan}
                      className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {regeneratingPlan ? 'Regenerating…' : 'Regenerate with feedback'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {proposalError && <div className="mt-2 text-[10px] text-red-400">{proposalError}</div>}

            <div className="flex gap-2 mt-3">
              <button onClick={cancelProposal} disabled={savingProposal}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmProposal} disabled={savingProposal}
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                {savingProposal ? 'Saving…' : pendingProposal.conflict ? 'Replace & Save' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Quick reply chips */}
        {!hasUserSent && !loading && messages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 pt-2">
            {chips.map((chip, i) => (
              <button
                key={i}
                onClick={() => handleChipClick(chip)}
                className="bg-slate-800 border border-slate-700 rounded-full px-3 py-1.5 text-xs text-slate-300 whitespace-nowrap hover:border-emerald-500 hover:text-emerald-400 transition-colors flex-shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="bg-slate-950 border-t border-slate-800 px-4 pt-3 pb-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder={messageCount >= DAILY_LIMIT ? "Daily limit reached · come back tomorrow" : "Ask anything…"}
            disabled={loading || messageCount >= DAILY_LIMIT}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-full px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          />
          <span className={`text-xs whitespace-nowrap flex-shrink-0 ${
            messageCount >= DAILY_LIMIT ? 'text-red-400' : messageCount >= 8 ? 'text-amber-400' : 'text-slate-500'
          }`}>
            {messageCount}/{DAILY_LIMIT}
          </span>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading || messageCount >= DAILY_LIMIT}
            className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white disabled:bg-slate-700 disabled:text-slate-500 hover:bg-emerald-600 transition-colors flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
