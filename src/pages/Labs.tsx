import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, AlertCircle, ChevronRight, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import { useAsyncCall } from '@/hooks/useAsyncCall';
import LabsModal from '@/components/LabsModal';
import { collection, query, orderBy, limit, getDocs, deleteDoc, doc, setDoc, addDoc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { callAI } from '@/lib/callAI';
import { cleanData } from '@/lib/cleanData';
import { bumpDataVersion } from '@/lib/dataVersion';
import { generateHealthPlan, computeTestStatuses, getHealthPlanSummary, type TestStatus } from '@/lib/healthPlan';

interface LabTest { testName: string; value: number; unit: string; }
interface LabResults { id: string; date: string; results: LabTest[]; createdAt: any; }
interface LabTestCard {
  id: string; name: string; unit: string;
  referenceRangeLow: number | null; referenceRangeHigh: number | null;
  reminderIntervalMonths: number | null; nextDueDate: Date | null;
  latestReading: { value: number; date: Date; } | null; pinned?: boolean;
}

const getTestIcon = (testName: string): string => {
  const n = testName.toLowerCase();
  if (n.includes('tsh') || n.includes('t3') || n.includes('t4')) return '🩸';
  if (n.includes('hba1c') || n.includes('blood sugar') || n.includes('glucose')) return '🍬';
  if (n.includes('vitamin d') || n.includes('vit d')) return '☀️';
  if (n.includes('vitamin b12') || n.includes('b12')) return '💊';
  if (n.includes('hemoglobin') || n.includes('hb') || n.includes('cbc')) return '🔴';
  if (n.includes('calcium')) return '🦴';
  if (n.includes('alt') || n.includes('ast') || n.includes('liver')) return '🫀';
  if (n.includes('testosterone')) return '⚡';
  if (n.includes('cholesterol') || n.includes('ldl') || n.includes('hdl') || n.includes('triglycerides')) return '🫁';
  return '🧪';
};

const getTestCategory = (testName: string): string => {
  const n = testName.toLowerCase();
  if (n.includes('tsh') || n.includes('t3') || n.includes('t4')) return 'Thyroid';
  if (n.includes('hba1c') || n.includes('glucose')) return 'Diabetes';
  if (n.includes('vitamin') || n.includes('calcium')) return 'Nutrition';
  if (n.includes('alt') || n.includes('ast')) return 'Liver';
  if (n.includes('testosterone')) return 'Hormones';
  return 'Blood Test';
};

export default function Labs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  // labResults kept for migration compatibility
  const [, setLabResults] = useState<LabResults[]>([]);
  const [tests, setTests] = useState<LabTestCard[]>([]);
  const [loading, setLoading] = useState(true);
  usePageLoadTime('Labs', loading);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Health plan state
  const [testStatuses, setTestStatuses] = useState<TestStatus[]>([]);
  const [healthPlanExpanded, setHealthPlanExpanded] = useState(false);
  const [customizingTest, setCustomizingTest] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  // AI insight state
  const [insightText, setInsightText] = useState('');
  const [insightGeneratedAt, setInsightGeneratedAt] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const insightCall = useAsyncCall<string>();

  // ── Fetch lab results (old collection) ──────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const run = async () => {
      try {
        await cleanupMalformedDocuments();
        const q = query(collection(db, 'users', user.uid, 'labs'), orderBy('date', 'desc'), limit(50));
        const snap = await getDocs(q);
        setLabResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as LabResults))
          .filter(e => e?.results && Array.isArray(e.results)));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    run();
  }, [user]);

  // ── Fetch tests (new collection) + compute health plan ──────────────────
  useEffect(() => {
    if (!user) return;
    const run = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users', user.uid, 'tests'), orderBy('createdAt', 'desc')));

        const fetchedTests = await Promise.all(snap.docs.map(async testDoc => {
          const d = testDoc.data();
          const rSnap = await getDocs(query(
            collection(db, 'users', user.uid, 'tests', testDoc.id, 'readings'),
            orderBy('date', 'desc'), limit(1)
          ));
          return {
            id: testDoc.id,
            name: d.name, unit: d.unit,
            referenceRangeLow: d.referenceRangeLow || null,
            referenceRangeHigh: d.referenceRangeHigh || null,
            reminderIntervalMonths: d.reminderIntervalMonths || null,
            nextDueDate: d.nextDueDate ? new Date(d.nextDueDate) : null,
            latestReading: rSnap.docs.length > 0
              ? { value: rSnap.docs[0].data().value, date: new Date(rSnap.docs[0].data().date) }
              : null,
            pinned: d.pinned || false,
          } as LabTestCard;
        }));

        setTests(fetchedTests);

        // Load profile → compute health plan
        try {
          const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
          const prof = profileSnap.exists() ? profileSnap.data() as any : {};
          setProfile(prof);
          let age = 30;
          if (prof.dob) {
            const birth = new Date(prof.dob);
            age = new Date().getFullYear() - birth.getFullYear();
          }
          const plan = generateHealthPlan({
            age, gender: prof.gender,
            chronicConditions: prof.chronicConditions,
            fitnessFocus: prof.fitnessFocus,
            foodPreference: prof.foodPreference,
            primaryGoal: prof.primaryGoal,
          });
          const statuses = computeTestStatuses(plan, fetchedTests.map(t => ({
            id: t.id, name: t.name,
            latestReading: t.latestReading,
            reminderIntervalMonths: t.reminderIntervalMonths,
          })));
          setTestStatuses(statuses);

          // Load cached labs AI insight
          const insightSnap = await getDoc(doc(db, 'users', user.uid, 'aiInsights', 'labs'));
          if (insightSnap.exists()) {
            const cached = insightSnap.data() as any;
            setInsightText(cached.text || '');
            setInsightGeneratedAt(cached.generatedAt || null);
          }

          // A fresh report upload should regenerate the insight automatically
          // rather than leaving the stale cached one until a manual refresh.
          if ((location.state as { justUploaded?: boolean } | null)?.justUploaded) {
            navigate(location.pathname, { replace: true, state: {} });
            generateInsight();
          }
        } catch (e) { console.warn('Health plan error:', e); }

      } catch (e) { console.error('Error fetching tests:', e); }
    };
    run();
  }, [user]);

  // ── Migration ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const migrate = async () => {
      if (localStorage.getItem('labsMigrated') === 'true') return;
      try {
        const testsSnap = await getDocs(query(collection(db, 'users', user.uid, 'tests'), limit(1)));
        if (!testsSnap.empty) { localStorage.setItem('labsMigrated', 'true'); return; }
        const labsSnap = await getDocs(query(collection(db, 'users', user.uid, 'labs'), orderBy('date', 'desc'), limit(100)));
        const testMap = new Map<string, any>();
        const now = new Date().toISOString();
        for (const labDoc of labsSnap.docs) {
          const labData = labDoc.data();
          if (!labData.results || !Array.isArray(labData.results)) continue;
          for (const tr of labData.results) {
            if (!tr.testName || typeof tr.value !== 'number') continue;
            if (!testMap.has(tr.testName)) {
              testMap.set(tr.testName, { name: tr.testName, unit: tr.unit || '', referenceRangeLow: null, referenceRangeHigh: null, reminderIntervalMonths: null, nextDueDate: null, createdAt: now });
            }
            const testRef = doc(collection(db, 'users', user.uid, 'tests'));
            await setDoc(testRef, cleanData(testMap.get(tr.testName)));
            await addDoc(collection(db, 'users', user.uid, 'tests', testRef.id, 'readings'), cleanData({ value: tr.value, date: labData.date || now, reportUrl: null, createdAt: now }));
          }
        }
        localStorage.setItem('labsMigrated', 'true');
        window.location.reload();
      } catch (e) { console.error('Migration error:', e); }
    };
    migrate();
  }, [user]);

  const cleanupMalformedDocuments = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'users', user.uid, 'labs'), limit(100)));
      for (const d of snap.docs) {
        if (!d.data().results || !Array.isArray(d.data().results)) {
          await deleteDoc(doc(db, 'users', user.uid, 'labs', d.id));
        }
      }
    } catch (e) { console.error(e); }
  };

  // ── Build AI context from tests + health plan ────────────────────────────
  const buildLabContext = () => {
    const parts: string[] = [];

    if (profile) {
      const p = [
        profile.primaryGoal && `Goal: ${profile.primaryGoal}`,
        profile.fitnessFocus?.length && `Fitness: ${profile.fitnessFocus.join(', ')}`,
        profile.foodPreference && `Diet: ${profile.foodPreference}`,
        profile.chronicConditions?.length && `Conditions: ${profile.chronicConditions.join(', ')}`,
      ].filter(Boolean);
      if (p.length) parts.push('Profile:\n' + p.join('\n'));
    }

    if (tests.length > 0) {
      const testLines = tests
        .filter(t => t.latestReading)
        .slice(0, 15)
        .map(t => {
          const s = getTestStatus(t);
          return `${t.name}: ${t.latestReading!.value} ${t.unit} (${s.status}) — ${t.latestReading!.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
        });
      if (testLines.length) parts.push('Latest lab results:\n' + testLines.join('\n'));
    }

    const overdue = testStatuses.filter(s => s.status === 'overdue').map(s => s.recommended.name);
    const never = testStatuses.filter(s => s.status === 'never' && s.recommended.priority === 'essential').map(s => s.recommended.name);
    if (overdue.length) parts.push(`Overdue tests: ${overdue.join(', ')}`);
    if (never.length) parts.push(`Never tested (essential): ${never.join(', ')}`);

    return parts.join('\n\n');
  };

  // ── Generate / refresh labs insight ──────────────────────────────────────
  const generateInsight = async () => {
    if (!user) return;
    setInsightLoading(true);
    try {
      const context = buildLabContext();
      const userContent = `You are a health coach reviewing someone's lab results. Give a 2-3 sentence personalised insight based on their data. Be specific, reference actual values. End with one clear action.

${context}

Response: plain text only, no markdown, no headers.`;

      // ROLLBACK: previous Anthropic implementation
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
      //     max_tokens: 300,
      //     messages: [{ role: 'user', content: userContent }],
      //   }),
      // });
      // const data = await response.json();
      // const text = data.content?.[0]?.text || '';

      const text = await insightCall.execute(async () => {
        const { text: raw } = await callAI({
          model: 'gemini-flash-lite-latest',
          contents: userContent,
          maxTokens: 300,
          thinkingBudget: 0,
        });
        if (!raw.trim()) throw new Error('Empty response');
        return raw;
      }, { callType: 'lab_insight', model: 'gemini-flash-lite-latest' });

      if (text) {
        const now = new Date().toISOString();
        setInsightText(text);
        setInsightGeneratedAt(now);
        await setDoc(doc(db, 'users', user.uid, 'aiInsights', 'labs'), { text, generatedAt: now });
      }
    } catch (e) { console.error('Insight error:', e); }
    finally { setInsightLoading(false); }
  };


  const refreshData = () => {
    if (!user) return;
    setLoading(true);
    cleanupMalformedDocuments().then(async () => {
      const q = query(collection(db, 'users', user.uid, 'labs'), orderBy('date', 'desc'), limit(50));
      const snap = await getDocs(q);
      setLabResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as LabResults)).filter(e => e?.results && Array.isArray(e.results)));
      setLoading(false);
    });
  };

  useEffect(() => {
    const h = () => setOpenMenuId(null);
    if (openMenuId) document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [openMenuId]);

  const getTestStatus = (test: LabTestCard) => {
    if (!test.latestReading) return { status: 'No readings yet', color: 'text-gray-500', accentColor: '#374151' };
    const { value } = test.latestReading;
    const { referenceRangeLow: low, referenceRangeHigh: high } = test;
    if (low === null && high === null) return { status: '—', color: 'text-gray-500', accentColor: '#374151' };
    if ((high && value > high * 1.2) || (low && value < low * 0.8)) return { status: 'Critical', color: 'text-red-500', accentColor: '#ef4444' };
    if (high && value > high) return { status: '↑ High', color: 'text-amber-500', accentColor: '#f59e0b' };
    if (low && value < low) return { status: '↓ Low', color: 'text-blue-500', accentColor: '#3b82f6' };
    return { status: '✓ Normal', color: 'text-green-500', accentColor: '#10b981' };
  };

  const getDueDateChip = (d: Date | null) => {
    if (!d) return { text: '', color: '' };
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return { text: `Due ${Math.abs(days)}d ago`, color: 'bg-red-500' };
    if (days <= 30) return { text: `Due in ${days}d`, color: 'bg-amber-500' };
    return { text: `Due in ${Math.floor(days / 30)}mo`, color: 'bg-green-500' };
  };

  const sortTests = (arr: LabTestCard[]) => [...arr].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    const as = getTestStatus(a), bs = getTestStatus(b);
    if (as.status === 'Critical' && bs.status !== 'Critical') return -1;
    if (bs.status === 'Critical' && as.status !== 'Critical') return 1;
    const aOor = as.status === '↑ High' || as.status === '↓ Low';
    const bOor = bs.status === '↑ High' || bs.status === '↓ Low';
    if (aOor && !bOor) return -1;
    if (!aOor && bOor) return 1;
    return 0;
  });

  const handlePinToggle = async (testId: string, pinned: boolean) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'tests', testId), cleanData({ pinned: !pinned }));
    setTests(prev => prev.map(t => t.id === testId ? { ...t, pinned: !pinned } : t));
    setOpenMenuId(null);
  };

  const handleDeleteTest = async (testId: string, name: string) => {
    if (!user || !window.confirm(`Delete ${name}? This removes all readings.`)) return;
    const rSnap = await getDocs(collection(db, 'users', user.uid, 'tests', testId, 'readings'));
    for (const r of rSnap.docs) await deleteDoc(r.ref);
    await deleteDoc(doc(db, 'users', user.uid, 'tests', testId));
    setTests(prev => prev.filter(t => t.id !== testId));
    await bumpDataVersion(user.uid);
    setOpenMenuId(null);
  };

  const TestCard = ({ test }: { test: LabTestCard }) => {
    const status = getTestStatus(test);
    const dueChip = getDueDateChip(test.nextDueDate);
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-slate-800 transition-colors relative"
        style={{ borderLeft: `3px solid ${test.pinned ? '#f59e0b' : status.accentColor}` }}
        onClick={() => navigate(`/labs/${test.id}`)}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${test.pinned ? '#f59e0b' : status.accentColor}15` }}>
          <span className="text-lg">{getTestIcon(test.name)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{test.name}</div>
          <div className="text-xs text-slate-400">
            {getTestCategory(test.name)} · {test.latestReading
              ? test.latestReading.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
              : 'No readings'}
          </div>
          {dueChip.text && <span className={`inline-block px-2 py-0.5 rounded-full text-xs text-white mt-1 ${dueChip.color}`}>{dueChip.text}</span>}
        </div>
        <div className="text-right flex-shrink-0">
          {test.latestReading ? (
            <>
              <div className="text-sm font-mono text-white">{test.latestReading.value}<span className="text-xs text-slate-400 ml-1">{test.unit}</span></div>
              <div className={`text-xs mt-0.5 ${status.color}`}>{status.status}</div>
            </>
          ) : <div className="text-sm text-slate-400">No readings</div>}
        </div>
        <button onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === test.id ? null : test.id); }}
          className="text-slate-400 hover:text-white p-1 flex-shrink-0">⋮</button>
        {openMenuId === test.id && (
          <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50 min-w-[160px]">
            <button onClick={e => { e.stopPropagation(); handlePinToggle(test.id, test.pinned || false); }}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 transition-colors text-left">
              <span>📌</span><span className="text-sm text-white">{test.pinned ? 'Unpin' : 'Pin to top'}</span>
            </button>
            <button onClick={e => { e.stopPropagation(); handleDeleteTest(test.id, test.name); }}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 transition-colors text-left">
              <span>🗑️</span><span className="text-sm text-red-400">Delete test</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const sortedTests = sortTests(tests);
  const pinnedTests = sortedTests.filter(t => t.pinned);
  const unpinnedTests = sortedTests.filter(t => !t.pinned);

  const overdueCount = testStatuses.filter(s => s.status === 'overdue').length;
  const neverCount = testStatuses.filter(s => s.status === 'never').length;
  const dueSoonCount = testStatuses.filter(s => s.status === 'due_soon').length;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-5 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Lab Results</h1>
            <p className="text-slate-400 text-sm">{tests.length > 0 ? `${tests.length} tests tracked` : 'No tests yet'}</p>
          </div>
          <button onClick={() => setIsModalOpen(true)}
            className="w-11 h-11 bg-emerald-500 rounded-full flex items-center justify-center hover:bg-emerald-600 transition-colors">
            <Plus className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* ── HEALTH PLAN ── */}
        {testStatuses.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <button onClick={() => setHealthPlanExpanded(e => !e)}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-800/50 transition-colors">
              <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center text-xl flex-shrink-0">🩺</div>
              <div className="flex-1 text-left">
                <div className="text-sm font-semibold text-white">Your Health Plan</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">{getHealthPlanSummary(testStatuses)}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {overdueCount > 0 && <span className="text-[9px] font-mono bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">{overdueCount} overdue</span>}
                {neverCount > 0 && !overdueCount && <span className="text-[9px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">{neverCount} new</span>}
                {dueSoonCount > 0 && !overdueCount && !neverCount && <span className="text-[9px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">{dueSoonCount} due soon</span>}
                {healthPlanExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </div>
            </button>

            {healthPlanExpanded && (
              <div className="border-t border-slate-800">
                {(['overdue', 'due_soon', 'never', 'recent'] as const).map(statusKey => {
                  const items = testStatuses.filter(s => s.status === statusKey);
                  if (!items.length) return null;
                  const cfg = {
                    overdue:  { label: '🔴 Overdue',     color: 'text-red-400',     bg: 'bg-red-500/5' },
                    due_soon: { label: '⚠️ Due soon',    color: 'text-amber-400',   bg: 'bg-amber-500/5' },
                    never:    { label: '➕ Never done',   color: 'text-blue-400',    bg: 'bg-blue-500/5' },
                    recent:   { label: '✅ Up to date',  color: 'text-emerald-400', bg: 'bg-emerald-500/5' },
                  }[statusKey];
                  return (
                    <div key={statusKey}>
                      <div className={`px-4 py-1.5 text-[9px] font-mono font-semibold uppercase tracking-wider ${cfg.color} ${cfg.bg}`}>
                        {cfg.label} · {items.length}
                      </div>
                      {items.map(item => (
                        <div key={item.recommended.name} className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/40 last:border-0">
                          <span className="text-lg flex-shrink-0">{item.recommended.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-medium text-white">{item.recommended.name}</span>
                              <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                                item.recommended.priority === 'essential' ? 'bg-red-500/10 text-red-400' :
                                item.recommended.priority === 'important' ? 'bg-amber-500/10 text-amber-400' :
                                'bg-slate-700 text-slate-500'}`}>
                                {item.recommended.priority}
                              </span>
                            </div>
                            <div className="text-[9px] text-slate-500 mt-0.5">{item.recommended.reason}</div>
                            {item.lastDone && (
                              <div className="text-[9px] font-mono text-slate-600 mt-0.5">
                                Last: {item.lastDone.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                {item.lastValue ? ` · ${item.lastValue}` : ''}
                                {item.daysUntilDue !== null && item.daysUntilDue < 0 && <span className="text-red-400 ml-1">({Math.abs(item.daysUntilDue)}d overdue)</span>}
                                {item.daysUntilDue !== null && item.daysUntilDue >= 0 && item.daysUntilDue <= 45 && <span className="text-amber-400 ml-1">(due in {item.daysUntilDue}d)</span>}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {/* Interval customizer */}
                            {customizingTest === item.recommended.name ? (
                              <div className="flex items-center gap-1">
                                <select defaultValue={item.intervalMonths}
                                  onChange={async e => {
                                    const months = parseInt(e.target.value);
                                    if (item.existingTestId && user) {
                                      await updateDoc(doc(db, 'users', user.uid, 'tests', item.existingTestId), { reminderIntervalMonths: months });
                                      setTests(prev => prev.map(t => t.id === item.existingTestId ? { ...t, reminderIntervalMonths: months } : t));
                                    }
                                    setCustomizingTest(null);
                                  }}
                                  className="bg-slate-800 border border-slate-700 rounded text-[10px] text-white px-1.5 py-1 focus:outline-none">
                                  {[1, 3, 6, 12, 24].map(m => <option key={m} value={m}>{m === 12 ? '1 year' : m === 24 ? '2 years' : `${m}mo`}</option>)}
                                </select>
                                <button onClick={() => setCustomizingTest(null)} className="text-slate-500 text-xs">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => setCustomizingTest(item.recommended.name)}
                                className="text-[9px] font-mono text-slate-600 hover:text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
                                every {item.intervalMonths}mo
                              </button>
                            )}
                            {item.existingTestId
                              ? <button onClick={() => navigate(`/labs/${item.existingTestId}`)} className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300">View →</button>
                              : <button onClick={() => navigate('/labs/upload')} className="text-[9px] font-mono text-blue-400 hover:text-blue-300">Upload →</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── AI LABS INSIGHT ── */}
        <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-transparent" />
          <div className="p-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] font-mono text-blue-400 tracking-wider uppercase">Lab Insight</span>
              {insightGeneratedAt && (
                <span className="ml-auto text-[9px] font-mono text-slate-600">
                  {new Date(insightGeneratedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              <button onClick={generateInsight} disabled={insightLoading}
                className="text-slate-600 hover:text-blue-400 transition-colors disabled:opacity-40 p-0.5">
                <RefreshCw className={`w-3 h-3 ${insightLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Insight text or empty state */}
            {insightLoading ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-slate-400">Analysing your lab data…</span>
              </div>
            ) : insightText ? (
              <p className="text-xs text-slate-300 leading-relaxed mb-3">{insightText}</p>
            ) : insightCall.error ? (
              <div className="mb-3">
                <p className="text-xs text-slate-500 mb-2">Couldn't load insight.</p>
                <button onClick={generateInsight}
                  className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors">
                  Retry
                </button>
              </div>
            ) : (
              <div className="mb-3">
                <p className="text-xs text-slate-500 mb-2">Get an AI summary of your lab results and what to focus on.</p>
                <button onClick={generateInsight}
                  className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors">
                  ✦ Generate insight
                </button>
              </div>
            )}

            {/* Ask AI Coach — full-screen chat entry point */}
            <button
              onClick={() => navigate('/ai-coach?topic=labs')}
              className="w-full flex items-center gap-2 mt-3 pt-3 border-t border-slate-800 hover:opacity-80 transition-opacity"
            >
              <span className="text-blue-400 text-xs">✦</span>
              <span className="text-xs text-slate-500 flex-1 text-left">Have a question about your results or a test package?</span>
              <span className="text-[10px] font-mono text-blue-400">Ask AI Coach →</span>
            </button>
          </div>
        </div>

        {/* Upload button */}
        <button onClick={() => navigate('/labs/upload')}
          className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl p-4 flex items-center justify-between hover:from-emerald-600 hover:to-emerald-700 transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center"><span className="text-lg">📄</span></div>
            <div className="text-left">
              <div className="text-white font-semibold text-sm">Upload Lab Report</div>
              <div className="text-white/70 text-xs">AI auto-fills all test values</div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-white/60" />
        </button>

        {/* Test cards */}
        {tests.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Your Tests</h2>
              <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full text-xs">{tests.length}</span>
            </div>

            {pinnedTests.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 text-sm">📌</span>
                  <span className="text-xs font-semibold text-amber-400">Pinned</span>
                </div>
                {pinnedTests.map(t => <TestCard key={t.id} test={t} />)}
              </div>
            )}

            {unpinnedTests.length > 0 && (
              <div className="space-y-3">
                {unpinnedTests.map(t => <TestCard key={t.id} test={t} />)}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-900 rounded-xl p-8 border border-slate-800 text-center">
            <AlertCircle className="w-12 h-12 text-slate-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">No lab results yet</h3>
            <p className="text-slate-400 text-sm mb-4">Track your yearly blood tests to monitor health trends over time</p>
            <button onClick={() => setIsModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /><span>Add First Result</span>
            </button>
          </div>
        )}
      </div>

      <LabsModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={refreshData} />
    </div>
  );
}