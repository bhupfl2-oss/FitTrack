import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, Beaker, Target } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface WorkoutSession {
  id: string;
  date: string;
  template: string;
  duration?: number;
  exercises: any[];
  createdAt: any;
}

interface BodyStats {
  id: string;
  date: string;
  weight: number;
  pbf: number;
  smm?: number;
  createdAt: any;
}

interface LabTest {
  testName: string;
  value: number;
  unit: string;
}

interface LabResults {
  id: string;
  date: string;
  results: LabTest[];
  createdAt: any;
}

const labRanges: { [key: string]: { min: number; max: number } } = {
  tsh: { min: 0.4, max: 4.0 },
  vitd: { min: 30, max: 100 },
  b12: { min: 200, max: 900 },
  hb: { min: 13.5, max: 17.5 },
  hba1c: { min: 4, max: 5.6 },
  totalcholesterol: { min: 0, max: 200 },
  ldl: { min: 0, max: 100 },
  hdl: { min: 40, max: 1000 },
  triglycerides: { min: 0, max: 150 },
  creatinine: { min: 0.7, max: 1.3 },
};

const workoutTemplates = {
  'Push': { groups: ['Chest', 'Shoulders', 'Triceps'], duration: 45 },
  'Pull': { groups: ['Back', 'Biceps'], duration: 40 },
  'Legs': { groups: ['Quads', 'Hamstrings', 'Glutes', 'Calves'], duration: 50 },
};

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [labResults, setLabResults] = useState<LabResults[]>([]);

  useEffect(() => {
    if (!user) return;

    const fetchAllData = async () => {
      try {
        // Fetch workout sessions
        const workoutsQuery = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const workoutsSnapshot = await getDocs(workoutsQuery);
        const sessions = workoutsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as WorkoutSession));
        setWorkoutSessions(sessions);

        // Fetch body stats
        const bodyQuery = query(
          collection(db, 'users', user.uid, 'bodyComp'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const bodySnapshot = await getDocs(bodyQuery);
        const stats = bodySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as BodyStats));
        setBodyStats(stats);

        // Fetch lab results
        const labsQuery = query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'),
          limit(10)
        );
        const labsSnapshot = await getDocs(labsQuery);
        const labs = labsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as LabResults));
        setLabResults(labs);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, [user]);

  const getSuggestedWorkout = () => {
    if (workoutSessions.length === 0) return null;
    
    const lastSession = workoutSessions[0];
    const lastTemplate = lastSession.template;
    
    const rotation: { [key: string]: string } = {
      'Push': 'Pull',
      'Pull': 'Legs',
      'Legs': 'Push',
    };
    
    return rotation[lastTemplate] || 'Push';
  };

  const calculateStreak = () => {
    if (workoutSessions.length === 0) return { weeks: 0, weeklyData: [] };
    
    const weeklyData: boolean[] = [];
    const now = new Date();
    
    // Get last 8 weeks of data
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      
      const sessionsInWeek = workoutSessions.filter(session => {
        const sessionDate = new Date(session.date);
        return sessionDate >= weekStart && sessionDate <= weekEnd;
      });
      
      weeklyData.push(sessionsInWeek.length >= 3);
    }
    
    const consecutiveWeeks = weeklyData.reduce((count, hasWorkouts, index) => {
      if (hasWorkouts && (index === weeklyData.length - 1 || weeklyData[index + 1])) {
        return count + 1;
      }
      return count;
    }, 0);
    
    return { weeks: consecutiveWeeks, weeklyData: weeklyData.slice().reverse() };
  };

  const getBodyCompDelta = () => {
    if (bodyStats.length < 2) return null;
    
    const current = bodyStats[0];
    const previous = bodyStats[1];
    
    const weightDelta = current.weight - previous.weight;
    const isImprovement = weightDelta < 0; // Weight loss is improvement
    
    return {
      value: weightDelta,
      isImprovement,
      current: current.weight,
      previous: previous.weight
    };
  };

  const getFatLossStatus = () => {
    if (bodyStats.length < 2) return 'hold';
    
    const current = bodyStats[0];
    const previous = bodyStats[1];
    
    const currentFatMass = current.weight * (current.pbf / 100);
    const previousFatMass = previous.weight * (previous.pbf / 100);
    
    const change = currentFatMass - previousFatMass;
    
    if (change < -0.5) return 'improving';
    if (change > 0.5) return 'focus';
    return 'hold';
  };

  const getMuscleStatus = () => {
    if (bodyStats.length < 2 || !bodyStats[0].smm || !bodyStats[1].smm) return 'steady';
    
    const current = bodyStats[0].smm!;
    const previous = bodyStats[1].smm!;
    
    const change = current - previous;
    
    if (change > 0.5) return 'strong';
    if (change < -0.5) return 'improve';
    return 'steady';
  };

  const getLabStatus = () => {
    if (labResults.length === 0) return null;
    
    const latest = labResults[0];
    if (!latest.results || !Array.isArray(latest.results)) return null;
    
    let outOfRangeCount = 0;
    
    latest.results.forEach(test => {
      const metricKey = test.testName.toLowerCase().replace(/\s+/g, '');
      const range = labRanges[metricKey];
      
      if (range) {
        if (metricKey === 'hdl') {
          if (test.value < range.min) outOfRangeCount++;
        } else {
          if (test.value < range.min || test.value > range.max) outOfRangeCount++;
        }
      }
    });
    
    return {
      date: latest.date,
      outOfRangeCount,
      totalTests: latest.results.length
    };
  };

  const getFirstName = () => {
    if (!user?.displayName) return 'there';
    return user.displayName.split(' ')[0];
  };

  const getUserInitial = () => {
    if (user?.photoURL) return null;
    if (!user?.displayName) return 'U';
    return user.displayName.charAt(0).toUpperCase();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  const suggestedWorkout = getSuggestedWorkout();
  const streakData = calculateStreak();
  const bodyDelta = getBodyCompDelta();
  const fatLossStatus = getFatLossStatus();
  const muscleStatus = getMuscleStatus();
  const labStatus = getLabStatus();

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">
              Hey, {getFirstName()}
            </h1>
            <p className="text-slate-400 text-sm">
              {new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'long', 
                day: 'numeric',
                year: 'numeric'
              })}
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Avatar" className="w-12 h-12 rounded-full object-cover" />
            ) : (
              getUserInitial()
            )}
          </div>
        </div>

        {/* Today's Workout Card */}
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white mb-1">Today's Workout</h2>
              {suggestedWorkout ? (
                <div>
                  <div className="flex items-center space-x-2 mb-2">
                    <Target className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">{suggestedWorkout}</span>
                  </div>
                  <div className="text-sm text-slate-400">
                    {workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.groups.join(', ')} • 
                    ~{workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.duration} min
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-slate-400 mb-2">Start your first workout</p>
                  <div className="text-sm text-slate-500">
                    Choose a template to get started
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <button
            onClick={() => navigate('/workout-session')}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {suggestedWorkout ? 'Start Workout →' : 'Choose Template →'}
          </button>
        </div>

        {/* Streak Card */}
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-bold tracking-wider">STREAK</span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">
                {streakData.weeks} weeks
              </div>
              <div className="text-sm text-slate-400">
                3+ workouts/week
              </div>
            </div>
          </div>
          
          {/* Weekly Visualization */}
          <div className="flex items-end space-x-1 h-8">
            {streakData.weeklyData.map((week, index) => (
              <div
                key={index}
                className={`flex-1 rounded-t ${
                  week ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
                style={{ height: `${week ? 100 : 30}%` }}
              />
            ))}
          </div>
        </div>

        {/* Latest Body Comp Card */}
        {bodyStats.length > 0 && (
          <button
            onClick={() => navigate('/body')}
            className="w-full bg-slate-900 rounded-lg p-6 border border-slate-800 mb-4 text-left hover:border-emerald-500 transition-colors"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-bold tracking-wider">BODY COMP</span>
              </div>
              <span className="text-slate-400 text-sm">Tap →</span>
            </div>
            
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-2xl font-bold text-white mb-1">
                  {bodyStats[0].weight} kg
                </div>
                {bodyDelta && (
                  <div className={`flex items-center space-x-1 ${
                    bodyDelta.isImprovement ? 'text-emerald-500' : 'text-red-500'
                  }`}>
                    {bodyDelta.isImprovement ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                    <span className="text-sm">
                      {bodyDelta.isImprovement ? '-' : '+'}{Math.abs(bodyDelta.value).toFixed(1)} kg
                    </span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex space-x-2">
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                fatLossStatus === 'improving' 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : fatLossStatus === 'hold'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                Fat Loss: {fatLossStatus === 'improving' ? 'Improving' : fatLossStatus === 'hold' ? 'Hold' : 'Focus'}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                muscleStatus === 'strong' 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : muscleStatus === 'steady'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                Muscle: {muscleStatus === 'strong' ? 'Strong' : muscleStatus === 'steady' ? 'Steady' : 'Improve'}
              </div>
            </div>
          </button>
        )}

        {/* Latest Labs Card */}
        {labResults.length > 0 ? (
          <button
            onClick={() => navigate('/labs')}
            className="w-full bg-slate-900 rounded-lg p-6 border border-slate-800 text-left hover:border-emerald-500 transition-colors"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Beaker className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-bold tracking-wider">LABS</span>
              </div>
              <span className="text-slate-400 text-sm">Tap →</span>
            </div>
            
            {labStatus && (
              <div>
                <div className="text-sm text-slate-400 mb-2">
                  Latest: {new Date(labStatus.date).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </div>
                <div className={`text-sm font-medium ${
                  labStatus.outOfRangeCount > 0 ? 'text-red-400' : 'text-emerald-400'
                }`}>
                  {labStatus.outOfRangeCount > 0 
                    ? `${labStatus.outOfRangeCount} marker${labStatus.outOfRangeCount > 1 ? 's' : ''} out of range`
                    : 'All markers in range'
                  }
                </div>
              </div>
            )}
          </button>
        ) : (
          <button
            onClick={() => navigate('/labs')}
            className="w-full bg-slate-900 rounded-lg p-6 border border-slate-800 text-left hover:border-emerald-500 transition-colors"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Beaker className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-bold tracking-wider">LABS</span>
              </div>
              <span className="text-slate-400 text-sm">Tap →</span>
            </div>
            
            <div className="text-slate-400">
              <p className="text-sm mb-1">No lab results yet</p>
              <p className="text-xs">Track your yearly blood tests</p>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
