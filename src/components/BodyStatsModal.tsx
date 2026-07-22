import { useState, useEffect, useRef } from 'react';
import { X, Plus, ChevronLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, updateDoc, doc, serverTimestamp, setDoc, getDoc } from 'firebase/firestore';
import { bumpDataVersion } from '@/lib/dataVersion';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';
import { calculateGoalsWithAI } from '@/services/goalsService';
import { callAI } from '@/lib/callAI';

interface BodyStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editData?: {
    id: string;
    date: string;
    weightKg: number;
    pbf: number;
    smm?: number;
    legLeanMass?: number;
    ecwRatio?: number;
    customFields?: { name: string; unit: string; value: number }[];
  };
}

interface BodyStats {
  date: string;
  weightKg: string;
  pbf: string;
  smm: string;
  legLeanMass: string;
  ecwRatio: string;
}

interface CustomField {
  id: string;
  name: string;
  unit: string;
  value: string;
}

interface CustomFieldDef {
  name: string;
  unit: string;
}

export default function BodyStatsModal({ isOpen, onClose, onSave, editData }: BodyStatsModalProps) {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState<BodyStats>({
    date: new Date().toISOString().split('T')[0],
    weightKg: '',
    pbf: '',
    smm: '',
    legLeanMass: '',
    ecwRatio: '',
  });
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [showAddFieldDropdown, setShowAddFieldDropdown] = useState(false);
  const [addFieldSearch, setAddFieldSearch] = useState('');
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toStr = (val: number | null | undefined): string => {
    if (val == null || isNaN(Number(val))) return '';
    return String(val);
  };

  // Fetch custom field definitions
  useEffect(() => {
    if (!user || !isOpen) return;
    const fetchCustomFieldDefs = async () => {
      try {
        const configDoc = await getDoc(doc(db, 'users', user.uid, 'config', 'bodyCompConfig'));
        if (configDoc.exists()) {
          const data = configDoc.data();
          setCustomFieldDefs(data.customFieldDefs || []);
        }
      } catch (error) {
        console.error('Error fetching custom field definitions:', error);
      }
    };
    fetchCustomFieldDefs();
  }, [user, isOpen]);

  // Initialize form with edit data when provided
  useEffect(() => {
    if (editData) {
      setStats({
        date: editData.date,
        weightKg: toStr(editData.weightKg),
        pbf: toStr(editData.pbf),
        smm: toStr(editData.smm),
        legLeanMass: toStr(editData.legLeanMass),
        ecwRatio: toStr(editData.ecwRatio),
      });
      if (editData.customFields) {
        setCustomFields(editData.customFields.map((field, index) => ({
          id: `custom-${index}`,
          name: field.name,
          unit: field.unit,
          value: toStr(field.value),
        })));
      } else {
        setCustomFields([]);
      }
    } else {
      setStats({
        date: new Date().toISOString().split('T')[0],
        weightKg: '',
        pbf: '',
        smm: '',
        legLeanMass: '',
        ecwRatio: '',
      });
      setCustomFields([]);
    }
    setShowAddFieldDropdown(false);
    setAddFieldSearch('');
    setIsExtracting(false);
    setAiFilledFields(new Set());
    setExtractionError(null);
  }, [editData, isOpen]);

  const updateStat = (field: keyof BodyStats, value: string) => {
    setStats(prev => ({ ...prev, [field]: value }));
    setAiFilledFields(prev => {
      const next = new Set(prev);
      next.delete(field as string);
      return next;
    });
  };

  const calculateDerived = () => {
    const weight = parseFloat(stats.weightKg) || 0;
    const pbf = parseFloat(stats.pbf) || 0;
    const fatMass = weight * (pbf / 100);
    return fatMass.toFixed(1);
  };


  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const coreData = {
        date: stats.date,
        weightKg: parseFloat(stats.weightKg) || null,
        pbf: parseFloat(stats.pbf) || null,
        smm: parseFloat(stats.smm) || null,
        legLeanMass: parseFloat(stats.legLeanMass) || null,
        ecwRatio: parseFloat(stats.ecwRatio) || null,
        customFields: customFields
          .filter(field => field.value.trim() !== '')
          .map(field => ({
            name: field.name,
            unit: field.unit,
            value: parseFloat(field.value) || 0
          })),
        createdAt: serverTimestamp(),
      };

      const bodyStatsData = cleanData(coreData);

      if (editData) {
        await updateDoc(doc(db, 'users', user.uid, 'bodyComp', editData.id), bodyStatsData);
      } else {
        await addDoc(collection(db, 'users', user.uid, 'bodyComp'), bodyStatsData);
      }

      const newCustomFieldDefs = customFields.map(field => ({
        name: field.name,
        unit: field.unit
      }));

      if (newCustomFieldDefs.length > 0) {
        const configRef = doc(db, 'users', user.uid, 'config', 'bodyCompConfig');
        const existingDefs = customFieldDefs || [];
        const mergedDefs = [...existingDefs];
        newCustomFieldDefs.forEach(newDef => {
          if (!mergedDefs.some(existing => existing.name === newDef.name)) {
            mergedDefs.push(newDef);
          }
        });
        await setDoc(configRef, { customFieldDefs: mergedDefs }, { merge: true });
      }

      await bumpDataVersion(user.uid);

      // Silently recalculate all goals via full AI context if weightKg + pbf are present
      if (parseFloat(stats.weightKg) && parseFloat(stats.pbf)) {
        calculateGoalsWithAI(user.uid, { trigger: 'body_stats_saved' }).catch(e =>
          console.warn('Goal recalculation skipped:', e)
        );
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving body stats:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const addCustomField = (name: string, unit: string) => {
    const newField: CustomField = {
      id: `custom-${Date.now()}`,
      name,
      unit,
      value: ''
    };
    setCustomFields(prev => [...prev, newField]);
    setShowAddFieldDropdown(false);
    setAddFieldSearch('');
  };

  const removeCustomField = (id: string) => {
    setCustomFields(prev => prev.filter(field => field.id !== id));
  };

  const updateCustomField = (id: string, field: keyof CustomField, value: string) => {
    setCustomFields(prev => prev.map(f =>
      f.id === id ? { ...f, [field]: value } : f
    ));
  };

  const getFieldSuggestions = () => {
    const suggestions = [
      { name: 'Height', unit: 'cm' },
      { name: 'Waist', unit: 'cm' },
      { name: 'Neck', unit: 'cm' },
      { name: 'Chest', unit: 'cm' },
      { name: 'Thigh', unit: 'cm' },
    ];
    customFieldDefs.forEach(def => {
      if (!suggestions.some(s => s.name === def.name)) {
        suggestions.push(def);
      }
    });
    const availableSuggestions = suggestions.filter(
      suggestion => !customFields.some(field => field.name === suggestion.name)
    );
    if (addFieldSearch.trim()) {
      return availableSuggestions.filter(suggestion =>
        suggestion.name.toLowerCase().includes(addFieldSearch.toLowerCase())
      );
    }
    return availableSuggestions;
  };

  if (!isOpen) return null;

  const clearExtraction = () => {
    setIsExtracting(false);
    setAiFilledFields(new Set());
    setExtractionError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setExtractionError(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const mediaType = file.type;
      const promptText = 'Extract body composition stats from this image. Return ONLY a JSON object, no markdown, no preamble:\n{\n  \"weightKg\": number or null,\n  \"pbf\": number or null,\n  \"smm\": number or null,\n  \"legLeanMass\": number or null,\n  \"ecwRatio\": number or null,\n  \"date\": \"YYYY-MM-DD\" or null\n}\nRules:\n- Only include fields clearly visible in the image\n- weightKg = total body weight in kg\n- pbf = body fat percentage (PBF%)\n- smm = skeletal muscle mass in kg\n- legLeanMass = leg lean mass in kg\n- ecwRatio = extracellular water ratio (usually 0.3xx)\n- date = measurement date if visible\n- Return null for any field not found\n- No text outside the JSON object';

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
      //     max_tokens: 1000,
      //     messages: [{
      //       role: 'user',
      //       content: [
      //         { type: 'text', text: promptText },
      //         fileContent,
      //       ],
      //     }],
      //   }),
      // });
      // if (!response.ok) {
      //   throw new Error(`API error: ${response.status}`);
      // }
      // const data = await response.json();
      // const content = data.content?.[0]?.text || '';

      const model = 'gemini-3.5-flash'; // Pinned 2026-07-23, see functions/src/index.ts for pin policy
      const { text: content, usage } = await callAI({
        model,
        contents: [
          { text: promptText },
          { inlineData: { mimeType: mediaType, data: base64 } },
        ],
        maxTokens: 1000,
        thinkingBudget: 0,
      });

      if (user) {
        // Best-effort usage log — must never block extraction.
        try {
          await addDoc(collection(db, 'users', user.uid, 'aiUsageLogs'), {
            callType: 'body_stats_extract',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            model,
            planId: null,
            createdAt: serverTimestamp(),
          });
        } catch (e) {
          console.warn('[BodyStats] Failed to write usage log:', e);
        }
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const extracted = JSON.parse(jsonMatch[0]);
      const filled = new Set<string>();

      setStats(prev => {
        const next = { ...prev };
        if (extracted.weightKg != null) { next.weightKg = String(extracted.weightKg); filled.add('weightKg'); }
        if (extracted.pbf != null) { next.pbf = String(extracted.pbf); filled.add('pbf'); }
        if (extracted.smm != null) { next.smm = String(extracted.smm); filled.add('smm'); }
        if (extracted.legLeanMass != null) { next.legLeanMass = String(extracted.legLeanMass); filled.add('legLeanMass'); }
        if (extracted.ecwRatio != null) { next.ecwRatio = String(extracted.ecwRatio); filled.add('ecwRatio'); }
        if (extracted.date) { next.date = extracted.date; filled.add('date'); }
        return next;
      });

      setAiFilledFields(filled);
      setExtractionError(null);
    } catch (error) {
      console.error('Extraction error:', error);
      setExtractionError('Could not read image \u2014 fill in manually');
      setAiFilledFields(new Set());
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const calculatedFatMass = calculateDerived();
  const canSave = !isSaving && !!stats.date && !!stats.weightKg && !!stats.pbf;

  return (
    <div className="fixed inset-0 bg-slate-950 text-white z-50 flex flex-col" style={{ height: '100dvh' }}>
      {/* Header — title left, Save right */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-semibold">
            {editData ? 'Edit Body Stats' : 'Log Body Stats'}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {isSaving ? 'Saving...' : (editData ? 'Update' : 'Save')}
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-28 space-y-6">

        {/* Upload zone / AI banner */}
        {!isExtracting && aiFilledFields.size === 0 && !extractionError && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 rounded-xl p-6 text-center cursor-pointer hover:border-slate-500 transition-colors"
          >
            <div className="text-sm font-medium text-slate-300">Upload InBody / scale screenshot</div>
            <div className="text-xs text-slate-500 mt-1">AI will fill in the fields automatically</div>
            <div className="flex items-center justify-center gap-2 mt-3">
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">📷 Photo</span>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">🖼 PNG</span>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">📄 PDF</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        )}

        {isExtracting && (
          <div className="bg-emerald-900/40 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-3">
            <span className="text-emerald-400">✦</span>
            <span className="text-sm text-emerald-100">AI reading your report…</span>
            <div className="ml-auto w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isExtracting && extractionError && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm text-red-300">{extractionError}</span>
            <button onClick={clearExtraction} className="text-xs text-slate-400 hover:text-white underline">Try again</button>
          </div>
        )}

        {!isExtracting && aiFilledFields.size > 0 && !extractionError && (
          <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">✓</span>
              <span className="text-sm text-emerald-100">{aiFilledFields.size} fields extracted · Review and edit before saving</span>
            </div>
            <button onClick={clearExtraction} className="text-xs text-slate-400 hover:text-white">× Clear</button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-xs text-slate-500">or fill manually</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        {/* Date Field */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
          <input
            type="date"
            value={stats.date}
            onChange={(e) => updateStat('date', e.target.value)}
            className={`w-full bg-slate-800 border rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500 ${aiFilledFields.has('date') ? 'border-emerald-500' : 'border-slate-700'}`}
          />
        </div>

        {/* Core Fields */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-slate-400">Core fields</h3>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Weight (kg)</label>
            <input
              type="number"
              step="0.1"
              placeholder="70.5"
              value={stats.weightKg}
              onChange={(e) => updateStat('weightKg', e.target.value)}
              className={`w-full bg-slate-800 border rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 ${aiFilledFields.has('weightKg') ? 'border-emerald-500' : 'border-slate-700'}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">PBF (%)</label>
            <input
              type="number"
              step="0.1"
              placeholder="15.5"
              value={stats.pbf}
              onChange={(e) => updateStat('pbf', e.target.value)}
              className={`w-full bg-slate-800 border rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 ${aiFilledFields.has('pbf') ? 'border-emerald-500' : 'border-slate-700'}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">SMM (kg)</label>
            <input
              type="number"
              step="0.1"
              placeholder="35.2"
              value={stats.smm}
              onChange={(e) => updateStat('smm', e.target.value)}
              className={`w-full bg-slate-800 border rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 ${aiFilledFields.has('smm') ? 'border-emerald-500' : 'border-slate-700'}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Leg lean mass (kg)</label>
            <input
              type="number"
              step="0.1"
              placeholder="12.8"
              value={stats.legLeanMass}
              onChange={(e) => updateStat('legLeanMass', e.target.value)}
              className={`w-full bg-slate-800 border rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 ${aiFilledFields.has('legLeanMass') ? 'border-emerald-500' : 'border-slate-700'}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">ECW ratio</label>
            <input
              type="number"
              step="0.001"
              placeholder="0.385"
              value={stats.ecwRatio}
              onChange={(e) => updateStat('ecwRatio', e.target.value)}
              className={`w-full bg-slate-800 border rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 ${aiFilledFields.has('ecwRatio') ? 'border-emerald-500' : 'border-slate-700'}`}
            />
          </div>

          {(stats.weightKg && stats.pbf) && (
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-400">Body fat (calculated)</span>
                <span className="text-sm font-medium text-white">{calculatedFatMass} kg</span>
              </div>
            </div>
          )}
        </div>

        {/* Optional Fields */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-slate-400">Optional fields</h3>

          {customFields.map((field) => (
            <div key={field.id} className="flex items-center space-x-2">
              <div className="flex-1">
                <div className="text-sm text-slate-300 mb-1">{field.name}</div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-500">{field.unit}</span>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="0"
                    value={field.value}
                    onChange={(e) => updateCustomField(field.id, 'value', e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm"
                  />
                  <button
                    onClick={() => removeCustomField(field.id)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Add Field Button and Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowAddFieldDropdown(!showAddFieldDropdown)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white hover:bg-slate-700 transition-colors flex items-center justify-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Field</span>
            </button>

            {showAddFieldDropdown && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10">
                <div className="p-3">
                  <input
                    type="text"
                    placeholder="Search or type field name..."
                    value={addFieldSearch}
                    onChange={(e) => setAddFieldSearch(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 text-sm"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <div className="px-3 pb-2">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Suggestions</div>
                    {getFieldSuggestions().map((suggestion) => (
                      <button
                        key={suggestion.name}
                        onClick={() => addCustomField(suggestion.name, suggestion.unit)}
                        className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded transition-colors"
                      >
                        {suggestion.name} ({suggestion.unit})
                      </button>
                    ))}
                    {addFieldSearch.trim() && !getFieldSuggestions().some(s => s.name.toLowerCase() === addFieldSearch.toLowerCase()) && (
                      <button
                        onClick={() => addCustomField(addFieldSearch.trim(), '')}
                        className="w-full text-left px-3 py-2 text-sm text-emerald-400 hover:bg-slate-700 rounded transition-colors"
                      >
                        + Create '{addFieldSearch.trim()}'
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}