import { useState } from 'react';
import { useOnboarding } from '@/hooks/useOnboarding';

const STEPS = 4;

export default function OnboardingWizard() {
  const { saveProfile, completeOnboarding } = useOnboarding();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    name: '', age: '', gender: 'Male',
    heightCm: '', targetWeightKg: '', goal: 'Lose body fat',
  });

  const next = () => setStep(s => Math.min(s + 1, STEPS - 1));

  const handleSaveProfile = async () => {
    await saveProfile({
      name: profile.name,
      age: Number(profile.age) || 0,
      gender: profile.gender,
      heightCm: Number(profile.heightCm) || 0,
      targetWeightKg: Number(profile.targetWeightKg) || 0,
      goal: profile.goal,
    });
    next();
  };

  const handleFinish = async (path: string) => {
    await completeOnboarding();
    window.location.href = path;
  };

  const Dots = ({ active }: { active: number }) => (
    <div className="flex gap-1.5 justify-center mb-6">
      {Array.from({ length: STEPS }).map((_, i) => (
        <div key={i} className={`h-1.5 rounded-full transition-all ${i === active ? 'w-5 bg-blue-500' : 'w-1.5 bg-slate-700'}`} />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">

        {step === 0 && (
          <div className="flex flex-col">
            <Dots active={0} />
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-5">
                <span className="text-2xl">💙</span>
              </div>
              <h1 className="text-2xl font-semibold mb-2 leading-snug">Your health,<br />fully connected</h1>
              <p className="text-slate-400 text-sm leading-relaxed">The more you track, the smarter<br />your recommendations get</p>
            </div>
            <div className="flex flex-col gap-2 mb-6">
              {[
                { bg: 'bg-blue-500/10 border-blue-500/20', icon: '🏋️', title: 'Log workouts', sub: 'Templates, custom exercises, running' },
                { bg: 'bg-emerald-500/10 border-emerald-500/20', icon: '📏', title: 'Track body composition', sub: 'Weight, PBF, SMM, visceral fat + more' },
                { bg: 'bg-amber-500/10 border-amber-500/20', icon: '🧪', title: 'Upload lab reports', sub: 'Auto-read from PDF, flag out-of-range' },
              ].map(({ bg, icon, title, sub }, i) => (
                <div key={i}>
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bg}`}>
                    <span className="text-xl">{icon}</span>
                    <div>
                      <p className="text-sm font-medium text-white">{title}</p>
                      <p className="text-xs text-slate-400">{sub}</p>
                    </div>
                  </div>
                  {i < 2 && <div className="flex justify-center my-1"><span className="text-slate-700 text-xs">↓</span></div>}
                </div>
              ))}
              <div className="mt-1 flex items-center gap-3 px-4 py-3 rounded-xl border bg-blue-600/10 border-blue-500/30">
                <span className="text-xl">✨</span>
                <div>
                  <p className="text-sm font-medium text-blue-300">Personalized insights</p>
                  <p className="text-xs text-blue-400/70">Recommendations built around you</p>
                </div>
              </div>
            </div>
            <button onClick={next} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium transition-colors">
              Get started →
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col">
            <Dots active={1} />
            <h2 className="text-xl font-semibold mb-1">Set up your profile</h2>
            <p className="text-slate-400 text-sm mb-6">Personalizes your Home dashboard and goal tracking</p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Name</label>
                <input type="text" placeholder="Your name" value={profile.name}
                  onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Age</label>
                  <input type="number" placeholder="32" value={profile.age}
                    onChange={e => setProfile(p => ({ ...p, age: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Gender</label>
                  <select value={profile.gender} onChange={e => setProfile(p => ({ ...p, gender: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500">
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Height (cm)</label>
                  <input type="number" placeholder="175" value={profile.heightCm}
                    onChange={e => setProfile(p => ({ ...p, heightCm: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Target weight (kg)</label>
                  <input type="number" placeholder="75" value={profile.targetWeightKg}
                    onChange={e => setProfile(p => ({ ...p, targetWeightKg: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Primary goal</label>
                <select value={profile.goal} onChange={e => setProfile(p => ({ ...p, goal: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500">
                  <option>Lose body fat</option>
                  <option>Build muscle</option>
                  <option>Improve fitness</option>
                  <option>Track health markers</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-6">
              <button onClick={handleSaveProfile} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium transition-colors">Continue</button>
              <button onClick={next} className="w-full text-slate-500 py-2 text-sm hover:text-slate-300 transition-colors">Skip for now</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col">
            <Dots active={2} />
            <h2 className="text-xl font-semibold mb-1">Three inputs, one picture</h2>
            <p className="text-slate-400 text-sm mb-5 leading-relaxed">FitTrack works best when all three are filled in. Here is why each one matters.</p>
            <div className="flex flex-col gap-3 mb-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🏋️</span>
                  <span className="text-sm font-medium text-blue-300">Workouts</span>
                  <span className="ml-auto text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">Routine</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">Tracks training load, rest patterns, and progression. Powers the what should I do today suggestion.</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">📏</span>
                  <span className="text-sm font-medium text-emerald-300">Body composition</span>
                  <span className="ml-auto text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Trend</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">Beyond weight — PBF, SMM, visceral fat over time. Shows if workouts are actually changing your body.</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🧪</span>
                  <span className="text-sm font-medium text-amber-300">Lab reports</span>
                  <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Alerts</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">Upload a PDF — we read the values automatically. Out-of-range markers are flagged. Vitamins, hormones, cholesterol tracked over time.</p>
              </div>
            </div>
            <div className="border-l-2 border-blue-500/40 pl-3 mb-6">
              <p className="text-xs text-slate-400 leading-relaxed">All three together let FitTrack connect the dots — low energy, rising body fat, and a vitamin D deficiency might all be part of the same story.</p>
            </div>
            <button onClick={next} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium transition-colors">
              Got it, lets go →
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col">
            <Dots active={3} />
            <h2 className="text-xl font-semibold mb-1">What do you want to do first?</h2>
            <p className="text-slate-400 text-sm mb-6">Pick one — you can always come back to the others</p>
            <div className="flex flex-col gap-3 mb-4">
              {[
                { icon: '👤', title: 'Complete your profile', sub: 'Name, age, goal — personalizes everything', path: '/profile', border: 'border-slate-500/20 hover:border-slate-500/40' },
                { icon: '🏋️', title: 'Log a workout', sub: 'Start with Push, Pull, Legs, or custom', path: '/workouts', border: 'border-blue-500/20 hover:border-blue-500/40' },
                { icon: '📏', title: 'Add body measurements', sub: 'Weight, PBF, SMM — start your trend', path: '/body', border: 'border-emerald-500/20 hover:border-emerald-500/40' },
                { icon: '🧪', title: 'Upload a lab report', sub: 'Drop a PDF — we extract everything', path: '/labs', border: 'border-amber-500/20 hover:border-amber-500/40' },
              ].map(({ icon, title, sub, path, border }) => (
                <button key={path} onClick={() => handleFinish(path)}
                  className={`flex items-center gap-3 px-4 py-4 rounded-xl border bg-slate-900 transition-colors text-left ${border}`}>
                  <span className="text-2xl">{icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                  </div>
                  <span className="text-slate-600 text-lg">›</span>
                </button>
              ))}
            </div>
            <button onClick={() => handleFinish('/')} className="w-full text-slate-500 py-2 text-sm hover:text-slate-300 transition-colors">
              Skip, take me to the app
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
