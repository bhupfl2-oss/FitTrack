import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const SLIDES = [
  { id: 'hero' },
  { id: 'workouts' },
  { id: 'nutrition' },
  { id: 'body' },
  { id: 'ai' },
];

const ACCENT = [
  { bg: 'linear-gradient(135deg,#22c55e,#16a34a)', shadow: '0 8px 32px rgba(34,197,94,0.35)' },
  { bg: 'linear-gradient(135deg,#6366f1,#4f46e5)', shadow: '0 8px 32px rgba(99,102,241,0.4)' },
  { bg: 'linear-gradient(135deg,#f59e0b,#d97706)', shadow: '0 8px 32px rgba(245,158,11,0.4)' },
  { bg: 'linear-gradient(135deg,#14b8a6,#0d9488)', shadow: '0 8px 32px rgba(20,184,166,0.4)' },
  { bg: 'linear-gradient(135deg,#a855f7,#7c3aed)', shadow: '0 8px 32px rgba(168,85,247,0.4)' },
];

// ── Logo (reads from /public/logo.svg) ──────────────────────────
function Logo({ size = 44, radius = 13 }: { size?: number; radius?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: radius,
        background: 'linear-gradient(135deg,#22c55e,#16a34a)',
        boxShadow: '0 0 24px rgba(34,197,94,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <img src="/logo.svg" alt="FitTrack" style={{ width: size * 0.6, height: size * 0.6 }} />
    </div>
  );
}

// ── Google icon ──────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <div style={{
      width: 20, height: 20, background: 'white', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <svg width="13" height="13" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    </div>
  );
}

// ── SLIDE 0: Hero ────────────────────────────────────────────────
function SlideHero() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#07070f', overflow: 'hidden' }}>
      {/* Glow bg */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 340px 300px at 50% 38%, rgba(34,197,94,0.16) 0%, transparent 65%)',
      }} />
      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.024) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.024) 1px,transparent 1px)',
        backgroundSize: '28px 28px',
        maskImage: 'linear-gradient(to bottom,transparent,rgba(0,0,0,0.5) 20%,rgba(0,0,0,0.5) 80%,transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom,transparent,rgba(0,0,0,0.5) 20%,rgba(0,0,0,0.5) 80%,transparent)',
      }} />

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 2, height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '0 28px 120px',
        gap: 0,
      }}>
        {/* Animated rings */}
        <div style={{ position: 'relative', width: 160, height: 160, marginBottom: 28 }}>
          {[
            { size: 160, color: 'rgba(34,197,94,0.12)', dur: '22s', dir: 'normal' as const, dotColor: 'rgba(34,197,94,0.7)', dotGlow: 'rgba(34,197,94,0.8)' },
            { size: 120, color: 'rgba(34,197,94,0.2)',  dur: '15s', dir: 'reverse' as const, dotColor: '#22c55e', dotGlow: 'rgba(34,197,94,1)' },
            { size: 80,  color: 'rgba(34,197,94,0.32)', dur: '9s',  dir: 'normal' as const, dotColor: '#4ade80', dotGlow: 'rgba(74,222,128,1)' },
          ].map((r, i) => (
            <div key={i} style={{
              position: 'absolute', borderRadius: '50%',
              width: r.size, height: r.size,
              border: `1px solid ${r.color}`,
              top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              animation: `ft-spin ${r.dur} linear infinite ${r.dir}`,
            }}>
              <div style={{
                position: 'absolute', width: 6, height: 6, borderRadius: '50%',
                background: r.dotColor,
                boxShadow: `0 0 10px ${r.dotGlow}`,
                top: -3, left: '50%', transform: 'translateX(-50%)',
              }} />
            </div>
          ))}
          {/* Logo centre */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          }}>
            <Logo size={56} radius={18} />
          </div>
        </div>

        <p style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.28)', marginBottom: 10, textAlign: 'center',
        }}>FitTrack</p>

        <p style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: 28, fontWeight: 800,
          letterSpacing: '-0.02em', lineHeight: 1.18,
          textAlign: 'center', marginBottom: 10, color: 'white',
        }}>
          Track your body.<br />
          <span style={{
            background: 'linear-gradient(90deg,#22c55e,#4ade80)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>Own your progress.</span>
        </p>

        <p style={{
          fontSize: 12, color: 'rgba(255,255,255,0.32)',
          textAlign: 'center', lineHeight: 1.65,
          maxWidth: 220, margin: '0 auto',
        }}>AI-powered health tracking for every workout, meal, and milestone.</p>
      </div>
    </div>
  );
}

// ── SLIDE 1: Workouts ────────────────────────────────────────────
function SlideWorkouts() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0f0f1e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        position: 'relative', height: 300, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(160deg,#0f0f1e 0%,#0a0a14 100%)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 280px 200px at 160px 60px,rgba(99,102,241,0.25) 0%,transparent 65%)',
        }} />
        <div style={{
          position: 'relative', zIndex: 2, width: 260,
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Push Day · Jun 3</span>
            <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', borderRadius: 99, padding: '3px 9px' }}>72m 52s</span>
          </div>
          {[
            { name: 'Incline DB Press', sets: '4 sets', weight: '45kg', color: '#818cf8' },
            { name: 'Flat DB Press',    sets: '3 sets', weight: '45kg', color: '#a5b4fc' },
            { name: 'Lateral Raise',    sets: '3 sets', weight: '20kg', color: '#c7d2fe' },
            { name: 'Triceps Pushdown', sets: '3 sets', weight: '40kg', color: '#e0e7ff' },
          ].map((ex, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: ex.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1 }}>{ex.name}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginRight: 6 }}>{ex.sets}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#818cf8' }}>{ex.weight}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {[{ val: '10', lbl: 'EXERCISES' }, { val: '27', lbl: 'SETS' }, { val: '350', lbl: 'KCAL' }].map((s, i) => (
              <div key={i} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#818cf8' }}>{s.val}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1, letterSpacing: '0.05em' }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '20px 28px 0' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', borderRadius: 99, padding: '4px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          🏋️ Workouts
        </div>
        <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>Log every set.<br />Track every PR.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>Detailed exercise logging with weights, reps, and auto calorie burn calculation.</div>
      </div>
    </div>
  );
}

// ── SLIDE 2: Nutrition ───────────────────────────────────────────
function SlideNutrition() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0f0d08', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        position: 'relative', height: 300, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(160deg,#0f0d08 0%,#0a0a0f 100%)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 280px 200px at 160px 60px,rgba(245,158,11,0.22) 0%,transparent 65%)',
        }} />
        <div style={{ position: 'relative', zIndex: 2, width: 260 }}>
          {/* Calorie ring */}
          <div style={{ position: 'relative', width: 90, height: 90, margin: '0 auto 14px' }}>
            <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7"/>
              <circle cx="45" cy="45" r="38" fill="none" stroke="#f59e0b" strokeWidth="7"
                strokeDasharray="218" strokeDashoffset="54" strokeLinecap="round"/>
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1 }}>1827</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>KCAL</div>
            </div>
          </div>
          {/* Macro bars */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: '142g', lbl: 'PROTEIN', pct: '72%', color: '#ef4444', text: '#f87171' },
              { val: '198g', lbl: 'CARBS',   pct: '58%', color: '#f59e0b', text: '#fbbf24' },
              { val: '52g',  lbl: 'FAT',     pct: '40%', color: '#8b5cf6', text: '#a78bfa' },
            ].map((m, i) => (
              <div key={i} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginBottom: 6, overflow: 'hidden' }}>
                  <div style={{ width: m.pct, height: '100%', borderRadius: 2, background: m.color }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: m.text }}>{m.val}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1, letterSpacing: '0.05em' }}>{m.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '20px 28px 0' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', borderRadius: 99, padding: '4px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          🍽️ Nutrition
        </div>
        <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>Calories, macros,<br />every meal.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>AI-powered food logging with full macro breakdown — protein, carbs, fat, and fibre.</div>
      </div>
    </div>
  );
}

// ── SLIDE 3: Body Comp ───────────────────────────────────────────
function SlideBody() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#090f0e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        position: 'relative', height: 300, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(160deg,#090f0e 0%,#07090f 100%)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 280px 200px at 160px 60px,rgba(20,184,166,0.22) 0%,transparent 65%)',
        }} />
        <div style={{
          position: 'relative', zIndex: 2, width: 260,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20, padding: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Body Composition</div>
          {[
            { name: 'Weight',      val: '74.2 kg', trend: '↓ 0.8', color: '#2dd4bf', trendColor: '#2dd4bf' },
            { name: 'Body Fat %',  val: '18.4%',   trend: '↓ 0.3', color: '#f472b6', trendColor: '#2dd4bf' },
            { name: 'Muscle (SMM)',val: '33.1 kg',  trend: '↑ 0.4', color: '#34d399', trendColor: '#2dd4bf' },
            { name: 'Visceral Fat',val: '6',        trend: '→',     color: '#fb923c', trendColor: 'rgba(255,255,255,0.3)' },
          ].map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: i < 3 ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: m.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{m.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>{m.val}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: m.trendColor }}>{m.trend}</span>
              </div>
            </div>
          ))}
          {/* Sparkline */}
          <div style={{ marginTop: 14 }}>
            <svg viewBox="0 0 228 36" fill="none" style={{ width: '100%', height: 36 }}>
              <polyline points="0,28 38,24 76,26 114,20 152,16 190,18 228,12" stroke="rgba(45,212,191,0.25)" strokeWidth="1" fill="none"/>
              <polyline points="0,28 38,24 76,26 114,20 152,16 190,18 228,12" stroke="#2dd4bf" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="228" cy="12" r="3.5" fill="#2dd4bf"/>
            </svg>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '20px 28px 0' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(45,212,191,0.15)', color: '#2dd4bf', borderRadius: 99, padding: '4px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          📏 Body Composition
        </div>
        <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>Beyond the scale.<br />Know your body.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>Track weight, muscle mass, body fat, and visceral fat — and watch trends over time.</div>
      </div>
    </div>
  );
}

// ── SLIDE 4: AI Coach ────────────────────────────────────────────
function SlideAI() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0e0914', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        position: 'relative', height: 300, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(160deg,#0e0914 0%,#08070f 100%)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 280px 200px at 160px 60px,rgba(168,85,247,0.22) 0%,transparent 65%)',
        }} />
        <div style={{ position: 'relative', zIndex: 2, width: 260, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* User msg */}
          <div style={{ display: 'flex', flexDirection: 'row-reverse', gap: 9, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>
            <div style={{ maxWidth: 190, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px 4px 14px 14px', padding: '10px 12px', fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.6)' }}>
              How should I adjust my diet this week? I've been training hard.
            </div>
          </div>
          {/* AI msg */}
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <Logo size={28} radius={50} />
            <div style={{ maxWidth: 190, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '4px 14px 14px 14px', padding: '10px 12px', fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
              Based on your 4 sessions this week and 1,650 kcal avg, bump protein to 160g and add 200 kcal on training days. Your SMM trend is positive — keep it up. 💪
            </div>
          </div>
          {/* Typing indicator */}
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <Logo size={28} radius={50} />
            <div style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '4px 14px 14px 14px', padding: '12px 14px', display: 'flex', gap: 4, alignItems: 'center' }}>
              {[0, 0.2, 0.4].map((delay, i) => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#a855f7', animation: `ft-blink 1.2s ${delay}s infinite` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '20px 28px 0' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(168,85,247,0.15)', color: '#c084fc', borderRadius: 99, padding: '4px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          🤖 AI Coach
        </div>
        <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>Your personal<br />health advisor.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>Ask anything — get personalised advice based on your actual workouts, food, and labs.</div>
      </div>
    </div>
  );
}

// ── Main Login component ─────────────────────────────────────────
export default function Login() {
  const { user, loading, signIn } = useAuth();
  const location = useLocation();
  const [current, setCurrent] = useState(0);

  // Auto-advance every 3s
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(c => (c + 1) % SLIDES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  if (user) {
    const from = (location.state as any)?.from || '/';
    return <Navigate to={from} replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  const accent = ACCENT[current];

  return (
    <>
      {/* Keyframe animations injected once */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes ft-spin {
          from { transform: translate(-50%,-50%) rotate(0deg); }
          to   { transform: translate(-50%,-50%) rotate(360deg); }
        }
        @keyframes ft-blink {
          0%, 80%, 100% { opacity: 0.2; transform: scale(1); }
          40%            { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>

      <div style={{
        minHeight: '100vh',
        background: '#06060c',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Phone shell */}
        <div style={{
          width: 360, height: 720,
          borderRadius: 44, overflow: 'hidden', position: 'relative',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 48px 96px rgba(0,0,0,0.8)',
          background: '#07070f',
          maxWidth: '100vw',
          maxHeight: '100vh',
        }}>

          {/* Carousel track */}
          <div style={{
            display: 'flex',
            width: `${SLIDES.length * 360}px`,
            height: '100%',
            transform: `translateX(-${current * 360}px)`,
            transition: 'transform 0.7s cubic-bezier(0.77,0,0.175,1)',
          }}>
            {SLIDES.map((slide) => (
              <div key={slide.id} style={{ width: 360, height: '100%', flexShrink: 0 }}>
                {slide.id === 'hero'      && <SlideHero />}
                {slide.id === 'workouts'  && <SlideWorkouts />}
                {slide.id === 'nutrition' && <SlideNutrition />}
                {slide.id === 'body'      && <SlideBody />}
                {slide.id === 'ai'        && <SlideAI />}
              </div>
            ))}
          </div>

          {/* Dot indicators */}
          <div style={{
            position: 'absolute', bottom: 142, left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: 6, zIndex: 20,
          }}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                style={{
                  width: i === current ? 18 : 5, height: 5,
                  borderRadius: 99, border: 'none', cursor: 'pointer', padding: 0,
                  background: i === current ? 'white' : 'rgba(255,255,255,0.2)',
                  transition: 'all 0.4s ease',
                }}
              />
            ))}
          </div>

          {/* Sign-in bar */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: '12px 24px 40px',
            background: 'linear-gradient(to top,rgba(7,7,15,1) 60%,transparent)',
            zIndex: 30,
          }}>
            <p style={{
              textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.2)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              marginBottom: 10, fontWeight: 600,
            }}>Sign in with</p>

            {/* Google button */}
            <button
              onClick={signIn}
              style={{
                width: '100%', height: 52, borderRadius: 16, border: 'none',
                background: accent.bg, boxShadow: accent.shadow,
                color: 'white', cursor: 'pointer',
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                transition: 'opacity 0.2s',
                marginBottom: 8,
              }}
              onMouseDown={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseUp={e => (e.currentTarget.style.opacity = '1')}
            >
              <GoogleIcon />
              Google
            </button>

            {/* Future providers row */}
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Apple — inactive, ready for Capacitor */}
              <button
                disabled
                style={{
                  flex: 1, height: 44, borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(255,255,255,0.25)', cursor: 'not-allowed',
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                  fontSize: 12, fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="rgba(255,255,255,0.25)">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                Apple
              </button>

              {/* Placeholder for more */}
              <button
                disabled
                style={{
                  flex: 1, height: 44, borderRadius: 14,
                  border: '1px dashed rgba(255,255,255,0.08)',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.15)', cursor: 'not-allowed',
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                  fontSize: 11, fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>+</span> More soon
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}