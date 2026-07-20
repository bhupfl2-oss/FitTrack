import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Upload, X, Check, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { 
  collection, query, getDocs, doc, setDoc, addDoc,
  serverTimestamp, orderBy, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { bumpDataVersion } from '@/lib/dataVersion';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { callAI } from '@/lib/callAI';

interface ExtractedTest {
  testName: string;
  value: number;
  unit: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
  recommended: boolean;   // true = regular/important, false = situational
  reason?: string;        // why it's recommended or not
}

interface ExtractedData {
  labName: string | null;
  reportDate: string | null;
  tests: ExtractedTest[];
  summary: string;
}

// Tests that are always worth tracking long-term
const REGULAR_TESTS = [
  'tsh', 'ft3', 'ft4', 't3', 't4',
  'hba1c', 'fasting glucose', 'blood sugar', 'fasting blood sugar',
  'vitamin d', 'vit d', '25-oh vitamin d',
  'vitamin b12', 'b12', 'cobalamin',
  'hemoglobin', 'hb', 'haemoglobin',
  'total cholesterol', 'cholesterol',
  'ldl', 'hdl', 'triglycerides', 'vldl',
  'creatinine', 'urea', 'bun',
  'alt', 'ast', 'sgpt', 'sgot', 'alp', 'ggt',
  'uric acid',
  'calcium', 'phosphorus', 'magnesium',
  'iron', 'ferritin', 'tibc',
  'testosterone', 'cortisol', 'insulin',
  'rbc', 'wbc', 'platelets', 'hematocrit', 'mcv', 'mch',
];

// One-off / situational tests — suggest not storing
const SITUATIONAL_TESTS = [
  'dengue', 'ns1', 'dengue igm', 'dengue igg',
  'malaria', 'plasmodium',
  'covid', 'sars-cov', 'covid antigen',
  'crp', 'c-reactive protein',
  'widal', 'typhoid',
  'aso titre', 'antistreptolysin',
  'leptospira',
  'hepatitis a', 'hav',
  'ebola', 'chikungunya',
  'culture', 'sensitivity',
  'procalcitonin',
];

function classifyTest(testName: string): { recommended: boolean; reason: string } {
  const lower = testName.toLowerCase();
  
  if (SITUATIONAL_TESTS.some(s => lower.includes(s))) {
    return { recommended: false, reason: 'Situational test — usually one-off when sick' };
  }
  if (REGULAR_TESTS.some(r => lower.includes(r))) {
    return { recommended: true, reason: 'Regular health marker — worth tracking over time' };
  }
  // Default: recommend storing unknown tests
  return { recommended: true, reason: 'Health marker — can be useful to track' };
}

export default function LabUpload() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  // Track which tests are selected for saving
  const [selectedTests, setSelectedTests] = useState<Set<number>>(new Set());

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setTimeout(() => handleExtract(file), 500);
  };

  const handleExtract = async (file: File) => {
    setIsExtracting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const mediaType = file.type === 'application/pdf' ? 'application/pdf' : file.type;
      const promptText = `Extract all lab test results from this report. Return ONLY a JSON object, no markdown, no preamble. Use this exact schema:
{
  "labName": "name of the lab or hospital if visible, else null",
  "reportDate": "YYYY-MM-DD format of the sample collection date, else null",
  "tests": [
    {
      "testName": "exact test name",
      "value": numeric value only as a number,
      "unit": "unit string",
      "referenceRangeLow": numeric low end of normal range or null,
      "referenceRangeHigh": numeric high end of normal range or null
    }
  ],
  "summary": "2-3 sentence overview of notable findings"
}
Rules:
- Only include tests with a numeric value
- Skip header rows, reference-only rows, non-numeric results
- If a test appears on multiple pages, include it once with the numeric value
- reportDate should be collection/sample date, not report generation date
- Do not include any text outside the JSON object`;

      // ROLLBACK: previous Anthropic implementation
      // const fileContent = file.type === 'application/pdf'
      //   ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      //   : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
      // const response = await fetch('https://api.anthropic.com/v1/messages', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      //     'anthropic-version': '2023-06-01',
      //     'anthropic-dangerous-direct-browser-access': 'true',
      //   },
      //   body: JSON.stringify({
      //     model: 'claude-sonnet-4-6',
      //     max_tokens: 2000,
      //     messages: [{
      //       role: 'user',
      //       content: [fileContent, { type: 'text', text: promptText }]
      //     }]
      //   })
      // });
      // const data = await response.json();
      // const rawText = data.content[0].text;

      const model = 'gemini-flash-latest';
      const { text: rawText, usage } = await callAI({
        model,
        contents: [
          { inlineData: { mimeType: mediaType, data: base64 } },
          { text: promptText },
        ],
        maxTokens: 2000,
        thinkingBudget: 0,
      });

      if (user) {
        // Best-effort usage log — must never block extraction.
        try {
          await addDoc(collection(db, 'users', user.uid, 'aiUsageLogs'), {
            callType: 'lab_upload_extract',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            model,
            planId: null,
            createdAt: serverTimestamp(),
          });
        } catch (e) {
          console.warn('[LabUpload] Failed to write usage log:', e);
        }
      }

      const clean = rawText.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(clean);

      // Classify each test as regular or situational
      const classifiedTests: ExtractedTest[] = extracted.tests.map((t: any) => ({
        ...t,
        ...classifyTest(t.testName),
      }));

      const result: ExtractedData = { ...extracted, tests: classifiedTests };
      setExtractedData(result);
      setSelectedDate(extracted.reportDate || new Date().toISOString().split('T')[0]);

      // Pre-select only recommended tests
      const preSelected = new Set<number>();
      classifiedTests.forEach((t, i) => { if (t.recommended) preSelected.add(i); });
      setSelectedTests(preSelected);

    } catch (error) {
      console.error('Error extracting data:', error);
      alert('Could not read report — try a clearer image or manually add tests');
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleTest = (index: number) => {
    setSelectedTests(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleSave = async () => {
    if (!extractedData || !user || !selectedFile) return;
    setIsSaving(true);
    
    try {
      // Upload file to Storage
      let fileDownloadUrl: string | null = null;
      try {
        const { getStorage } = await import('firebase/storage');
        const storage = getStorage();
        const ext = selectedFile.name.split('.').pop() || 'pdf';
        const storageRef = ref(storage, `users/${user.uid}/reports/${Date.now()}.${ext}`);
        const uploadResult = await uploadBytes(storageRef, selectedFile);
        fileDownloadUrl = await getDownloadURL(uploadResult.ref);
      } catch (e) { console.warn('Storage upload skipped:', e); }

      // Get existing tests for dedup
      const testsSnapshot = await getDocs(
        query(collection(db, 'users', user.uid, 'tests'), orderBy('createdAt', 'desc'))
      );
      const existingTests = testsSnapshot.docs.map(d => ({
        id: d.id,
        name: d.data().name.toLowerCase(),
        data: d.data(),
      }));

      const testsToSave = extractedData.tests.filter((_, i) => selectedTests.has(i));
      let savedCount = 0;
      let skippedCount = 0;

      for (const test of testsToSave) {
        // Find or create test doc
        const existingTest = existingTests.find(t => t.name === test.testName.toLowerCase().trim());
        const testId = existingTest?.id || doc(collection(db, 'users', user.uid, 'tests')).id;
        const testData = existingTest?.data || {};

        await setDoc(
          doc(db, 'users', user.uid, 'tests', testId),
          cleanData({
            name: test.testName,
            unit: test.unit,
            referenceRangeLow: test.referenceRangeLow ?? testData.referenceRangeLow ?? null,
            referenceRangeHigh: test.referenceRangeHigh ?? testData.referenceRangeHigh ?? null,
            reminderIntervalMonths: testData.reminderIntervalMonths || null,
            nextDueDate: testData.nextDueDate || null,
            createdAt: testData.createdAt || serverTimestamp(),
          })
        );

        // Check for duplicate reading on same date
        const existingReadings = await getDocs(
          query(
            collection(db, 'users', user.uid, 'tests', testId, 'readings'),
            where('date', '==', new Date(selectedDate).toISOString())
          )
        );

        if (!existingReadings.empty) {
          skippedCount++;
          continue; // Skip — already have a reading for this date
        }

        await addDoc(
          collection(db, 'users', user.uid, 'tests', testId, 'readings'),
          cleanData({
            value: test.value,
            date: new Date(selectedDate).toISOString(),
            reportUrl: fileDownloadUrl,
            createdAt: serverTimestamp(),
          })
        );
        savedCount++;
      }

      const msg = skippedCount > 0
        ? `${savedCount} tests saved. ${skippedCount} skipped (already logged for this date).`
        : `${savedCount} tests saved successfully.`;
      alert(msg);
      await bumpDataVersion(user.uid);
      navigate('/labs');

    } catch (error) {
      console.error('Error saving tests:', error);
      alert('Error saving tests — please try again');
    } finally {
      setIsSaving(false);
    }
  };

  const removeTest = (index: number) => {
    if (!extractedData) return;
    const updated = extractedData.tests.filter((_, i) => i !== index);
    setExtractedData({ ...extractedData, tests: updated });
    setSelectedTests(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  const formatFileSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const recommendedTests = extractedData?.tests.filter(t => t.recommended) || [];
  const situationalTests = extractedData?.tests.filter(t => !t.recommended) || [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <button onClick={() => navigate('/labs')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" /><span>Labs</span>
        </button>
        <h1 className="text-lg font-semibold">Upload Report</h1>
        <div className="w-16" />
      </div>

      <div className="p-4 space-y-4 pb-24">
        {!extractedData ? (
          <>
            <div onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-500 hover:bg-slate-900/50 transition-all">
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Tap to upload your lab report</h2>
              <p className="text-slate-400 mb-4">Supports PDF and images · AI extracts all values</p>
              <div className="flex justify-center gap-3">
                <div className="bg-slate-800 px-3 py-1 rounded-lg text-sm">📄 PDF</div>
                <div className="bg-slate-800 px-3 py-1 rounded-lg text-sm">🖼️ JPG / PNG</div>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/jpg"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} className="hidden" />

            {selectedFile && (
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedFile.type === 'application/pdf' ? 'bg-red-500/20' : 'bg-blue-500/20'}`}>
                    <span>{selectedFile.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                  </div>
                  <div>
                    <div className="text-white font-medium">{selectedFile.name}</div>
                    <div className="text-slate-400 text-sm">{formatFileSize(selectedFile.size)}</div>
                  </div>
                </div>
                <button onClick={() => { setSelectedFile(null); setIsExtracting(false); }} className="p-2 text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            {isExtracting && (
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <div className="text-white font-medium">AI is reading your report…</div>
                  <div className="text-slate-400 text-sm">Extracting test names, values & classifying</div>
                </div>
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Success header */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
                <Check className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-emerald-400 font-semibold">{extractedData.tests.length} tests found</div>
                <div className="text-slate-400 text-sm">{extractedData.labName ?? 'Lab report'} · {extractedData.reportDate ?? 'Date not detected'}</div>
              </div>
            </div>

            {/* AI Summary */}
            {extractedData.summary && (
              <div className="bg-indigo-900/30 rounded-xl p-4 border border-indigo-700">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-indigo-400">✦</span>
                  <span className="text-indigo-300 font-semibold text-sm">Quick Summary</span>
                </div>
                <p className="text-slate-200 text-xs leading-relaxed">{extractedData.summary}</p>
              </div>
            )}

            {/* Date */}
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Test Date</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500" />
            </div>

            {/* Regular tests */}
            {recommendedTests.length > 0 && (
              <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-white">Regular health markers</span>
                    <p className="text-[10px] text-slate-500 mt-0.5">Worth tracking over time — pre-selected</p>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    {recommendedTests.filter((_, i) => selectedTests.has(extractedData.tests.indexOf(recommendedTests[i]))).length} / {recommendedTests.length} selected
                  </span>
                </div>
                {recommendedTests.map((test) => {
                  const globalIdx = extractedData.tests.indexOf(test);
                  const isSelected = selectedTests.has(globalIdx);
                  return (
                    <div key={globalIdx} className={`flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 last:border-0 ${isSelected ? '' : 'opacity-50'}`}>
                      <button onClick={() => toggleTest(globalIdx)}
                        className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{test.testName}</p>
                        <p className="text-[10px] text-slate-500">{test.reason}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-sm font-mono text-white">{test.value}</span>
                        <span className="text-xs text-slate-400 ml-1">{test.unit}</span>
                        {test.referenceRangeLow !== null && test.referenceRangeHigh !== null && (
                          <p className="text-[9px] text-slate-600">{test.referenceRangeLow}–{test.referenceRangeHigh}</p>
                        )}
                      </div>
                      <button onClick={() => removeTest(globalIdx)} className="text-slate-600 hover:text-red-400 p-1 flex-shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Situational tests */}
            {situationalTests.length > 0 && (
              <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
                <div className="px-4 py-3 border-b border-slate-800">
                  <span className="text-sm font-semibold text-white">Situational tests</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">Usually one-off — we suggest not storing these, but you can include them</p>
                </div>
                {situationalTests.map((test) => {
                  const globalIdx = extractedData.tests.indexOf(test);
                  const isSelected = selectedTests.has(globalIdx);
                  return (
                    <div key={globalIdx} className={`flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 last:border-0 ${isSelected ? '' : 'opacity-40'}`}>
                      <button onClick={() => toggleTest(globalIdx)}
                        className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-slate-600'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{test.testName}</p>
                        <p className="text-[10px] text-amber-600">{test.reason}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-sm font-mono text-white">{test.value}</span>
                        <span className="text-xs text-slate-400 ml-1">{test.unit}</span>
                      </div>
                      <button onClick={() => removeTest(globalIdx)} className="text-slate-600 hover:text-red-400 p-1 flex-shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Save */}
            <button onClick={handleSave}
              disabled={isSaving || selectedTests.size === 0}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
              {isSaving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{isSaving ? 'Saving…' : `Save ${selectedTests.size} Selected Tests →`}</span>
            </button>

            <button onClick={() => navigate('/labs')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}