import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Download, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import autoTable from 'jspdf-autotable';

type Range = '1W' | '1M' | '1Y';

interface DaySummary {
  date: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fibre: number | null;
  foodItems: { name: string; calories: number }[];
  workouts: {
    template: string;
    caloriesBurned: number;
    distanceKm: number;
    exercises: { name: string; sets: { reps: number; weight: number }[] }[];
  }[];
  steps: number | null;
  sleepHours: number | null;
  water: number | null;
  weight: number | null;
  pbf: number | null;
  smm: number | null;
}

interface BodyCompEntry {
  date: string;
  weightKg: number | null;
  pbf: number | null;
  smm: number | null;
  bmr: number | null;
  visceralFat: number | null;
}

interface LabTest {
  name: string;
  unit: string;
  readings: { date: string; value: number }[];
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getRangeStart(range: Range): Date {
  const d = new Date();
  if (range === '1W') { d.setDate(d.getDate() - 7); return d; }
  if (range === '1M') { d.setMonth(d.getMonth() - 1); return d; }
  if (range === '1Y') { d.setFullYear(d.getFullYear() - 1); return d; }
  return new Date('2000-01-01');
}

function groupByWeek(days: DaySummary[]): { weekLabel: string; days: DaySummary[] }[] {
  const weeks: Record<string, DaySummary[]> = {};
  days.forEach(day => {
    const d = new Date(day.date + 'T00:00:00');
    const dayOfWeek = d.getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(d);
    monday.setDate(d.getDate() - daysSinceMonday);
    const weekLabel = localDateStr(monday);
    if (!weeks[weekLabel]) weeks[weekLabel] = [];
    weeks[weekLabel].push(day);
  });
  return Object.entries(weeks)
    .map(([weekLabel, days]) => ({ weekLabel, days }))
    .sort((a, b) => b.weekLabel.localeCompare(a.weekLabel));
}

function groupByMonth(days: DaySummary[]): { monthLabel: string; days: DaySummary[] }[] {
  const months: Record<string, DaySummary[]> = {};
  days.forEach(day => {
    const monthLabel = day.date.substring(0, 7);
    if (!months[monthLabel]) months[monthLabel] = [];
    months[monthLabel].push(day);
  });
  return Object.entries(months)
    .map(([monthLabel, days]) => ({ monthLabel, days }))
    .sort((a, b) => b.monthLabel.localeCompare(a.monthLabel));
}

// Daily avg over logged days only (used for 1W display)
function avgOf(days: DaySummary[], key: keyof DaySummary): number {
  const values = days
    .map(d => d[key])
    .filter((v): v is number => v !== null && typeof v === 'number' && v > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// Sum a numeric field across days
function sumOf(days: DaySummary[], key: keyof DaySummary): number {
  return days.reduce((acc, d) => {
    const v = d[key];
    return acc + (typeof v === 'number' && v > 0 ? v : 0);
  }, 0);
}

// Daily avg = sum ÷ divisor (7 for weekly, days-in-month for monthly)
function dailyAvg(days: DaySummary[], key: keyof DaySummary, divisor: number): number {
  const total = sumOf(days, key);
  if (!total) return 0;
  return Math.round(total / divisor);
}

function dailyAvgFloat(days: DaySummary[], key: keyof DaySummary, divisor: number): string {
  const total = sumOf(days, key);
  if (!total) return '—';
  return (total / divisor).toFixed(1);
}

// Total calories burned across all workouts in day set
function totalCalBurned(days: DaySummary[]): number {
  return days.reduce((acc, day) =>
    acc + day.workouts.reduce((s, w) => s + (w.caloriesBurned || 0), 0), 0);
}

// Total km run across all workouts in day set
function totalRunKm(days: DaySummary[]): number {
  return days.reduce((acc, day) =>
    acc + day.workouts.reduce((s, w) => s + (w.distanceKm || 0), 0), 0);
}

// Active days = days with at least one workout
function activeDays(days: DaySummary[]): number {
  return days.filter(d => d.workouts.length > 0).length;
}

// Days in a calendar month given YYYY-MM label
function daysInMonth(monthLabel: string): number {
  const [year, month] = monthLabel.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}



function fmtVal(val: number | null, suffix = ''): string {
  if (val === null || val === 0) return '—';
  return `${val}${suffix}`;
}

export default function Export() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('1M');
  const [preview, setPreview] = useState<DaySummary[] | null>(null);
  const [bodyComp, setBodyComp] = useState<BodyCompEntry[]>([]);
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [generating, setGenerating] = useState(false);

  usePageLoadTime('Export', false);

  const fetchData = async (): Promise<{ days: DaySummary[]; bodyComp: BodyCompEntry[]; labTests: LabTest[] }> => {
    if (!user) return { days: [], bodyComp: [], labTests: [] };
    const start = getRangeStart(range);
    const startStr = localDateStr(start);

    const [workoutSnap, nutritionSnap, bodySnap, habitsSnap, testsSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', user.uid, 'workoutSessions'), orderBy('date', 'desc'), limit(400))),
      getDocs(query(collection(db, 'users', user.uid, 'nutritionLogs'), orderBy('date', 'desc'), limit(400))),
      getDocs(query(collection(db, 'users', user.uid, 'bodyComp'), orderBy('date', 'desc'), limit(400))),
      getDocs(collection(db, 'users', user.uid, 'habits')),
      getDocs(query(collection(db, 'users', user.uid, 'tests'), orderBy('createdAt', 'desc'))),
    ]);

    const habits = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const stepsHabit = habits.find((h: any) => h.name?.toLowerCase().includes('step'));
    const sleepHabit = habits.find((h: any) => h.name?.toLowerCase().includes('sleep'));
    const waterHabit = habits.find((h: any) => h.name?.toLowerCase().includes('water'));

    const [stepsLogsSnap, sleepLogsSnap, waterLogsSnap] = await Promise.all([
      stepsHabit
        ? getDocs(query(collection(db, 'users', user.uid, 'habits', stepsHabit.id, 'logs'), orderBy('date', 'desc'), limit(400)))
        : Promise.resolve(null),
      sleepHabit
        ? getDocs(query(collection(db, 'users', user.uid, 'habits', sleepHabit.id, 'logs'), orderBy('date', 'desc'), limit(400)))
        : Promise.resolve(null),
      waterHabit
        ? getDocs(query(collection(db, 'users', user.uid, 'habits', waterHabit.id, 'logs'), orderBy('date', 'desc'), limit(400)))
        : Promise.resolve(null),
    ]);

    const labTestsData = await Promise.all(
      testsSnap.docs.map(async d => {
        const readingsSnap = await getDocs(
          query(collection(db, 'users', user.uid, 'tests', d.id, 'readings'), orderBy('date', 'desc'), limit(20))
        );
        return {
          name: d.data().name,
          unit: d.data().unit,
          readings: readingsSnap.docs.map(r => ({
            date: r.data().date?.split('T')[0] || r.data().date,
            value: r.data().value,
          })),
        };
      })
    );

    // Map workouts by date
    const workoutsByDate: Record<string, DaySummary['workouts']> = {};
    workoutSnap.docs.forEach(d => {
      const w = d.data() as any;
      const ds = w.date?.split('T')[0] || w.sessionDate?.split('T')[0] || '';
      if (ds >= startStr) {
        if (!workoutsByDate[ds]) workoutsByDate[ds] = [];
        workoutsByDate[ds].push({
          template: w.template || w.type || 'Workout',
          caloriesBurned: w.caloriesBurned || 0,
          distanceKm: w.distanceKm || 0,
          exercises: (w.exercises || []).map((e: any) => ({
            name: e.name || '',
            sets: (e.sets || []).map((s: any) => ({
              reps: s.reps || 0,
              weight: s.weight || 0,
            })),
          })),
        });
      }
    });

    // Map nutrition by date
    const nutritionByDate: Record<string, {
      calories: number; protein: number; carbs: number;
      fat: number; fibre: number; items: { name: string; calories: number }[];
    }> = {};
    nutritionSnap.docs.forEach(d => {
      const n = d.data() as any;
      const ds = n.date || '';
      if (ds >= startStr) {
        const items = (n.items || []).map((i: any) => ({ name: i.name || '', calories: i.calories || 0, protein: i.protein || 0, carbs: i.carbs || 0, fat: i.fat || 0, fibre: i.fibre || 0 }));
        nutritionByDate[ds] = {
          calories: n.totalCalories || items.reduce((s: number, i: any) => s + i.calories, 0) || 0,
          protein: n.totalProtein || items.reduce((s: number, i: any) => s + i.protein, 0) || 0,
          carbs: n.totalCarbs || items.reduce((s: number, i: any) => s + i.carbs, 0) || 0,
          fat: n.totalFat || items.reduce((s: number, i: any) => s + i.fat, 0) || 0,
          fibre: n.totalFibre || items.reduce((s: number, i: any) => s + i.fibre, 0) || 0,
          items: items,
        };
      }
    });

    // Map body comp by date
    const bodyCompData: BodyCompEntry[] = [];
    const bodyCompByDate: Record<string, BodyCompEntry> = {};
    bodySnap.docs.forEach(d => {
      const b = d.data() as any;
      const ds = b.date?.split('T')[0] || '';
      if (ds >= startStr) {
        const entry: BodyCompEntry = {
          date: ds,
          weightKg: b.weightKg ?? null,
          pbf: b.pbf ?? null,
          smm: b.smm ?? null,
          bmr: b.bmr ?? null,
          visceralFat: b.visceralFat ?? null,
        };
        bodyCompData.push(entry);
        bodyCompByDate[ds] = entry;
      }
    });

    // If no body comp entries fall within range, use the single most recent entry available
    if (bodyCompData.length === 0 && bodySnap.docs.length > 0) {
      const latest = bodySnap.docs[0].data() as any;
      const ds = latest.date?.split('T')[0] || '';
      if (ds) {
        bodyCompData.push({
          date: ds,
          weightKg: latest.weightKg ?? null,
          pbf: latest.pbf ?? null,
          smm: latest.smm ?? null,
          bmr: latest.bmr ?? null,
          visceralFat: latest.visceralFat ?? null,
        });
      }
    }

    // Map habits by date
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

    const waterByDate: Record<string, number> = {};
    waterLogsSnap?.docs.forEach(d => {
      const s = d.data() as any;
      if (s.date >= startStr) waterByDate[s.date] = s.value || 0;
    });

    // Collect all dates
    const allDates = new Set([
      ...Object.keys(workoutsByDate),
      ...Object.keys(nutritionByDate),
      ...bodyCompData.map(b => b.date),
      ...Object.keys(stepsByDate),
      ...Object.keys(sleepByDate),
      ...Object.keys(waterByDate),
    ]);

    const days: DaySummary[] = Array.from(allDates)
      .filter(d => d >= startStr)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({
        date,
        calories: nutritionByDate[date]?.calories || null,
        protein: nutritionByDate[date]?.protein || null,
        carbs: nutritionByDate[date]?.carbs || null,
        fat: nutritionByDate[date]?.fat || null,
        fibre: nutritionByDate[date]?.fibre || null,
        foodItems: nutritionByDate[date]?.items || [],
        workouts: workoutsByDate[date] || [],
        steps: stepsByDate[date] || null,
        sleepHours: sleepByDate[date] || null,
        water: waterByDate[date] || null,
        weight: bodyCompByDate[date]?.weightKg ?? null,
        pbf: bodyCompByDate[date]?.pbf ?? null,
        smm: bodyCompByDate[date]?.smm ?? null,
      }));

    return {
      days,
      bodyComp: bodyCompData.sort((a, b) => b.date.localeCompare(a.date)),
      labTests: labTestsData,
    };
  };

  const handleGenerate = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      const data = await fetchData();
      setPreview(data.days);
      setBodyComp(data.bodyComp);
      setLabTests(data.labTests);
    } finally {
      setGenerating(false);
    }
  };

  // ─── TXT EXPORT ───────────────────────────────────────────────────────────
  const exportTxt = () => {
    if (!preview) return;
    const lines: string[] = [];
    const rangeLabel = { '1W': 'Last 7 Days', '1M': 'Last 30 Days', '1Y': 'Last Year' }[range];

    lines.push(`FitTrack Health Report — ${rangeLabel}`);
    lines.push(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push('');

    // BODY COMPOSITION
    lines.push('BODY COMPOSITION');
    lines.push('────────────────────────────────────────────────────────────');
    if (bodyComp.length > 0) {
      lines.push('Date         Weight(kg)  Body Fat%   SMM(kg)   BMR    Visceral Fat');
      bodyComp.forEach(b => {
        const hasData = b.weightKg !== null || b.pbf !== null || b.smm !== null || b.bmr !== null || b.visceralFat !== null;
        if (!hasData) return;
        const row = [
          b.date.padEnd(13),
          String(b.weightKg ?? '—').padStart(10),
          String(b.pbf !== null ? b.pbf.toFixed(1) + '%' : '—').padStart(11),
          String(b.smm !== null ? b.smm.toFixed(1) : '—').padStart(9),
          String(b.bmr ?? '—').padStart(6),
          String(b.visceralFat ?? '—').padStart(12),
        ];
        lines.push(row.join('  '));
      });
    } else {
      lines.push('No data');
    }
    lines.push('');

    // OVERVIEW / AVERAGES TABLE
    if (range === '1W') {
      lines.push('DAILY OVERVIEW');
      lines.push('────────────────────────────────────────────────────────────');
      lines.push('Date        Cal In  Protein  Carbs   Fat  Cal Burned  Run(km)  Sleep   Steps   Water');
      preview.forEach(day => {
        const calBurned = day.workouts.reduce((s, w) => s + (w.caloriesBurned || 0), 0);
        const runKm = day.workouts.reduce((s, w) => s + (w.distanceKm || 0), 0);
        lines.push([
          day.date.padEnd(12),
          fmtVal(day.calories).padStart(6),
          fmtVal(day.protein).padStart(8),
          fmtVal(day.carbs).padStart(7),
          fmtVal(day.fat).padStart(5),
          (calBurned > 0 ? String(calBurned) : '—').padStart(11),
          (runKm > 0 ? runKm.toFixed(1) : '—').padStart(8),
          (day.sleepHours !== null && day.sleepHours > 0 ? day.sleepHours.toFixed(1) : '—').padStart(7),
          (day.steps !== null && day.steps > 0 ? day.steps.toLocaleString() : '—').padStart(7),
          (day.water !== null && day.water > 0 ? String(day.water) : '—').padStart(7),
        ].join('  '));
      });
      lines.push('');
    } else if (range === '1M') {
      lines.push('WEEKLY AVERAGES  (daily avg = week total ÷ 7)');
      lines.push('────────────────────────────────────────────────────────────');
      lines.push('Week (Mon)    Active  DAvg Cal  DAvg Prot  DAvg Carbs  DAvg Fat  DAvg Burned  Total km  DAvg Sleep  DAvg Steps  DAvg Water');
      groupByWeek(preview).forEach(({ weekLabel, days: wd }) => {
        lines.push([
          weekLabel.padEnd(14),
          String(activeDays(wd)).padStart(6),
          String(dailyAvg(wd, 'calories', 7) || '—').padStart(9),
          String(dailyAvg(wd, 'protein', 7) || '—').padStart(10),
          String(dailyAvg(wd, 'carbs', 7) || '—').padStart(11),
          String(dailyAvg(wd, 'fat', 7) || '—').padStart(9),
          String(Math.round(totalCalBurned(wd) / 7) || '—').padStart(12),
          String(totalRunKm(wd).toFixed(1)).padStart(9),
          dailyAvgFloat(wd, 'sleepHours', 7).padStart(11),
          String(dailyAvg(wd, 'steps', 7) || '—').padStart(11),
          String(dailyAvg(wd, 'water', 7) || '—').padStart(11),
        ].join('  '));
      });
      lines.push('');
    } else {
      lines.push('MONTHLY AVERAGES  (daily avg = month total ÷ days in month)');
      lines.push('────────────────────────────────────────────────────────────');
      lines.push('Month      Active  DAvg Cal  DAvg Prot  DAvg Carbs  DAvg Fat  DAvg Burned  Total km  DAvg Sleep  DAvg Steps  DAvg Water');
      groupByMonth(preview).forEach(({ monthLabel, days: md }) => {
        const dim = daysInMonth(monthLabel);
        lines.push([
          monthLabel.padEnd(11),
          String(activeDays(md)).padStart(6),
          String(dailyAvg(md, 'calories', dim) || '—').padStart(9),
          String(dailyAvg(md, 'protein', dim) || '—').padStart(10),
          String(dailyAvg(md, 'carbs', dim) || '—').padStart(11),
          String(dailyAvg(md, 'fat', dim) || '—').padStart(9),
          String(Math.round(totalCalBurned(md) / dim) || '—').padStart(12),
          String(totalRunKm(md).toFixed(1)).padStart(9),
          dailyAvgFloat(md, 'sleepHours', dim).padStart(11),
          String(dailyAvg(md, 'steps', dim) || '—').padStart(11),
          String(dailyAvg(md, 'water', dim) || '—').padStart(11),
        ].join('  '));
      });
      lines.push('');
    }

    // LAB RESULTS
    lines.push('LAB RESULTS');
    lines.push('────────────────────────────────────────────────────────────');
    if (labTests.length > 0) {
      labTests.forEach(test => {
        const recent = test.readings.slice(0, 5).reverse();
        if (!recent.length) return;
        lines.push(`${test.name} (${test.unit})`);
        lines.push('  ' + recent.map(r => r.date).join('   '));
        lines.push('  ' + recent.map(r => String(r.value).padEnd(10)).join(' '));
        lines.push('');
      });
    } else {
      lines.push('No lab data');
      lines.push('');
    }

    // DAILY DETAIL (1W only)
    if (range === '1W') {
      lines.push('DAILY DETAIL');
      lines.push('────────────────────────────────────────────────────────────');
      preview.forEach(day => {
        if (day.workouts.length === 0 && day.foodItems.length === 0) return;
        lines.push('');
        lines.push(day.date);
        if (day.workouts.length > 0) {
          lines.push('  Workouts:');
          day.workouts.forEach(w => {
            const extras: string[] = [];
            if (w.caloriesBurned > 0) extras.push(`${w.caloriesBurned} kcal burned`);
            if (w.distanceKm > 0) extras.push(`${w.distanceKm.toFixed(2)} km`);
            lines.push(`    ${w.template}${extras.length ? ' — ' + extras.join(', ') : ''}`);
            w.exercises.forEach(e => {
              const setsStr = e.sets
                .filter(s => s.reps > 0 || s.weight > 0)
                .map(s => `${s.weight}kg × ${s.reps}`)
                .join(', ');
              if (setsStr) lines.push(`      ${e.name}: ${setsStr}`);
            });
          });
        }
        if (day.foodItems.length > 0) {
          lines.push('  Food:');
          day.foodItems.forEach(item => {
            lines.push(`    ${item.name} (${item.calories} kcal)`);
          });
          const parts: string[] = [];
          if (day.calories) parts.push(`${day.calories} kcal`);
          if (day.protein) parts.push(`P: ${day.protein}g`);
          if (day.carbs) parts.push(`C: ${day.carbs}g`);
          if (day.fat) parts.push(`F: ${day.fat}g`);
          if (day.fibre) parts.push(`Fibre: ${day.fibre}g`);
          lines.push(`    Total: ${parts.join(' | ')}`);
        }
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fittrack-report-${localDateStr(new Date())}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── PDF EXPORT ───────────────────────────────────────────────────────────
  const exportPdf = async () => {
    if (!preview) return;
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const rangeLabel = { '1W': 'Last 7 Days', '1M': 'Last 30 Days', '1Y': 'Last Year' }[range];

    const headerFill: [number, number, number] = [30, 41, 59];
    const evenRow: [number, number, number] = [248, 250, 252];
    const oddRow: [number, number, number] = [255, 255, 255];

    // Title
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('FitTrack Health Report', 15, 15);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(
      `${rangeLabel}  ·  Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      15, 22
    );

    let y = 32;

    const sectionHeader = (title: string) => {
      if (y > 255) { pdf.addPage(); y = 20; }
      y += 4;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text(title, 15, y);
      y += 4;
    };

    const tableEnd = () => {
      y = (pdf as any).lastAutoTable.finalY + 8;
    };

    // ── BODY COMPOSITION ──
    sectionHeader('BODY COMPOSITION');
    if (bodyComp.length > 0) {
      autoTable(pdf, {
        startY: y,
        head: [['Date', 'Weight (kg)', 'Body Fat %', 'SMM (kg)', 'BMR', 'Visceral Fat']],
        body: bodyComp
          .filter(b => b.weightKg !== null || b.pbf !== null || b.smm !== null || b.bmr !== null || b.visceralFat !== null)
          .map(b => [
            b.date,
            b.weightKg !== null ? b.weightKg.toFixed(1) : '—',
            b.pbf !== null ? b.pbf.toFixed(1) + '%' : '—',
            b.smm !== null ? b.smm.toFixed(1) : '—',
            b.bmr !== null ? String(b.bmr) : '—',
            b.visceralFat !== null ? String(b.visceralFat) : '—',
          ]),
        theme: 'grid',
        headStyles: { fillColor: headerFill, textColor: 255, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, fillColor: evenRow },
        alternateRowStyles: { fillColor: oddRow },
        styles: { cellPadding: 2 },
      });
      tableEnd();
    } else {
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.text('No data', 15, y);
      y += 8;
    }

    // ── OVERVIEW / AVERAGES ──
    if (range === '1W') {
      sectionHeader('DAILY OVERVIEW');
      autoTable(pdf, {
        startY: y,
        head: [['Date', 'Cal In', 'Protein', 'Carbs', 'Fat', 'Cal Burned', 'Run (km)', 'Sleep', 'Steps', 'Water']],
        body: preview.map(day => {
          const calBurned = day.workouts.reduce((s, w) => s + (w.caloriesBurned || 0), 0);
          const runKm = day.workouts.reduce((s, w) => s + (w.distanceKm || 0), 0);
          return [
            day.date,
            fmtVal(day.calories),
            fmtVal(day.protein),
            fmtVal(day.carbs),
            fmtVal(day.fat),
            calBurned > 0 ? String(calBurned) : '—',
            runKm > 0 ? runKm.toFixed(1) : '—',
            day.sleepHours !== null && day.sleepHours > 0 ? day.sleepHours.toFixed(1) : '—',
            day.steps !== null && day.steps > 0 ? day.steps.toLocaleString() : '—',
            day.water !== null && day.water > 0 ? String(day.water) : '—',
          ];
        }),
        theme: 'grid',
        headStyles: { fillColor: headerFill, textColor: 255, fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, fillColor: evenRow },
        alternateRowStyles: { fillColor: oddRow },
        styles: { cellPadding: 2 },
        columnStyles: { 0: { cellWidth: 22 } },
      });
      tableEnd();
    } else if (range === '1M') {
      sectionHeader('WEEKLY AVERAGES  (daily avg = week total ÷ 7)');
      autoTable(pdf, {
        startY: y,
        head: [['Week (Mon)', 'Active Days', 'DAvg Cal', 'DAvg Protein', 'DAvg Carbs', 'DAvg Fat', 'DAvg Burned', 'Total km', 'DAvg Sleep', 'DAvg Steps', 'DAvg Water']],
        body: groupByWeek(preview).map(({ weekLabel, days: wd }) => [
          weekLabel,
          activeDays(wd),
          dailyAvg(wd, 'calories', 7) || '—',
          dailyAvg(wd, 'protein', 7) || '—',
          dailyAvg(wd, 'carbs', 7) || '—',
          dailyAvg(wd, 'fat', 7) || '—',
          Math.round(totalCalBurned(wd) / 7) || '—',
          totalRunKm(wd).toFixed(1),
          dailyAvgFloat(wd, 'sleepHours', 7),
          dailyAvg(wd, 'steps', 7) ? dailyAvg(wd, 'steps', 7).toLocaleString() : '—',
          dailyAvg(wd, 'water', 7) || '—',
        ]),
        theme: 'grid',
        headStyles: { fillColor: headerFill, textColor: 255, fontSize: 6.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, fillColor: evenRow },
        alternateRowStyles: { fillColor: oddRow },
        styles: { cellPadding: 2 },
        columnStyles: { 0: { cellWidth: 22 } },
      });
      tableEnd();
    } else {
      sectionHeader('MONTHLY AVERAGES  (daily avg = month total ÷ days in month)');
      autoTable(pdf, {
        startY: y,
        head: [['Month', 'Active Days', 'DAvg Cal', 'DAvg Protein', 'DAvg Carbs', 'DAvg Fat', 'DAvg Burned', 'Total km', 'DAvg Sleep', 'DAvg Steps', 'DAvg Water']],
        body: groupByMonth(preview).map(({ monthLabel, days: md }) => {
          const dim = daysInMonth(monthLabel);
          return [
            monthLabel,
            activeDays(md),
            dailyAvg(md, 'calories', dim) || '—',
            dailyAvg(md, 'protein', dim) || '—',
            dailyAvg(md, 'carbs', dim) || '—',
            dailyAvg(md, 'fat', dim) || '—',
            Math.round(totalCalBurned(md) / dim) || '—',
            totalRunKm(md).toFixed(1),
            dailyAvgFloat(md, 'sleepHours', dim),
            dailyAvg(md, 'steps', dim) ? dailyAvg(md, 'steps', dim).toLocaleString() : '—',
            dailyAvg(md, 'water', dim) || '—',
          ];
        }),
        theme: 'grid',
        headStyles: { fillColor: headerFill, textColor: 255, fontSize: 6.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, fillColor: evenRow },
        alternateRowStyles: { fillColor: oddRow },
        styles: { cellPadding: 2 },
        columnStyles: { 0: { cellWidth: 20 } },
      });
      tableEnd();
    }

    // ── LAB RESULTS ──
    sectionHeader('LAB RESULTS');
    if (labTests.length > 0) {
      const filteredLabs = labTests.filter(t => t.readings.length > 0);
      if (filteredLabs.length > 0) {
        // Collect all unique dates across all tests (up to 6 most recent)
        const allDates = Array.from(
          new Set(filteredLabs.flatMap(t => t.readings.slice(0, 6).map(r => r.date)))
        ).sort((a, b) => b.localeCompare(a)).slice(0, 6);

        autoTable(pdf, {
          startY: y,
          head: [['Test', ...allDates]],
          body: filteredLabs.map(test => {
            const readingMap: Record<string, string> = {};
            test.readings.forEach(r => { readingMap[r.date] = String(r.value); });
            return [
              `${test.name} (${test.unit})`,
              ...allDates.map(d => readingMap[d] || '—'),
            ];
          }),
          theme: 'grid',
          headStyles: { fillColor: headerFill, textColor: 255, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8, fillColor: evenRow },
          alternateRowStyles: { fillColor: oddRow },
          styles: { cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 50 } },
        });
        tableEnd();
      }
    } else {
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.text('No lab data', 15, y);
      y += 8;
    }

    // ── DAILY DETAIL (1W only) ──
    if (range === '1W') {
      sectionHeader('DAILY DETAIL');
      pdf.setFont('helvetica', 'normal');

      preview.forEach(day => {
        if (day.workouts.length === 0 && day.foodItems.length === 0) return;
        if (y > 258) { pdf.addPage(); y = 20; }

        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.text(day.date, 15, y);
        y += 5;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);

        if (day.workouts.length > 0) {
          pdf.text('Workouts:', 18, y); y += 4;
          day.workouts.forEach(w => {
            if (y > 275) { pdf.addPage(); y = 20; }
            const extras: string[] = [];
            if (w.caloriesBurned > 0) extras.push(`${w.caloriesBurned} kcal burned`);
            if (w.distanceKm > 0) extras.push(`${w.distanceKm.toFixed(2)} km`);
            pdf.text(`  ${w.template}${extras.length ? '  —  ' + extras.join(', ') : ''}`, 18, y);
            y += 4;
            w.exercises.forEach(e => {
              if (y > 275) { pdf.addPage(); y = 20; }
              const setsStr = e.sets
                .filter(s => s.reps > 0 || s.weight > 0)
                .map(s => `${s.weight}kg × ${s.reps}`)
                .join(', ');
              if (setsStr) {
                pdf.text(`    ${e.name}: ${setsStr}`, 18, y);
                y += 4;
              }
            });
          });
        }

        if (day.foodItems.length > 0) {
          if (y > 275) { pdf.addPage(); y = 20; }
          pdf.text('Food:', 18, y); y += 4;
          day.foodItems.forEach(item => {
            if (y > 275) { pdf.addPage(); y = 20; }
            pdf.text(`  ${item.name} (${item.calories} kcal)`, 18, y);
            y += 4;
          });
          if (y > 275) { pdf.addPage(); y = 20; }
          const parts: string[] = [];
          if (day.calories) parts.push(`${day.calories} kcal`);
          if (day.protein) parts.push(`P: ${day.protein}g`);
          if (day.carbs) parts.push(`C: ${day.carbs}g`);
          if (day.fat) parts.push(`F: ${day.fat}g`);
          if (day.fibre) parts.push(`Fibre: ${day.fibre}g`);
          pdf.text(`  Total: ${parts.join('  |  ')}`, 18, y);
          y += 4;
        }
        y += 3;
      });
    }

    // Page numbers
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(150);
      pdf.text(`Page ${i} of ${totalPages}`, 15, 287);
      pdf.setTextColor(0);
    }

    pdf.save(`fittrack-report-${localDateStr(new Date())}.pdf`);
  };

  // ─── SUMMARY STATS ────────────────────────────────────────────────────────
  const workoutDays = preview?.filter(d => d.workouts.length > 0).length ?? 0;
  const avgCalories = preview ? avgOf(preview, 'calories') : 0;
  const avgSteps = preview ? avgOf(preview, 'steps') : 0;
  const avgProtein = preview ? avgOf(preview, 'protein') : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <div className="flex items-center gap-3 p-4 border-b border-slate-800">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">Export Data</h1>
      </div>

      <div className="p-4 space-y-5">

        {/* Range selector */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wider mb-3">Time Range</p>
          <div className="grid grid-cols-3 gap-2">
            {(['1W', '1M', '1Y'] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => { setRange(r); setPreview(null); }}
                className={`py-3 rounded-xl text-sm font-medium transition-colors ${
                  range === r ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {r === '1W' ? '1 Week' : r === '1M' ? '1 Month' : '1 Year'}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-2 text-center">
            {range === '1W' && 'Includes daily detail + workout breakdown'}
            {range === '1M' && 'Includes weekly averages table'}
            {range === '1Y' && 'Includes monthly averages table'}
          </p>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Building report…</span>
            </>
          ) : (
            <>
              <span>📊</span>
              <span>Generate Preview</span>
            </>
          )}
        </button>

        {/* Preview */}
        {preview && (
          <div className="space-y-4">

            {/* Summary cards */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
              <p className="text-xs text-slate-400 font-mono uppercase tracking-wider mb-3">Preview</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800 rounded-xl p-3">
                  <div className="text-2xl font-bold text-white">{workoutDays}</div>
                  <div className="text-[10px] text-slate-400">workout days</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <div className="text-2xl font-bold text-orange-400">{avgCalories || '—'}</div>
                  <div className="text-[10px] text-slate-400">avg kcal / day</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <div className="text-2xl font-bold text-red-400">{avgProtein || '—'}</div>
                  <div className="text-[10px] text-slate-400">avg protein (g)</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <div className="text-2xl font-bold text-green-400">{avgSteps ? avgSteps.toLocaleString() : '—'}</div>
                  <div className="text-[10px] text-slate-400">avg steps / day</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-500">
                <div>{bodyComp.length} body comp entries</div>
                <div>{labTests.filter(t => t.readings.length > 0).length} lab tests</div>
                <div>{preview.length} days of data</div>
              </div>
            </div>

            {/* Download buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={exportTxt}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-3 rounded-xl font-medium transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span className="text-sm">Download TXT</span>
              </button>
              <button
                onClick={exportPdf}
                className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="text-sm">Download PDF</span>
              </button>
            </div>

            <p className="text-[10px] text-center text-slate-600">Share with your doctor, dietitian, or gym coach</p>
          </div>
        )}
      </div>
    </div>
  );
}