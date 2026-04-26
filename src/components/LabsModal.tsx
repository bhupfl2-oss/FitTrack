import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

interface LabsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface LabTest {
  testName: string;
  value: string;
  unit: string;
}

const commonTests = [
  { name: 'ALT', unit: 'U/L' },
  { name: 'AST', unit: 'U/L' },
  { name: 'B12', unit: 'pg/mL' },
  { name: 'Bilirubin', unit: 'mg/dL' },
  { name: 'Calcium', unit: 'mg/dL' },
  { name: 'Creatinine', unit: 'mg/dL' },
  { name: 'Fasting Glucose', unit: 'mg/dL' },
  { name: 'Ferritin', unit: 'ng/mL' },
  { name: 'Folate', unit: 'ng/mL' },
  { name: 'HbA1c', unit: '%' },
  { name: 'HDL', unit: 'mg/dL' },
  { name: 'Hb', unit: 'g/dL' },
  { name: 'Insulin', unit: 'µIU/mL' },
  { name: 'LDL', unit: 'mg/dL' },
  { name: 'Potassium', unit: 'mmol/L' },
  { name: 'Sodium', unit: 'mmol/L' },
  { name: 'TSH', unit: 'mIU/L' },
  { name: 'Total Cholesterol', unit: 'mg/dL' },
  { name: 'Triglycerides', unit: 'mg/dL' },
  { name: 'Uric Acid', unit: 'mg/dL' },
  { name: 'Vit D', unit: 'ng/mL' },
];

export default function LabsModal({ isOpen, onClose, onSave }: LabsModalProps) {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [customTests, setCustomTests] = useState<{ name: string; unit: string }[]>([]);
  const [newCustomTestName, setNewCustomTestName] = useState('');
  const [newCustomTestUnit, setNewCustomTestUnit] = useState('');
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [testRows, setTestRows] = useState<LabTest[]>([{ testName: '', value: '', unit: '' }]);

  useEffect(() => {
    if (!user || !isOpen) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, 'users', user.uid, 'customTests'));
        const tests = snap.docs.map(d => ({ name: d.data().name as string, unit: (d.data().unit || '') as string }));
        console.log('Loaded custom tests:', tests);
        setCustomTests(tests);
      } catch (e) {
        console.error('Failed to load custom tests:', e);
      }
    };
    fetch();
  }, [user, isOpen]);

  const allOptions = [
    ...commonTests,
    ...customTests.filter(ct => !commonTests.find(c => c.name === ct.name)),
  ];

  const getUnit = (name: string) => allOptions.find(t => t.name === name)?.unit || '';

  const updateRow = (i: number, field: keyof LabTest, val: string) => {
    setTestRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  };

  const addRow = () => setTestRows(prev => [...prev, { testName: '', value: '', unit: '' }]);
  const removeRow = (i: number) => setTestRows(prev => prev.filter((_, idx) => idx !== i));

  const saveCustomTest = async () => {
    if (!user || !newCustomTestName.trim()) return;
    const name = newCustomTestName.trim();
    if (allOptions.find(t => t.name === name)) {
      alert('Test already exists');
      return;
    }
    try {
      await addDoc(collection(db, 'users', user.uid, 'customTests'), cleanData({
        name,
        unit: newCustomTestUnit.trim(),
        createdAt: serverTimestamp(),
      }));
      setCustomTests(prev => [...prev, { name, unit: newCustomTestUnit.trim() }]);
      setNewCustomTestName('');
      setNewCustomTestUnit('');
      setIsAddingCustom(false);
      console.log('Saved custom test:', name);
    } catch (e) {
      console.error('Error saving custom test:', e);
      alert('Failed to save custom test');
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const valid = testRows.filter(r => r.testName && r.value);
      if (valid.length === 0) return;
      await addDoc(collection(db, 'users', user.uid, 'labs'), cleanData({
        date,
        results: valid.map(r => ({
          testName: r.testName,
          value: parseFloat(r.value) || null,
          unit: r.unit || getUnit(r.testName),
        })),
        createdAt: serverTimestamp(),
      }));
      onSave();
      onClose();
      setDate(new Date().toISOString().split('T')[0]);
      setTestRows([{ testName: '', value: '', unit: '' }]);
    } catch (e) {
      console.error('Error saving lab results:', e);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50 pb-16">
      <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[calc(100vh-80px)] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">Add Lab Results</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Add custom test — ALWAYS VISIBLE SECTION */}
          <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-emerald-400">Add Custom Test</p>
              <button
                onClick={() => setIsAddingCustom(v => !v)}
                className="text-xs text-emerald-500 underline"
              >
                {isAddingCustom ? 'Cancel' : '+ New'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {customTests.length === 0
                ? 'No custom tests yet. Click + New to add one.'
                : `${customTests.length} custom test${customTests.length > 1 ? 's' : ''}: ${customTests.map(t => t.name).join(', ')}`}
            </p>
            {isAddingCustom && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Test name (e.g. Testosterone)"
                  value={newCustomTestName}
                  onChange={e => setNewCustomTestName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Unit (e.g. ng/dL)"
                    value={newCustomTestUnit}
                    onChange={e => setNewCustomTestUnit(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={saveCustomTest}
                    disabled={!newCustomTestName.trim()}
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Test rows */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-slate-400">Test Results</p>
              <button
                onClick={addRow}
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-white text-xs px-3 py-1.5 rounded-lg"
              >
                <Plus className="w-3 h-3" /> Add Test
              </button>
            </div>
            <div className="space-y-2">
              {testRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.testName}
                    onChange={e => {
                      updateRow(i, 'testName', e.target.value);
                      updateRow(i, 'unit', getUnit(e.target.value));
                    }}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select test...</option>
                    <optgroup label="Common Tests">
                      {commonTests.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </optgroup>
                    {customTests.length > 0 && (
                      <optgroup label="My Custom Tests">
                        {customTests.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Value"
                    value={row.value}
                    onChange={e => updateRow(i, 'value', e.target.value)}
                    className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  {testRows.length > 1 && (
                    <button onClick={() => removeRow(i)} className="text-slate-500 hover:text-red-400 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={isSaving || !date || testRows.filter(r => r.testName && r.value).length === 0}
            className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl"
          >
            {isSaving ? 'Saving...' : 'Save Results'}
          </button>
        </div>
      </div>
    </div>
  );
}