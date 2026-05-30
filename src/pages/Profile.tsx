import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { bumpDataVersion } from '@/lib/dataVersion';
import { calculateNutritionGoals } from '@/lib/calculateNutritionGoals';
import { ensureDefaultHabits } from '@/lib/defaultHabits';
import { getDocs, collection, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

interface ProfileData {
  name: string;
  dob: string;
  gender: string;
  heightCm: number | null;
  city: string;
  foodPreference: string;
  allergies: string;
  sleepTarget: string;
  sleepTargetCustom: string;
  activityLevel: string;
  activityLevelCustom: string;
  primaryGoal: string;
  primaryGoalCustom: string;
  chronicConditions: string[];
  chronicConditionsOther: string;
  fitnessFocus: string[];
  fitnessTarget: string;
}

const GENDERS = ['Male', 'Female', 'Other'];
const FOOD_PREFS = ['Veg', 'Egg', 'Non-veg', 'Vegan'];
const SLEEP_TARGETS = ['6', '7', '8', '9+', 'Other'];
const ACTIVITY_LEVELS = ['Sedentary', 'Light', 'Moderate', 'Very active', 'Other'];
const PRIMARY_GOALS = ['Fat loss', 'Muscle gain', 'General fitness', 'Health monitoring', 'Other'];
const CHRONIC_CONDITIONS = ['None', 'Diabetes', 'Hypertension', 'Thyroid', 'Other'];
const FITNESS_FOCUS_OPTIONS = [
  '🏃 Running', '🚴 Cycling', '🏋️ Strength training',
  '💪 Bodybuilding', '🧘 Yoga / Flexibility', '🏊 Swimming',
  '⚽ Sports', '🥊 Martial arts', '🏔️ Hiking / Trekking',
  '🏁 Marathon training', '🚶 Walking', '🤸 Calisthenics',
];

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border rounded-full px-3 py-1.5 text-sm transition-colors ${
        selected
          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
          : 'bg-slate-800 border-slate-700 text-slate-400'
      }`}
    >
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{children}</h2>;
}

function calculateAge(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn % 12);
  return { ft, in: inches };
}

function ftInToCm(ft: number, inches: number): number {
  return Math.round((ft * 12 + inches) * 2.54);
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('');
}

export default function Profile() {
  const { user } = useAuth();
  usePageLoadTime('Profile', false);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    name: '', dob: '', gender: '', heightCm: null, city: '',
    foodPreference: '', allergies: '',
    sleepTarget: '', sleepTargetCustom: '',
    activityLevel: '', activityLevelCustom: '',
    primaryGoal: '', primaryGoalCustom: '',
    chronicConditions: [], chronicConditionsOther: '',
    fitnessFocus: [], fitnessTarget: '',
  });

  const [heightFt, setHeightFt] = useState(0);
  const [heightIn, setHeightIn] = useState(0);
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>('cm');

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
        if (snap.exists()) {
          const data = snap.data() as ProfileData;
          setProfile({
            ...data,
            sleepTargetCustom: data.sleepTargetCustom || '',
            activityLevelCustom: data.activityLevelCustom || '',
            primaryGoalCustom: data.primaryGoalCustom || '',
            chronicConditionsOther: data.chronicConditionsOther || '',
            fitnessFocus: data.fitnessFocus || [],
            fitnessTarget: data.fitnessTarget || '',
          });
          if (data.heightCm) {
            const { ft, in: inches } = cmToFtIn(data.heightCm);
            setHeightFt(ft);
            setHeightIn(inches);
          }
        } else {
          setProfile(prev => ({ ...prev, name: user.displayName || '' }));
        }
      } catch (e) {
        console.error('Error loading profile:', e);
      }
    };
    fetchProfile();
  }, [user]);

  const age = useMemo(() => calculateAge(profile.dob), [profile.dob]);

  const updateField = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => {
    setProfile(prev => ({ ...prev, [key]: value }));
  };

  const handleHeightCm = (val: string) => {
    const cm = val === '' ? null : parseFloat(val);
    updateField('heightCm', cm);
    if (cm) { const { ft, in: inches } = cmToFtIn(cm); setHeightFt(ft); setHeightIn(inches); }
    else { setHeightFt(0); setHeightIn(0); }
  };

  const handleHeightFt = (val: string) => {
    const ft = parseInt(val) || 0;
    setHeightFt(ft);
    updateField('heightCm', ftInToCm(ft, heightIn) || null);
  };

  const handleHeightIn = (val: string) => {
    const inches = parseInt(val) || 0;
    setHeightIn(inches);
    updateField('heightCm', ftInToCm(heightFt, inches) || null);
  };

  const switchHeightUnit = (unit: 'cm' | 'ft') => {
    if (unit === heightUnit) return;
    setHeightUnit(unit);
    if (unit === 'ft' && profile.heightCm) {
      const { ft, in: inches } = cmToFtIn(profile.heightCm);
      setHeightFt(ft); setHeightIn(inches);
    }
  };

  const toggleCondition = (condition: string) => {
    const current = profile.chronicConditions;
    if (condition === 'None') { updateField('chronicConditions', current.includes('None') ? [] : ['None']); return; }
    const next = current.includes('None') ? [condition]
      : current.includes(condition) ? current.filter(c => c !== condition)
      : [...current, condition];
    updateField('chronicConditions', next);
  };

  const toggleFitnessFocus = (focus: string) => {
    const current = profile.fitnessFocus || [];
    const next = current.includes(focus)
      ? current.filter(f => f !== focus)
      : [...current, focus];
    updateField('fitnessFocus', next);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload = cleanData({
        name: profile.name, dob: profile.dob, gender: profile.gender,
        heightCm: profile.heightCm, city: profile.city,
        foodPreference: profile.foodPreference, allergies: profile.allergies,
        sleepTarget: profile.sleepTarget, sleepTargetCustom: profile.sleepTargetCustom,
        activityLevel: profile.activityLevel, activityLevelCustom: profile.activityLevelCustom,
        primaryGoal: profile.primaryGoal, primaryGoalCustom: profile.primaryGoalCustom,
        chronicConditions: profile.chronicConditions, chronicConditionsOther: profile.chronicConditionsOther,
        fitnessFocus: profile.fitnessFocus, fitnessTarget: profile.fitnessTarget,
      });
      await setDoc(doc(db, 'users', user.uid, 'profile', 'data'), payload);
      await bumpDataVersion(user.uid);
      calculateNutritionGoals(user.uid).catch(e => console.warn('Nutrition goals calc failed:', e));

      // Sync sleep target to Sleep habit
      if (profile.sleepTarget) {
        const sleepHours = profile.sleepTarget === '9+' ? 9 : parseInt(profile.sleepTarget) || 8;
        try {
          const defaultHabits = await ensureDefaultHabits(user.uid);
          const sleepHabit = defaultHabits['sleep'];
          if (sleepHabit) {
            const habitsSnap = await getDocs(collection(db, 'users', user.uid, 'habits'));
            const sleepDoc = habitsSnap.docs.find(d => d.id === sleepHabit.id);
            if (sleepDoc) {
              await updateDoc(sleepDoc.ref, { targetValue: sleepHours, targetUnit: 'hrs' });
            }
          }
        } catch (e) { console.warn('Sleep habit sync failed:', e); }
      }
      navigate('/');
    } catch (e) {
      console.error('Error saving profile:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950 text-white z-50 flex flex-col" style={{ height: '100dvh' }}>
      <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-semibold">Profile</h1>
        </div>
        <button onClick={handleSave}
          className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-20 space-y-6">

        {/* Avatar */}
        <div className="flex flex-col items-center space-y-2">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 text-xl font-bold">
            {getInitials(profile.name) || '?'}
          </div>
          <div className="text-base font-medium">{profile.name || 'Your Name'}</div>
          <div className="text-xs text-slate-500 text-center">All fields are optional · only you can see this</div>
        </div>

        {/* Core */}
        <div className="space-y-4">
          <SectionLabel>Core</SectionLabel>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Full name</label>
            <input type="text" value={profile.name} onChange={e => updateField('name', e.target.value)}
              placeholder="Your full name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Date of birth</label>
              <input type="date" value={profile.dob} onChange={e => updateField('dob', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Age</label>
              <div className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-emerald-400 font-medium">
                {age !== null ? `${age} years` : '—'}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Gender</label>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map(g => <Chip key={g} label={g} selected={profile.gender === g} onClick={() => updateField('gender', g)} />)}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Height</label>
            <div className="flex flex-wrap gap-2 mb-2">
              <Chip label="cm" selected={heightUnit === 'cm'} onClick={() => switchHeightUnit('cm')} />
              <Chip label="ft / in" selected={heightUnit === 'ft'} onClick={() => switchHeightUnit('ft')} />
            </div>
            {heightUnit === 'cm' ? (
              <input type="number" value={profile.heightCm ?? ''} onChange={e => handleHeightCm(e.target.value)} placeholder="175"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input type="number" value={heightFt || ''} onChange={e => handleHeightFt(e.target.value)} placeholder="5"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
                  <div className="text-xs text-slate-500 mt-1">ft</div>
                </div>
                <div>
                  <input type="number" value={heightIn || ''} onChange={e => handleHeightIn(e.target.value)} placeholder="9"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
                  <div className="text-xs text-slate-500 mt-1">in</div>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">City</label>
            <input type="text" value={profile.city} onChange={e => updateField('city', e.target.value)} placeholder="Your city"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
          </div>
        </div>

        <div className="h-px bg-slate-800" />

        {/* Diet */}
        <div className="space-y-4">
          <SectionLabel>Diet</SectionLabel>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Food preference</label>
            <div className="flex flex-wrap gap-2">
              {FOOD_PREFS.map(p => <Chip key={p} label={p} selected={profile.foodPreference === p} onClick={() => updateField('foodPreference', p)} />)}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Allergies</label>
            <input type="text" value={profile.allergies} onChange={e => updateField('allergies', e.target.value)} placeholder="e.g. Lactose, Gluten"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Sleep target</label>
            <div className="flex flex-wrap gap-2">
              {SLEEP_TARGETS.map(s => (
                <Chip key={s} label={s === 'Other' ? 'Other' : `${s} hrs`} selected={profile.sleepTarget === s}
                  onClick={() => updateField('sleepTarget', profile.sleepTarget === s ? '' : s)} />
              ))}
            </div>
            {profile.sleepTarget === 'Other' && (
              <input type="text" value={profile.sleepTargetCustom} onChange={e => updateField('sleepTargetCustom', e.target.value)} placeholder="Describe…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 mt-2" />
            )}
          </div>
        </div>

        <div className="h-px bg-slate-800" />

        {/* Fitness */}
        <div className="space-y-4">
          <SectionLabel>Fitness</SectionLabel>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Activity level</label>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_LEVELS.map(a => (
                <Chip key={a} label={a} selected={profile.activityLevel === a}
                  onClick={() => updateField('activityLevel', profile.activityLevel === a ? '' : a)} />
              ))}
            </div>
            {profile.activityLevel === 'Other' && (
              <input type="text" value={profile.activityLevelCustom} onChange={e => updateField('activityLevelCustom', e.target.value)} placeholder="Describe…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 mt-2" />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Primary goal</label>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_GOALS.map(g => (
                <Chip key={g} label={g} selected={profile.primaryGoal === g}
                  onClick={() => updateField('primaryGoal', profile.primaryGoal === g ? '' : g)} />
              ))}
            </div>
            {profile.primaryGoal === 'Other' && (
              <input type="text" value={profile.primaryGoalCustom} onChange={e => updateField('primaryGoalCustom', e.target.value)} placeholder="Describe…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 mt-2" />
            )}
          </div>

          {/* NEW: Fitness focus tags */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">I'm focused on</label>
            <p className="text-xs text-slate-500 mb-2">Select all that apply</p>
            <div className="flex flex-wrap gap-2">
              {FITNESS_FOCUS_OPTIONS.map(f => (
                <Chip key={f} label={f}
                  selected={(profile.fitnessFocus || []).includes(f)}
                  onClick={() => toggleFitnessFocus(f)} />
              ))}
            </div>
          </div>

          {/* NEW: Free text fitness target */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">My target</label>
            <p className="text-xs text-slate-500 mb-2">Tell us more — the AI uses this for personalised insights</p>
            <textarea
              value={profile.fitnessTarget}
              onChange={e => updateField('fitnessTarget', e.target.value)}
              placeholder='e.g. "Training for Mumbai Marathon in December" or "Want to get from 28% to 20% body fat by June" or "Building visible abs while staying under 80kg"'
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none text-sm leading-relaxed"
            />
          </div>
        </div>

        <div className="h-px bg-slate-800" />

        {/* Health context */}
        <div className="space-y-4">
          <SectionLabel>Health context</SectionLabel>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Chronic conditions</label>
            <div className="flex flex-wrap gap-2">
              {CHRONIC_CONDITIONS.map(c => (
                <Chip key={c} label={c} selected={profile.chronicConditions.includes(c)} onClick={() => toggleCondition(c)} />
              ))}
            </div>
            {profile.chronicConditions.includes('Other') && (
              <input type="text" value={profile.chronicConditionsOther} onChange={e => updateField('chronicConditionsOther', e.target.value)} placeholder="Describe…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 mt-2" />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}