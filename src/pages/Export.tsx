import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Copy, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, getDocs, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ExportData {
  workouts: any[];
  bodyComp: any[];
  goals: any[];
}

export default function Export() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState('1M');
  const [selectedData, setSelectedData] = useState({
    workouts: true,
    bodyComp: true,
    goals: true
  });
    const [exportText, setExportText] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const getDateRange = (range: string) => {
    const now = new Date();
    let startDate = new Date();
    
    switch (range) {
      case '1W':
        startDate.setDate(now.getDate() - 7);
        break;
      case '1M':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case '6M':
        startDate.setMonth(now.getMonth() - 6);
        break;
      case 'All Time':
        startDate = new Date(0);
        break;
      default:
        startDate.setMonth(now.getMonth() - 1);
    }
    
    return { startDate, endDate: now };
  };

  const generateExport = async () => {
    if (!user) return;
    
    setLoading(true);
    setExportText('');
    
    try {
      const { startDate, endDate } = getDateRange(timeRange);
      const data: ExportData = { workouts: [], bodyComp: [], goals: [] };
      
      // Fetch Workouts
      if (selectedData.workouts) {
        const workoutsQuery = query(
          collection(db, 'users', user.uid, 'sessions'),
          where('date', '>=', startDate.toISOString()),
          where('date', '<=', endDate.toISOString()),
          orderBy('date', 'desc')
        );
        const workoutsSnapshot = await getDocs(workoutsQuery);
        data.workouts = workoutsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
      
      // Fetch Body Comp
      if (selectedData.bodyComp) {
        const bodyQuery = query(
          collection(db, 'users', user.uid, 'bodyEntries'),
          where('date', '>=', startDate.toISOString()),
          where('date', '<=', endDate.toISOString()),
          orderBy('date', 'desc')
        );
        const bodySnapshot = await getDocs(bodyQuery);
        data.bodyComp = bodySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
      
      // Fetch Goals
      if (selectedData.goals) {
        const goalsQuery = query(
          collection(db, 'users', user.uid, 'config', 'bodyCompConfig'),
          orderBy('createdAt', 'desc')
        );
        const goalsSnapshot = await getDocs(goalsQuery);
        data.goals = goalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
      
      generateTextExport(data);
    } catch (error) {
      console.error('Error generating export:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateTextExport = (data: ExportData) => {
    const lines: string[] = [];
    const { startDate, endDate } = getDateRange(timeRange);
    
    lines.push(`FITNESS DATA EXPORT`);
    lines.push(`Generated: ${new Date().toLocaleDateString()}`);
    lines.push(`Date Range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);
    lines.push('');
    
    // Goals Section
    if (data.goals.length > 0 && selectedData.goals) {
      lines.push('GOALS');
      lines.push('=====');
      data.goals.forEach(goal => {
        lines.push(`Target Weight: ${goal.targetWeight || 'N/A'} lbs`);
        lines.push(`Target Body Fat: ${goal.targetBodyFat || 'N/A'}%`);
        lines.push(`Target Muscle: ${goal.targetMuscle || 'N/A'} lbs`);
        lines.push(`Created: ${new Date(goal.createdAt?.toDate?.() || goal.createdAt).toLocaleDateString()}`);
        lines.push('');
      });
    }
    
    // Body Composition Section
    if (data.bodyComp.length > 0 && selectedData.bodyComp) {
      lines.push('BODY COMPOSITION');
      lines.push('================');
      data.bodyComp.forEach(entry => {
        lines.push(`Date: ${new Date(entry.date).toLocaleDateString()}`);
        lines.push(`Weight: ${entry.weight || 'N/A'} lbs`);
        lines.push(`Body Fat: ${entry.bodyFat || 'N/A'}%`);
        lines.push(`Muscle: ${entry.muscle || 'N/A'} lbs`);
        lines.push(`BMI: ${entry.bmi || 'N/A'}`);
        lines.push('');
      });
    }
    
    // Workouts Section
    if (data.workouts.length > 0 && selectedData.workouts) {
      lines.push('WORKOUT SESSIONS');
      lines.push('===============');
      data.workouts.forEach(workout => {
        lines.push(`Date: ${new Date(workout.date).toLocaleDateString()}`);
        lines.push(`Type: ${workout.type || 'N/A'}`);
        lines.push(`Duration: ${workout.duration || 'N/A'} minutes`);
        if (workout.exercises && workout.exercises.length > 0) {
          lines.push('Exercises:');
          workout.exercises.forEach((exercise: any) => {
            lines.push(`  - ${exercise.name}: ${exercise.sets?.length || 0} sets`);
            exercise.sets?.forEach((set: any, index: number) => {
              lines.push(`    Set ${index + 1}: ${set.weight || 'N/A'} lbs × ${set.reps || 'N/A'} reps`);
            });
          });
        }
        lines.push('');
      });
    }
    
    // Summary
    lines.push('SUMMARY');
    lines.push('=======');
    lines.push(`Total Workouts: ${data.workouts.length}`);
    lines.push(`Body Measurements: ${data.bodyComp.length}`);
    lines.push(`Goal Entries: ${data.goals.length}`);
    lines.push('');
    lines.push('Export completed successfully.');
    
    const text = lines.join('\n');
    setExportText(text);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const downloadTXT = () => {
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitness-export-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  
  const previewLines = exportText.split('\n').slice(0, 20);
  const hasMoreLines = exportText.split('\n').length > 20;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back</span>
        </button>
        <h1 className="text-2xl font-bold">Export Data</h1>
        <div className="w-20" /> {/* Spacer for centering */}
      </div>

      {/* Export Options */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 mb-6">
        <h2 className="text-lg font-semibold mb-4">Export Options</h2>
        
        {/* Time Range Selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">Time Range</label>
          <div className="flex space-x-2">
            {['1W', '1M', '6M', 'All Time'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  timeRange === range
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {/* Data Type Checkboxes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">Data Types</label>
          <div className="space-y-2">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={selectedData.workouts}
                onChange={(e) => setSelectedData(prev => ({ ...prev, workouts: e.target.checked }))}
                className="w-4 h-4 text-emerald-500 bg-slate-800 border-slate-600 rounded focus:ring-emerald-500"
              />
              <span>Workouts</span>
            </label>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={selectedData.bodyComp}
                onChange={(e) => setSelectedData(prev => ({ ...prev, bodyComp: e.target.checked }))}
                className="w-4 h-4 text-emerald-500 bg-slate-800 border-slate-600 rounded focus:ring-emerald-500"
              />
              <span>Body Composition</span>
            </label>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={selectedData.goals}
                onChange={(e) => setSelectedData(prev => ({ ...prev, goals: e.target.checked }))}
                className="w-4 h-4 text-emerald-500 bg-slate-800 border-slate-600 rounded focus:ring-emerald-500"
              />
              <span>Goals</span>
            </label>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={generateExport}
          disabled={loading || (!selectedData.workouts && !selectedData.bodyComp && !selectedData.goals)}
          className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-3 rounded-lg transition-colors"
        >
          {loading ? 'Generating...' : 'Generate Export'}
        </button>
      </div>

      {/* Preview Area */}
      {exportText && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 mb-6">
          <h2 className="text-lg font-semibold mb-4">Preview (First 20 lines)</h2>
          <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 font-mono text-sm text-slate-300 max-h-64 overflow-y-auto">
            {previewLines.map((line, index) => (
              <div key={index} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
            {hasMoreLines && (
              <div className="text-slate-500 italic mt-2">
                ... and {exportText.split('\n').length - 20} more lines
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {exportText && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h2 className="text-lg font-semibold mb-4">Export Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={copyToClipboard}
              className="flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-medium py-3 rounded-lg transition-colors"
            >
              <Copy className="w-5 h-5" />
              <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
            </button>
            <button
              onClick={downloadTXT}
              className="flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-medium py-3 rounded-lg transition-colors"
            >
              <FileText className="w-5 h-5" />
              <span>Download TXT</span>
            </button>
            <button
              onClick={downloadPDF}
              className="flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-medium py-3 rounded-lg transition-colors"
            >
              <Download className="w-5 h-5" />
              <span>Download PDF</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
