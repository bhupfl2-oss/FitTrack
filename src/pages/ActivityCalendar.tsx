import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, Pencil } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import {
  collection, query, orderBy, getDocs,
  doc, where, setDoc, getDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getGoals } from '@/services/goalsService';

interface DayData {
  date: string;
  trainVal: number;   // steps pct 0-1
  moveVal: number;    // cal burned pct 0-1
  trackVal: number;   // cal in pct 0-1
  fuelVal: number;    // sleep pct 0-1
  workout?: { template: string; exercises: any[]; type?: string; distanceKm?: number; durationMins?: number; caloriesBurned?: number };
  steps?: number;
  stepsGoal?: number;
  calBurned?: number;
  calBurnedGoal?: number;
  calIn?: number;
  calInGoal?: number;
  sleepHrs?: number;
  sleepGoal?: number;
  waterCount?: number;
  bodyStats?: { weightKg?: number; pbf?: number; smm?: number; loggedDate?: string };
}

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMonthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) };
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['M','T','W','T','F','S','S'];

function MiniRings({ train, move, track, fuel, size = 24, future = false }: {
  train: number; move: number; track: number; fuel: number;
  size?: number; future?: boolean;
}) {
  const cx = size / 2, cy = size / 2;
  const opacity = future ? 0.12 : 1;
  const arc = (r: number, val: number) => {
    const c = 2 * Math.PI * r;
    return { da: c, do: c * (1 - Math.min(1, Math.max(0, val))) };
  };
  const strokeW = size <= 24 ? 3.5 : size <= 32 ? 4 : 5;
  const r1 = size * 0.46 - strokeW / 2;
  const r2 = r1 - strokeW - 1;
  const r3 = r2 - strokeW - 1;
  const r4 = r3 - strokeW - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity }}>
      <circle cx={cx} cy={cy} r={r1} fill="none" stroke="rgba(255,55,95,0.15)" strokeWidth={strokeW}/>
      <circle cx={cx} cy={cy} r={r1} fill="none" stroke="#ff375f" strokeWidth={strokeW}
        strokeDasharray={arc(r1,train).da} strokeDashoffset={arc(r1,train).do}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      <circle cx={cx} cy={cy} r={r2} fill="none" stroke="rgba(48,209,88,0.15)" strokeWidth={strokeW}/>
      <circle cx={cx} cy={cy} r={r2} fill="none" stroke="#30d158" strokeWidth={strokeW}
        strokeDasharray={arc(r2,move).da} strokeDashoffset={arc(r2,move).do}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      <circle cx={cx} cy={cy} r={r3} fill="none" stroke="rgba(50,173,230,0.15)" strokeWidth={strokeW}/>
      <circle cx={cx} cy={cy} r={r3} fill="none" stroke="#32ade6" strokeWidth={strokeW}
        strokeDasharray={arc(r3,track).da} strokeDashoffset={arc(r3,track).do}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      {r4 > 0 && <>
        <circle cx={cx} cy={cy} r={r4} fill="none" stroke="rgba(249,115,22,0.15)" strokeWidth={strokeW}/>
        <circle cx={cx} cy={cy} r={r4} fill="none" stroke="#f97316" strokeWidth={strokeW}
          strokeDasharray={arc(r4,fuel).da} strokeDashoffset={arc(r4,fuel).do}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      </>}
    </svg>
  );
}

export default function ActivityCalendar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [monthData, setMonthData] = useState<Record<string, DayData>>({});
  const [loading, setLoading] = useState(true);
  usePageLoadTime('ActivityCalendar', loading);
  const [selectedDate, setSelectedDate] = useState<string | null>(dateStr(now));
  const [expandedExercises, setExpandedExercises] = useState(false);
  const [editingField, setEditingField] = useState<'steps' | 'sleep' | 'water' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingField, setSavingField] = useState(false);

  const today = dateStr(now);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    const nextIsAfterToday = viewYear > now.getFullYear() ||
      (viewYear === now.getFullYear() && viewMonth >= now.getMonth());
    if (nextIsAfterToday) return;
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  useEffect(() => {
    if (!user) return;
    fetchMonthData(viewYear, viewMonth);
  }, [user, viewYear, viewMonth]);

  const isPastDate = (date: string) => date < today;

  const saveHabitValue = async (field: 'steps' | 'sleep' | 'water', value: number, date: string) => {
    if (!user) return;
    setSavingField(true);
    try {
      const habitsSnap = await getDocs(collection(db, 'users', user.uid, 'habits'));
      const habits = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const habit = habits.find((h: any) => {
        const n = h.name?.toLowerCase() || '';
        if (field === 'steps') return n.includes('step');
        if (field === 'sleep') return n.includes('sleep');
        if (field === 'water') return n.includes('water');
        return false;
      });
      if (!habit) return;
      const logRef = doc(db, 'users', user.uid, 'habits', habit.id, 'logs', date);
      await setDoc(logRef, { date, value, updatedAt: new Date().toISOString() }, { merge: true });
      // Update local monthData immediately — no full re-fetch needed
      setMonthData(prev => {
        const existing = prev[date] || {} as DayData;
        const stepsGoal = (existing as any).stepsGoal || 8000;
        const sleepGoal = (existing as any).sleepGoal || 8;
        const updated: any = { ...existing };
        if (field === 'steps') { updated.steps = value; updated.trainVal = Math.min(1, value / stepsGoal); }
        if (field === 'sleep') { updated.sleepHrs = value; updated.fuelVal = Math.min(1, value / sleepGoal); }
        if (field === 'water') { updated.waterCount = value; }
        return { ...prev, [date]: updated };
      });
      setEditingField(null);
    } catch (e) {
      console.error('saveHabitValue error:', e);
    } finally {
      setSavingField(false);
    }
  };

  const fetchMonthData = async (year: number, month: number) => {
    setLoading(true);
    const { start, end } = getMonthRange(year, month);
    const startStr = dateStr(start);
    const endStr = dateStr(end);

    try {
      const [workoutSnap, habitsSnap, userGoals] = await Promise.all([
        getDocs(collection(db, 'users', user!.uid, 'workoutSessions')),
        getDocs(collection(db, 'users', user!.uid, 'habits')),
        getGoals(user!.uid),
      ]);

      const stepsGoal   = userGoals.stepsGoal        ?? 8000;
      const burnedGoal  = userGoals.caloriesBurnGoal ?? 400;
      const calInGoal   = userGoals.calorieGoal      ?? 2000;
      const sleepGoal   = userGoals.sleepGoal        ?? 7.5;

      const habits = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const stepsHabit = habits.find((h: any) => h.name?.toLowerCase().includes('step'));
      const sleepHabit = habits.find((h: any) => h.name?.toLowerCase().includes('sleep'));
      const waterHabit = habits.find((h: any) => h.name?.toLowerCase().includes('water'));

      // Build workout map — keyed by date string
      const workoutMap: Record<string, any> = {};
      workoutSnap.docs.forEach(d => {
        const data = d.data() as any;
        const key = String(data.date ?? data.sessionDate ?? '').split('T')[0];
        if (key && key >= startStr && key <= endStr) {
          // If multiple workouts on same day, keep the one with caloriesBurned or latest
          if (!workoutMap[key] || data.caloriesBurned) workoutMap[key] = data;
        }
      });

      // Sum calories burned per day (multiple sessions possible)
      const calBurnedMap: Record<string, number> = {};
      workoutSnap.docs.forEach(d => {
        const data = d.data() as any;
        const key = String(data.date ?? data.sessionDate ?? '').split('T')[0];
        if (key && key >= startStr && key <= endStr && data.caloriesBurned) {
          calBurnedMap[key] = (calBurnedMap[key] || 0) + data.caloriesBurned;
        }
      });

      // Fetch nutrition logs for the month
      const nutritionMap: Record<string, number> = {};
      const daysInMonth = end.getDate();
      const nutritionFetches = Array.from({ length: daysInMonth }, (_, i) => {
        const ds = dateStr(new Date(year, month, i + 1));
        return getDoc(doc(db, 'users', user!.uid, 'nutritionLogs', ds))
          .then(snap => { if (snap.exists()) nutritionMap[ds] = snap.data().totalCalories || 0; })
          .catch(() => {});
      });

      // Fetch steps, sleep, and water logs for the month
      const stepsMap: Record<string, number> = {};
      const sleepMap: Record<string, number> = {};
      const waterMap: Record<string, number> = {};

      const habitLogFetches: Promise<void>[] = [];

      if (stepsHabit) {
        habitLogFetches.push(
          getDocs(query(
            collection(db, 'users', user!.uid, 'habits', stepsHabit.id, 'logs'),
            where('date', '>=', startStr), where('date', '<=', endStr)
          )).then(snap => {
            snap.docs.forEach(d => {
              const data = d.data() as any;
              stepsMap[data.date || d.id] = data.value ?? data.steps ?? 0;
            });
          }).catch(() => {})
        );
      }

      if (sleepHabit) {
        habitLogFetches.push(
          getDocs(query(
            collection(db, 'users', user!.uid, 'habits', sleepHabit.id, 'logs'),
            where('date', '>=', startStr), where('date', '<=', endStr)
          )).then(snap => {
            snap.docs.forEach(d => {
              const data = d.data() as any;
              sleepMap[data.date || d.id] = data.value ?? 0;
            });
          }).catch(() => {})
        );
      }

      if (waterHabit) {
        habitLogFetches.push(
          getDocs(query(
            collection(db, 'users', user!.uid, 'habits', waterHabit.id, 'logs'),
            where('date', '>=', startStr), where('date', '<=', endStr)
          )).then(snap => {
            snap.docs.forEach(d => {
              const data = d.data() as any;
              waterMap[data.date || d.id] = data.value ?? 0;
            });
          }).catch(() => {})
        );
      }

      // Fetch body stats
      let bodyStats: any[] = [];
      try {
        const bodySnap = await getDocs(query(
          collection(db, 'users', user!.uid, 'bodyComp'),
          orderBy('date', 'desc')
        ));
        bodyStats = bodySnap.docs.map(d => ({ ...d.data() } as any));
      } catch {}

      await Promise.all([...nutritionFetches, ...habitLogFetches]);

      // Build day data map
      const data: Record<string, DayData> = {};
      for (let i = 0; i < daysInMonth; i++) {
        const ds = dateStr(new Date(year, month, i + 1));
        const steps    = stepsMap[ds] || 0;
        const sleep    = sleepMap[ds] || 0;
        const calIn    = nutritionMap[ds] || 0;
        const calBurned = calBurnedMap[ds] || 0;
        const workout  = workoutMap[ds];
        const closestBody = bodyStats.find(b => b.date <= ds);

        data[ds] = {
          date: ds,
          trainVal: Math.min(1, steps / stepsGoal),
          moveVal:  Math.min(1, calBurned / burnedGoal),
          trackVal: Math.min(1, calIn / calInGoal),
          fuelVal:  Math.min(1, sleep / sleepGoal),
          workout,
          steps, stepsGoal,
          calBurned, calBurnedGoal: burnedGoal,
          calIn, calInGoal,
          sleepHrs: sleep, sleepGoal,
          waterCount: waterMap[ds] || 0,
          bodyStats: closestBody ? {
            weightKg: closestBody.weightKg,
            pbf: closestBody.pbf,
            smm: closestBody.smm,
            loggedDate: closestBody.date,
          } : undefined,
        };
      }

      setMonthData(data);
    } catch (e) {
      console.error('Error fetching calendar data:', e);
    } finally {
      setLoading(false);
    }
  };

  const { start } = getMonthRange(viewYear, viewMonth);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = start.getDay() === 0 ? 6 : start.getDay() - 1;
  const selected = selectedDate ? monthData[selectedDate] : null;
  const fmt = (v: number | undefined, d = 1) =>
    v != null && !isNaN(v) ? Number(v).toFixed(d) : '--';

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">Activity History</h1>
        <div className="w-9" />
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
        <button onClick={prevMonth} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors">
          <ChevronLeft className="w-4 h-4 text-slate-400" />
        </button>
        <span className="text-sm font-semibold">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth}
          disabled={viewYear === now.getFullYear() && viewMonth >= now.getMonth()}
          className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30">
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Ring legend */}
      <div className="flex justify-center gap-4 px-4 py-2 border-b border-slate-800/50">
        {[
          { color: '#ff375f', label: 'Steps' },
          { color: '#30d158', label: 'Burned' },
          { color: '#32ade6', label: 'Calories' },
          { color: '#f97316', label: 'Sleep' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-[9px] font-mono text-slate-500 uppercase">{label}</span>
          </div>
        ))}
      </div>

      {/* Day of week headers */}
      <div className="grid grid-cols-7 px-2 pt-2">
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="text-center text-[9px] font-mono text-slate-600 uppercase py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-7 px-2 pb-2 gap-y-1">
          {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`empty-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = new Date(viewYear, viewMonth, i + 1);
            const ds = dateStr(d);
            const isFuture = d > now;
            const isToday = ds === today;
            const isSelected = ds === selectedDate;
            const dayData = monthData[ds];
            return (
              <button key={ds}
                onClick={() => { setSelectedDate(isSelected ? null : ds); setExpandedExercises(false); }}
                disabled={isFuture}
                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors disabled:cursor-default ${
                  isSelected ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40'
                  : isToday ? 'bg-slate-800/50'
                  : 'hover:bg-slate-800/30'
                }`}>
                <MiniRings
                  train={dayData?.trainVal || 0}
                  move={dayData?.moveVal || 0}
                  track={dayData?.trackVal || 0}
                  fuel={dayData?.fuelVal || 0}
                  size={34} future={isFuture}
                />
                <span className={`text-[9px] font-mono ${
                  isToday ? 'text-emerald-400 font-bold' : isFuture ? 'text-slate-700' : 'text-slate-500'
                }`}>{i + 1}</span>
                {isToday && <div className="w-1 h-1 rounded-full bg-emerald-400" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Day detail panel */}
      {selected && (
        <div className="mx-4 mb-4 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-800/50 border-b border-slate-800">
            <div className="text-sm font-semibold">
              {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {selected.date === today && <span className="ml-2 text-[10px] font-mono text-emerald-400">Today</span>}
            </div>
            <div className="flex items-center gap-2">
              {[
                { pct: Math.round(selected.trainVal * 100), color: '#ff375f' },
                { pct: Math.round(selected.moveVal * 100), color: '#30d158' },
                { pct: Math.round(selected.trackVal * 100), color: '#32ade6' },
                { pct: Math.round(selected.fuelVal * 100), color: '#f97316' },
              ].map(({ pct, color }, i) => (
                <span key={i} className="text-[10px] font-mono font-semibold" style={{ color }}>{pct}%</span>
              ))}
              <button onClick={() => setSelectedDate(null)} className="ml-1 text-slate-600 hover:text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* STEPS (outer/red) */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🚶</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Steps</span>
              <span className="ml-auto text-[10px] font-mono text-red-400">
                {selected.steps ? selected.steps.toLocaleString() : '—'}
              </span>
            </div>
            {selected.steps && selected.steps > 0 ? (
              <div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full"
                    style={{ width: `${Math.min(100, (selected.steps / (selected.stepsGoal || 8000)) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">Goal: {(selected.stepsGoal || 8000).toLocaleString()}</div>
              </div>
            ) : (
              <div className="text-xs text-slate-600">No steps logged</div>
            )}
            {isPastDate(selected.date) && (
              editingField === 'steps' ? (
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                    className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-red-400"
                    autoFocus />
                  <button onClick={() => saveHabitValue('steps', parseInt(editValue) || 0, selected.date)}
                    disabled={savingField}
                    className="text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-1 rounded-lg disabled:opacity-50">
                    {savingField ? '…' : '✓ Save'}
                  </button>
                  <button onClick={() => setEditingField(null)} className="text-slate-500 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => { setEditValue(String(selected.steps || 0)); setEditingField('steps'); }}
                  className="flex items-center gap-1 mt-1 text-[9px] font-mono text-slate-600 hover:text-red-400 transition-colors">
                  <Pencil className="w-2.5 h-2.5" /> Edit
                </button>
              )
            )}
          </div>

          {/* CALORIES BURNED (2nd/green) */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🔥</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Calories Burned</span>
              <span className="ml-auto text-[10px] font-mono text-green-400">
                {selected.calBurned ? `${selected.calBurned} kcal` : '—'}
              </span>
            </div>
            {selected.calBurned && selected.calBurned > 0 ? (
              <div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full"
                    style={{ width: `${Math.min(100, (selected.calBurned / (selected.calBurnedGoal || 400)) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">Goal: {selected.calBurnedGoal || 400} kcal</div>
              </div>
            ) : (
              <div className="text-xs text-slate-600">
                {selected.workout ? 'Workout logged — AI analysis pending' : 'No workout logged'}
              </div>
            )}
            {/* Workout summary below */}
            {selected.workout && (
              <div className="mt-2 pt-2 border-t border-slate-800/50">
                <div className="text-[10px] font-mono text-slate-500 capitalize mb-1">{selected.workout.template}</div>
                <div className="flex gap-3 mt-1 mb-2">
                  {selected.workout.durationMins != null && selected.workout.durationMins > 0 && (
                    <span className="text-[10px] font-mono text-emerald-400">
                      ⏱ {Math.floor(selected.workout.durationMins)}m
                      {Math.round((selected.workout.durationMins % 1) * 60) > 0
                        ? ` ${Math.round((selected.workout.durationMins % 1) * 60)}s`
                        : ''}
                    </span>
                  )}
                  {selected.calBurned != null && selected.calBurned > 0 && (
                    <span className="text-[10px] font-mono text-orange-400">🔥 {selected.calBurned} kcal</span>
                  )}
                </div>
                {selected.workout.type === 'running' ? (
                  <div className="text-xs text-slate-400">🏃 {selected.workout.distanceKm ?? '--'}km · {selected.workout.durationMins ?? '--'} min</div>
                ) : (
                  <div className="space-y-1">
                    {(selected.workout.exercises || []).slice(0, expandedExercises ? undefined : 3).map((ex: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-slate-300">{ex.name}</span>
                        <span className="font-mono text-slate-500">{ex.sets?.length ?? 0} sets</span>
                      </div>
                    ))}
                    {(selected.workout.exercises?.length ?? 0) > 3 && (
                      <button onClick={() => setExpandedExercises(e => !e)}
                        className="text-[10px] text-emerald-400 font-mono mt-1 hover:text-emerald-300">
                        {expandedExercises ? '↑ Show less' : `+ ${selected.workout.exercises.length - 3} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CALORIES IN (3rd/blue) */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🍽️</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Calories In</span>
              <span className="ml-auto text-[10px] font-mono text-blue-400">
                {selected.calIn ? `${selected.calIn} kcal` : '—'}
              </span>
            </div>
            {selected.calIn && selected.calIn > 0 ? (
              <div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min(100, (selected.calIn / (selected.calInGoal || 2000)) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">Goal: {(selected.calInGoal || 2000).toLocaleString()} kcal</div>
              </div>
            ) : (
              <div className="text-xs text-slate-600">No food logged</div>
            )}
          </div>

          {/* SLEEP (inner/orange) */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">😴</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Sleep</span>
              <span className="ml-auto text-[10px] font-mono text-orange-400">
                {selected.sleepHrs ? `${selected.sleepHrs} hrs` : '—'}
              </span>
            </div>
            {selected.sleepHrs && selected.sleepHrs > 0 ? (
              <div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full"
                    style={{ width: `${Math.min(100, (selected.sleepHrs / (selected.sleepGoal || 8)) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">Goal: {selected.sleepGoal || 8} hrs</div>
              </div>
            ) : (
              <div className="text-xs text-slate-600">No sleep logged</div>
            )}
            {isPastDate(selected.date) && (
              editingField === 'sleep' ? (
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" min="0" max="24" step="0.5" value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-orange-400"
                    autoFocus />
                  <span className="text-[9px] text-slate-500">hrs</span>
                  <button onClick={() => saveHabitValue('sleep', parseFloat(editValue) || 0, selected.date)}
                    disabled={savingField}
                    className="text-[10px] font-mono bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-1 rounded-lg disabled:opacity-50">
                    {savingField ? '…' : '✓ Save'}
                  </button>
                  <button onClick={() => setEditingField(null)} className="text-slate-500 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => { setEditValue(String(selected.sleepHrs || 0)); setEditingField('sleep'); }}
                  className="flex items-center gap-1 mt-1 text-[9px] font-mono text-slate-600 hover:text-orange-400 transition-colors">
                  <Pencil className="w-2.5 h-2.5" /> Edit
                </button>
              )
            )}
          </div>

          {/* WATER */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">💧</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Water</span>
              <span className="ml-auto text-[10px] font-mono text-blue-400">
                {selected.waterCount ? `${selected.waterCount} glasses` : '—'}
              </span>
            </div>
            {selected.waterCount && selected.waterCount > 0 ? (
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.min(100, (selected.waterCount / 8) * 100)}%` }} />
              </div>
            ) : (
              <div className="text-xs text-slate-600">No water logged</div>
            )}
            {isPastDate(selected.date) && (
              editingField === 'water' ? (
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" min="0" value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-400"
                    autoFocus />
                  <span className="text-[9px] text-slate-500">glasses</span>
                  <button onClick={() => saveHabitValue('water', parseInt(editValue) || 0, selected.date)}
                    disabled={savingField}
                    className="text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded-lg disabled:opacity-50">
                    {savingField ? '…' : '✓ Save'}
                  </button>
                  <button onClick={() => setEditingField(null)} className="text-slate-500 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => { setEditValue(String(selected.waterCount || 0)); setEditingField('water'); }}
                  className="flex items-center gap-1 mt-1 text-[9px] font-mono text-slate-600 hover:text-blue-400 transition-colors">
                  <Pencil className="w-2.5 h-2.5" /> Edit
                </button>
              )
            )}
          </div>

          {/* BODY STATS */}
          {selected.bodyStats && (
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">📊</span>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Body</span>
                {selected.bodyStats.loggedDate && selected.bodyStats.loggedDate !== selected.date && (
                  <span className="ml-auto text-[9px] text-slate-600 font-mono">
                    Logged {new Date(selected.bodyStats.loggedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                {selected.bodyStats.weightKg && (
                  <div className="bg-slate-800 rounded-lg px-3 py-2 text-center flex-1">
                    <div className="text-xs font-bold font-mono text-white">{fmt(selected.bodyStats.weightKg)}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">kg</div>
                  </div>
                )}
                {selected.bodyStats.pbf && (
                  <div className="bg-slate-800 rounded-lg px-3 py-2 text-center flex-1">
                    <div className="text-xs font-bold font-mono text-white">{fmt(selected.bodyStats.pbf)}%</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">body fat</div>
                  </div>
                )}
                {selected.bodyStats.smm && (
                  <div className="bg-slate-800 rounded-lg px-3 py-2 text-center flex-1">
                    <div className="text-xs font-bold font-mono text-white">{fmt(selected.bodyStats.smm)}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">muscle kg</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}