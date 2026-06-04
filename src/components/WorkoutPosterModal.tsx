import { useRef, useState, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { X, Pencil, Check } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface AIMuscle {
  name: string;
  sets: number;
  category?: string;
}

interface WorkoutPosterModalProps {
  open: boolean;
  onDone: () => void;
  template: string;
  sessionDate: string;
  exercises: Array<{
    name: string;
    sets: Array<{ reps: string | number; weight: string | number }>;
  }>;
  durationMins?: number;
  weekStreak?: number;
  totalWeeklyKm?: number;
  sessionDocId?: string;
  userId?: string;
  aiMuscles?: AIMuscle[];
  caloriesBurned?: number;
}

const MUSCLE_MAP: Record<string, string[]> = {
  chest: ['bench press', 'incline bench', 'flat bench', 'dumbbell press', 'fly', 'chest dip', 'pushup', 'cable fly', 'push up'],
  shoulders: ['overhead press', 'lateral raise', 'front raise', 'arnold press', 'shoulder press'],
  triceps: ['tricep pushdown', 'skull crusher', 'overhead extension', 'close grip bench', 'tricep'],
  back: ['lat pulldown', 'pull up', 'chin up', 'row', 'deadlift', 'back extension', 'shrug', 'pulldown'],
  hamstrings: ['romanian deadlift', 'leg curl', 'rdl'],
  biceps: ['bicep curl', 'hammer curl', 'preacher curl', 'dumbbell curl', 'barbell curl'],
  quads: ['squat', 'leg press', 'leg extension', 'lunge', 'hack squat', 'walking lunge'],
  glutes: ['hip thrust', 'glute bridge', 'bulgarian'],
  calves: ['calf raise', 'calf'],
  core: ['plank', 'crunch', 'ab wheel', 'russian twist', 'leg raise', 'mountain climber'],
};

const computeMusclesFallback = (
  exercises: WorkoutPosterModalProps['exercises'],
  template: string
): Array<[string, number]> => {
  const counts: Record<string, number> = {};
  const tl = template.toLowerCase();
  if (tl.includes('push')) { counts['chest'] = 0; counts['shoulders'] = 0; counts['triceps'] = 0; }
  else if (tl.includes('pull')) { counts['back'] = 0; counts['biceps'] = 0; }
  else if (tl.includes('leg') || tl.includes('lower')) { counts['quads'] = 0; counts['hamstrings'] = 0; counts['glutes'] = 0; counts['calves'] = 0; }
  else if (tl.includes('upper')) { counts['chest'] = 0; counts['back'] = 0; counts['shoulders'] = 0; }

  for (const ex of exercises) {
    const n = ex.name.toLowerCase();
    const validSets = ex.sets.filter(s => (parseInt(String(s.reps)) || 0) > 0).length;
    if (validSets === 0) continue;
    for (const [muscle, keywords] of Object.entries(MUSCLE_MAP)) {
      if (keywords.some(k => n.includes(k))) {
        counts[muscle] = (counts[muscle] || 0) + validSets;
        break;
      }
    }
  }
  return Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
};

export default function WorkoutPosterModal({
  open, onDone, template, sessionDate, exercises,
  durationMins: durationMinsProp, weekStreak, totalWeeklyKm,
  sessionDocId, userId, aiMuscles, caloriesBurned: caloriesBurnedProp,
}: WorkoutPosterModalProps) {
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  // Duration edit state
  const [durationMins, setDurationMins] = useState<number | undefined>(durationMinsProp);
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationEditMins, setDurationEditMins] = useState(String(Math.floor(durationMinsProp ?? 0)));
  const [durationEditSecs, setDurationEditSecs] = useState(String(Math.round(((durationMinsProp ?? 0) % 1) * 60)));
  const [savingDuration, setSavingDuration] = useState(false);

  // Calories edit state
  const [caloriesBurned, setCaloriesBurned] = useState<number | undefined>(caloriesBurnedProp);
  const [editingCalories, setEditingCalories] = useState(false);
  const [caloriesInput, setCaloriesInput] = useState(String(caloriesBurnedProp ?? ''));
  const [savingCalories, setSavingCalories] = useState(false);

  // Sync calories from prop when AI analysis completes after the modal is already open
  useEffect(() => {
    if (caloriesBurnedProp != null && caloriesBurnedProp > 0 && !editingCalories) {
      setCaloriesBurned(caloriesBurnedProp);
      setCaloriesInput(String(caloriesBurnedProp));
    }
  }, [caloriesBurnedProp]);

  const posterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const musclesData: Array<[string, number]> = aiMuscles && aiMuscles.length > 0
    ? aiMuscles.map(m => [m.name, m.sets] as [string, number])
    : computeMusclesFallback(exercises, template);

  const isAIAnalyzed = !!(aiMuscles && aiMuscles.length > 0);

  const totalExercises = exercises.filter(ex =>
    ex.sets.some(s => (parseInt(String(s.reps)) || 0) > 0)
  ).length;
  const totalSets = exercises.reduce((sum, ex) =>
    sum + ex.sets.filter(s => (parseInt(String(s.reps)) || 0) > 0).length, 0
  );
  const maxSets = Math.max(...musclesData.map(([, v]) => v), 1);

  const saveDurationEdit = async () => {
    const m = parseInt(durationEditMins) || 0;
    const s = Math.min(59, parseInt(durationEditSecs) || 0);
    const newDuration = m + s / 60;
    setDurationMins(newDuration);
    setEditingDuration(false);
    if (sessionDocId && userId) {
      setSavingDuration(true);
      try {
        await updateDoc(doc(db, 'users', userId, 'workoutSessions', sessionDocId), { durationMins: newDuration });
      } catch (e) { console.error('Failed to save duration:', e); }
      finally { setSavingDuration(false); }
    }
  };

  const saveCaloriesEdit = async () => {
    const newVal = parseInt(caloriesInput) || 0;
    setCaloriesBurned(newVal);
    setEditingCalories(false);
    if (sessionDocId && userId) {
      setSavingCalories(true);
      try {
        await updateDoc(doc(db, 'users', userId, 'workoutSessions', sessionDocId), { caloriesBurned: newVal });
      } catch (e) { console.error('Failed to save calories:', e); }
      finally { setSavingCalories(false); }
    }
  };

  const durationLabel = (() => {
    if (!durationMins || durationMins < 1) return null;
    const m = Math.floor(durationMins);
    const s = Math.round((durationMins % 1) * 60);
    return s > 0 ? `${m}m ${s}s` : `${m} mins`;
  })();

  const handleShare = async () => {
    if (!posterRef.current) return;
    setSharing(true);
    try {
      const canvas = await html2canvas(posterRef.current, { backgroundColor: '#0f172a', scale: 3, useCORS: true, logging: false });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'fittrack-workout.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'FitTrack Workout' }); } catch {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'fittrack-workout.png'; a.click();
          URL.revokeObjectURL(url);
        }
        setSharing(false);
      }, 'image/png');
    } catch (e) { console.error('Share failed:', e); setSharing(false); }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const r = new FileReader(); r.onload = ev => setUserPhoto(ev.target?.result as string); r.readAsDataURL(file); }
  };

  const formattedDate = new Date(sessionDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDate = new Date(sessionDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const statsRow = [
    { val: totalExercises, label: 'Exercises' },
    { val: totalSets, label: 'Sets' },
    caloriesBurned && caloriesBurned > 0
      ? { val: caloriesBurned, label: 'kcal' }
      : totalWeeklyKm != null && totalWeeklyKm > 0
        ? { val: totalWeeklyKm.toFixed(1), label: 'km this week' }
        : { val: weekStreak ?? '—', label: 'Streak' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      <button onClick={onDone} style={{ position: 'absolute', top: '20px', right: '20px', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.08)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={18} />
      </button>

      {/* Poster */}
      <div ref={posterRef} style={{ width: '300px', minHeight: '500px', backgroundColor: '#0f172a', borderRadius: '20px', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          {userPhoto ? (
            <>
              <img src={userPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,23,42,0.65) 0%, rgba(15,23,42,0.82) 50%, rgba(15,23,42,0.96) 100%)' }} />
            </>
          ) : (
            <svg width="300" height="500" viewBox="0 0 300 500" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', inset: 0 }}>
              {Array.from({ length: 20 }).map((_, i) => <line key={i} x1={-50+i*30} y1="0" x2={i*30+200} y2="500" stroke="#10b981" strokeWidth="0.6" opacity="0.07" />)}
              <ellipse cx="260" cy="420" rx="120" ry="100" fill="#10b981" opacity="0.04" />
              <ellipse cx="40" cy="80" rx="80" ry="60" fill="#10b981" opacity="0.03" />
            </svg>
          )}
        </div>

        <div style={{ position: 'relative', zIndex: 1, padding: '24px', display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#10b981"/>
              <polyline points="7,24 16,8 25,24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="16" y1="8" x2="16" y2="24" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
            </svg>
            <div style={{ backgroundColor: 'rgba(16,185,129,0.18)', color: '#10b981', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{template}</div>
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 500 }}>{shortDate}</div>
          </div>

          {/* Duration / date */}
          <div style={{ marginBottom: '20px' }}>
            {durationLabel ? (
              <>
                <div style={{ fontSize: '40px', fontWeight: 700, color: '#f1f5f9', lineHeight: 1, marginBottom: '6px' }}>
                  {durationLabel.split(' ')[0]}
                  <span style={{ fontSize: '18px', color: '#64748b', marginLeft: '4px' }}>{durationLabel.split(' ').slice(1).join(' ')}</span>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>{formattedDate}</div>
              </>
            ) : (
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#f1f5f9' }}>{formattedDate}</div>
            )}
            <div style={{ height: '1px', background: 'linear-gradient(90deg, rgba(16,185,129,0.4), transparent)', marginTop: '14px' }} />
          </div>

          {/* Muscles */}
          {musclesData.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Muscles Worked</div>
                {isAIAnalyzed && <div style={{ fontSize: '9px', color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '20px', padding: '1px 6px' }}>✦ AI</div>}
                {!isAIAnalyzed && <div style={{ fontSize: '9px', color: '#475569', fontStyle: 'italic' }}>analyzing…</div>}
              </div>
              {musclesData.slice(0, 5).map(([muscle, sets], idx) => {
                const isOther = aiMuscles?.find(m => m.name === muscle)?.category === 'Other';
                const barColor = isOther ? '#64748b' : idx < 2 ? '#ef4444' : '#f97316';
                const pct = (sets / maxSets) * 100;
                return (
                  <div key={muscle} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: isOther ? '#94a3b8' : '#e2e8f0' }}>{muscle}{isOther ? ' *' : ''}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{sets} set{sets !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(30,41,59,0.9)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', backgroundColor: barColor, width: `${pct}%`, borderRadius: '3px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '16px' }}>
            {statsRow.map(({ val, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#f1f5f9' }}>{val}</div>
                <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'rgba(100,116,139,0.6)', letterSpacing: '0.05em' }}>fittrack-nine-cyan.vercel.app</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '300px' }}>

        {/* AI analysis status */}
        {!isAIAnalyzed && (
          <div style={{ width: '100%', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: '10px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid #10b981', borderTopColor: 'transparent', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: '11px', color: '#10b981' }}>Analyzing muscles & calories…</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        {isAIAnalyzed && caloriesBurned && caloriesBurned > 0 && (
          <div style={{ width: '100%', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: '10px', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>✦ AI Analysis complete</span>
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>~{caloriesBurned} kcal burned</span>
          </div>
        )}

        {/* Duration edit */}
        <div style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '10px 14px' }}>
          {editingDuration ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', flexShrink: 0 }}>Duration</span>
              <input type="number" min="0" value={durationEditMins} onChange={e => setDurationEditMins(e.target.value)}
                style={{ width: '52px', background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: 'white', padding: '4px 8px', fontSize: '13px', textAlign: 'center' }} />
              <span style={{ fontSize: '12px', color: '#64748b' }}>min</span>
              <input type="number" min="0" max="59" value={durationEditSecs} onChange={e => setDurationEditSecs(e.target.value)}
                style={{ width: '52px', background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: 'white', padding: '4px 8px', fontSize: '13px', textAlign: 'center' }} />
              <span style={{ fontSize: '12px', color: '#64748b' }}>sec</span>
              <button onClick={saveDurationEdit} disabled={savingDuration} style={{ marginLeft: 'auto', background: '#10b981', border: 'none', borderRadius: '6px', color: 'white', padding: '4px 10px', fontSize: '12px', cursor: savingDuration ? 'not-allowed' : 'pointer', opacity: savingDuration ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={12} /> {savingDuration ? '…' : 'Save'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Duration</span>
                <span style={{ fontSize: '13px', color: durationLabel ? '#f1f5f9' : '#475569', fontWeight: 500 }}>{durationLabel ?? 'not set'}</span>
                {savingDuration && <span style={{ fontSize: '10px', color: '#10b981' }}>saving…</span>}
              </div>
              <button onClick={() => { setDurationEditMins(String(Math.floor(durationMins ?? 0))); setDurationEditSecs(String(Math.round(((durationMins ?? 0) % 1) * 60))); setEditingDuration(true); }}
                style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '2px 6px' }}>
                <Pencil size={12} /> Edit
              </button>
            </div>
          )}
        </div>

        {/* Calories edit */}
        <div style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '10px 14px' }}>
          {editingCalories ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', flexShrink: 0 }}>Kcal Burned</span>
              <input type="number" min="0" value={caloriesInput} onChange={e => setCaloriesInput(e.target.value)}
                placeholder="kcal"
                style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: 'white', padding: '4px 8px', fontSize: '13px', textAlign: 'center' }} />
              <button onClick={saveCaloriesEdit} disabled={savingCalories} style={{ marginLeft: 'auto', background: '#f97316', border: 'none', borderRadius: '6px', color: 'white', padding: '4px 10px', fontSize: '12px', cursor: savingCalories ? 'not-allowed' : 'pointer', opacity: savingCalories ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={12} /> {savingCalories ? '…' : 'Save'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Kcal Burned</span>
                <span style={{ fontSize: '13px', color: caloriesBurned && caloriesBurned > 0 ? '#fb923c' : '#475569', fontWeight: 500 }}>
                  {caloriesBurned && caloriesBurned > 0 ? `${caloriesBurned} kcal` : 'not set'}
                </span>
                {savingCalories && <span style={{ fontSize: '10px', color: '#f97316' }}>saving…</span>}
              </div>
              <button onClick={() => { setCaloriesInput(String(caloriesBurned ?? '')); setEditingCalories(true); }}
                style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '2px 6px' }}>
                <Pencil size={12} /> Edit
              </button>
            </div>
          )}
        </div>

        {/* Photo */}
        <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', padding: '10px 20px', borderRadius: '10px', backgroundColor: userPhoto ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', border: userPhoto ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)', color: userPhoto ? '#10b981' : '#e2e8f0', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          📷 {userPhoto ? 'Change photo' : 'Add your photo'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button onClick={handleShare} disabled={sharing} style={{ flex: 1, padding: '13px', borderRadius: '12px', backgroundColor: '#10b981', border: 'none', color: 'white', fontSize: '14px', fontWeight: 600, cursor: sharing ? 'not-allowed' : 'pointer', opacity: sharing ? 0.7 : 1 }}>
            {sharing ? 'Sharing...' : 'Share poster'}
          </button>
          <button onClick={onDone} style={{ padding: '13px 24px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: '14px', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}