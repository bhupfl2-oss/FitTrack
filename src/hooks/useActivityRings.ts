import { useState, useEffect } from 'react';
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ActivityRing {
  pct: number;
  label: string;
}

interface TrainRing extends ActivityRing {
  done: number;
  goal: number;
}

interface MoveRing extends ActivityRing {
  current: number;
  goal: number;
}

interface TrackRing extends ActivityRing {
  done: number;
  total: number;
}

interface FuelRing extends ActivityRing {
  current: number;
  goal: number;
}

interface WeekDay {
  dateStr: string;
  trainVal: number;
  moveVal: number;
  trackVal: number;
  fuelVal: number;
  isToday: boolean;
  isFuture: boolean;
}

interface ActivityRingsState {
  train: TrainRing;
  move: MoveRing;
  track: TrackRing;
  fuel: FuelRing;
  weekDays: WeekDay[];
}

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Returns week date strings (YYYY-MM-DD) for Mon–Sun of the current week
// Uses local time only — no UTC conversion
function getWeekDateStrings(): string[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
}

export function useActivityRings(uid: string | undefined, refreshKey?: number): ActivityRingsState {
  const [state, setState] = useState<ActivityRingsState>({
    train: { pct: 0, done: 0, goal: 4, label: '0 of 4 workouts' },
    move: { pct: 0, current: 0, goal: 8000, label: '0 / 8,000 steps' },
    track: { pct: 0, done: 0, total: 0, label: '0 of 0 habits' },
    fuel: { pct: 0, current: 0, goal: 2000, label: '0 / 2,000 kcal' },
    weekDays: [],
  });

  useEffect(() => {
    if (!uid) return;

    const fetchData = async () => {
      const todayStr = getTodayStr();
      const weekDateStrings = getWeekDateStrings(); // ['2026-06-01', ..., '2026-06-07']
      const mondayStr = weekDateStrings[0];
      const sundayStr = weekDateStrings[6];

      const [
        workoutSnapshot,
        habitsSnapshot,
        nutritionDoc,
        profileDoc,
      ] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'workoutSessions')),
        getDocs(collection(db, 'users', uid, 'habits')),
        getDoc(doc(db, 'users', uid, 'nutritionLogs', todayStr)),
        getDoc(doc(db, 'users', uid, 'profile', 'data')),
      ]);

      const habits = habitsSnapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as Array<{ id: string; name?: string; target?: number; targetValue?: number; goalType?: string }>;

      const stepsHabit = habits.find(h => h.name?.toLowerCase().includes('step'));

      let stepsToday = 0;
      let stepsGoal = 8000;
      if (stepsHabit) {
        stepsGoal = stepsHabit.target ?? stepsHabit.targetValue ?? 8000;
        const stepsLog = await getDoc(
          doc(db, 'users', uid, 'habits', stepsHabit.id, 'logs', todayStr)
        );
        if (stepsLog.exists()) {
          const data = stepsLog.data();
          stepsToday = data.value ?? data.steps ?? 0;
        }
      }

      const todayHabitLogs = await Promise.all(
        habits.map((habit: any) =>
          getDoc(doc(db, 'users', uid, 'habits', habit.id, 'logs', todayStr))
        )
      );
      const habitsDoneToday = todayHabitLogs.filter((d, i) => {
        if (!d.exists()) return false;
        const habit = habits[i] as any;
        const val = d.data().value ?? 0;
        const target = habit?.targetValue ?? 1;
        const goalType = habit?.goalType ?? 'daily';
        if (goalType === 'daily') return val >= 1;
        if (['count_per_day','count_per_week','count_per_month','count_per_year','times_per_week','distance_month','count_month'].includes(goalType)) return val >= target;
        return val >= 1;
      }).length;
      const totalHabits = habits.length;

      let totalCalories = 0;
      let calorieGoal = 2000;
      if (nutritionDoc.exists()) {
        totalCalories = nutritionDoc.data().totalCalories ?? 0;
      }
      if (profileDoc.exists()) {
        calorieGoal = profileDoc.data().calorieGoal ?? 2000;
      }

      // ── KEY FIX: compare date strings directly, no Date object construction ──
      const workoutDates = new Set<string>();
      workoutSnapshot.docs.forEach(d => {
        const data = d.data();
        // Support both 'date' and 'sessionDate' fields, strip time if present
        const raw = data.date ?? data.sessionDate;
        if (!raw) return;
        const dateStr = String(raw).split('T')[0]; // "2026-06-01"
        if (dateStr >= mondayStr && dateStr <= sundayStr) {
          workoutDates.add(dateStr);
        }
      });
      const workoutsDone = workoutDates.size;
      const workoutsGoal = 4;

      // Build week days
      const now = new Date();
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const weekDays: WeekDay[] = await Promise.all(
        weekDateStrings.map(async (dateStr) => {
          // Reconstruct local date from string for future check only
          const [y, m, day] = dateStr.split('-').map(Number);
          const dayDate = new Date(y, m - 1, day);
          const isToday = dateStr === todayStr;
          const isFuture = dayDate > todayMidnight;
          const trainVal = workoutDates.has(dateStr) ? 1 : 0;

          const reads: Promise<any>[] = [
            getDoc(doc(db, 'users', uid, 'nutritionLogs', dateStr)),
            ...(stepsHabit
              ? [getDoc(doc(db, 'users', uid, 'habits', stepsHabit.id, 'logs', dateStr))]
              : [Promise.resolve(null)]),
            ...habits.map((h: any) =>
              getDoc(doc(db, 'users', uid, 'habits', h.id, 'logs', dateStr))
            ),
          ];

          const results = await Promise.all(reads);
          const nutritionDocDay = results[0];
          const stepsDoc = results[1];
          const habitDocs = results.slice(2);

          const fuelVal = nutritionDocDay?.exists()
            ? Math.min(1, (nutritionDocDay.data().totalCalories ?? 0) / calorieGoal)
            : 0;

          const moveVal = stepsHabit && stepsDoc?.exists()
            ? Math.min(1, (stepsDoc.data().value ?? stepsDoc.data().steps ?? 0) / stepsGoal)
            : 0;

          const habitsDoneCount = habitDocs.filter((d, i) => {
            if (!d?.exists()) return false;
            const habit = habits[i] as any;
            const val = d.data().value ?? 0;
            const target = habit?.targetValue ?? 1;
            const goalType = habit?.goalType ?? 'daily';
            if (goalType === 'daily') return val >= 1;
            if (['count_per_day','count_per_week','count_per_month','count_per_year','times_per_week','distance_month','count_month'].includes(goalType)) return val >= target;
            return val >= 1;
          }).length;
          const trackVal = totalHabits > 0
            ? Math.min(1, habitsDoneCount / totalHabits)
            : 0;

          return { dateStr, trainVal, moveVal, trackVal, fuelVal, isToday, isFuture };
        })
      );

      setState({
        train: {
          pct: Math.min(100, (workoutsDone / workoutsGoal) * 100),
          done: workoutsDone,
          goal: workoutsGoal,
          label: `${workoutsDone} of ${workoutsGoal} workouts`,
        },
        move: {
          pct: Math.min(100, (stepsToday / stepsGoal) * 100),
          current: stepsToday,
          goal: stepsGoal,
          label: `${stepsToday.toLocaleString()} / ${stepsGoal.toLocaleString()} steps`,
        },
        track: {
          pct: totalHabits > 0 ? Math.min(100, (habitsDoneToday / totalHabits) * 100) : 0,
          done: habitsDoneToday,
          total: totalHabits,
          label: `${habitsDoneToday} of ${totalHabits} habits`,
        },
        fuel: {
          pct: Math.min(100, (totalCalories / calorieGoal) * 100),
          current: totalCalories,
          goal: calorieGoal,
          label: `${totalCalories.toLocaleString()} / ${calorieGoal.toLocaleString()} kcal`,
        },
        weekDays,
      });
    };

    fetchData();
  }, [uid, refreshKey]);

  return state;
}