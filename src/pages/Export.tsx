import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Download, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';

type Range = '1W' | '1M' | '6M' | 'All';

interface DaySummary {
  date: string;
  workouts: string[];
  calories: number | null;
  protein: number | null;
  steps: number | null;
  sleepHours: number | null;
  weight: number | null;
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function avg(arr: number[]) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function getRangeStart(range: Range): Date {
  const d = new Date();
  if (range === '1W') { d.setDate(d.getDate() - 7); return d; }
  if (range === '1M') { d.setMonth(d.getMonth() - 1); return d; }
  if (range === '6M') { d.setMonth(d.getMonth() - 6); return d; }
  return new Date('2000-01-01');
}

const DATA_TYPES = [
  { key: 'workouts',    label: 'Workouts',         icon: '🏋️' },
  { key: 'nutrition',   label: 'Calories & Macros', icon: '🍽️' },
  { key: 'steps',       label: 'Step Count',        icon: '🚶' },
  { key: 'sleep',       label: 'Sleep Hours',       icon: '😴' },
  { key: 'body',        label: 'Body Composition',  icon: '📏' },
  { key: 'labs',        label: 'Lab Results',       icon: '🧪' },
];

export default function Export() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('1M');
  const [selected, setSelected] = useState<Set<string>>(new Set(['workouts', 'nutrition', 'steps', 'sleep']));
  const [preview, setPreview] = useState<DaySummary[] | null>(null);
  const [labData, setLabData] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);

  usePageLoadTime('Export', false);

  const toggleType = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Build day-by-day summary
  const buildSummary = async (): Promise<DaySummary[]> => {
    if (!user) return [];
    const start = getRangeStart(range);
    const startStr = localDateStr(start);

    const [workoutSnap, nutritionSnap, bodySnap, stepsHabitSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', user.uid, 'workoutSessions'), orderBy('date', 'desc'), limit(200))),
      getDocs(query(collection(db, 'users', user.uid, 'nutritionLogs'), orderBy('date', 'desc'), limit(200))),
      getDocs(query(collection(db, 'users', user.uid, 'bodyComp'), orderBy('date', 'desc'), limit(200))),
      getDocs(collection(db, 'users', user.uid, 'habits')),
    ]);

    // Find steps + sleep habit IDs
    const habits = stepsHabitSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const stepsHabit = habits.find((h: any) => h.name?.toLowerCase().includes('step'));
    const sleepHabit = habits.find((h: any) => h.name?.toLowerCase().includes('sleep'));

    // Fetch habit logs in parallel
    const [stepsLogsSnap, sleepLogsSnap] = await Promise.all([
      stepsHabit ? getDocs(query(collection(db, 'users', user.uid, 'habits', stepsHabit.id, 'logs'), orderBy('date', 'desc'), limit(200))) : Promise.resolve(null),
      sleepHabit ? getDocs(query(collection(db, 'users', user.uid, 'habits', sleepHabit.id, 'logs'), orderBy('date', 'desc'), limit(200))) : Promise.resolve(null),
    ]);

    // Map by date
    const workoutsByDate: Record<string, string[]> = {};
    workoutSnap.docs.forEach(d => {
      const w = d.data() as any;
      const ds = w.date?.split('T')[0] || '';
      if (ds >= startStr) {
        if (!workoutsByDate[ds]) workoutsByDate[ds] = [];
        workoutsByDate[ds].push(w.template || w.type || 'Workout');
      }
    });

    const nutritionByDate: Record<string, { calories: number; protein: number }> = {};
    nutritionSnap.docs.forEach(d => {
      const n = d.data() as any;
      const ds = n.date || '';
      if (ds >= startStr) nutritionByDate[ds] = { calories: n.totalCalories || 0, protein: n.totalProtein || 0 };
    });

    const bodyByDate: Record<string, any> = {};
    bodySnap.docs.forEach(d => {
      const b = d.data() as any;
      const ds = b.date?.split('T')[0] || '';
      if (ds >= startStr) bodyByDate[ds] = b;
    });

    const stepsByDate: Record<string, number> = {};
    stepsLogsSnap?.docs.forEach(d => {
      const s = d.data() as any;
      if (s.date >= startStr) stepsByDate[s.date] = s.value || 0;
    });

    const sleepByDate: Record<string, number> = {};
    sleepLogsSnap?.docs.forEach(d => {
      const s = d.data() as any;
      if (s.date >= startStr) sleepByDate[s.date] = s.value || 0;
    });

    // Collect all dates in range
    const allDates = new Set([
      ...Object.keys(workoutsByDate),
      ...Object.keys(nutritionByDate),
      ...Object.keys(bodyByDate),
      ...Object.keys(stepsByDate),
      ...Object.keys(sleepByDate),
    ]);

    return Array.from(allDates)
      .filter(d => d >= startStr)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({
        date,
        workouts: workoutsByDate[date] || [],
        calories: nutritionByDate[date]?.calories || null,
        protein: nutritionByDate[date]?.protein || null,
        steps: stepsByDate[date] || null,
        sleepHours: sleepByDate[date] || null,
        weight: bodyByDate[date]?.weightKg || null,
      }));
  };

  const fetchLabData = async () => {
    if (!user || !selected.has('labs')) return [];
    const snap = await getDocs(query(collection(db, 'users', user.uid, 'tests'), orderBy('createdAt', 'desc')));
    const tests = await Promise.all(snap.docs.map(async d => {
      const readings = await getDocs(query(
        collection(db, 'users', user.uid, 'tests', d.id, 'readings'),
        orderBy('date', 'desc'), limit(5)
      ));
      return {
        name: d.data().name,
        unit: d.data().unit,
        readings: readings.docs.map(r => ({ date: r.data().date?.split('T')[0], value: r.data().value }))
      };
    }));
    return tests;
  };

  const handleGenerate = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      const [days, labs] = await Promise.all([buildSummary(), fetchLabData()]);
      setPreview(days);
      setLabData(labs);
    } finally {
      setGenerating(false);
    }
  };

  // Compute stats for summary view
  const computeStats = (days: DaySummary[]) => {
    const calories = days.map(d => d.calories).filter(Boolean) as number[];
    const steps = days.map(d => d.steps).filter(Boolean) as number[];
    const sleep = days.map(d => d.sleepHours).filter(Boolean) as number[];
    const workoutDays = days.filter(d => d.workouts.length > 0).length;
    const lowSleepDays = sleep.filter(s => s < 6).length;
    const goodStepDays = steps.filter(s => s >= 8000).length;

    return {
      avgCalories: avg(calories),
      avgSteps: avg(steps),
      avgSleep: sleep.length ? (sleep.reduce((a,b) => a+b, 0) / sleep.length).toFixed(1) : null,
      workoutDays,
      lowSleepDays,
      goodStepDays,
      totalDays: days.length,
    };
  };

  const exportTxt = () => {
    if (!preview) return;
    const lines: string[] = [];
    const rangeLabel = { '1W': 'Last 7 days', '1M': 'Last 30 days', '6M': 'Last 6 months', 'All': 'All time' }[range];
    lines.push(`FitTrack Health Report — ${rangeLabel}`);
    lines.push(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push('');

    if (range !== '1W') {
      const stats = computeStats(preview);
      lines.push('SUMMARY');
      lines.push('───────────────────');
      if (stats.avgCalories && selected.has('nutrition')) lines.push(`Avg Calories/day: ${stats.avgCalories} kcal`);
      if (stats.avgSteps && selected.has('steps')) lines.push(`Avg Steps/day: ${stats.avgSteps.toLocaleString()}`);
      if (stats.avgSleep && selected.has('sleep')) {
        lines.push(`Avg Sleep: ${stats.avgSleep} hrs`);
        if (stats.lowSleepDays > 0) lines.push(`  ⚠ ${stats.lowSleepDays} nights with less than 6 hrs sleep`);
      }
      if (selected.has('workouts')) lines.push(`Workout days: ${stats.workoutDays} of ${stats.totalDays} days`);
      if (stats.goodStepDays && selected.has('steps')) lines.push(`Days with 8,000+ steps: ${stats.goodStepDays}`);
      lines.push('');
    }

    if (selected.has('labs') && labData.length > 0) {
      lines.push('LAB RESULTS');
      lines.push('───────────────────');
      labData.forEach(t => {
        const latest = t.readings[0];
        if (latest) lines.push(`${t.name}: ${latest.value} ${t.unit} (${latest.date})`);
      });
      lines.push('');
    }

    lines.push('DAILY LOG');
    lines.push('───────────────────');
    preview.forEach(day => {
      const parts: string[] = [];
      if (selected.has('workouts') && day.workouts.length > 0) parts.push(`Workout: ${day.workouts.join(', ')}`);
      if (selected.has('nutrition') && day.calories) parts.push(`Calories: ${day.calories} kcal${day.protein ? ` · Protein: ${day.protein}g` : ''}`);
      if (selected.has('steps') && day.steps) parts.push(`Steps: ${day.steps.toLocaleString()}`);
      if (selected.has('sleep') && day.sleepHours) parts.push(`Sleep: ${day.sleepHours} hrs`);
      if (selected.has('body') && day.weight) parts.push(`Weight: ${day.weight} kg`);
      if (parts.length > 0) {
        lines.push(`\n${day.date}`);
        parts.forEach(p => lines.push(`  ${p}`));
      }
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fittrack-report-${localDateStr(new Date())}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    if (!preview) return;
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const rangeLabel = { '1W': 'Last 7 days', '1M': 'Last 30 days', '6M': 'Last 6 months', 'All': 'All time' }[range];

    let y = 20;
    const lh = 6;
    const add = (text: string, size = 10, bold = false) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      pdf.setFontSize(size);
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.text(text, 15, y);
      y += lh;
    };

    add('FitTrack Health Report', 16, true);
    add(`${rangeLabel} · Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 9);
    y += 4;

    if (range !== '1W') {
      const stats = computeStats(preview);
      add('Summary', 12, true); y += 1;
      if (stats.avgCalories && selected.has('nutrition')) add(`Avg Calories/day: ${stats.avgCalories} kcal`);
      if (stats.avgSteps && selected.has('steps')) add(`Avg Steps/day: ${stats.avgSteps.toLocaleString()}`);
      if (stats.avgSleep && selected.has('sleep')) {
        add(`Avg Sleep: ${stats.avgSleep} hrs`);
        if (stats.lowSleepDays > 0) add(`  ${stats.lowSleepDays} nights with less than 6 hrs sleep`);
      }
      if (selected.has('workouts')) add(`Workout days: ${stats.workoutDays} of ${stats.totalDays} days`);
      y += 4;
    }

    if (selected.has('labs') && labData.length > 0) {
      add('Lab Results', 12, true); y += 1;
      labData.forEach(t => {
        const latest = t.readings[0];
        if (latest) add(`${t.name}: ${latest.value} ${t.unit}  (${latest.date})`);
      });
      y += 4;
    }

    add('Daily Log', 12, true); y += 1;
    preview.forEach(day => {
      const parts: string[] = [];
      if (selected.has('workouts') && day.workouts.length > 0) parts.push(`Workout: ${day.workouts.join(', ')}`);
      if (selected.has('nutrition') && day.calories) parts.push(`Calories: ${day.calories} kcal${day.protein ? `  Protein: ${day.protein}g` : ''}`);
      if (selected.has('steps') && day.steps) parts.push(`Steps: ${day.steps.toLocaleString()}`);
      if (selected.has('sleep') && day.sleepHours) parts.push(`Sleep: ${day.sleepHours} hrs`);
      if (selected.has('body') && day.weight) parts.push(`Weight: ${day.weight} kg`);
      if (parts.length > 0) {
        y += 2;
        add(day.date, 10, true);
        parts.forEach(p => add(`  ${p}`, 9));
      }
    });

    pdf.save(`fittrack-report-${localDateStr(new Date())}.pdf`);
  };

  const stats = preview ? computeStats(preview) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <div className="flex items-center gap-3 p-4 border-b border-slate-800">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">Export Data</h1>
      </div>

      <div className="p-4 space-y-5">

        {/* Time range */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wider mb-3">Time Range</p>
          <div className="grid grid-cols-4 gap-2">
            {(['1W', '1M', '6M', 'All'] as Range[]).map(r => (
              <button key={r} onClick={() => { setRange(r); setPreview(null); }}
                className={`py-3 rounded-xl text-sm font-medium transition-colors ${range === r ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                {r === 'All' ? 'All\nTime' : r}
              </button>
            ))}
          </div>
        </div>

        {/* Data types */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wider mb-3">Data to Include</p>
          <div className="space-y-1">
            {DATA_TYPES.map(({ key, label, icon }) => (
              <button key={key} onClick={() => toggleType(key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${selected.has(key) ? 'bg-emerald-500/10' : 'hover:bg-slate-800'}`}>
                <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${selected.has(key) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
                  {selected.has(key) && <span className="text-white text-xs">✓</span>}
                </div>
                <span className="text-base">{icon}</span>
                <span className="text-sm text-white">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button onClick={handleGenerate} disabled={generating || selected.size === 0}
          className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
          {generating
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>Building report…</span></>
            : <><span>📊</span><span>Generate Preview</span></>}
        </button>

        {/* Preview */}
        {preview && stats && (
          <div className="space-y-4">

            {/* Stats summary */}
            {range !== '1W' && (
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
                <p className="text-xs text-slate-400 font-mono uppercase tracking-wider mb-3">Summary</p>
                <div className="grid grid-cols-2 gap-3">
                  {selected.has('workouts') && (
                    <div className="bg-slate-800 rounded-xl p-3">
                      <div className="text-2xl font-bold text-white">{stats.workoutDays}</div>
                      <div className="text-[10px] text-slate-400">workout days</div>
                      <div className="text-[9px] text-slate-600">of {stats.totalDays} total</div>
                    </div>
                  )}
                  {selected.has('nutrition') && stats.avgCalories && (
                    <div className="bg-slate-800 rounded-xl p-3">
                      <div className="text-2xl font-bold text-orange-400">{stats.avgCalories}</div>
                      <div className="text-[10px] text-slate-400">avg kcal/day</div>
                    </div>
                  )}
                  {selected.has('steps') && stats.avgSteps && (
                    <div className="bg-slate-800 rounded-xl p-3">
                      <div className="text-2xl font-bold text-green-400">{stats.avgSteps.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400">avg steps/day</div>
                      {stats.goodStepDays !== undefined && <div className="text-[9px] text-slate-600">{stats.goodStepDays} days ≥8k</div>}
                    </div>
                  )}
                  {selected.has('sleep') && stats.avgSleep && (
                    <div className={`bg-slate-800 rounded-xl p-3 ${stats.lowSleepDays > 2 ? 'border border-amber-500/30' : ''}`}>
                      <div className={`text-2xl font-bold ${stats.lowSleepDays > 2 ? 'text-amber-400' : 'text-indigo-400'}`}>{stats.avgSleep}h</div>
                      <div className="text-[10px] text-slate-400">avg sleep</div>
                      {stats.lowSleepDays > 0 && <div className="text-[9px] text-amber-600">⚠ {stats.lowSleepDays} nights &lt;6h</div>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Daily log preview — show first 7 days */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <p className="text-xs text-slate-400 font-mono uppercase tracking-wider">Daily Log Preview</p>
                <span className="text-[10px] font-mono text-slate-600">{preview.length} days</span>
              </div>
              {preview.slice(0, range === '1W' ? 7 : 5).map(day => (
                <div key={day.date} className="px-4 py-3 border-b border-slate-800/50 last:border-0">
                  <p className="text-[10px] font-mono text-slate-500 mb-1.5">
                    {new Date(day.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.has('workouts') && day.workouts.map(w => (
                      <span key={w} className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">{w}</span>
                    ))}
                    {selected.has('nutrition') && day.calories && (
                      <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full">{day.calories} kcal</span>
                    )}
                    {selected.has('steps') && day.steps && (
                      <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">{day.steps.toLocaleString()} steps</span>
                    )}
                    {selected.has('sleep') && day.sleepHours && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${day.sleepHours < 6 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'}`}>
                        {day.sleepHours}h sleep{day.sleepHours < 6 ? ' ⚠' : ''}
                      </span>
                    )}
                    {selected.has('body') && day.weight && (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">{day.weight}kg</span>
                    )}
                  </div>
                </div>
              ))}
              {preview.length > 5 && range !== '1W' && (
                <div className="px-4 py-2 text-[10px] font-mono text-slate-600 text-center">
                  +{preview.length - 5} more days in export
                </div>
              )}
            </div>

            {/* Download buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={exportTxt}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-3 rounded-xl font-medium transition-colors">
                <FileText className="w-4 h-4" />
                <span className="text-sm">Download TXT</span>
              </button>
              <button onClick={exportPdf}
                className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-medium transition-colors">
                <Download className="w-4 h-4" />
                <span className="text-sm">Download PDF</span>
              </button>
            </div>

            <p className="text-[10px] text-center text-slate-600">Share with your doctor or gym coach</p>
          </div>
        )}
      </div>
    </div>
  );
}