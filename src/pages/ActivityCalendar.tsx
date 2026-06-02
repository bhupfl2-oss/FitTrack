import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import {
  collection, query, orderBy, getDocs,
  doc, getDoc, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface DayData {
  date: string;
  trainVal: number;   // 0 or 1
  moveVal: number;    // 0-1
  trackVal: number;   // 0-1
  fuelVal: number;    // 0-1
  workout?: { template: string; exercises: any[]; type?: string; distanceKm?: number; durationMins?: number };
  steps?: number;
  stepsGoal?: number;
  habitsDone?: number;
  habitsTotal?: number;
  habitDetails?: { name: string; icon: string; done: boolean }[];
  calories?: number;
  calorieGoal?: number;
  bodyStats?: { weightKg?: number; pbf?: number; smm?: number; loggedDate?: string };
}

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { start, end };
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['M','T','W','T','F','S','S'];

// SVG ring helper
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

  const fetchMonthData = async (year: number, month: number) => {
    setLoading(true);
    const { start, end } = getMonthRange(year, month);
    const startStr = dateStr(start);
    const endStr = dateStr(end);

    try {
      // Fetch workouts, habits, nutrition, body in parallel
      const [workoutSnap, habitsSnap, profileSnap] = await Promise.all([
        getDocs(collection(db, 'users', user!.uid, 'workoutSessions')),
        getDocs(collection(db, 'users', user!.uid, 'habits')),
        getDoc(doc(db, 'users', user!.uid, 'profile', 'data')),
      ]);

      const profile = profileSnap.exists() ? profileSnap.data() as any : {};
      const calorieGoal = profile.calorieGoal || 2000;
      const habits = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const stepsHabit = habits.find((h: any) => h.name?.toLowerCase().includes('step'));
      const stepsGoal = stepsHabit?.targetValue || stepsHabit?.target || 8000;
      const totalHabits = habits.length;

      // Build workout map — handle both 'date' and legacy 'sessionDate' fields
      const workoutMap: Record<string, any> = {};
      workoutSnap.docs.forEach(d => {
        const data = d.data() as any;
        const key = data.date ?? (data.sessionDate ? String(data.sessionDate).split('T')[0] : null);
        if (key && key >= startStr && key <= endStr) workoutMap[key] = data;
      });

      // Fetch nutrition logs for the month
      const nutritionMap: Record<string, number> = {};
      const daysInMonth = end.getDate();
      const nutritionFetches = Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(year, month, i + 1);
        const ds = dateStr(d);
        return getDoc(doc(db, 'users', user!.uid, 'nutritionLogs', ds))
          .then(snap => { if (snap.exists()) nutritionMap[ds] = snap.data().totalCalories || 0; })
          .catch(() => {});
      });

      // Fetch habit logs for the month (batch per habit)
      const habitLogsMap: Record<string, Record<string, boolean>> = {};
      const stepsMap: Record<string, number> = {};

      const habitLogFetches = habits.map(async (habit: any) => {
        habitLogsMap[habit.id] = {};
        try {
          const logSnap = await getDocs(
            query(collection(db, 'users', user!.uid, 'habits', habit.id, 'logs'),
              where('date', '>=', startStr), where('date', '<=', endStr))
          );
          logSnap.docs.forEach(d => {
            const data = d.data() as any;
            const logDate = data.date || d.id;
            const val = data.value ?? 0;
            const target = habit.targetValue ?? 1;
            const goalType = habit.goalType ?? 'daily';
            const done = goalType === 'daily' ? val >= 1
              : ['count_per_day','count_per_week','count_per_month','count_per_year','times_per_week','distance_month','count_month'].includes(goalType) ? val >= target
              : val >= 1;
            habitLogsMap[habit.id][logDate] = done;
            if (habit.name?.toLowerCase().includes('step')) {
              stepsMap[logDate] = data.value || data.steps || 0;
            }
          });
        } catch {}
      });

      // Fetch body stats for the month
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
        const d = new Date(year, month, i + 1);
        const ds = dateStr(d);


        const workout = workoutMap[ds];
        const calories = nutritionMap[ds] || 0;
        const steps = stepsMap[ds] || 0;

        // Count habits done this day
        let habitsDone = 0;
        const habitDetails: { name: string; icon: string; done: boolean }[] = [];
        habits.forEach((habit: any) => {
          const done = !!habitLogsMap[habit.id]?.[ds];
          if (done) habitsDone++;
          habitDetails.push({ name: habit.name, icon: habit.icon || '💪', done });
        });

        // Find closest body stats (same day or most recent before)
        const closestBody = bodyStats.find(b => b.date <= ds);

        data[ds] = {
          date: ds,
          trainVal: workout ? 1 : 0,
          moveVal: stepsHabit ? Math.min(1, steps / stepsGoal) : 0,
          trackVal: totalHabits > 0 ? Math.min(1, habitsDone / totalHabits) : 0,
          fuelVal: calories > 0 ? Math.min(1, calories / calorieGoal) : 0,
          workout,
          steps,
          stepsGoal,
          habitsDone,
          habitsTotal: totalHabits,
          habitDetails,
          calories,
          calorieGoal,
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

  // Build calendar grid
  const { start } = getMonthRange(viewYear, viewMonth);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // Monday-first offset
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
        <button
          onClick={nextMonth}
          disabled={viewYear === now.getFullYear() && viewMonth >= now.getMonth()}
          className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30"
        >
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Ring legend */}
      <div className="flex justify-center gap-4 px-4 py-2 border-b border-slate-800/50">
        {[
          { color: '#ff375f', label: 'Train' },
          { color: '#30d158', label: 'Move' },
          { color: '#32ade6', label: 'Track' },
          { color: '#f97316', label: 'Fuel' },
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
          {/* Empty cells for offset */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = new Date(viewYear, viewMonth, i + 1);
            const ds = dateStr(d);
            const isFuture = d > now;
            const isToday = ds === today;
            const isSelected = ds === selectedDate;
            const dayData = monthData[ds];

            return (
              <button
                key={ds}
                onClick={() => {
                  setSelectedDate(isSelected ? null : ds);
                  setExpandedExercises(false);
                }}
                disabled={isFuture}
                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors disabled:cursor-default ${
                  isSelected
                    ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40'
                    : isToday
                    ? 'bg-slate-800/50'
                    : 'hover:bg-slate-800/30'
                }`}
              >
                <MiniRings
                  train={dayData?.trainVal || 0}
                  move={dayData?.moveVal || 0}
                  track={dayData?.trackVal || 0}
                  fuel={dayData?.fuelVal || 0}
                  size={34}
                  future={isFuture}
                />
                <span className={`text-[9px] font-mono ${
                  isToday ? 'text-emerald-400 font-bold'
                  : isFuture ? 'text-slate-700'
                  : 'text-slate-500'
                }`}>
                  {i + 1}
                </span>
                {isToday && <div className="w-1 h-1 rounded-full bg-emerald-400" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Day detail panel */}
      {selected && (
        <div className="mx-4 mb-4 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {/* Detail header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-800/50 border-b border-slate-800">
            <div>
              <div className="text-sm font-semibold">
                {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'short', day: 'numeric'
                })}
                {selected.date === today && <span className="ml-2 text-[10px] font-mono text-emerald-400">Today</span>}
              </div>
            </div>
            {/* Ring summary badges */}
            <div className="flex items-center gap-2">
              {[
                { pct: Math.round(selected.trainVal * 100), color: '#ff375f' },
                { pct: Math.round(selected.moveVal * 100), color: '#30d158' },
                { pct: Math.round(selected.trackVal * 100), color: '#32ade6' },
                { pct: Math.round(selected.fuelVal * 100), color: '#f97316' },
              ].map(({ pct, color }, i) => (
                <span key={i} className="text-[10px] font-mono font-semibold" style={{ color }}>
                  {pct}%
                </span>
              ))}
              <button onClick={() => setSelectedDate(null)} className="ml-1 text-slate-600 hover:text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* TRAIN */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🏋️</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Train</span>
              {selected.workout && (
                <span className="ml-auto text-[10px] font-mono text-emerald-400 capitalize">
                  {selected.workout.template}
                </span>
              )}
            </div>
            {selected.workout ? (
              selected.workout.type === 'running' ? (
                <div className="text-xs text-slate-400">
                  🏃 Running · {selected.workout.distanceKm ?? '--'}km · {selected.workout.durationMins ?? '--'} min
                </div>
              ) : (
                <div className="space-y-1">
                  {(selected.workout.exercises || [])
                    .slice(0, expandedExercises ? undefined : 4)
                    .map((ex: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-slate-300">{ex.name}</span>
                      <span className="font-mono text-slate-500">
                        {ex.sets?.length ?? 0} sets · {ex.sets?.[0]?.weight > 0 ? `${ex.sets[0].weight}kg` : '--'}
                      </span>
                    </div>
                  ))}
                  {(selected.workout.exercises?.length ?? 0) > 4 && (
                    <button
                      onClick={() => setExpandedExercises(e => !e)}
                      className="text-[10px] text-emerald-400 font-mono mt-1 hover:text-emerald-300 transition-colors"
                    >
                      {expandedExercises
                        ? '↑ Show less'
                        : `+ ${selected.workout.exercises.length - 4} more exercises`}
                    </button>
                  )}
                </div>
              )
            ) : (
              <div className="text-xs text-slate-600">Rest day</div>
            )}
          </div>

          {/* MOVE */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🚶</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Move</span>
              <span className="ml-auto text-[10px] font-mono text-green-400">
                {selected.steps ? `${selected.steps.toLocaleString()} steps` : '—'}
              </span>
            </div>
            {selected.steps && selected.stepsGoal ? (
              <div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full"
                    style={{ width: `${Math.min(100, (selected.steps / selected.stepsGoal) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">
                  Goal: {selected.stepsGoal.toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-600">No steps logged</div>
            )}
          </div>

          {/* TRACK — habits */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🔵</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Track · Habits</span>
              <span className="ml-auto text-[10px] font-mono text-blue-400">
                {selected.habitsDone ?? 0} / {selected.habitsTotal ?? 0}
              </span>
            </div>
            {selected.habitDetails && selected.habitDetails.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selected.habitDetails.map((h, i) => (
                  <span key={i} className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${
                    h.done
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-slate-800 text-slate-600 border border-slate-700 line-through'
                  }`}>
                    {h.icon} {h.name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600">No habits set up</div>
            )}
          </div>

          {/* FUEL */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🟠</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Fuel</span>
              <span className="ml-auto text-[10px] font-mono text-orange-400">
                {selected.calories ? `${selected.calories} kcal` : '—'}
              </span>
            </div>
            {selected.calories && selected.calories > 0 ? (
              <div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full"
                    style={{ width: `${Math.min(100, ((selected.calories || 0) / (selected.calorieGoal || 2000)) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">
                  Goal: {selected.calorieGoal?.toLocaleString()} kcal
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-600">No food logged</div>
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