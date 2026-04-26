import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

interface Exercise {
  id: string;
  name: string;
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
      { name: 'Bench Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Overhead Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Incline Dumbbell Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Tricep Pushdown', sets: [{ reps: '', weight: '' }] },
      { name: 'Lateral Raise', sets: [{ reps: '', weight: '' }] },
    ],
  },
  pull: {
    name: 'Pull Day',
    exercises: [
      { name: 'Deadlift', sets: [{ reps: '', weight: '' }] },
      { name: 'Pull-ups', sets: [{ reps: '', weight: '' }] },
      { name: 'Barbell Row', sets: [{ reps: '', weight: '' }] },
      { name: 'Face Pull', sets: [{ reps: '', weight: '' }] },
      { name: 'Bicep Curl', sets: [{ reps: '', weight: '' }] },
    ],
  },
  legs: {
    name: 'Legs Day',
    exercises: [
      { name: 'Squat', sets: [{ reps: '', weight: '' }] },
      { name: 'Romanian Deadlift', sets: [{ reps: '', weight: '' }] },
      { name: 'Leg Press', sets: [{ reps: '', weight: '' }] },
      { name: 'Leg Curl', sets: [{ reps: '', weight: '' }] },
      { name: 'Calf Raise', sets: [{ reps: '', weight: '' }] },
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

  // Initialize workout from template
  useEffect(() => {
    const templateType = location.state?.template;
    const editSession = location.state?.editSession;
    
    // Handle editing existing session
    if (editSession) {
      setEditingSession(editSession);
      setTemplate(editSession.template);
      setExercises(
        editSession.exercises?.map((exercise: any, index: number) => ({
          id: `exercise-${index}`,
          name: exercise.name,
          sets: exercise.sets || [{ reps: '', weight: '' }]
        })) || []
      );
    }
    // Handle custom workouts
    else if (templateType === 'custom' && location.state?.customWorkout) {
      const customWorkout = location.state.customWorkout;
      setTemplate(customWorkout.name);
      setExercises(
        customWorkout.exercises.map((exercise: any, index: number) => ({
          id: `exercise-${index}`,
          name: exercise.name,
          sets: Array.from({ length: exercise.defaultSets || 3 }, () => ({
            reps: '',
            weight: ''
          }))
        }))
      );
    }
    // Handle default template workouts
    else if (templateType && workoutTemplates[templateType]) {
      const workoutTemplate = workoutTemplates[templateType];
      setTemplate(workoutTemplate.name);
      setExercises(
        workoutTemplate.exercises.map((exercise, index) => ({
          ...exercise,
          id: `exercise-${index}`,
        }))
      );
    }
  }, [location.state]);

  // Show template selection if no template is provided
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
                  setTemplate(workout.name);
                  setExercises(
                    workout.exercises.map((exercise, index) => ({
                      ...exercise,
                      id: `exercise-${index}`,
                    }))
                  );
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
            )
          }
        : exercise
    ));
  };

  const removeExercise = (exerciseId: string) => {
    setExercises(exercises.filter(exercise => exercise.id !== exerciseId));
  };

  const finishWorkout = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const workoutData = cleanData({
        date: new Date().toISOString().split('T')[0],
        template: template.toLowerCase().replace(' ', ''),
        exercises: exercises.map(({ id, ...exercise }) => ({
          ...exercise,
          sets: exercise.sets.map(set => ({
            reps: parseInt(set.reps) || 0,
            weight: parseFloat(set.weight) || 0
          }))
        })),
        type: 'workout',
      });

      if (editingSession) {
        // Update existing session
        await updateDoc(doc(db, 'users', user.uid, 'workoutSessions', editingSession.id), workoutData);
      } else {
        // Create new session
        await addDoc(collection(db, 'users', user.uid, 'workoutSessions'), { ...workoutData, createdAt: serverTimestamp() });
      }
      
      navigate('/workouts');
    } catch (error) {
      console.error('Error saving workout:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
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
          <h1 className="text-2xl font-bold text-white">{template}</h1>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {exercises.map((exercise) => (
          <div key={exercise.id} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">{exercise.name}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeExercise(exercise.id)}
                className="text-slate-400 hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-3">
              {exercise.sets.map((set, setIndex) => (
                <div key={setIndex} className="flex items-center space-x-3">
                  <span className="text-slate-400 text-sm w-12">Set {setIndex + 1}</span>
                  <input
                    type="text"
                    placeholder="Reps"
                    value={set.reps}
                    onChange={(e) => updateSet(exercise.id, setIndex, 'reps', e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <input
                    type="text"
                    placeholder="Weight (kg)"
                    value={set.weight}
                    onChange={(e) => updateSet(exercise.id, setIndex, 'weight', e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
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

        <Button
          onClick={finishWorkout}
          disabled={isSaving}
          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3"
        >
          {isSaving ? 'Saving...' : 'Finish Workout'}
          <Check className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
