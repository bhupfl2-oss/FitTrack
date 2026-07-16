import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import {
  getActiveRacePlan,
  generateRacePlan,
  computeAdherence,
  getCurrentWeekEntry,
  getWeekEntryByDate,
  getWeekEntryByNumber,
  getPlanDayForDate,
  getGymSplitForDate,
  type RacePlan,
  type RaceType,
  type RunType,
} from '@/services/racePlanService';
import { paceStr } from '@/pages/RunningSession';

// ── Local date helper ────────────────────────────────────────────────────
// Never use toISOString() for calendar-day strings — it converts to UTC and
// shifts the date for IST (same lesson documented in AICoach.tsx / racePlanService.ts).
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toLocalDateStr(d);
}

const RACE_TYPES: { value: RaceType; label: string }[] = [
  { value: '5k', label: '5K' },
  { value: '10k', label: '10K' },
  { value: 'half_marathon', label: 'Half Marathon' },
  { value: 'full_marathon', label: 'Full Marathon' },
  { value: 'custom', label: 'Custom' },
];

const RUN_TYPE_STYLES: Record<RunType, { bg: string; text: string; border: string }> = {
  recovery: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  tempo: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  long_run: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  intervals: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  race: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  rest: { bg: 'bg-slate-800/50', text: 'text-slate-500', border: 'border-slate-700' },
};

const RUN_TYPE_LABELS: Record<RunType, string> = {
  recovery: 'Recovery',
  tempo: 'Tempo',
  long_run: 'Long',
  intervals: 'Intervals',
  race: 'Race',
  rest: 'Rest',
};

async function fetchRecentRunningSessions(uid: string): Promise<any[]> {
  // Composite query (type == 'running' + orderBy date) — same try/catch-then-
  // client-sort fallback pattern as WorkoutSession.tsx:262-278 / racePlanService.ts,
  // since this repo has no pre-provisioned firestore.indexes.json.
  try {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workoutSessions'),
      where('type', '==', 'running'),
      orderBy('date', 'desc'),
      limit(10)
    ));
    return snap.docs.map(d => d.data());
  } catch {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workoutSessions'),
      where('type', '==', 'running'),
      limit(50)
    ));
    return snap.docs.map(d => d.data()).sort((a: any, b: any) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  }
}

export default function RunnerPlanView({ initialDate }: { initialDate?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<RacePlan | null>(null);
  const [recentRunningSessions, setRecentRunningSessions] = useState<any[]>([]);
  const [viewedWeekNumber, setViewedWeekNumber] = useState<number | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [raceType, setRaceType] = useState<RaceType>('10k');
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [targetFinishTime, setTargetFinishTime] = useState('');
  const [customDistanceKm, setCustomDistanceKm] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [activePlan, sessions] = await Promise.all([
          getActiveRacePlan(user.uid),
          fetchRecentRunningSessions(user.uid),
        ]);
        setPlan(activePlan);
        setRecentRunningSessions(sessions);
        if (activePlan) {
          const resolvedInitialWeek = initialDate ? getWeekEntryByDate(activePlan, initialDate) : null;
          const startWeek = resolvedInitialWeek ?? getCurrentWeekEntry(activePlan);
          setViewedWeekNumber(startWeek?.weekNumber ?? 1);
          setHighlightDate(resolvedInitialWeek ? initialDate! : toLocalDateStr(new Date()));
        }
      } catch (e) {
        console.error('Error loading race plan:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleGenerate = async () => {
    if (!user || !raceName.trim() || !raceDate) return;
    setError(null);
    setGenerating(true);
    try {
      const newPlan = await generateRacePlan(
        user.uid,
        {
          raceType,
          raceName: raceName.trim(),
          raceDate,
          targetFinishTime: targetFinishTime.trim() || undefined,
          customDistanceKm: raceType === 'custom' ? parseFloat(customDistanceKm) || undefined : undefined,
        },
        'runner_tab'
      );
      setPlan(newPlan);
      setShowForm(false);
    } catch (e: any) {
      console.error('Error generating race plan:', e);
      setError(e.message || 'Failed to generate plan. Try again.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!plan) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <p className="text-sm font-semibold text-white mb-1">No active race goal yet</p>
        <p className="text-xs text-slate-500 mb-3">Set a race and get a personalized week-by-week training plan.</p>

        {!showForm ? (
          <button onClick={() => setShowForm(true)}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            Set a race goal
          </button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Race distance</label>
              <div className="flex flex-wrap gap-2">
                {RACE_TYPES.map(rt => (
                  <button key={rt.value} onClick={() => setRaceType(rt.value)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      raceType === rt.value ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {rt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Race name</label>
              <input type="text" value={raceName} onChange={e => setRaceName(e.target.value)} placeholder="e.g. Mumbai Marathon"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            </div>
            {raceType === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Distance (km)</label>
                <input type="number" min="0.1" step="0.1" value={customDistanceKm} onChange={e => setCustomDistanceKm(e.target.value)} placeholder="e.g. 15"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Race date</label>
              <input type="date" value={raceDate} min={tomorrowStr()} onChange={e => setRaceDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Target finish time (optional)</label>
              <input type="text" value={targetFinishTime} onChange={e => setTargetFinishTime(e.target.value)} placeholder="e.g. 1:59:00"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
              <p className="text-[10px] text-slate-500 mt-1">Leave blank to train off your recent runs only.</p>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {generating ? (
              <div className="flex items-center justify-center gap-1.5 bg-slate-800 rounded-xl py-3">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="text-xs text-slate-400 ml-2">Building your training plan — this can take a minute</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { setShowForm(false); setError(null); }}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-xl transition-colors">
                  Cancel
                </button>
                <button onClick={handleGenerate} disabled={!raceName.trim() || !raceDate || (raceType === 'custom' && !customDistanceKm.trim())}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  Generate plan
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Active plan state ────────────────────────────────────────────────────
  const todayLocal = toLocalDateStr(new Date());
  const currentWeekNumber = getCurrentWeekEntry(plan)?.weekNumber ?? null;
  const week = viewedWeekNumber != null ? getWeekEntryByNumber(plan, viewedWeekNumber) : null;
  const isCurrentWeek = viewedWeekNumber != null && viewedWeekNumber === currentWeekNumber;
  const dayEntry = highlightDate ? getPlanDayForDate(plan, highlightDate) : null;
  const adherence = isCurrentWeek && week ? computeAdherence(plan, recentRunningSessions) : null;
  const dayCardLabel = highlightDate && highlightDate !== todayLocal
    ? new Date(highlightDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Today';
  const restGymSplit = dayEntry?.runType === 'rest' ? getGymSplitForDate(plan, dayEntry.date) : null;

  const goToPrevWeek = () => setViewedWeekNumber(n => (n != null ? Math.max(1, n - 1) : n));
  const goToNextWeek = () => setViewedWeekNumber(n => (n != null ? Math.min(plan.totalWeeks, n + 1) : n));

  return (
    <div className="space-y-4">
      {/* Goal banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Race Goal</span>
          {week ? (
            <div className="flex items-center gap-1.5">
              <button onClick={goToPrevWeek} disabled={viewedWeekNumber === 1}
                className="text-slate-500 hover:text-white disabled:opacity-20 disabled:hover:text-slate-500 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-emerald-400">Week {week.weekNumber} of {plan.totalWeeks}</span>
              <button onClick={goToNextWeek} disabled={viewedWeekNumber === plan.totalWeeks}
                className="text-slate-500 hover:text-white disabled:opacity-20 disabled:hover:text-slate-500 transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <span className="text-[10px] font-mono text-emerald-400">{plan.totalWeeks}-week plan</span>
          )}
        </div>
        <div className="text-sm font-semibold text-white">{plan.raceName}</div>
        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
          {new Date(plan.raceDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        {plan.targetPaceMinPerKm != null && (
          <div className="text-[10px] text-emerald-400/80 font-mono mt-1">
            Goal: {plan.targetFinishTime} ({paceStr(plan.targetPaceMinPerKm, 1)})
          </div>
        )}
      </div>

      {!week ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-xs text-slate-500">No training day scheduled for today.</p>
        </div>
      ) : (
        <>
          {/* This week's calendar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3 block">This Week</span>
            <div className="flex justify-between gap-1.5">
              {week.days.map(day => {
                const style = RUN_TYPE_STYLES[day.runType];
                const isHighlighted = day.date === highlightDate;
                const dayLetter = new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
                return (
                  <button type="button" key={day.date}
                    onClick={() => setHighlightDate(day.date)}
                    className={`flex-1 flex flex-col items-center gap-1 rounded-lg py-2 ${style.bg} border ${style.border} cursor-pointer hover:opacity-80 transition-opacity`}>
                    <span className={`text-[9px] font-mono ${isHighlighted ? 'text-white font-bold' : 'text-slate-500'}`}>{dayLetter}</span>
                    <span className={`text-[8px] font-mono ${style.text}`}>{day.runType === 'rest' ? (getGymSplitForDate(plan, day.date) ?? '—') : RUN_TYPE_LABELS[day.runType]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day detail card */}
          {dayEntry && (
            dayEntry.runType === 'rest' ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{dayCardLabel}</span>
                <div className="text-sm font-semibold text-white mt-1">{restGymSplit ? `Rest day · ${restGymSplit}` : 'Rest day'}</div>
                {dayEntry.note && <p className="text-xs text-slate-400 mt-1">{dayEntry.note}</p>}
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{dayCardLabel}</span>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${RUN_TYPE_STYLES[dayEntry.runType].bg} ${RUN_TYPE_STYLES[dayEntry.runType].text} border ${RUN_TYPE_STYLES[dayEntry.runType].border}`}>
                    {RUN_TYPE_LABELS[dayEntry.runType]}
                  </span>
                </div>
                <div className="flex gap-4 mb-2">
                  {dayEntry.targetDistanceKm != null && (
                    <div className="text-lg font-bold text-white">
                      {dayEntry.targetDistanceKm}<span className="text-xs text-slate-500 ml-0.5">km</span>
                    </div>
                  )}
                  {dayEntry.targetPaceMinPerKm != null && (
                    <div className="text-lg font-bold text-emerald-400">
                      {dayEntry.targetPaceMinPerKm.toFixed(2)}<span className="text-xs text-slate-500 ml-0.5">min/km</span>
                    </div>
                  )}
                </div>
                {dayEntry.note && <p className="text-xs text-slate-400 mb-3">{dayEntry.note}</p>}
                {isCurrentWeek && dayEntry.date === todayLocal && (
                  <button
                    onClick={() => navigate('/running-session', {
                      state: {
                        targetDistanceKm: dayEntry.targetDistanceKm,
                        // 'race' isn't a loggable EffortType — closest real effort is tempo.
                        effortType: dayEntry.runType === 'race' ? 'tempo' : dayEntry.runType,
                      },
                    })}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                    Start This Run
                  </button>
                )}
              </div>
            )
          )}

          {/* Adherence strip */}
          {adherence && adherence.total > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">This Week's Adherence</span>
                <span className="text-[10px] font-mono text-emerald-400">{adherence.completed} of {adherence.total} runs</span>
              </div>
              <div className="flex gap-1.5">
                {Array.from({ length: adherence.total }).map((_, i) => (
                  <div key={i} className={`flex-1 h-1.5 rounded-full ${i < adherence.completed ? 'bg-emerald-500' : 'border border-slate-700'}`} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Ask coach */}
      <button onClick={() => navigate('/ai-coach?topic=runner')}
        className="w-full bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
        Ask your running coach
      </button>
    </div>
  );
}
