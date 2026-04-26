import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
    new Date().toISOString().split('T')[0]  // defaults to today in YYYY-MM-DD format
  );
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  // Initialize workout from template
  useEffect(() => {
    const templateType = location.state?.template;
    const editSession = location.state?.editSession;
    
    // Handle editing existing session
    if (editSession) {
      setEditingSession(editSession);
      setTemplate(editSession.template);
      setSessionDate(editSession.date || new Date().toISOString().split('T')[0]);
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

  const addExercise = () => {
    if (newExerciseName.trim()) {
      const newExercise: Exercise = {
        id: `exercise-${Date.now()}`,
        name: newExerciseName.trim(),
        hasWeight: true,
        sets: Array.from({ length: 3 }, () => ({ reps: '', weight: '' }))
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setExercises((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over?.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // SortableExercise component
const SortableExercise = ({ exercise, onAddSet, onUpdateSet, onRemove }: {
  exercise: Exercise;
  onAddSet: (exerciseId: string) => void;
  onUpdateSet: (exerciseId: string, setIndex: number, field: 'reps' | 'weight', value: string) => void;
  onRemove: (exerciseId: string) => void;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: exercise.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-white p-1"
          >
            <GripVertical className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{exercise.name}</h3>
            {exercise.note && (
              <p className="text-sm text-slate-500 mt-1">{exercise.note}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(exercise.id)}
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
              onChange={(e) => onUpdateSet(exercise.id, setIndex, 'reps', e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            {(exercise.hasWeight !== false) && (
              <input
                type="text"
                placeholder="kg"
                value={set.weight}
                onChange={(e) => onUpdateSet(exercise.id, setIndex, 'weight', e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            )}
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onAddSet(exercise.id)}
        className="mt-4 border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Set
      </Button>
    </div>
  );
};

  const finishWorkout = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const workoutData = cleanData({
        date: sessionDate,  // YYYY-MM-DD string — replace whatever is currently used for date
        template: template.toLowerCase().replace(' ', ''),
        exercises: exercises.map(({ id, ...exercise }) => ({
          ...exercise,
          sets: exercise.sets.map(set => ({
            reps: parseInt(set.reps) || 0,
            weight: set.weight.trim() === '' ? null : (parseFloat(set.weight) || null)
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={exercises.map(ex => ex.id)}
            strategy={verticalListSortingStrategy}
          >
            {exercises.map((exercise) => (
              <SortableExercise
                key={exercise.id}
                exercise={exercise}
                onAddSet={addSet}
                onUpdateSet={updateSet}
                onRemove={removeExercise}
              />
            ))}
          </SortableContext>
        </DndContext>

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
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                autoFocus
              />
              <Button
                onClick={addExercise}
                size="sm"
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                onClick={cancelAddExercise}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-white"
              >
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
    </div>
  );
}
