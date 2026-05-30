import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { addHabit, Habit } from '@/lib/habits';

interface AddHabitModalProps {
  onClose: () => void;
  onHabitAdded: () => void;
}

const ICONS = [
  { key: 'Dumbbell', icon: '🏋️' },
  { key: 'Footprints', icon: '👟' },
  { key: 'BookOpen', icon: '📖' },
  { key: 'Brain', icon: '🧠' },
  { key: 'PenLine', icon: '✏️' },
  { key: 'Apple', icon: '🍎' },
  { key: 'Moon', icon: '🌙' },
  { key: 'Droplets', icon: '💧' },
  { key: 'Heart', icon: '❤️' },
  { key: 'Music', icon: '🎵' },
];

// Period options for "X times" goal type
const PERIODS = [
  { key: 'day',   label: 'per day' },
  { key: 'week',  label: 'per week' },
  { key: 'month', label: 'per month' },
  { key: 'year',  label: 'per year' },
];

const UNITS = [
  'sessions', 'minutes', 'hours',
  'km', 'steps', 'glasses',
  'pages', 'reps', 'sets', 'unit',
];

const COLORS = ['#10b981', '#378ADD', '#EF9F27', '#7F77DD', '#D85A30'];

export default function AddHabitModal({ onClose, onHabitAdded }: AddHabitModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    icon: '',
    goalType: 'daily' as 'daily' | 'times',
    targetValue: 1,
    period: 'day' as 'day' | 'week' | 'month' | 'year',
    targetUnit: 'sessions',
    reminderTime: '',
  });

  // Map our simplified form to the Habit goalType expected by Firestore
  const getStoredGoalType = (): Habit['goalType'] => {
    if (formData.goalType === 'daily') return 'daily';
    // Store as "count_per_day", "count_per_week" etc. for ring logic compatibility
    return `count_per_${formData.period}` as Habit['goalType'];
  };

  const handleSubmit = async () => {
    if (!user || !formData.name || !formData.icon) return;
    setLoading(true);
    try {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      await addHabit(user.uid, {
        name: formData.name,
        icon: formData.icon,
        goalType: getStoredGoalType(),
        targetValue: formData.goalType === 'daily' ? 1 : formData.targetValue,
        targetUnit: formData.goalType === 'daily' ? '' : formData.targetUnit,
        period: formData.goalType === 'times' ? formData.period : null,
        reminderTime: formData.reminderTime || null,
        color,
      });
      onHabitAdded();
    } catch (error) {
      console.error('Error adding habit:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950 text-white z-[60] flex flex-col" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-lg font-semibold">New habit</h1>
        <div className="w-10" />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Name */}
        <div>
          <label className="block text-sm font-medium mb-2">Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter habit name"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Icon picker */}
        <div>
          <label className="block text-sm font-medium mb-2">Icon</label>
          <div className="grid grid-cols-5 gap-2">
            {ICONS.map(({ key, icon }) => (
              <button key={key} type="button" onClick={() => setFormData({ ...formData, icon })}
                className={`w-12 h-12 bg-slate-800 border-2 rounded-lg flex items-center justify-center text-xl transition-all ${
                  formData.icon === icon
                    ? 'border-emerald-500 bg-emerald-500/20 ring-2 ring-emerald-500/40 scale-110'
                    : 'border-slate-700 hover:border-slate-600 opacity-50'
                }`}>
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* Goal type — just 2 options */}
        <div>
          <label className="block text-sm font-medium mb-2">Goal type</label>
          <div className="grid grid-cols-2 gap-3">
            <button type="button"
              onClick={() => setFormData({ ...formData, goalType: 'daily' })}
              className={`p-4 border-2 rounded-xl text-left transition-colors ${
                formData.goalType === 'daily'
                  ? 'border-emerald-500 bg-emerald-500/15'
                  : 'border-slate-700 hover:border-slate-600'
              }`}>
              <div className="text-xl mb-1.5">✅</div>
              <div className="font-semibold text-sm">Daily</div>
              <div className="text-xs text-slate-400 mt-0.5">Simple yes / no each day</div>
            </button>

            <button type="button"
              onClick={() => setFormData({ ...formData, goalType: 'times', targetValue: 3 })}
              className={`p-4 border-2 rounded-xl text-left transition-colors ${
                formData.goalType === 'times'
                  ? 'border-emerald-500 bg-emerald-500/15'
                  : 'border-slate-700 hover:border-slate-600'
              }`}>
              <div className="text-xl mb-1.5">🔢</div>
              <div className="font-semibold text-sm">X times</div>
              <div className="text-xs text-slate-400 mt-0.5">Track a count with a target</div>
            </button>
          </div>
        </div>

        {/* X times config */}
        {formData.goalType === 'times' && (
          <div className="space-y-4">

            {/* Amount + period on one row */}
            <div>
              <label className="block text-sm font-medium mb-2">Target</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={formData.targetValue}
                  onChange={e => setFormData({ ...formData, targetValue: parseInt(e.target.value) || 1 })}
                  min="1"
                  className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-center focus:outline-none focus:border-emerald-500"
                />
                <span className="text-slate-400 text-sm">times</span>
                {/* Period selector */}
                <div className="flex gap-1.5 flex-1 flex-wrap">
                  {PERIODS.map(p => (
                    <button key={p.key} type="button"
                      onClick={() => setFormData({ ...formData, period: p.key as any })}
                      className={`flex-1 text-xs py-2 px-2 rounded-lg border transition-colors ${
                        formData.period === p.key
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Unit */}
            <div>
              <label className="block text-sm font-medium mb-2">Unit</label>
              <div className="flex flex-wrap gap-2">
                {UNITS.map(unit => (
                  <button key={unit} type="button"
                    onClick={() => setFormData({ ...formData, targetUnit: unit })}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      formData.targetUnit === unit
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}>
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
              <p className="text-xs text-slate-400">
                Goal: <span className="text-white font-medium">
                  {formData.targetValue} {formData.targetUnit} {PERIODS.find(p => p.key === formData.period)?.label}
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Reminder */}
        <div>
          <label className="block text-sm font-medium mb-2">Reminder time (optional)</label>
          <input
            type="text"
            value={formData.reminderTime}
            onChange={e => setFormData({ ...formData, reminderTime: e.target.value })}
            placeholder="e.g., 09:00 AM"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Save */}
      <div className="flex-shrink-0 p-4 border-t border-slate-800">
        <button type="button" onClick={handleSubmit}
          disabled={loading || !formData.name || !formData.icon}
          className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-3 rounded-xl transition-colors">
          {loading ? 'Saving...' : 'Save habit'}
        </button>
      </div>
    </div>
  );
}