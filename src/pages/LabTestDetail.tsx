import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Bell, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { 
  collection, 
  query, 
  orderBy, 
  getDocs, 
  getDoc, 
  doc, 
  updateDoc, 
  addDoc,
  deleteDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';

// Helper functions for date formatting (replacing date-fns)
const formatDate = (date: Date, formatStr: string): string => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  if (formatStr === 'd MMM yyyy') {
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (formatStr === 'MMM yyyy') {
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  return date.toLocaleDateString();
};

const subMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
};

interface TestReading {
  id: string;
  value: number;
  date: Date;
  reportUrl?: string;
  aiInterpretation?: string;
  createdAt: any;
}

interface LabTest {
  id: string;
  name: string;
  unit: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
  reminderIntervalMonths: number | null;
  nextDueDate: Date | null;
  pinned?: boolean;
}

export default function LabTestDetail() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [test, setTest] = useState<LabTest | null>(null);
  const [readings, setReadings] = useState<TestReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<'6M' | '1Y' | 'All'>('6M');
  const [aiInterpretation, setAiInterpretation] = useState<string>('');
  const [aiAction, setAiAction] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderInterval, setReminderInterval] = useState<number | null>(null);
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const [showReminderSelector, setShowReminderSelector] = useState(false);
  const [showAddReading, setShowAddReading] = useState(false);
  const [newReading, setNewReading] = useState({ value: '', date: new Date().toISOString().split('T')[0] });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!user || !testId) return;

    const fetchData = async () => {
      try {
        // Fetch test document
        const testDoc = await getDoc(doc(db, 'users', user.uid, 'tests', testId));
        if (!testDoc.exists()) {
          setLoading(false);
          return;
        }

        const testData = testDoc.data() as LabTest;
        setTest({
          id: testDoc.id,
          name: testData.name,
          unit: testData.unit,
          referenceRangeLow: testData.referenceRangeLow || null,
          referenceRangeHigh: testData.referenceRangeHigh || null,
          reminderIntervalMonths: testData.reminderIntervalMonths || null,
          nextDueDate: testData.nextDueDate ? new Date(testData.nextDueDate) : null,
          pinned: testData.pinned || false,
        });

        // Initialize reminder states
        setReminderEnabled(!!testData.reminderIntervalMonths && !!testData.nextDueDate);
        setReminderInterval(testData.reminderIntervalMonths ?? null);

        // Fetch all readings
        const readingsQuery = query(
          collection(db, 'users', user.uid, 'tests', testId, 'readings'),
          orderBy('date', 'desc')
        );
        const readingsSnapshot = await getDocs(readingsQuery);
        
        const fetchedReadings: TestReading[] = readingsSnapshot.docs.map(doc => ({
          id: doc.id,
          value: doc.data().value,
          date: new Date(doc.data().date),
          reportUrl: doc.data().reportUrl,
          aiInterpretation: doc.data().aiInterpretation,
          createdAt: doc.data().createdAt,
        }));

        setReadings(fetchedReadings);

        // Show existing AI interpretation if available
        if (fetchedReadings.length > 0 && fetchedReadings[0].aiInterpretation) {
          setAiInterpretation(fetchedReadings[0].aiInterpretation);
        }

      } catch (error) {
        console.error('Error fetching test data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, testId]);

  const getTestStatus = (value: number) => {
    if (!test) return { status: 'Unknown', color: '#374151' };

    const { referenceRangeLow, referenceRangeHigh } = test;

    if (referenceRangeLow === null && referenceRangeHigh === null) {
      return { status: '—', color: '#374151' };
    }

    const isCritical = referenceRangeHigh && value > referenceRangeHigh * 1.2 || 
                      referenceRangeLow && value < referenceRangeLow * 0.8;

    if (isCritical) {
      return { status: 'Critical', color: '#ef4444' };
    }

    if (referenceRangeHigh && value > referenceRangeHigh) {
      return { status: 'High', color: '#f59e0b' };
    }

    if (referenceRangeLow && value < referenceRangeLow) {
      return { status: 'Low', color: '#3b82f6' };
    }

    return { status: 'Normal', color: '#10b981' };
  };

  const getFilteredReadings = () => {
    if (selectedRange === 'All') return readings;
    
    const cutoffDate = selectedRange === '6M' ? subMonths(new Date(), 6) : subMonths(new Date(), 12);
    return readings.filter(reading => reading.date >= cutoffDate);
  };

  const getChartData = () => {
    const filtered = getFilteredReadings();
    return filtered
      .reverse()
      .map(reading => ({
        date: formatDate(reading.date, 'MMM yyyy'),
        value: reading.value,
      }));
  };

  const handleInterpret = async () => {
    if (!test || readings.length === 0) return;

    setIsAnalyzing(true);
    try {
      const last5 = readings.slice(0, 5);
      const readingsSummary = last5.map(r => `${formatDate(r.date, 'MMM yyyy')}: ${r.value}`).join(', ');
      const prompt = `Test: ${test.name} | Unit: ${test.unit} | Reference range: ${test.referenceRangeLow} – ${test.referenceRangeHigh} | Readings (newest first): ${readingsSummary} | Provide a 2-3 sentence plain-English interpretation of this trend. End with one recommended action starting with "Action:". Do not diagnose. Suggest consulting a doctor for concerning results.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();
      const interpretation = data.content[0].text;

      // Parse out the "Action:" sentence — split on "Action:" and take the second part if it exists
      const actionText = interpretation.includes('Action:') ? interpretation.split('Action:')[1].trim() : null;
      
      // Store full interpretation in state as aiInterpretation
      setAiInterpretation(interpretation);
      
      // Store action sentence in state as aiAction
      setAiAction(actionText || '');
      
      // Save aiInterpretation to Firestore on most recent reading
      if (readings.length > 0 && user) {
        await updateDoc(
          doc(db, `users/${user.uid}/tests/${testId}/readings/${readings[0].id}`),
          cleanData({ aiInterpretation: interpretation })
        );
      }

      // Save interpretation to Firestore
      if (readings.length > 0 && user) {
        await updateDoc(
          doc(db, 'users', user.uid, 'tests', testId!, 'readings', readings[0].id),
          cleanData({ aiInterpretation: interpretation })
        );
      }

      setAiInterpretation(interpretation);
    } catch (error) {
      console.error('Error getting AI interpretation:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  
  const handleAddReading = async () => {
    if (!user || !testId || !newReading.value) return;

    try {
      const readingData = {
        value: parseFloat(newReading.value),
        date: new Date(newReading.date).toISOString(),
        createdAt: new Date().toISOString(),
      };

      await addDoc(
        collection(db, 'users', user.uid, 'tests', testId, 'readings'),
        cleanData(readingData)
      );

      // Update next due date if reminder interval is set
      if (test?.reminderIntervalMonths) {
        const nextDueDate = new Date(newReading.date);
        nextDueDate.setMonth(nextDueDate.getMonth() + test.reminderIntervalMonths);
        
        await updateDoc(
          doc(db, 'users', user.uid, 'tests', testId),
          cleanData({ nextDueDate: nextDueDate.toISOString() })
        );
      }

      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error('Error adding reading:', error);
    }
  };

  const handleDeleteTest = async () => {
    if (!user || !testId) return;

    try {
      // Delete all readings first
      const readingsQuery = query(
        collection(db, 'users', user.uid, 'tests', testId, 'readings')
      );
      const readingsSnapshot = await getDocs(readingsQuery);
      
      for (const readingDoc of readingsSnapshot.docs) {
        await deleteDoc(doc(db, 'users', user.uid, 'tests', testId, 'readings', readingDoc.id));
      }

      // Delete the test document
      await deleteDoc(doc(db, 'users', user.uid, 'tests', testId));

      // Show toast and navigate back
      alert('Test deleted');
      navigate('/labs');
    } catch (error) {
      console.error('Error deleting test:', error);
      alert('Error deleting test');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Test not found</h1>
          <button
            onClick={() => navigate('/labs')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg"
          >
            Back to Labs
          </button>
        </div>
      </div>
    );
  }

  const latestReading = readings[0];
  const latestStatus = latestReading ? getTestStatus(latestReading.value) : null;
  const chartData = getChartData();

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Back Navigation Bar */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <button
          onClick={() => navigate('/labs')}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>Labs</span>
        </button>
        <h1 className="text-lg font-semibold">{test.name}</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={async () => {
              if (!user || !testId) return;
              try {
                await updateDoc(
                  doc(db, 'users', user.uid, 'tests', testId),
                  cleanData({ pinned: !test.pinned })
                );
                setTest(prev => prev ? { ...prev, pinned: !prev.pinned } : null);
                alert(test.pinned ? 'Unpinned' : 'Pinned to top');
              } catch (error) {
                console.error('Error updating pin status:', error);
              }
            }}
            className={`transition-colors ${test.pinned ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
            title={test.pinned ? 'Unpin' : 'Pin to top'}
          >
            📌
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-red-500 hover:text-red-400 transition-colors"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Latest Reading Card */}
        {latestReading && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Latest Reading</div>
            <div className="flex items-baseline space-x-2 mb-2">
              <span 
                className="text-3xl font-mono"
                style={{ color: latestStatus?.color }}
              >
                {latestReading.value}
              </span>
              <span className="text-sm text-slate-400">{test.unit}</span>
              {latestStatus && (
                <span 
                  className="px-2 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${latestStatus.color}20`, color: latestStatus.color }}
                >
                  {latestStatus.status}
                </span>
              )}
            </div>
            {test.referenceRangeLow !== null && test.referenceRangeHigh !== null ? (
              <div className="text-sm text-slate-400">
                Normal range: <span className="text-emerald-400">{test.referenceRangeLow} – {test.referenceRangeHigh} {test.unit}</span>
              </div>
            ) : (
              <div className="text-sm text-slate-400">Reference range not set</div>
            )}
            <div className="text-sm text-slate-400 mt-1">
              Tested {formatDate(latestReading.date, 'd MMM yyyy')}
            </div>
          </div>
        )}

        {/* Trend Chart */}
        <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Trend</h2>
            <div className="flex space-x-2">
              {(['6M', '1Y', 'All'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setSelectedRange(range)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    selectedRange === range
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {readings.length >= 2 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #374151' }}
                  labelStyle={{ color: '#f3f4f6' }}
                />
                {test.referenceRangeLow !== null && test.referenceRangeHigh !== null && (
                  <>
                    <ReferenceArea 
                      y1={test.referenceRangeLow} 
                      y2={test.referenceRangeHigh} 
                      fill="#10b981" 
                      fillOpacity={0.08}
                    />
                    <ReferenceLine 
                      y={test.referenceRangeHigh} 
                      stroke="#10b981" 
                      strokeDasharray="4 3" 
                      opacity={0.4}
                    />
                    <ReferenceLine 
                      y={test.referenceRangeLow} 
                      stroke="#10b981" 
                      strokeDasharray="4 3" 
                      opacity={0.4}
                    />
                  </>
                )}
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#f59e0b" 
                  strokeWidth={2}
                  dot={{ fill: '#f59e0b', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-slate-400">
              Not enough data for a chart — add more readings to see your trend
            </div>
          )}
        </div>

        {/* Interpret with AI */}
        <div 
          className="bg-slate-900 rounded-xl p-4 border border-slate-800 border-l-4"
          style={{ borderLeftColor: '#6366f1' }}
        >
          <button
            onClick={handleInterpret}
            disabled={isAnalyzing || readings.length === 0}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white">✦</span>
              </div>
              <div className="text-left">
                <div className="text-white font-semibold">Interpret with AI</div>
                <div className="text-slate-400 text-sm">Plain-English explanation of your {test.name} trend</div>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* AI Interpretation Result */}
        {aiInterpretation && (
          <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 rounded-xl p-4 border border-indigo-700">
            <div className="flex items-center space-x-2 mb-3">
              <span className="text-indigo-400">✦</span>
              <span className="text-indigo-300 font-semibold">AI Interpretation</span>
            </div>
            <div className="text-slate-200 text-sm leading-relaxed mb-3">
              {aiInterpretation}
            </div>
            {aiAction && (
              <div className="inline-block px-3 py-1 bg-amber-500/20 text-amber-400 rounded-full text-xs font-medium">
                {aiAction}
              </div>
            )}
          </div>
        )}

        {/* Reminder Section */}
        <div 
          className="bg-slate-900 rounded-xl p-4 border border-slate-800"
          onClick={() => {
            if (!reminderInterval) {
              setShowIntervalPicker(true);
            } else {
              setShowReminderSelector(!showReminderSelector);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Bell className="w-5 h-5 text-slate-400" />
              <div>
                <div className="text-white">
                  {reminderInterval 
                    ? `Remind every ${reminderInterval} month${reminderInterval > 1 ? 's' : ''}`
                    : 'Set reminder interval'
                  }
                </div>
                {test.nextDueDate && (
                  <div className="text-sm text-slate-400">
                    Next due: {formatDate(test.nextDueDate, 'd MMM yyyy')}
                  </div>
                )}
              </div>
            </div>
            <div className={`w-12 h-6 rounded-full transition-colors ${
              reminderEnabled ? 'bg-emerald-500' : 'bg-slate-700'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                reminderEnabled ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </div>
          </div>

          {showIntervalPicker && (
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="flex space-x-2 mb-3">
                {[1, 3, 6, 12].map((months) => (
                  <button
                    key={months}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!user) return;
                      
                      const selectedMonths = months === 12 ? 12 : months;
                      setReminderInterval(selectedMonths);
                      
                      // Calculate next due date
                      const latestReading = readings[0];
                      if (latestReading) {
                        const nextDueDate = new Date(latestReading.date);
                        nextDueDate.setMonth(nextDueDate.getMonth() + selectedMonths);
                        
                        // Save to Firestore
                        updateDoc(
                          doc(db, 'users', user.uid, 'tests', testId!),
                          cleanData({ 
                            reminderIntervalMonths: selectedMonths, 
                            nextDueDate: nextDueDate.toISOString() 
                          })
                        );
                      }
                      
                      setReminderEnabled(true);
                      setShowIntervalPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      reminderInterval === months ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {months === 1 ? '1M' : months === 12 ? '1Y' : `${months}M`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Readings History */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">History</h2>
          </div>
          
          {readings.length > 0 ? (
            <div className="space-y-2">
              {readings.map((reading) => {
                const status = getTestStatus(reading.value);
                return (
                  <div key={reading.id} className="bg-slate-900 rounded-lg p-3 border border-slate-800 flex items-center space-x-3">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: status.color }}
                    />
                    <div className="flex-1">
                      <div className="text-slate-400 text-sm">
                        {formatDate(reading.date, 'd MMM yyyy')}
                      </div>
                    </div>
                    <div className="font-mono text-sm" style={{ color: status.color }}>
                      {reading.value}
                    </div>
                    {reading.reportUrl ? (
                      <button
                        onClick={() => window.open(reading.reportUrl, '_blank')}
                        className="p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    ) : (
                      <div className="p-2 text-slate-600">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-900 rounded-lg p-8 border border-slate-800 text-center text-slate-400">
              No readings yet — upload a report or add manually
            </div>
          )}
        </div>

        {/* Add Reading Button */}
        <button
          onClick={() => setShowAddReading(!showAddReading)}
          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
        >
          <Plus className="w-5 h-5" />
          <span>Add Reading</span>
        </button>

        {/* Add Reading Modal */}
        {showAddReading && (
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <h3 className="text-lg font-semibold mb-4">Add Reading</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
                <input
                  type="date"
                  value={newReading.date}
                  onChange={(e) => setNewReading(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Value ({test.unit})</label>
                <input
                  type="number"
                  step="any"
                  value={newReading.value}
                  onChange={(e) => setNewReading(prev => ({ ...prev, value: e.target.value }))}
                  placeholder="Enter value"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleAddReading}
                  disabled={!newReading.value}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white py-2 rounded-lg font-medium transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowAddReading(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-white mb-2">Delete {test.name}?</h3>
            <p className="text-slate-400 text-sm mb-6">
              This will permanently remove all readings and history.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTest}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
