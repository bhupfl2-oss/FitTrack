import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { X } from 'lucide-react';

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
}

const MUSCLE_MAP: Record<string, string[]> = {
  chest: ['bench press', 'incline bench', 'flat bench', 'dumbbell press', 'fly', 'chest dip', 'pushup', 'cable fly', 'push up'],
  shoulders: ['overhead press', 'lateral raise', 'front raise', 'arnold press', 'shoulder press'],
  triceps: ['tricep pushdown', 'skull crusher', 'overhead extension', 'close grip bench', 'tricep'],
  back: ['lat pulldown', 'pull up', 'chin up', 'row', 'deadlift', 'back extension', 'shrug', 'pulldown'],
  quads: ['squat', 'leg press', 'leg extension', 'lunge', 'hack squat', 'walking lunge'],
  hamstrings: ['romanian deadlift', 'leg curl', 'rdl'],
  glutes: ['hip thrust', 'glute bridge', 'bulgarian'],
  calves: ['calf raise', 'calf'],
  core: ['plank', 'crunch', 'ab wheel', 'russian twist', 'leg raise', 'mountain climber'],
  biceps: ['bicep curl', 'hammer curl', 'preacher curl', 'dumbbell curl', 'barbell curl'],
};

const computeMuscles = (exercises: WorkoutPosterModalProps['exercises'], template: string) => {
  const counts: Record<string, number> = {};
  const tl = template.toLowerCase();

  if (tl.includes('push')) {
    counts['chest'] = 0; counts['shoulders'] = 0; counts['triceps'] = 0;
  } else if (tl.includes('pull')) {
    counts['back'] = 0; counts['biceps'] = 0;
  } else if (tl.includes('leg') || tl.includes('lower')) {
    counts['quads'] = 0; counts['hamstrings'] = 0; counts['glutes'] = 0; counts['calves'] = 0;
  } else if (tl.includes('upper')) {
    counts['chest'] = 0; counts['back'] = 0; counts['shoulders'] = 0;
  }

  for (const ex of exercises) {
    const n = ex.name.toLowerCase();
    const validSets = ex.sets.filter(s => (parseInt(String(s.reps)) || 0) > 0).length || ex.sets.length;
    for (const [muscle, keywords] of Object.entries(MUSCLE_MAP)) {
      if (keywords.some(k => n.includes(k))) {
        counts[muscle] = (counts[muscle] || 0) + validSets;
        break;
      }
    }
  }

  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
};

export default function WorkoutPosterModal({
  open, onDone, template, sessionDate, exercises, durationMins, weekStreak,
}: WorkoutPosterModalProps) {
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const muscles = computeMuscles(exercises, template);
  const totalExercises = exercises.filter(ex =>
    ex.sets.some(s => (parseInt(String(s.reps)) || 0) > 0)
  ).length;
  const totalSets = exercises.reduce((sum, ex) =>
    sum + ex.sets.filter(s => (parseInt(String(s.reps)) || 0) > 0).length, 0
  );
  const maxSets = Math.max(...muscles.map(([, v]) => v), 1);

  const handleShare = async () => {
    if (!posterRef.current) return;
    setSharing(true);
    try {
      const canvas = await html2canvas(posterRef.current, {
        backgroundColor: '#0f172a',
        scale: 3,
        useCORS: true,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'fittrack-workout.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'FitTrack Workout' }); } catch {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'fittrack-workout.png';
          a.click();
          URL.revokeObjectURL(url);
        }
        setSharing(false);
      }, 'image/png');
    } catch (e) {
      console.error('Share failed:', e);
      setSharing(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setUserPhoto(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const formattedDate = new Date(sessionDate + 'T00:00:00')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const shortDate = new Date(sessionDate + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.92)',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '20px',
      overflowY: 'auto',
    }}>
      {/* Close */}
      <button
        onClick={onDone}
        style={{
          position: 'absolute', top: '20px', right: '20px',
          width: '36px', height: '36px', borderRadius: '50%',
          backgroundColor: 'rgba(255,255,255,0.08)', border: 'none',
          color: 'white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <X size={18} />
      </button>

      {/* Poster card */}
      <div
        ref={posterRef}
        style={{
          width: '300px',
          minHeight: '500px',
          backgroundColor: '#0f172a',
          borderRadius: '20px',
          overflow: 'hidden',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        {/* Background */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          {userPhoto ? (
            <>
              <img
                src={userPhoto}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {/* Dark overlay so text stays readable */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(180deg, rgba(15,23,42,0.65) 0%, rgba(15,23,42,0.82) 50%, rgba(15,23,42,0.96) 100%)',
              }} />
            </>
          ) : (
            <>
              {/* Fixed subtle line pattern — inline SVG, html2canvas safe */}
              <svg
                width="300" height="500"
                viewBox="0 0 300 500"
                xmlns="http://www.w3.org/2000/svg"
                style={{ position: 'absolute', inset: 0 }}
              >
                {/* Diagonal lines */}
                {Array.from({ length: 20 }).map((_, i) => (
                  <line
                    key={i}
                    x1={-50 + i * 30} y1="0"
                    x2={i * 30 + 200} y2="500"
                    stroke="#10b981" strokeWidth="0.6" opacity="0.07"
                  />
                ))}
                {/* Glow blob bottom right */}
                <ellipse cx="260" cy="420" rx="120" ry="100" fill="#10b981" opacity="0.04" />
                <ellipse cx="40" cy="80" rx="80" ry="60" fill="#10b981" opacity="0.03" />
              </svg>
            </>
          )}
        </div>

        {/* Content */}
        <div style={{
          position: 'relative', zIndex: 1,
          padding: '24px',
          display: 'flex', flexDirection: 'column',
          minHeight: '500px',
        }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            {/* Logo mark */}
            <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#10b981"/>
              <polyline points="7,24 16,8 25,24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="16" y1="8" x2="16" y2="24" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
            </svg>
            {/* Workout type pill */}
            <div style={{
              backgroundColor: 'rgba(16,185,129,0.18)',
              color: '#10b981',
              padding: '4px 12px', borderRadius: '20px',
              fontSize: '11px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {template}
            </div>
            {/* Short date */}
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 500 }}>
              {shortDate}
            </div>
          </div>

          {/* Date + divider */}
          <div style={{ marginBottom: '20px' }}>
            {durationMins ? (
              <>
                <div style={{ fontSize: '40px', fontWeight: 700, color: '#f1f5f9', lineHeight: 1, marginBottom: '6px' }}>
                  {durationMins}<span style={{ fontSize: '18px', color: '#64748b', marginLeft: '4px' }}>mins</span>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>{formattedDate}</div>
              </>
            ) : (
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#f1f5f9' }}>{formattedDate}</div>
            )}
            <div style={{ height: '1px', background: 'linear-gradient(90deg, rgba(16,185,129,0.4), transparent)', marginTop: '14px' }} />
          </div>

          {/* Muscles worked */}
          {muscles.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                fontSize: '10px', fontWeight: 600, color: '#475569',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '12px',
              }}>
                Muscles Worked
              </div>
              {muscles.slice(0, 5).map(([muscle, sets], idx) => {
                const barColor = idx < 2 ? '#ef4444' : '#f97316';
                const pct = (sets / maxSets) * 100;
                return (
                  <div key={muscle} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', textTransform: 'capitalize' }}>
                        {muscle}
                      </span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {sets} set{sets !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(30,41,59,0.9)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', backgroundColor: barColor,
                        width: `${pct}%`, borderRadius: '3px',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '16px' }}>
            {[
              { val: totalExercises, label: 'Exercises' },
              { val: totalSets, label: 'Sets' },
              { val: weekStreak ?? '—', label: 'Streak' },
            ].map(({ val, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#f1f5f9' }}>{val}</div>
                <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>

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
        {/* Photo upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '10px 20px', borderRadius: '10px',
            backgroundColor: userPhoto ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)',
            border: userPhoto ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)',
            color: userPhoto ? '#10b981' : '#e2e8f0',
            fontSize: '13px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          📷 {userPhoto ? 'Change photo' : 'Add your photo'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoUpload}
          style={{ display: 'none' }}
        />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleShare}
            disabled={sharing}
            style={{
              padding: '13px 28px', borderRadius: '12px',
              backgroundColor: '#10b981', border: 'none',
              color: 'white', fontSize: '14px', fontWeight: 600,
              cursor: sharing ? 'not-allowed' : 'pointer',
              opacity: sharing ? 0.7 : 1,
            }}
          >
            {sharing ? 'Sharing...' : 'Share poster'}
          </button>
          <button
            onClick={onDone}
            style={{
              padding: '13px 24px', borderRadius: '12px',
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#e2e8f0', fontSize: '14px', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}