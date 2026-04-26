import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, TrendingUp, Plus, Clock, Calendar, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface WorkoutSession {
  id: string;
  date: string;
  template: string;
  duration?: number;
  exercises: Exercise[];
  createdAt: any;
}

interface Exercise {
  name: string;
  sets: Set[];
}

interface Set {
  reps: number;
  weight: number;
}

interface OneRMData {
  date: string;
  oneRM: number;
}

const workoutTemplates = [
  {
    type: 'push',
    title: 'Push Day',
    subtitle: 'Chest · Shoulders · Triceps',
    icon: ArrowUp,
  },
  {
    type: 'pull',
    title: 'Pull Day',
    subtitle: 'Back · Biceps',
    icon: ArrowDown,
  },
  {
    type: 'legs',
    title: 'Legs Day',
    subtitle: 'Quads · Hamstrings · Glutes · Calves',
    icon: TrendingUp,
  },
  {
    type: 'upper',
    title: 'Upper Body',
    subtitle: 'Chest · Back · Shoulders',
    icon: ArrowUp,
  },
  {
    type: 'lower',
    title: 'Lower Body',
    subtitle: 'Quads · Hamstrings · Glutes',
    icon: TrendingUp,
  },
];


// Epley formula for 1RM estimation
const calculateOneRM = (weight: number, reps: number): number => {
  return weight * (1 + reps / 30);
};

export default function Workouts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchSessions = async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(20)
        );
        const querySnapshot = await getDocs(q);
        const sessionData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as WorkoutSession));
        setSessions(sessionData);
      } catch (error) {
        console.error('Error fetching sessions:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, [user]);

  const startWorkout = (templateType: string) => {
    navigate('/workout-session', { state: { template: templateType } });
  };

  const getSessionStats = (session: WorkoutSession) => {
    const totalSets = session.exercises.reduce((sum, exercise) => 
      sum + exercise.sets.length, 0
    );
    return {
      exerciseCount: session.exercises.length,
      totalSets
    };
  };

  const getExerciseOneRMHistory = (exerciseName: string): OneRMData[] => {
    const oneRMData: OneRMData[] = [];
    
    sessions.forEach(session => {
      const exercise = session.exercises.find(ex => ex.name === exerciseName);
      if (exercise && exercise.sets.length > 0) {
        // Find the best set (highest estimated 1RM)
        const bestSet = exercise.sets.reduce((best, current) => {
          const bestOneRM = calculateOneRM(best.weight, best.reps);
          const currentOneRM = calculateOneRM(current.weight, current.reps);
          return currentOneRM > bestOneRM ? current : best;
        });
        
        oneRMData.push({
          date: session.date,
          oneRM: calculateOneRM(bestSet.weight, bestSet.reps)
        });
      }
    });
    
    return oneRMData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const renderOneRMChart = (exerciseName: string) => {
    const oneRMData = getExerciseOneRMHistory(exerciseName);
    
    if (oneRMData.length < 2) return null;

    const maxOneRM = Math.max(...oneRMData.map(d => d.oneRM));
    const minOneRM = Math.min(...oneRMData.map(d => d.oneRM));
    const range = maxOneRM - minOneRM || 1;

    return (
      <div className="mt-4 p-3 bg-slate-800 rounded-lg">
        <div className="text-xs text-emerald-400 font-medium mb-2">Estimated 1RM trend</div>
        <div className="h-12 flex items-end space-x-1">
          {oneRMData.map((data, index) => (
            <div
              key={index}
              className="flex-1 bg-emerald-500 rounded-t"
              style={{
                height: `${((data.oneRM - minOneRM) / range) * 80 + 20}%`
              }}
              title={`${data.oneRM.toFixed(1)} kg`}
            />
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white mb-6">Workouts</h1>

        {/* Quick Start Section */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            QUICK START
          </h2>
          
          <div className="space-y-3">
            {workoutTemplates.map((template) => {
              const Icon = template.icon;
              return (
                <button
                  key={template.type}
                  onClick={() => startWorkout(template.type)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center justify-between hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-emerald-500 rounded-lg flex items-center justify-center">
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-white">{template.title}</h3>
                      <p className="text-sm text-slate-400">{template.subtitle}</p>
                    </div>
                  </div>
                  <ArrowUp className="w-5 h-5 text-slate-400 rotate-45" />
                </button>
              );
            })}
          </div>

          <Button
            variant="outline"
            className="w-full mt-4 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => console.log('Custom workout - to be implemented')}
          >
            <Plus className="w-5 h-5 mr-2" />
            Custom Workout
          </Button>
        </div>

        {/* Recent Sessions Section */}
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            RECENT SESSIONS
          </h2>
          
          {sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((session) => {
                const stats = getSessionStats(session);
                return (
                  <button
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 text-left hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-400">
                          {new Date(session.date).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                      <span className="text-emerald-400 font-medium capitalize">
                        {session.template}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-slate-300">
                      <span>{stats.exerciseCount} exercises</span>
                      <span>•</span>
                      <span>{stats.totalSets} total sets</span>
                      {session.duration && (
                        <>
                          <span>•</span>
                          <span>{session.duration} min</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
              <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">No workouts logged</h3>
              <p className="text-slate-400 text-sm">
                Start your first workout to see your session history here
              </p>
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
                  <h2 className="text-xl font-bold text-white capitalize mb-1">
                    {selectedSession.template} Workout
                  </h2>
                  <div className="flex items-center space-x-2 text-sm text-slate-400">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {new Date(selectedSession.date).toLocaleDateString('en-US', { 
                        weekday: 'long',
                        month: 'long', 
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </span>
                    {selectedSession.duration && (
                      <>
                        <span>•</span>
                        <span>{selectedSession.duration} minutes</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSession(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                {selectedSession.exercises.map((exercise, exerciseIndex) => (
                  <div key={exerciseIndex} className="bg-slate-800 rounded-lg p-4">
                    <h3 className="font-semibold text-white mb-3">{exercise.name}</h3>
                    
                    <div className="space-y-2 mb-3">
                      {exercise.sets.map((set, setIndex) => (
                        <div key={setIndex} className="flex items-center justify-between bg-slate-700 rounded px-3 py-2">
                          <span className="text-sm text-slate-300">Set {setIndex + 1}</span>
                          <div className="flex items-center space-x-3">
                            <span className="text-sm text-white font-medium">{set.reps} reps</span>
                            <span className="text-sm text-emerald-400 font-medium">{set.weight} kg</span>
                            <span className="text-xs text-slate-400">
                              (~{calculateOneRM(set.weight, set.reps).toFixed(1)} kg 1RM)
                            </span>
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
    </div>
  );
}
