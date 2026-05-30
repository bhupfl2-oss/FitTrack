import { useState } from 'react';
import { useOnboarding } from '@/hooks/useOnboarding';

export default function OnboardingWizard() {
  const { completeOnboarding } = useOnboarding();
  const [step, setStep] = useState(0);

  const handleFinish = async (path: string) => {
    await completeOnboarding();
    window.location.href = path;
  };

  const STEPS = 3;

  const Dots = ({ active }: { active: number }) => (
    <div className="flex gap-1.5 justify-center mb-6">
      {Array.from({ length: STEPS }).map((_, i) => (
        <div key={i} className={`h-1.5 rounded-full transition-all ${i === active ? 'w-5 bg-emerald-500' : 'w-1.5 bg-slate-700'}`} />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">

        {/* ── STEP 0: Welcome ── */}
        {step === 0 && (
          <div className="flex flex-col">
            <Dots active={0} />
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mb-5">
                <span className="text-3xl">💪</span>
              </div>
              <h1 className="text-2xl font-semibold mb-2 leading-snug">Your health,<br />fully connected</h1>
              <p className="text-slate-400 text-sm leading-relaxed">The more you track, the smarter<br />your recommendations get</p>
            </div>

            <div className="flex flex-col gap-2 mb-6">
              {[
                { bg: 'bg-red-500/8 border-red-500/15',     icon: '🏋️', title: 'Train', sub: 'Workouts, AI coach, muscle rotation' },
                { bg: 'bg-green-500/8 border-green-500/15', icon: '🚶', title: 'Move', sub: 'Steps, runs, daily activity' },
                { bg: 'bg-blue-500/8 border-blue-500/15',   icon: '💧', title: 'Track', sub: 'Water, sleep, habits' },
                { bg: 'bg-orange-500/8 border-orange-500/15', icon: '🍽️', title: 'Fuel', sub: 'Nutrition, calories, macros' },
              ].map(({ bg, icon, title, sub }, i) => (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bg}`}>
                  <span className="text-xl">{icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="text-xs text-slate-400">{sub}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-emerald-500/8 border-emerald-500/15 mt-1">
                <span className="text-xl">✨</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-300">AI-powered insights</p>
                  <p className="text-xs text-emerald-400/70">Connects workouts · body · labs · food</p>
                </div>
              </div>
            </div>

            <button onClick={() => setStep(1)}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-medium transition-colors">
              Get started →
            </button>
          </div>
        )}

        {/* ── STEP 1: How it works ── */}
        {step === 1 && (
          <div className="flex flex-col">
            <Dots active={1} />
            <h2 className="text-xl font-semibold mb-1">How FitTrack works</h2>
            <p className="text-slate-400 text-sm mb-5 leading-relaxed">Four data sources. One complete picture.</p>

            <div className="flex flex-col gap-3 mb-5">
              {[
                {
                  bg: 'bg-red-500/8 border-red-500/15', icon: '🏋️', label: 'Workouts', badge: 'Routine',
                  badgeColor: 'bg-red-500/15 text-red-400',
                  text: 'Log strength, cardio, or tell the AI what you did. Tracks volume, progression, and muscle rotation automatically.',
                },
                {
                  bg: 'bg-emerald-500/8 border-emerald-500/15', icon: '📏', label: 'Body', badge: 'Trend',
                  badgeColor: 'bg-emerald-500/15 text-emerald-400',
                  text: 'Weight, body fat %, muscle mass over time. Shows if your training is actually changing your composition.',
                },
                {
                  bg: 'bg-amber-500/8 border-amber-500/15', icon: '🧪', label: 'Labs', badge: 'Alerts',
                  badgeColor: 'bg-amber-500/15 text-amber-400',
                  text: 'Upload a PDF lab report — we extract values automatically. Out-of-range markers are flagged and tracked over time.',
                },
                {
                  bg: 'bg-orange-500/8 border-orange-500/15', icon: '🍽️', label: 'Food', badge: 'Nutrition',
                  badgeColor: 'bg-orange-500/15 text-orange-400',
                  text: 'Describe meals in plain text or take a photo. AI estimates calories and macros. Goals are calculated from your profile.',
                },
              ].map(({ bg, icon, label, badge, badgeColor, text }) => (
                <div key={label} className={`rounded-xl border p-4 ${bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{icon}</span>
                    <span className="text-sm font-semibold text-white">{label}</span>
                    <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono ${badgeColor}`}>{badge}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>

            <div className="border-l-2 border-emerald-500/30 pl-3 mb-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Low energy + rising body fat + low Vitamin D might all be part of the same story.
                FitTrack connects the dots so you don't have to.
              </p>
            </div>

            {/* Export highlight */}
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3.5 flex items-center gap-3 mb-6">
              <span className="text-xl flex-shrink-0">📤</span>
              <div>
                <p className="text-sm font-semibold text-white">Export & share</p>
                <p className="text-xs text-slate-400 mt-0.5">Download last week or month as PDF or TXT — share with your doctor or gym coach</p>
              </div>
            </div>

            <button onClick={() => setStep(2)}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-medium transition-colors">
              Got it, let's go →
            </button>
          </div>
        )}

        {/* ── STEP 2: Where to start ── */}
        {step === 2 && (
          <div className="flex flex-col">
            <Dots active={2} />
            <h2 className="text-xl font-semibold mb-1">Where do you want to start?</h2>
            <p className="text-slate-400 text-sm mb-6">Pick one — you can always do the others later</p>

            <div className="flex flex-col gap-3 mb-4">
              {[
                {
                  icon: '👤',
                  title: 'Set up your profile',
                  sub: 'Name, goal, fitness focus, diet — personalizes everything',
                  path: '/profile',
                  highlight: true,
                  border: 'border-emerald-500/25 bg-emerald-500/5',
                  badge: '⭐ Recommended first',
                },
                {
                  icon: '🏋️',
                  title: 'Log a workout',
                  sub: 'Start with Push, Pull, Legs, Running or custom',
                  path: '/workouts',
                  border: 'border-slate-700 bg-slate-900',
                },
                {
                  icon: '📏',
                  title: 'Add body measurements',
                  sub: 'Weight, body fat %, muscle mass — start your trend',
                  path: '/body',
                  border: 'border-slate-700 bg-slate-900',
                },
                {
                  icon: '🧪',
                  title: 'Upload a lab report',
                  sub: 'Drop a PDF — we extract all values automatically',
                  path: '/labs/upload',
                  border: 'border-slate-700 bg-slate-900',
                },
                {
                  icon: '🍽️',
                  title: 'Log food',
                  sub: 'Describe what you ate or take a photo',
                  path: '/food',
                  border: 'border-slate-700 bg-slate-900',
                },
                {
                  icon: '📤',
                  title: 'Export my health data',
                  sub: 'Download workouts, food or labs to share with your doctor or coach',
                  path: '/export',
                  border: 'border-slate-700 bg-slate-900',
                },
              ].map(({ icon, title, sub, path, border, badge }) => (
                <button key={path} onClick={() => handleFinish(path)}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all hover:scale-[1.01] text-left ${border}`}>
                  <span className="text-2xl flex-shrink-0">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-white">{title}</p>
                      {badge && <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">{badge}</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                  </div>
                  <span className="text-slate-600 text-lg flex-shrink-0">›</span>
                </button>
              ))}
            </div>

            <button onClick={() => handleFinish('/')}
              className="w-full text-slate-500 py-2 text-sm hover:text-slate-300 transition-colors">
              Skip, take me to the app
            </button>
          </div>
        )}

      </div>
    </div>
  );
}