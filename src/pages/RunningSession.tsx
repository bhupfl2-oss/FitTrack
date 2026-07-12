import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

type EffortType = 'recovery' | 'tempo' | 'long_run' | 'intervals';
type Surface = 'road' | 'treadmill' | 'hill';

interface IntervalRow {
  id: string;
  distanceM: number;
  durationMins: number;
  durationSecs: number;
  inclinePercent: number;
}

interface RunningSessionState {
  effortType: EffortType;
  surface: Surface;
  distanceKm: number;
  durationMins: number;
  durationSecs: number;
  inclinePercent: number;
  notes: string;
}

const emptyInterval = (): IntervalRow => ({
  id: `iv-${Date.now()}-${Math.random()}`,
  distanceM: 0,
  durationMins: 0,
  durationSecs: 0,
  inclinePercent: 0,
});

export const paceStr = (totalMins: number, distanceKm: number): string => {
  if (distanceKm <= 0 || totalMins <= 0) return '0:00 min/km';
  const pace = totalMins / distanceKm;
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} min/km`;
};

// ── Calorie estimation for running ────────────────────────────────────────
// MET values: recovery=7, tempo=10, long_run=8, intervals=12, hill=9, treadmill incline adds ~0.5 per %
// Formula: kcal = MET × weight_kg × duration_hours
// Default weight 70kg if not available, fetched from profile
function estimateRunningCalories(
  _distanceKm: number,
  durationMins: number,
  effortType: EffortType,
  surface: Surface,
  inclinePercent: number,
  weightKg: number
): number {
  const metMap: Record<EffortType, number> = {
    recovery: 7,
    long_run: 8,
    tempo: 10,
    intervals: 12,
  };
  let met = metMap[effortType] ?? 8;
  if (surface === 'hill') met += 1.5;
  if (surface === 'treadmill' && inclinePercent > 0) met += inclinePercent * 0.4;
  const hours = durationMins / 60;
  return Math.round(met * weightKg * hours);
}

export default function RunningSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [sessionDate, setSessionDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  // Optional prefill from Runner mode's "Start This Run" — absent for every
  // other entry point (library, gym chat), so this is a no-op by default.
  const prefill = location.state as { targetDistanceKm?: number; effortType?: EffortType } | undefined;
  const [session, setSession] = useState<RunningSessionState>({
    effortType: prefill?.effortType ?? 'recovery',
    surface: 'road',
    distanceKm: prefill?.targetDistanceKm ?? 0,
    durationMins: 0,
    durationSecs: 0,
    inclinePercent: 0,
    notes: '',
  });

  const [intervals, setIntervals] = useState<IntervalRow[]>([emptyInterval()]);

  const effortTypes: { value: EffortType; label: string; emoji: string }[] = [
    { value: 'recovery', label: 'Recovery', emoji: '🧘' },
    { value: 'tempo',    label: 'Tempo',    emoji: '⚡' },
    { value: 'long_run', label: 'Long Run', emoji: '🏃' },
    { value: 'intervals',label: 'Intervals',emoji: '🔁' },
  ];

  const surfaces: { value: Surface; label: string }[] = [
    { value: 'road',      label: 'Road' },
    { value: 'treadmill', label: 'Treadmill' },
    { value: 'hill',      label: 'Hill' },
  ];

  const update = (field: keyof RunningSessionState, value: string | number) =>
    setSession(prev => ({ ...prev, [field]: value }));

  const updateInterval = (id: string, field: keyof Omit<IntervalRow, 'id'>, value: number) =>
    setIntervals(prev => prev.map(iv => iv.id === id ? { ...iv, [field]: value } : iv));

  const addInterval = () => setIntervals(prev => [...prev, emptyInterval()]);
  const removeInterval = (id: string) =>
    setIntervals(prev => prev.length > 1 ? prev.filter(iv => iv.id !== id) : prev);

  const intervalTotalDistanceKm = intervals.reduce((s, iv) => s + iv.distanceM / 1000, 0);
  const intervalTotalMins = intervals.reduce((s, iv) => s + iv.durationMins + iv.durationSecs / 60, 0);
  const intervalPace = paceStr(intervalTotalMins, intervalTotalDistanceKm);
  const regularPace = paceStr(session.durationMins + session.durationSecs / 60, session.distanceKm);

  const isIntervals = session.effortType === 'intervals';
  const canSave = isIntervals
    ? intervalTotalDistanceKm > 0 && intervalTotalMins > 0
    : session.distanceKm > 0 && (session.durationMins > 0 || session.durationSecs > 0);

  // Live calorie preview
  const liveCalories = (() => {
    const dist = isIntervals ? intervalTotalDistanceKm : session.distanceKm;
    const dur = isIntervals ? intervalTotalMins : session.durationMins + session.durationSecs / 60;
    if (dist <= 0 || dur <= 0) return null;
    return estimateRunningCalories(dist, dur, session.effortType, session.surface, session.inclinePercent, 70);
  })();

  const finishRun = async () => {
    if (!user || !canSave) return;
    setIsSaving(true);
    try {
      // Fetch user weight for better calorie estimate
      let weightKg = 70;
      try {
        const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
        if (profileSnap.exists()) weightKg = profileSnap.data().weightKg ?? 70;
      } catch {}

      const saveData: any = {
        type: 'running',
        date: sessionDate,
        effortType: session.effortType,
        surface: session.surface,
        notes: session.notes,
        createdAt: serverTimestamp(),
      };

      let finalDistanceKm: number;
      let finalDurationMins: number;

      if (isIntervals) {
        finalDistanceKm = parseFloat(intervalTotalDistanceKm.toFixed(3));
        finalDurationMins = intervalTotalMins;
        saveData.distanceKm = finalDistanceKm;
        saveData.durationMins = finalDurationMins;
        saveData.paceMinPerKm = finalDurationMins / finalDistanceKm;
        saveData.intervals = intervals.map(({ id, ...rest }) => rest);
      } else {
        const totalDuration = session.durationMins + session.durationSecs / 60;
        finalDistanceKm = session.distanceKm;
        finalDurationMins = totalDuration;
        saveData.distanceKm = finalDistanceKm;
        saveData.durationMins = finalDurationMins;
        saveData.paceMinPerKm = finalDurationMins / finalDistanceKm;
        if (session.surface === 'treadmill') saveData.inclinePercent = session.inclinePercent;
      }

      // Estimate calories and include in save
      const caloriesBurned = estimateRunningCalories(
        finalDistanceKm,
        finalDurationMins,
        session.effortType,
        session.surface,
        session.inclinePercent,
        weightKg
      );
      saveData.caloriesBurned = caloriesBurned;

      await addDoc(collection(db, 'users', user.uid, 'workoutSessions'), cleanData(saveData));
      navigate('/workouts');
    } catch (error) {
      console.error('Error saving running session:', error);
      alert('Error saving session');
    } finally {
      setIsSaving(false);
    }
  };

  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500';
  const smallInputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm';

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-10">
      <div className="max-w-md mx-auto p-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/workouts')} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-semibold">Running Session</h1>
          <div className="w-9" />
        </div>

        {/* Date */}
        <div className="mb-6">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Date</span>
            <input type="date" value={sessionDate} max={new Date().toISOString().split('T')[0]}
              onChange={e => setSessionDate(e.target.value)}
              style={{ background: '#1a2332', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e2e8f0', padding: '6px 10px', fontSize: '13px' }} />
          </div>
        </div>

        {/* Effort type */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Run Type</h2>
          <div className="grid grid-cols-2 gap-2">
            {effortTypes.map(t => (
              <button key={t.value} onClick={() => update('effortType', t.value)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  session.effortType === t.value ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}>
                <span>{t.emoji}</span>{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Surface */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Surface</h2>
          <div className="flex gap-2">
            {surfaces.map(s => (
              <button key={s.value} onClick={() => update('surface', s.value)}
                className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  session.surface === s.value ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
          {session.surface === 'treadmill' && !isIntervals && (
            <div className="mt-3">
              <input type="number" step="0.5" min="0" max="15" placeholder="% incline"
                value={session.inclinePercent || ''} onChange={e => update('inclinePercent', parseFloat(e.target.value) || 0)}
                className={inputCls} />
            </div>
          )}
        </div>

        {/* INTERVALS MODE */}
        {isIntervals ? (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-slate-300">Intervals</h2>
              <span className="text-xs font-mono text-slate-500">{intervals.length} rep{intervals.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-3">
              {intervals.map((iv, idx) => (
                <div key={iv.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-mono text-emerald-400">#{idx + 1}</span>
                    <button onClick={() => removeInterval(iv.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-[10px] text-slate-500 font-mono uppercase tracking-wider block mb-1">Distance</label>
                      <div className="relative">
                        <input type="number" step="10" min="0" placeholder="400" value={iv.distanceM || ''}
                          onChange={e => updateInterval(iv.id, 'distanceM', parseInt(e.target.value) || 0)}
                          className={`${smallInputCls} w-full pr-8`} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">m</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-mono uppercase tracking-wider block mb-1">Time (mm:ss)</label>
                      <div className="flex gap-1 items-center">
                        <input type="number" step="1" min="0" placeholder="02" value={iv.durationMins || ''}
                          onChange={e => updateInterval(iv.id, 'durationMins', parseInt(e.target.value) || 0)}
                          className={`${smallInputCls} w-full text-center`} />
                        <span className="text-slate-500 text-sm font-mono flex-shrink-0">:</span>
                        <input type="number" step="1" min="0" max="59" placeholder="00" value={iv.durationSecs || ''}
                          onChange={e => updateInterval(iv.id, 'durationSecs', Math.min(59, parseInt(e.target.value) || 0))}
                          className={`${smallInputCls} w-full text-center`} />
                      </div>
                    </div>
                  </div>
                  {session.surface === 'treadmill' && (
                    <div>
                      <label className="text-[10px] text-slate-500 font-mono uppercase tracking-wider block mb-1">Incline</label>
                      <div className="relative">
                        <input type="number" step="0.5" min="0" max="15" placeholder="0" value={iv.inclinePercent || ''}
                          onChange={e => updateInterval(iv.id, 'inclinePercent', parseFloat(e.target.value) || 0)}
                          className={`${smallInputCls} w-full pr-8`} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">%</span>
                      </div>
                    </div>
                  )}
                  {iv.distanceM > 0 && (iv.durationMins > 0 || iv.durationSecs > 0) && (
                    <div className="mt-2 text-[10px] font-mono text-emerald-400">
                      {paceStr(iv.durationMins + iv.durationSecs / 60, iv.distanceM / 1000)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addInterval}
              className="mt-3 w-full border border-dashed border-slate-700 rounded-xl py-2.5 text-xs font-mono text-slate-500 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors flex items-center justify-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Add interval
            </button>
            {intervalTotalDistanceKm > 0 && (
              <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-base font-bold text-white">{intervalTotalDistanceKm.toFixed(2)}</div>
                  <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mt-0.5">km total</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-bold text-white">
                    {String(Math.floor(intervalTotalMins)).padStart(2,'0')}:{String(Math.round((intervalTotalMins % 1) * 60)).padStart(2,'0')}
                  </div>
                  <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mt-0.5">total time</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-bold text-emerald-400">{intervalPace.replace(' min/km', '')}</div>
                  <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mt-0.5">avg pace</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-sm font-medium text-slate-300 mb-3">Distance</h2>
              <div className="relative">
                <input type="number" step="0.1" min="0" placeholder="0.0" value={session.distanceKm || ''}
                  onChange={e => update('distanceKm', parseFloat(e.target.value) || 0)}
                  className={`${inputCls} pr-12`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">km</span>
              </div>
            </div>
            <div className="mb-6">
              <h2 className="text-sm font-medium text-slate-300 mb-3">Duration</h2>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <input type="number" step="1" min="0" placeholder="0" value={session.durationMins || ''}
                    onChange={e => update('durationMins', parseInt(e.target.value) || 0)}
                    className={`${inputCls} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">min</span>
                </div>
                <div className="relative flex-1">
                  <input type="number" step="1" min="0" max="59" placeholder="00" value={session.durationSecs || ''}
                    onChange={e => update('durationSecs', Math.min(59, parseInt(e.target.value) || 0))}
                    className={`${inputCls} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">sec</span>
                </div>
              </div>
            </div>
            <div className="mb-6">
              <h2 className="text-sm font-medium text-slate-300 mb-3">Pace</h2>
              <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-emerald-400 font-medium font-mono">
                {regularPace}
              </div>
            </div>
          </>
        )}

        {/* Calorie preview */}
        {liveCalories !== null && (
          <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Est. calories</span>
            <span className="text-sm font-semibold text-orange-400 font-mono">~{liveCalories} kcal</span>
          </div>
        )}

        {/* Notes */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Notes (optional)</h2>
          <textarea placeholder="How did the run feel? Any observations..."
            value={session.notes} onChange={e => update('notes', e.target.value)}
            rows={3} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none" />
        </div>

        <Button onClick={finishRun} disabled={isSaving || !canSave}
          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3">
          {isSaving ? 'Saving...' : 'Finish Run'}
        </Button>
      </div>
    </div>
  );
}