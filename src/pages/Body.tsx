import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, TrendingUp, TrendingDown, Edit3, Trash2, RotateCw } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip, XAxis } from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import { usePageLoadTime } from '@/hooks/usePageLoadTime';
import BodyStatsModal from '@/components/BodyStatsModal';
import { collection, query, orderBy, limit, getDocs, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { callAI } from '@/lib/callAI';
import { useAsyncCall } from '@/hooks/useAsyncCall';

interface BodyStats {
  id: string;
  date: string;
  weightKg: number;
  pbf: number;
  smm?: number;
  legLeanMass?: number;
  ecwRatio?: number;
  waist?: number;
  neck?: number;
  chest?: number;
  thigh?: number;
  height?: number;
  visceralFat?: number;
  boneMass?: number;
  metabolicAge?: number;
  notes?: string;
  customFields?: { name: string; unit: string; value: number }[];
  createdAt: any;
}

// Safe number formatter — never throws, always returns a string
const fmt = (val: number | null | undefined, decimals = 1): string => {
  if (val == null || isNaN(Number(val))) return '--';
  return Number(val).toFixed(decimals);
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div style={{
      background: '#1a2a3a',
      border: '0.5px solid rgba(255,255,255,0.12)',
      borderRadius: '8px',
      padding: '6px 10px',
      fontSize: '12px',
      color: '#e2e8f0',
      lineHeight: '1.5',
      pointerEvents: 'none',
    }}>
      <div style={{ color: '#6b7280', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontWeight: 500, color: entry.color || '#10b981' }}>
        {entry.value != null ? entry.value : '--'}{entry.unit || ''}
      </div>
    </div>
  );
};

export default function Body() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [loading, setLoading] = useState(true);
  usePageLoadTime('Body', loading);
  const [timeRange, setTimeRange] = useState<'1W' | '1M' | '3M' | 'All'>('1M');
  const [editData, setEditData] = useState<{
    id: string;
    date: string;
    weightKg: number;
    pbf: number;
    smm?: number | undefined;
    legLeanMass?: number | undefined;
    ecwRatio?: number | undefined;
    customFields?: { name: string; unit: string; value: number }[] | undefined;
  } | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      try {
        const bodyStatsQuery = query(
          collection(db, 'users', user.uid, 'bodyComp'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const bodyStatsSnapshot = await getDocs(bodyStatsQuery);
        const stats: BodyStats[] = bodyStatsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as BodyStats));
        setBodyStats(stats);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  const refreshData = () => {
    if (!user) return;
    setLoading(true);
    const fetchData = async () => {
      try {
        const bodyStatsQuery = query(
          collection(db, 'users', user.uid, 'bodyComp'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const bodyStatsSnapshot = await getDocs(bodyStatsQuery);
        const stats: BodyStats[] = bodyStatsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as BodyStats));
        setBodyStats(stats);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  };

  // ── AI Body Insight ─────────────────────────────────────────────────────
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiInsightGeneratedAt, setAiInsightGeneratedAt] = useState<Date | null>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const insightCall = useAsyncCall<string>();

  const fetchAiInsight = async (forceRefresh = false) => {
    if (!user) return;
    setAiInsightLoading(true);
    try {
      const cacheRef = doc(db, 'users', user.uid, 'aiInsights', 'body');

      if (!forceRefresh) {
        const cacheSnap = await getDoc(cacheRef);
        if (cacheSnap.exists()) {
          const cached = cacheSnap.data() as any;
          const ageHrs = (Date.now() - new Date(cached.generatedAt).getTime()) / 3_600_000;
          if (ageHrs < 24 && cached.insight) {
            setAiInsight(cached.insight);
            setAiInsightGeneratedAt(new Date(cached.generatedAt));
            setAiInsightLoading(false);
            return;
          }
        }
      }

      // Build context from last 10 bodyComp entries
      const recent = bodyStats.slice(0, 10);
      if (recent.length === 0) { setAiInsightLoading(false); return; }

      const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
      const profile = profileSnap.exists() ? profileSnap.data() as any : {};

      const contextLines = recent.map(s => {
        const parts = [`date: ${s.date}`, `weight: ${s.weightKg}kg`, `pbf: ${s.pbf}%`];
        if (s.smm != null) parts.push(`SMM: ${s.smm}kg`);
        if (s.visceralFat != null) parts.push(`visceral fat: ${s.visceralFat}`);
        const fm = (s.weightKg != null && s.pbf != null) ? +(s.weightKg * s.pbf / 100).toFixed(1) : null;
        const lm = (s.weightKg != null && fm != null) ? +(s.weightKg - fm).toFixed(1) : null;
        if (fm != null) parts.push(`fat mass: ${fm}kg`);
        if (lm != null) parts.push(`lean mass: ${lm}kg`);
        if (s.legLeanMass != null) parts.push(`leg lean: ${s.legLeanMass}kg`);
        return parts.join(', ');
      }).join('\n');

      const profileCtx = [
        profile.age && `Age: ${profile.age}`,
        profile.height && `Height: ${profile.height}cm`,
        profile.gender && `Gender: ${profile.gender}`,
        profile.primaryGoal && `Goal: ${profile.primaryGoal}`,
      ].filter(Boolean).join(', ');

      const bodyInsightSystem = 'You are a body composition coach. Analyse the user\'s body composition trend data and give 2-3 sentences of specific, encouraging insight. Mention actual numbers. Flag if fat mass is rising while weight drops (muscle loss risk), or praise recomposition if fat is down and SMM is up. Keep it under 60 words. No bullet points.';
      const bodyInsightContent = `Body composition data (most recent first):\n${contextLines}\n\nProfile: ${profileCtx || 'not provided'}\nTime range viewed: ${timeRange}`;

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
      //     max_tokens: 150,
      //     system: bodyInsightSystem,
      //     messages: [{ role: 'user', content: bodyInsightContent }],
      //   }),
      // });
      // if (!response.ok) throw new Error(`API error ${response.status}`);
      // const data = await response.json();
      // const insight = data.content?.[0]?.text?.trim() || '';

      const insight = await insightCall.execute(async () => {
        const { text } = await callAI({
          model: 'gemini-flash-lite-latest',
          systemInstruction: bodyInsightSystem,
          contents: bodyInsightContent,
          maxTokens: 150,
          thinkingBudget: 0,
        });
        const trimmed = text.trim();
        if (!trimmed) throw new Error('Empty response');
        return trimmed;
      }, { callType: 'body_insight', model: 'gemini-flash-lite-latest' });

      if (insight) {
        const generatedAt = new Date().toISOString();
        await setDoc(cacheRef, { insight, generatedAt }, { merge: true });
        setAiInsight(insight);
        setAiInsightGeneratedAt(new Date(generatedAt));
      }
    } catch (e) {
      console.error('AI body insight failed:', e);
    } finally {
      setAiInsightLoading(false);
    }
  };

  useEffect(() => {
    if (bodyStats.length > 0 && user) fetchAiInsight();
  }, [bodyStats, user]);

  const deleteEntry = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'bodyComp', id));
      setBodyStats(prev => prev.filter(stat => stat.id !== id));
    } catch (error) {
      console.error('Error deleting entry:', error);
    }
  };

  const editEntry = (stat: BodyStats) => {
    setEditData({
      id: stat.id,
      date: stat.date,
      weightKg: stat.weightKg,
      pbf: stat.pbf,
      smm: stat.smm,
      legLeanMass: stat.legLeanMass,
      ecwRatio: stat.ecwRatio,
      customFields: stat.customFields,
    });
    setIsModalOpen(true);
  };

  const latestStats = bodyStats[0];
  const previousStats = bodyStats[1];

  const calculateDelta = (current: number | null | undefined, previous: number | null | undefined, metric: string = 'weight') => {
    if (current == null || previous == null || isNaN(Number(current)) || isNaN(Number(previous))) return null;
    const delta = Number(current) - Number(previous);
    let isImprovement = false;
    switch (metric) {
      case 'weight':
      case 'pbf':
      case 'fatMass':
      case 'visceralFat':
      case 'metabolicAge':
        isImprovement = delta < 0;
        break;
      case 'smm':
      case 'legLeanMass':
      case 'leanMass':
      case 'boneMass':
        isImprovement = delta > 0;
        break;
      case 'height':
        isImprovement = Math.abs(delta) < 0.5;
        break;
      default:
        isImprovement = delta > 0;
    }
    return { value: delta, isImprovement };
  };

  const formatDelta = (delta: { value: number; isImprovement: boolean } | null) => {
    if (!delta || isNaN(delta.value)) return null;
    const sign = delta.value > 0 ? '+' : '';
    const color = delta.isImprovement ? 'text-emerald-500' : 'text-red-500';
    const Icon = delta.isImprovement ? TrendingUp : TrendingDown;
    return (
      <div className={`flex items-center space-x-1 ${color}`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs font-medium">
          {sign}{fmt(delta.value)}
        </span>
      </div>
    );
  };

  // Filter data based on time range
  const getFilteredData = () => {
    if (timeRange === 'All') return bodyStats;
    const now = new Date();
    const cutoffDate = new Date();
    if (timeRange === '1W') cutoffDate.setDate(now.getDate() - 7);
    else if (timeRange === '1M') cutoffDate.setDate(now.getDate() - 30);
    else if (timeRange === '3M') cutoffDate.setDate(now.getDate() - 90);
    return bodyStats.filter(stat => new Date(stat.date) >= cutoffDate);
  };

  const filteredStats = getFilteredData();
  const filteredEntries = filteredStats;
  const latestEntry = bodyStats[0] ?? null;
  const rangeStartEntry = filteredEntries.length > 0 ? filteredEntries[filteredEntries.length - 1] : null;

  // Safe range-based delta
  const getDelta = (field: string): number | null => {
    const latest = latestEntry?.[field as keyof BodyStats];
    const start = rangeStartEntry?.[field as keyof BodyStats];
    if (latest == null || start == null || isNaN(Number(latest)) || isNaN(Number(start))) return null;
    const result = Number(latest) - Number(start);
    if (isNaN(result)) return null;
    return parseFloat(result.toFixed(1));
  };



  const calculateDerivedMetrics = (stats: BodyStats) => {
    const w = stats.weightKg != null ? Number(stats.weightKg) : null;
    const p = stats.pbf != null ? Number(stats.pbf) : null;
    const fatMass = (w != null && p != null && !isNaN(w) && !isNaN(p))
      ? parseFloat((w * (p / 100)).toFixed(1)) : null;
    const leanMass = (w != null && fatMass != null && !isNaN(w) && !isNaN(fatMass))
      ? parseFloat((w - fatMass).toFixed(1)) : null;
    return { fatMass, leanMass };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Body</h1>

        {/* Range Tabs */}
        <div className="flex space-x-2">
          {(['1W', '1M', '3M', 'All'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                timeRange === range
                  ? 'bg-emerald-500 text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Range Description */}
        <div className="text-sm text-slate-500">
          Showing improvement over the last {
            timeRange === '1W' ? '1 week' :
            timeRange === '1M' ? '1 month' :
            timeRange === '3M' ? '3 months' : 'all time'
          }
        </div>

        {/* Latest Stats Card */}
        {latestStats ? (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                Latest Stats
              </h2>
              <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">
                vs {timeRange === '1W' ? '1 week' : timeRange === '1M' ? '1 month' : timeRange === '3M' ? '3 months' : 'all time'} ago
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-3xl font-bold text-white">{latestStats.weightKg != null ? latestStats.weightKg : '--'}</span>
                  <span className="text-slate-400">kg</span>
                </div>
                <div className="flex items-baseline space-x-2 mt-1">
                  <span className="text-xl font-semibold text-emerald-400">{latestStats.pbf != null ? latestStats.pbf : '--'}</span>
                  <span className="text-slate-400">PBF%</span>
                </div>
              </div>
              <div className="flex flex-col space-y-2">
                {(() => {
                  const weightDelta = getDelta('weightKg');
                  const pbfDelta = getDelta('pbf');
                  return (
                    <>
                      {weightDelta != null && (
                        <div className={`flex items-center space-x-1 ${weightDelta < 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          <span className="text-xs font-medium">
                            {weightDelta < 0 ? '↓' : '↑'} {fmt(Math.abs(weightDelta))}
                          </span>
                        </div>
                      )}
                      {pbfDelta != null && (
                        <div className={`flex items-center space-x-1 ${pbfDelta < 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          <span className="text-xs font-medium">
                            {pbfDelta < 0 ? '↓' : '↑'} {fmt(Math.abs(pbfDelta))}
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-center">
            <TrendingUp className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-white mb-2">No data yet</h3>
            <p className="text-slate-400 text-sm">Start tracking your body composition to see your stats here</p>
          </div>
        )}

        {/* AI Body Insight */}
        {bodyStats.length > 0 && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-400">✦ AI Insight</span>
              <button
                onClick={() => fetchAiInsight(true)}
                disabled={aiInsightLoading}
                className="text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
                title="Refresh insight"
              >
                <RotateCw className={`w-3.5 h-3.5 ${aiInsightLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {aiInsightLoading && !aiInsight ? (
              <div className="h-4 bg-slate-800 rounded animate-pulse w-3/4" />
            ) : aiInsight ? (
              <>
                <p className="text-sm text-slate-200 leading-relaxed">{aiInsight}</p>
                {aiInsightGeneratedAt && (
                  <p className="text-[10px] text-slate-500 mt-2">
                    Updated {Math.round((Date.now() - aiInsightGeneratedAt.getTime()) / 3_600_000)}h ago
                  </p>
                )}
              </>
            ) : insightCall.error ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Couldn't load insight.</p>
                <button
                  onClick={() => fetchAiInsight(true)}
                  className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300"
                >
                  Retry
                </button>
              </div>
            ) : null}
            <button
              onClick={() => navigate('/ai-coach?topic=body')}
              className="w-full flex items-center gap-2 mt-3 pt-3 border-t border-slate-800 hover:opacity-80 transition-opacity"
            >
              <span className="text-emerald-400 text-xs">✦</span>
              <span className="text-xs text-slate-500 flex-1 text-left">Want a deeper look at your trends?</span>
              <span className="text-[10px] font-mono text-emerald-400">Ask AI Coach →</span>
            </button>
          </div>
        )}

        {/* Trends Section */}
        {filteredEntries.length > 0 && (
          <div className="space-y-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Trends</div>
            {[
              { key: 'weightKg', label: 'Weight', unit: 'kg' },
              { key: 'pbf', label: 'Body Fat %', unit: '%' },
              { key: 'smm', label: 'SMM', unit: 'kg' },
              { key: 'legLeanMass', label: 'Leg Lean Mass', unit: 'kg' },
              { key: 'ecwRatio', label: 'ECW Ratio', unit: '' },
            ].map((field) => {
              const entriesWithData = filteredEntries.filter(entry => {
                const val = entry[field.key as keyof BodyStats];
                return val != null && !isNaN(Number(val));
              });
              if (entriesWithData.length < 2) return null;
              const delta = getDelta(field.key);
              return (
                <div key={field.key} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                      {field.label} {field.unit && `(${field.unit})`}
                    </h3>
                    {delta != null && (
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        delta < 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {delta < 0 ? '▼' : '▲'} {fmt(Math.abs(delta))} {field.unit}/{timeRange}
                      </span>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={entriesWithData.slice().reverse().map(entry => ({
                      date: new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      value: entry[field.key as keyof BodyStats] as number
                    }))}>
                      <XAxis dataKey="date" hide={true} />
                      <YAxis domain={['auto', 'auto']} hide={true} />
                      <Tooltip
                        content={<ChartTooltip />}
                        cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: '#10b981', r: 3 }}
                        activeDot={{ r: 5, fill: '#10b981', stroke: '#0f1218', strokeWidth: 2 }}
                        unit={field.unit ? ` ${field.unit}` : ''}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        )}

        {/* Change vs Previous Table */}
        {latestStats && previousStats && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Change vs Previous</h2>
            <div className="space-y-2">
              {[
                { label: 'Weight', current: latestStats.weightKg, previous: previousStats.weightKg, unit: 'kg', metricType: 'weight' },
                { label: 'Body Fat %', current: latestStats.pbf, previous: previousStats.pbf, unit: '%', metricType: 'pbf' },
                {
                  label: 'Body Fat (kg)',
                  current: (latestStats.weightKg != null && latestStats.pbf != null) ? Number(latestStats.weightKg) * (Number(latestStats.pbf) / 100) : null,
                  previous: (previousStats?.weightKg != null && previousStats?.pbf != null) ? Number(previousStats.weightKg) * (Number(previousStats.pbf) / 100) : null,
                  unit: 'kg', metricType: 'fatMass'
                },
                { label: 'SMM', current: latestStats.smm, previous: previousStats.smm, unit: 'kg', metricType: 'smm' },
                { label: 'Leg Lean Mass', current: latestStats.legLeanMass, previous: previousStats.legLeanMass, unit: 'kg', metricType: 'legLeanMass' },
                { label: 'Waist', current: latestStats.waist, previous: previousStats.waist, unit: 'cm', metricType: 'waist' },
                ...(latestStats.height ? [{ label: 'Height', current: latestStats.height, previous: previousStats?.height, unit: 'cm', metricType: 'height' }] : []),
                ...(latestStats.visceralFat ? [{ label: 'Visceral Fat', current: latestStats.visceralFat, previous: previousStats?.visceralFat, unit: 'level', metricType: 'visceralFat' }] : []),
                ...(latestStats.boneMass ? [{ label: 'Bone Mass', current: latestStats.boneMass, previous: previousStats?.boneMass, unit: 'kg', metricType: 'boneMass' }] : []),
                ...(latestStats.metabolicAge ? [{ label: 'Metabolic Age', current: latestStats.metabolicAge, previous: previousStats?.metabolicAge, unit: 'years', metricType: 'metabolicAge' }] : []),
              ].map((metric) => {
                const delta = metric.current != null && metric.previous != null
                  ? calculateDelta(metric.current, metric.previous, metric.metricType)
                  : null;
                return (
                  <div key={metric.label} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                    <span className="text-slate-300 text-sm">{metric.label}</span>
                    <div className="flex items-center space-x-3">
                      <span className="text-white text-sm font-medium">
                        {metric.current != null ? `${fmt(metric.current)}${metric.unit}` : '--'}
                      </span>
                      {formatDelta(delta)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Derived Metric Cards */}
        {latestStats && (() => {
          const currentDerived = calculateDerivedMetrics(latestStats);
          const previousDerived = previousStats ? calculateDerivedMetrics(previousStats) : null;
          return (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 uppercase tracking-wider">Derived</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                  <div className="text-sm text-slate-400 mb-1">Fat Mass</div>
                  <div className="text-xl font-bold text-white mb-1">{fmt(currentDerived.fatMass)} kg</div>
                  {currentDerived.fatMass != null && previousDerived?.fatMass != null &&
                    formatDelta(calculateDelta(currentDerived.fatMass, previousDerived.fatMass, 'fatMass'))}
                </div>
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                  <div className="text-sm text-slate-400 mb-1">Lean Mass</div>
                  <div className="text-xl font-bold text-white mb-1">{fmt(currentDerived.leanMass)} kg</div>
                  {currentDerived.leanMass != null && previousDerived?.leanMass != null &&
                    formatDelta(calculateDelta(currentDerived.leanMass, previousDerived.leanMass, 'leanMass'))}
                </div>
              </div>

              {(latestStats.height || latestStats.visceralFat || latestStats.boneMass || latestStats.metabolicAge) && (
                <>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">Body Composition</div>
                  <div className="grid grid-cols-2 gap-3">
                    {latestStats.height != null && (
                      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                        <div className="text-sm text-slate-400 mb-1">Height</div>
                        <div className="text-xl font-bold text-white mb-1">{fmt(latestStats.height)} cm</div>
                        {previousStats?.height != null && formatDelta(calculateDelta(latestStats.height, previousStats.height, 'height'))}
                      </div>
                    )}
                    {latestStats.visceralFat != null && (
                      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                        <div className="text-sm text-slate-400 mb-1">Visceral Fat</div>
                        <div className="text-xl font-bold text-white mb-1">{fmt(latestStats.visceralFat, 0)} level</div>
                        {previousStats?.visceralFat != null && formatDelta(calculateDelta(latestStats.visceralFat, previousStats.visceralFat, 'visceralFat'))}
                      </div>
                    )}
                    {latestStats.boneMass != null && (
                      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                        <div className="text-sm text-slate-400 mb-1">Bone Mass</div>
                        <div className="text-xl font-bold text-white mb-1">{fmt(latestStats.boneMass)} kg</div>
                        {previousStats?.boneMass != null && formatDelta(calculateDelta(latestStats.boneMass, previousStats.boneMass, 'boneMass'))}
                      </div>
                    )}
                    {latestStats.metabolicAge != null && (
                      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                        <div className="text-sm text-slate-400 mb-1">Metabolic Age</div>
                        <div className="text-xl font-bold text-white mb-1">{fmt(latestStats.metabolicAge, 0)} years</div>
                        {previousStats?.metabolicAge != null && formatDelta(calculateDelta(latestStats.metabolicAge, previousStats.metabolicAge, 'metabolicAge'))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Optional Fields Section */}
        {(() => {
          const customFieldNames = new Set<string>();
          filteredEntries.forEach(entry => {
            if (entry.customFields) {
              entry.customFields.forEach(field => customFieldNames.add(field.name));
            }
          });
          const customFieldsArray = Array.from(customFieldNames);
          if (customFieldsArray.length === 0) return null;
          return (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 uppercase tracking-wider">Optional fields</div>
              {customFieldsArray.map((fieldName, index) => {
                const entriesWithData = filteredEntries.filter(entry =>
                  entry.customFields?.some(field => field.name === fieldName && field.value != null)
                );
                if (entriesWithData.length < 2) return null;
                const chartData = entriesWithData.slice().reverse().map(entry => {
                  const customField = entry.customFields?.find(field => field.name === fieldName);
                  return {
                    date: new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    value: customField?.value ?? 0,
                    unit: customField?.unit || ''
                  };
                });
                const colors = ['#6366f1', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981'];
                const strokeColor = colors[index % colors.length];
                const fieldUnit = chartData[0]?.unit || '';
                return (
                  <div key={fieldName} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{fieldName}</h3>
                      <span className="px-2 py-1 bg-slate-800 text-slate-400 text-xs rounded-full">{entriesWithData.length} entries</span>
                    </div>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={chartData}>
                        <XAxis dataKey="date" hide={true} />
                        <YAxis domain={['auto', 'auto']} hide={true} />
                        <Tooltip
                          content={<ChartTooltip />}
                          cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={strokeColor}
                          strokeWidth={2}
                          dot={{ fill: strokeColor, r: 3 }}
                          activeDot={{ r: 5, fill: strokeColor, stroke: '#0f1218', strokeWidth: 2 }}
                          unit={fieldUnit ? ` ${fieldUnit}` : ''}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* History Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">History</h2>
          {filteredEntries.length > 0 ? (
            <div className="space-y-2">
              {filteredEntries.map((stat) => (
                <div key={stat.id} className="bg-slate-900 rounded-lg p-4 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white">
                      {new Date(stat.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {stat.weightKg != null && <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">{stat.weightKg} kg</span>}
                      {stat.pbf != null && <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">{stat.pbf}% PBF</span>}
                      {stat.smm != null && <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">SMM {stat.smm} kg</span>}
                      {stat.legLeanMass != null && <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">Leg {stat.legLeanMass} kg</span>}
                      {stat.ecwRatio != null && <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">ECW {stat.ecwRatio}</span>}
                      {stat.customFields?.map((field, index) => (
                        field.value != null && (
                          <span key={index} className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded">
                            {field.name} {field.value} {field.unit}
                          </span>
                        )
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => editEntry(stat)} className="text-slate-400 hover:text-emerald-400 p-2">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { if (window.confirm('Delete this entry?')) deleteEntry(stat.id); }}
                      className="text-slate-400 hover:text-red-400 p-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-center">
              <Minus className="w-8 h-8 text-slate-500 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">No history yet</p>
            </div>
          )}
          <p className="text-xs text-slate-500 text-center">Long press to delete entries</p>
        </div>
      </div>

      {/* Floating + Button */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-24 right-6 w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg hover:bg-emerald-600 transition-colors z-40"
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      <BodyStatsModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditData(undefined); }}
        onSave={refreshData}
        editData={editData}
      />
    </div>
  );
}