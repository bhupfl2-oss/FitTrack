import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Download, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
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

const muscleGroupMap: Record<string, string[]> = {
  push: ['Push', 'Chest', 'Shoulders', 'Triceps'],
  pushday: ['Push', 'Chest', 'Shoulders', 'Triceps'],
  pull: ['Pull', 'Back', 'Biceps'],
  pullday: ['Pull', 'Back', 'Biceps'],
  legs: ['Legs', 'Quads', 'Hamstrings', 'Glutes'],
  legsday: ['Legs', 'Quads', 'Hamstrings', 'Glutes'],
  upper: ['Push', 'Pull', 'Chest', 'Back'],
  lower: ['Legs', 'Quads', 'Hamstrings'],
  running: ['Cardio'],
};

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [labResults, setLabResults] = useState<LabResults[]>([]);
  const [upcomingTests, setUpcomingTests] = useState<any[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitsDoneToday, setHabitsDoneToday] = useState<Record<string, boolean>>({});
  const [weeklyHabitCounts, setWeeklyHabitCounts] = useState<Record<string, number>>({});
  const todayStr = new Date().toISOString().split('T')[0];

  const [muscleAlert, setMuscleAlert] = useState<{ group: string; daysSince: number } | null>(null);
  const [aiInsights, setAiInsights] = useState<{ workout: string; food: string; labs: string } | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [insightIndex, setInsightIndex] = useState(0);

  const insightTopics = ['workout', 'food', 'labs'] as const;
  const insightColors: Record<typeof insightTopics[number], { bg: string; border: string; text: string }> = {
    workout: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400' },
    food: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400' },
    labs: { bg: 'bg-purple-500/5', border: 'border-purple-500/20', text: 'text-purple-400' },
  };
  const insightDotColors: Record<typeof insightTopics[number], string> = {
    workout: 'bg-emerald-400',
    food: 'bg-blue-400',
    labs: 'bg-purple-400',
  };

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

  const getMuscleGroupAlert = (sessions: WorkoutSession[]) => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const recentSessions = sessions.filter(s => new Date(s.date) >= fourteenDaysAgo);
    const groupLastDates: Record<string, Date | null> = { Push: null, Pull: null, Legs: null };
    for (const session of recentSessions) {
      const template = session.template?.toLowerCase().replace(/\s+/g, '') || '';
      const mapped = muscleGroupMap[template] || [];
      for (const group of ['Push', 'Pull', 'Legs'] as const) {
        if (mapped.includes(group)) {
          const sessionDate = new Date(session.date);
          if (!groupLastDates[group] || sessionDate > groupLastDates[group]!) {
            groupLastDates[group] = sessionDate;
          }
        }
      }
    }
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    let mostNeglected: { group: string; daysSince: number } | null = null;
    for (const group of ['Push', 'Pull', 'Legs'] as const) {
      const lastDate = groupLastDates[group];
      if (!lastDate || lastDate < tenDaysAgo) {
        const daysSince = lastDate
          ? Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000))
          : 999;
        if (!mostNeglected || daysSince > mostNeglected.daysSince) {
          mostNeglected = { group, daysSince };
        }
      }
    }
    return mostNeglected;
  };

  const calculateAge = (dob: string) => {
    if (!dob) return null;
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  };

  const fetchAIInsights = useCallback(async () => {
    if (!user) return;
    setIsLoadingInsights(true);
    try {
      const cacheRef = doc(db, 'users', user.uid, 'aiInsights', 'daily');
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        const cached = cacheSnap.data() as { insights: { workout: string; food: string; labs: string }; generatedAt: string };
        const ageHours = (Date.now() - new Date(cached.generatedAt).getTime()) / 3600000;
        if (ageHours < 24) {
          setAiInsights(cached.insights);
          setIsLoadingInsights(false);
          return;
        }
      }

      const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
      const profileData = profileSnap.exists() ? profileSnap.data() as any : null;
      const contextParts: string[] = [];

      if (profileData) {
        const age = calculateAge(profileData.dob);
        const parts = [
          profileData.name && `Name: ${profileData.name}`,
          age && `Age: ${age}`,
          profileData.gender && `Gender: ${profileData.gender}`,
          profileData.foodPreference && `Diet: ${profileData.foodPreference}`,
          profileData.activityLevel && `Activity: ${profileData.activityLevel}`,
          profileData.primaryGoal && `Goal: ${profileData.primaryGoal}`,
          profileData.chronicConditions?.length && `Conditions: ${profileData.chronicConditions.join(', ')}`,
        ].filter(Boolean) as string[];
        if (parts.length) contextParts.push('PROFILE:\n' + parts.join('\n'));
      }

      if (bodyStats.length > 0) {
        const cur = bodyStats[0];
        const prev = bodyStats.length > 1 ? bodyStats[1] : null;
        const parts = [
          cur.weightKg != null && `Weight: ${cur.weightKg} kg`,
          cur.pbf != null && `PBF: ${cur.pbf}%`,
          cur.smm != null && `SMM: ${cur.smm} kg`,
          prev?.weightKg != null && cur.weightKg != null && `Weight change: ${(cur.weightKg - prev.weightKg).toFixed(1)} kg`,
        ].filter(Boolean) as string[];
        if (parts.length) contextParts.push('BODY STATS:\n' + parts.join('\n'));
      }

      if (workoutSessions.length > 0) {
        const last3 = workoutSessions.slice(0, 3);
        contextParts.push('LAST 3 WORKOUTS:\n' + last3.map(s => `- ${s.date}: ${s.template}`).join('\n'));
      }

      if (labResults.length > 0) {
        const latest = labResults[0];
        if (latest.results && Array.isArray(latest.results)) {
          const outOfRange = latest.results.filter((test: LabTest) => {
            const key = test.testName.toLowerCase().replace(/\s+/g, '');
            const range = labRanges[key];
            if (!range) return false;
            if (key === 'hdl') return test.value < range.min;
            return test.value < range.min || test.value > range.max;
          });
          contextParts.push(outOfRange.length > 0
            ? `LABS (${outOfRange.length} out of range):\n` + outOfRange.map((t: LabTest) => `- ${t.testName}: ${t.value} ${t.unit}`).join('\n')
            : 'LABS: All markers in range');
        }
      }

      if (muscleAlert) {
        contextParts.push(`MUSCLE ALERT: ${muscleAlert.group} neglected — ${muscleAlert.daysSince} days`);
      }

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
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `You are a personal health coach. Generate 3 short personalized insights.

USER DATA:
${contextParts.join('\n\n')}

Return ONLY a JSON object, no markdown, no preamble:
{
  "workout": "1-2 sentence actionable workout insight",
  "food": "1-2 sentence food/nutrition insight based on their diet preference and goals",
  "labs": "1-2 sentence insight based on lab results, or general health tip if no labs"
}
Rules: be specific, use actual numbers, under 25 words each, respect diet preference, friendly coach tone.`,
          }],
        }),
      });

      if (!response.ok) throw new Error('AI request failed');
      const data = await response.json();
      const parsed = JSON.parse(data.content?.[0]?.text || '{}');
      const insights = {
        workout: parsed.workout || '',
        food: parsed.food || '',
        labs: parsed.labs || '',
      };
      setAiInsights(insights);
      await setDoc(cacheRef, { insights, generatedAt: new Date().toISOString() });
    } catch (e) {
      console.error('AI insights error:', e);
    } finally {
      setIsLoadingInsights(false);
    }
  }, [user, bodyStats, workoutSessions, labResults, muscleAlert]);

  useEffect(() => {
    if (!user) return;
    const fetchAllData = async () => {
      try {
        const workoutsQuery = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const workoutsSnapshot = await getDocs(workoutsQuery);
        const sessions = workoutsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession));
        setWorkoutSessions(sessions);
        setMuscleAlert(getMuscleGroupAlert(sessions));

        const bodySnapshot = await getDocs(query(
          collection(db, 'users', user.uid, 'bodyComp'),
          orderBy('date', 'desc'), limit(50)
        ));
        setBodyStats(bodySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as BodyStats)));

        const labsSnapshot = await getDocs(query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'), limit(10)
        ));
        setLabResults(labsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as LabResults)));

        const testsSnapshot = await getDocs(query(
          collection(db, 'users', user.uid, 'tests'),
          orderBy('nextDueDate', 'asc')
        ));
        const tests = testsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        setUpcomingTests(tests.filter(t => t.nextDueDate && new Date(t.nextDueDate) <= thirtyDaysFromNow));

        const habitsSnap = await getDocs(collection(db, 'users', user.uid, 'habits'));
        const habitsData = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Habit));
        setHabits(habitsData);

        const doneMap: Record<string, boolean> = {};
        const weekCountMap: Record<string, number> = {};
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        weekStart.setHours(0, 0, 0, 0);
        const weekStartStr = weekStart.toISOString().split('T')[0];

        for (const habit of habitsData) {
          const todaySnap = await getDocs(
            query(collection(db, 'users', user.uid, 'habits', habit.id, 'logs'), where('date', '==', todayStr))
          );
          doneMap[habit.id] = !todaySnap.empty;
          const weekSnap = await getDocs(
            query(collection(db, 'users', user.uid, 'habits', habit.id, 'logs'),
              where('date', '>=', weekStartStr), where('date', '<=', todayStr))
          );
          weekCountMap[habit.id] = weekSnap.size;
        }
        setHabitsDoneToday(doneMap);
        setWeeklyHabitCounts(weekCountMap);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAllData();
  }, [user]);

  useEffect(() => {
    if (!loading && user) fetchAIInsights();
  }, [loading]);

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
    if (workoutSessions.length === 0) return { weeks: 0, thisWeekDays: [], thisWeekCount: 0 };
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const thisWeekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dayStr = d.toISOString().split('T')[0];
      const hasWorkout = workoutSessions.some(s => s.date === dayStr);
      return { label: d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2), hasWorkout, isFuture: d > now };
    });
    const weeklyData: boolean[] = [];
    for (let i = 7; i >= 0; i--) {
      const wStart = new Date(now);
      wStart.setDate(now.getDate() - (i * 7));
      wStart.setHours(0, 0, 0, 0);
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 6);
      wEnd.setHours(23, 59, 59, 999);
      const count = workoutSessions.filter(s => {
        const d = new Date(s.date);
        return d >= wStart && d <= wEnd;
      }).length;
      weeklyData.push(count >= 3);
    }
    const thisWeekCount = thisWeekDays.filter(d => d.hasWorkout).length;
    let consecutiveWeeks = 0;
    for (let i = weeklyData.length - 1; i >= 0; i--) {
      if (weeklyData[i]) consecutiveWeeks++;
      else break;
    }
    return { weeks: consecutiveWeeks, thisWeekDays, thisWeekCount };
  };

  const getBodyCompStats = () => {
    if (bodyStats.length === 0) return null;
    const cur = bodyStats[0];
    const prev = bodyStats.length > 1 ? bodyStats[1] : null;
    const weight = cur.weightKg != null ? Number(cur.weightKg) : null;
    const pbf = cur.pbf != null ? Number(cur.pbf) : null;
    const smm = cur.smm != null ? Number(cur.smm) : null;
    return {
      weight, pbf, smm,
      weightDelta: prev?.weightKg != null && weight != null ? weight - Number(prev.weightKg) : null,
      pbfDelta: prev?.pbf != null && pbf != null ? pbf - Number(prev.pbf) : null,
      smmDelta: prev?.smm != null && smm != null ? smm - Number(prev.smm) : null,
    };
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
  const bodyCompStats = getBodyCompStats();
  const fatLossStatus = getFatLossStatus();
  const muscleStatus = getMuscleStatus();
  const habitsDoneCount = Object.values(habitsDoneToday).filter(Boolean).length;
  const currentTopic = insightTopics[insightIndex];

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <div className="p-5 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Hey, {getFirstName()} 👋</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button onClick={() => navigate('/export')} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
            <Download className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Lab alert */}
        {upcomingTests.length > 0 && (
          <div
            onClick={() => navigate('/labs')}
            className="flex items-center justify-between border border-amber-500/25 rounded-xl px-4 py-3 cursor-pointer"
            style={{ background: 'rgba(245,158,11,0.08)' }}
          >
            <span className="text-amber-400 text-sm">
              🔔 {upcomingTests.length} lab test{upcomingTests.length > 1 ? 's' : ''} due soon
            </span>
            <span className="text-xs bg-amber-500 text-white rounded-full px-2 py-0.5 font-medium">View</span>
          </div>
        )}

        {/* Muscle alert */}
        {muscleAlert && (
          <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
            <span className="text-amber-400 text-sm">
              ⚠️ {muscleAlert.group} day — {muscleAlert.daysSince} days since last session
            </span>
          </div>
        )}

        {/* Body Comp — compact grid */}
        {bodyStats.length > 0 && (
          <button onClick={() => navigate('/body')} className="w-full text-left">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Body</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                { label: 'Weight', value: bodyCompStats?.weight != null ? `${bodyCompStats.weight}` : '--', unit: 'kg', delta: bodyCompStats?.weightDelta, lowerIsBetter: true },
                { label: 'Body fat', value: bodyCompStats?.pbf != null ? `${bodyCompStats.pbf}` : '--', unit: '%', delta: bodyCompStats?.pbfDelta, lowerIsBetter: true },
                { label: 'Muscle', value: bodyCompStats?.smm != null ? `${bodyCompStats.smm}` : '--', unit: 'kg', delta: bodyCompStats?.smmDelta, lowerIsBetter: false },
              ].map(({ label, value, unit, delta, lowerIsBetter }) => (
                <div key={label} className="bg-slate-900 rounded-lg p-3 border border-slate-800">
                  <div className="text-slate-400 text-[10px] mb-1">{label}</div>
                  <div className="text-white font-semibold text-sm">{value} <span className="text-slate-500 text-[10px]">{unit}</span></div>
                  {delta != null && (
                    <div className={`text-[10px] mt-0.5 ${(lowerIsBetter ? delta < 0 : delta > 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                      {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              {[
                { status: fatLossStatus, labels: { improving: 'Fat Loss: Improving', hold: 'Fat Loss: Hold', focus: 'Fat Loss: Focus' } },
                { status: muscleStatus, labels: { strong: 'Muscle: Strong', steady: 'Muscle: Steady', improve: 'Muscle: Improve' } },
              ].map(({ status, labels }) => (
                <span key={status} className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
                  (status === 'improving' || status === 'strong')
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : (status === 'hold' || status === 'steady')
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-red-500/20 text-red-400 border-red-500/30'
                }`}>
                  {(labels as any)[status]}
                </span>
              ))}
            </div>
          </button>
        )}

        {/* Divider */}
        <div className="border-t border-slate-800/60" />

        {/* AI Insight — single rotating card */}
        {(aiInsights || isLoadingInsights) && (
          <div>
            {isLoadingInsights ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="text-slate-400 text-sm">✦ Generating insights…</span>
              </div>
            ) : aiInsights && (
              <div className={`${insightColors[currentTopic].bg} border ${insightColors[currentTopic].border} rounded-xl p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-[10px] font-bold tracking-wider uppercase">✦ AI Insight</span>
                  <div className="flex gap-1">
                    {insightTopics.map((t, i) => (
                      <span key={t} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === insightIndex ? insightDotColors[t] : 'bg-slate-700'}`} />
                    ))}
                  </div>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed">{aiInsights[currentTopic]}</p>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold tracking-wider uppercase ${insightColors[currentTopic].text}`}>
                      {currentTopic.charAt(0).toUpperCase() + currentTopic.slice(1)}
                    </span>
                    <button
                      onClick={() => navigate(`/ai-coach?topic=${currentTopic}`)}
                      className="text-slate-500 text-xs hover:text-white transition-colors"
                    >
                      · Ask more →
                    </button>
                  </div>
                  <div className="flex items-center">
                    <button onClick={() => setInsightIndex(p => p === 0 ? 2 : p - 1)} className="text-slate-500 hover:text-white px-2 text-lg leading-none">‹</button>
                    <button onClick={() => setInsightIndex(p => p === 2 ? 0 : p + 1)} className="text-slate-500 hover:text-white px-2 text-lg leading-none">›</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-slate-800/60" />

        {/* Habits — horizontal chips */}
        {habits.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-500 text-[10px] uppercase tracking-wider">Today's habits</span>
              <button onClick={() => navigate('/wellness')} className="text-slate-500 text-xs hover:text-slate-300">
                Tap →
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {habits.map(habit => {
                const done = habitsDoneToday[habit.id] || false;
                return (
                  <button
                    key={habit.id}
                    onClick={() => toggleHabit(habit.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0 border transition-all ${
                      done
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    <span className="text-sm">{habit.icon || '💪'}</span>
                    <span className="text-xs font-medium">{habit.name}</span>
                    {done && <Check className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-600 mt-1.5">{habitsDoneCount} / {habits.length} done today</div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-slate-800/60" />

        {/* Today's Workout */}
        <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-400 text-[10px] font-bold tracking-wider uppercase">Today's Workout</span>
          </div>
          {suggestedWorkout ? (
            <>
              <div className="text-lg font-semibold text-white">{suggestedWorkout}</div>
              <div className="text-xs text-slate-400 mt-0.5 mb-3">
                {workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.groups.join(', ')} · ~{workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.duration} min
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-white mb-1">Start your first workout</div>
              <div className="text-xs text-slate-400 mb-3">Choose a template to get started</div>
            </>
          )}
          <button
            onClick={() => suggestedWorkout === 'Running'
              ? navigate('/running-session')
              : navigate('/workout-session', { state: { template: suggestedWorkout?.toLowerCase().replace(' ', '') || '' } })}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {suggestedWorkout ? `Start ${suggestedWorkout} →` : 'Choose Template →'}
          </button>
        </div>

        {/* Streak — compact row */}
        <div className="bg-slate-900 rounded-xl px-4 py-3 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-white">{streakData.weeks}</span>
              <span className="text-xs text-slate-500">weeks streak</span>
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">{streakData.thisWeekCount} done this week</div>
          </div>
          <div className="flex items-end gap-1.5">
            {streakData.thisWeekDays.map((day, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div className={`w-2 h-2 rounded-sm ${day.hasWorkout ? 'bg-emerald-500' : day.isFuture ? 'bg-slate-800' : 'bg-slate-700'}`} />
                <span className="text-[9px] text-slate-600">{day.label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* FAB */}
      <button
        onClick={() => navigate('/ai-coach')}
        className="fixed bottom-24 left-6 w-14 h-14 rounded-full bg-emerald-500 shadow-lg flex items-center justify-center text-white text-xl z-40 hover:bg-emerald-600 transition-colors"
      >
        ✦
      </button>
    </div>
  );
}