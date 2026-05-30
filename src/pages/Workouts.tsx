import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, TrendingUp, Plus, Clock, Calendar, X, Activity, Dumbbell, Search, Trash2, Pencil, Send } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp, deleteDoc, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { useActivityRings } from '@/hooks/useActivityRings';

interface WorkoutSession {
  id: string;
  date: string;
  template: string;
  duration?: number;
  durationMins?: number;
  exercises?: Exercise[];
  type?: 'workout' | 'running';
  effortType?: 'recovery' | 'tempo' | 'endurance';
  surface?: 'road' | 'treadmill' | 'hill';
  distanceKm?: number;
  paceMinPerKm?: number;
  notes?: string;
  createdAt: any;
}

interface Exercise {
  name: string;
  sets: ExerciseSet[];
}

interface ExerciseSet {
  reps: number;
  weight: number;
}

interface OneRMData {
  date: string;
  oneRM: number;
}

interface CustomWorkout {
  id?: string;
  name: string;
  exercises: { name: string; category: string; defaultSets: number }[];
  createdAt?: any;
}

interface ExerciseItem {
  name: string;
  category: string;
}

interface AIPlanExercise {
  exercise: string;
  sets: number;
  reps: number;
  suggestedWeight: number;
  lastWeight: number;
}

interface AIWorkoutPlan {
  plan: AIPlanExercise[];
}

const EXERCISE_LIBRARY: ExerciseItem[] = [
  { name: 'Bench Press', category: 'push' },
  { name: 'Incline Bench Press', category: 'push' },
  { name: 'Overhead Press', category: 'push' },
  { name: 'Incline Dumbbell Press', category: 'push' },
  { name: 'Cable Fly', category: 'push' },
  { name: 'Chest Dip', category: 'push' },
  { name: 'Lateral Raise', category: 'push' },
  { name: 'Front Raise', category: 'push' },
  { name: 'Tricep Pushdown', category: 'push' },
  { name: 'Skull Crushers', category: 'push' },
  { name: 'Close Grip Bench Press', category: 'push' },
  { name: 'Arnold Press', category: 'push' },
  { name: 'Deadlift', category: 'pull' },
  { name: 'Pull-ups', category: 'pull' },
  { name: 'Chin-ups', category: 'pull' },
  { name: 'Barbell Row', category: 'pull' },
  { name: 'Dumbbell Row', category: 'pull' },
  { name: 'Cable Row', category: 'pull' },
  { name: 'Face Pull', category: 'pull' },
  { name: 'Lat Pulldown', category: 'pull' },
  { name: 'Bicep Curl', category: 'pull' },
  { name: 'Hammer Curl', category: 'pull' },
  { name: 'Preacher Curl', category: 'pull' },
  { name: 'T-Bar Row', category: 'pull' },
  { name: 'Squat', category: 'legs' },
  { name: 'Romanian Deadlift', category: 'legs' },
  { name: 'Leg Press', category: 'legs' },
  { name: 'Leg Curl', category: 'legs' },
  { name: 'Leg Extension', category: 'legs' },
  { name: 'Calf Raise', category: 'legs' },
  { name: 'Bulgarian Split Squat', category: 'legs' },
  { name: 'Lunges', category: 'legs' },
  { name: 'Hack Squat', category: 'legs' },
  { name: 'Glute Bridge', category: 'legs' },
  { name: 'Hip Thrust', category: 'legs' },
  { name: 'Plank', category: 'core' },
  { name: 'Crunches', category: 'core' },
  { name: 'Russian Twists', category: 'core' },
  { name: 'Leg Raises', category: 'core' },
  { name: 'Cable Crunch', category: 'core' },
  { name: 'Ab Wheel Rollout', category: 'core' },
  { name: 'Mountain Climbers', category: 'core' },
  { name: 'Barbell Clean', category: 'full body' },
  { name: 'Burpees', category: 'full body' },
  { name: 'Kettlebell Swing', category: 'full body' },
  { name: 'Box Jumps', category: 'full body' },
  { name: 'Battle Ropes', category: 'full body' },
];

const DEFAULT_TEMPLATES = [
  { type: 'push', title: 'Push Day', subtitle: 'Chest · Shoulders · Triceps', icon: ArrowUp },
  { type: 'pull', title: 'Pull Day', subtitle: 'Back · Biceps', icon: ArrowDown },
  { type: 'legs', title: 'Legs Day', subtitle: 'Quads · Hamstrings · Glutes · Calves', icon: TrendingUp },
  { type: 'running', title: 'Running 🏃', subtitle: 'Distance · Pace · Time', icon: Activity },
  { type: 'upper', title: 'Upper Body', subtitle: 'Chest · Back · Shoulders', icon: ArrowUp },
  { type: 'lower', title: 'Lower Body', subtitle: 'Quads · Hamstrings · Glutes', icon: TrendingUp },
];

const QUICK_CHIPS = [
  { label: '🦵 Legs · 30m', prompt: 'legs today, only 30 minutes' },
  { label: '💪 Push · intense', prompt: 'push day, want to push hard today' },
  { label: '🔙 Pull day', prompt: 'pull day' },
  { label: '⚡ Quick 20m', prompt: 'quick full body workout, only 20 minutes' },
];

const calculateOneRM = (weight: number, reps: number): number => weight * (1 + reps / 30);

export default function Workouts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);

  const [customWorkouts, setCustomWorkouts] = useState<CustomWorkout[]>([]);
  const [editingWorkout, setEditingWorkout] = useState<CustomWorkout | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [workoutName, setWorkoutName] = useState('');
  const [selectedExercises, setSelectedExercises] = useState<{ name: string; category: string; defaultSets: number }[]>([]);
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  // AI Planner state
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiIntro, setAiIntro] = useState('');
  const [aiPlan, setAiPlan] = useState<AIPlanExercise[] | null>(null);
  const [aiError, setAiError] = useState('');

  const rings = useActivityRings(user?.uid || '');

  // Arc helper for SVG rings
  const arc = (r: number, val: number) => {
    const c = 2 * Math.PI * r;
    return { dasharray: c, dashoffset: c * (1 - Math.min(1, Math.max(0, val))) };
  };

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      try {
        const q = query(collection(db, 'users', user.uid, 'workoutSessions'), orderBy('date', 'desc'), limit(20));
        const snap = await getDocs(q);
        setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession)));
        const tSnap = await getDocs(collection(db, 'users', user.uid, 'workoutTemplates'));
        setCustomWorkouts(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as CustomWorkout)));
      } catch (e) {
        console.error('Error fetching data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  // ── AI PLANNER ──
  const buildContext = async (input: string): Promise<string> => {
    if (!user) return '';
    const parts: string[] = [];

    // Fetch profile for fitness context
    try {
      const profileDoc = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
      if (profileDoc.exists()) {
        const p = profileDoc.data() as any;
        const profileParts = [
          p.primaryGoal && `Goal: ${p.primaryGoal}`,
          p.fitnessFocus?.length && `Fitness focus: ${p.fitnessFocus.join(', ')}`,
          p.fitnessTarget && `Target: ${p.fitnessTarget}`,
          p.foodPreference && `Diet: ${p.foodPreference}`,
          p.activityLevel && `Activity level: ${p.activityLevel}`,
        ].filter(Boolean);
        if (profileParts.length) parts.push('Profile:\n' + profileParts.join('\n'));
      }
    } catch {}

    // Detect muscle group from input
    const lower = input.toLowerCase();
    const keywords: Record<string, string> = {
      leg: 'legs', squat: 'legs', quad: 'legs', hamstring: 'legs',
      push: 'push', chest: 'push', bench: 'push', shoulder: 'push',
      pull: 'pull', back: 'pull', deadlift: 'pull', bicep: 'pull',
    };
    let matchedType = '';
    for (const [kw, type] of Object.entries(keywords)) {
      if (lower.includes(kw)) { matchedType = type; break; }
    }

    // Last session of same type
    if (matchedType) {
      const sameSessions = sessions.filter(s =>
        s.template?.toLowerCase().includes(matchedType) ||
        (matchedType === 'legs' && ['legs', 'lower', 'legsday'].some(t => s.template?.toLowerCase().includes(t))) ||
        (matchedType === 'push' && ['push', 'upper', 'pushday'].some(t => s.template?.toLowerCase().includes(t))) ||
        (matchedType === 'pull' && ['pull', 'pullday'].some(t => s.template?.toLowerCase().includes(t)))
      );
      if (sameSessions.length > 0) {
        const last = sameSessions[0];
        parts.push(`Last ${matchedType} session: ${last.date}`);
        if (last.exercises && last.exercises.length > 0) {
          const exLines = last.exercises.slice(0, 5).map(ex => {
            const bestSet = ex.sets.reduce((b, c) => c.weight > b.weight ? c : b, ex.sets[0]);
            return `  - ${ex.name}: ${ex.sets.length} sets, best set ${bestSet?.weight ?? 0}kg × ${bestSet?.reps ?? 0}`;
          });
          parts.push('Exercises:\n' + exLines.join('\n'));
        }
      }
    }

    // Latest body stats
    try {
      const bodySnap = await getDocs(query(
        collection(db, 'users', user.uid, 'bodyComp'),
        orderBy('date', 'desc'), limit(1)
      ));
      if (!bodySnap.empty) {
        const b = bodySnap.docs[0].data();
        parts.push(`Body stats: weight ${b.weightKg ?? '?'}kg, body fat ${b.pbf ?? '?'}%, muscle ${b.smm ?? '?'}kg`);
      }
    } catch {}

    // Latest labs (out of range only)
    try {
      const labSnap = await getDocs(query(
        collection(db, 'users', user.uid, 'labs'),
        orderBy('date', 'desc'), limit(1)
      ));
      if (!labSnap.empty) {
        const lab = labSnap.docs[0].data();
        const labRanges: Record<string, { min: number; max: number }> = {
          vitd: { min: 30, max: 100 }, b12: { min: 200, max: 900 },
          hb: { min: 13.5, max: 17.5 }, creatinine: { min: 0.7, max: 1.3 },
        };
        if (lab.results && Array.isArray(lab.results)) {
          const oor = lab.results.filter((t: any) => {
            const key = t.testName?.toLowerCase().replace(/\s+/g, '');
            const range = labRanges[key];
            return range && (t.value < range.min || t.value > range.max);
          });
          if (oor.length > 0) {
            parts.push('Lab flags: ' + oor.map((t: any) => `${t.testName} ${t.value} ${t.unit}`).join(', '));
          }
        }
      }
    } catch {}

    return parts.join('\n');
  };

  const sendToAI = async (prompt: string) => {
    if (!prompt.trim() || !user) return;
    setAiLoading(true);
    setAiPlan(null);
    setAiIntro('');
    setAiError('');

    try {
      const context = await buildContext(prompt);

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
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: `You are a personal fitness coach. The user wants a workout plan.

User request: "${prompt}"

Context:
${context || 'No previous data available.'}

Respond with exactly this format — a one sentence intro referencing their data, then a JSON block:

<intro>One sentence about their last session or body stats that shows you know their history.</intro>
<plan>{"plan":[{"exercise":"Exercise Name","sets":3,"reps":8,"suggestedWeight":80,"lastWeight":75}]}</plan>

Rules:
- 3-6 exercises appropriate for the muscle group
- If time is mentioned (e.g. 30 mins), keep to 4 compound exercises max
- suggestedWeight should be ~2.5kg more than lastWeight if last session data exists, else use a sensible starting weight
- lastWeight of 0 means no previous data
- Keep exercise names simple and standard`,
          }],
        }),
      });

      if (!response.ok) throw new Error('API request failed');
      const data = await response.json();
      const text = data.content?.[0]?.text || '';

      // Parse intro
      const introMatch = text.match(/<intro>([\s\S]*?)<\/intro>/);
      if (introMatch) setAiIntro(introMatch[1].trim());

      // Parse plan JSON
      const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);
      if (planMatch) {
        const parsed: AIWorkoutPlan = JSON.parse(planMatch[1].trim());
        if (parsed.plan && Array.isArray(parsed.plan)) {
          setAiPlan(parsed.plan);
        }
      }
    } catch (e) {
      console.error('AI planner error:', e);
      setAiError('Something went wrong. Try again.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAISend = () => sendToAI(aiInput);

  const handleChip = (prompt: string) => {
    setAiInput(prompt);
    sendToAI(prompt);
  };

  const startFromAIPlan = () => {
    if (!aiPlan) return;
    const exercises = aiPlan.map(item => ({
      name: item.exercise,
      sets: Array.from({ length: item.sets }, () => ({
        reps: item.reps,
        weight: item.suggestedWeight,
      })),
    }));
    navigate('/workout-session', { state: { template: 'custom', customWorkout: { name: aiInput || 'AI Plan', exercises: exercises.map(e => ({ name: e.name, category: 'custom', defaultSets: e.sets.length })) }, aiExercises: exercises } });
  };

  // ── EXISTING HANDLERS ──
  const openCreateModal = () => {
    setEditingWorkout(null);
    setWorkoutName('');
    setSelectedExercises([]);
    setShowCreateModal(true);
  };

  const openEditModal = (w: CustomWorkout) => {
    setEditingWorkout(w);
    setWorkoutName(w.name);
    setSelectedExercises(w.exercises);
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setEditingWorkout(null);
    setWorkoutName('');
    setSelectedExercises([]);
  };

  const deleteWorkout = async (w: CustomWorkout) => {
    if (!user || !w.id) return;
    if (!window.confirm(`Delete "${w.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'workoutTemplates', w.id));
      setCustomWorkouts(prev => prev.filter(x => x.id !== w.id));
    } catch (e) {
      console.error('Error deleting workout:', e);
      alert('Failed to delete workout');
    }
  };

  const startWorkout = (templateType: string, customId?: string) => {
    if (templateType === 'running') {
      navigate('/running-session');
    } else if (customId) {
      const workout = customWorkouts.find(w => w.id === customId);
      navigate('/workout-session', { state: { template: templateType, customWorkout: workout } });
    } else {
      navigate('/workout-session', { state: { template: templateType } });
    }
  };

  const getSessionStats = (session: WorkoutSession) => {
    if (session.type === 'running') return { exerciseCount: 0, totalSets: 0, isRunning: true };
    const totalSets = session.exercises?.reduce((sum, ex) => sum + ex.sets.length, 0) || 0;
    return { exerciseCount: session.exercises?.length || 0, totalSets, isRunning: false };
  };

  const getExerciseOneRMHistory = (exerciseName: string): OneRMData[] => {
    return sessions
      .filter(s => s.type !== 'running')
      .map(s => {
        const ex = s.exercises?.find(e => e.name === exerciseName);
        if (!ex || ex.sets.length === 0) return null;
        const best = ex.sets.reduce((b, c) => calculateOneRM(c.weight, c.reps) > calculateOneRM(b.weight, b.reps) ? c : b);
        return { date: s.date, oneRM: calculateOneRM(best.weight, best.reps) };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a!.date).getTime() - new Date(b!.date).getTime()) as OneRMData[];
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

  const filteredExercises = EXERCISE_LIBRARY.filter(ex => {
    const matchSearch = ex.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = filterCategory === 'all' || ex.category === filterCategory;
    return matchSearch && matchCat;
  });

  const toggleExercise = (ex: ExerciseItem) => {
    const exists = selectedExercises.find(e => e.name === ex.name);
    if (exists) {
      setSelectedExercises(prev => prev.filter(e => e.name !== ex.name));
    } else {
      setSelectedExercises(prev => [...prev, { name: ex.name, category: ex.category, defaultSets: 3 }]);
    }
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
      if (editingWorkout && editingWorkout.id) {
        const data = cleanData({ name: workoutName.trim(), exercises: selectedExercises });
        await updateDoc(doc(db, 'users', user.uid, 'workoutTemplates', editingWorkout.id), data);
        setCustomWorkouts(prev => prev.map(w =>
          w.id === editingWorkout.id ? { ...w, name: workoutName.trim(), exercises: selectedExercises } : w
        ));
      } else {
        const data = cleanData({ name: workoutName.trim(), exercises: selectedExercises, createdAt: serverTimestamp() });
        const ref = await addDoc(collection(db, 'users', user.uid, 'workoutTemplates'), data);
        setCustomWorkouts(prev => [...prev, { id: ref.id, name: workoutName.trim(), exercises: selectedExercises }]);
      }
      closeCreateModal();
    } catch (e) {
      console.error('Error saving workout:', e);
      alert('Failed to save workout');
    } finally {
      setIsSavingWorkout(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center"><div>Loading...</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Workouts</h1>

        {/* ── 2-RING HEADER: Train + Move ── */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-3">
            {/* 2-ring SVG */}
            <div className="flex-shrink-0 w-[80px] h-[80px]">
              <svg width="80" height="80" viewBox="0 0 80 80">
                {/* Train - red - r=33 */}
                <circle cx="40" cy="40" r="33" fill="none" stroke="rgba(255,55,95,0.14)" strokeWidth="9"/>
                <circle cx="40" cy="40" r="33" fill="none" stroke="#ff375f" strokeWidth="9"
                  strokeDasharray={arc(33, rings.train.pct / 100).dasharray}
                  strokeDashoffset={arc(33, rings.train.pct / 100).dashoffset}
                  strokeLinecap="round" transform="rotate(-90 40 40)"/>
                {/* Move - green - r=21 */}
                <circle cx="40" cy="40" r="21" fill="none" stroke="rgba(48,209,88,0.14)" strokeWidth="9"/>
                <circle cx="40" cy="40" r="21" fill="none" stroke="#30d158" strokeWidth="9"
                  strokeDasharray={arc(21, rings.move.pct / 100).dasharray}
                  strokeDashoffset={arc(21, rings.move.pct / 100).dashoffset}
                  strokeLinecap="round" transform="rotate(-90 40 40)"/>
              </svg>
            </div>
            {/* Legend */}
            <div className="flex-1 flex flex-col gap-2">
              {[
                { label: 'Train', pct: rings.train.pct, sub: rings.train.label, color: '#ff375f' },
                { label: 'Move',  pct: rings.move.pct,  sub: rings.move.label,  color: '#30d158' },
              ].map(({ label, pct, sub, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-medium text-white">{label}</span>
                      <span className="text-[10px] font-mono" style={{ color }}>{Math.round(pct)}%</span>
                    </div>
                    <div className="text-[9px] text-slate-500 leading-tight truncate">{sub}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="text-[9px] text-slate-600 font-mono mt-0.5">
                {rings.train.done < rings.train.goal
                  ? `${rings.train.goal - rings.train.done} session${rings.train.goal - rings.train.done > 1 ? 's' : ''} to close Train ring`
                  : '🎉 Train ring closed this week'}
              </div>
            </div>
          </div>
        </div>

        {/* ── AI PLANNER ── */}
        <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {/* emerald top accent */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 to-transparent" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono text-emerald-400 tracking-wider uppercase">AI Planner</span>
            </div>
            <p className="text-sm font-medium text-white mb-3">What's your workout today?</p>

            {/* Input row */}
            <div className="flex gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAISend()}
                placeholder='e.g. "legs, 30 mins, tired today"'
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleAISend}
                disabled={aiLoading || !aiInput.trim()}
                className="w-9 h-9 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
              >
                {aiLoading
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-4 h-4 text-white" />}
              </button>
            </div>

            {/* Quick chips */}
            <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
              {QUICK_CHIPS.map(chip => (
                <button
                  key={chip.label}
                  onClick={() => handleChip(chip.prompt)}
                  className="flex-shrink-0 text-[10px] px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* AI Response */}
            {aiError && (
              <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {aiError}
              </div>
            )}

            {(aiIntro || aiPlan) && !aiLoading && (
              <div className="mt-3 space-y-3">
                {/* Intro text */}
                {aiIntro && (
                  <p className="text-xs text-slate-400 leading-relaxed">{aiIntro}</p>
                )}

                {/* Plan card */}
                {aiPlan && aiPlan.length > 0 && (
                  <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                    <div className="flex justify-between items-center px-3 py-2 bg-emerald-500/5 border-b border-slate-700">
                      <span className="text-xs font-semibold text-emerald-400">⚡ Generated Plan</span>
                      <span className="text-[10px] font-mono text-slate-500">{aiPlan.length} exercises</span>
                    </div>
                    {aiPlan.map((item, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/50 last:border-0">
                        <div>
                          <div className="text-xs font-medium text-white">{item.exercise}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{item.sets} × {item.reps} reps</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="text-xs text-emerald-400">→ {item.suggestedWeight}kg</div>
                          {item.lastWeight > 0 && (
                            <div className="text-[10px] text-slate-600">last: {item.lastWeight}kg</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {/* Action buttons */}
                    <div className="flex gap-2 p-3 border-t border-slate-700">
                      <button
                        onClick={startFromAIPlan}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        🏋️ Start This Workout
                      </button>
                      <button
                        onClick={() => { setAiPlan(null); setAiIntro(''); setAiInput(''); }}
                        className="w-9 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center justify-center transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Refinement chips */}
                {aiPlan && (
                  <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                    {['Make it harder', 'Less exercises', 'Add core work'].map(ref => (
                      <button
                        key={ref}
                        onClick={() => { const newPrompt = `${aiInput} — ${ref.toLowerCase()}`; setAiInput(newPrompt); sendToAI(newPrompt); }}
                        className="flex-shrink-0 text-[10px] px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
                      >
                        {ref}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* My Workouts */}
        {customWorkouts.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">MY WORKOUTS</h2>
            <div className="space-y-3">
              {customWorkouts.map(w => (
                <div key={w.id} className="w-full bg-emerald-950/40 border border-emerald-800 rounded-lg p-4 flex items-center justify-between">
                  <button className="flex items-center space-x-4 flex-1 text-left" onClick={() => startWorkout('custom', w.id)}>
                    <div className="w-12 h-12 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Dumbbell className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{w.name}</h3>
                      <p className="text-sm text-slate-400">{w.exercises.map(e => e.name).slice(0, 3).join(' · ')}{w.exercises.length > 3 ? ` +${w.exercises.length - 3}` : ''}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 ml-3">
                    <button onClick={() => openEditModal(w)} className="text-slate-400 hover:text-emerald-400 p-2">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteWorkout(w)} className="text-slate-400 hover:text-red-400 p-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Start */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">QUICK START</h2>
            <button onClick={openCreateModal} className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1">
              <Plus className="w-4 h-4" /> Create
            </button>
          </div>
          <div className="space-y-3">
            {DEFAULT_TEMPLATES.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.type} onClick={() => startWorkout(t.type)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center justify-between hover:bg-slate-800 transition-colors">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-emerald-500 rounded-lg flex items-center justify-center">
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-white">{t.title}</h3>
                      <p className="text-sm text-slate-400">{t.subtitle}</p>
                    </div>
                  </div>
                  <ArrowUp className="w-5 h-5 text-slate-400 rotate-45" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent Sessions */}
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">RECENT SESSIONS</h2>
          {sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map(session => {
                const stats = getSessionStats(session);
                return (
                  <div key={session.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:bg-slate-800 transition-colors">
                    <button onClick={() => setSelectedSession(session)} className="w-full text-left">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          {stats.isRunning ? <Activity className="w-4 h-4 text-emerald-400" /> : <Dumbbell className="w-4 h-4 text-slate-400" />}
                          <span className="text-sm text-slate-400">{new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                        <span className="text-emerald-400 font-medium capitalize">{session.template}</span>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-slate-300">
                        {stats.isRunning ? (() => {
                          const p = session.paceMinPerKm!;
                          const paceDisplay = `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')} min/km`;
                          return <><span>{session.effortType}</span><span>•</span><span>{session.surface}</span><span>•</span><span>{session.distanceKm}km</span><span>•</span><span>{paceDisplay}</span></>;
                        })() : (
                          <><span>{stats.exerciseCount} exercises</span><span>•</span><span>{stats.totalSets} sets</span></>
                        )}
                      </div>
                    </button>
                    <div className="flex space-x-2 mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Delete this session?')) {
                            deleteDoc(doc(db, 'users', user!.uid, 'workoutSessions', session.id));
                            setSessions(sessions.filter(s => s.id !== session.id));
                          }
                        }}
                        className="text-slate-400 hover:text-red-400 p-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {!stats.isRunning && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/workout-session', { state: { template: session.template, editSession: session } });
                          }}
                          className="text-slate-400 hover:text-blue-400 p-2"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
              <Clock className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-2">No workouts logged</h3>
              <p className="text-slate-400 text-sm">Start your first workout to see history here</p>
            </div>
          )}
        </div>
      </div>

      {/* Session Detail Modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white capitalize mb-1">{selectedSession.template} Workout</h2>
                  <div className="flex items-center space-x-2 text-sm text-slate-400">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(selectedSession.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedSession(null)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
              </div>
              <div className="space-y-6">
                {selectedSession.type === 'running' ? (
                  <div className="bg-slate-800 rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold text-white">Running Session</h3>
                    {[['Effort Type', selectedSession.effortType], ['Surface', selectedSession.surface], ['Distance', `${selectedSession.distanceKm} km`], ['Duration', `${selectedSession.durationMins} min`]].map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="text-sm text-slate-400">{k}:</span><span className="text-sm text-white capitalize">{v}</span></div>
                    ))}
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Pace:</span>
                      <span className="text-sm text-emerald-400">{Math.floor(selectedSession.paceMinPerKm!)}:{String(Math.round((selectedSession.paceMinPerKm! % 1) * 60)).padStart(2, '0')} min/km</span>
                    </div>
                    {selectedSession.notes && <p className="text-sm text-white">{selectedSession.notes}</p>}
                  </div>
                ) : selectedSession.exercises?.map((exercise, i) => (
                  <div key={i} className="bg-slate-800 rounded-lg p-4">
                    <h3 className="font-semibold text-white mb-3">{exercise.name}</h3>
                    <div className="space-y-2 mb-3">
                      {exercise.sets.map((set, j) => (
                        <div key={j} className="flex items-center justify-between bg-slate-700 rounded px-3 py-2">
                          <span className="text-sm text-slate-300">Set {j + 1}</span>
                          <div className="flex items-center space-x-3">
                            <span className="text-sm text-white font-medium">{set.reps} reps</span>
                            <span className="text-sm text-emerald-400 font-medium">{set.weight} kg</span>
                            <span className="text-xs text-slate-400">(~{calculateOneRM(set.weight, set.reps).toFixed(1)} kg 1RM)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {renderOneRMChart(exercise.name)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Workout Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 pb-20">
          <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[calc(100vh-160px)] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <h2 className="text-lg font-bold text-white">{editingWorkout ? 'Edit Workout' : 'Create Workout'}</h2>
              <button onClick={closeCreateModal} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Workout Name</label>
                <input type="text" placeholder="e.g. Chest Focused, PPL Day 1..." value={workoutName}
                  onChange={e => setWorkoutName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-400">Exercises ({selectedExercises.length})</label>
                  <button onClick={() => setShowLibrary(true)} className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add from Library
                  </button>
                </div>
                {selectedExercises.length === 0 ? (
                  <div className="bg-slate-800 rounded-lg p-4 text-center text-slate-500 text-sm">No exercises added yet. Tap "Add from Library".</div>
                ) : (
                  <div className="space-y-2">
                    {selectedExercises.map((ex, i) => (
                      <div key={i} className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => moveExercise(i, 'up')} disabled={i === 0} className="text-slate-500 hover:text-white disabled:opacity-20"><ArrowUp className="w-3 h-3" /></button>
                          <button onClick={() => moveExercise(i, 'down')} disabled={i === selectedExercises.length - 1} className="text-slate-500 hover:text-white disabled:opacity-20"><ArrowDown className="w-3 h-3" /></button>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-white">{ex.name}</p>
                          <p className="text-xs text-slate-500 capitalize">{ex.category}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <input type="number" min="1" max="10" value={ex.defaultSets}
                            onChange={e => setSelectedExercises(prev => prev.map((s, idx) => idx === i ? { ...s, defaultSets: parseInt(e.target.value) || 3 } : s))}
                            className="w-12 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-emerald-500" />
                          <span className="text-xs text-slate-500">sets</span>
                        </div>
                        <button onClick={() => setSelectedExercises(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-500 hover:text-red-400 p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
              <button onClick={saveWorkout} disabled={isSavingWorkout || !workoutName.trim() || selectedExercises.length === 0}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl">
                {isSavingWorkout ? 'Saving...' : editingWorkout ? 'Update Workout' : 'Save Workout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exercise Library Modal */}
      {showLibrary && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60]">
          <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[calc(100vh-160px)] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <h2 className="text-lg font-bold text-white">Exercise Library</h2>
              <button onClick={() => setShowLibrary(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 pt-4 space-y-3 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input type="text" placeholder="Search exercises..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500" />
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
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {isSelected ? '✓' : '+'}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
              <button onClick={() => setShowLibrary(false)} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl">
                Done ({selectedExercises.length} selected)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}