import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  where 
} from 'firebase/firestore';
import { db } from './firebase';
import { cleanData } from './cleanData';

// Interfaces
export interface Habit {
  id: string;
  name: string;
  icon: string;
  goalType: 'daily' | 'times_per_week' | 'distance_month' | 'count_month';
  targetValue: number;
  targetUnit: string;
  reminderTime: string | null;
  color: string;
  createdAt: any;
}

export interface Log {
  id: string;
  date: string; // 'YYYY-MM-DD'
  value: number;
  createdAt: any;
}

export type WeekStatus = 'done' | 'partial' | 'missed' | 'today';

// Core Functions

/**
 * Fetch all habits for a user, ordered by createdAt asc
 */
export const getHabits = async (uid: string): Promise<Habit[]> => {
  try {
    const habitsQuery = query(
      collection(db, 'users', uid, 'habits'),
      orderBy('createdAt', 'asc')
    );
    const habitsSnapshot = await getDocs(habitsQuery);
    return habitsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Habit[];
  } catch (error) {
    console.error('Error fetching habits:', error);
    throw error;
  }
};

/**
 * Create a new habit document
 */
export const addHabit = async (uid: string, habitData: Omit<Habit, 'id' | 'createdAt'>): Promise<Habit> => {
  try {
    const habitDoc = await addDoc(
      collection(db, 'users', uid, 'habits'),
      cleanData({
        ...habitData,
        createdAt: new Date()
      })
    );
    
    const newHabit = await getDoc(habitDoc);
    return {
      id: newHabit.id,
      ...newHabit.data()
    } as Habit;
  } catch (error) {
    console.error('Error adding habit:', error);
    throw error;
  }
};

/**
 * Delete a habit and all its logs
 */
export const deleteHabit = async (uid: string, habitId: string): Promise<void> => {
  try {
    // First, delete all logs for this habit
    const logsQuery = query(
      collection(db, 'users', uid, 'habits', habitId, 'logs')
    );
    const logsSnapshot = await getDocs(logsQuery);
    
    for (const logDoc of logsSnapshot.docs) {
      await deleteDoc(doc(db, 'users', uid, 'habits', habitId, 'logs', logDoc.id));
    }
    
    // Then delete the habit document
    await deleteDoc(doc(db, 'users', uid, 'habits', habitId));
  } catch (error) {
    console.error('Error deleting habit:', error);
    throw error;
  }
};

/**
 * Add or update a log entry for a specific habit and date
 */
export const logHabitEntry = async (uid: string, habitId: string, date: string, value: number): Promise<void> => {
  try {
    await setDoc(
      doc(db, 'users', uid, 'habits', habitId, 'logs', date),
      cleanData({
        date,
        value,
        createdAt: new Date()
      }),
      { merge: true }
    );
  } catch (error) {
    console.error('Error logging habit entry:', error);
    throw error;
  }
};

/**
 * Fetch logs for a specific habit between two dates
 */
export const getLogsForHabit = async (uid: string, habitId: string, fromDate: string, toDate: string): Promise<Log[]> => {
  try {
    const logsQuery = query(
      collection(db, 'users', uid, 'habits', habitId, 'logs'),
      where('date', '>=', fromDate),
      where('date', '<=', toDate),
      orderBy('date', 'desc')
    );
    const logsSnapshot = await getDocs(logsQuery);
    return logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Log[];
  } catch (error) {
    console.error('Error fetching logs for habit:', error);
    throw error;
  }
};

/**
 * Fetch one log per habit for a given date (used by Today view)
 */
export const getLogsForDate = async (uid: string, date: string): Promise<Log[]> => {
  try {
    // First get all habits
    const habits = await getHabits(uid);
    const logs: Log[] = [];
    
    // For each habit, get the log for the specific date
    for (const habit of habits) {
      const logDoc = await getDoc(doc(db, 'users', uid, 'habits', habit.id, 'logs', date));
      if (logDoc.exists()) {
        logs.push({
          id: logDoc.id,
          ...logDoc.data()
        } as Log);
      }
    }
    
    return logs;
  } catch (error) {
    console.error('Error fetching logs for date:', error);
    throw error;
  }
};

// Streak and Week Status Logic

/**
 * Calculate current streak count based on logs and goal type
 */
export const calculateStreak = (logs: Log[], goalType: Habit['goalType'], targetValue: number): number => {
  if (logs.length === 0) return 0;
  
  // Sort logs by date descending
  const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  switch (goalType) {
    case 'daily':
      // Streak = consecutive days with at least 1 log going back from today
      let dailyStreak = 0;
      let currentDate = new Date();
      
      for (const log of sortedLogs) {
        const logDate = new Date(log.date);
        const daysDiff = Math.floor((currentDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === dailyStreak && log.value >= 1) {
          dailyStreak++;
        } else {
          break;
        }
      }
      
      return dailyStreak;
      
    case 'times_per_week':
      // Streak = consecutive weeks with logsCount >= targetValue
      let weeklyStreak = 0;
      const weekLogs: { [week: string]: number } = {};
      
      // Group logs by week
      for (const log of sortedLogs) {
        const logDate = new Date(log.date);
        const weekStart = new Date(logDate);
        weekStart.setDate(logDate.getDate() - logDate.getDay()); // Start of week (Sunday)
        const weekKey = weekStart.toISOString().split('T')[0];
        
        weekLogs[weekKey] = (weekLogs[weekKey] || 0) + 1;
      }
      
      // Check consecutive weeks
      let currentWeek = new Date();
      currentWeek.setDate(currentWeek.getDate() - currentWeek.getDay()); // Start of current week
      
      for (let i = 0; i < 52; i++) { // Check up to 52 weeks
        const weekKey = currentWeek.toISOString().split('T')[0];
        
        if (weekLogs[weekKey] >= targetValue) {
          weeklyStreak++;
          currentWeek.setDate(currentWeek.getDate() - 7); // Go to previous week
        } else {
          break;
        }
      }
      
      return weeklyStreak;
      
    case 'distance_month':
    case 'count_month':
      // No streak for monthly goals
      return 0;
      
    default:
      return 0;
  }
};

/**
 * Get week status for each of the last 7 days
 */
export const getWeekStatus = (
  logs: Log[], 
  _goalType: Habit['goalType'], 
  _targetValue: number
): WeekStatus[] => {
  const today = new Date();
  const weekStatus: WeekStatus[] = [];
  
  // Get all unique dates from logs
  const loggedDates = new Set(logs.map(log => log.date));
  
  // For each of the last 7 days (starting from 6 days ago to today)
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const isToday = i === 0;
    
    if (isToday) {
      weekStatus.push('today');
    } else if (loggedDates.has(dateStr)) {
      weekStatus.push('done');
    } else {
      weekStatus.push('missed');
    }
  }
  
  return weekStatus;
};
