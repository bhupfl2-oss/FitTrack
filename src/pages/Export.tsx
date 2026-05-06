import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Copy, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';
import jsPDF from 'jspdf';

interface ExportData {
  workouts: any[];
  bodyComp: any[];
  goals: any[];
}

interface LabTestExport {
  id: string;
  name: string;
  unit: string;
  category: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
  readings: { value: number; date: Date; }[];
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
  const [labTests, setLabTests] = useState<LabTestExport[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [includeLabResults, setIncludeLabResults] = useState(false);

  // Fetch lab tests and readings
  useEffect(() => {
    if (!user) return;

    const fetchLabTests = async () => {
      try {
        const testsQuery = query(
          collection(db, 'users', user.uid, 'tests'),
          orderBy('createdAt', 'desc')
        );
        const testsSnapshot = await getDocs(testsQuery);
        
        const tests: LabTestExport[] = [];
        
        for (const testDoc of testsSnapshot.docs) {
          const testData = testDoc.data();
          
          // Fetch all readings for this test
          const readingsQuery = query(
            collection(db, 'users', user.uid, 'tests', testDoc.id, 'readings'),
            orderBy('date', 'desc')
          );
          const readingsSnapshot = await getDocs(readingsQuery);
          
          const readings = readingsSnapshot.docs.map(doc => ({
            value: doc.data().value,
            date: new Date(doc.data().date)
          }));
          
          // Get category using same logic as Labs.tsx
          const getTestCategory = (testName: string): string => {
            const name = testName.toLowerCase();
            if (name.includes('tsh') || name.includes('t3') || name.includes('t4')) return 'Thyroid';
            if (name.includes('hba1c') || name.includes('glucose') || name.includes('blood sugar')) return 'Diabetes';
            if (name.includes('vitamin') || name.includes('calcium')) return 'Nutrition';
            if (name.includes('alt') || name.includes('ast') || name.includes('bilirubin')) return 'Liver';
            if (name.includes('testosterone')) return 'Hormones';
            return 'Blood Test';
          };
          
          tests.push({
            id: testDoc.id,
            name: testData.name,
            unit: testData.unit,
            category: getTestCategory(testData.name),
            referenceRangeLow: testData.referenceRangeLow || null,
            referenceRangeHigh: testData.referenceRangeHigh || null,
            readings
          });
        }
        
        setLabTests(tests);
        // Select all tests by default
        setSelectedTestIds(new Set(tests.map(t => t.id)));
      } catch (error) {
        console.error('Error fetching lab tests:', error);
      }
    };

    fetchLabTests();
  }, [user]);

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
        const goalsDoc = await getDoc(doc(db, 'users', user.uid, 'config', 'bodyCompConfig'));
        if (goalsDoc.exists()) {
          data.goals = [{ id: goalsDoc.id, ...goalsDoc.data() }];
        }
      }
      
      generateTextExport(data);
    } catch (error) {
      console.error('Error generating export:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateLabsTxt = () => {
    const selected = labTests.filter(t => selectedTestIds.has(t.id));
    let txt = '\nLAB RESULTS\n';
    txt += '='.repeat(60) + '\n\n';

    selected.forEach(test => {
      txt += `${test.name} (${test.category})\n`;
      txt += '-'.repeat(40) + '\n';
      // Column headers
      txt += 'Date'.padEnd(14) + '| Value'.padEnd(14) + '| Unit'.padEnd(12) + '| Status'.padEnd(12) + '| Range\n';
      txt += '-'.repeat(60) + '\n';
      // Each reading row
      test.readings.forEach(r => {
        const status = getStatus(r.value, test.referenceRangeLow, test.referenceRangeHigh);
        const range = test.referenceRangeLow !== null
          ? `${test.referenceRangeLow}-${test.referenceRangeHigh}` 
          : '—';
        const dateStr = format(r.date, 'MMM yyyy');
        txt += dateStr.padEnd(14) + '| ' + String(r.value).padEnd(12) + '| ' + test.unit.padEnd(10) + '| ' + status.padEnd(10) + '| ' + range + '\n';
      });
      txt += '\n';
    });
    return txt;
  };

  const getStatus = (value: number, low: number | null, high: number | null): string => {
    if (low === null || high === null) return '—';
    if (value > high * 1.2 || value < low * 0.8) return 'Critical';
    if (value > high) return 'High ↑';
    if (value < low) return 'Low ↓';
    return 'Normal ✓';
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
    
    // Lab Results Section
    if (includeLabResults && selectedTestIds.size > 0) {
      lines.push(generateLabsTxt());
    }
    
    // Summary
    lines.push('SUMMARY');
    lines.push('=======');
    lines.push(`Total Workouts: ${data.workouts.length}`);
    lines.push(`Body Measurements: ${data.bodyComp.length}`);
    lines.push(`Goal Entries: ${data.goals.length}`);
    lines.push(`Lab Tests Exported: ${selectedTestIds.size}`);
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

  const generateLabsPdf = (doc: any, startY: number) => {
    const selected = labTests.filter(t => selectedTestIds.has(t.id));

    doc.setFontSize(14);
    doc.setTextColor(16, 185, 129); // emerald green
    doc.text('LAB RESULTS', 14, startY);
    startY += 8;

    selected.forEach(test => {
      // Test name header
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(`${test.name} (${test.unit})`, 14, startY);
      startY += 6;

      // Table headers
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text('Date', 14, startY);
      doc.text('Value', 55, startY);
      doc.text('Status', 95, startY);
      doc.text('Range', 135, startY);
      startY += 4;

      // Divider line
      doc.setDrawColor(50, 50, 50);
      doc.line(14, startY, 196, startY);
      startY += 4;

      // Each reading row
      test.readings.forEach(r => {
        const status = getStatus(r.value, test.referenceRangeLow, test.referenceRangeHigh);
        const range = test.referenceRangeLow !== null
          ? `${test.referenceRangeLow}–${test.referenceRangeHigh}` 
          : '—';

        // Status colour
        if (status.includes('Critical')) doc.setTextColor(239, 68, 68);
        else if (status.includes('High')) doc.setTextColor(245, 158, 11);
        else if (status.includes('Low')) doc.setTextColor(59, 130, 246);
        else doc.setTextColor(16, 185, 129);

        doc.setFontSize(9);
        doc.setTextColor(200, 200, 200);
        doc.text(format(r.date, 'MMM yyyy'), 14, startY);
        doc.text(`${r.value} ${test.unit}`, 55, startY);

        // Coloured status
        if (status.includes('Critical')) doc.setTextColor(239, 68, 68);
        else if (status.includes('High')) doc.setTextColor(245, 158, 11);
        else if (status.includes('Low')) doc.setTextColor(59, 130, 246);
        else doc.setTextColor(16, 185, 129);
        doc.text(status, 95, startY);

        doc.setTextColor(150, 150, 150);
        doc.text(range, 135, startY);
        startY += 5;

        // Add new page if needed
        if (startY > 270) {
          doc.addPage();
          startY = 20;
        }
      });
      startY += 6; // space between tests
    });
    return startY;
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    
    let currentY = 20;
    
    // Add existing content (workouts, body comp, goals)
    const lines = exportText.split('\n');
    let currentSection = '';
    
    for (const line of lines) {
      if (line.includes('===') || line.includes('---')) {
        currentSection = line.split(' ')[0].toLowerCase();
      }
      
      if (currentSection === 'lab results') {
        // Skip lab results in text generation, handle separately
        continue;
      }
      
      if (line.trim()) {
        if (line.includes('FITNESS DATA EXPORT')) {
          doc.setFontSize(16);
          doc.setTextColor(16, 185, 129);
          doc.text(line, 14, currentY);
          currentY += 10;
        } else if (line.includes('===') || line.includes('---')) {
          doc.setFontSize(12);
          doc.setTextColor(255, 255, 255);
          doc.text(line, 14, currentY);
          currentY += 8;
        } else {
          doc.setFontSize(10);
          doc.setTextColor(200, 200, 200);
          doc.text(line, 14, currentY);
          currentY += 6;
        }
        
        if (currentY > 270) {
          doc.addPage();
          currentY = 20;
        }
      }
    }
    
    // Add lab results if selected
    if (includeLabResults && selectedTestIds.size > 0) {
      currentY = generateLabsPdf(doc, currentY);
    }
    
    // Save the PDF
    doc.save(`fitness-export-${new Date().toISOString().split('T')[0]}.pdf`);
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
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={includeLabResults}
                onChange={(e) => setIncludeLabResults(e.target.checked)}
                className="w-4 h-4 text-emerald-500 bg-slate-800 border-slate-600 rounded focus:ring-emerald-500"
              />
              <span>Lab Results</span>
            </label>
          </div>
        </div>

        {/* Lab Results Test Selector */}
        {includeLabResults && (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-slate-300">Select tests</label>
              <div className="flex space-x-2">
                <button
                  onClick={() => setSelectedTestIds(new Set(labTests.map(t => t.id)))}
                  className="px-3 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() => setSelectedTestIds(new Set())}
                  className="px-3 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                >
                  None
                </button>
              </div>
            </div>
            
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {labTests.map((test) => {
                const latestReading = test.readings[0];
                const getStatus = (value: number, low: number | null, high: number | null): string => {
                  if (low === null || high === null) return '—';
                  if (value > high * 1.2 || value < low * 0.8) return 'Critical';
                  if (value > high) return 'High ↑';
                  if (value < low) return 'Low ↓';
                  return 'Normal ✓';
                };
                
                const status = latestReading ? getStatus(latestReading.value, test.referenceRangeLow, test.referenceRangeHigh) : '—';
                
                return (
                  <label key={test.id} className="flex items-center space-x-3 p-2 hover:bg-slate-700 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedTestIds.has(test.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedTestIds);
                        if (e.target.checked) {
                          newSet.add(test.id);
                        } else {
                          newSet.delete(test.id);
                        }
                        setSelectedTestIds(newSet);
                      }}
                      className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 rounded focus:ring-emerald-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-white">{test.name}</div>
                      <div className="text-xs text-slate-400">{test.category}</div>
                    </div>
                    <div className="text-right">
                      {latestReading && (
                        <div className="text-sm font-mono text-slate-300">
                          {latestReading.value} <span className="text-xs text-slate-500">{test.unit}</span>
                        </div>
                      )}
                      <div className={`text-xs px-2 py-0.5 rounded-full inline-block ${
                        status.includes('Critical') ? 'bg-red-500/20 text-red-400' :
                        status.includes('High') ? 'bg-amber-500/20 text-amber-400' :
                        status.includes('Low') ? 'bg-blue-500/20 text-blue-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>
                        {status}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            
            <div className="mt-3 text-sm text-slate-400">
              {selectedTestIds.size} test{selectedTestIds.size !== 1 ? 's' : ''} selected
            </div>
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={generateExport}
          disabled={loading || (!selectedData.workouts && !selectedData.bodyComp && !selectedData.goals && (!includeLabResults || selectedTestIds.size === 0))}
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
