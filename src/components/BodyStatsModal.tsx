import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { collection, addDoc, updateDoc, doc, serverTimestamp, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanData } from '@/lib/cleanData';

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
      // Set custom fields from edit data
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
      // Reset form for new entry
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
  }, [editData, isOpen]);

  const updateStat = (field: keyof BodyStats, value: string) => {
    setStats(prev => ({ ...prev, [field]: value }));
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
      // Collect core fields
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
        // Update existing entry
        await updateDoc(doc(db, 'users', user.uid, 'bodyComp', editData.id), bodyStatsData);
      } else {
        // Create new entry
        await addDoc(collection(db, 'users', user.uid, 'bodyComp'), bodyStatsData);
      }

      // Update custom field definitions
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
    
    // Add custom field definitions
    customFieldDefs.forEach(def => {
      if (!suggestions.some(s => s.name === def.name)) {
        suggestions.push(def);
      }
    });
    
    // Filter out already added fields
    const availableSuggestions = suggestions.filter(
      suggestion => !customFields.some(field => field.name === suggestion.name)
    );
    
    // Filter by search
    if (addFieldSearch.trim()) {
      return availableSuggestions.filter(suggestion =>
        suggestion.name.toLowerCase().includes(addFieldSearch.toLowerCase())
      );
    }
    
    return availableSuggestions;
  };

  if (!isOpen) return null;

  const calculatedFatMass = calculateDerived();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">
            {editData ? 'Edit Body Stats' : 'Log Body Stats'}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 space-y-6">
          {/* Date Field */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
            <input
              type="date"
              value={stats.date}
              onChange={(e) => updateStat('date', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Core Fields Section */}
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
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
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
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
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
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
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
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
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
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Calculated Body Fat */}
            {(stats.weightKg && stats.pbf) && (
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">Body fat (calculated)</span>
                  <span className="text-sm font-medium text-white">{calculatedFatMass} kg</span>
                </div>
              </div>
            )}
          </div>

          {/* Optional Fields Section */}
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10">
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

        <div className="p-4 border-t border-slate-800">
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !stats.date || !stats.weightKg || !stats.pbf}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {isSaving ? 'Saving...' : (editData ? 'Update entry' : 'Save entry')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
