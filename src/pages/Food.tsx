import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { Plus, Send, Camera, Search, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import {
  doc, getDoc, setDoc,

} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ── Types ──────────────────────────────────────────────────────────────────
interface MacroInfo {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface FoodItem extends MacroInfo {
  id: string;
  name: string;
  portion: string;
  mealSlot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  loggedAt: string; // ISO
}

interface DayLog {
  date: string;
  items: FoodItem[];
  calorieGoal: number;
  proteinGoal: number;
  carbGoal: number;
  fatGoal: number;
}

interface ParsedFoodItem extends MacroInfo {
  name: string;
  portion: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const todayStr = () => (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const MEAL_LABELS: Record<string, string> = {
  breakfast: '☀️ Breakfast',
  lunch: '🌤 Lunch',
  dinner: '🌙 Dinner',
  snack: '☕ Snack',
};

const DEFAULT_GOALS = { calorieGoal: 2000, proteinGoal: 120, carbGoal: 220, fatGoal: 65 };

// ── Component ──────────────────────────────────────────────────────────────
export default function Food() {
  const { user } = useAuth();
  const navigate = useNavigate();


  const [date, setDate] = useState(todayStr());
  const [dayLog, setDayLog] = useState<DayLog | null>(null);
  const [loading, setLoading] = useState(true);
  usePageLoadTime('Food', loading);
  const [foodPreference, setFoodPreference] = useState<string>('');  // 'veg', 'non-veg', 'vegan', etc.
  const [aiInsightText, setAiInsightText] = useState<string>('');

  // Chat / entry modal
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'chat' | 'photo' | 'search'>('chat');
  const [activeMealSlot, setActiveMealSlot] = useState<FoodItem['mealSlot']>('lunch');

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[] | null>(null);
  const [chatIntro, setChatIntro] = useState('');
  const [chatError, setChatError] = useState('');

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoItems, setPhotoItems] = useState<ParsedFoodItem[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ParsedFoodItem[] | null>(null);

  // Load day log from Firestore
  const loadDayLog = async (d: string) => {
    if (!user) return;
    setLoading(true);
    try {
      // Always fetch profile — so food preference + goals stay current
      const [snap, profileSnap, insightSnap] = await Promise.all([
        getDoc(doc(db, 'users', user.uid, 'nutritionLogs', d)),
        getDoc(doc(db, 'users', user.uid, 'profile', 'data')),
        getDoc(doc(db, 'users', user.uid, 'aiInsights', 'daily')),
      ]);
      const profile = profileSnap.exists() ? profileSnap.data() : {};
      setFoodPreference(((profile as any).foodPreference || '').toLowerCase());

      // Use same AI insight as Home page — discard if protein goal has drifted >10g
      if (insightSnap.exists()) {
        const cached = insightSnap.data() as any;
        const cachedProtein: number | null = cached.proteinGoal ?? null;
        const currentProtein: number = (profile as any).proteinGoal ?? 0;
        const stale = cachedProtein !== null && Math.abs(cachedProtein - currentProtein) > 10;
        if (!stale) setAiInsightText(cached.insights?.food || '');
      }

      if (snap.exists()) {
        const stored = snap.data() as DayLog;
        setDayLog({
          ...stored,
          calorieGoal: (profile as any).calorieGoal ?? (profile as any).ringGoals?.caloriesIn ?? stored.calorieGoal ?? DEFAULT_GOALS.calorieGoal,
          proteinGoal: (profile as any).proteinGoal ?? stored.proteinGoal ?? DEFAULT_GOALS.proteinGoal,
          carbGoal:    (profile as any).carbGoal    ?? stored.carbGoal    ?? DEFAULT_GOALS.carbGoal,
          fatGoal:     (profile as any).fatGoal     ?? stored.fatGoal     ?? DEFAULT_GOALS.fatGoal,
        });
      } else {
        setDayLog({
          date: d,
          items: [],
          calorieGoal: (profile as any).calorieGoal ?? (profile as any).ringGoals?.caloriesIn ?? DEFAULT_GOALS.calorieGoal,
          proteinGoal: (profile as any).proteinGoal ?? DEFAULT_GOALS.proteinGoal,
          carbGoal:    (profile as any).carbGoal    ?? DEFAULT_GOALS.carbGoal,
          fatGoal:     (profile as any).fatGoal     ?? DEFAULT_GOALS.fatGoal,
        });
      }
    } catch (e) {
      console.error('Error loading food log:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDayLog(date); }, [date, user]);

  // Save log to Firestore
  const saveDayLog = async (updated: DayLog) => {
    if (!user) return;
    try {
      const ref = doc(db, 'users', user.uid, 'nutritionLogs', updated.date);
      // Compute totals
      const totalCalories = updated.items.reduce((s, i) => s + (i.calories ?? 0), 0);
      await setDoc(ref, { ...updated, totalCalories });
      setDayLog(updated);
    } catch (e) {
      console.error('Error saving food log:', e);
    }
  };

  // Log parsed items to a meal slot
  const logItems = async (items: ParsedFoodItem[], slot: FoodItem['mealSlot']) => {
    if (!dayLog) return;
    const newItems: FoodItem[] = items.map((item, i) => ({
      ...item,
      id: `${Date.now()}-${i}`,
      mealSlot: slot,
      loggedAt: new Date().toISOString(),
    }));
    const updated = { ...dayLog, items: [...dayLog.items, ...newItems] };
    await saveDayLog(updated);
    setShowModal(false);
    setParsedItems(null);
    setChatInput('');
    setChatIntro('');
    setPhotoItems(null);
    setPhotoPreview(null);
    setPhotoFile(null);
    setSearchResults(null);
    setSearchQuery('');
  };

  const deleteItem = async (itemId: string) => {
    if (!dayLog) return;
    const updated = { ...dayLog, items: dayLog.items.filter(i => i.id !== itemId) };
    await saveDayLog(updated);
  };

  // ── AI Chat parsing ────────────────────────────────────────────────────
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setParsedItems(null);
    setChatError('');
    setChatIntro('');
    try {
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
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: `You are a nutrition assistant. Parse the food description and return calories and macros for each item.

Food description: "${chatInput}"

Respond in exactly this format:
<intro>One short friendly sentence acknowledging what they ate.</intro>
<items>[{"name":"Food Name","portion":"1 plate / 200g / etc","calories":245,"protein":6,"carbs":42,"fat":8}]</items>

Rules:
- Be accurate for Indian foods (poha, dal, roti, sabzi, chai etc.)
- Estimate portions reasonably if not specified
- Each item in the array is a separate food
- calories/protein/carbs/fat are numbers (grams for macros)
- Never include markdown or extra text outside the tags`,
          }],
        }),
      });
      if (!response.ok) throw new Error('API failed');
      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      const introMatch = text.match(/<intro>([\s\S]*?)<\/intro>/);
      if (introMatch) setChatIntro(introMatch[1].trim());
      const itemsMatch = text.match(/<items>([\s\S]*?)<\/items>/);
      if (itemsMatch) {
        const parsed = JSON.parse(itemsMatch[1].trim());
        setParsedItems(parsed);
      }
    } catch (e) {
      console.error('Chat parse error:', e);
      setChatError('Could not parse your food. Try describing it differently.');
    } finally {
      setChatLoading(false);
    }
  };

  // ── AI Photo parsing ───────────────────────────────────────────────────
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
    setPhotoItems(null);
  };

  const analyzePhoto = async () => {
    if (!photoFile || !photoPreview) return;
    setPhotoLoading(true);
    setPhotoItems(null);
    try {
      const base64 = photoPreview.split(',')[1];
      const mediaType = photoFile.type as 'image/jpeg' | 'image/png' | 'image/webp';
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
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: `Identify all food items in this image and estimate calories and macros.

Respond in exactly this format:
<items>[{"name":"Food Name","portion":"estimated portion","calories":300,"protein":12,"carbs":45,"fat":8}]</items>

Rules:
- List each distinct food item separately
- Estimate portions visually (e.g. "1 cup", "2 rotis", "1 bowl")
- calories/protein/carbs/fat are numbers
- If unsure about a portion, add a note in the portion field like "~1 cup (estimated)"
- Only output the tags, no other text` }
            ],
          }],
        }),
      });
      if (!response.ok) throw new Error('API failed');
      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      const itemsMatch = text.match(/<items>([\s\S]*?)<\/items>/);
      if (itemsMatch) {
        const parsed = JSON.parse(itemsMatch[1].trim());
        setPhotoItems(parsed);
      }
    } catch (e) {
      console.error('Photo analysis error:', e);
    } finally {
      setPhotoLoading(false);
    }
  };

  // ── AI Search ──────────────────────────────────────────────────────────
  const searchFood = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResults(null);
    try {
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
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Give nutrition info for: "${searchQuery}"

Respond with exactly this JSON array, no other text:
[{"name":"${searchQuery}","portion":"1 serving","calories":0,"protein":0,"carbs":0,"fat":0}]

Replace the zeros with accurate values. Include 2-3 common portion variants if relevant.`,
          }],
        }),
      });
      if (!response.ok) throw new Error('API failed');
      const data = await response.json();
      const text = (data.content?.[0]?.text || '').trim();
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      setSearchResults(parsed);
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setSearchLoading(false);
    }
  };

  // ── Computed totals ────────────────────────────────────────────────────
  const totals = dayLog?.items.reduce(
    (acc, item) => ({
      calories: acc.calories + (item.calories ?? 0),
      protein: acc.protein + (item.protein ?? 0),
      carbs: acc.carbs + (item.carbs ?? 0),
      fat: acc.fat + (item.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  ) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const goals = {
    calories: dayLog?.calorieGoal ?? DEFAULT_GOALS.calorieGoal,
    protein: dayLog?.proteinGoal ?? DEFAULT_GOALS.proteinGoal,
    carbs: dayLog?.carbGoal ?? DEFAULT_GOALS.carbGoal,
    fat: dayLog?.fatGoal ?? DEFAULT_GOALS.fatGoal,
  };

  const calPct = Math.min(100, (totals.calories / goals.calories) * 100);

  // Items grouped by meal slot
  const bySlot = MEAL_SLOTS.reduce((acc, slot) => {
    acc[slot] = dayLog?.items.filter(i => i.mealSlot === slot) ?? [];
    return acc;
  }, {} as Record<string, FoodItem[]>);

  // Navigate dates
  const prevDay = () => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setDate(d.toISOString().split('T')[0]);
  };
  const nextDay = () => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const next = d.toISOString().split('T')[0];
    if (next <= todayStr()) setDate(next);
  };

  const openModal = (mode: typeof modalMode, slot: FoodItem['mealSlot'] = 'lunch') => {
    setModalMode(mode);
    setActiveMealSlot(slot);
    setParsedItems(null);
    setChatInput('');
    setChatIntro('');
    setChatError('');
    setPhotoItems(null);
    setPhotoPreview(null);
    setPhotoFile(null);
    setSearchResults(null);
    setSearchQuery('');
    setShowModal(true);
  };



  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <div className="p-5 space-y-4">

        {/* Date navigation */}
        <div className="flex items-center justify-between">
          <button onClick={prevDay} className="p-2 text-slate-500 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-semibold">{formatDate(date)}</h2>
          <button
            onClick={nextDay}
            disabled={date >= todayStr()}
            className="p-2 text-slate-500 hover:text-white disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Calorie + macro summary card */}
        <div
          className="rounded-2xl p-4 border border-slate-800"
          style={{ background: '#0d0d0a' }}
        >
          <div className="flex items-center gap-4">
            {/* Calorie donut */}
            <div className="relative flex-shrink-0 w-[78px] h-[78px]">
              <svg width="78" height="78" viewBox="0 0 78 78">
                <circle cx="39" cy="39" r="32" fill="none" stroke="rgba(249,115,22,0.12)" strokeWidth="10" />
                <circle
                  cx="39" cy="39" r="32" fill="none" stroke="#f97316" strokeWidth="10"
                  strokeDasharray={2 * Math.PI * 32}
                  strokeDashoffset={2 * Math.PI * 32 * (1 - calPct / 100)}
                  strokeLinecap="round" transform="rotate(-90 39 39)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-base font-bold font-mono text-orange-400 leading-none">{totals.calories}</span>
                <span className="text-[9px] text-slate-500 font-mono">/ {goals.calories}</span>
              </div>
            </div>

            {/* Macro bars */}
            <div className="flex-1 space-y-2">
              {[
                { label: 'Protein', val: totals.protein, goal: goals.protein, color: '#6366f1', textColor: 'text-indigo-400' },
                { label: 'Carbs',   val: totals.carbs,   goal: goals.carbs,   color: '#f59e0b', textColor: 'text-amber-400' },
                { label: 'Fat',     val: totals.fat,     goal: goals.fat,     color: '#ec4899', textColor: 'text-pink-400' },
              ].map(({ label, val, goal, color, textColor }) => (
                <div key={label}>
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-[10px] font-medium text-slate-400">{label}</span>
                    <span className={`text-[10px] font-mono ${textColor}`}>{Math.round(val)}g <span className="text-slate-600">/ {goal}g</span></span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, (val / goal) * 100)}%`, background: color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Log buttons */}
          {/* Log food label */}
          <div className="flex items-center justify-between mt-4 mb-1">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Log food</span>
            <span className="text-[10px] font-mono text-slate-600">{date === todayStr() ? 'Today' : formatDate(date)}</span>
          </div>
          <div className="flex gap-2">
            {[
              { mode: 'chat' as const,   icon: '💬', label: 'Describe' },
              { mode: 'photo' as const,  icon: '📷', label: 'Photo'    },
              { mode: 'search' as const, icon: '🔍', label: 'Search'   },
            ].map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => openModal(mode)}
                className="flex-1 flex flex-col items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl py-2.5 hover:border-slate-700 transition-colors"
              >
                <span className="text-lg">{icon}</span>
                <span className="text-[9px] font-mono text-slate-500">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Nutrition Insight — AI text (same as Home) + live gaps + suggestions */}
        {(() => {
          const proteinGap = goals.protein - totals.protein;
          const remaining = goals.calories - totals.calories;
          const isProteinLow = proteinGap > 20;
          const allSuggestions = [
            ...(!foodPreference.includes('veg') || foodPreference.includes('non') ? [
              { emoji: '🍗', name: 'Grilled Chicken + Roti', cal: 450, p: 42, c: 38, f: 14 },
              { emoji: '🐟', name: 'Grilled Fish + Salad', cal: 320, p: 38, c: 8, f: 12 },
            ] : []),
            ...(foodPreference !== 'vegan' ? [
              { emoji: '🥚', name: 'Paneer Bhurji + 2 Eggs', cal: 380, p: 36, c: 12, f: 22 },
              { emoji: '🧀', name: 'Paneer Tikka + Roti', cal: 420, p: 28, c: 35, f: 18 },
            ] : []),
            { emoji: '🫘', name: 'Chana Dal + Brown Rice', cal: 390, p: 28, c: 52, f: 8 },
            { emoji: '🥗', name: 'Tofu Stir Fry + Quinoa', cal: 350, p: 26, c: 38, f: 10 },
          ].filter(s => s.cal <= remaining + 150).slice(0, 3);

          return (
            <div className="relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              {/* orange top accent */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 via-amber-400 to-transparent" />

              <div className="p-4">
                {/* header */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                  <span className="text-[10px] font-mono text-orange-400 tracking-wider uppercase">Nutrition Insight</span>
                  {isProteinLow && (
                    <span className="ml-auto text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                      ⚠ Protein low
                    </span>
                  )}
                </div>

                {/* AI insight text — same source as Home */}
                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  {aiInsightText || (isProteinLow
                    ? `You're ${Math.round(proteinGap)}g short on protein. A protein-rich meal tonight will close the gap.`
                    : `Macros looking good today. ${remaining > 0 ? `${Math.round(remaining)} kcal remaining.` : 'Calorie goal hit!'}`)}
                </p>

                {/* Live gap pills — always shown */}
                <div className="flex gap-2 mb-3">
                  <div className={`flex-1 text-center rounded-lg py-1.5 px-2 ${
                    isProteinLow
                      ? 'bg-orange-500/8 border border-orange-500/20'
                      : 'bg-emerald-500/8 border border-emerald-500/20'
                  }`}>
                    <p className={`text-xs font-bold font-mono ${isProteinLow ? 'text-orange-400' : 'text-emerald-400'}`}>
                      {isProteinLow ? `-${Math.round(proteinGap)}g` : `✓`}
                    </p>
                    <p className="text-[9px] text-slate-600">protein gap</p>
                  </div>
                  <div className="flex-1 text-center rounded-lg py-1.5 px-2 bg-emerald-500/8 border border-emerald-500/20">
                    <p className="text-xs font-bold font-mono text-emerald-400">{Math.max(0, Math.round(remaining))}</p>
                    <p className="text-[9px] text-slate-600">kcal left</p>
                  </div>
                  <div className="flex-1 text-center rounded-lg py-1.5 px-2 bg-amber-500/8 border border-amber-500/20">
                    <p className="text-xs font-bold font-mono text-amber-400">{Math.max(0, Math.round(goals.carbs - totals.carbs))}g</p>
                    <p className="text-[9px] text-slate-600">carbs left</p>
                  </div>
                </div>

                {/* Dinner suggestions — shown when protein low + kcal remaining */}
                {isProteinLow && remaining > 150 && allSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-white">💡 Suggested for dinner</p>
                    {allSuggestions.map(sug => (
                      <div key={sug.name} className="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2.5">
                        <span className="text-lg flex-shrink-0">{sug.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{sug.name}</p>
                          <p className="text-[9px] font-mono text-slate-500 mt-0.5">P {sug.p}g · C {sug.c}g · F {sug.f}g</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-bold font-mono text-orange-400">{sug.cal}</p>
                          <p className="text-[9px] text-slate-600">kcal</p>
                        </div>
                        <button
                          onClick={() => logItems([{ name: sug.name, portion: '1 serving', calories: sug.cal, protein: sug.p, carbs: sug.c, fat: sug.f }], 'dinner')}
                          className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-1 rounded-lg hover:bg-emerald-500/20 transition-colors flex-shrink-0"
                        >
                          +Log
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ask AI Coach — bottom CTA */}
              <button
                onClick={() => navigate('/ai-coach?topic=food')}
                className="w-full flex items-center gap-2 px-4 py-2.5 border-t border-slate-800 hover:bg-slate-800/50 transition-colors"
              >
                <span className="text-orange-400 text-xs">✦</span>
                <span className="text-xs text-slate-500 flex-1 text-left">Want personalised meal advice?</span>
                <span className="text-[10px] font-mono text-orange-400">Ask AI Coach →</span>
              </button>
            </div>
          );
        })()}

        {/* Meal sections */}
        {MEAL_SLOTS.map(slot => {
          const items = bySlot[slot];
          const slotCals = items.reduce((s, i) => s + (i.calories ?? 0), 0);
          return (
            <div key={slot} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <span className="text-xs font-semibold">{MEAL_LABELS[slot]}</span>
                <div className="flex items-center gap-3">
                  {slotCals > 0 && (
                    <span className="text-[10px] font-mono text-orange-400">{slotCals} kcal</span>
                  )}
                  <button
                    onClick={() => openModal('chat', slot)}
                    className="text-slate-500 hover:text-emerald-400 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <button
                  onClick={() => openModal('chat', slot)}
                  className="w-full py-4 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
                >
                  + Add {slot}
                </button>
              ) : (
                <div>
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">{item.name}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">{item.portion}</p>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[8px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">P {item.protein}g</span>
                          <span className="text-[8px] font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">C {item.carbs}g</span>
                          <span className="text-[8px] font-mono bg-pink-500/10 text-pink-400 px-1.5 py-0.5 rounded">F {item.fat}g</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold font-mono text-orange-400">{item.calories}</p>
                        <p className="text-[9px] text-slate-600">kcal</p>
                      </div>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="text-slate-700 hover:text-red-400 transition-colors p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── ENTRY MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          {/* mb-16 lifts modal above the fixed bottom nav */}
          <div className="bg-slate-900 rounded-t-2xl w-full mb-16 flex flex-col" style={{ maxHeight: 'calc(85vh - 64px)' }}>
            {/* Handle */}
            <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

            {/* Header — X left, mode tabs centre, Save right */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 flex-shrink-0">
              {/* Close */}
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white flex-shrink-0">
                <X className="w-5 h-5" />
              </button>

              {/* Title */}
              <span className="text-sm font-semibold capitalize flex-shrink-0">
                Log {activeMealSlot}
              </span>

              {/* Mode tabs — centred */}
              <div className="flex bg-slate-800 border border-slate-700 rounded-lg p-0.5 gap-0.5 mx-auto">
                {[
                  { mode: 'chat' as const,   label: '💬' },
                  { mode: 'photo' as const,  label: '📷' },
                  { mode: 'search' as const, label: '🔍' },
                ].map(({ mode, label }) => (
                  <button
                    key={mode}
                    onClick={() => setModalMode(mode)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                      modalMode === mode
                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'text-slate-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Save button — only visible when items are parsed */}
              {(parsedItems || photoItems || searchResults) ? (
                <button
                  onClick={() => {
                    const items = modalMode === 'chat' ? parsedItems
                      : modalMode === 'photo' ? photoItems
                      : searchResults;
                    if (items) logItems(items, activeMealSlot);
                  }}
                  className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  ✓ Save
                </button>
              ) : (
                <div className="w-14 flex-shrink-0" /> /* spacer to keep layout balanced */
              )}
            </div>

            {/* Meal slot selector */}
            <div className="flex gap-2 px-5 pt-3 pb-1 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
              {MEAL_SLOTS.map(slot => (
                <button
                  key={slot}
                  onClick={() => setActiveMealSlot(slot)}
                  className={`flex-shrink-0 text-[10px] font-mono px-3 py-1.5 rounded-full border transition-colors ${
                    activeMealSlot === slot
                      ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                      : 'bg-slate-800 border-slate-700 text-slate-500'
                  }`}
                >
                  {MEAL_LABELS[slot]}
                </button>
              ))}
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-3">

              {/* CHAT MODE */}
              {modalMode === 'chat' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <textarea
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      placeholder='e.g. "I had poha for breakfast, chai with 2 spoons sugar, dal chawal for lunch"'
                      rows={3}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none"
                    />
                    <button
                      onClick={sendChat}
                      disabled={chatLoading || !chatInput.trim()}
                      className="w-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors self-start mt-0"
                    >
                      {chatLoading
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Send className="w-4 h-4 text-white" />}
                    </button>
                  </div>

                  {chatError && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{chatError}</p>
                  )}

                  {chatIntro && (
                    <p className="text-xs text-slate-400 italic">{chatIntro}</p>
                  )}

                  {parsedItems && parsedItems.length > 0 && (
                    <ParsedItemsList
                      items={parsedItems}
                      onLog={() => logItems(parsedItems, activeMealSlot)}
                    />
                  )}
                </div>
              )}

              {/* PHOTO MODE */}
              {modalMode === 'photo' && (
                <div className="space-y-3">
                  {!photoPreview ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-700 rounded-xl py-10 flex flex-col items-center gap-2 hover:border-slate-600 transition-colors"
                    >
                      <Camera className="w-8 h-8 text-slate-500" />
                      <p className="text-sm text-slate-400 font-medium">Take or upload a photo</p>
                      <p className="text-xs text-slate-600">AI will identify foods and estimate calories</p>
                    </button>
                  ) : (
                    <div>
                      <div className="relative rounded-xl overflow-hidden mb-3">
                        <img src={photoPreview} alt="Food" className="w-full max-h-48 object-cover" />
                        <button
                          onClick={() => { setPhotoPreview(null); setPhotoFile(null); setPhotoItems(null); }}
                          className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center"
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                      </div>
                      {!photoItems && (
                        <button
                          onClick={analyzePhoto}
                          disabled={photoLoading}
                          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
                        >
                          {photoLoading
                            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analysing…</>
                            : '✦ Analyse Photo'}
                        </button>
                      )}
                    </div>
                  )}

                  {photoItems && photoItems.length > 0 && (
                    <ParsedItemsList
                      items={photoItems}
                      onLog={() => logItems(photoItems, activeMealSlot)}
                    />
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                </div>
              )}

              {/* SEARCH MODE */}
              {modalMode === 'search' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && searchFood()}
                      placeholder="e.g. Roti, Paneer tikka, Banana..."
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                    />
                    <button
                      onClick={searchFood}
                      disabled={searchLoading || !searchQuery.trim()}
                      className="w-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
                    >
                      {searchLoading
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Search className="w-4 h-4 text-white" />}
                    </button>
                  </div>

                  {searchResults && searchResults.length > 0 && (
                    <ParsedItemsList
                      items={searchResults}
                      onLog={() => logItems(searchResults, activeMealSlot)}
                      singleLog
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: parsed food items list ──────────────────────────────────
function ParsedItemsList({
  items,
  onLog,
  singleLog = false,
}: {
  items: ParsedFoodItem[];
  onLog: () => void;
  singleLog?: boolean;
}) {
  const total = items.reduce((acc, i) => ({
    calories: acc.calories + i.calories,
    protein: acc.protein + i.protein,
    carbs: acc.carbs + i.carbs,
    fat: acc.fat + i.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3 bg-slate-800 rounded-xl px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white">{item.name}</p>
            <p className="text-[9px] text-slate-500 mt-0.5">{item.portion}</p>
            <div className="flex gap-1.5 mt-1.5">
              <span className="text-[8px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">P {item.protein}g</span>
              <span className="text-[8px] font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">C {item.carbs}g</span>
              <span className="text-[8px] font-mono bg-pink-500/10 text-pink-400 px-1.5 py-0.5 rounded">F {item.fat}g</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold font-mono text-orange-400">{item.calories}</p>
            <p className="text-[9px] text-slate-600">kcal</p>
          </div>
          {singleLog && (
            <button
              onClick={onLog}
              className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-1 rounded-lg self-center flex-shrink-0"
            >
              +Log
            </button>
          )}
        </div>
      ))}

      {/* Total row — summary only, Save button is in modal header */}
      {!singleLog && (
        <div className="flex items-center justify-between bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-orange-400">Total: {total.calories} kcal</p>
          <p className="text-[9px] font-mono text-slate-500">
            P {total.protein}g · C {total.carbs}g · F {total.fat}g
          </p>
        </div>
      )}
    </div>
  );
}