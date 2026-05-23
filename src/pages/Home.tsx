import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, Beaker, Target, Download, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { logHabitEntry, removeHabitLog } from '@/lib/habits';

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
  weightKg: number;
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

interface Habit {
  id: string;
  name: string;
  icon: string;
  goalType: string;
  targetValue: number;
  targetUnit?: string;
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
  'Running': { groups: ['Cardio', 'Endurance'], duration: 30 },
  'Upper': { groups: ['Chest', 'Back', 'Shoulders'], duration: 55 },
  'Lower': { groups: ['Quads', 'Hamstrings', 'Glutes'], duration: 45 },
};

// Format template string to title case display name
const formatTemplate = (t: string): string => {
  if (!t) return '';
  const map: Record<string, string> = {
    pushday: 'Push Day', pullday: 'Pull Day', legsday: 'Legs Day',
    push: 'Push', pull: 'Pull', legs: 'Legs',
    running: 'Running', upper: 'Upper Body', lower: 'Lower Body',
  };
  return map[t.toLowerCase().replace(/\s+/g, '')] || t;
};

// Short day label from YYYY-MM-DD
const shortDay = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
};

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [labResults, setLabResults] = useState<LabResults[]>([]);
  const [upcomingTests, setUpcomingTests] = useState<any[]>([]);

  // Last workout card
  const [lastSession, setLastSession] = useState<WorkoutSession | null>(null);
  const [prevSession, setPrevSession] = useState<WorkoutSession | null>(null);

  // Habits card
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitsDoneToday, setHabitsDoneToday] = useState<Record<string, boolean>>({});
  const [weeklyHabitCounts, setWeeklyHabitCounts] = useState<Record<string, number>>({});
  const todayStr = new Date().toISOString().split('T')[0];

  const toggleHabit = useCallback(async (habitId: string) => {
    if (!user) return;
    const alreadyDone = habitsDoneToday[habitId];
    try {
      if (alreadyDone) {
        await removeHabitLog(user.uid, habitId, todayStr);
        setHabitsDoneToday(prev => ({ ...prev, [habitId]: false }));
      } else {
        await logHabitEntry(user.uid, habitId, todayStr, 1);
        setHabitsDoneToday(prev => ({ ...prev, [habitId]: true }));
      }
    } catch (e) {
      console.error('Error toggling habit:', e);
    }
  }, [user, habitsDoneToday, todayStr]);

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

        // Last workout + previous for delta
        if (sessions.length > 0) {
          setLastSession(sessions[0]);
          // Find previous session of same template type
          const lastType = sessions[0].template;
          const prev = sessions.slice(1).find(s => s.template === lastType);
          setPrevSession(prev || null);
        }

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

        // Fetch upcoming tests
        const testsQuery = query(
          collection(db, 'users', user.uid, 'tests'),
          orderBy('nextDueDate', 'asc')
        );
        const testsSnapshot = await getDocs(testsQuery);
        const tests = testsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as any));

        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const upcoming = tests.filter(test => {
          if (!test.nextDueDate) return false;
          const dueDate = new Date(test.nextDueDate);
          return dueDate <= thirtyDaysFromNow;
        });
        upcoming.sort((a, b) => new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime());
        setUpcomingTests(upcoming);

        // Fetch habits
        try {
          const habitsSnap = await getDocs(collection(db, 'users', user.uid, 'habits'));
          const habitsData = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Habit));
          setHabits(habitsData);

          // Today's logs + this week's counts
          const doneMap: Record<string, boolean> = {};
          const weekCountMap: Record<string, number> = {};

          // Week start (Monday)
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
          weekStart.setHours(0, 0, 0, 0);
          const weekStartStr = weekStart.toISOString().split('T')[0];

          for (const habit of habitsData) {
            // Today's log
            const todayLogSnap = await getDocs(
              query(
                collection(db, 'users', user.uid, 'habits', habit.id, 'logs'),
                where('date', '==', todayStr)
              )
            );
            doneMap[habit.id] = !todayLogSnap.empty;

            // This week's log count
            const weekLogsSnap = await getDocs(
              query(
                collection(db, 'users', user.uid, 'habits', habit.id, 'logs'),
                where('date', '>=', weekStartStr),
                where('date', '<=', todayStr)
              )
            );
            weekCountMap[habit.id] = weekLogsSnap.size;
          }

          setHabitsDoneToday(doneMap);
          setWeeklyHabitCounts(weekCountMap);
        } catch (_) {
          // Habits are optional — silently skip if collection doesn't exist
        }

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
    const lastTemplate = workoutSessions[0].template;
    const rotation: { [key: string]: string } = {
      'Push': 'Pull', 'pull': 'Legs', 'Pull': 'Legs',
      'Legs': 'Running', 'legs': 'Running',
      'Running': 'Push', 'running': 'Push',
      'pushday': 'Pull', 'pullday': 'Legs', 'legsday': 'Running',
    };
    return rotation[lastTemplate] || 'Push';
  };

  const calculateStreak = () => {
    if (workoutSessions.length === 0) return { weeks: 0, weeklyData: [], thisWeekDays: [] };

    // This week's workout days (Mon–Sun)
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const thisWeekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dayStr = d.toISOString().split('T')[0];
      const hasWorkout = workoutSessions.some(s => s.date === dayStr);
      return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), hasWorkout, isFuture: d > now };
    });

    // Weekly streak (8 weeks)
    const weeklyData: boolean[] = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const count = workoutSessions.filter(s => {
        const d = new Date(s.date);
        return d >= weekStart && d <= weekEnd;
      }).length;
      weeklyData.push(count >= 3);
    }

    const thisWeekCount = thisWeekDays.filter(d => d.hasWorkout).length;

    let consecutiveWeeks = 0;
    for (let i = weeklyData.length - 1; i >= 0; i--) {
      if (weeklyData[i]) consecutiveWeeks++;
      else break;
    }

    return { weeks: consecutiveWeeks, weeklyData: weeklyData.slice().reverse(), thisWeekDays, thisWeekCount };
  };

  const getBodyCompDelta = () => {
    if (bodyStats.length < 2) return null;
    const current = bodyStats[0];
    const previous = bodyStats[1];
    const currentWeight = current.weightKg != null ? Number(current.weightKg) : null;
    const previousWeight = previous.weightKg != null ? Number(previous.weightKg) : null;
    if (currentWeight == null || previousWeight == null || isNaN(currentWeight) || isNaN(previousWeight)) return null;
    const weightDelta = currentWeight - previousWeight;
    return { value: weightDelta, isImprovement: weightDelta < 0, current: currentWeight };
  };

  const getBodyCompStats = () => {
    if (bodyStats.length === 0) return null;
    const cur = bodyStats[0];
    const prev = bodyStats.length > 1 ? bodyStats[1] : null;

    const weight = cur.weightKg != null ? Number(cur.weightKg) : null;
    const pbf = cur.pbf != null ? Number(cur.pbf) : null;
    const smm = cur.smm != null ? Number(cur.smm) : null;

    const weightDelta = prev && prev.weightKg != null && weight != null
      ? weight - Number(prev.weightKg) : null;
    const pbfDelta = prev && prev.pbf != null && pbf != null
      ? pbf - Number(prev.pbf) : null;
    const smmDelta = prev && prev.smm != null && smm != null
      ? smm - Number(prev.smm) : null;

    return { weight, pbf, smm, weightDelta, pbfDelta, smmDelta };
  };

  const getFatLossStatus = () => {
    if (bodyStats.length < 2) return 'hold';
    const cur = bodyStats[0]; const prev = bodyStats[1];
    const cw = cur.weightKg != null ? Number(cur.weightKg) : null;
    const cp = cur.pbf != null ? Number(cur.pbf) : null;
    const pw = prev.weightKg != null ? Number(prev.weightKg) : null;
    const pp = prev.pbf != null ? Number(prev.pbf) : null;
    if (cw == null || cp == null || pw == null || pp == null) return 'hold';
    const change = (cw * cp / 100) - (pw * pp / 100);
    if (change < -0.5) return 'improving';
    if (change > 0.5) return 'focus';
    return 'hold';
  };

  const getMuscleStatus = () => {
    if (bodyStats.length < 2) return 'steady';
    const cur = bodyStats[0].smm != null ? Number(bodyStats[0].smm) : null;
    const pre = bodyStats[1].smm != null ? Number(bodyStats[1].smm) : null;
    if (cur == null || pre == null) return 'steady';
    const change = cur - pre;
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
      const key = test.testName.toLowerCase().replace(/\s+/g, '');
      const range = labRanges[key];
      if (range) {
        if (key === 'hdl') { if (test.value < range.min) outOfRangeCount++; }
        else { if (test.value < range.min || test.value > range.max) outOfRangeCount++; }
      }
    });
    return { date: latest.date, outOfRangeCount, totalTests: latest.results.length };
  };

  // Delta badge for last workout exercises
  const getExerciseDelta = (exerciseName: string, lastExs: any[], prevExs: any[]) => {
    if (!prevExs?.length) return null;
    const lastEx = lastExs?.find((e: any) => e.name?.toLowerCase() === exerciseName.toLowerCase());
    const prevEx = prevExs?.find((e: any) => e.name?.toLowerCase() === exerciseName.toLowerCase());
    if (!lastEx?.sets?.length || !prevEx?.sets?.length) return null;
    const lastWeight = lastEx.sets[lastEx.sets.length - 1]?.weight;
    const prevWeight = prevEx.sets[prevEx.sets.length - 1]?.weight;
    if (lastWeight == null || prevWeight == null) return null;
    const diff = Number(lastWeight) - Number(prevWeight);
    if (isNaN(diff)) return null;
    return diff;
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
  const bodyCompStats = getBodyCompStats();
  const fatLossStatus = getFatLossStatus();
  const muscleStatus = getMuscleStatus();
  const labStatus = getLabStatus();
  const habitsDoneCount = Object.values(habitsDoneToday).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Hey, {getFirstName()}</h1>
            <p className="text-slate-400 text-sm">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
              })}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate('/export')}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <Download className="w-5 h-5 text-slate-400" />
            </button>
            <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                getUserInitial()
              )}
            </div>
          </div>
        </div>

        {/* Upcoming Tests Alert — slim banner */}
        {upcomingTests.length > 0 && (
          <div
            onClick={() => navigate('/labs')}
            className="flex items-center justify-between bg-amber-500/8 border border-amber-500/25 rounded-xl px-4 py-3 mb-4 cursor-pointer"
            style={{ background: 'rgba(245,158,11,0.08)' }}
          >
            <span className="text-amber-400 text-sm">
              🔔 {upcomingTests.length} lab test{upcomingTests.length > 1 ? 's' : ''} due soon
            </span>
            <span className="text-xs bg-amber-500 text-white rounded-full px-2 py-0.5 font-medium">View</span>
          </div>
        )}

        {/* ── 1. BODY COMP — moved to top ── */}
        {bodyStats.length > 0 && (
          <button
            onClick={() => navigate('/body')}
            className="w-full bg-slate-900 rounded-xl p-5 border border-slate-800 mb-4 text-left hover:border-emerald-500/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400 text-xs font-bold tracking-wider">BODY COMP</span>
              </div>
              <span className="text-slate-500 text-xs">Tap →</span>
            </div>

            <div className="flex gap-3 mb-3">
              {/* Weight */}
              <div className="flex-1 bg-slate-800/60 rounded-lg p-3">
                <div className="text-slate-400 text-xs mb-1">Weight</div>
                <div className="text-white font-semibold text-base">
                  {bodyCompStats?.weight != null ? `${bodyCompStats.weight} kg` : '--'}
                </div>
                {bodyCompStats?.weightDelta != null && (
                  <div className={`text-xs mt-0.5 ${bodyCompStats.weightDelta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {bodyCompStats.weightDelta > 0 ? '▲' : '▼'} {Math.abs(bodyCompStats.weightDelta).toFixed(1)} kg
                  </div>
                )}
              </div>
              {/* Body fat */}
              {bodyCompStats?.pbf != null && (
                <div className="flex-1 bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Body fat</div>
                  <div className="text-white font-semibold text-base">{bodyCompStats.pbf}%</div>
                  {bodyCompStats.pbfDelta != null && (
                    <div className={`text-xs mt-0.5 ${bodyCompStats.pbfDelta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {bodyCompStats.pbfDelta > 0 ? '▲' : '▼'} {Math.abs(bodyCompStats.pbfDelta).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
              {/* Muscle */}
              {bodyCompStats?.smm != null && (
                <div className="flex-1 bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Muscle</div>
                  <div className="text-white font-semibold text-base">{bodyCompStats.smm} kg</div>
                  {bodyCompStats.smmDelta != null && (
                    <div className={`text-xs mt-0.5 ${bodyCompStats.smmDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {bodyCompStats.smmDelta > 0 ? '▲' : '▼'} {Math.abs(bodyCompStats.smmDelta).toFixed(1)} kg
                    </div>
                  )}
                </div>
              )}
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

        {/* ── 2. TODAY'S HABITS ── */}
        {habits.length > 0 && (
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-violet-400 text-xs font-bold tracking-wider">TODAY'S HABITS</span>
              <button
                onClick={() => navigate('/wellness')}
                className="text-slate-500 text-xs hover:text-slate-300 transition-colors"
              >
                Tap →
              </button>
            </div>

            <div className="space-y-1 mb-3">
              {habits.slice(0, 4).map(habit => {
                const done = habitsDoneToday[habit.id] || false;
                const weekCount = weeklyHabitCounts[habit.id] || 0;
                const isTimesPerWeek = habit.goalType === 'times_per_week';
                const subText = isTimesPerWeek
                  ? `${weekCount}/${habit.targetValue} this week`
                  : done ? 'Done today' : 'Not done yet';

                return (
                  <div
                    key={habit.id}
                    className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-base">
                        {habit.icon || '💪'}
                      </div>
                      <div>
                        <div className="text-sm text-slate-200 font-medium">{habit.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{subText}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleHabit(habit.id)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                        done
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'bg-transparent border border-slate-600 hover:border-emerald-500'
                      }`}
                      aria-label={`Mark ${habit.name} done`}
                    >
                      {done && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${habits.length > 0 ? (habitsDoneCount / habits.length) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {habitsDoneCount} / {habits.length} done today
              </span>
            </div>
          </div>
        )}

        {/* ── 3. TODAY'S WORKOUT ── */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <Target className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400 text-xs font-bold tracking-wider">TODAY'S WORKOUT</span>
              </div>
              {suggestedWorkout ? (
                <>
                  <div className="text-lg font-semibold text-white">{suggestedWorkout}</div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.groups.join(', ')} ·{' '}
                    ~{workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.duration} min
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-semibold text-white">Start your first workout</div>
                  <div className="text-sm text-slate-400 mt-0.5">Choose a template to get started</div>
                </>
              )}
            </div>
          </div>

          <button
            onClick={() =>
              suggestedWorkout === 'Running'
                ? navigate('/running-session')
                : navigate('/workout-session', {
                    state: {
                      template: suggestedWorkout?.toLowerCase().replace(' ', '') || '',
                    },
                  })
            }
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {suggestedWorkout ? `Start ${suggestedWorkout} →` : 'Choose Template →'}
          </button>
        </div>

        {/* ── 4. LAST WORKOUT SUMMARY — new ── */}
        {lastSession && lastSession.exercises?.length > 0 && (
          <button
            onClick={() => navigate('/workouts')}
            className="w-full bg-slate-900 rounded-xl p-5 border border-slate-800 mb-4 text-left hover:border-emerald-500/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-emerald-400 text-xs font-bold tracking-wider">
                LAST WORKOUT · {formatTemplate(lastSession.template)} · {shortDay(lastSession.date)}
              </span>
              <span className="text-slate-500 text-xs">Tap →</span>
            </div>

            <div className="space-y-0">
              {lastSession.exercises.slice(0, 3).map((ex: any, i: number) => {
                const delta = getExerciseDelta(
                  ex.name,
                  lastSession.exercises,
                  prevSession?.exercises || []
                );
                const lastSet = ex.sets?.[ex.sets.length - 1];
                const lastWeight = lastSet?.weight;
                const lastReps = lastSet?.reps;

                return (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0"
                  >
                    <div>
                      <div className="text-sm text-slate-200">{ex.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {ex.sets?.length || 0} sets
                        {lastReps ? ` · ${lastReps} reps` : ''}
                        {lastWeight ? ` · ${lastWeight} kg` : ''}
                      </div>
                    </div>
                    {delta !== null && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        delta > 0
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : delta === 0
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}>
                        {delta > 0 ? `+${delta} kg` : delta === 0 ? 'same' : `${delta} kg`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-right mt-2">
              <span className="text-xs text-slate-600">Tap to see full session →</span>
            </div>
          </button>
        )}

        {/* ── 5. STREAK ── */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 text-xs font-bold tracking-wider">WORKOUT STREAK</span>
            </div>
          </div>

          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-2xl font-bold text-white">
                {streakData.weeks}{' '}
                <span className="text-sm font-normal text-slate-400">weeks</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {streakData.weeks === 0
                  ? 'Log 3+ sessions/week to build a streak'
                  : '3+ workouts/week'}
              </div>
            </div>
            {'thisWeekCount' in streakData && (
              <span className="text-xs text-emerald-400">
                {(streakData as any).thisWeekCount} done this week
              </span>
            )}
          </div>

          {/* Day-level bars for current week */}
          {'thisWeekDays' in streakData && (
            <div className="flex gap-1 mb-1">
              {(streakData as any).thisWeekDays.map((day: any, i: number) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-sm transition-all ${
                      day.hasWorkout
                        ? 'bg-emerald-500'
                        : day.isFuture
                        ? 'bg-slate-800'
                        : 'bg-slate-700'
                    }`}
                    style={{ height: '6px' }}
                  />
                  <span className="text-slate-600" style={{ fontSize: '9px' }}>{day.label.slice(0, 2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 6. LABS ── */}
        <button
          onClick={() => navigate('/labs')}
          className="w-full bg-slate-900 rounded-xl p-5 border border-slate-800 text-left hover:border-emerald-500/50 transition-colors mb-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Beaker className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 text-xs font-bold tracking-wider">LABS</span>
            </div>
            <span className="text-slate-500 text-xs">Tap →</span>
          </div>

          {labStatus ? (
            <div>
              <div className="text-xs text-slate-400 mb-1">
                Latest: {new Date(labStatus.date).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric'
                })}
              </div>
              <div className={`text-sm font-medium ${
                labStatus.outOfRangeCount > 0 ? 'text-red-400' : 'text-emerald-400'
              }`}>
                {labStatus.outOfRangeCount > 0
                  ? `${labStatus.outOfRangeCount} marker${labStatus.outOfRangeCount > 1 ? 's' : ''} out of range`
                  : 'All markers in range'}
              </div>
            </div>
          ) : (
            <div className="text-slate-400">
              <p className="text-sm mb-1">No lab results yet</p>
              <p className="text-xs">Track your yearly blood tests</p>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}