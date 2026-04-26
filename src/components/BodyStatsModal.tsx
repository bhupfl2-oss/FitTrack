import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

interface BodyStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editData?: {
    id: string;
    date: string;
    weight: number;
    pbf: number;
    smm?: number;
    legLeanMass?: number;
    waist?: number;
  };
}

interface BodyStats {
  date: string;
  weight: string;
  pbf: string;
  smm: string;
  legLeanMass: string;
  ecwRatio: string;
  waist: string;
  neck: string;
  chest: string;
  thigh: string;
  notes: string;
}


export default function BodyStatsModal({ isOpen, onClose, onSave, editData }: BodyStatsModalProps) {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState<BodyStats>({
    date: new Date().toISOString().split('T')[0],
    weight: '',
    pbf: '',
    smm: '',
    legLeanMass: '',
    ecwRatio: '',
    waist: '',
    neck: '',
    chest: '',
    thigh: '',
    notes: '',
  });

  // Initialize form with edit data when provided
  useEffect(() => {
    if (editData) {
      setStats({
        date: editData.date,
        weight: editData.weight.toString(),
        pbf: editData.pbf.toString(),
        smm: editData.smm?.toString() || '',
        legLeanMass: editData.legLeanMass?.toString() || '',
        ecwRatio: '',
        waist: editData.waist?.toString() || '',
        neck: '',
        chest: '',
        thigh: '',
        notes: '',
      });
    } else {
      // Reset form for new entry
      setStats({
        date: new Date().toISOString().split('T')[0],
        weight: '',
        pbf: '',
        smm: '',
        legLeanMass: '',
        ecwRatio: '',
        waist: '',
        neck: '',
        chest: '',
        thigh: '',
        notes: '',
      });
    }
  }, [editData, isOpen]);

  const updateStat = (field: keyof BodyStats, value: string) => {
    setStats(prev => ({ ...prev, [field]: value }));
  };

  const calculateDerived = () => {
    const weight = parseFloat(stats.weight) || 0;
    const pbf = parseFloat(stats.pbf) || 0;
    const fatMass = weight * (pbf / 100);
    const leanMass = weight - fatMass;
    return { fatMass: fatMass.toFixed(1), leanMass: leanMass.toFixed(1) };
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const bodyStatsData = cleanData({
        date: stats.date,
        weight: parseFloat(stats.weight) || null,
        pbf: parseFloat(stats.pbf) || null,
        smm: parseFloat(stats.smm) || null,
        legLeanMass: parseFloat(stats.legLeanMass) || null,
        ecwRatio: parseFloat(stats.ecwRatio) || null,
        waist: parseFloat(stats.waist) || null,
        neck: parseFloat(stats.neck) || null,
        chest: parseFloat(stats.chest) || null,
        thigh: parseFloat(stats.thigh) || null,
        notes: stats.notes || null,
        createdAt: serverTimestamp(),
      });

      if (editData) {
        // Update existing entry
        await updateDoc(doc(db, 'users', user.uid, 'bodyComp', editData.id), bodyStatsData);
      } else {
        // Create new entry
        await addDoc(collection(db, 'users', user.uid, 'bodyComp'), bodyStatsData);
      }
      
      onSave();
      onClose();
      // Reset form
      setStats({
        date: new Date().toISOString().split('T')[0],
        weight: '',
        pbf: '',
        smm: '',
        legLeanMass: '',
        ecwRatio: '',
        waist: '',
        neck: '',
        chest: '',
        thigh: '',
        notes: '',
      });
    } catch (error) {
      console.error('Error saving body stats:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const { fatMass, leanMass } = calculateDerived();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">
            {editData ? 'Edit Body Stats' : 'Log Body Stats'}
          </h2>
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
          {/* Required Fields */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Date *</label>
              <input
                type="date"
                value={stats.date}
                onChange={(e) => updateStat('date', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Weight (kg) *</label>
              <input
                type="number"
                step="0.1"
                placeholder="70.5"
                value={stats.weight}
                onChange={(e) => updateStat('weight', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">PBF% *</label>
              <input
                type="number"
                step="0.1"
                placeholder="15.5"
                value={stats.pbf}
                onChange={(e) => updateStat('pbf', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">SMM (kg) *</label>
              <input
                type="number"
                step="0.1"
                placeholder="35.2"
                value={stats.smm}
                onChange={(e) => updateStat('smm', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Leg Lean Mass (kg) *</label>
              <input
                type="number"
                step="0.1"
                placeholder="12.8"
                value={stats.legLeanMass}
                onChange={(e) => updateStat('legLeanMass', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">ECW Ratio *</label>
              <input
                type="number"
                step="0.001"
                placeholder="0.385"
                value={stats.ecwRatio}
                onChange={(e) => updateStat('ecwRatio', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Optional Fields */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-400">Optional</h3>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Waist (cm)</label>
              <input
                type="number"
                step="0.1"
                placeholder="80.5"
                value={stats.waist}
                onChange={(e) => updateStat('waist', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Neck (cm)</label>
              <input
                type="number"
                step="0.1"
                placeholder="38.2"
                value={stats.neck}
                onChange={(e) => updateStat('neck', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Chest (cm)</label>
              <input
                type="number"
                step="0.1"
                placeholder="95.0"
                value={stats.chest}
                onChange={(e) => updateStat('chest', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Thigh (cm)</label>
              <input
                type="number"
                step="0.1"
                placeholder="55.5"
                value={stats.thigh}
                onChange={(e) => updateStat('thigh', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
              <textarea
                placeholder="Add any notes..."
                value={stats.notes}
                onChange={(e) => updateStat('notes', e.target.value)}
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Derived Preview */}
          {(stats.weight && stats.pbf) && (
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Derived Values</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-300">Fat Mass:</span>
                  <span className="text-white font-medium">{fatMass} kg</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Lean Mass:</span>
                  <span className="text-white font-medium">{leanMass} kg</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800">
          <Button
            onClick={handleSave}
            disabled={isSaving || !stats.date || !stats.weight || !stats.pbf}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {isSaving ? 'Saving...' : 'Save Stats'}
          </Button>
        </div>
      </div>
    </div>
  );
}
