import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import RunnerPlanView from '@/components/RunnerPlanView';

export default function TrainingPlan() {
  const navigate = useNavigate();
  const location = useLocation();
  const date = new URLSearchParams(location.search).get('date') || undefined;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <button
          onClick={() => navigate('/workouts')}
          className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-lg font-semibold">Training Plan</h1>
        <div className="w-8" />
      </div>
      <div className="px-4 py-4">
        <RunnerPlanView initialDate={date} />
      </div>
    </div>
  );
}
