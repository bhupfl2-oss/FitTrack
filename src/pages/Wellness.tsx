import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronLeft, Flame, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getHabits, getLogsForDate, getWeekStatus, calculateStreak, logHabitEntry, Habit, Log, WeekStatus } from '@/lib/habits';
import AddHabitModal from '@/components/AddHabitModal';

export default function Wellness() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayLogs, setTodayLogs] = useState<Log[]>([]);
  const [weekStatus, setWeekStatus] = useState<WeekStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [valueModal, setValueModal] = useState<{ habitId: string; habitName: string } | null>(null);
  const [tempValue, setTempValue] = useState('');

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDayName = dayNames[today.getDay()];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const todayMonthName = monthNames[today.getMonth()];
  const todayDate = today.getDate();

  useEffect(() => {
    if (!user) return;
    
    const loadData = async () => {
      try {
        const [habitsData, logsData] = await Promise.all([
          getHabits(user.uid),
          getLogsForDate(user.uid, todayStr)
        ]);
        
        setHabits(habitsData);
        setTodayLogs(logsData);
        
        // Calculate week status
        if (habitsData.length > 0) {
          const allWeekLogs: Log[] = [];
          for (const habit of habitsData) {
            const habitLogs = await getLogsForDate(user.uid, todayStr);
            allWeekLogs.push(...habitLogs);
          }
          const status = getWeekStatus(allWeekLogs, habitsData[0].goalType, habitsData[0].targetValue);
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

  const handleLogHabit = async (habitId: string, value: number) => {
    if (!user) return;
    
    try {
      await logHabitEntry(user.uid, habitId, todayStr, value);
      
      // Refresh today's logs
      const logsData = await getLogsForDate(user.uid, todayStr);
      setTodayLogs(logsData);
      
      // Close value modal if open
      if (valueModal) {
        setValueModal(null);
        setTempValue('');
      }
    } catch (error) {
      console.error('Error logging habit:', error);
    }
  };

  const getHabitLog = (habitId: string) => {
    return todayLogs.find(log => log.id === habitId);
  };

  const getHabitStreak = (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return 0;
    
    const habitLogs = todayLogs.filter(log => log.id === habitId);
    return calculateStreak(habitLogs, habit.goalType, habit.targetValue);
  };

  const isHabitDoneToday = (habitId: string) => {
    const log = getHabitLog(habitId);
    if (!log) return false;
    
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return false;
    
    if (habit.goalType === 'daily') {
      return log.value >= 1;
    } else if (habit.goalType === 'times_per_week') {
      return log.value >= 1;
    } else {
      return log.value > 0;
    }
  };

  const getWeeklyProgress = (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habit.goalType !== 'times_per_week') return { current: 0, target: habit?.targetValue || 0 };
    
    // This is simplified - in real implementation would fetch this week's logs
    const current = todayLogs.filter(log => log.id === habitId).length;
    return { current, target: habit.targetValue };
  };

  const getMonthlyProgress = (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || !['distance_month', 'count_month'].includes(habit.goalType)) return { current: 0, target: habit?.targetValue || 0 };
    
    const log = getHabitLog(habitId);
    const current = log?.value || 0;
    return { current, target: habit.targetValue };
  };

  // Separate habits into remaining and done today
  const remainingHabits = habits.filter(h => !isHabitDoneToday(h.id));
  const doneHabits = habits.filter(h => isHabitDoneToday(h.id));

  // Calculate max streak and today's progress
  const maxStreak = Math.max(...habits.map(h => getHabitStreak(h.id)));
  const doneTodayCount = doneHabits.length;
  const totalHabitsCount = habits.length;

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

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Habits</h1>
            <p className="text-slate-400 text-sm">
              {todayDayName}, {todayMonthName} {todayDate}
            </p>
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
                <div className="text-xs text-slate-400 mb-1">
                  {dayNames[date.getDay()]}
                </div>
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
          <div className="text-right">
            <div className="text-sm font-medium">{doneTodayCount} / {totalHabitsCount} done today</div>
          </div>
        </div>
      </div>

      {/* Habit List */}
      <div className="px-4 py-4 space-y-6">
        {/* Remaining Habits */}
        {remainingHabits.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Remaining</h2>
            <div className="space-y-3">
              {remainingHabits.map((habit) => {
                const weeklyProgress = getWeeklyProgress(habit.id);
                const monthlyProgress = getMonthlyProgress(habit.id);
                const streak = getHabitStreak(habit.id);
                
                return (
                  <div
                    key={habit.id}
                    className="bg-slate-800 rounded-lg p-4 border border-slate-700"
                    onClick={() => navigate(`/wellness/${habit.id}`)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3">
                        <div 
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${habit.color}20` }}
                        >
                          <div style={{ color: habit.color }}>
                            {habit.icon}
                          </div>
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (['distance_month', 'count_month'].includes(habit.goalType)) {
                            setValueModal({ habitId: habit.id, habitName: habit.name });
                          } else {
                            handleLogHabit(habit.id, 1);
                          }
                        }}
                        className="w-10 h-10 rounded-full border-2 border-emerald-500 flex items-center justify-center hover:bg-emerald-500 transition-colors"
                      >
                        <Plus size={16} className="text-emerald-500" />
                      </button>
                    </div>
                    
                    {/* Progress bar for monthly goals */}
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
                              backgroundColor: habit.color 
                            }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* Streak */}
                    <div className="flex items-center space-x-1 mt-2">
                      <Flame size={12} className="text-orange-500" />
                      <span className="text-xs text-slate-400">{streak} day streak</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Done Today */}
        {doneHabits.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Done today</h2>
            <div className="space-y-3">
              {doneHabits.map((habit) => {
                const weeklyProgress = getWeeklyProgress(habit.id);
                const monthlyProgress = getMonthlyProgress(habit.id);
                const streak = getHabitStreak(habit.id);
                
                return (
                  <div
                    key={habit.id}
                    className="bg-slate-800 rounded-lg p-4 border border-emerald-900 opacity-60"
                    onClick={() => navigate(`/wellness/${habit.id}`)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3">
                        <div 
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${habit.color}20` }}
                        >
                          <div style={{ color: habit.color }}>
                            {habit.icon}
                          </div>
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
                      <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center">
                        <Check size={16} />
                      </div>
                    </div>
                    
                    {/* Progress bar for monthly goals */}
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
                              backgroundColor: habit.color 
                            }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* Streak */}
                    <div className="flex items-center space-x-1 mt-2">
                      <Flame size={12} className="text-orange-500" />
                      <span className="text-xs text-slate-400">{streak} day streak</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {habits.length === 0 && (
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

      {/* Add Habit Modal */}
      {isAddModalOpen && (
        <AddHabitModal
          onClose={() => setIsAddModalOpen(false)}
          onHabitAdded={() => {
            setIsAddModalOpen(false);
            // Refresh habits
            if (user) {
              getHabits(user.uid).then(setHabits);
            }
          }}
        />
      )}

      {/* Value Input Modal */}
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
                onClick={() => {
                  setValueModal(null);
                  setTempValue('');
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (tempValue) {
                    handleLogHabit(valueModal.habitId, parseFloat(tempValue));
                  }
                }}
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
