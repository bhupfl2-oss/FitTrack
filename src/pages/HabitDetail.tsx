import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, MoreVertical, Flame, Check, TrendingUp, Target, Calendar } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getHabits, getLogsForHabit, calculateStreak, logHabitEntry, deleteHabit, Habit, Log } from '@/lib/habits';

export default function HabitDetail() {
  const { habitId } = useParams<{ habitId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [habit, setHabit] = useState<Habit | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [valueInput, setValueInput] = useState('');
  const [isLogging, setIsLogging] = useState(false);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  useEffect(() => {
    if (!user || !habitId) return;

    const loadData = async () => {
      try {
        const habitsData = await getHabits(user.uid);
        const habitData = habitsData.find(h => h.id === habitId);
        
        if (!habitData) {
          navigate('/wellness');
          return;
        }

        setHabit(habitData);

        // Get logs for the current month
        const firstDay = new Date(currentYear, currentMonth, 1);
        const lastDay = new Date(currentYear, currentMonth + 1, 0);
        
        const fromDate = firstDay.toISOString().split('T')[0];
        const toDate = lastDay.toISOString().split('T')[0];

        const logsData = await getLogsForHabit(user.uid, habitId, fromDate, toDate);
        setLogs(logsData);
      } catch (error) {
        console.error('Error loading habit detail:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user, habitId, navigate, currentYear, currentMonth]);

  const handleLogHabit = async (value?: number) => {
    if (!user || !habit || isLogging) return;

    setIsLogging(true);
    try {
      const logValue = value || 1;
      await logHabitEntry(user.uid, habit.id, todayStr, logValue);
      
      // Refresh logs
      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);
      
      const fromDate = firstDay.toISOString().split('T')[0];
      const toDate = lastDay.toISOString().split('T')[0];

      const logsData = await getLogsForHabit(user.uid, habit.id, fromDate, toDate);
      setLogs(logsData);
      
      setValueInput('');
    } catch (error) {
      console.error('Error logging habit:', error);
    } finally {
      setIsLogging(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !habit || !confirm(`Delete ${habit.name}? This will remove all logs permanently.`)) {
      return;
    }

    try {
      await deleteHabit(user.uid, habit.id);
      navigate('/wellness');
    } catch (error) {
      console.error('Error deleting habit:', error);
    }
  };

  const getTodayLog = () => {
    return logs.find(log => log.date === todayStr);
  };

  const getStreak = () => {
    if (!habit) return 0;
    return calculateStreak(logs, habit.goalType, habit.targetValue);
  };

  const getMonthlyProgress = () => {
    if (!habit) return { current: 0, target: 0, percentage: 0 };
    
    const current = logs.reduce((sum, log) => sum + log.value, 0);
    const target = habit.targetValue;
    const percentage = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    
    return { current, target, percentage };
  };

  const getCompletionRate = () => {
    if (!habit) return 0;
    
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const completedDays = logs.length;
    const rate = daysInMonth > 0 ? (completedDays / daysInMonth) * 100 : 0;
    
    return Math.round(rate);
  };

  const getCalendarDays = () => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    
    return days;
  };

  const getDayStatus = (day: number | null) => {
    if (!day) return 'empty';
    
    const date = new Date(currentYear, currentMonth, day);
    const dateStr = date.toISOString().split('T')[0];
    const isToday = dateStr === todayStr;
    const isFuture = date > today;
    
    if (isFuture) return 'future';
    
    const hasLog = logs.some(log => log.date === dateStr);
    return hasLog ? 'logged' : 'missed';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div>Loading habit details...</div>
        </div>
      </div>
    );
  }

  if (!habit) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Habit not found</div>
          <button
            onClick={() => navigate('/wellness')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg"
          >
            Back to Habits
          </button>
        </div>
      </div>
    );
  }

  const todayLog = getTodayLog();
  const streak = getStreak();
  const monthlyProgress = getMonthlyProgress();
  const completionRate = getCompletionRate();
  const calendarDays = getCalendarDays();
  const needsValueInput = ['distance_month', 'count_month'].includes(habit.goalType);

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <button
          onClick={() => navigate('/wellness')}
          className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-lg font-semibold">{habit.name}</h1>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <MoreVertical size={20} />
          </button>
          
          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50 min-w-[120px]">
              <button
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Implement edit functionality
                }}
                className="w-full px-3 py-2 text-left hover:bg-slate-700 transition-colors text-sm"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  handleDelete();
                }}
                className="w-full px-3 py-2 text-left hover:bg-slate-700 transition-colors text-sm text-red-400"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-slate-900 border-b border-slate-800 p-6">
        <div className="flex items-center space-x-4 mb-4">
          <div 
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl"
            style={{ backgroundColor: `${habit.color}20` }}
          >
            <div style={{ color: habit.color }}>
              {habit.icon}
            </div>
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-1">{habit.name}</h2>
            <p className="text-slate-400">
              {habit.goalType === 'daily' ? 'Daily' :
               habit.goalType === 'times_per_week' ? `${habit.targetValue}x per week` :
               `${habit.targetValue} ${habit.targetUnit} per month`}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center space-x-1">
              <Flame className="text-orange-500" size={20} />
              <span className="text-xl font-semibold">{streak}</span>
            </div>
            <div className="text-xs text-slate-400">day streak</div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center space-x-2 mb-2">
              <TrendingUp size={16} className="text-emerald-500" />
              <span className="text-sm text-slate-400">This month</span>
            </div>
            <div className="text-xl font-semibold">{monthlyProgress.current}</div>
            <div className="text-xs text-slate-400">{monthlyProgress.percentage.toFixed(0)}% of goal</div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center space-x-2 mb-2">
              <Target size={16} className="text-emerald-500" />
              <span className="text-sm text-slate-400">Current streak</span>
            </div>
            <div className="text-xl font-semibold">{streak}</div>
            <div className="text-xs text-slate-400">days</div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center space-x-2 mb-2">
              <Calendar size={16} className="text-emerald-500" />
              <span className="text-sm text-slate-400">Completion rate</span>
            </div>
            <div className="text-xl font-semibold">{completionRate}%</div>
            <div className="text-xs text-slate-400">this month</div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center space-x-2 mb-2">
              <Check size={16} className="text-emerald-500" />
              <span className="text-sm text-slate-400">Today</span>
            </div>
            <div className="text-xl font-semibold">
              {todayLog ? todayLog.value : 0}
            </div>
            <div className="text-xs text-slate-400">
              {todayLog ? 'completed' : 'not logged'}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Heatmap */}
      <div className="px-4 pb-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="font-semibold mb-4">
            {today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div key={index} className="text-center text-xs text-slate-400 font-medium">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              const status = getDayStatus(day);
              
              if (day === null) {
                return <div key={index} className="aspect-square" />;
              }
              
              return (
                <div
                  key={index}
                  className={`aspect-square rounded flex items-center justify-center text-xs font-medium
                    ${status === 'logged' ? 'bg-emerald-500 text-white' :
                      status === 'missed' ? 'bg-slate-700 text-slate-400' :
                      status === 'future' ? 'bg-slate-800 text-slate-500 border border-slate-700' :
                      ''}
                  `}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Log Entry */}
      <div className="px-4 pb-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          {needsValueInput ? (
            <div>
              <h3 className="font-semibold mb-3">Log today's entry</h3>
              <div className="flex space-x-3">
                <input
                  type="number"
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  placeholder={`Enter ${habit.targetUnit}`}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400"
                />
                <button
                  onClick={() => handleLogHabit(parseFloat(valueInput) || 0)}
                  disabled={isLogging || !valueInput}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white px-6 py-3 rounded-lg transition-colors"
                >
                  {isLogging ? 'Logging...' : 'Log'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => handleLogHabit()}
              disabled={isLogging || !!todayLog}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-3 rounded-lg transition-colors"
            >
              {todayLog ? 'Already logged today ✓' : isLogging ? 'Logging...' : 'Mark done today'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
