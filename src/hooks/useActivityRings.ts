import { useState, useEffect } from 'react';
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getGoals, calculateGoalsWithAI, DEFAULT_GOALS as SERVICE_DEFAULTS } from '@/services/goalsService';

// ── Types ──────────────────────────────────────────────────────────────────

interface ActivityRing {
  pct: number;
  label: string;
  current: number;
  goal: number;
}

interface WeekDay {
  dateStr: string;
  trainVal: number;  // steps pct
  moveVal: number;   // cal burned pct
  trackVal: number;  // cal in pct
  fuelVal: number;   // sleep pct
  isToday: boolean;
  isFuture: boolean;
}

interface ActivityRingsState {
  train: ActivityRing;   // outer  — steps
  move: ActivityRing;    // 2nd    — calories burned
  track: ActivityRing;   // 3rd    — calories in
  fuel: ActivityRing;    // inner  — sleep
  weekDays: WeekDay[];
}

interface RingGoals {
  steps: number;
  caloriesBurned: number;
  caloriesIn: number;
  sleep: number;
  generatedAt?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekDateStrings(): string[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
}

const DEFAULT_GOALS: RingGoals = {
  steps: SERVICE_DEFAULTS.stepsGoal,
  caloriesBurned: SERVICE_DEFAULTS.caloriesBurnGoal,
  caloriesIn: SERVICE_DEFAULTS.calorieGoal,
  sleep: SERVICE_DEFAULTS.sleepGoal,
};

// ── Main hook ──────────────────────────────────────────────────────────────

export function useActivityRings(uid: string | undefined, refreshKey?: number): ActivityRingsState {
  const [state, setState] = useState<ActivityRingsState>({
    train: { pct: 0, current: 0, goal: DEFAULT_GOALS.steps, label: '0 / 8,000 steps' },
    move:  { pct: 0, current: 0, goal: DEFAULT_GOALS.caloriesBurned, label: '0 / 400 kcal burned' },
    track: { pct: 0, current: 0, goal: DEFAULT_GOALS.caloriesIn, label: '0 / 2,000 kcal' },
    fuel:  { pct: 0, current: 0, goal: DEFAULT_GOALS.sleep, label: '0 / 8 hrs sleep' },
    weekDays: [],
  });

  useEffect(() => {
    if (!uid) return;

    const fetchData = async () => {
      const todayStr = getTodayStr();
      const weekDateStrings = getWeekDateStrings();

      // ── Fetch all base data in parallel ──
      const [workoutSnapshot, habitsSnapshot, nutritionDoc, profileDoc] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'workoutSessions')),
        getDocs(collection(db, 'users', uid, 'habits')),
        getDoc(doc(db, 'users', uid, 'nutritionLogs', todayStr)),
        getDoc(doc(db, 'users', uid, 'profile', 'data')),
      ]);
      const profile = profileDoc.exists() ? profileDoc.data() as any : {};

      // ── Load goals from goals/current (single source of truth) ──
      const userGoals = await getGoals(uid);
      const goals: RingGoals = {
        steps:          userGoals.stepsGoal        ?? DEFAULT_GOALS.steps,
        caloriesBurned: userGoals.caloriesBurnGoal ?? DEFAULT_GOALS.caloriesBurned,
        caloriesIn:     userGoals.calorieGoal      ?? DEFAULT_GOALS.caloriesIn,
        sleep:          userGoals.sleepGoal         ?? DEFAULT_GOALS.sleep,
      };

      // Recalculate if goals have never been set or are older than 7 days
      const agedays = userGoals.updatedAt
        ? (Date.now() - new Date(userGoals.updatedAt).getTime()) / 86400000
        : 999;
      if (agedays > 7) {
        calculateGoalsWithAI(uid, { trigger: 'manual_refresh' }).then(newGoals => {
          setState(prev => ({
            ...prev,
            train: { ...prev.train, goal: newGoals.stepsGoal        ?? prev.train.goal },
            move:  { ...prev.move,  goal: newGoals.caloriesBurnGoal ?? prev.move.goal  },
            track: { ...prev.track, goal: newGoals.calorieGoal      ?? prev.track.goal },
            fuel:  { ...prev.fuel,  goal: newGoals.sleepGoal        ?? prev.fuel.goal  },
          }));
        });
      }

      // ── Habits ──
      const habits = habitsSnapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const stepsHabit = habits.find((h: any) => h.name?.toLowerCase().includes('step'));
      const sleepHabit = habits.find((h: any) => h.name?.toLowerCase().includes('sleep'));

      // ── Today: steps ──
      let stepsToday = 0;
      if (stepsHabit) {
        const log = await getDoc(doc(db, 'users', uid, 'habits', stepsHabit.id, 'logs', todayStr));
        if (log.exists()) stepsToday = log.data().value ?? log.data().steps ?? 0;
      }

      // ── Today: sleep ──
      let sleepToday = 0;
      if (sleepHabit) {
        const log = await getDoc(doc(db, 'users', uid, 'habits', sleepHabit.id, 'logs', todayStr));
        if (log.exists()) sleepToday = log.data().value ?? 0;
      }

      // ── Today: calories in ──
      let calIn = 0;
      if (nutritionDoc.exists()) calIn = nutritionDoc.data().totalCalories ?? 0;

      // ── Today: calories burned — sum from today's workout sessions + manual ──
      let calBurned = 0;
      workoutSnapshot.docs.forEach(d => {
        const data = d.data();
        const dateStr = String(data.date ?? data.sessionDate ?? '').split('T')[0];
        if (dateStr === todayStr && data.caloriesBurned) {
          calBurned += data.caloriesBurned;
        }
      });
      // Manual top-up from profile or a dedicated field
      const manualCalBurned = profile.manualCalBurnedToday?.date === todayStr
        ? (profile.manualCalBurnedToday?.value ?? 0)
        : 0;
      calBurned += manualCalBurned;

      // ── Week days ──
      const now = new Date();
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const weekDays: WeekDay[] = await Promise.all(
        weekDateStrings.map(async (dateStr) => {
          const [y, m, day] = dateStr.split('-').map(Number);
          const dayDate = new Date(y, m - 1, day);
          const isToday = dateStr === todayStr;
          const isFuture = dayDate > todayMidnight;

          if (isToday) {
            return {
              dateStr,
              trainVal: Math.min(1, stepsToday / goals.steps),
              moveVal:  Math.min(1, calBurned / goals.caloriesBurned),
              trackVal: Math.min(1, calIn / goals.caloriesIn),
              fuelVal:  Math.min(1, sleepToday / goals.sleep),
              isToday: true,
              isFuture: false,
            };
          }

          if (isFuture) {
            return { dateStr, trainVal: 0, moveVal: 0, trackVal: 0, fuelVal: 0, isToday: false, isFuture: true };
          }

          // Past days — fetch from Firestore
          const reads: Promise<any>[] = [
            getDoc(doc(db, 'users', uid, 'nutritionLogs', dateStr)),
            stepsHabit ? getDoc(doc(db, 'users', uid, 'habits', stepsHabit.id, 'logs', dateStr)) : Promise.resolve(null),
            sleepHabit ? getDoc(doc(db, 'users', uid, 'habits', sleepHabit.id, 'logs', dateStr)) : Promise.resolve(null),
          ];
          const [nutDoc, stepsDoc, sleepDoc] = await Promise.all(reads);

          const pastSteps = stepsDoc?.exists() ? (stepsDoc.data().value ?? stepsDoc.data().steps ?? 0) : 0;
          const pastSleep = sleepDoc?.exists() ? (sleepDoc.data().value ?? 0) : 0;
          const pastCalIn = nutDoc?.exists() ? (nutDoc.data().totalCalories ?? 0) : 0;

          // Calories burned — sum sessions on this date
          let pastCalBurned = 0;
          workoutSnapshot.docs.forEach(d => {
            const data = d.data();
            const ds = String(data.date ?? data.sessionDate ?? '').split('T')[0];
            if (ds === dateStr && data.caloriesBurned) pastCalBurned += data.caloriesBurned;
          });

          return {
            dateStr,
            trainVal:  Math.min(1, pastSteps / goals.steps),
            moveVal:   Math.min(1, pastCalBurned / goals.caloriesBurned),
            trackVal:  Math.min(1, pastCalIn / goals.caloriesIn),
            fuelVal:   Math.min(1, pastSleep / goals.sleep),
            isToday: false,
            isFuture: false,
          };
        })
      );

      setState({
        train: {
          pct: Math.min(100, (stepsToday / goals.steps) * 100),
          current: stepsToday,
          goal: goals.steps,
          label: `${stepsToday.toLocaleString()} / ${goals.steps.toLocaleString()} steps`,
        },
        move: {
          pct: Math.min(100, (calBurned / goals.caloriesBurned) * 100),
          current: calBurned,
          goal: goals.caloriesBurned,
          label: `${calBurned} / ${goals.caloriesBurned} kcal burned`,
        },
        track: {
          pct: Math.min(100, (calIn / goals.caloriesIn) * 100),
          current: calIn,
          goal: goals.caloriesIn,
          label: `${calIn.toLocaleString()} / ${goals.caloriesIn.toLocaleString()} kcal`,
        },
        fuel: {
          pct: Math.min(100, (sleepToday / goals.sleep) * 100),
          current: sleepToday,
          goal: goals.sleep,
          label: `${sleepToday} / ${goals.sleep} hrs sleep`,
        },
        weekDays,
      });
    };

    fetchData();
  }, [uid, refreshKey]);

  return state;
}