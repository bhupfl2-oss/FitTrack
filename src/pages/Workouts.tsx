import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, Plus, Clock, Calendar, X, Activity, Dumbbell, Search, Trash2, Pencil, Send, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Share2, Flag, Target, Repeat } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import { collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp, deleteDoc, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { useActivityRings } from '@/hooks/useActivityRings';
import { bumpDataVersion } from '@/lib/dataVersion';
import { callAI, type ContentTurn } from '@/lib/callAI';
import { ensureDefaultHabits, getHabitLogToday, setHabitLogToday } from '@/lib/defaultHabits';
import { getTodayRecommendations, getWeekSchedule, RUN_TYPE_META, type TaggedRecommendation } from '@/lib/getWorkoutRecommendation';
import WorkoutPosterModal from '@/components/WorkoutPosterModal';
import { getActiveRacePlan, type RacePlan, type PlanDay } from '@/services/racePlanService';
import { getActiveGoalPlan, type GoalPlan } from '@/services/goalPlansService';
import type { EffortType } from '@/pages/RunningSession';
import { useGoals } from '@/services/goalsService';

// ── Types ──────────────────────────────────────────────────────────────────
interface WorkoutSession {
  id: string; date: string; template: string;
  duration?: number; durationMins?: number;
  exercises?: Exercise[]; type?: 'workout' | 'running';
  effortType?: 'recovery' | 'tempo' | 'endurance';
  surface?: 'road' | 'treadmill' | 'hill';
  distanceKm?: number; paceMinPerKm?: number; notes?: string; createdAt: any;
}
interface Exercise { name: string; sets: ExerciseSet[]; }
interface ExerciseSet { reps: number; weight: number; }
interface OneRMData { date: string; oneRM: number; }
interface CustomWorkout {
  id?: string; name: string;
  exercises: { name: string; category: string; defaultSets: number }[];
  createdAt?: any;
}
interface ExerciseItem { name: string; category: string; }
interface AIPlanExercise { exercise: string; sets: number; reps: number; suggestedWeight: number; lastWeight: number; }
interface ChatMessage { role: 'user' | 'ai'; text: string; plan?: AIPlanExercise[]; logged?: boolean; loggedActivity?: string; askForDetails?: boolean; }

// ── Constants ──────────────────────────────────────────────────────────────
const EXERCISE_LIBRARY: ExerciseItem[] = [
  { name: 'Bench Press', category: 'push' }, { name: 'Incline Bench Press', category: 'push' },
  { name: 'Overhead Press', category: 'push' }, { name: 'Incline Dumbbell Press', category: 'push' },
  { name: 'Cable Fly', category: 'push' }, { name: 'Chest Dip', category: 'push' },
  { name: 'Lateral Raise', category: 'push' }, { name: 'Front Raise', category: 'push' },
  { name: 'Tricep Pushdown', category: 'push' }, { name: 'Skull Crushers', category: 'push' },
  { name: 'Close Grip Bench Press', category: 'push' }, { name: 'Arnold Press', category: 'push' },
  { name: 'Deadlift', category: 'pull' }, { name: 'Pull-ups', category: 'pull' },
  { name: 'Chin-ups', category: 'pull' }, { name: 'Barbell Row', category: 'pull' },
  { name: 'Dumbbell Row', category: 'pull' }, { name: 'Cable Row', category: 'pull' },
  { name: 'Face Pull', category: 'pull' }, { name: 'Lat Pulldown', category: 'pull' },
  { name: 'Bicep Curl', category: 'pull' }, { name: 'Hammer Curl', category: 'pull' },
  { name: 'Preacher Curl', category: 'pull' }, { name: 'T-Bar Row', category: 'pull' },
  { name: 'Squat', category: 'legs' }, { name: 'Romanian Deadlift', category: 'legs' },
  { name: 'Leg Press', category: 'legs' }, { name: 'Leg Curl', category: 'legs' },
  { name: 'Leg Extension', category: 'legs' }, { name: 'Calf Raise', category: 'legs' },
  { name: 'Bulgarian Split Squat', category: 'legs' }, { name: 'Lunges', category: 'legs' },
  { name: 'Hack Squat', category: 'legs' }, { name: 'Glute Bridge', category: 'legs' },
  { name: 'Hip Thrust', category: 'legs' }, { name: 'Plank', category: 'core' },
  { name: 'Crunches', category: 'core' }, { name: 'Russian Twists', category: 'core' },
  { name: 'Leg Raises', category: 'core' }, { name: 'Cable Crunch', category: 'core' },
  { name: 'Ab Wheel Rollout', category: 'core' }, { name: 'Mountain Climbers', category: 'core' },
  { name: 'Barbell Clean', category: 'full body' }, { name: 'Burpees', category: 'full body' },
  { name: 'Kettlebell Swing', category: 'full body' }, { name: 'Box Jumps', category: 'full body' },
  { name: 'Battle Ropes', category: 'full body' },
];

// Workout library grouped by tab — strength + cardio merged into one list (identical
// entry shape, no reason to tab-separate them from each other).
const WORKOUT_LIBRARY = {
  all: [
    { type: 'push', title: 'Push Day', subtitle: 'Chest · Shoulders · Triceps', emoji: '💪' },
    { type: 'pull', title: 'Pull Day', subtitle: 'Back · Biceps', emoji: '🏋️' },
    { type: 'legs', title: 'Legs Day', subtitle: 'Quads · Hamstrings · Glutes', emoji: '🦵' },
    { type: 'upper', title: 'Upper Body', subtitle: 'Chest · Back · Shoulders', emoji: '🏋️' },
    { type: 'lower', title: 'Lower Body', subtitle: 'Quads · Hamstrings · Glutes', emoji: '⬇️' },
    { type: 'fullbody', title: 'Full Body', subtitle: 'All muscle groups', emoji: '⚡' },
    { type: 'running', title: 'Running', subtitle: 'Distance · Pace · Time', emoji: '🏃' },
    { type: 'cycling', title: 'Cycling', subtitle: 'Distance · Cadence · Time', emoji: '🚴' },
    { type: 'hiit', title: 'HIIT', subtitle: 'High intensity intervals', emoji: '🔥' },
    { type: 'walk', title: 'Walking', subtitle: 'Steps · Distance · Time', emoji: '🚶' },
  ],
  mindbody: [
    { type: 'yoga', title: 'Yoga', subtitle: 'Flexibility · Mindfulness', emoji: '🧘' },
    { type: 'stretching', title: 'Stretching', subtitle: 'Mobility · Recovery', emoji: '🤸' },
    { type: 'meditation', title: 'Meditation', subtitle: 'Mindfulness · Breathing', emoji: '🌿' },
  ],
  other: [
    { type: 'hiking', title: 'Hiking', subtitle: 'Trail · Elevation · Distance', emoji: '🏔️' },
    { type: 'swimming', title: 'Swimming', subtitle: 'Laps · Distance · Time', emoji: '🏊' },
    { type: 'sports', title: 'Sports', subtitle: 'Game · Match · Training', emoji: '⚽' },
    { type: 'martial_arts', title: 'Martial Arts', subtitle: 'Training · Sparring', emoji: '🥊' },
  ],
};

const LIBRARY_TABS = [
  { key: 'all', label: 'Workouts' },
  { key: 'mindbody', label: 'Mind-Body' },
  { key: 'other', label: 'Other' },
] as const;

const calculateOneRM = (weight: number, reps: number): number => weight * (1 + reps / 30);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Workouts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { goals: userGoals } = useGoals(user?.uid);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<WorkoutSession | null>(null);
  const [showRunningPoster, setShowRunningPoster] = useState(false);
  const [posterSession, setPosterSession] = useState<WorkoutSession | null>(null);
  const [editingCalories, setEditingCalories] = useState(false);
  const [caloriesInput, setCaloriesInput] = useState('');
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationMinsInput, setDurationMinsInput] = useState('');
  const [durationSecsInput, setDurationSecsInput] = useState('');
  const [savingSessionField, setSavingSessionField] = useState(false);
  const [loading, setLoading] = useState(true);
  usePageLoadTime('Workouts', loading);
  const [showPrevSessions, setShowPrevSessions] = useState(false);

  // Goal status strip
  const [activeRacePlan, setActiveRacePlan] = useState<RacePlan | null>(null);
  const [activeGoalPlan, setActiveGoalPlan] = useState<GoalPlan | null>(null);

  // Week view
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekSchedule, setWeekSchedule] = useState<PlanDay[] | null>(null);
  const [nextWeekAvailable, setNextWeekAvailable] = useState(false);

  const [customWorkouts, setCustomWorkouts] = useState<CustomWorkout[]>([]);
  const [editingWorkout, setEditingWorkout] = useState<CustomWorkout | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [workoutName, setWorkoutName] = useState('');
  const [selectedExercises, setSelectedExercises] = useState<{ name: string; category: string; defaultSets: number }[]>([]);
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  // Workout library state
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [libraryTab, setLibraryTab] = useState<'all' | 'mindbody' | 'other'>('all');
  const [todayRecommendations, setTodayRecommendations] = useState<TaggedRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [workedOutToday, setWorkedOutToday] = useState(false);

  // AI chat state — multi-turn
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingActivity, setPendingActivity] = useState<{ name: string; type: string; template: string; durationMins?: number } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const rings = useActivityRings(user?.uid || '');

  // Steps state
  const [stepsHabitId, setStepsHabitId] = useState<string | null>(null);
  const [stepsToday, setStepsToday] = useState<number>(0);
  const stepsGoal = userGoals.stepsGoal ?? 8000;
  const [stepInput, setStepInput] = useState('');
  const [savingSteps, setSavingSteps] = useState(false);

  const arc = (r: number, val: number) => {
    const c = 2 * Math.PI * r;
    return { dasharray: c, dashoffset: c * (1 - Math.min(1, Math.max(0, val))) };
  };

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      try {
        const [sessSnap, tSnap] = await Promise.all([
          getDocs(query(collection(db, 'users', user.uid, 'workoutSessions'), orderBy('date', 'desc'), limit(20))),
          getDocs(collection(db, 'users', user.uid, 'workoutTemplates')),
        ]);
        const fetchedSessions = sessSnap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession));
        setSessions(fetchedSessions);
        setCustomWorkouts(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as CustomWorkout)));
        setWorkedOutToday(fetchedSessions.some(s => s.date === todayStr()));

        // AI recommendation — runs after UI is unblocked
        const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
        const profile = profileSnap.exists() ? profileSnap.data() : {};
        getTodayRecommendations(user.uid, fetchedSessions, profile, []).then(recs => {
          setTodayRecommendations(recs);
          setRecommendationsLoading(false);
        });

        // Goal status strip — race plan takes precedence over goalPlans
        Promise.all([getActiveRacePlan(user.uid), getActiveGoalPlan(user.uid)]).then(([race, goal]) => {
          setActiveRacePlan(race);
          setActiveGoalPlan(goal);
        });

        // ensureDefaultHabits is cached after first call — fast on repeat visits
        const defaultHabits = await ensureDefaultHabits(user.uid);
        const stepsHabit = defaultHabits['steps'];
        if (stepsHabit) {
          setStepsHabitId(stepsHabit.id);
          // stepsGoal now comes from useGoals — no local state write needed
          const val = await getHabitLogToday(user.uid, stepsHabit.id);
          setStepsToday(val);
          setStepInput(String(val));
        }

      } catch (e) {
        console.error('Error fetching data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Week view — pure read against the active plan; peek one week ahead to know
  // whether the Next arrow should be enabled.
  useEffect(() => {
    if (!user) return;
    Promise.all([
      getWeekSchedule(user.uid, weekOffset),
      getWeekSchedule(user.uid, weekOffset + 1),
    ]).then(([current, next]) => {
      setWeekSchedule(current);
      setNextWeekAvailable(!!next && next.length > 0);
    });
  }, [user, weekOffset]);

  // ── Save steps ─────────────────────────────────────────────────────────
  const saveSteps = async (val: number) => {
    if (!user || !stepsHabitId || val < 0) return;
    setSavingSteps(true);
    try {
      await setHabitLogToday(user.uid, stepsHabitId, val);
      setStepsToday(val);
    } catch (e) { console.error('Error saving steps:', e); }
    finally { setSavingSteps(false); }
  };

  // ── AI context builder ─────────────────────────────────────────────────
  const buildContext = async (): Promise<string> => {
    if (!user) return '';
    const parts: string[] = [];
    try {
      const profileDoc = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
      if (profileDoc.exists()) {
        const p = profileDoc.data() as any;
        const pp = [
          p.primaryGoal && `Goal: ${p.primaryGoal}`,
          p.fitnessFocus?.length && `Fitness focus: ${p.fitnessFocus.join(', ')}`,
          p.fitnessTarget && `Target: ${p.fitnessTarget}`,
          p.activityLevel && `Activity level: ${p.activityLevel}`,
        ].filter(Boolean);
        if (pp.length) parts.push('Profile:\n' + pp.join('\n'));
      }
    } catch {}

    // Last 3 sessions summary
    if (sessions.length > 0) {
      const recent = sessions.slice(0, 3).map(s => {
        if (s.type === 'running') return `${s.date}: Running ${s.distanceKm ?? '?'}km`;
        const exSummary = (s.exercises || []).slice(0, 3).map(ex => {
          const best = ex.sets.reduce((b, c) => c.weight > b.weight ? c : b, ex.sets[0]);
          return `${ex.name} ${best?.weight ?? 0}kg×${best?.reps ?? 0}`;
        }).join(', ');
        return `${s.date}: ${s.template} — ${exSummary}`;
      });
      parts.push('Recent sessions:\n' + recent.join('\n'));
    }

    try {
      const bodySnap = await getDocs(query(collection(db, 'users', user.uid, 'bodyComp'), orderBy('date', 'desc'), limit(1)));
      if (!bodySnap.empty) {
        const b = bodySnap.docs[0].data();
        parts.push(`Body: ${b.weightKg ?? '?'}kg, ${b.pbf ?? '?'}% BF, SMM ${b.smm ?? '?'}kg`);
      }
    } catch {}

    return parts.join('\n');
  };

  const fetchLastSessionByTemplate = async (template: string): Promise<WorkoutSession | null> => {
    if (!user) return null;
    try {
      const match = sessions.find(s =>
        s.type !== 'running' &&
        s.template?.toLowerCase().includes(template.toLowerCase()) &&
        s.exercises && s.exercises.length > 0
      );
      if (match) return match;

      const snap = await getDocs(
        query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(20)
        )
      );
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession));
      return all.find(s =>
        s.type !== 'running' &&
        s.template?.toLowerCase().includes(template) &&
        s.exercises && s.exercises.length > 0
      ) || null;
    } catch {
      return null;
    }
  };

  // ── Detect if user is logging a completed activity ─────────────────────
  const isLoggingActivity = (input: string): boolean => {
    const lower = input.toLowerCase();
    const logPatterns = ['i did', 'i went', 'i ran', 'i walked', 'i cycled', 'i completed',
      'just did', 'just finished', 'finished', 'done with', 'did a', 'did my',
      'went for', 'had a', 'completed'];
    return logPatterns.some(p => lower.includes(p));
  };

  const detectWorkoutTemplate = (input: string): string | null => {
    const lower = input.toLowerCase();
    if (lower.includes('push') || lower.includes('chest') || lower.includes('tricep') || lower.includes('shoulder')) return 'push';
    if (lower.includes('pull') || lower.includes('back') || lower.includes('bicep') || lower.includes('lat')) return 'pull';
    if (lower.includes('leg') || lower.includes('squat') || lower.includes('quad') || lower.includes('hamstring') || lower.includes('glute')) return 'legs';
    if (lower.includes('upper')) return 'upper';
    if (lower.includes('lower')) return 'lower';
    if (lower.includes('full body') || lower.includes('fullbody')) return 'fullbody';
    return null;
  };

  const isProvidingDetails = (input: string): boolean => {
    const lower = input.toLowerCase();
    return /\d+\s*(kg|lbs|reps|sets|x|\×)/.test(lower) ||
      lower.includes('bench') || lower.includes('squat') || lower.includes('deadlift') ||
      lower.includes('press') || lower.includes('curl') || lower.includes('row') ||
      lower.includes('sets') || lower.includes('reps') || lower.includes('weights');
  };

  // ── Log a quick activity to Firestore ──────────────────────────────────
  const logQuickActivity = async (activityName: string, activityType: string, durationMins?: number, distanceKm?: number) => {
    if (!user) return;
    try {
      const sessionData = cleanData({
        date: todayStr(),
        template: activityType,
        type: activityType === 'running' || activityType === 'walk' || activityType === 'cycling' ? 'running' : 'workout',
        notes: activityName,
        durationMins: durationMins || null,
        distanceKm: distanceKm || null,
        exercises: [],
        createdAt: serverTimestamp(),
      });
      const ref = await addDoc(collection(db, 'users', user.uid, 'workoutSessions'), sessionData);
      const newSession = { id: ref.id, ...sessionData } as WorkoutSession;
      setSessions(prev => [newSession, ...prev]);
      await bumpDataVersion(user.uid);
    } catch (e) {
      console.error('Error logging activity:', e);
    }
  };

  // ── Main AI chat send ──────────────────────────────────────────────────
  const sendChat = async (inputOverride?: string) => {
    const input = (inputOverride ?? chatInput).trim();
    if (!input || !user) return;

    // If user is providing details for a pending strength activity
    if (pendingActivity && isProvidingDetails(input)) {
      setChatInput('');
      setChatLoading(true);
      const userMsg: ChatMessage = { role: 'user', text: input };
      setChatMessages(prev => [...prev, userMsg]);

      try {
        const context = await buildContext();
        const pendingActivityPrompt = `The user just completed a ${pendingActivity.name} workout and described these exercises: "${input}"

Parse the exercises they mentioned and return a workout plan JSON. If weights aren't mentioned, use sensible defaults based on this context:
${context}

Return ONLY this JSON, no other text:
{"plan":[{"exercise":"Name","sets":3,"reps":10,"suggestedWeight":60,"lastWeight":0}]}`;

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
        //     max_tokens: 600,
        //     messages: [{ role: 'user', content: pendingActivityPrompt }],
        //   }),
        // });
        // if (!response.ok) throw new Error('API failed');
        // const data = await response.json();

        const { text: pendingActivityResult } = await callAI({
          model: 'gemini-flash-lite-latest',
          contents: pendingActivityPrompt,
          maxTokens: 600,
          thinkingBudget: 0,
        });
        let plan: AIPlanExercise[] = [];
        try {
          const parsed = JSON.parse(pendingActivityResult || '{}');
          plan = parsed.plan || [];
        } catch {}

        if (plan.length > 0) {
          const aiMsg: ChatMessage = {
            role: 'ai',
            text: `Got it! Here's your ${pendingActivity.name} session — tap "Log This Session" to save it with all the details.`,
            plan,
            logged: false,
          };
          setChatMessages(prev => [...prev, aiMsg]);
          setPendingActivity(null);
        } else {
          await logQuickActivity(pendingActivity.name, pendingActivity.type, pendingActivity.durationMins);
          setChatMessages(prev => [...prev, { role: 'ai', text: 'Logged! Keep it up 💪' }]);
          setPendingActivity(null);
        }
      } catch (e) {
        console.error(e);
        setChatMessages(prev => [...prev, { role: 'ai', text: 'Something went wrong. Try again.' }]);
      } finally {
        setChatLoading(false);
      }
      return;
    }

    setChatInput('');
    setChatLoading(true);

    // Add user message
    const userMsg: ChatMessage = { role: 'user', text: input };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const context = await buildContext();
      const isLogging = isLoggingActivity(input);

      // If strength workout detected, skip normal AI flow entirely
      const detectedTemplate = detectWorkoutTemplate(input);
      const isCardioInput = ['run','walk','cycl','yoga','meditat','swim'].some(k => input.toLowerCase().includes(k));
      if (isLogging && detectedTemplate && !isCardioInput) {
        const durationMatch = input.match(/(\d+)\s*min/i);
        const durationMins = durationMatch ? parseInt(durationMatch[1]) : undefined;
        const lastSession = await fetchLastSessionByTemplate(detectedTemplate);

        if (lastSession && lastSession.exercises && lastSession.exercises.length > 0) {
          const plan: AIPlanExercise[] = lastSession.exercises.map(ex => {
            const bestSet = ex.sets.reduce((b, c) => c.weight > b.weight ? c : b, ex.sets[0]);
            return {
              exercise: ex.name,
              sets: ex.sets.length,
              reps: bestSet?.reps ?? 10,
              suggestedWeight: bestSet?.weight ?? 0,
              lastWeight: bestSet?.weight ?? 0,
            };
          });
          const lastDate = new Date(lastSession.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          setChatMessages(prev => [...prev, {
            role: 'ai',
            text: `Here's your last ${detectedTemplate} session from ${lastDate}. Same weights pre-filled — tap to log as-is or update anything before saving.`,
            plan,
            logged: false,
            loggedActivity: input,
          }]);
          setPendingActivity({ name: detectedTemplate + ' day', type: 'workout', template: detectedTemplate, durationMins });
        } else {
          setChatMessages(prev => [...prev, {
            role: 'ai',
            text: `No previous ${detectedTemplate} session found. Tell me what you did and I'll log it.`,
          }]);
        }
        setChatLoading(false);
        return;
      }

      // Build conversation history for multi-turn
      const history = chatMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text + (m.plan ? `\n[Plan: ${JSON.stringify(m.plan)}]` : ''),
      }));

      const systemPrompt = isLogging
        ? `You are a fitness coach. The user is logging a completed activity. 
Parse what they did, confirm it's logged, and suggest what to add (e.g. if they walked, suggest some strength or if they did chest suggest adding shoulders).
If they didn't share exercise details (weights/reps), ask them to share for better tracking.

Context:
${context}

Respond in this format:
<logged>brief activity description e.g. "20 min brisk walk"</logged>
<response>Your friendly 1-2 sentence response acknowledging what they did and either asking for details or suggesting additions.</response>
<suggest_plan>true or false — suggest a complementary workout plan?</suggest_plan>
${isLogging ? '<plan>{"plan":[]} // empty if no plan, or include exercises if suggesting complementary workout</plan>' : ''}`
        : `You are a personal fitness coach. The user is asking for a workout plan or advice.

Context:
${context}

Previous conversation context is provided in the messages.

Respond with:
<intro>One sentence acknowledging their request or referencing their history.</intro>
<plan>{"plan":[{"exercise":"Name","sets":3,"reps":8,"suggestedWeight":80,"lastWeight":75}]}</plan>

Rules:
- 3-6 exercises for the muscle group
- Time constraints: keep to 4 exercises max if <30 mins
- suggestedWeight: ~2.5kg more than lastWeight if data exists, else sensible default
- lastWeight 0 means no data
- For cardio/yoga/other non-weight: return empty plan array and put details in intro`;

      // chatMessages never starts with an 'ai'-role turn (state starts empty,
      // first entry pushed is always the user's), so unlike AICoach.tsx's
      // main chat, no leading-turn stripping is needed here before mapping
      // roles to Gemini's 'user'/'model' shape.
      const geminiContents: ContentTurn[] = [
        ...history.map(m => ({
          role: m.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        })),
        { role: 'user' as const, parts: [{ text: input }] },
      ];

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
      //     max_tokens: 800,
      //     system: systemPrompt,
      //     messages: [...history, { role: 'user', content: input }],
      //   }),
      // });
      // if (!response.ok) throw new Error('API failed');
      // const data = await response.json();
      // const text = data.content?.[0]?.text || '';

      const { text: callResult } = await callAI({
        model: 'gemini-flash-latest',
        systemInstruction: systemPrompt,
        contents: geminiContents,
        maxTokens: 800,
        thinkingBudget: 0,
      });
      const text = callResult || '';

      if (isLogging) {
        // Parse logging response
        const loggedMatch = text.match(/<logged>([\s\S]*?)<\/logged>/);
        const responseMatch = text.match(/<response>([\s\S]*?)<\/response>/);
        const suggestMatch = text.match(/<suggest_plan>([\s\S]*?)<\/suggest_plan>/);
        const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);

        const loggedActivity = loggedMatch?.[1]?.trim() || input;
        const responseText = responseMatch?.[1]?.trim() || 'Logged!';
        const shouldSuggest = suggestMatch?.[1]?.trim() === 'true';

        let plan: AIPlanExercise[] = [];
        if (shouldSuggest && planMatch) {
          try {
            const parsed = JSON.parse(planMatch[1].trim());
            plan = parsed.plan || [];
          } catch {}
        }

        const activityType = input.toLowerCase().includes('run') ? 'running'
          : input.toLowerCase().includes('walk') ? 'walk'
          : input.toLowerCase().includes('cycl') ? 'cycling'
          : input.toLowerCase().includes('yoga') ? 'yoga'
          : input.toLowerCase().includes('meditat') ? 'meditation'
          : 'workout';

        const durationMatch = input.match(/(\d+)\s*min/i);
        const durationMins = durationMatch ? parseInt(durationMatch[1]) : undefined;
        const distMatch = input.match(/(\d+\.?\d*)\s*km/i);
        const distanceKm = distMatch ? parseFloat(distMatch[1]) : undefined;

        const isCardio = ['running', 'walk', 'cycling', 'yoga', 'meditation'].includes(activityType);

        if (isCardio) {
          await logQuickActivity(loggedActivity, activityType, durationMins, distanceKm);
          const aiMsg: ChatMessage = {
            role: 'ai',
            text: responseText,
            logged: true,
            loggedActivity,
            plan: plan.length > 0 ? plan : undefined,
          };
          setChatMessages(prev => [...prev, aiMsg]);
        } else {
          setPendingActivity({ name: loggedActivity, type: activityType, template: activityType, durationMins });
          const aiMsg: ChatMessage = {
            role: 'ai',
            text: responseText,
            askForDetails: true,
            logged: false,
          };
          setChatMessages(prev => [...prev, aiMsg]);
        }

      } else {
        // Parse plan response
        const introMatch = text.match(/<intro>([\s\S]*?)<\/intro>/);
        const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);

        let plan: AIPlanExercise[] = [];
        if (planMatch) {
          try {
            const parsed = JSON.parse(planMatch[1].trim());
            plan = parsed.plan || [];
          } catch {}
        }

        const aiMsg: ChatMessage = {
          role: 'ai',
          text: introMatch?.[1]?.trim() || text.slice(0, 200),
          plan: plan.length > 0 ? plan : undefined,
        };
        setChatMessages(prev => [...prev, aiMsg]);
      }
    } catch (e) {
      console.error('AI chat error:', e);
      setChatMessages(prev => [...prev, { role: 'ai', text: 'Something went wrong. Try again.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const startFromAIPlan = (plan: AIPlanExercise[]) => {
    const exercises = plan.map(item => ({
      name: item.exercise,
      sets: Array.from({ length: item.sets }, () => ({ reps: item.reps, weight: item.suggestedWeight })),
    }));
    navigate('/workout-session', {
      state: {
        template: 'custom',
        customWorkout: { name: 'AI Plan', exercises: exercises.map(e => ({ name: e.name, category: 'custom', defaultSets: e.sets.length })) },
        aiExercises: exercises,
      },
    });
  };

  // ── Workout library handlers ───────────────────────────────────────────
  const startWorkoutFromLibrary = (type: string) => {
    if (type === 'running' || type === 'walk' || type === 'cycling') {
      navigate('/running-session');
    } else {
      navigate('/workout-session', { state: { template: type } });
    }
  };

  // Rest days are informational only — no session to start.
  const startFromRecommendation = (rec: TaggedRecommendation) => {
    if (rec.source === 'gym') { startWorkoutFromLibrary(rec.type); return; }
    if (rec.type === 'rest') return;
    // 'race' isn't a loggable EffortType (closest real effort is tempo); a generic
    // rhythm-based 'running' pick has no specific effort assigned, default to recovery.
    const effortType: EffortType = rec.type === 'race' ? 'tempo' : rec.type === 'running' ? 'recovery' : rec.type as EffortType;
    navigate('/running-session', { state: { effortType } });
  };

  // ── Custom workout handlers ────────────────────────────────────────────
  const openCreateModal = () => { setEditingWorkout(null); setWorkoutName(''); setSelectedExercises([]); setShowCreateModal(true); };
  const openEditModal = (w: CustomWorkout) => { setEditingWorkout(w); setWorkoutName(w.name); setSelectedExercises(w.exercises); setShowCreateModal(true); };
  const closeCreateModal = () => { setShowCreateModal(false); setEditingWorkout(null); setWorkoutName(''); setSelectedExercises([]); };

  const deleteWorkout = async (w: CustomWorkout) => {
    if (!user || !w.id) return;
    if (!window.confirm(`Delete "${w.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'workoutTemplates', w.id));
      setCustomWorkouts(prev => prev.filter(x => x.id !== w.id));
    } catch (e) { alert('Failed to delete'); }
  };

  const startSavedWorkout = (templateType: string, customId?: string) => {
    if (customId) {
      const workout = customWorkouts.find(w => w.id === customId);
      navigate('/workout-session', { state: { template: templateType, customWorkout: workout } });
    } else {
      navigate('/workout-session', { state: { template: templateType } });
    }
  };

  const getSessionStats = (session: WorkoutSession) => {
    if (session.type === 'running') return { exerciseCount: 0, totalSets: 0, isRunning: true };
    const validExercises = session.exercises?.filter(ex =>
      ex.sets?.some((s: any) => (parseInt(String(s.reps)) || 0) > 0)
    ) || [];
    const totalSets = validExercises.reduce((sum, ex) =>
      sum + ex.sets.filter((s: any) => (parseInt(String(s.reps)) || 0) > 0).length, 0
    );
    return { exerciseCount: validExercises.length, totalSets, isRunning: false };
  };

  const saveSessionField = async (field: string, value: any) => {
    if (!user || !selectedSession) return;
    setSavingSessionField(true);
    try {
      await updateDoc(doc(db, 'users', user.uid, 'workoutSessions', selectedSession.id), { [field]: value });
      setSessions(prev => prev.map(s => s.id === selectedSession.id ? { ...s, [field]: value } : s));
      setSelectedSession(prev => prev ? { ...prev, [field]: value } : prev);
    } catch (e) { console.error('Failed to save:', e); }
    finally { setSavingSessionField(false); }
  };

  const getExerciseOneRMHistory = (exerciseName: string): OneRMData[] => {
    return sessions.filter(s => s.type !== 'running').map(s => {
      const ex = s.exercises?.find(e => e.name === exerciseName);
      if (!ex || ex.sets.length === 0) return null;
      const best = ex.sets.reduce((b, c) => calculateOneRM(c.weight, c.reps) > calculateOneRM(b.weight, b.reps) ? c : b);
      return { date: s.date, oneRM: calculateOneRM(best.weight, best.reps) };
    }).filter(Boolean).sort((a, b) => new Date(a!.date).getTime() - new Date(b!.date).getTime()) as OneRMData[];
  };

  const renderOneRMChart = (exerciseName: string) => {
    const data = getExerciseOneRMHistory(exerciseName);
    if (data.length < 2) return null;
    const max = Math.max(...data.map(d => d.oneRM));
    const min = Math.min(...data.map(d => d.oneRM));
    const range = max - min || 1;
    return (
      <div className="mt-4 p-3 bg-slate-800 rounded-lg">
        <div className="text-xs text-emerald-400 font-medium mb-2">Estimated 1RM trend</div>
        <div className="h-12 flex items-end space-x-1">
          {data.map((d, i) => (
            <div key={i} className="flex-1 bg-emerald-500 rounded-t" style={{ height: `${((d.oneRM - min) / range) * 80 + 20}%` }} title={`${d.oneRM.toFixed(1)} kg`} />
          ))}
        </div>
      </div>
    );
  };

  const filteredExercises = EXERCISE_LIBRARY.filter(ex =>
    ex.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (filterCategory === 'all' || ex.category === filterCategory)
  );

  const toggleExercise = (ex: ExerciseItem) => {
    const exists = selectedExercises.find(e => e.name === ex.name);
    if (exists) setSelectedExercises(prev => prev.filter(e => e.name !== ex.name));
    else setSelectedExercises(prev => [...prev, { name: ex.name, category: ex.category, defaultSets: 3 }]);
  };

  const moveExercise = (index: number, dir: 'up' | 'down') => {
    const arr = [...selectedExercises];
    const swap = dir === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= arr.length) return;
    [arr[index], arr[swap]] = [arr[swap], arr[index]];
    setSelectedExercises(arr);
  };

  const saveWorkout = async () => {
    if (!user || !workoutName.trim() || selectedExercises.length === 0) return;
    setIsSavingWorkout(true);
    try {
      if (editingWorkout?.id) {
        await updateDoc(doc(db, 'users', user.uid, 'workoutTemplates', editingWorkout.id), cleanData({ name: workoutName.trim(), exercises: selectedExercises }));
        setCustomWorkouts(prev => prev.map(w => w.id === editingWorkout.id ? { ...w, name: workoutName.trim(), exercises: selectedExercises } : w));
      } else {
        const ref = await addDoc(collection(db, 'users', user.uid, 'workoutTemplates'), cleanData({ name: workoutName.trim(), exercises: selectedExercises, createdAt: serverTimestamp() }));
        setCustomWorkouts(prev => [...prev, { id: ref.id, name: workoutName.trim(), exercises: selectedExercises }]);
      }
      closeCreateModal();
    } catch (e) { alert('Failed to save workout'); }
    finally { setIsSavingWorkout(false); }
  };

  const weekLabel = weekOffset === 0
    ? 'This Week'
    : weekSchedule
      ? `${formatDateShort(weekSchedule[0].date)} – ${formatDateShort(weekSchedule[6].date)}`
      : 'This Week';

  if (loading) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <div className="p-5 space-y-4">
        <h1 className="text-2xl font-bold">Workouts</h1>

        {/* ── 2-RING HEADER ── */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-[72px] h-[72px]">
              <svg width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,55,95,0.14)" strokeWidth="8"/>
                <circle cx="36" cy="36" r="30" fill="none" stroke="#ff375f" strokeWidth="8"
                  strokeDasharray={arc(30, rings.train.pct/100).dasharray} strokeDashoffset={arc(30, rings.train.pct/100).dashoffset}
                  strokeLinecap="round" transform="rotate(-90 36 36)"/>
                <circle cx="36" cy="36" r="19" fill="none" stroke="rgba(48,209,88,0.14)" strokeWidth="8"/>
                <circle cx="36" cy="36" r="19" fill="none" stroke="#30d158" strokeWidth="8"
                  strokeDasharray={arc(19, rings.move.pct/100).dasharray} strokeDashoffset={arc(19, rings.move.pct/100).dashoffset}
                  strokeLinecap="round" transform="rotate(-90 36 36)"/>
              </svg>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              {[
                { label: 'Steps', pct: rings.train.pct, sub: rings.train.label, color: '#ff375f' },
                { label: 'Burned', pct: rings.move.pct, sub: rings.move.label, color: '#30d158' },
              ].map(({ label, pct, sub, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-medium text-white">{label}</span>
                      <span className="text-[10px] font-mono" style={{ color }}>{Math.round(pct)}%</span>
                    </div>
                    <div className="text-[9px] text-slate-500 truncate">{sub}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100,pct)}%`, background: color }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Steps stepper */}
          {/* Steps stepper — always shown, auto-creates habit if needed */}
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-3">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider flex-shrink-0">Steps today</span>
            <div className="flex items-center gap-2 flex-1 justify-end">
              <button onClick={() => { const v = Math.max(0, stepsToday - 1000); setStepInput(String(v)); saveSteps(v); }}
                className="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition-colors">−</button>
              <input type="number" value={stepInput} onChange={e => setStepInput(e.target.value)}
                onBlur={() => { const v = Math.max(0, parseInt(stepInput) || 0); setStepInput(String(v)); saveSteps(v); }}
                onKeyDown={e => { if (e.key === 'Enter') { const v = Math.max(0, parseInt(stepInput) || 0); setStepInput(String(v)); saveSteps(v); (e.target as HTMLInputElement).blur(); } }}
                className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs font-mono text-white focus:outline-none focus:border-emerald-500" />
              <button onClick={() => { const v = stepsToday + 1000; setStepInput(String(v)); saveSteps(v); }}
                className="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition-colors">+</button>
              {savingSteps
                ? <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                : <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">/ {stepsGoal.toLocaleString()}</span>}
            </div>
          </div>
        </div>

        {/* ── GOAL STATUS STRIP ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          {!activeRacePlan && !activeGoalPlan ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">No Goal or schedule set</span>
              <button onClick={() => navigate('/ai-coach?topic=goal')}
                className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors">
                Set Up →
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  {activeRacePlan
                    ? <Flag className="w-4 h-4 text-emerald-400" />
                    : activeGoalPlan?.type === 'performance_target'
                      ? <Target className="w-4 h-4 text-emerald-400" />
                      : <Repeat className="w-4 h-4 text-emerald-400" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {activeRacePlan
                      ? activeRacePlan.raceName
                      : activeGoalPlan?.type === 'performance_target'
                        ? (activeGoalPlan.bodyCompTarget
                            ? `${activeGoalPlan.bodyCompTarget.metric} → ${activeGoalPlan.bodyCompTarget.targetValue}`
                            : 'Performance Target')
                        : 'Your Routine'}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    {activeRacePlan
                      ? `${new Date(activeRacePlan.raceDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${activeRacePlan.targetFinishTime ? ` · Goal ${activeRacePlan.targetFinishTime}` : ` · ${activeRacePlan.totalWeeks}-week plan`}`
                      : activeGoalPlan?.daySplit
                        ? `${activeGoalPlan.daySplit.runDays} run · ${activeGoalPlan.daySplit.gymDays} gym / week`
                        : ''}
                  </div>
                </div>
              </div>
              <button onClick={() => navigate('/ai-coach?topic=goal', { state: { prefill: { activeRacePlan, activeGoalPlan } } })}
                className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors flex-shrink-0">
                ✎ Edit
              </button>
            </div>
          )}
        </div>

        {activeRacePlan && (
          <button onClick={() => navigate('/training-plan')}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between text-sm font-semibold text-white hover:border-slate-700 transition-colors">
            View training plan
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </button>
        )}

        {/* ── WEEK VIEW ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setWeekOffset(o => o - 1)} disabled={weekOffset === 0}
              className="text-slate-500 hover:text-white disabled:opacity-20 disabled:hover:text-slate-500 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{weekLabel}</span>
            <button onClick={() => setWeekOffset(o => o + 1)} disabled={!nextWeekAvailable}
              className="text-slate-500 hover:text-white disabled:opacity-20 disabled:hover:text-slate-500 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex justify-between gap-1.5">
            {weekSchedule ? weekSchedule.map(day => {
              const meta = RUN_TYPE_META[day.runType];
              const isToday = day.date === todayStr();
              const dayLetter = new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
              const Tag = activeRacePlan ? 'button' : 'div';
              return (
                <Tag key={day.date}
                  onClick={activeRacePlan ? () => navigate(`/training-plan?date=${day.date}`) : undefined}
                  className={`flex-1 flex flex-col items-center gap-1 rounded-lg py-2 ${day.runType === 'rest' ? 'bg-slate-800/50' : 'bg-emerald-500/10 border border-emerald-500/20'} ${activeRacePlan ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}>
                  <span className={`text-[9px] font-mono ${isToday ? 'text-white font-bold' : 'text-slate-500'}`}>{dayLetter}</span>
                  <span className="text-sm">{meta.emoji}</span>
                </Tag>
              );
            }) : Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 rounded-lg py-2 border border-dashed border-slate-800">
                <span className="text-[9px] font-mono text-slate-700">
                  {['M','T','W','T','F','S','S'][i]}
                </span>
                <span className="text-sm text-slate-700">—</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── AI PLANNER — multi-turn chat ── */}
        <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 to-transparent" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono text-emerald-400 tracking-wider uppercase">AI Coach</span>
              {chatMessages.length > 0 && (
                <button onClick={() => { setChatMessages([]); setPendingActivity(null); }} className="ml-auto text-[9px] font-mono text-slate-600 hover:text-slate-400">clear</button>
              )}
            </div>

            {/* Chat messages */}
            {chatMessages.length > 0 && (
              <div className="space-y-3 mb-3 max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'user' ? (
                      <div className="bg-emerald-500/15 border border-emerald-500/20 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[80%]">
                        <p className="text-xs text-emerald-100">{msg.text}</p>
                      </div>
                    ) : (
                      <div className="flex-1 space-y-2">
                        {/* Logged badge */}
                        {msg.logged && msg.loggedActivity && (
                          <div className="flex items-center gap-1.5 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-1.5">
                            <span className="text-[10px] text-emerald-400">✓ Logged:</span>
                            <span className="text-[10px] font-medium text-white">{msg.loggedActivity}</span>
                          </div>
                        )}
                        {/* AI text */}
                        <p className="text-xs text-slate-300 leading-relaxed">{msg.text}</p>
                        {/* Plan if present */}
                        {msg.plan && msg.plan.length > 0 && (
                          <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                            <div className="flex justify-between items-center px-3 py-2 border-b border-slate-700">
                              <span className="text-[10px] font-semibold text-emerald-400">⚡ Suggested Plan</span>
                              <span className="text-[9px] font-mono text-slate-500">{msg.plan.length} exercises</span>
                            </div>
                            {msg.plan.map((item, j) => (
                              <div key={j} className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 last:border-0">
                                <div>
                                  <div className="text-xs font-medium text-white">{item.exercise}</div>
                                  <div className="text-[9px] text-slate-500">{item.sets} × {item.reps} reps</div>
                                </div>
                                <div className="text-right font-mono">
                                  <div className="text-xs text-emerald-400">→ {item.suggestedWeight}kg</div>
                                  {item.lastWeight > 0 && <div className="text-[9px] text-slate-600">last: {item.lastWeight}kg</div>}
                                </div>
                              </div>
                            ))}
                            <div className="p-2.5 border-t border-slate-700">
                              {msg.loggedActivity !== undefined ? (
                                <button
                                  onClick={() => {
                                    const exercises = msg.plan!.map(item => ({
                                      name: item.exercise,
                                      sets: Array.from({ length: item.sets }, () => ({ reps: item.reps, weight: item.suggestedWeight })),
                                    }));
                                    navigate('/workout-session', {
                                      state: {
                                        template: pendingActivity?.template || 'custom',
                                        aiExercises: exercises,
                                        customWorkout: { name: (pendingActivity?.name || 'Workout'), exercises: exercises.map(e => ({ name: e.name, category: 'custom', defaultSets: e.sets.length })) },
                                        durationMins: pendingActivity?.durationMins,
                                      },
                                    });
                                    setPendingActivity(null);
                                  }}
                                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors">
                                  ✅ Looks right? Log it →
                                </button>
                              ) : (
                                <button onClick={() => startFromAIPlan(msg.plan!)}
                                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors">
                                  🏋️ Start This Workout
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 bg-slate-800 rounded-2xl rounded-tl-sm px-3 py-2">
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Empty state prompt */}
            {chatMessages.length === 0 && (
              <p className="text-sm font-medium text-white mb-3">
                {sessions.length > 0 ? `Last session: ${sessions[0].template} on ${sessions[0].date}` : "What's your workout today?"}
              </p>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder={chatMessages.length === 0
                  ? '"legs 30 mins" or "I did a 20 min walk"'
                  : 'Reply...'}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => sendChat()}
                disabled={chatLoading || !chatInput.trim()}
                className="w-9 h-9 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
              >
                {chatLoading
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-4 h-4 text-white" />}
              </button>
            </div>

            {/* Quick chips — only when no conversation yet */}
            {chatMessages.length === 0 && (
              <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                {[
                  { label: '🦵 Legs · 30m', prompt: 'legs today, only 30 minutes' },
                  { label: '💪 Push · intense', prompt: 'push day, want to go hard' },
                  { label: '🏋️ Pull day', prompt: 'pull day' },
                  { label: '⚡ Quick full body', prompt: 'quick full body, 20 minutes' },
                  { label: '🏃 Running', prompt: 'going for a run today, 5km easy' },
                ].map(chip => (
                  <button key={chip.label} onClick={() => sendChat(chip.prompt)}
                    className="flex-shrink-0 text-[10px] px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors">
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── TODAY'S RECOMMENDATION + WORKOUT LIBRARY ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {workedOutToday ? (
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎉</span>
                <div>
                  <div className="text-sm font-semibold text-white">Workout done for today!</div>
                  <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                    {sessions[0]?.template} · Great work 💪
                  </div>
                </div>
              </div>
              <button onClick={() => setLibraryExpanded(e => !e)}
                className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                {libraryExpanded ? 'Close' : 'All workouts'}
                {libraryExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          ) : (
            <div className="p-4 border-b border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Today's Pick</span>
                <button onClick={() => setLibraryExpanded(e => !e)}
                  className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                  {libraryExpanded ? 'Close' : 'All workouts'}
                  {libraryExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
              {!recommendationsLoading ? (
                todayRecommendations.length > 0 ? (
                  <div className="divide-y divide-slate-800">
                    {todayRecommendations.map((rec, i) => (
                      <div key={i} className={`flex items-center justify-between ${i > 0 ? 'pt-3 mt-3' : ''}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{rec.emoji}</span>
                          <div>
                            <div className="text-sm font-semibold text-white">{rec.title}</div>
                            {rec.subtitle && <div className="text-[10px] text-slate-500">{rec.subtitle}</div>}
                            {rec.reason && (
                              <div className="text-[10px] text-slate-500 italic mt-0.5">{rec.reason}</div>
                            )}
                          </div>
                        </div>
                        {rec.type !== 'rest' && (
                          <button
                            onClick={() => startFromRecommendation(rec)}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                            Start
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No recommendation available right now.</p>
                )
              ) : (
                <div className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-slate-800 rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-800 rounded w-24" />
                    <div className="h-2 bg-slate-800 rounded w-36" />
                  </div>
                  <div className="w-14 h-8 bg-slate-800 rounded-lg" />
                </div>
              )}
            </div>
          )}

          {/* Expandable library */}
          {libraryExpanded && (
            <div>
              {/* Tabs */}
              <div className="flex border-b border-slate-800">
                {LIBRARY_TABS.map(tab => (
                  <button key={tab.key} onClick={() => setLibraryTab(tab.key)}
                    className={`flex-1 py-2.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                      libraryTab === tab.key
                        ? 'text-emerald-400 border-b border-emerald-400'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Library items */}
              <div className="p-3 grid grid-cols-2 gap-2">
                {WORKOUT_LIBRARY[libraryTab].map(workout => (
                  <button key={workout.type} onClick={() => startWorkoutFromLibrary(workout.type)}
                    className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-left hover:border-slate-600 hover:bg-slate-750 transition-colors">
                    <div className="text-xl mb-1">{workout.emoji}</div>
                    <div className="text-xs font-semibold text-white">{workout.title}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{workout.subtitle}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── MY SAVED WORKOUTS ── */}
        {customWorkouts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">My Workouts</h2>
              <button onClick={openCreateModal} className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
            <div className="space-y-2">
              {customWorkouts.map(w => (
                <div key={w.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center">
                  <button className="flex items-center gap-3 flex-1 text-left" onClick={() => startSavedWorkout('custom', w.id)}>
                    <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Dumbbell className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{w.name}</div>
                      <div className="text-[9px] text-slate-500 truncate">
                        {w.exercises.slice(0, 3).map(e => e.name).join(' · ')}{w.exercises.length > 3 ? ` +${w.exercises.length - 3}` : ''}
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => openEditModal(w)} className="text-slate-600 hover:text-emerald-400 p-1.5"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteWorkout(w)} className="text-slate-600 hover:text-red-400 p-1.5"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create button if no saved workouts */}
        {customWorkouts.length === 0 && (
          <button onClick={openCreateModal}
            className="w-full border border-dashed border-slate-700 rounded-xl py-3 text-[10px] font-mono text-slate-600 hover:text-slate-400 hover:border-slate-600 transition-colors flex items-center justify-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Create custom workout
          </button>
        )}

        {/* ── RECENT SESSIONS ── */}
        <div>
          <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3">Recent Sessions</h2>
          {sessions.length > 0 ? (
            <div className="space-y-2">
              {/* Always show last session expanded-ish */}
              {sessions.slice(0, showPrevSessions ? 5 : 1).map((session, idx) => {
                const stats = getSessionStats(session);
                return (
                  <div key={session.id} className={`bg-slate-900 border rounded-xl overflow-hidden transition-colors ${idx === 0 ? 'border-slate-700' : 'border-slate-800'}`}>
                    <button onClick={() => setSelectedSession(session)} className="w-full text-left p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          {stats.isRunning
                            ? <Activity className="w-4 h-4 text-green-400" />
                            : <Dumbbell className="w-4 h-4 text-slate-500" />}
                          <span className="text-xs font-semibold text-white capitalize">{session.template}</span>
                          {idx === 0 && <span className="text-[8px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">Latest</span>}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(session.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      {stats.isRunning ? (
                        <div className="text-[10px] text-slate-400 font-mono">
                          {session.distanceKm ?? '--'}km · {session.durationMins ?? '--'}min
                          {session.paceMinPerKm ? ` · ${Math.floor(session.paceMinPerKm)}:${String(Math.round((session.paceMinPerKm % 1) * 60)).padStart(2,'0')} /km` : ''}
                          {(session as any).caloriesBurned > 0 && (
                            <span className="ml-2 text-orange-400/70">· {(session as any).caloriesBurned} kcal</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400 font-mono">
                          {stats.exerciseCount} exercises · {stats.totalSets} sets
                          {session.durationMins != null && session.durationMins > 0 && (
                            <span className="ml-2 text-emerald-500/70">
                              · {Math.floor(session.durationMins)}m{Math.round((session.durationMins % 1) * 60) > 0 ? ` ${Math.round((session.durationMins % 1) * 60)}s` : ''}
                            </span>
                          )}
                          {(session as any).caloriesBurned > 0 && (
                            <span className="ml-2 text-orange-400/70">· {(session as any).caloriesBurned} kcal</span>
                          )}
                          {session.notes && <span className="ml-2 text-slate-600">{session.notes.slice(0, 30)}</span>}
                        </div>
                      )}
                    </button>
                    <div className="flex justify-end gap-1 px-2 py-1.5 border-t border-slate-800">
                      {!stats.isRunning && (
                        <button onClick={e => { e.stopPropagation(); navigate('/workout-session', { state: { template: session.template, editSession: session } }); }}
                          className="text-slate-600 hover:text-blue-400 p-2 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={e => { e.stopPropagation(); setPosterSession(session); }}
                        className="text-slate-500 hover:text-emerald-400 p-2 transition-colors">
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete?')) { deleteDoc(doc(db, 'users', user!.uid, 'workoutSessions', session.id)); setSessions(s => s.filter(x => x.id !== session.id)); } }}
                        className="text-slate-600 hover:text-red-400 p-2 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Show previous toggle */}
              {sessions.length > 1 && (
                <div className="flex items-center justify-between">
                  <button onClick={() => setShowPrevSessions(e => !e)}
                    className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 flex items-center gap-1.5 transition-colors py-1">
                    {showPrevSessions
                      ? <><ChevronUp className="w-3 h-3" /> Hide</>
                      : <><ChevronDown className="w-3 h-3" /> Last 5 sessions</>}
                  </button>
                  <button onClick={() => navigate('/activity-calendar')}
                    className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors py-1">
                    Full history →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <Clock className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-sm font-semibold text-white mb-1">No sessions yet</p>
              <p className="text-xs text-slate-500">Start your first workout above</p>
            </div>
          )}
        </div>
      </div>

      {/* ── SESSION DETAIL MODAL ── */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-base font-bold text-white capitalize">{selectedSession.template}</h2>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(selectedSession.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                  </div>
                </div>
                <button onClick={() => { setSelectedSession(null); setEditingCalories(false); setEditingDuration(false); }} className="text-slate-500 hover:text-white p-1"><X className="w-5 h-5" /></button>
              </div>

              {/* Duration + Calories editable row */}
              {selectedSession.type !== 'running' && (
                <div className="flex gap-2 mb-4">
                  {/* Duration */}
                  <div className="flex-1 bg-slate-800 rounded-xl p-3">
                    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">Duration</div>
                    {editingDuration ? (
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" value={durationMinsInput}
                          onChange={e => setDurationMinsInput(e.target.value)}
                          className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-white text-xs text-center focus:outline-none focus:border-emerald-500" />
                        <span className="text-[10px] text-slate-500">m</span>
                        <input type="number" min="0" max="59" value={durationSecsInput}
                          onChange={e => setDurationSecsInput(e.target.value)}
                          className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-white text-xs text-center focus:outline-none focus:border-emerald-500" />
                        <span className="text-[10px] text-slate-500">s</span>
                        <button
                          onClick={async () => {
                            const val = (parseInt(durationMinsInput) || 0) + (parseInt(durationSecsInput) || 0) / 60;
                            await saveSessionField('durationMins', val);
                            setEditingDuration(false);
                          }}
                          disabled={savingSessionField}
                          className="ml-1 text-emerald-400 hover:text-emerald-300 text-xs font-mono disabled:opacity-50">
                          {savingSessionField ? '…' : '✓'}
                        </button>
                        <button onClick={() => setEditingDuration(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white font-mono">
                          {(selectedSession as any).durationMins > 0
                            ? `${Math.floor((selectedSession as any).durationMins)}m ${Math.round(((selectedSession as any).durationMins % 1) * 60)}s`
                            : '—'}
                        </span>
                        <button onClick={() => {
                          const d = (selectedSession as any).durationMins || 0;
                          setDurationMinsInput(String(Math.floor(d)));
                          setDurationSecsInput(String(Math.round((d % 1) * 60)));
                          setEditingDuration(true);
                        }} className="text-slate-500 hover:text-emerald-400 transition-colors">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Calories */}
                  <div className="flex-1 bg-slate-800 rounded-xl p-3">
                    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">Kcal Burned</div>
                    {editingCalories ? (
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" value={caloriesInput}
                          onChange={e => setCaloriesInput(e.target.value)}
                          placeholder="kcal"
                          className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-emerald-500" />
                        <button
                          onClick={async () => {
                            await saveSessionField('caloriesBurned', parseInt(caloriesInput) || 0);
                            setEditingCalories(false);
                          }}
                          disabled={savingSessionField}
                          className="text-emerald-400 hover:text-emerald-300 text-xs font-mono disabled:opacity-50">
                          {savingSessionField ? '…' : '✓'}
                        </button>
                        <button onClick={() => setEditingCalories(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-orange-400 font-mono">
                          {(selectedSession as any).caloriesBurned > 0 ? `${(selectedSession as any).caloriesBurned}` : '—'}
                        </span>
                        <button onClick={() => {
                          setCaloriesInput(String((selectedSession as any).caloriesBurned || ''));
                          setEditingCalories(true);
                        }} className="text-slate-500 hover:text-orange-400 transition-colors">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {selectedSession.type === 'running' ? (
                  <>
                    <div className="bg-slate-800 rounded-xl p-4 space-y-2">
                      {(() => {
                        const dm = selectedSession.durationMins ?? 0;
                        const m = Math.floor(dm);
                        const s = Math.round((dm % 1) * 60);
                        const durationLabel = dm > 0 ? (s > 0 ? `${m}m ${s}s` : `${m} mins`) : '--';
                        return [
                          ['Effort', selectedSession.effortType],
                          ['Surface', selectedSession.surface],
                          ['Distance', `${selectedSession.distanceKm}km`],
                          ['Duration', durationLabel],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between text-sm">
                            <span className="text-slate-400">{k}</span>
                            <span className="text-white capitalize">{v}</span>
                          </div>
                        ));
                      })()}
                      {selectedSession.paceMinPerKm && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Pace</span>
                          <span className="text-emerald-400">{Math.floor(selectedSession.paceMinPerKm)}:{String(Math.round((selectedSession.paceMinPerKm % 1) * 60)).padStart(2,'0')} /km</span>
                        </div>
                      )}
                      {selectedSession.notes && <p className="text-xs text-slate-300 pt-1">{selectedSession.notes}</p>}
                    </div>
                    <button
                      onClick={() => setShowRunningPoster(true)}
                      className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
                      🏅 Share Poster
                    </button>
                  </>
                ) : selectedSession.exercises?.map((exercise, i) => (
                  <div key={i} className="bg-slate-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-white mb-3">{exercise.name}</h3>
                    <div className="space-y-1.5 mb-3">
                      {exercise.sets.map((set, j) => (
                        <div key={j} className="flex justify-between bg-slate-700 rounded-lg px-3 py-2">
                          <span className="text-xs text-slate-400">Set {j + 1}</span>
                          <div className="flex gap-3 text-xs">
                            <span className="text-white">{set.reps} reps</span>
                            <span className="text-emerald-400">{set.weight}kg</span>
                            <span className="text-slate-500">~{calculateOneRM(set.weight, set.reps).toFixed(1)} 1RM</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {renderOneRMChart(exercise.name)}
                  </div>
                ))}
              </div>
              {selectedSession.type !== 'running' && (
                <button
                  onClick={() => { setPosterSession(selectedSession); setSelectedSession(null); }}
                  className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
                  <Share2 className="w-4 h-4" /> Share Poster
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY SESSION POSTER ── */}
      {posterSession && (() => {
        const isRun = posterSession.type === 'running' || !!(posterSession as any).distanceKm;
        return (
          <WorkoutPosterModal
            open={!!posterSession}
            onDone={() => setPosterSession(null)}
            template={(posterSession.template || (posterSession as any).effortType || 'Run')}
            sessionDate={posterSession.date}
            exercises={isRun ? [] : (posterSession.exercises || [])}
            durationMins={posterSession.durationMins}
            caloriesBurned={(posterSession as any).caloriesBurned}
            sessionDocId={posterSession.id}
            userId={user?.uid}
            sessionType={isRun ? 'running' : 'strength'}
            {...(isRun ? {
              distanceKm: (posterSession as any).distanceKm,
              paceMinPerKm: (posterSession as any).paceMinPerKm,
              effortType: (posterSession as any).effortType,
              intervals: (posterSession as any).intervals || [],
            } : {
              aiMuscles: (posterSession as any).aiMuscles || [],
            })}
          />
        );
      })()}

      {/* ── RUNNING SESSION POSTER ── */}
      {showRunningPoster && selectedSession && (
        <WorkoutPosterModal
          open={showRunningPoster}
          onDone={() => setShowRunningPoster(false)}
          template={selectedSession.template}
          sessionDate={selectedSession.date}
          exercises={[]}
          durationMins={selectedSession.durationMins}
          caloriesBurned={(selectedSession as any).caloriesBurned}
          sessionDocId={selectedSession.id}
          userId={user?.uid}
          aiMuscles={[]}
          sessionType="running"
          distanceKm={selectedSession.distanceKm}
          paceMinPerKm={selectedSession.paceMinPerKm}
          effortType={(selectedSession as any).effortType}
          intervals={(selectedSession as any).intervals}
        />
      )}

      {/* ── CREATE/EDIT WORKOUT MODAL ── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 pb-20">
          <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[calc(100vh-160px)] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <h2 className="text-base font-bold">{editingWorkout ? 'Edit Workout' : 'Create Workout'}</h2>
              <button onClick={closeCreateModal} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Name</label>
                <input type="text" value={workoutName} onChange={e => setWorkoutName(e.target.value)} placeholder="e.g. Chest Focus, Leg Blast..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-medium text-slate-400">Exercises ({selectedExercises.length})</label>
                  <button onClick={() => setShowLibrary(true)} className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                {selectedExercises.length === 0 ? (
                  <div className="bg-slate-800 rounded-lg p-4 text-center text-slate-500 text-xs">No exercises yet</div>
                ) : (
                  <div className="space-y-2">
                    {selectedExercises.map((ex, i) => (
                      <div key={i} className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => moveExercise(i, 'up')} disabled={i === 0} className="text-slate-500 hover:text-white disabled:opacity-20"><ArrowUp className="w-3 h-3" /></button>
                          <button onClick={() => moveExercise(i, 'down')} disabled={i === selectedExercises.length - 1} className="text-slate-500 hover:text-white disabled:opacity-20"><ArrowDown className="w-3 h-3" /></button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white">{ex.name}</p>
                          <p className="text-[9px] text-slate-500 capitalize">{ex.category}</p>
                        </div>
                        <input type="number" min="1" max="10" value={ex.defaultSets}
                          onChange={e => setSelectedExercises(prev => prev.map((s, idx) => idx === i ? { ...s, defaultSets: parseInt(e.target.value) || 3 } : s))}
                          className="w-10 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-white text-xs text-center focus:outline-none" />
                        <span className="text-[9px] text-slate-600">sets</span>
                        <button onClick={() => setSelectedExercises(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
              <button onClick={saveWorkout} disabled={isSavingWorkout || !workoutName.trim() || selectedExercises.length === 0}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl text-sm">
                {isSavingWorkout ? 'Saving...' : editingWorkout ? 'Update' : 'Save Workout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EXERCISE LIBRARY MODAL ── */}
      {showLibrary && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60]">
          <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[calc(100vh-160px)] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <h2 className="text-base font-bold">Exercise Library</h2>
              <button onClick={() => setShowLibrary(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 pt-4 space-y-3 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {['all', 'push', 'pull', 'legs', 'core', 'full body'].map(cat => (
                  <button key={cat} onClick={() => setFilterCategory(cat)}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterCategory === cat ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300'}`}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {filteredExercises.map(ex => {
                const isSelected = !!selectedExercises.find(e => e.name === ex.name);
                return (
                  <button key={ex.name} onClick={() => toggleExercise(ex)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${isSelected ? 'bg-emerald-950/50 border-emerald-700' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}>
                    <div className="text-left">
                      <p className="text-sm text-white">{ex.name}</p>
                      <p className="text-xs text-slate-500 capitalize">{ex.category}</p>
                    </div>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {isSelected ? '✓' : '+'}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
              <button onClick={() => setShowLibrary(false)} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl text-sm">
                Done ({selectedExercises.length} selected)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}