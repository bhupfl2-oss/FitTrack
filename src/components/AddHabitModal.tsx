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

const GOAL_TYPES = [
  { key: 'daily', label: 'Daily', description: 'Complete every day' },
  { key: 'times_per_week', label: 'X times per week', description: 'Set weekly target' },
  { key: 'distance_month', label: 'Distance per month', description: 'Track monthly distance' },
  { key: 'count_month', label: 'Count per month', description: 'Track monthly count' },
];

const UNITS = ['km', 'sessions', 'minutes', 'pages'];
const COLORS = ['#10b981', '#378ADD', '#EF9F27', '#7F77DD', '#D85A30'];

export default function AddHabitModal({ onClose, onHabitAdded }: AddHabitModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    icon: '',
    goalType: 'daily' as Habit['goalType'],
    targetValue: 1,
    targetUnit: 'sessions',
    reminderTime: '',
  });

  const handleSubmit = async () => {
    if (!user || !formData.name || !formData.icon) return;
    setLoading(true);
    try {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      await addHabit(user.uid, {
        name: formData.name,
        icon: formData.icon,
        goalType: formData.goalType,
        targetValue: formData.targetValue,
        targetUnit: formData.targetUnit,
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

  const showTargetFields = formData.goalType !== 'daily';

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
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter habit name"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-400"
          />
        </div>

        {/* Icon picker */}
        <div>
          <label className="block text-sm font-medium mb-2">Icon</label>
          <div className="grid grid-cols-5 gap-2">
            {ICONS.map(({ key, icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFormData({ ...formData, icon })}
                className={`w-12 h-12 bg-slate-800 border-2 rounded-lg flex items-center justify-center text-xl transition-colors
                  ${formData.icon === icon 
    ? 'border-emerald-500 bg-emerald-500/20 ring-2 ring-emerald-500/40 scale-110' 
    : 'border-slate-700 hover:border-slate-600 opacity-50'}`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* Goal type */}
        <div>
          <label className="block text-sm font-medium mb-2">Goal type</label>
          <div className="grid grid-cols-2 gap-3">
            {GOAL_TYPES.map(({ key, label, description }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  goalType: key as Habit['goalType'],
                  targetValue: key === 'daily' ? 1 : key === 'times_per_week' ? 3 : 10,
                })}
                className={`p-3 border-2 rounded-lg text-left transition-colors
                  ${formData.goalType === key ? 'border-emerald-500 bg-emerald-500/20' : 'border-slate-700 hover:border-slate-600'}`}
              >
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-slate-400 mt-1">{description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Target fields */}
        {showTargetFields && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">Target value</label>
              <input
                type="number"
                value={formData.targetValue}
                onChange={(e) => setFormData({ ...formData, targetValue: parseInt(e.target.value) || 1 })}
                min="1"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Unit</label>
              <select
                value={formData.targetUnit}
                onChange={(e) => setFormData({ ...formData, targetUnit: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              >
                {UNITS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Reminder */}
        <div>
          <label className="block text-sm font-medium mb-2">Reminder time (optional)</label>
          <input
            type="text"
            value={formData.reminderTime}
            onChange={(e) => setFormData({ ...formData, reminderTime: e.target.value })}
            placeholder="e.g., 09:00 AM"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-400"
          />
        </div>
      </div>

      {/* Save button — always visible at bottom */}
      <div className="flex-shrink-0 p-4 border-t border-slate-800">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !formData.name || !formData.icon}
          className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-3 rounded-lg transition-colors"
        >
          {loading ? 'Saving...' : 'Save habit'}
        </button>
      </div>
    </div>
  );
}