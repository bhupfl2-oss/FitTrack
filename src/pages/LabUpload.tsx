import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Upload, X, Check, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { 
  collection, 
  query, 
  getDocs, 
  doc, 
  setDoc, 
  addDoc,
  serverTimestamp,
  orderBy 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface ExtractedTest {
  testName: string;
  value: number;
  unit: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
}

interface ExtractedData {
  labName: string | null;
  reportDate: string | null;
  tests: ExtractedTest[];
  summary: string;
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

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    
    // Auto-trigger extraction after 500ms
    setTimeout(() => {
      handleExtract(file);
    }, 500);
  };

  const handleExtract = async (file: File) => {
    setIsExtracting(true);
    
    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // strip data:...;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Determine media type
      const mediaType = file.type === 'application/pdf' ? 'application/pdf' : file.type;

      // Build content array for Claude API
      const fileContent = file.type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

      // Call Claude API
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
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              fileContent,
              {
                type: 'text',
                text: `Extract all lab test results from this report. Return ONLY a JSON object, no markdown, no preamble. Use this exact schema:
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
- Do not include any text outside the JSON object`
              }
            ]
          }]
        })
      });

      // Add detailed error logging
      console.log('API response status:', response.status);
      const responseText = await response.text();
      console.log('API response body:', responseText);

      // Then parse it:
      const data = JSON.parse(responseText);
      const rawText = data.content[0].text;

      // Parse JSON — strip any accidental markdown fences
      const clean = rawText.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(clean);

      setExtractedData(extracted);
      setSelectedDate(extracted.reportDate || new Date().toISOString().split('T')[0]);
      
    } catch (error) {
      console.error('Error extracting data:', error);
      alert('Could not read report — try a clearer image or manually add tests');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!extractedData || !user || !selectedFile) return;
    
    setIsSaving(true);
    
    try {
      // Uploads original file to Firebase Storage
      let fileDownloadUrl: string | null = null;
      try {
        const { getStorage } = await import('firebase/storage');
        const storage = getStorage();
        const uid = user.uid;
        const ext = selectedFile.name.split('.').pop() || 'pdf';
        const storageRef = ref(storage, `users/${uid}/reports/${Date.now()}.${ext}`);
        const uploadResult = await uploadBytes(storageRef, selectedFile);
        fileDownloadUrl = await getDownloadURL(uploadResult.ref);
      } catch (e) {
        console.warn('Storage upload skipped:', e);
      }

      // Get all existing tests to check for duplicates
      const testsQuery = query(
        collection(db, 'users', user.uid, 'tests'),
        orderBy('createdAt', 'desc')
      );
      const testsSnapshot = await getDocs(testsQuery);
      const existingTests = testsSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name.toLowerCase(),
        data: doc.data()
      }));

      let savedCount = 0;

      for (const test of extractedData.tests) {
        // Check if test already exists (case-insensitive)
        const existingTest = existingTests.find(t => t.name === test.testName.toLowerCase());
        const testId = existingTest?.id || doc(collection(db, 'users', user.uid, 'tests')).id;

        // Create or update test document
        const testData = existingTest?.data || {};
        const updatedTestData = {
          name: test.testName,
          unit: test.unit,
          referenceRangeLow: test.referenceRangeLow ?? testData.referenceRangeLow ?? null,
          referenceRangeHigh: test.referenceRangeHigh ?? testData.referenceRangeHigh ?? null,
          reminderIntervalMonths: testData.reminderIntervalMonths || null,
          nextDueDate: testData.nextDueDate || null,
          createdAt: testData.createdAt || serverTimestamp()
        };

        await setDoc(
          doc(db, 'users', user.uid, 'tests', testId),
          cleanData(updatedTestData)
        );

        // Add reading to the test
        const readingData = {
          value: test.value,
          date: new Date(selectedDate).toISOString(),
          reportUrl: fileDownloadUrl,
          createdAt: serverTimestamp()
        };

        await addDoc(
          collection(db, 'users', user.uid, 'tests', testId, 'readings'),
          cleanData(readingData)
        );

        savedCount++;
      }

      alert(`${savedCount} tests saved successfully`);
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
    
    const updatedTests = [...extractedData.tests];
    updatedTests.splice(index, 1);
    
    setExtractedData({
      ...extractedData,
      tests: updatedTests
    });
  };

  const formatFileSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

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
        <h1 className="text-lg font-semibold">Upload Report</h1>
        <div className="w-16" /> {/* Spacer for centering */}
      </div>

      <div className="p-4 space-y-4">
        {!extractedData ? (
          <>
            {/* Section 1 - File Upload Zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-500 hover:bg-slate-900/50 transition-all"
            >
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">
                Tap to upload your lab report
              </h2>
              <p className="text-slate-400 mb-4">
                Supports PDF and images · Multi-page reports handled automatically
              </p>
              <div className="flex justify-center space-x-4">
                <div className="bg-slate-800 px-3 py-1 rounded-lg text-sm">
                  📄 PDF
                </div>
                <div className="bg-slate-800 px-3 py-1 rounded-lg text-sm">
                  🖼️ JPG / PNG
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/jpg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              className="hidden"
            />

            {/* File Preview Card */}
            {selectedFile && (
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      selectedFile.type === 'application/pdf' ? 'bg-red-500/20' : 'bg-blue-500/20'
                    }`}>
                      <span className="text-lg">{selectedFile.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                    </div>
                    <div>
                      <div className="text-white font-medium">{selectedFile.name}</div>
                      <div className="text-slate-400 text-sm">{formatFileSize(selectedFile.size)}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setIsExtracting(false);
                    }}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Section 2 - Processing State */}
            {isExtracting && (
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-white font-medium">AI is reading your report…</div>
                      <div className="text-slate-400 text-sm">Extracting test names, values & reference ranges</div>
                    </div>
                  </div>
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Section 3 - Review Screen */}
            {/* Success Header Card */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
                  <Check className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-emerald-400 font-semibold">
                    {extractedData.tests.length} tests extracted
                  </div>
                  <div className="text-slate-400 text-sm">
                    {extractedData.labName ?? 'Lab report'} · {extractedData.reportDate ?? 'Date not detected'}
                  </div>
                </div>
              </div>
            </div>

            {/* AI Summary Card */}
            {extractedData.summary && (
              <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 rounded-xl p-4 border border-indigo-700">
                <div className="flex items-center space-x-2 mb-3">
                  <span className="text-indigo-400">✦</span>
                  <span className="text-indigo-300 font-semibold">Quick Summary</span>
                </div>
                <div className="text-slate-200 text-sm leading-relaxed">
                  {extractedData.summary}
                </div>
              </div>
            )}

            {/* Editable Tests Table */}
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <div className="grid grid-cols-4 gap-4 mb-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                <div>Test</div>
                <div>Value</div>
                <div>Range</div>
                <div></div>
              </div>
              
              <div className="space-y-2">
                {extractedData.tests.map((test, index) => (
                  <div key={index} className="grid grid-cols-4 gap-4 items-center py-2 border-t border-slate-800">
                    <input
                      type="text"
                      value={test.testName}
                      onChange={(e) => {
                        const updatedTests = [...extractedData.tests];
                        updatedTests[index] = { ...test, testName: e.target.value };
                        setExtractedData({ ...extractedData, tests: updatedTests });
                      }}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-sm"
                    />
                    <div className="text-white text-sm">
                      {test.value} {test.unit}
                    </div>
                    <div className="text-slate-400 text-sm">
                      {test.referenceRangeLow !== null && test.referenceRangeHigh !== null
                        ? `${test.referenceRangeLow}–${test.referenceRangeHigh}`
                        : '—'
                      }
                    </div>
                    <button
                      onClick={() => removeTest(index)}
                      className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Date Field */}
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Test Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            {/* Action Buttons */}
            <button
              onClick={handleSave}
              disabled={isSaving || extractedData.tests.length === 0}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              <span>{isSaving ? 'Saving...' : `Save All ${extractedData.tests.length} Tests →`}</span>
            </button>

            <button
              onClick={() => navigate('/labs')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg font-medium transition-colors"
            >
              Add more tests manually
            </button>
          </>
        )}
      </div>
    </div>
  );
}
