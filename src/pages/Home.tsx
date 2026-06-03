import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Target, Download, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCompleteness } from '@/hooks/useCompleteness';
import {
  collection, query, orderBy, limit, getDocs, where, getDoc, doc, setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { logHabitEntry, removeHabitLog } from '@/lib/habits';
import { ensureDefaultHabits, getHabitLogToday, setHabitLogToday } from '@/lib/defaultHabits';
import { useActivityRings } from '@/hooks/useActivityRings';
import html2canvas from 'html2canvas';

interface WorkoutSession { id: string; date: string; template: string; duration?: number; exercises: any[]; createdAt: any; }
interface BodyStats { id: string; date: string; weightKg: number; pbf: number; smm?: number; createdAt: any; }
interface LabTest { testName: string; value: number; unit: string; }
interface LabResults { id: string; date: string; results: LabTest[]; createdAt: any; }
interface Habit { id: string; name: string; icon: string; goalType: string; targetValue: number; targetUnit?: string; }

const labRanges: { [key: string]: { min: number; max: number } } = {
  tsh: { min: 0.4, max: 4.0 }, vitd: { min: 30, max: 100 }, b12: { min: 200, max: 900 },
  hb: { min: 13.5, max: 17.5 }, hba1c: { min: 4, max: 5.6 }, totalcholesterol: { min: 0, max: 200 },
  ldl: { min: 0, max: 100 }, hdl: { min: 40, max: 1000 }, triglycerides: { min: 0, max: 150 },
  creatinine: { min: 0.7, max: 1.3 },
};

const workoutTemplates = {
  'Push': { groups: ['Chest', 'Shoulders', 'Triceps'], duration: 45 },
  'Pull': { groups: ['Back', 'Biceps'], duration: 40 },
  'Legs': { groups: ['Quads', 'Hamstrings', 'Glutes', 'Calves'], duration: 50 },
  'Running': { groups: ['Cardio', 'Endurance'], duration: 30 },
  'Upper': { groups: ['Chest', 'Back', 'Shoulders'], duration: 55 },
  'Lower': { groups: ['Quads', 'Hamstrings', 'Glutes'], duration: 45 },
};

const muscleGroupMap: Record<string, string[]> = {
  push: ['Push', 'Chest', 'Shoulders', 'Triceps'], pushday: ['Push', 'Chest', 'Shoulders', 'Triceps'],
  pull: ['Pull', 'Back', 'Biceps'], pullday: ['Pull', 'Back', 'Biceps'],
  legs: ['Legs', 'Quads', 'Hamstrings', 'Glutes'], legsday: ['Legs', 'Quads', 'Hamstrings', 'Glutes'],
  upper: ['Push', 'Pull', 'Chest', 'Back'], lower: ['Legs', 'Quads', 'Hamstrings'], running: ['Cardio'],
};

const FitTrackLogoMark = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#10b981"/>
      <polyline points="7,24 16,8 25,24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="16" y1="8" x2="16" y2="24" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    </svg>
    <span style={{ color: '#10b981', fontSize: '18px', fontWeight: 700, letterSpacing: '0.08em' }}>FitTrack</span>
  </div>
);

// ── Weekly Poster Modal ────────────────────────────────────────────────────
interface WeeklyPosterProps {
  open: boolean;
  onClose: () => void;
  weekSessions: WorkoutSession[];
  weekStreak: number;
  thisWeekCount: number;
  thisWeekDays: { label: string; hasWorkout: boolean; isFuture: boolean }[];
  rings: { train: any; move: any; track: any; fuel: any };
}

function WeeklyPosterModal({ open, onClose, weekSessions, weekStreak, thisWeekCount, thisWeekDays, rings }: WeeklyPosterProps) {
  const posterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  if (!open) return null;

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  // Total duration this week
  const totalMins = weekSessions.reduce((sum, s) => sum + (s.duration || (s as any).durationMins || 0), 0);

  // Muscle groups trained this week
  const muscleSet = new Set<string>();
  weekSessions.forEach(s => {
    const t = s.template?.toLowerCase().replace(/\s+/g, '') || '';
    const mapped = muscleGroupMap[t] || [];
    mapped.forEach(m => muscleSet.add(m));
  });
  const muscles = Array.from(muscleSet).filter(m => !['Cardio', 'Endurance'].includes(m));

  // Ring bars data
  const ringBars = [
    { label: 'Train', pct: Math.round(rings.train.pct), color: '#ff375f' },
    { label: 'Move',  pct: Math.round(rings.move.pct),  color: '#30d158' },
    { label: 'Track', pct: Math.round(rings.track.pct), color: '#32ade6' },
    { label: 'Fuel',  pct: Math.round(rings.fuel.pct),  color: '#f97316' },
  ];

  const handleShare = async () => {
    if (!posterRef.current) return;
    setSharing(true);
    try {
      const canvas = await html2canvas(posterRef.current, { backgroundColor: '#0f172a', scale: 3, useCORS: true, logging: false });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'fittrack-week.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'FitTrack Week' }); } catch {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'fittrack-week.png'; a.click();
          URL.revokeObjectURL(url);
        }
        setSharing(false);
      }, 'image/png');
    } catch (e) { console.error(e); setSharing(false); }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const r = new FileReader(); r.onload = ev => setUserPhoto(ev.target?.result as string); r.readAsDataURL(file); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      <button onClick={onClose} style={{ position: 'absolute', top: '20px', right: '20px', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.08)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={18} />
      </button>

      {/* Poster card */}
      <div ref={posterRef} style={{ width: '300px', backgroundColor: '#0f172a', borderRadius: '20px', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        {/* Background */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          {userPhoto ? (
            <>
              <img src={userPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,23,42,0.65) 0%, rgba(15,23,42,0.82) 50%, rgba(15,23,42,0.96) 100%)' }} />
            </>
          ) : (
            <svg width="300" height="520" viewBox="0 0 300 520" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', inset: 0 }}>
              {Array.from({ length: 20 }).map((_, i) => (
                <line key={i} x1={-50 + i * 30} y1="0" x2={i * 30 + 200} y2="520" stroke="#10b981" strokeWidth="0.6" opacity="0.07" />
              ))}
              <ellipse cx="260" cy="440" rx="130" ry="110" fill="#10b981" opacity="0.04" />
              <ellipse cx="40" cy="80" rx="80" ry="60" fill="#10b981" opacity="0.03" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '24px', display: 'flex', flexDirection: 'column', minHeight: '520px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#10b981"/>
              <polyline points="7,24 16,8 25,24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="16" y1="8" x2="16" y2="24" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
            </svg>
            <div style={{ backgroundColor: 'rgba(16,185,129,0.18)', color: '#10b981', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Weekly Wrap
            </div>
            <div style={{ color: '#64748b', fontSize: '10px' }}>{weekLabel}</div>
          </div>

          {/* Big stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '18px', gap: '8px' }}>
            {[
              { val: thisWeekCount, label: 'Sessions' },
              { val: totalMins > 0 ? `${totalMins}m` : '—', label: 'Total time' },
              { val: weekStreak > 0 ? `${weekStreak}wk` : '—', label: 'Streak' },
            ].map(({ val, label }) => (
              <div key={label} style={{ backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: '10px', padding: '10px 8px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9' }}>{val}</div>
                <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Day dots strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            {thisWeekDays.map((day, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  backgroundColor: day.hasWorkout ? '#10b981' : 'rgba(30,41,59,0.8)',
                  border: day.hasWorkout ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: day.isFuture ? 0.3 : 1,
                }}>
                  {day.hasWorkout && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <polyline points="2,6 5,9 10,3" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: '9px', color: '#475569', fontFamily: 'monospace' }}>{day.label}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'linear-gradient(90deg, rgba(16,185,129,0.4), transparent)', marginBottom: '16px' }} />

          {/* Ring bars */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
              Weekly rings
            </div>
            {ringBars.map(({ label, pct, color }) => (
              <div key={label} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', width: '38px', flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: '6px', backgroundColor: 'rgba(30,41,59,0.9)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', backgroundColor: color, width: `${Math.min(100, pct)}%`, borderRadius: '3px' }} />
                </div>
                <span style={{ fontSize: '10px', color, fontFamily: 'monospace', width: '30px', textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
              </div>
            ))}
          </div>

          {/* Muscle group pills */}
          {muscles.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
                Trained this week
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {muscles.map(m => (
                  <div key={m} style={{ backgroundColor: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '20px', padding: '3px 10px', fontSize: '11px', color: '#10b981', fontWeight: 500 }}>
                    {m}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Footer */}
          <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'rgba(100,116,139,0.6)', letterSpacing: '0.05em' }}>
              fittrack-nine-cyan.vercel.app
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <button onClick={() => fileInputRef.current?.click()} style={{ padding: '10px 20px', borderRadius: '10px', backgroundColor: userPhoto ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', border: userPhoto ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)', color: userPhoto ? '#10b981' : '#e2e8f0', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          📷 {userPhoto ? 'Change photo' : 'Add your photo'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleShare} disabled={sharing} style={{ padding: '13px 28px', borderRadius: '12px', backgroundColor: '#10b981', border: 'none', color: 'white', fontSize: '14px', fontWeight: 600, cursor: sharing ? 'not-allowed' : 'pointer', opacity: sharing ? 0.7 : 1 }}>
            {sharing ? 'Sharing...' : 'Share poster'}
          </button>
          <button onClick={onClose} style={{ padding: '13px 24px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: '14px', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Home component ────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [minLoadDone, setMinLoadDone] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState<{ text: string; sub: string } | null>(null);
  const quoteCardRef = useRef<HTMLDivElement>(null);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [labResults, setLabResults] = useState<LabResults[]>([]);
  const [upcomingTests, setUpcomingTests] = useState<any[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitsDoneToday, setHabitsDoneToday] = useState<Record<string, boolean>>({});
  const [waterCount, setWaterCount] = useState(0);
  const [stepsCount, setStepsCount] = useState(0);
  const [stepsInput, setStepsInput] = useState('0');
  const [sleepHours, setSleepHours] = useState(0);
  const [sleepInput, setSleepInput] = useState('0');
  const [savingWater, setSavingWater] = useState(false);
  const [savingSteps, setSavingSteps] = useState(false);
  const [savingSleep, setSavingSleep] = useState(false);
  const [showWeeklyPoster, setShowWeeklyPoster] = useState(false);
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const [ringsKey, setRingsKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => setMinLoadDone(true), 2500); return () => clearTimeout(t); }, []);
  useEffect(() => { setRingsKey(k => k + 1); }, [location.key]);

  const rings = useActivityRings(user?.uid || '', ringsKey);

  const [muscleAlert, setMuscleAlert] = useState<{ group: string; daysSince: number } | null>(null);
  const [aiInsights, setAiInsights] = useState<{ workout: string; food: string; labs: string } | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [insightIndex, setInsightIndex] = useState(0);

  const { workouts: hasWorkouts, body: hasBody, labs: hasLabs, totalComplete } = useCompleteness();
  const completeness = { workouts: hasWorkouts, body: hasBody, labs: hasLabs };

  const insightTopics = ['workout', 'food', 'labs'] as const;
  const insightColors: Record<typeof insightTopics[number], { bg: string; border: string; text: string }> = {
    workout: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400' },
    food: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400' },
    labs: { bg: 'bg-purple-500/5', border: 'border-purple-500/20', text: 'text-purple-400' },
  };
  const insightDotColors: Record<typeof insightTopics[number], string> = {
    workout: 'bg-emerald-400', food: 'bg-blue-400', labs: 'bg-purple-400',
  };

  const toggleHabit = useCallback(async (habitId: string) => {
    if (!user) return;
    const alreadyDone = habitsDoneToday[habitId];
    try {
      if (alreadyDone) { await removeHabitLog(user.uid, habitId, todayStr); setHabitsDoneToday(prev => ({ ...prev, [habitId]: false })); }
      else { await logHabitEntry(user.uid, habitId, todayStr, 1); setHabitsDoneToday(prev => ({ ...prev, [habitId]: true })); }
    } catch (e) { console.error('Error toggling habit:', e); }
  }, [user, habitsDoneToday, todayStr]);

  const saveWater = async (val: number) => {
    if (!user) return; setSavingWater(true);
    try { const waterH = habits.find(h => h.name?.toLowerCase().includes('water')); if (waterH) { await setHabitLogToday(user.uid, waterH.id, val); setWaterCount(val); if (val > 0) setHabitsDoneToday(prev => ({ ...prev, [waterH.id]: true })); } }
    catch (e) { console.error(e); } finally { setSavingWater(false); }
  };
  const saveSteps = async (val: number) => {
    if (!user) return; setSavingSteps(true);
    try { const stepsH = habits.find(h => h.name?.toLowerCase().includes('step')); if (stepsH) { await setHabitLogToday(user.uid, stepsH.id, val); setStepsCount(val); if (val > 0) setHabitsDoneToday(prev => ({ ...prev, [stepsH.id]: true })); } }
    catch (e) { console.error(e); } finally { setSavingSteps(false); }
  };
  const saveSleep = async (val: number) => {
    if (!user) return; setSavingSleep(true);
    try { const sleepH = habits.find(h => h.name?.toLowerCase().includes('sleep')); if (sleepH) { await setHabitLogToday(user.uid, sleepH.id, val); setSleepHours(val); if (val > 0) setHabitsDoneToday(prev => ({ ...prev, [sleepH.id]: true })); } }
    catch (e) { console.error(e); } finally { setSavingSleep(false); }
  };

  const getMuscleGroupAlert = (sessions: WorkoutSession[]) => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const recentSessions = sessions.filter(s => new Date(s.date) >= fourteenDaysAgo);
    const groupLastDates: Record<string, Date | null> = { Push: null, Pull: null, Legs: null };
    for (const session of recentSessions) {
      const template = session.template?.toLowerCase().replace(/\s+/g, '') || '';
      const mapped = muscleGroupMap[template] || [];
      for (const group of ['Push', 'Pull', 'Legs'] as const) {
        if (mapped.includes(group)) { const sd = new Date(session.date); if (!groupLastDates[group] || sd > groupLastDates[group]!) groupLastDates[group] = sd; }
      }
    }
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    let mostNeglected: { group: string; daysSince: number } | null = null;
    for (const group of ['Push', 'Pull', 'Legs'] as const) {
      const lastDate = groupLastDates[group];
      if (!lastDate || lastDate < tenDaysAgo) {
        const daysSince = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000)) : 999;
        if (!mostNeglected || daysSince > mostNeglected.daysSince) mostNeglected = { group, daysSince };
      }
    }
    return mostNeglected;
  };

  const calculateAge = (dob: string) => {
    if (!dob) return null;
    const birth = new Date(dob); const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  };

  const generateLoadingQuote = (sessions: WorkoutSession[], body: BodyStats[]): { text: string; sub: string } => {
    const genericQuotes = [
      { text: "The only bad workout is the one that didn't happen.", sub: "Let's get moving." },
      { text: "Small steps every day add up to big changes.", sub: "You're building something real." },
      { text: "Your body keeps every promise you make to it.", sub: "Stay consistent." },
      { text: "Progress is progress, no matter how small.", sub: "Keep showing up." },
      { text: "Discipline is choosing what you want most over what you want now.", sub: "You've got this." },
      { text: "The pain you feel today is the strength you'll feel tomorrow.", sub: "Push through." },
      { text: "Every rep, every step, every choice counts.", sub: "Make it count today." },
    ];
    const dataQuotes: { text: string; sub: string }[] = [];
    if (sessions.length >= 3) {
      const last7 = sessions.filter(s => (Date.now() - new Date(s.date).getTime()) / (1000 * 60 * 60 * 24) <= 7);
      if (last7.length >= 3) dataQuotes.push({ text: `${last7.length} workouts in the last 7 days.`, sub: "That's serious consistency. Keep it up." });
    }
    if (body.length >= 2) {
      const cur = body[0]; const prev = body[1];
      const wCur = cur.weightKg != null ? Number(cur.weightKg) : null;
      const wPrev = prev.weightKg != null ? Number(prev.weightKg) : null;
      if (wCur != null && wPrev != null) {
        const diff = wCur - wPrev;
        if (diff < -0.3) dataQuotes.push({ text: `Down ${Math.abs(diff).toFixed(1)}kg since your last check-in.`, sub: "The scale is moving. Stay the course." });
        else if (diff > 0.3) dataQuotes.push({ text: `Up ${diff.toFixed(1)}kg — could be muscle, could be water.`, sub: "Trust the process. Keep tracking." });
      }
      const pbfCur = cur.pbf != null ? Number(cur.pbf) : null;
      const pbfPrev = prev.pbf != null ? Number(prev.pbf) : null;
      if (pbfCur != null && pbfPrev != null && pbfCur < pbfPrev) dataQuotes.push({ text: `Body fat down ${(pbfPrev - pbfCur).toFixed(1)}% since last entry.`, sub: "Fat loss is happening. Keep going." });
      const smmCur = cur.smm != null ? Number(cur.smm) : null;
      const smmPrev = prev.smm != null ? Number(prev.smm) : null;
      if (smmCur != null && smmPrev != null && smmCur > smmPrev) dataQuotes.push({ text: `Muscle mass up ${(smmCur - smmPrev).toFixed(1)}kg.`, sub: "You're building strength. Don't stop now." });
    }
    if (sessions.length >= 10) dataQuotes.push({ text: `${sessions.length} workouts logged so far.`, sub: "Every single one of them mattered." });
    const useData = dataQuotes.length > 0 && Math.random() < 0.5;
    const pool = useData ? dataQuotes : genericQuotes;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const fetchAIInsights = useCallback(async () => {
    if (!user) return;
    setIsLoadingInsights(true);
    try {
      const cacheRef = doc(db, 'users', user.uid, 'aiInsights', 'daily');
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        const cached = cacheSnap.data() as { insights: { workout: string; food: string; labs: string }; generatedAt: string };
        if ((Date.now() - new Date(cached.generatedAt).getTime()) / 3600000 < 24) { setAiInsights(cached.insights); setIsLoadingInsights(false); return; }
      }
      const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
      const profileData = profileSnap.exists() ? profileSnap.data() as any : null;
      const contextParts: string[] = [];
      if (profileData) {
        const age = calculateAge(profileData.dob);
        const parts = [profileData.name && `Name: ${profileData.name}`, age && `Age: ${age}`, profileData.gender && `Gender: ${profileData.gender}`, profileData.foodPreference && `Diet: ${profileData.foodPreference}`, profileData.activityLevel && `Activity: ${profileData.activityLevel}`, profileData.primaryGoal && `Goal: ${profileData.primaryGoal}`, profileData.fitnessFocus?.length && `Fitness focus: ${profileData.fitnessFocus.join(', ')}`, profileData.fitnessTarget && `Target: ${profileData.fitnessTarget}`, profileData.chronicConditions?.length && `Conditions: ${profileData.chronicConditions.join(', ')}`].filter(Boolean) as string[];
        if (parts.length) contextParts.push('PROFILE:\n' + parts.join('\n'));
      }
      if (bodyStats.length > 0) { const cur = bodyStats[0]; const prev = bodyStats.length > 1 ? bodyStats[1] : null; const parts = [cur.weightKg != null && `Weight: ${cur.weightKg} kg`, cur.pbf != null && `PBF: ${cur.pbf}%`, cur.smm != null && `SMM: ${cur.smm} kg`, prev?.weightKg != null && cur.weightKg != null && `Weight change: ${(cur.weightKg - prev.weightKg).toFixed(1)} kg`].filter(Boolean) as string[]; if (parts.length) contextParts.push('BODY STATS:\n' + parts.join('\n')); }
      if (workoutSessions.length > 0) contextParts.push('LAST 3 WORKOUTS:\n' + workoutSessions.slice(0, 3).map(s => `- ${s.date}: ${s.template}`).join('\n'));
      if (labResults.length > 0) { const latest = labResults[0]; if (latest.results && Array.isArray(latest.results)) { const outOfRange = latest.results.filter((test: LabTest) => { const key = test.testName.toLowerCase().replace(/\s+/g, ''); const range = labRanges[key]; if (!range) return false; if (key === 'hdl') return test.value < range.min; return test.value < range.min || test.value > range.max; }); contextParts.push(outOfRange.length > 0 ? `LABS (${outOfRange.length} out of range):\n` + outOfRange.map((t: LabTest) => `- ${t.testName}: ${t.value} ${t.unit}`).join('\n') : 'LABS: All markers in range'); } }
      if (muscleAlert) contextParts.push(`MUSCLE ALERT: ${muscleAlert.group} neglected — ${muscleAlert.daysSince} days`);
      const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: `You are a personal health coach. Generate 3 short personalized insights.\n\nUSER DATA:\n${contextParts.join('\n\n')}\n\nReturn ONLY a JSON object, no markdown, no preamble:\n{\n  "workout": "1-2 sentence actionable workout insight",\n  "food": "1-2 sentence food/nutrition insight based on their diet preference and goals",\n  "labs": "1-2 sentence insight based on lab results, or general health tip if no labs"\n}\nRules: be specific, use actual numbers, under 25 words each, respect diet preference, friendly coach tone.` }] }) });
      if (!response.ok) throw new Error('AI request failed');
      const data = await response.json();
      const parsed = JSON.parse(data.content?.[0]?.text || '{}');
      const insights = { workout: parsed.workout || '', food: parsed.food || '', labs: parsed.labs || '' };
      setAiInsights(insights);
      await setDoc(cacheRef, { insights, generatedAt: new Date().toISOString() });
    } catch (e) { console.error('AI insights error:', e); } finally { setIsLoadingInsights(false); }
  }, [user, bodyStats, workoutSessions, labResults, muscleAlert]);

  useEffect(() => {
    if (!user) return;
    const fetchAllData = async () => {
      try {
        await ensureDefaultHabits(user.uid);
        const [workoutsSnapshot, bodySnapshot, labsSnapshot, testsSnapshot, habitsSnap] = await Promise.all([
          getDocs(query(collection(db, 'users', user.uid, 'workoutSessions'), orderBy('date', 'desc'), limit(50))),
          getDocs(query(collection(db, 'users', user.uid, 'bodyComp'), orderBy('date', 'desc'), limit(50))),
          getDocs(query(collection(db, 'users', user.uid, 'labs'), orderBy('date', 'desc'), limit(10))),
          getDocs(query(collection(db, 'users', user.uid, 'tests'), orderBy('nextDueDate', 'asc'))),
          getDocs(collection(db, 'users', user.uid, 'habits')),
        ]);
        const sessions = workoutsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutSession));
        setWorkoutSessions(sessions); setMuscleAlert(getMuscleGroupAlert(sessions));
        const bodyStatsData = bodySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as BodyStats));
        setBodyStats(bodyStatsData); setLoadingQuote(generateLoadingQuote(sessions, bodyStatsData));
        setLabResults(labsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as LabResults)));
        const now = new Date(); const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const tests = testsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
        setUpcomingTests(tests.filter(t => t.nextDueDate && new Date(t.nextDueDate) <= thirtyDaysFromNow));
        const habitsData = habitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Habit));
        setHabits(habitsData);
        const waterH = habitsData.find(h => h.name?.toLowerCase().includes('water'));
        const stepsH = habitsData.find(h => h.name?.toLowerCase().includes('step'));
        const sleepH = habitsData.find(h => h.name?.toLowerCase().includes('sleep'));
        const [waterVal, stepsVal, sleepVal, ...habitLogResults] = await Promise.all([
          waterH ? getHabitLogToday(user.uid, waterH.id) : Promise.resolve(0),
          stepsH ? getHabitLogToday(user.uid, stepsH.id) : Promise.resolve(0),
          sleepH ? getHabitLogToday(user.uid, sleepH.id) : Promise.resolve(0),
          ...habitsData.map(habit => getDocs(query(collection(db, 'users', user.uid, 'habits', habit.id, 'logs'), where('date', '==', todayStr)))),
        ]);
        if (waterH) { setWaterCount(waterVal as number); }
        if (stepsH) { setStepsCount(stepsVal as number); setStepsInput(String(stepsVal)); }
        if (sleepH) { setSleepHours(sleepVal as number); setSleepInput(String(sleepVal)); }
        const doneMap: Record<string, boolean> = {};
        habitsData.forEach((habit, i) => { doneMap[habit.id] = !(habitLogResults[i] as any).empty; });
        setHabitsDoneToday(doneMap);
      } catch (error) { console.error('Error fetching data:', error); } finally { setLoading(false); }
    };
    fetchAllData();
  }, [user]);

  useEffect(() => { if (!loading && user) fetchAIInsights(); }, [loading]);

  const handleShareQuote = async () => {
    if (!quoteCardRef.current || !loadingQuote) return;
    try {
      const canvas = await html2canvas(quoteCardRef.current, { backgroundColor: '#0f172a', scale: 3, useCORS: true, logging: false });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'fittrack-quote.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'FitTrack' }); } catch {} }
        else { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'fittrack-quote.png'; a.click(); URL.revokeObjectURL(url); }
      }, 'image/png');
    } catch (e) { console.error('Share failed:', e); }
  };

  const getSuggestedWorkout = () => {
    if (workoutSessions.length === 0) return null;
    const rotation: { [key: string]: string } = { 'Push': 'Pull', 'pull': 'Legs', 'Pull': 'Legs', 'Legs': 'Running', 'legs': 'Running', 'Running': 'Push', 'running': 'Push', 'pushday': 'Pull', 'pullday': 'Legs', 'legsday': 'Running' };
    return rotation[workoutSessions[0].template] || 'Push';
  };

  const calculateStreak = () => {
    if (workoutSessions.length === 0) return { weeks: 0, thisWeekDays: [], thisWeekCount: 0, weekSessions: [] };
    const now = new Date();
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 999);
    const thisWeekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const dayStr = d.toISOString().split('T')[0];
      return { label: d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2), hasWorkout: workoutSessions.some(s => s.date === dayStr), isFuture: d > now };
    });
    const weekSessions = workoutSessions.filter(s => { const d = new Date(s.date); return d >= monday && d <= sunday; });
    const weeklyData: boolean[] = [];
    for (let i = 7; i >= 0; i--) {
      const wStart = new Date(now); wStart.setDate(now.getDate() - (i * 7)); wStart.setHours(0, 0, 0, 0);
      const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 6); wEnd.setHours(23, 59, 59, 999);
      weeklyData.push(workoutSessions.filter(s => { const d = new Date(s.date); return d >= wStart && d <= wEnd; }).length >= 3);
    }
    const thisWeekCount = thisWeekDays.filter(d => d.hasWorkout).length;
    let consecutiveWeeks = 0;
    for (let i = weeklyData.length - 1; i >= 0; i--) { if (weeklyData[i]) consecutiveWeeks++; else break; }
    return { weeks: consecutiveWeeks, thisWeekDays, thisWeekCount, weekSessions };
  };

  const getBodyCompStats = () => {
    if (bodyStats.length === 0) return null;
    const cur = bodyStats[0]; const prev = bodyStats.length > 1 ? bodyStats[1] : null;
    const weight = cur.weightKg != null ? Number(cur.weightKg) : null;
    const pbf = cur.pbf != null ? Number(cur.pbf) : null;
    const smm = cur.smm != null ? Number(cur.smm) : null;
    return { weight, pbf, smm, weightDelta: prev?.weightKg != null && weight != null ? weight - Number(prev.weightKg) : null, pbfDelta: prev?.pbf != null && pbf != null ? pbf - Number(prev.pbf) : null, smmDelta: prev?.smm != null && smm != null ? smm - Number(prev.smm) : null };
  };

  const getFatLossStatus = () => {
    if (bodyStats.length < 2) return 'hold';
    const cur = bodyStats[0]; const prev = bodyStats[1];
    const cw = cur.weightKg != null ? Number(cur.weightKg) : null; const cp = cur.pbf != null ? Number(cur.pbf) : null;
    const pw = prev.weightKg != null ? Number(prev.weightKg) : null; const pp = prev.pbf != null ? Number(prev.pbf) : null;
    if (cw == null || cp == null || pw == null || pp == null) return 'hold';
    const change = (cw * cp / 100) - (pw * pp / 100);
    return change < -0.5 ? 'improving' : change > 0.5 ? 'focus' : 'hold';
  };

  const getMuscleStatus = () => {
    if (bodyStats.length < 2) return 'steady';
    const cur = bodyStats[0].smm != null ? Number(bodyStats[0].smm) : null;
    const pre = bodyStats[1].smm != null ? Number(bodyStats[1].smm) : null;
    if (cur == null || pre == null) return 'steady';
    const change = cur - pre;
    return change > 0.5 ? 'strong' : change < -0.5 ? 'improve' : 'steady';
  };

  const getFirstName = () => { if (!user?.displayName) return 'there'; return user.displayName.split(' ')[0]; };

  if (loading || !minLoadDone) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-8">
        <div className="mb-10">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(16,185,129,0.15)" strokeWidth="6"/>
            <circle cx="32" cy="32" r="28" fill="none" stroke="#10b981" strokeWidth="6" strokeDasharray="176" strokeDashoffset="44" strokeLinecap="round" transform="rotate(-90 32 32)" style={{ animation: 'ftspin 1.4s linear infinite', transformOrigin: '32px 32px' }}/>
            <circle cx="32" cy="32" r="18" fill="none" stroke="rgba(52,211,153,0.12)" strokeWidth="5"/>
            <circle cx="32" cy="32" r="18" fill="none" stroke="#34d399" strokeWidth="5" strokeDasharray="113" strokeDashoffset="56" strokeLinecap="round" transform="rotate(-90 32 32)" style={{ animation: 'ftspin 1.8s linear infinite reverse', transformOrigin: '32px 32px' }}/>
          </svg>
          <style>{`@keyframes ftspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
        {loadingQuote ? (
          <div ref={quoteCardRef} style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1a2744 50%, #0f172a 100%)', borderRadius: '20px', border: '1px solid rgba(16,185,129,0.2)', padding: '32px 28px', maxWidth: '300px', width: '100%', textAlign: 'center' }}>
            <FitTrackLogoMark />
            <div style={{ width: '40px', height: '2px', background: 'linear-gradient(90deg, transparent, #10b981, transparent)', margin: '0 auto 20px', borderRadius: '1px' }} />
            <p style={{ color: '#f1f5f9', fontSize: '16px', fontWeight: 600, lineHeight: 1.5, marginBottom: '14px', fontStyle: 'italic' }}>"{loadingQuote.text}"</p>
            <p style={{ color: '#10b981', fontSize: '13px', fontWeight: 500, marginBottom: 0 }}>{loadingQuote.sub}</p>
            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p style={{ color: 'rgba(100,116,139,0.7)', fontSize: '10px', letterSpacing: '0.05em', margin: 0 }}>fittrack-nine-cyan.vercel.app</p>
            </div>
          </div>
        ) : <p className="text-slate-500 text-sm">Loading your data…</p>}
        {loadingQuote && (
          <button onClick={handleShareQuote} className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-slate-800 border border-slate-700 hover:border-emerald-500/40 rounded-full text-slate-400 hover:text-emerald-400 text-xs transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share as image
          </button>
        )}
        <div className="absolute bottom-10 text-slate-700 text-[10px] font-mono tracking-widest uppercase">FitTrack</div>
      </div>
    );
  }

  const suggestedWorkout = getSuggestedWorkout();
  const streakData = calculateStreak();
  const bodyCompStats = getBodyCompStats();
  const fatLossStatus = getFatLossStatus();
  const muscleStatus = getMuscleStatus();
  const currentTopic = insightTopics[insightIndex];

  const arc = (r: number, val: number) => { const c = 2 * Math.PI * r; return { dasharray: c, dashoffset: c * (1 - Math.min(1, Math.max(0, val))) }; };
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <div className="p-5 space-y-4">

        {totalComplete < 3 && (
          <div className="bg-slate-900 border border-blue-500/20 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2"><span className="text-blue-400 text-xs font-medium">Complete your FitTrack</span><span className="text-slate-400 text-xs">{totalComplete} of 3</span></div>
            <div className="h-1 bg-slate-800 rounded-full mb-3 overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.round((totalComplete / 3) * 100)}%` }} /></div>
            <div className="grid grid-cols-3 gap-2">
              {([{ key: 'workouts', label: 'Workouts', path: '/workouts' }, { key: 'body', label: 'Body', path: '/body' }, { key: 'labs', label: 'Labs', path: '/labs' }] as const).map(({ key, label, path }) => {
                const done = completeness[key];
                return <div key={key} onClick={() => !done && navigate(path)} className={`text-center py-2 px-1 rounded-lg border transition-colors ${done ? 'bg-blue-500/10 border-blue-500/30 cursor-default' : 'bg-slate-800 border-slate-700 cursor-pointer hover:border-blue-500/40'}`}><p className={`text-[11px] font-medium mb-0.5 ${done ? 'text-blue-400' : 'text-slate-300'}`}>{label}</p><p className={`text-[10px] ${done ? 'text-blue-500' : 'text-slate-500'}`}>{done ? '✓ Done' : key === 'labs' ? 'Upload PDF' : 'Add now'}</p></div>;
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold text-white">Hey, {getFirstName()} 👋</h1><p className="text-slate-500 text-xs mt-0.5">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
          <button onClick={() => navigate('/export')} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"><Download className="w-4 h-4 text-slate-400" /></button>
        </div>

        {/* Activity Rings */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-[108px] h-[108px]">
              <svg width="108" height="108" viewBox="0 0 108 108">
                <circle cx="54" cy="54" r="48" fill="none" stroke="rgba(255,55,95,0.14)" strokeWidth="8"/><circle cx="54" cy="54" r="48" fill="none" stroke="#ff375f" strokeWidth="8" strokeDasharray={arc(48, rings.train.pct / 100).dasharray} strokeDashoffset={arc(48, rings.train.pct / 100).dashoffset} strokeLinecap="round" transform="rotate(-90 54 54)"/>
                <circle cx="54" cy="54" r="37" fill="none" stroke="rgba(48,209,88,0.14)" strokeWidth="8"/><circle cx="54" cy="54" r="37" fill="none" stroke="#30d158" strokeWidth="8" strokeDasharray={arc(37, rings.move.pct / 100).dasharray} strokeDashoffset={arc(37, rings.move.pct / 100).dashoffset} strokeLinecap="round" transform="rotate(-90 54 54)"/>
                <circle cx="54" cy="54" r="26" fill="none" stroke="rgba(50,173,230,0.14)" strokeWidth="8"/><circle cx="54" cy="54" r="26" fill="none" stroke="#32ade6" strokeWidth="8" strokeDasharray={arc(26, rings.track.pct / 100).dasharray} strokeDashoffset={arc(26, rings.track.pct / 100).dashoffset} strokeLinecap="round" transform="rotate(-90 54 54)"/>
                <circle cx="54" cy="54" r="15" fill="none" stroke="rgba(249,115,22,0.14)" strokeWidth="8"/><circle cx="54" cy="54" r="15" fill="none" stroke="#f97316" strokeWidth="8" strokeDasharray={arc(15, rings.fuel.pct / 100).dasharray} strokeDashoffset={arc(15, rings.fuel.pct / 100).dashoffset} strokeLinecap="round" transform="rotate(-90 54 54)"/>
              </svg>
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              {[{ label: 'Steps', pct: rings.train.pct, sub: rings.train.label, color: '#ff375f' }, { label: 'Burned', pct: rings.move.pct, sub: rings.move.label, color: '#30d158' }, { label: 'Calories', pct: rings.track.pct, sub: rings.track.label, color: '#32ade6' }, { label: 'Sleep', pct: rings.fuel.pct, sub: rings.fuel.label, color: '#f97316' }].map(({ label, pct, sub, color }) => (
                <div key={label} className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} /><div className="flex-1 min-w-0"><div className="flex justify-between items-center"><span className="text-[11px] font-medium text-white">{label}</span><span className="text-[10px] font-mono" style={{ color }}>{Math.round(pct)}%</span></div><div className="text-[9px] text-slate-500 leading-tight truncate">{sub}</div><div className="h-0.5 bg-slate-800 rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} /></div></div></div>
              ))}
            </div>
          </div>
        </div>

        {/* Weekly mini rings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 cursor-pointer" onClick={() => navigate('/activity-calendar')}>
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">This Week</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-emerald-400">🔥 {streakData.weeks > 0 ? `${streakData.weeks}-wk streak` : `${streakData.thisWeekCount} done`}<span className="text-slate-600 ml-2">History →</span></span>
              <button
                onClick={e => { e.stopPropagation(); setShowWeeklyPoster(true); }}
                className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-500/40 rounded-lg text-emerald-400 text-[9px] font-mono transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Share
              </button>
            </div>
          </div>
          <div className="flex justify-between">
            {rings.weekDays.map((day, idx) => (
              <div key={day.dateStr} className="flex flex-col items-center gap-1">
                <svg width="28" height="28" viewBox="0 0 28 28" style={{ opacity: day.isFuture ? 0.2 : 1 }}>
                  <circle cx="14" cy="14" r="11.5" fill="none" stroke="rgba(255,55,95,0.15)" strokeWidth="4"/><circle cx="14" cy="14" r="11.5" fill="none" stroke="#ff375f" strokeWidth="4" strokeDasharray={arc(11.5, day.trainVal).dasharray} strokeDashoffset={arc(11.5, day.trainVal).dashoffset} strokeLinecap="round" transform="rotate(-90 14 14)"/>
                  <circle cx="14" cy="14" r="8" fill="none" stroke="rgba(48,209,88,0.15)" strokeWidth="3.5"/><circle cx="14" cy="14" r="8" fill="none" stroke="#30d158" strokeWidth="3.5" strokeDasharray={arc(8, day.moveVal).dasharray} strokeDashoffset={arc(8, day.moveVal).dashoffset} strokeLinecap="round" transform="rotate(-90 14 14)"/>
                  <circle cx="14" cy="14" r="5" fill="none" stroke="rgba(50,173,230,0.15)" strokeWidth="3"/><circle cx="14" cy="14" r="5" fill="none" stroke="#32ade6" strokeWidth="3" strokeDasharray={arc(5, day.trackVal).dasharray} strokeDashoffset={arc(5, day.trackVal).dashoffset} strokeLinecap="round" transform="rotate(-90 14 14)"/>
                  <circle cx="14" cy="14" r="2.5" fill="none" stroke="rgba(249,115,22,0.15)" strokeWidth="2.5"/><circle cx="14" cy="14" r="2.5" fill="none" stroke="#f97316" strokeWidth="2.5" strokeDasharray={arc(2.5, day.fuelVal).dasharray} strokeDashoffset={arc(2.5, day.fuelVal).dashoffset} strokeLinecap="round" transform="rotate(-90 14 14)"/>
                </svg>
                <span className={`text-[8px] font-mono ${day.isToday ? 'text-emerald-400' : 'text-slate-600'}`}>{dayLabels[idx]}</span>
                {day.isToday && <div className="w-1 h-1 rounded-full bg-emerald-400" />}
              </div>
            ))}
          </div>
        </div>

        {upcomingTests.length > 0 && <div onClick={() => navigate('/labs')} className="flex items-center justify-between border border-amber-500/25 rounded-xl px-4 py-3 cursor-pointer" style={{ background: 'rgba(245,158,11,0.08)' }}><span className="text-amber-400 text-sm">🔔 {upcomingTests.length} lab test{upcomingTests.length > 1 ? 's' : ''} due soon</span><span className="text-xs bg-amber-500 text-white rounded-full px-2 py-0.5 font-medium">View</span></div>}
        {muscleAlert && <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3"><span className="text-amber-400 text-sm">⚠️ {muscleAlert.group} day — {muscleAlert.daysSince} days since last session</span></div>}

        {bodyStats.length > 0 && (
          <button onClick={() => navigate('/body')} className="w-full text-left">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Body</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[{ label: 'Weight', value: bodyCompStats?.weight != null ? `${bodyCompStats.weight}` : '--', unit: 'kg', delta: bodyCompStats?.weightDelta, lowerIsBetter: true }, { label: 'Body fat', value: bodyCompStats?.pbf != null ? `${bodyCompStats.pbf}` : '--', unit: '%', delta: bodyCompStats?.pbfDelta, lowerIsBetter: true }, { label: 'Muscle', value: bodyCompStats?.smm != null ? `${bodyCompStats.smm}` : '--', unit: 'kg', delta: bodyCompStats?.smmDelta, lowerIsBetter: false }].map(({ label, value, unit, delta, lowerIsBetter }) => (
                <div key={label} className="bg-slate-900 rounded-lg p-3 border border-slate-800"><div className="text-slate-400 text-[10px] mb-1">{label}</div><div className="text-white font-semibold text-sm">{value} <span className="text-slate-500 text-[10px]">{unit}</span></div>{delta != null && <div className={`text-[10px] mt-0.5 ${(lowerIsBetter ? delta < 0 : delta > 0) ? 'text-emerald-400' : 'text-red-400'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}</div>}</div>
              ))}
            </div>
            <div className="flex gap-2">
              {[{ status: fatLossStatus, labels: { improving: 'Fat Loss: Improving', hold: 'Fat Loss: Hold', focus: 'Fat Loss: Focus' } }, { status: muscleStatus, labels: { strong: 'Muscle: Strong', steady: 'Muscle: Steady', improve: 'Muscle: Improve' } }].map(({ status, labels }) => (
                <span key={status} className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${(status === 'improving' || status === 'strong') ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : (status === 'hold' || status === 'steady') ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>{(labels as any)[status]}</span>
              ))}
            </div>
          </button>
        )}

        <div className="border-t border-slate-800/60" />

        {(aiInsights || isLoadingInsights) && (
          <div>
            {isLoadingInsights ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-2"><div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" /><span className="text-slate-400 text-sm">✦ Generating insights…</span></div>
            ) : aiInsights && (
              <div className={`${insightColors[currentTopic].bg} border ${insightColors[currentTopic].border} rounded-xl p-4`}>
                <div className="flex items-center justify-between mb-2"><span className="text-slate-400 text-[10px] font-bold tracking-wider uppercase">✦ AI Insight</span><div className="flex gap-1">{insightTopics.map((t, i) => <span key={t} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === insightIndex ? insightDotColors[t] : 'bg-slate-700'}`} />)}</div></div>
                <p className="text-slate-300 text-sm leading-relaxed">{aiInsights[currentTopic]}</p>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2"><span className={`text-[10px] font-bold tracking-wider uppercase ${insightColors[currentTopic].text}`}>{currentTopic.charAt(0).toUpperCase() + currentTopic.slice(1)}</span><button onClick={() => currentTopic === 'food' ? navigate('/food') : currentTopic === 'workout' ? navigate('/workouts') : currentTopic === 'labs' ? navigate('/labs') : navigate(`/ai-coach?topic=${currentTopic}`)} className="text-slate-500 text-xs hover:text-white transition-colors">{currentTopic === 'food' ? '· Open Food →' : currentTopic === 'workout' ? '· Open Workouts →' : currentTopic === 'labs' ? '· Open Labs →' : '· Ask more →'}</button></div>
                  <div className="flex items-center"><button onClick={() => setInsightIndex(p => p === 0 ? 2 : p - 1)} className="text-slate-500 hover:text-white px-2 text-lg leading-none">‹</button><button onClick={() => setInsightIndex(p => p === 2 ? 0 : p + 1)} className="text-slate-500 hover:text-white px-2 text-lg leading-none">›</button></div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-slate-800/60" />
        <div className="border-t border-slate-800/60" />

        {/* Daily Wellness */}
        <div>
          <div className="flex items-center justify-between mb-2"><span className="text-slate-500 text-[10px] uppercase tracking-wider font-mono">🔵 Track · Today</span><button onClick={() => navigate('/wellness')} className="text-[10px] font-mono text-blue-400">Wellness →</button></div>
          <div className="space-y-2 mb-2">
            {(() => { const waterHabit = habits.find(h => h.name?.toLowerCase().includes('water')); const goal = waterHabit?.targetValue || 8; return <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${waterCount > 0 ? 'bg-blue-500/8 border-blue-500/20' : 'bg-slate-900 border-slate-800'}`}><span className="text-base flex-shrink-0">💧</span><div className="flex-1 min-w-0"><div className="text-[11px] font-medium text-white">Water</div><div className="text-[9px] text-slate-500">{waterCount} / {goal} glasses</div><div className="h-0.5 bg-slate-800 rounded-full mt-1 overflow-hidden"><div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${Math.min(100, (waterCount / goal) * 100)}%` }} /></div></div><div className="flex items-center gap-1.5 flex-shrink-0"><button onClick={() => { const v = Math.max(0, waterCount - 1); saveWater(v); }} className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center justify-center">−</button><span className="text-xs font-mono text-white w-4 text-center">{waterCount}</span><button onClick={() => saveWater(waterCount + 1)} className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center justify-center">+</button>{savingWater && <div className="w-2.5 h-2.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />}</div></div>; })()}
            {(() => { const sleepHabit = habits.find(h => h.name?.toLowerCase().includes('sleep')); const goal = sleepHabit?.targetValue || 8; const pct = Math.min(100, (sleepHours / goal) * 100); const isGood = sleepHours >= goal; return <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${sleepHours > 0 ? 'bg-indigo-500/8 border-indigo-500/20' : 'bg-slate-900 border-slate-800'}`}><span className="text-base flex-shrink-0">😴</span><div className="flex-1 min-w-0"><div className="text-[11px] font-medium text-white">Sleep</div><div className="text-[9px] text-slate-500">{sleepHours} / {goal} hrs</div><div className="h-0.5 bg-slate-800 rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: isGood ? '#34d399' : '#818cf8' }} /></div></div><div className="flex items-center gap-1 flex-shrink-0"><button onClick={() => { const v = Math.max(0, parseFloat((sleepHours - 0.5).toFixed(1))); setSleepHours(v); setSleepInput(String(v)); }} className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center justify-center">−</button><input type="number" value={sleepInput} step="0.5" onChange={e => setSleepInput(e.target.value)} onBlur={() => { const v = Math.max(0, Math.min(24, parseFloat(sleepInput) || 0)); setSleepInput(String(v)); saveSleep(v); }} onKeyDown={e => { if (e.key === 'Enter') { const v = Math.max(0, Math.min(24, parseFloat(sleepInput) || 0)); setSleepInput(String(v)); saveSleep(v); (e.target as HTMLInputElement).blur(); } }} className="w-12 bg-slate-800 border border-slate-700 rounded-lg px-1 py-0.5 text-center text-[10px] font-mono text-white focus:outline-none focus:border-indigo-500" /><button onClick={() => { const v = parseFloat((sleepHours + 0.5).toFixed(1)); setSleepHours(v); setSleepInput(String(v)); }} className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center justify-center">+</button><button onClick={() => { const v = Math.max(0, Math.min(24, parseFloat(sleepInput) || 0)); setSleepInput(String(v)); saveSleep(v); }} className="w-6 h-6 bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/30 rounded-lg text-indigo-400 text-xs flex items-center justify-center transition-colors">✓</button>{savingSleep && <div className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" />}</div></div>; })()}
            {(() => { const stepsHabit = habits.find(h => h.name?.toLowerCase().includes('step')); const goal = stepsHabit?.targetValue || 8000; return <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${stepsCount > 0 ? 'bg-green-500/8 border-green-500/20' : 'bg-slate-900 border-slate-800'}`}><span className="text-base flex-shrink-0">🚶</span><div className="flex-1 min-w-0"><div className="text-[11px] font-medium text-white">Steps</div><div className="text-[9px] text-slate-500">{stepsCount.toLocaleString()} / {goal.toLocaleString()}</div><div className="h-0.5 bg-slate-800 rounded-full mt-1 overflow-hidden"><div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${Math.min(100, (stepsCount / goal) * 100)}%` }} /></div></div><div className="flex items-center gap-1 flex-shrink-0"><button onClick={() => { const v = Math.max(0, stepsCount - 1000); setStepsInput(String(v)); saveSteps(v); }} className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center justify-center">−</button><input type="number" value={stepsInput} onChange={e => setStepsInput(e.target.value)} onBlur={() => { const v = Math.max(0, parseInt(stepsInput) || 0); setStepsInput(String(v)); saveSteps(v); }} onKeyDown={e => { if (e.key === 'Enter') { const v = Math.max(0, parseInt(stepsInput) || 0); setStepsInput(String(v)); saveSteps(v); (e.target as HTMLInputElement).blur(); } }} className="w-14 bg-slate-800 border border-slate-700 rounded-lg px-1 py-0.5 text-center text-[10px] font-mono text-white focus:outline-none focus:border-green-500" /><button onClick={() => { const v = stepsCount + 1000; setStepsInput(String(v)); saveSteps(v); }} className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center justify-center">+</button><button onClick={() => { const v = Math.max(0, parseInt(stepsInput) || 0); setStepsInput(String(v)); saveSteps(v); }} className="w-6 h-6 bg-green-500/15 border border-green-500/30 hover:bg-green-500/30 rounded-lg text-green-400 text-xs flex items-center justify-center transition-colors">✓</button>{savingSteps && <div className="w-2.5 h-2.5 border border-green-400 border-t-transparent rounded-full animate-spin" />}</div></div>; })()}
          </div>
          {(() => {
            const customHabits = habits.filter(h => { const n = h.name?.toLowerCase() || ''; return !n.includes('water') && !n.includes('sleep') && !n.includes('step'); });
            if (customHabits.length === 0) return null;
            return <div className="grid grid-cols-2 gap-px bg-slate-800 rounded-xl overflow-hidden border border-slate-800">{customHabits.slice(0, 4).map(habit => { const done = habitsDoneToday[habit.id] || false; return <button key={habit.id} onClick={() => toggleHabit(habit.id)} className={`p-3 text-left transition-colors ${done ? 'bg-slate-900/60' : 'bg-slate-900'}`}><div className="flex justify-between items-start mb-1"><span className="text-lg">{habit.icon || '💪'}</span><div className={`w-4 h-4 rounded-full border flex items-center justify-center text-[8px] flex-shrink-0 ${done ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-600'}`}>{done ? '✓' : ''}</div></div><div className="text-[11px] font-medium text-white">{habit.name}</div><div className={`text-[9px] mt-0.5 ${done ? 'text-blue-400' : 'text-slate-500'}`}>{done ? 'Done ✓' : `Goal: ${habit.targetValue}${habit.targetUnit ? ' ' + habit.targetUnit : ''}`}</div></button>; })}</div>;
          })()}
          <div className="flex justify-between items-center mt-2"><span className="text-[9px] font-mono text-slate-600">{Object.values(habitsDoneToday).filter(Boolean).length} / {habits.length} done today</span>{habits.length > 7 && <button onClick={() => navigate('/wellness')} className="text-[9px] font-mono text-slate-500 hover:text-blue-400">+{habits.length - 7} more →</button>}</div>
        </div>

        <div className="border-t border-slate-800/60" />

        {/* Today's Workout */}
        <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
          <div className="flex items-center gap-2 mb-2"><Target className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400 text-[10px] font-bold tracking-wider uppercase">Today's Workout</span></div>
          {suggestedWorkout ? (<><div className="text-lg font-semibold text-white">{suggestedWorkout}</div><div className="text-xs text-slate-400 mt-0.5 mb-3">{workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.groups.join(', ')} · ~{workoutTemplates[suggestedWorkout as keyof typeof workoutTemplates]?.duration} min</div></>) : (<><div className="text-lg font-semibold text-white mb-1">Start your first workout</div><div className="text-xs text-slate-400 mb-3">Choose a template to get started</div></>)}
          <button onClick={() => suggestedWorkout === 'Running' ? navigate('/running-session') : navigate('/workout-session', { state: { template: suggestedWorkout?.toLowerCase().replace(' ', '') || '' } })} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">{suggestedWorkout ? `Start ${suggestedWorkout} →` : 'Choose Template →'}</button>
        </div>

        {/* Streak */}
        <div className="bg-slate-900 rounded-xl px-4 py-3 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-1"><span className="text-lg font-bold text-white">{streakData.weeks}</span><span className="text-xs text-slate-500">weeks streak</span></div>
            <div className="text-[10px] text-slate-600 mt-0.5">{streakData.thisWeekCount} done this week</div>
          </div>
          <div className="flex items-end gap-1.5">
            {streakData.thisWeekDays.map((day, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div className={`w-2 h-2 rounded-sm ${day.hasWorkout ? 'bg-emerald-500' : day.isFuture ? 'bg-slate-800' : 'bg-slate-700'}`} />
                <span className="text-[9px] text-slate-600">{day.label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      <button onClick={() => navigate('/ai-coach')} className="fixed bottom-24 left-6 w-14 h-14 rounded-full bg-emerald-500 shadow-lg flex items-center justify-center text-white text-xl z-40 hover:bg-emerald-600 transition-colors">✦</button>

      {/* Weekly Poster Modal */}
      <WeeklyPosterModal
        open={showWeeklyPoster}
        onClose={() => setShowWeeklyPoster(false)}
        weekSessions={streakData.weekSessions}
        weekStreak={streakData.weeks}
        thisWeekCount={streakData.thisWeekCount}
        thisWeekDays={streakData.thisWeekDays}
        rings={rings}
      />
    </div>
  );
}