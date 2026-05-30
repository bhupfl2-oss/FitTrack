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
  return new Date().toISOString().split('T')[0];
}

function getWeekRange(): { monday: Date; sunday: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

function dateToStr(date: Date): string {
  return date.toISOString().split('T')[0];
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
      const { monday, sunday } = getWeekRange();

      // Fetch all data in parallel
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

      // Process habits
      const habits = habitsSnapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as Array<{ id: string; name?: string; target?: number; targetValue?: number }>;

      // Find steps habit
      const stepsHabit = habits.find(h => h.name?.toLowerCase().includes('step'));

      // Fetch steps log if steps habit exists
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

      // Fetch today's habit logs — all in parallel
      const todayHabitLogs = await Promise.all(
        habits.map((habit: any) =>
          getDoc(doc(db, 'users', uid, 'habits', habit.id, 'logs', todayStr))
        )
      );
      const habitsDoneToday = todayHabitLogs.filter(d => d.exists()).length;
      const totalHabits = habits.length;

      // Process nutrition/calories
      let totalCalories = 0;
      let calorieGoal = 2000;
      if (nutritionDoc.exists()) {
        totalCalories = nutritionDoc.data().totalCalories ?? 0;
      }
      if (profileDoc.exists()) {
        calorieGoal = profileDoc.data().calorieGoal ?? 2000;
      }

      // Process workouts - count distinct dates in current week
      const workoutDates = new Set<string>();
      workoutSnapshot.docs.forEach(d => {
        const data = d.data();
        const sessionDate = data.sessionDate ?? data.date;
        if (sessionDate) {
          const date = new Date(sessionDate);
          if (date >= monday && date <= sunday) {
            workoutDates.add(sessionDate.split('T')[0]);
          }
        }
      });
      const workoutsDone = workoutDates.size;
      const workoutsGoal = 4;

      // Build week days array — all reads fired in parallel
      const weekDates = Array.from({ length: 7 }, (_, i) => {
        const dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);
        return { dayDate, dateStr: dateToStr(dayDate) };
      });

      const weekDays: WeekDay[] = await Promise.all(
        weekDates.map(async ({ dayDate, dateStr }) => {
          const isToday = dateStr === todayStr;
          const isFuture = dayDate > new Date();
          const trainVal = workoutDates.has(dateStr) ? 1 : 0;

          // Fire all reads for this day in parallel
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
          const nutritionDoc = results[0];
          const stepsDoc = results[1];
          const habitDocs = results.slice(2);

          const fuelVal = nutritionDoc?.exists()
            ? Math.min(1, (nutritionDoc.data().totalCalories ?? 0) / calorieGoal)
            : 0;

          const moveVal = stepsHabit && stepsDoc?.exists()
            ? Math.min(1, (stepsDoc.data().value ?? stepsDoc.data().steps ?? 0) / stepsGoal)
            : 0;

          const habitsDoneCount = habitDocs.filter(d => d?.exists()).length;
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
          label: `${stepsToday.toLocaleString()} / ${stepsGoal.toLocaleString()} ${stepsHabit ? 'steps' : 'steps (no habit)'}`,
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
