import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface GoalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface Goal {
  metric: 'weight' | 'pbf' | 'smm';
  target: number;
  targetDate?: string;
}

function cleanData(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        cleaned[key] = cleanData(obj[key]);
      }
    }
    return cleaned;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanData);
  }
  return obj;
}

export default function GoalsModal({ isOpen, onClose, onSave }: GoalsModalProps) {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [goal, setGoal] = useState<Goal>({
    metric: 'weight',
    target: 75,
    targetDate: '',
  });

  const updateGoal = (field: keyof Goal, value: string | number) => {
    setGoal(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const goalData = cleanData({
        userId: user.uid,
        metric: goal.metric,
        target: goal.target,
        targetDate: goal.targetDate || null,
        createdAt: serverTimestamp(),
        isActive: true,
      });

      await addDoc(collection(db, 'users', user.uid, 'goals'), goalData);
      onSave();
      onClose();
      // Reset form
      setGoal({
        metric: 'weight',
        target: 75,
        targetDate: '',
      });
    } catch (error) {
      console.error('Error saving goal:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const getMetricLabel = (metric: string) => {
    switch (metric) {
      case 'weight': return 'Weight (kg)';
      case 'pbf': return 'PBF%';
      case 'smm': return 'SMM (kg)';
      default: return metric;
    }
  };

  const getMetricUnit = (metric: string) => {
    switch (metric) {
      case 'weight': return 'kg';
      case 'pbf': return '%';
      case 'smm': return 'kg';
      default: return '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Set Goal</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Goal Metric</label>
            <select
              value={goal.metric}
              onChange={(e) => updateGoal('metric', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="weight">Weight (kg)</option>
              <option value="pbf">PBF%</option>
              <option value="smm">SMM (kg)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Target Value ({getMetricUnit(goal.metric)})
            </label>
            <input
              type="number"
              step="0.1"
              placeholder="75"
              value={goal.target}
              onChange={(e) => updateGoal('target', parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Target Date (Optional)</label>
            <input
              type="date"
              value={goal.targetDate}
              onChange={(e) => updateGoal('targetDate', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-sm text-slate-300">
              Goal: {getMetricLabel(goal.metric)} = {goal.target}{getMetricUnit(goal.metric)}
            </p>
            {goal.targetDate && (
              <p className="text-xs text-slate-400 mt-1">
                Target: {new Date(goal.targetDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-800">
          <Button
            onClick={handleSave}
            disabled={isSaving || !goal.target}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {isSaving ? 'Saving...' : 'Set Goal'}
          </Button>
        </div>
      </div>
    </div>
  );
}
