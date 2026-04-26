import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

interface RunningSession {
  effortType: 'recovery' | 'tempo' | 'endurance';
  surface: 'road' | 'treadmill' | 'hill';
  distanceKm: number;
  durationMins: number;
  notes: string;
}

export default function RunningSession() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [session, setSession] = useState<RunningSession>({
    effortType: 'recovery',
    surface: 'road',
    distanceKm: 0,
    durationMins: 0,
    notes: ''
  });

  const effortTypes = [
    { value: 'recovery', label: 'Recovery Run' },
    { value: 'tempo', label: 'Tempo Run' },
    { value: 'endurance', label: 'Endurance Run' }
  ];

  const surfaces = [
    { value: 'road', label: 'Road' },
    { value: 'treadmill', label: 'Treadmill' },
    { value: 'hill', label: 'Hill' }
  ];

  const calculatePace = (): string => {
    if (session.distanceKm > 0 && session.durationMins > 0) {
      const pace = session.durationMins / session.distanceKm;
      const minutes = Math.floor(pace);
      const seconds = Math.round((pace - minutes) * 60);
      return `${minutes}:${seconds.toString().padStart(2, '0')} min/km`;
    }
    return '0:00 min/km';
  };

  const updateSession = (field: keyof RunningSession, value: string | number) => {
    setSession(prev => ({ ...prev, [field]: value }));
  };

  const finishRun = async () => {
    if (!user) return;

    // Validation
    if (session.distanceKm <= 0 || session.durationMins <= 0) {
      alert('Please enter valid distance and duration');
      return;
    }

    setIsSaving(true);
    try {
      const paceMinPerKm = session.durationMins / session.distanceKm;
      
      await addDoc(collection(db, 'users', user.uid, 'workoutSessions'), cleanData({
        type: 'running',
        date: new Date().toISOString().split('T')[0],
        effortType: session.effortType,
        surface: session.surface,
        distanceKm: session.distanceKm,
        durationMins: session.durationMins,
        paceMinPerKm,
        notes: session.notes,
        createdAt: serverTimestamp(),
      }));

      navigate('/workouts');
    } catch (error) {
      console.error('Error saving running session:', error);
      alert('Error saving session');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-md mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/workouts')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-semibold">Running Session</h1>
          <div className="w-9" />
        </div>

        {/* Effort Type Selector */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Effort Type</h2>
          <div className="flex gap-2">
            {effortTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => updateSession('effortType', type.value as RunningSession['effortType'])}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  session.effortType === type.value
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Surface Selector */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Surface</h2>
          <div className="flex gap-2">
            {surfaces.map((surface) => (
              <button
                key={surface.value}
                onClick={() => updateSession('surface', surface.value as RunningSession['surface'])}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  session.surface === surface.value
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {surface.label}
              </button>
            ))}
          </div>
        </div>

        {/* Distance Input */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Distance</h2>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="Distance in km"
            value={session.distanceKm || ''}
            onChange={(e) => updateSession('distanceKm', parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Duration Input */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Duration</h2>
          <input
            type="number"
            step="1"
            min="0"
            placeholder="Duration in minutes"
            value={session.durationMins || ''}
            onChange={(e) => updateSession('durationMins', parseInt(e.target.value) || 0)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Auto-calculated Pace */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Pace</h2>
          <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-emerald-400 font-medium">
            {calculatePace()}
          </div>
        </div>

        {/* Notes */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Notes (optional)</h2>
          <textarea
            placeholder="How did the run feel? Any observations..."
            value={session.notes}
            onChange={(e) => updateSession('notes', e.target.value)}
            rows={4}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
          />
        </div>

        {/* Finish Run Button */}
        <Button
          onClick={finishRun}
          disabled={isSaving || session.distanceKm <= 0 || session.durationMins <= 0}
          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3"
        >
          {isSaving ? 'Saving...' : 'Finish Run'}
        </Button>
      </div>
    </div>
  );
}
