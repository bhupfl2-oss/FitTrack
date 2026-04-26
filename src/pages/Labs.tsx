import { useState, useEffect } from 'react';
import { Plus, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import LabsModal from '@/components/LabsModal';
import { collection, query, orderBy, limit, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [labResults, setLabResults] = useState<LabResults[]>([]);
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
        <h1 className="text-2xl font-bold text-white mb-6">Labs</h1>

        {labResults.length > 0 ? (() => {
          // Additional safety filter to ensure only valid entries are processed
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
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 mx-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add First Result</span>
                </button>
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
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 mx-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Add First Result</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating + Button */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-24 right-6 w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg hover:bg-emerald-600 transition-colors z-40"
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      {/* Modal */}
      <LabsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={refreshData}
      />
    </div>
  );
}
