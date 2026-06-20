import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { bumpDataVersion } from '@/lib/dataVersion';
import { cleanData } from '@/lib/cleanData';
import { classifyWorkoutMuscles, estimateCaloriesBurned } from '@/lib/exerciseMuscleMap';
import WorkoutPosterModal from '@/components/WorkoutPosterModal';

interface Exercise {
  id: string;
  name: string;
  hasWeight?: boolean;
  note?: string;
  sets: Set[];
  fromLastSession?: boolean; // UI-only flag, not persisted — see finishWorkout
}

interface Set {
  reps: string;
  weight: string;
}

interface WorkoutTemplate {
  name: string;
  exercises: Omit<Exercise, 'id'>[];
}

const workoutTemplates: Record<string, WorkoutTemplate> = {
  push: {
    name: 'Push Day',
    exercises: [
      { name: 'Treadmill Warm Up', hasWeight: false, note: '5 mins', sets: [{ reps: '', weight: '' }] },
      { name: 'Pushups', hasWeight: false, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Incline Bench Press Machine', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Flat Bench Press Machine', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Incline Dumbbell Press', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Flat Dumbbell Press', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Dumbbell Fly', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Lateral Dumbbell Raise', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Triceps Pushdown', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Cable Tricep Overhead Extension', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Standing Dumbbell Overhead Tricep Extension', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Stretches', hasWeight: false, sets: [{ reps: '', weight: '' }] },
      { name: 'Cool Down Treadmill', hasWeight: false, note: '5 mins', sets: [{ reps: '', weight: '' }] },
    ],
  },
  pull: {
    name: 'Pull Day',
    exercises: [
      { name: 'Treadmill Warm Up', hasWeight: false, note: '5 mins', sets: [{ reps: '', weight: '' }] },
      { name: 'Pull Ups', hasWeight: false, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Lat Pulldown', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Seated Cable Row', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Close Grip Lat Pulldown', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Deadlift', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Dumbbell Shrugs', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Lower Back Extension', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Dumbbell Bicep Curl', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Dumbbell Hammer Curl', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Cool Down Treadmill', hasWeight: false, note: '5 mins', sets: [{ reps: '', weight: '' }] },
    ],
  },
  legs: {
    name: 'Legs Day',
    exercises: [
      { name: 'Treadmill Warm Up', hasWeight: false, note: '5 mins', sets: [{ reps: '', weight: '' }] },
      { name: 'Squats', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Walking Lunges', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Leg Extension', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Leg Curl', hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Calf Raises', hasWeight: false, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] },
      { name: 'Stretches', hasWeight: false, sets: [{ reps: '', weight: '' }] },
      { name: 'Cool Down Treadmill', hasWeight: false, note: '5 mins', sets: [{ reps: '', weight: '' }] },
    ],
  },
  upper: {
    name: 'Upper Body',
    exercises: [
      { name: 'Bench Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Pull-ups', sets: [{ reps: '', weight: '' }] },
      { name: 'Overhead Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Barbell Row', sets: [{ reps: '', weight: '' }] },
      { name: 'Lateral Raise', sets: [{ reps: '', weight: '' }] },
    ],
  },
  lower: {
    name: 'Lower Body',
    exercises: [
      { name: 'Squat', sets: [{ reps: '', weight: '' }] },
      { name: 'Romanian Deadlift', sets: [{ reps: '', weight: '' }] },
      { name: 'Leg Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Leg Curl', sets: [{ reps: '', weight: '' }] },
      { name: 'Calf Raise', sets: [{ reps: '', weight: '' }] },
    ],
  },
};

export default function WorkoutSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [template, setTemplate] = useState<string>('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSession, setEditingSession] = useState<any>(null);
  const [sessionDate, setSessionDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');

  // --- Timer (seconds precision) ---
  const startTimeRef = useRef<number>(Date.now());
  const [elapsedSecs, setElapsedSecs] = useState(0);

  // --- Last session ghost values ---
  const [lastSessionExercises, setLastSessionExercises] = useState<any[]>([]);
  const autoAddedFromLastSessionRef = useRef(false);

  // --- Auto-save state ---
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [draftKey, setDraftKey] = useState<string>('');
  const [showPoster, setShowPoster] = useState(false);
  const [savedSessionData, setSavedSessionData] = useState<{
    template: string;
    date: string;
    exercises: any[];
    durationMins?: number;
    sessionDocId?: string;
    aiMuscles?: Array<{ name: string; sets: number; category?: string; source?: 'learned' | 'ai' }>;
    caloriesBurned?: number;
  } | null>(null);

  // --- Timer effect — 1s interval ---
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const timerDisplay = `${String(Math.floor(elapsedSecs / 60)).padStart(2, '0')}:${String(elapsedSecs % 60).padStart(2, '0')}`;

  const getLastValue = useCallback(
    (exerciseName: string, setIndex: number, field: 'reps' | 'weight'): string => {
      if (!lastSessionExercises.length) return '';
      const ex = lastSessionExercises.find(
        (e: any) => e.name?.toLowerCase() === exerciseName.toLowerCase()
      );
      if (!ex?.sets?.[setIndex]) return '';
      const val = ex.sets[setIndex][field];
      if (val === null || val === undefined || val === '') return '';
      return String(val);
    },
    [lastSessionExercises]
  );

  useEffect(() => {
    const templateType = location.state?.template;
    const editSession = location.state?.editSession;

    if (editSession) {
      setEditingSession(editSession);
      setTemplate(editSession.template);
      setSessionDate(editSession.date || new Date().toISOString().split('T')[0]);
      if (editSession.durationMins) {
        const originalSecs = Math.round(editSession.durationMins * 60);
        startTimeRef.current = Date.now() - originalSecs * 1000;
        setElapsedSecs(originalSecs);
      }
      setExercises(
        editSession.exercises?.map((exercise: any, index: number) => ({
          id: `exercise-${index}`,
          name: exercise.name,
          hasWeight: exercise.hasWeight,
          note: exercise.note,
          sets: exercise.sets
            ? exercise.sets.map((s: any) => ({
                reps: s.reps != null ? String(s.reps) : '',
                weight: s.weight != null ? String(s.weight) : '',
              }))
            : [{ reps: '', weight: '' }],
        })) || []
      );
    } else if (location.state?.aiWorkout) {
      loadAiSuggestedWorkout();
    } else if (templateType === 'custom' && location.state?.customWorkout) {
      const customWorkout = location.state.customWorkout;
      setTemplate(customWorkout.name);
      const key = customWorkout.name.replace(/\s+/g, '_');
      setDraftKey(key);
      const initialExercises = customWorkout.exercises.map((exercise: any, index: number) => ({
        id: `exercise-${index}`,
        name: exercise.name,
        hasWeight: exercise.hasWeight !== false,
        sets: Array.from({ length: exercise.defaultSets || 3 }, () => ({ reps: '', weight: '' })),
      }));
      initWithDraftAndLastSession(initialExercises, customWorkout.name, key);
    } else if (templateType && workoutTemplates[templateType]) {
      const workoutTemplate = workoutTemplates[templateType];
      setTemplate(workoutTemplate.name);
      const key = workoutTemplate.name.replace(/\s+/g, '_');
      setDraftKey(key);
      const initialExercises = workoutTemplate.exercises.map((exercise, index) => ({
        ...exercise,
        id: `exercise-${index}`,
      }));
      initWithDraftAndLastSession(initialExercises, workoutTemplate.name, key);
    }
  }, [location.state]);

  const initWithDraftAndLastSession = async (
    initialExercises: Exercise[],
    templateName: string,
    key: string
  ) => {
    if (!user) { setExercises(initialExercises); return; }

    let restoredFromDraft = false;
    let baseExercises: Exercise[] = initialExercises;
    try {
      const draftRef = doc(db, 'users', user.uid, 'draftSessions', key);
      const draftSnap = await getDoc(draftRef);
      if (draftSnap.exists()) {
        const draft = draftSnap.data();
        const savedAt = new Date(draft.savedAt);
        const ageHours = (Date.now() - savedAt.getTime()) / 3600000;
        if (ageHours < 24 && draft.exercises?.length > 0) {
          baseExercises = draft.exercises;
          setExercises(draft.exercises);
          if (draft.sessionDate) setSessionDate(draft.sessionDate);
          setAutoSaveStatus('saved');
          restoredFromDraft = true;
        }
      }
    } catch (_) {}

    if (!restoredFromDraft) setExercises(initialExercises);

    try {
      let lastExercises: any[] = [];
      try {
        const q = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          where('template', '==', templateName.toLowerCase().replace(/\s+/g, '')),
          orderBy('date', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) lastExercises = snap.docs[0].data().exercises || [];
      } catch (_indexErr) {
        const q2 = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          where('template', '==', templateName.toLowerCase().replace(/\s+/g, '')),
          limit(20)
        );
        const snap2 = await getDocs(q2);
        if (!snap2.empty) {
          const sorted = snap2.docs.map(d => d.data()).sort((a, b) => (a.date < b.date ? 1 : -1));
          lastExercises = sorted[0]?.exercises || [];
        }
      }
      setLastSessionExercises(lastExercises);

      // Auto-add any exercise that was logged last time but isn't part of today's list
      // (e.g. an ad-hoc exercise added manually last session). Runs once per session load.
      if (!autoAddedFromLastSessionRef.current) {
        autoAddedFromLastSessionRef.current = true;
        const missing = lastExercises.filter(le =>
          le?.name && le.sets?.length &&
          !baseExercises.some(e => e.name.toLowerCase() === le.name.toLowerCase())
        );
        if (missing.length > 0) {
          const newRows: Exercise[] = missing.map((le, i: number) => ({
            id: `exercise-${Date.now()}-${i}`,
            name: le.name,
            hasWeight: le.hasWeight !== false,
            // Empty sets, same count as last time — matches every other exercise row,
            // which shows historical values as a greyed placeholder (via getLastValue)
            // until the user types or taps Copy Last Session, not pre-filled as real values.
            sets: le.sets.map(() => ({ reps: '', weight: '' })),
            fromLastSession: true,
          }));
          setExercises([...baseExercises, ...newRows]);
        }
      }
    } catch (_) {}
  };

  const loadAiSuggestedWorkout = async () => {
    if (!user) return;
    try {
      const draftRef = doc(db, 'users', user.uid, 'draftSessions', 'aiSuggested');
      const draftSnap = await getDoc(draftRef);
      if (draftSnap.exists()) {
        const draft = draftSnap.data();
        setTemplate('AI Suggested Workout');
        setDraftKey('aiSuggested');
        setExercises(
          draft.exercises?.map((exercise: any, index: number) => ({
            id: `exercise-${index}`,
            name: exercise.name,
            hasWeight: exercise.hasWeight !== false,
            note: exercise.note,
            sets: exercise.sets || [{ reps: '', weight: '' }],
          })) || []
        );
        if (draft.sessionDate) setSessionDate(draft.sessionDate);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (!user || !draftKey || exercises.length === 0) return;
    setAutoSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const draftRef = doc(db, 'users', user.uid, 'draftSessions', draftKey);
        await setDoc(draftRef, { type: template, exercises, sessionDate, savedAt: new Date().toISOString() });
        setAutoSaveStatus('saved');
      } catch (_) { setAutoSaveStatus('idle'); }
    }, 1200);
    return () => clearTimeout(timer);
  }, [exercises, sessionDate]);

  const moveExercise = (index: number, direction: 'up' | 'down') => {
    const newExercises = [...exercises];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newExercises.length) return;
    [newExercises[index], newExercises[swapIndex]] = [newExercises[swapIndex], newExercises[index]];
    setExercises(newExercises);
  };

  if (!template || exercises.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-white pb-20">
        <div className="bg-slate-900 border-b border-slate-800">
          <div className="px-6 py-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/workouts')} className="text-slate-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-2" />Back
            </Button>
            <h1 className="text-2xl font-bold text-white mt-2">Choose Workout Template</h1>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {Object.entries(workoutTemplates).map(([key, workout]) => (
              <button key={key} onClick={() => {
                const k = workout.name.replace(/\s+/g, '_');
                setTemplate(workout.name); setDraftKey(k);
                initWithDraftAndLastSession(workout.exercises.map((e, i) => ({ ...e, id: `exercise-${i}` })), workout.name, k);
              }} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 text-left hover:bg-slate-800 transition-colors">
                <h3 className="font-semibold text-white mb-1">{workout.name}</h3>
                <p className="text-sm text-slate-400">{workout.exercises.map(ex => ex.name).join(' • ')}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const addSet = (exerciseId: string) => setExercises(exercises.map(e => e.id === exerciseId ? { ...e, sets: [...e.sets, { reps: '', weight: '' }] } : e));

  const copyLastSession = (exerciseId: string) => {
    const exercise = exercises.find(e => e.id === exerciseId);
    if (!exercise) return;
    const last = lastSessionExercises.find(e => e.name?.toLowerCase() === exercise.name.toLowerCase());
    if (!last?.sets?.length) return;

    const newSets: Set[] = last.sets.map((histSet: { reps: number | string | null; weight: number | string | null }, i: number) => {
      const todaySet = exercise.sets[i];
      const histAsStrings: Set = {
        reps: histSet.reps != null ? String(histSet.reps) : '',
        weight: histSet.weight != null ? String(histSet.weight) : '',
      };
      if (!todaySet) return histAsStrings; // no row at this position yet — create it
      const isEmpty = todaySet.reps === '' && todaySet.weight === '';
      return isEmpty ? histAsStrings : todaySet; // leave filled sets untouched
    });
    // Preserve any of today's extra sets beyond what last session had
    if (exercise.sets.length > newSets.length) newSets.push(...exercise.sets.slice(newSets.length));

    setExercises(exercises.map(e => e.id === exerciseId ? { ...e, sets: newSets } : e));
  };

  const updateSet = (exerciseId: string, setIndex: number, field: 'reps' | 'weight', value: string) =>
    setExercises(exercises.map(e => e.id === exerciseId ? { ...e, sets: e.sets.map((s, i) => i === setIndex ? { ...s, [field]: value } : s) } : e));

  const removeExercise = (exerciseId: string) => setExercises(exercises.filter(e => e.id !== exerciseId));

  const addExercise = () => {
    if (!newExerciseName.trim()) return;
    setExercises([...exercises, { id: `exercise-${Date.now()}`, name: newExerciseName.trim(), hasWeight: true, sets: [{ reps: '', weight: '' }, { reps: '', weight: '' }, { reps: '', weight: '' }] }]);
    setNewExerciseName(''); setIsAddingExercise(false);
  };

  const finishWorkout = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const durationMins = elapsedSecs / 60;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cleanedExercises = exercises.map(({ id, fromLastSession, ...exercise }) => ({
        ...exercise,
        sets: exercise.sets.map(set => ({
          reps: parseInt(set.reps) || 0,
          weight: set.weight == null || set.weight === '' ? null : (parseFloat(set.weight) || null),
        })),
      }));

      const workoutData = cleanData({
        date: sessionDate,
        template: template.toLowerCase().replace(/\s+/g, ''),
        exercises: cleanedExercises,
        type: 'workout',
        durationMins,
      });

      let sessionDocId: string;
      if (editingSession) {
        if (!editingSession.id) {
          alert('Cannot save: session ID missing');
          setIsSaving(false);
          return;
        }
        await updateDoc(doc(db, 'users', user.uid, 'workoutSessions', editingSession.id), workoutData);
        sessionDocId = editingSession.id;
        await bumpDataVersion(user.uid);
        navigate('/workouts');
        return;
      } else {
        const ref = await addDoc(collection(db, 'users', user.uid, 'workoutSessions'), {
          ...workoutData,
          createdAt: serverTimestamp(),
        });
        sessionDocId = ref.id;
      }

      await bumpDataVersion(user.uid);

      if (draftKey) {
        try { await deleteDoc(doc(db, 'users', user.uid, 'draftSessions', draftKey)); } catch (_) {}
      }

      // Show poster immediately with fallback data
      setSavedSessionData({ template, date: sessionDate, exercises, durationMins, sessionDocId });
      setShowPoster(true);

      // Fire muscle classification + calorie estimation in background — non-blocking
      Promise.all([
        classifyWorkoutMuscles(user.uid, cleanedExercises),
        estimateCaloriesBurned(cleanedExercises, template, durationMins),
      ]).then(async ([muscles, caloriesBurned]) => {
        if (muscles.length === 0 && caloriesBurned == null) return;
        // Update poster state live
        setSavedSessionData(prev => prev ? { ...prev, aiMuscles: muscles, caloriesBurned: caloriesBurned ?? undefined } : prev);
        // Persist to Firestore
        try {
          await updateDoc(doc(db, 'users', user.uid, 'workoutSessions', sessionDocId), {
            aiMuscles: muscles,
            ...(caloriesBurned != null ? { caloriesBurned } : {}),
          });
        } catch (e) { console.error('Failed to save AI analysis:', e); }
      });

    } catch (error) {
      console.error('Error saving workout:', error);
      alert('Save failed: ' + (error as Error)?.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/workouts')} className="text-slate-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-2" />Back
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">{template}</h1>
            <span className="text-sm font-mono text-emerald-400">{timerDisplay}</span>
          </div>
          {!editingSession && (
            <div className="mt-1 h-4">
              {autoSaveStatus === 'saving' && <span className="text-xs text-slate-500">Saving…</span>}
              {autoSaveStatus === 'saved' && <span className="text-xs text-slate-500">✓ Auto-saved</span>}
            </div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {location.state?.aiWorkout && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2 text-emerald-400 text-sm">
            ✦ AI suggested · edit as needed
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>Date</span>
          <input type="date" value={sessionDate} max={new Date().toISOString().split('T')[0]}
            onChange={(e) => setSessionDate(e.target.value)}
            style={{ background: '#1a2332', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e2e8f0', padding: '6px 10px', fontSize: '13px' }} />
        </div>

        {lastSessionExercises.length > 0 && (
          <div style={{ background: 'rgba(16,185,129,0.07)', border: '0.5px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#6ee7b7' }}>
            💡 Greyed-out numbers show your last session — enter new values to override
          </div>
        )}

        {exercises.map((exercise, index) => (
          <div key={exercise.id} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">{exercise.name}</h3>
                  {exercise.fromLastSession && (
                    <span className="text-xs text-slate-500">from last session</span>
                  )}
                </div>
                {exercise.note && <p className="text-sm text-slate-500 mt-1">{exercise.note}</p>}
              </div>
              <div className="flex items-center gap-2">
                {lastSessionExercises.some(e => e.name?.toLowerCase() === exercise.name.toLowerCase()) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyLastSession(exercise.id)}
                    aria-label={`Copy last session for ${exercise.name}`}
                    title={`Copy last session for ${exercise.name}`}
                    className="text-slate-400 hover:text-emerald-400"
                  >
                    <History className="w-4 h-4" />
                  </Button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <button onClick={() => moveExercise(index, 'up')} disabled={index === 0}
                    style={{ background: 'none', border: 'none', color: index === 0 ? '#374151' : '#6b7280', cursor: index === 0 ? 'default' : 'pointer', padding: '2px 4px', fontSize: '12px' }}>▲</button>
                  <button onClick={() => moveExercise(index, 'down')} disabled={index === exercises.length - 1}
                    style={{ background: 'none', border: 'none', color: index === exercises.length - 1 ? '#374151' : '#6b7280', cursor: index === exercises.length - 1 ? 'default' : 'pointer', padding: '2px 4px', fontSize: '12px' }}>▼</button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeExercise(exercise.id)} className="text-slate-400 hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {exercise.sets.map((set, setIndex) => {
                const ghostReps = getLastValue(exercise.name, setIndex, 'reps');
                const ghostWeight = getLastValue(exercise.name, setIndex, 'weight');
                return (
                  <div key={setIndex} className="grid grid-cols-[auto_1fr_1fr] items-center gap-3">
                    <span className="text-slate-400 text-sm w-12">Set {setIndex + 1}</span>
                    <input type="text" inputMode="numeric" placeholder={ghostReps || 'Reps'} value={set.reps}
                      onChange={(e) => updateSet(exercise.id, setIndex, 'reps', e.target.value)}
                      className={`w-full min-w-0 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500 ${exercise.hasWeight === false ? 'col-span-2' : ''}`} />
                    {exercise.hasWeight !== false && (
                      <input type="text" inputMode="decimal" placeholder={ghostWeight ? `${ghostWeight} kg` : 'kg'} value={set.weight}
                        onChange={(e) => updateSet(exercise.id, setIndex, 'weight', e.target.value)}
                        className="w-full min-w-0 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500" />
                    )}
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" onClick={() => addSet(exercise.id)} className="mt-4 border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white">
              <Plus className="w-4 h-4 mr-2" />Add Set
            </Button>
          </div>
        ))}

        {!isAddingExercise && (
          <Button variant="outline" onClick={() => setIsAddingExercise(true)} className="w-full border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white">
            <Plus className="w-4 h-4 mr-2" />Add Exercise
          </Button>
        )}

        {isAddingExercise && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center space-x-3">
              <input type="text" placeholder="Exercise name" value={newExerciseName}
                onChange={(e) => setNewExerciseName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExercise()}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" autoFocus />
              <Button onClick={addExercise} size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white"><Check className="w-4 h-4" /></Button>
              <Button onClick={() => { setNewExerciseName(''); setIsAddingExercise(false); }} variant="ghost" size="sm" className="text-slate-400 hover:text-white"><Trash2 className="w-4 h-4" /></Button>
            </div>
          </div>
        )}

        <Button onClick={finishWorkout} disabled={isSaving} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3">
          {isSaving ? 'Saving...' : 'Finish Workout'}
          <Check className="w-5 h-5 ml-2" />
        </Button>
      </div>

      {showPoster && savedSessionData && (
        <WorkoutPosterModal
          open={showPoster}
          onDone={() => { setShowPoster(false); navigate('/workouts'); }}
          template={savedSessionData.template}
          sessionDate={savedSessionData.date}
          exercises={savedSessionData.exercises}
          durationMins={savedSessionData.durationMins}
          sessionDocId={savedSessionData.sessionDocId}
          userId={user?.uid}
          aiMuscles={savedSessionData.aiMuscles}
          caloriesBurned={savedSessionData.caloriesBurned}
        />
      )}
    </div>
  );
}