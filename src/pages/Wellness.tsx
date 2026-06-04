import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Flame, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import {
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getHabits, getWeekStatus, calculateStreak, logHabitEntry, removeHabitLog, Habit, Log, WeekStatus } from '@/lib/habits';
import { ensureDefaultHabits, getHabitLogToday, setHabitLogToday } from '@/lib/defaultHabits';
import { useGoals } from '@/services/goalsService';
import AddHabitModal from '@/components/AddHabitModal';

export default function Wellness() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { goals: userGoals } = useGoals(user?.uid);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogsToday, setHabitLogsToday] = useState<Record<string, Log[]>>({});
  const [weekStatus, setWeekStatus] = useState<WeekStatus[]>([]);
  const [loading, setLoading] = useState(true);
  usePageLoadTime('Wellness', loading);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [valueModal, setValueModal] = useState<{ habitId: string; habitName: string } | null>(null);
  const [tempValue, setTempValue] = useState('');
  const [waterCount, setWaterCount] = useState(0);
  const [sleepHours, setSleepHours] = useState(0);
  const [stepsCount, setStepsCount] = useState(0);
  const [defaultHabitIds, setDefaultHabitIds] = useState<{water?:string, sleep?:string, steps?:string}>({});

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDayName = dayNames[today.getDay()];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const todayMonthName = monthNames[today.getMonth()];
  const todayDate = today.getDate();

  const fetchTodayLogs = async (habitsData: Habit[]) => {
    if (!user) return;
    const logsMap: Record<string, Log[]> = {};
    for (const habit of habitsData) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'habits', habit.id, 'logs'),
            where('date', '==', todayStr)
          )
        );
        logsMap[habit.id] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Log));
      } catch (_) {
        logsMap[habit.id] = [];
      }
    }
    setHabitLogsToday(logsMap);
    return logsMap;
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!user) return;
    const loadData = async () => {
      try {
        const habitsData = await getHabits(user.uid);
        setHabits(habitsData);
        
        const dh = await ensureDefaultHabits(user.uid);
        setDefaultHabitIds({ water: dh.water?.id, sleep: dh.sleep?.id, steps: dh.steps?.id });
        if (dh.water?.id) setWaterCount((await getHabitLogToday(user.uid, dh.water.id)) ?? 0);
        if (dh.sleep?.id) setSleepHours((await getHabitLogToday(user.uid, dh.sleep.id)) ?? 0);
        if (dh.steps?.id) setStepsCount((await getHabitLogToday(user.uid, dh.steps.id)) ?? 0);
        
        await fetchTodayLogs(habitsData);
        if (habitsData.length > 0) {
          const status = getWeekStatus([], habitsData[0].goalType, habitsData[0].targetValue);
          setWeekStatus(status);
        }
      } catch (error) {
        console.error('Error loading wellness data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [user, todayStr]);

  // Toggle: if already done today → remove log (undo). If not done → log it.
  const toggleHabitLog = async (habitId: string, value = 1) => {
    if (!user) return;
    const alreadyDone = isHabitDoneToday(habitId);
    try {
      if (alreadyDone) {
        // Undo — delete the log doc (doc ID = date string)
        await removeHabitLog(user.uid, habitId, todayStr);
        setHabitLogsToday(prev => ({ ...prev, [habitId]: [] }));
      } else {
        await logHabitEntry(user.uid, habitId, todayStr, value);
        const newLog: Log = { id: todayStr, date: todayStr, value, createdAt: null };
        setHabitLogsToday(prev => ({ ...prev, [habitId]: [newLog] }));
      }
      if (valueModal) { setValueModal(null); setTempValue(''); }
    } catch (error) {
      console.error('Error toggling habit:', error);
    }
  };

  const isHabitDoneToday = (habitId: string): boolean => {
    const logs = habitLogsToday[habitId] || [];
    if (logs.length === 0) return false;
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return false;
    const totalValue = logs.reduce((sum, l) => sum + (l.value || 0), 0);
    return habit.goalType === 'daily' || habit.goalType === 'times_per_week'
      ? totalValue >= 1
      : totalValue > 0;
  };

  const getHabitStreak = (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return 0;
    return calculateStreak(habitLogsToday[habitId] || [], habit.goalType, habit.targetValue);
  };

  const getWeeklyProgress = (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habit.goalType !== 'times_per_week') return { current: 0, target: habit?.targetValue || 0 };
    return { current: (habitLogsToday[habitId] || []).length, target: habit.targetValue };
  };

  const getMonthlyProgress = (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || !['distance_month', 'count_month'].includes(habit.goalType)) return { current: 0, target: habit?.targetValue || 0 };
    const current = (habitLogsToday[habitId] || []).reduce((sum, l) => sum + (l.value || 0), 0);
    return { current, target: habit.targetValue };
  };

  const customHabits = habits.filter(h => !(h as any).isDefault);
  const remainingHabits = customHabits.filter(h => !isHabitDoneToday(h.id));
  const doneHabits = customHabits.filter(h => isHabitDoneToday(h.id));
  const maxStreak = habits.length > 0 ? Math.max(...habits.map(h => getHabitStreak(h.id))) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div>Loading habits...</div>
        </div>
      </div>
    );
  }

  const HabitCard = ({ habit, done }: { habit: Habit; done: boolean }) => {
    const weeklyProgress = getWeeklyProgress(habit.id);
    const monthlyProgress = getMonthlyProgress(habit.id);
    const streak = getHabitStreak(habit.id);

    return (
      <div
        className={`bg-slate-800 rounded-lg p-4 border ${done ? 'border-emerald-900 opacity-70' : 'border-slate-700'}`}
        onClick={() => navigate(`/wellness/${habit.id}`)}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${habit.color}20` }}
            >
              <div style={{ color: habit.color }}>{habit.icon}</div>
            </div>
            <div>
              <div className="font-medium">{habit.name}</div>
              <div className="text-xs text-slate-400">
                {habit.goalType === 'daily' ? 'Daily' :
                 habit.goalType === 'times_per_week' ? `${weeklyProgress.current}/${weeklyProgress.target} this week` :
                 `${monthlyProgress.current}/${monthlyProgress.target} this month`}
              </div>
            </div>
          </div>

          {/* Toggle button — green filled if done, outline if not */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (['distance_month', 'count_month'].includes(habit.goalType) && !done) {
                setValueModal({ habitId: habit.id, habitName: habit.name });
              } else {
                toggleHabitLog(habit.id, 1);
              }
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              done
                ? 'bg-emerald-500 hover:bg-red-500/80'
                : 'border-2 border-emerald-500 hover:bg-emerald-500'
            }`}
            title={done ? 'Tap to undo' : 'Mark done'}
          >
            {done
              ? <Check size={16} className="text-white" />
              : <Plus size={16} className="text-emerald-500" />
            }
          </button>
        </div>

        {['distance_month', 'count_month'].includes(habit.goalType) && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{monthlyProgress.current} done</span>
              <span>{monthlyProgress.target - monthlyProgress.current} left</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="h-2 rounded-full transition-all"
                style={{
                  width: `${Math.min((monthlyProgress.current / monthlyProgress.target) * 100, 100)}%`,
                  backgroundColor: habit.color,
                }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center space-x-1 mt-2">
          <Flame size={12} className="text-orange-500" />
          <span className="text-xs text-slate-400">{streak} day streak</span>
        </div>
      </div>
    );
  };

  const WellnessSteppers = () => {
    if (!user) return null;

    const sleepTarget = userGoals.sleepGoal ?? 7.5;
    const stepsGoal   = userGoals.stepsGoal ?? 8000;
    const waterGoal   = 8; // displayed in glasses; goals service stores litres separately

    const handleWaterChange = async (delta: number) => {
      const newCount = Math.max(0, waterCount + delta);
      setWaterCount(newCount);
      if (defaultHabitIds.water) {
        await setHabitLogToday(user.uid, defaultHabitIds.water, newCount);
      }
    };

    const handleSleepChange = (delta: number) => {
      setSleepHours(prev => Math.min(12, Math.max(0, Math.round((prev + delta * 0.5) * 2) / 2)));
    };

    const handleSleepSave = async () => {
      if (defaultHabitIds.sleep) {
        await setHabitLogToday(user.uid, defaultHabitIds.sleep, sleepHours);
      }
    };

    const handleStepsChange = (delta: number) => {
      setStepsCount(prev => Math.max(0, prev + delta * 500));
    };

    const handleStepsSave = async () => {
      if (defaultHabitIds.steps) {
        await setHabitLogToday(user.uid, defaultHabitIds.steps, stepsCount);
      }
    };

    const sleepMet = sleepHours >= sleepTarget;

    return (
      <div className="px-4 py-4 space-y-3">
        {/* Water */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="mb-3">
            <div className="font-medium">💧 Water</div>
            <div className="text-xs text-slate-400">glasses today</div>
          </div>
          <div className="flex items-center justify-center gap-4 mb-3">
            <button
              onClick={() => handleWaterChange(-1)}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              −
            </button>
            <span className="text-sm font-medium min-w-[7rem] text-center">
              {waterCount} {waterCount === 1 ? 'glass' : 'glasses'}
            </span>
            <button
              onClick={() => handleWaterChange(1)}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              +
            </button>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min((waterCount / waterGoal) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Sleep */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="mb-3">
            <div className="font-medium">🌙 Sleep</div>
            <div className="text-xs text-slate-400">hours last night</div>
          </div>
          <div className="flex items-center justify-center gap-3 mb-3">
            <button
              onClick={() => handleSleepChange(-1)}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              −
            </button>
            <span className="text-sm font-medium min-w-[5rem] text-center">
              {sleepHours % 1 === 0 ? sleepHours : sleepHours.toFixed(1)} hrs
            </span>
            <button
              onClick={() => handleSleepChange(1)}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              +
            </button>
            <button
              onClick={handleSleepSave}
              className="w-8 h-8 rounded-lg bg-green-500 hover:bg-green-600 flex items-center justify-center text-white"
              title="Save sleep"
            >
              ✓
            </button>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2 mb-3">
            <div
              className={`h-2 rounded-full transition-all ${sleepMet ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min((sleepHours / sleepTarget) * 100, 100)}%` }}
            />
          </div>
          <input
            type="text"
            placeholder="or type hours (e.g. 7.5)"
            value={sleepHours > 0 ? String(sleepHours) : ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) setSleepHours(Math.min(12, Math.max(0, v)));
              else if (e.target.value === '') setSleepHours(0);
            }}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
        </div>

        {/* Steps */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="mb-3">
            <div className="font-medium">👣 Steps</div>
            <div className="text-xs text-slate-400">today</div>
          </div>
          <div className="flex items-center justify-center gap-3 mb-3">
            <button
              onClick={() => handleStepsChange(-1)}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              −
            </button>
            <span className="text-sm font-medium min-w-[7rem] text-center">
              {stepsCount.toLocaleString()} steps
            </span>
            <button
              onClick={() => handleStepsChange(1)}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              +
            </button>
            <button
              onClick={handleStepsSave}
              className="w-8 h-8 rounded-lg bg-green-500 hover:bg-green-600 flex items-center justify-center text-white"
              title="Save steps"
            >
              ✓
            </button>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min((stepsCount / stepsGoal) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Habits</h1>
            <p className="text-slate-400 text-sm">{todayDayName}, {todayMonthName} {todayDate}</p>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center hover:bg-emerald-600 transition-colors"
          >
            <Plus size={24} />
          </button>
        </div>
      </div>

      {/* Week Strip */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-4">
        <div className="flex justify-between">
          {weekStatus.map((status, index) => {
            const date = new Date(today);
            date.setDate(today.getDate() - (6 - index));
            const dayNum = date.getDate();
            return (
              <div key={index} className="flex flex-col items-center">
                <div className="text-xs text-slate-400 mb-1">{dayNames[date.getDay()]}</div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium
                  ${status === 'done' ? 'bg-emerald-500 text-white' :
                    status === 'partial' ? 'bg-emerald-900 text-emerald-300' :
                    status === 'today' ? 'border-2 border-emerald-500 text-emerald-500' :
                    'bg-slate-700 text-slate-400'}
                `}>
                  {status === 'done' ? <Check size={12} /> : dayNum}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Wellness Steppers */}
      <WellnessSteppers />

      {/* Streak Banner */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Flame className="text-orange-500" size={24} />
            <div>
              <div className="text-lg font-semibold">{maxStreak} day streak</div>
              <div className="text-xs text-slate-400">Best: {maxStreak} days</div>
            </div>
          </div>
          <div className="text-sm font-medium">{doneHabits.length} / {customHabits.length} done today</div>
        </div>
      </div>

      {/* Habit List */}
      <div className="px-4 py-4 space-y-6">
        {remainingHabits.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Remaining</h2>
            <div className="space-y-3">
              {remainingHabits.map(habit => <HabitCard key={habit.id} habit={habit} done={false} />)}
            </div>
          </div>
        )}

        {doneHabits.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Done today</h2>
            <div className="space-y-3">
              {doneHabits.map(habit => <HabitCard key={habit.id} habit={habit} done={true} />)}
            </div>
          </div>
        )}

        {customHabits.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={24} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No habits yet</h3>
            <p className="text-slate-400 mb-4">Start building better habits today</p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-lg transition-colors"
            >
              Add Your First Habit
            </button>
          </div>
        )}
      </div>

      {isAddModalOpen && (
        <AddHabitModal
          onClose={() => setIsAddModalOpen(false)}
          onHabitAdded={() => {
            setIsAddModalOpen(false);
            if (user) {
              getHabits(user.uid).then(habitsData => {
                setHabits(habitsData);
                fetchTodayLogs(habitsData);
              });
            }
          }}
        />
      )}

      {valueModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end z-50">
          <div className="bg-slate-800 w-full rounded-t-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">Log {valueModal.habitName}</h3>
            <input
              type="number"
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              placeholder="Enter value"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white mb-4"
              autoFocus
            />
            <div className="flex space-x-3">
              <button
                onClick={() => { setValueModal(null); setTempValue(''); }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { if (tempValue) toggleHabitLog(valueModal.habitId, parseFloat(tempValue)); }}
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-lg transition-colors"
              >
                Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}