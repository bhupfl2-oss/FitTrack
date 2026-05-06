import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, TrendingUp, TrendingDown, AlertCircle, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import LabsModal from '@/components/LabsModal';
import { collection, query, orderBy, limit, getDocs, deleteDoc, doc, setDoc, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

interface LabTest {
  testName: string;
  value: number;
  unit: string;
}

interface LabResults {
  id: string;
  date: string;
  results: LabTest[];
  createdAt: any;
}

interface LabRanges {
  [key: string]: { min: number; max: number; unit: string };
}

interface LabTestCard {
  id: string;
  name: string;
  unit: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
  reminderIntervalMonths: number | null;
  nextDueDate: Date | null;
  latestReading: { value: number; date: Date; } | null;
}

const labRanges: LabRanges = {
  tsh: { min: 0.4, max: 4.0, unit: 'mIU/L' },
  vitD: { min: 30, max: 100, unit: 'ng/mL' },
  b12: { min: 200, max: 900, unit: 'pg/mL' },
  hb: { min: 13.5, max: 17.5, unit: 'g/dL' },
  hba1c: { min: 4, max: 5.6, unit: '%' },
  totalCholesterol: { min: 0, max: 200, unit: 'mg/dL' },
  ldl: { min: 0, max: 100, unit: 'mg/dL' },
  hdl: { min: 40, max: 1000, unit: 'mg/dL' }, // HDL has lower limit only
  triglycerides: { min: 0, max: 150, unit: 'mg/dL' },
  creatinine: { min: 0.7, max: 1.3, unit: 'mg/dL' },
};

// Helper function to get all unique test names across all entries
const getAllTestNames = (labResults: LabResults[]): string[] => {
  const testNames = new Set<string>();
  labResults.forEach(result => {
    if (result && result.results && Array.isArray(result.results)) {
      result.results.forEach(test => {
        if (test && test.testName) {
          testNames.add(test.testName);
        }
      });
    }
  });
  return Array.from(testNames).sort();
};

export default function Labs() {
  // v2 - new UI active
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [labResults, setLabResults] = useState<LabResults[]>([]);
  const [tests, setTests] = useState<LabTestCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchLabResults = async () => {
      try {
        // First, run migration to clean up malformed documents
        await cleanupMalformedDocuments();
        
        // Then fetch clean data
        const q = query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const querySnapshot = await getDocs(q);
        const allResults: any[] = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Filter out malformed entries
        const validResults = allResults.filter(entry => 
          entry && 
          entry.results && 
          Array.isArray(entry.results)
        ) as LabResults[];
        
        setLabResults(validResults);
      } catch (error) {
        console.error('Error fetching lab results:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLabResults();
  }, [user]);

  // New Firestore listener for tests collection
  useEffect(() => {
    if (!user) return;

    const fetchTests = async () => {
      try {
        const testsQuery = query(
          collection(db, 'users', user.uid, 'tests'),
          orderBy('createdAt', 'desc')
        );
        const testsSnapshot = await getDocs(testsQuery);
        
        const fetchedTests: LabTestCard[] = [];
        
        for (const testDoc of testsSnapshot.docs) {
          const testData = testDoc.data();
          
          // Fetch latest reading for this test
          const readingsQuery = query(
            collection(db, 'users', user.uid, 'tests', testDoc.id, 'readings'),
            orderBy('date', 'desc'),
            limit(1)
          );
          const readingsSnapshot = await getDocs(readingsQuery);
          
          const latestReading = readingsSnapshot.docs.length > 0 
            ? {
                value: readingsSnapshot.docs[0].data().value,
                date: new Date(readingsSnapshot.docs[0].data().date)
              }
            : null;
          
          fetchedTests.push({
            id: testDoc.id,
            name: testData.name,
            unit: testData.unit,
            referenceRangeLow: testData.referenceRangeLow || null,
            referenceRangeHigh: testData.referenceRangeHigh || null,
            reminderIntervalMonths: testData.reminderIntervalMonths || null,
            nextDueDate: testData.nextDueDate ? new Date(testData.nextDueDate) : null,
            latestReading
          });
        }
        
        setTests(fetchedTests);
      } catch (error) {
        console.error('Error fetching tests:', error);
      }
    };

    fetchTests();
  }, [user]);

  // Migration function for old lab data to new tests collection
  useEffect(() => {
    if (!user) return;

    const migrateLabData = async () => {
      // Only run migration if not already done
      if (localStorage.getItem('labsMigrated') === 'true') return;

      try {
        // Check if tests collection is empty
        const testsQuery = query(
          collection(db, 'users', user.uid, 'tests'),
          limit(1)
        );
        const testsSnapshot = await getDocs(testsQuery);
        
        if (!testsSnapshot.empty) {
          // Tests collection already has data, mark as migrated
          localStorage.setItem('labsMigrated', 'true');
          return;
        }

        // Read all existing lab results from the old collection
        const labsQuery = query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'),
          limit(100)
        );
        const labsSnapshot = await getDocs(labsQuery);
        
        const testMap = new Map<string, any>();
        const now = new Date().toISOString();

        for (const labDoc of labsSnapshot.docs) {
          const labData = labDoc.data();
          
          if (!labData.results || !Array.isArray(labData.results)) continue;

          for (const testResult of labData.results) {
            if (!testResult.testName || typeof testResult.value !== 'number') continue;

            const testName = testResult.testName;
            const unit = testResult.unit || '';

            // Find or create test document
            let testDoc = testMap.get(testName);
            if (!testDoc) {
              testDoc = {
                name: testName,
                unit: unit,
                referenceRangeLow: null,
                referenceRangeHigh: null,
                reminderIntervalMonths: null,
                nextDueDate: null,
                createdAt: now
              };
              testMap.set(testName, testDoc);
            }

            // Create test document in Firestore
            const testRef = doc(collection(db, 'users', user.uid, 'tests'));
            await setDoc(testRef, cleanData(testDoc));

            // Add reading to the test
            const readingData = {
              value: testResult.value,
              date: labData.date || labData.createdAt || now,
              reportUrl: null,
              createdAt: now
            };

            await addDoc(
              collection(db, 'users', user.uid, 'tests', testRef.id, 'readings'),
              cleanData(readingData)
            );
          }
        }

        // Mark migration as complete
        localStorage.setItem('labsMigrated', 'true');
        showToast('Lab data migrated to new format');

        // Refresh the tests data
        window.location.reload();

      } catch (error) {
        console.error('Error migrating lab data:', error);
      }
    };

    migrateLabData();
  }, [user]);

  // Migration function to clean up malformed documents
  const cleanupMalformedDocuments = async () => {
    if (!user) return;
    
    try {
      const q = query(
        collection(db, 'users', user.uid, 'labs'),
        limit(100) // Check up to 100 documents
      );
      const querySnapshot = await getDocs(q);
      
      const malformedDocs: string[] = [];
      
      querySnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (!data.results || !Array.isArray(data.results)) {
          malformedDocs.push(doc.id);
        }
      });
      
      // Delete malformed documents
      for (const docId of malformedDocs) {
        await deleteDoc(doc(db, 'users', user.uid, 'labs', docId));
        console.log('Deleted malformed lab document:', docId);
      }
      
      if (malformedDocs.length > 0) {
        console.log(`Cleaned up ${malformedDocs.length} malformed lab documents`);
      }
    } catch (error) {
      console.error('Error during cleanup migration:', error);
    }
  };

  const refreshData = () => {
    if (!user) return;
    setLoading(true);
    const fetchLabResults = async () => {
      try {
        // Run cleanup first
        await cleanupMalformedDocuments();
        
        const q = query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const querySnapshot = await getDocs(q);
        const allResults: any[] = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Filter out malformed entries
        const validResults = allResults.filter(entry => 
          entry && 
          entry.results && 
          Array.isArray(entry.results)
        ) as LabResults[];
        
        setLabResults(validResults);
      } catch (error) {
        console.error('Error fetching lab results:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLabResults();
  };

  const deleteEntry = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'labs', id));
      setLabResults(prev => prev.filter(result => result.id !== id));
    } catch (error) {
      console.error('Error deleting entry:', error);
    }
  };

  const calculateDelta = (current: number, previous: number | undefined, testName: string) => {
    if (previous === undefined || previous === 0) return null;
    const delta = current - previous;
    
    // Convert test name to metric key for ranges
    const getMetricKey = (name: string): string => {
      const keyMap: { [key: string]: string } = {
        'TSH': 'tsh',
        'Vit D': 'vitD',
        'B12': 'b12',
        'Hb': 'hb',
        'HbA1c': 'hba1c',
        'Total Cholesterol': 'totalCholesterol',
        'LDL': 'ldl',
        'HDL': 'hdl',
        'Triglycerides': 'triglycerides',
        'Creatinine': 'creatinine',
      };
      return keyMap[name] || name.toLowerCase();
    };
    
    const metric = getMetricKey(testName);
    
    // Metric-specific improvement logic
    let isImprovement = false;
    switch (metric) {
      case 'tsh':
      case 'hba1c':
      case 'totalcholesterol':
      case 'ldl':
      case 'triglycerides':
      case 'creatinine':
        // DOWN is better for these metrics
        isImprovement = delta < 0;
        break;
      case 'vitd':
      case 'b12':
      case 'hb':
      case 'hdl':
        // UP is better for these metrics
        isImprovement = delta > 0;
        break;
      default:
        // Default: UP is better for most metrics
        isImprovement = delta > 0;
    }
    
    return { value: delta, isImprovement };
  };

  const isOutOfRange = (value: number, testName: string) => {
    const getMetricKey = (name: string): string => {
      const keyMap: { [key: string]: string } = {
        'TSH': 'tsh',
        'Vit D': 'vitD',
        'B12': 'b12',
        'Hb': 'hb',
        'HbA1c': 'hba1c',
        'Total Cholesterol': 'totalCholesterol',
        'LDL': 'ldl',
        'HDL': 'hdl',
        'Triglycerides': 'triglycerides',
        'Creatinine': 'creatinine',
      };
      return keyMap[name] || name.toLowerCase();
    };
    
    const metric = getMetricKey(testName);
    const range = labRanges[metric];
    if (!range) return false;
    
    if (metric === 'hdl') {
      // HDL has only a lower limit
      return value < range.min;
    }
    
    return value < range.min || value > range.max;
  };

  const formatValue = (value: number | undefined, unit: string) => {
    if (value === undefined) return '--';
    const precision = unit === 'mIU/L' || unit === '%' || unit === 'mg/dL' && value < 10 ? 1 : 0;
    return `${value.toFixed(precision)}${unit}`;
  };

  const renderDelta = (current: number | undefined, previous: number | undefined, testName: string) => {
    if (current === undefined || previous === undefined) return null;
    
    const delta = calculateDelta(current, previous, testName);
    if (!delta) return null;
    
    const Icon = delta.isImprovement ? TrendingUp : TrendingDown;
    const color = delta.isImprovement ? 'text-emerald-500' : 'text-red-500';
    
    return (
      <div className="flex items-center space-x-1">
        <Icon className={`w-3 h-3 ${color}`} />
      </div>
    );
  };

  const getTestValue = (result: LabResults, testName: string): number | undefined => {
    if (!result || !result.results) return undefined;
    const test = result.results.find(t => t.testName === testName);
    return test?.value;
  };

  const getTestUnit = (result: LabResults, testName: string): string => {
    if (!result || !result.results) return '';
    const test = result.results.find(t => t.testName === testName);
    return test?.unit || '';
  };

  // Helper functions for test cards
  const getTestIcon = (testName: string): string => {
    const name = testName.toLowerCase();
    if (name.includes('tsh') || name.includes('t3') || name.includes('t4') || name.includes('thyroid')) return '🩸';
    if (name.includes('hba1c') || name.includes('blood sugar') || name.includes('glucose') || name.includes('fasting')) return '🍬';
    if (name.includes('vitamin d') || name.includes('vit d')) return '☀️';
    if (name.includes('vitamin b12') || name.includes('b12')) return '💊';
    if (name.includes('hemoglobin') || name.includes('hb') || name.includes('cbc')) return '🔴';
    if (name.includes('calcium')) return '🦴';
    if (name.includes('alt') || name.includes('ast') || name.includes('liver')) return '🫀';
    if (name.includes('testosterone')) return '⚡';
    if (name.includes('cholesterol') || name.includes('ldl') || name.includes('hdl') || name.includes('triglycerides')) return '🫁';
    return '🧪';
  };

  const getTestCategory = (testName: string): string => {
    const name = testName.toLowerCase();
    if (name.includes('tsh') || name.includes('t3') || name.includes('t4')) return 'Thyroid';
    if (name.includes('hba1c') || name.includes('glucose') || name.includes('blood sugar')) return 'Diabetes';
    if (name.includes('vitamin') || name.includes('calcium')) return 'Nutrition';
    if (name.includes('alt') || name.includes('ast') || name.includes('bilirubin')) return 'Liver';
    if (name.includes('testosterone')) return 'Hormones';
    return 'Blood Test';
  };

  const getTestStatus = (test: LabTestCard): { status: string; color: string; accentColor: string } => {
    if (!test.latestReading) {
      return { status: 'No readings yet', color: 'text-gray-500', accentColor: '#374151' };
    }

    const { value } = test.latestReading;
    const { referenceRangeLow, referenceRangeHigh } = test;

    if (referenceRangeLow === null && referenceRangeHigh === null) {
      return { status: '—', color: 'text-gray-500', accentColor: '#374151' };
    }

    const isCritical = referenceRangeHigh && value > referenceRangeHigh * 1.2 || 
                      referenceRangeLow && value < referenceRangeLow * 0.8;

    if (isCritical) {
      return { status: 'Critical', color: 'text-red-500', accentColor: '#ef4444' };
    }

    if (referenceRangeHigh && value > referenceRangeHigh) {
      return { status: '↑ High', color: 'text-amber-500', accentColor: '#f59e0b' };
    }

    if (referenceRangeLow && value < referenceRangeLow) {
      return { status: '↓ Low', color: 'text-blue-500', accentColor: '#3b82f6' };
    }

    return { status: '✓ Normal', color: 'text-green-500', accentColor: '#10b981' };
  };

  const getDueDateChip = (nextDueDate: Date | null): { text: string; color: string } => {
    if (!nextDueDate) return { text: '', color: '' };

    const now = new Date();
    const diffTime = nextDueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `Due ${Math.abs(diffDays)} days ago`, color: 'bg-red-500' };
    }

    if (diffDays <= 30) {
      return { text: `Due in ${diffDays} days`, color: 'bg-amber-500' };
    }

    const diffMonths = Math.floor(diffDays / 30);
    return { text: `Due in ${diffMonths} months`, color: 'bg-green-500' };
  };

  const sortTests = (tests: LabTestCard[]): LabTestCard[] => {
    return tests.sort((a, b) => {
      const aStatus = getTestStatus(a);
      const bStatus = getTestStatus(b);

      // Critical first
      if (aStatus.status === 'Critical' && bStatus.status !== 'Critical') return -1;
      if (bStatus.status === 'Critical' && aStatus.status !== 'Critical') return 1;

      // High/Low next
      const aIsOutOfRange = aStatus.status === '↑ High' || aStatus.status === '↓ Low';
      const bIsOutOfRange = bStatus.status === '↑ High' || bStatus.status === '↓ Low';
      if (aIsOutOfRange && !bIsOutOfRange) return -1;
      if (bIsOutOfRange && !aIsOutOfRange) return 1;

      // Overdue
      const aIsOverdue = a.nextDueDate && a.nextDueDate < new Date();
      const bIsOverdue = b.nextDueDate && b.nextDueDate < new Date();
      if (aIsOverdue && !bIsOverdue) return -1;
      if (bIsOverdue && !aIsOverdue) return 1;

      // Due soon
      const aIsDueSoon = a.nextDueDate && a.nextDueDate <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const bIsDueSoon = b.nextDueDate && b.nextDueDate <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      if (aIsDueSoon && !bIsDueSoon) return -1;
      if (bIsDueSoon && !aIsDueSoon) return 1;

      return 0;
    });
  };

  const showToast = (message: string) => {
    // Simple toast implementation - could be enhanced with a proper toast library
    console.log(message);
    alert(message);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Lab Results</h1>
            <p className="text-slate-400 text-sm">
              {tests.length > 0 ? `${tests.length} tests tracked` : 'No tests yet'}
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg hover:bg-emerald-600 transition-colors"
          >
            <Plus className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* Upload Report Button */}
        <button
          onClick={() => navigate('/labs/upload')}
          className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg p-4 flex items-center justify-between mb-6 hover:from-emerald-600 hover:to-emerald-700 transition-all"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center">
              <span className="text-lg">📄</span>
            </div>
            <div className="text-left">
              <div className="text-white font-semibold text-sm">Upload Lab Report</div>
              <div className="text-white/70 text-xs">AI auto-fills all test values</div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-white/60" />
        </button>

        {/* Test Cards List */}
        {tests.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Your Tests</h2>
              <div className="bg-slate-800 text-slate-300 px-2 py-1 rounded-full text-xs">
                {tests.length}
              </div>
            </div>
            
            <div className="space-y-3">
              {sortTests(tests).map((test) => {
                const status = getTestStatus(test);
                const dueChip = getDueDateChip(test.nextDueDate);
                const icon = getTestIcon(test.name);
                const category = getTestCategory(test.name);
                
                return (
                  <div
                    key={test.id}
                    onClick={() => navigate(`/labs/${test.id}`)}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center space-x-3 cursor-pointer hover:bg-slate-800 transition-colors"
                    style={{ borderLeft: `3px solid ${status.accentColor}` }}
                  >
                    {/* Test Icon */}
                    <div 
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${status.accentColor}15` }}
                    >
                      <span className="text-lg">{icon}</span>
                    </div>
                    
                    {/* Test Info */}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">{test.name}</div>
                      <div className="text-xs text-slate-400 mb-1">
                        {category} · {test.latestReading ? 
                          `${test.latestReading.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : 
                          'No readings'
                        }
                      </div>
                      {dueChip.text && (
                        <div className={`inline-block px-2 py-0.5 rounded-full text-xs text-white ${dueChip.color}`}>
                          {dueChip.text}
                        </div>
                      )}
                    </div>
                    
                    {/* Value & Status */}
                    <div className="text-right">
                      {test.latestReading ? (
                        <>
                          <div className="text-sm font-mono text-white">
                            {test.latestReading.value}
                            <span className="text-xs text-slate-400 ml-1">{test.unit}</span>
                          </div>
                          <div className={`text-xs ${status.color} mt-1`}>
                            {status.status}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-slate-400">No readings yet</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-800 text-center">
            <AlertCircle className="w-12 h-12 text-slate-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-white mb-2">No lab results yet</h3>
            <p className="text-slate-400 text-sm mb-4">
              Track your yearly blood tests to monitor your health trends over time
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 mx-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Add First Result</span>
            </button>
          </div>
        )}

        {/* Hidden old table */}
        {false && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-white mb-4">Legacy Table View</h3>
            {labResults.length > 0 ? (() => {
              const validEntries = labResults.filter(entry => 
                entry && 
                entry.results && 
                Array.isArray(entry.results)
              );
              
              if (validEntries.length === 0) {
                return (
                  <div className="bg-slate-900 rounded-lg p-8 border border-slate-800 text-center">
                    <AlertCircle className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-white mb-2">No valid lab results</h3>
                    <p className="text-slate-400 text-sm mb-4">
                      All lab entries were cleaned up. Add new results to get started.
                    </p>
                  </div>
                );
              }
              
              const allTestNames = getAllTestNames(validEntries);
              
              return (
                <div className="overflow-x-auto">
                  <table className="w-full bg-slate-900 rounded-lg border border-slate-800">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="sticky left-0 bg-slate-900 text-left p-3 text-sm font-medium text-slate-400 border-r border-slate-800">
                          Date
                        </th>
                        {allTestNames.map((testName) => (
                          <th key={testName} className="text-left p-3 text-sm font-medium text-slate-400 min-w-[120px]">
                            {testName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {validEntries.map((result, index) => {
                        const previousResult = validEntries[index + 1];
                        return (
                          <tr key={result.id} className="border-b border-slate-800 last:border-0">
                            <td className="sticky left-0 bg-slate-900 p-3 border-r border-slate-800">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-white">
                                  {new Date(result.date).toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </span>
                                <button
                                  onClick={() => deleteEntry(result.id)}
                                  className="text-slate-400 hover:text-red-400 p-1"
                                >
                                  <AlertCircle className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                            {allTestNames.map((testName) => {
                              const currentValue = getTestValue(result, testName);
                              const currentUnit = getTestUnit(result, testName);
                              const previousValue = getTestValue(previousResult, testName);
                              const outOfRange = currentValue !== undefined && isOutOfRange(currentValue, testName);
                              
                              return (
                                <td key={testName} className="p-3">
                                  <div className="flex items-center space-x-2">
                                    <span className={`text-sm ${
                                      outOfRange ? 'text-red-400 font-medium' : 'text-white'
                                    }`}>
                                      {formatValue(currentValue, currentUnit)}
                                    </span>
                                    {renderDelta(currentValue, previousValue, testName)}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })() : (
              <div className="bg-slate-900 rounded-lg p-8 border border-slate-800 text-center">
                <AlertCircle className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-white mb-2">No lab results yet</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Track your yearly blood tests to monitor your health trends over time
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      <LabsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={refreshData}
      />
    </div>
  );
}
