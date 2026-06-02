import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check } from 'lucide-react';
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
import WorkoutPosterModal from '@/components/WorkoutPosterModal';

interface Exercise {
  id: string;
  name: string;
  hasWeight?: boolean;
  note?: string;
  sets: Set[];
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

  // --- Auto-save state ---
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [draftKey, setDraftKey] = useState<string>('');
  const [showPoster, setShowPoster] = useState(false);
  const [savedSessionData, setSavedSessionData] = useState<{ template: string; date: string; exercises: any[]; durationMins?: number } | null>(null);

  // --- Timer effect — 1s interval ---
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const timerDisplay = `${String(Math.floor(elapsedSecs / 60)).padStart(2, '0')}:${String(elapsedSecs % 60).padStart(2, '0')}`;

  // Helper: get last session placeholder value
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

  // --- Initialize workout from template ---
  useEffect(() => {
    const templateType = location.state?.template;
    const editSession = location.state?.editSession;

    if (editSession) {
      setEditingSession(editSession);
      setTemplate(editSession.template);
      setSessionDate(editSession.date || new Date().toISOString().split('T')[0]);
      setExercises(
        editSession.exercises?.map((exercise: any, index: number) => ({
          id: `exercise-${index}`,
          name: exercise.name,
          hasWeight: exercise.hasWeight,
          note: exercise.note,
          sets: exercise.sets || [{ reps: '', weight: '' }],
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
        sets: Array.from({ length: exercise.defaultSets || 3 }, () => ({
          reps: '',
          weight: '',
        })),
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
    if (!user) {
      setExercises(initialExercises);
      return;
    }

    let restoredFromDraft = false;
    try {
      const draftRef = doc(db, 'users', user.uid, 'draftSessions', key);
      const draftSnap = await getDoc(draftRef);
      if (draftSnap.exists()) {
        const draft = draftSnap.data();
        const savedAt = new Date(draft.savedAt);
        const ageHours = (Date.now() - savedAt.getTime()) / 3600000;
        if (ageHours < 24 && draft.exercises?.length > 0) {
          setExercises(draft.exercises);
          if (draft.sessionDate) setSessionDate(draft.sessionDate);
          setAutoSaveStatus('saved');
          restoredFromDraft = true;
        }
      }
    } catch (_) {}

    if (!restoredFromDraft) {
      setExercises(initialExercises);
    }

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
        if (!snap.empty) {
          lastExercises = snap.docs[0].data().exercises || [];
        }
      } catch (_indexErr) {
        const q2 = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          where('template', '==', templateName.toLowerCase().replace(/\s+/g, '')),
          limit(20)
        );
        const snap2 = await getDocs(q2);
        if (!snap2.empty) {
          const sorted = snap2.docs
            .map(d => d.data())
            .sort((a, b) => {
              const da = a.date || '';
              const db_ = b.date || '';
              return da < db_ ? 1 : -1;
            });
          lastExercises = sorted[0]?.exercises || [];
        }
      }
      setLastSessionExercises(lastExercises);
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

  // --- Auto-save draft ---
  useEffect(() => {
    if (!user || !draftKey || exercises.length === 0) return;
    setAutoSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const draftRef = doc(db, 'users', user.uid, 'draftSessions', draftKey);
        await setDoc(draftRef, {
          type: template,
          exercises,
          sessionDate,
          savedAt: new Date().toISOString(),
        });
        setAutoSaveStatus('saved');
      } catch (_) {
        setAutoSaveStatus('idle');
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [exercises, sessionDate]);

  // --- Reorder ---
  const moveExercise = (index: number, direction: 'up' | 'down') => {
    const newExercises = [...exercises];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newExercises.length) return;
    [newExercises[index], newExercises[swapIndex]] = [newExercises[swapIndex], newExercises[index]];
    setExercises(newExercises);
  };

  // Show template selection if no template yet
  if (!template || exercises.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-white pb-20">
        <div className="bg-slate-900 border-b border-slate-800">
          <div className="px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/workouts')}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold text-white mt-2">Choose Workout Template</h1>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {Object.entries(workoutTemplates).map(([key, workout]) => (
              <button
                key={key}
                onClick={() => {
                  const k = workout.name.replace(/\s+/g, '_');
                  setTemplate(workout.name);
                  setDraftKey(k);
                  const initialExercises = workout.exercises.map((exercise, index) => ({
                    ...exercise,
                    id: `exercise-${index}`,
                  }));
                  initWithDraftAndLastSession(initialExercises, workout.name, k);
                }}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 text-left hover:bg-slate-800 transition-colors"
              >
                <h3 className="font-semibold text-white mb-1">{workout.name}</h3>
                <p className="text-sm text-slate-400">
                  {workout.exercises.map(ex => ex.name).join(' • ')}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const addSet = (exerciseId: string) => {
    setExercises(exercises.map(exercise =>
      exercise.id === exerciseId
        ? { ...exercise, sets: [...exercise.sets, { reps: '', weight: '' }] }
        : exercise
    ));
  };

  const updateSet = (exerciseId: string, setIndex: number, field: 'reps' | 'weight', value: string) => {
    setExercises(exercises.map(exercise =>
      exercise.id === exerciseId
        ? {
            ...exercise,
            sets: exercise.sets.map((set, index) =>
              index === setIndex ? { ...set, [field]: value } : set
            ),
          }
        : exercise
    ));
  };

  const removeExercise = (exerciseId: string) => {
    setExercises(exercises.filter(exercise => exercise.id !== exerciseId));
  };

  const addExercise = () => {
    if (newExerciseName.trim()) {
      const newExercise: Exercise = {
        id: `exercise-${Date.now()}`,
        name: newExerciseName.trim(),
        hasWeight: true,
        sets: Array.from({ length: 3 }, () => ({ reps: '', weight: '' })),
      };
      setExercises([...exercises, newExercise]);
      setNewExerciseName('');
      setIsAddingExercise(false);
    }
  };

  const cancelAddExercise = () => {
    setNewExerciseName('');
    setIsAddingExercise(false);
  };

  const finishWorkout = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const workoutData = cleanData({
        date: sessionDate,
        template: template.toLowerCase().replace(/\s+/g, ''),
        exercises: exercises.map(({ id, ...exercise }) => ({
          ...exercise,
          sets: exercise.sets.map(set => ({
            reps: parseInt(set.reps) || 0,
            weight: set.weight.trim() === '' ? null : (parseFloat(set.weight) || null),
          })),
        })),
        type: 'workout',
      });

      if (editingSession) {
        await updateDoc(doc(db, 'users', user.uid, 'workoutSessions', editingSession.id), workoutData);
      } else {
        await addDoc(collection(db, 'users', user.uid, 'workoutSessions'), {
          ...workoutData,
          createdAt: serverTimestamp(),
        });
      }

      await bumpDataVersion(user.uid);
      await bumpDataVersion(user.uid);

      if (draftKey) {
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'draftSessions', draftKey));
        } catch (_) {}
      }

      const durationMins = elapsedSecs / 60;
      setSavedSessionData({
        template,
        date: sessionDate,
        exercises,
        durationMins,
      });
      setShowPoster(true);
    } catch (error) {
      console.error('Error saving workout:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/workouts')}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">{template}</h1>
            {/* Live timer */}
            <span className="text-sm font-mono text-emerald-400">{timerDisplay}</span>
          </div>

          {/* Auto-save status indicator */}
          {!editingSession && (
            <div className="mt-1 h-4">
              {autoSaveStatus === 'saving' && (
                <span className="text-xs text-slate-500">Saving…</span>
              )}
              {autoSaveStatus === 'saved' && (
                <span className="text-xs text-slate-500">✓ Auto-saved</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* AI suggested banner */}
        {location.state?.aiWorkout && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2 text-emerald-400 text-sm">
            ✦ AI suggested · edit as needed
          </div>
        )}

        {/* Date picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>Date</span>
          <input
            type="date"
            value={sessionDate}
            max={new Date().toISOString().split('T')[0]}
            onChange={(e) => setSessionDate(e.target.value)}
            style={{
              background: '#1a2332',
              border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              color: '#e2e8f0',
              padding: '6px 10px',
              fontSize: '13px',
            }}
          />
        </div>

        {/* Last session banner */}
        {lastSessionExercises.length > 0 && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.07)',
              border: '0.5px solid rgba(16, 185, 129, 0.2)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#6ee7b7',
            }}
          >
            💡 Greyed-out numbers show your last session — enter new values to override
          </div>
        )}

        {/* Exercise cards */}
        {exercises.map((exercise, index) => (
          <div key={exercise.id} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{exercise.name}</h3>
                {exercise.note && (
                  <p className="text-sm text-slate-500 mt-1">{exercise.note}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <button
                    onClick={() => moveExercise(index, 'up')}
                    disabled={index === 0}
                    style={{
                      background: 'none', border: 'none',
                      color: index === 0 ? '#374151' : '#6b7280',
                      cursor: index === 0 ? 'default' : 'pointer',
                      padding: '2px 4px', fontSize: '12px',
                    }}
                  >▲</button>
                  <button
                    onClick={() => moveExercise(index, 'down')}
                    disabled={index === exercises.length - 1}
                    style={{
                      background: 'none', border: 'none',
                      color: index === exercises.length - 1 ? '#374151' : '#6b7280',
                      cursor: index === exercises.length - 1 ? 'default' : 'pointer',
                      padding: '2px 4px', fontSize: '12px',
                    }}
                  >▼</button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeExercise(exercise.id)}
                  className="text-slate-400 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {exercise.sets.map((set, setIndex) => {
                const ghostReps = getLastValue(exercise.name, setIndex, 'reps');
                const ghostWeight = getLastValue(exercise.name, setIndex, 'weight');
                return (
                  <div key={setIndex} className="flex items-center space-x-3">
                    <span className="text-slate-400 text-sm w-12">Set {setIndex + 1}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={ghostReps || 'Reps'}
                      value={set.reps}
                      onChange={(e) => updateSet(exercise.id, setIndex, 'reps', e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                    />
                    {(exercise.hasWeight !== false) && (
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={ghostWeight ? `${ghostWeight} kg` : 'kg'}
                        value={set.weight}
                        onChange={(e) => updateSet(exercise.id, setIndex, 'weight', e.target.value)}
                        className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => addSet(exercise.id)}
              className="mt-4 border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Set
            </Button>
          </div>
        ))}

        {/* Add Exercise Button */}
        {!isAddingExercise && (
          <Button
            variant="outline"
            onClick={() => setIsAddingExercise(true)}
            className="w-full border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Exercise
          </Button>
        )}

        {/* Add Exercise Input Row */}
        {isAddingExercise && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center space-x-3">
              <input
                type="text"
                placeholder="Exercise name"
                value={newExerciseName}
                onChange={(e) => setNewExerciseName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExercise()}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                autoFocus
              />
              <Button onClick={addExercise} size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white">
                <Check className="w-4 h-4" />
              </Button>
              <Button onClick={cancelAddExercise} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        <Button
          onClick={finishWorkout}
          disabled={isSaving}
          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3"
        >
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
        />
      )}
    </div>
  );
}