import { useState, useEffect } from 'react';
import { Plus, Minus, TrendingUp, TrendingDown, Edit3, Trash2 } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip, XAxis } from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import BodyStatsModal from '@/components/BodyStatsModal';
import GoalsModal from '@/components/GoalsModal';
import { Button } from '@/components/ui/button';
import { collection, query, orderBy, limit, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

interface Goal {
  id: string;
  metric: string;
  targetValue: number;
  direction: 'reduce' | 'increase';
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
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
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

        const goalsQuery = query(
          collection(db, 'users', user.uid, 'goals'),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const goalsSnapshot = await getDocs(goalsQuery);
        const userGoals: Goal[] = goalsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Goal));
        setGoals(userGoals);
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

        const goalsQuery = query(
          collection(db, 'users', user.uid, 'goals'),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const goalsSnapshot = await getDocs(goalsQuery);
        const userGoals: Goal[] = goalsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Goal));
        setGoals(userGoals);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  };

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



  const insightText = (() => {
    if (!latestEntry || !rangeStartEntry) return '';
    const weightDelta = getDelta('weightKg');
    const smmDelta = getDelta('smm');
    const parts = [];
    if (weightDelta != null && weightDelta !== 0) {
      parts.push(`Weight ${weightDelta > 0 ? 'up' : 'down'} ${fmt(Math.abs(weightDelta))} kg`);
    }
    if (smmDelta != null && smmDelta !== 0) {
      parts.push(`SMM ${smmDelta > 0 ? 'up' : 'down'} ${fmt(Math.abs(smmDelta))} kg`);
    }
    if (parts.length === 0) return '';
    const rangeLabel = timeRange === '1W' ? 'this week' :
      timeRange === '1M' ? 'this month' :
      timeRange === '3M' ? 'over 3 months' : 'all-time';
    return `${parts.join(' · ')} ${rangeLabel}`;
  })();

  const calculateDerivedMetrics = (stats: BodyStats) => {
    const w = stats.weightKg != null ? Number(stats.weightKg) : null;
    const p = stats.pbf != null ? Number(stats.pbf) : null;
    const fatMass = (w != null && p != null && !isNaN(w) && !isNaN(p))
      ? parseFloat((w * (p / 100)).toFixed(1)) : null;
    const leanMass = (w != null && fatMass != null && !isNaN(w) && !isNaN(fatMass))
      ? parseFloat((w - fatMass).toFixed(1)) : null;
    return { fatMass, leanMass };
  };

  const getThreeMonthTrend = () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentStats = bodyStats.filter(stat => new Date(stat.date) >= threeMonthsAgo);
    if (recentStats.length < 2) return { fatMassTrend: 'hold', smmTrend: 'hold' };
    const oldest = recentStats[recentStats.length - 1];
    const newest = recentStats[0];
    const oldestFatMass = (oldest.weightKg != null && oldest.pbf != null) ? Number(oldest.weightKg) * (Number(oldest.pbf) / 100) : null;
    const newestFatMass = (newest.weightKg != null && newest.pbf != null) ? Number(newest.weightKg) * (Number(newest.pbf) / 100) : null;
    const fatMassChange = (oldestFatMass != null && newestFatMass != null) ? newestFatMass - oldestFatMass : 0;
    const smmChange = (Number(newest.smm) || 0) - (Number(oldest.smm) || 0);
    return {
      fatMassTrend: fatMassChange < -0.5 ? 'improving' : fatMassChange > 0.5 ? 'focus' : 'hold',
      smmTrend: smmChange > 0.5 ? 'strong' : smmChange < -0.5 ? 'improve' : 'steady'
    };
  };

  const generateTrendSummary = () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentStats = bodyStats.filter(stat => new Date(stat.date) >= threeMonthsAgo);
    if (recentStats.length < 2) return 'Insufficient data for trend analysis';
    const oldest = recentStats[recentStats.length - 1];
    const newest = recentStats[0];
    const oldestFatMass = (oldest.weightKg != null && oldest.pbf != null) ? Number(oldest.weightKg) * (Number(oldest.pbf) / 100) : null;
    const newestFatMass = (newest.weightKg != null && newest.pbf != null) ? Number(newest.weightKg) * (Number(newest.pbf) / 100) : null;
    const fatMassChange = (oldestFatMass != null && newestFatMass != null) ? newestFatMass - oldestFatMass : 0;
    const smmChange = (Number(newest.smm) || 0) - (Number(oldest.smm) || 0);
    const parts = [];
    if (Math.abs(fatMassChange) > 0.1) {
      parts.push(`Fat mass ${fatMassChange >= 0 ? 'up' : 'down'} ${fmt(Math.abs(fatMassChange))} kg over 3 months`);
    }
    if (Math.abs(smmChange) > 0.1) {
      parts.push(`SMM ${smmChange >= 0 ? 'up' : 'down'} ${fmt(Math.abs(smmChange))} kg`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'No significant changes over 3 months';
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

        {/* Goal Progress Bar */}
        {latestStats && goals.length > 0 ? (() => {
          const activeGoal = goals[0];
          const getMetricLabel = (metric: string) => {
            switch (metric) {
              case 'weight': return 'Weight';
              case 'pbf': return 'PBF%';
              case 'smm': return 'SMM';
              default: return metric;
            }
          };
          const getMetricUnit = (metric: string) => {
            switch (metric) {
              case 'weight': return 'kg';
              case 'pbf': return '%';
              case 'smm': return 'kg';
              default: return '';
            }
          };
          const getCurrentValue = (): number | null => {
            switch (activeGoal.metric) {
              case 'weight': return latestStats.weightKg != null ? Number(latestStats.weightKg) : null;
              case 'pbf': return latestStats.pbf != null ? Number(latestStats.pbf) : null;
              case 'smm': return latestStats.smm != null ? Number(latestStats.smm) : null;
              default: return latestStats.weightKg != null ? Number(latestStats.weightKg) : null;
            }
          };

          const currentValue = getCurrentValue();
          const targetValue = activeGoal.targetValue != null ? Number(activeGoal.targetValue) : null;

          if (currentValue == null || targetValue == null || isNaN(currentValue) || isNaN(targetValue)) {
            return (
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">Goal: {getMetricLabel(activeGoal.metric)} {targetValue}{getMetricUnit(activeGoal.metric)}</span>
                  <button onClick={() => setIsGoalsModalOpen(true)} className="text-slate-400 hover:text-emerald-400 text-sm">Edit goal</button>
                </div>
              </div>
            );
          }

          const isWeightLoss = activeGoal.metric === 'weight';
          let progress = 0;
          let statusText = '';


          if (isWeightLoss) {
            const startWeight = bodyStats[bodyStats.length - 1]?.weightKg != null ? Number(bodyStats[bodyStats.length - 1].weightKg) : currentValue;
            const totalToLose = startWeight - targetValue;
            const lostSoFar = startWeight - currentValue;
            if (totalToLose > 0) progress = Math.max(0, Math.min(100, (lostSoFar / totalToLose) * 100));
            if (currentValue <= targetValue) { statusText = 'Goal reached! 🎉'; }
            else statusText = `${fmt(currentValue - targetValue)}${getMetricUnit(activeGoal.metric)} to go`;
          } else if (activeGoal.metric === 'pbf') {
            if (targetValue > 0) progress = Math.max(0, Math.min(100, ((targetValue - currentValue) / targetValue) * 100));
            if (currentValue <= targetValue) { statusText = 'Goal reached! 🎉'; }
            else statusText = `${fmt(currentValue - targetValue)}% to go`;
          } else {
            if (targetValue > 0) progress = Math.max(0, Math.min(100, (currentValue / targetValue) * 100));
            if (currentValue >= targetValue) { statusText = 'Goal reached! 🎉'; }
            else statusText = `${fmt(targetValue - currentValue)}${getMetricUnit(activeGoal.metric)} to go`;
          }

          return (
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">
                  Goal: {getMetricLabel(activeGoal.metric)} {targetValue}{getMetricUnit(activeGoal.metric)}
                </span>
                <button onClick={() => setIsGoalsModalOpen(true)} className="text-slate-400 hover:text-emerald-400 text-sm">
                  Edit goal
                </button>
              </div>
              <div className="mb-2">
                <span className="text-sm text-slate-400">{statusText}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs text-slate-400">{fmt(currentValue)}{getMetricUnit(activeGoal.metric)}</span>
                <span className="text-xs text-emerald-400">{Math.round(isNaN(progress) ? 0 : progress)}%</span>
              </div>
            </div>
          );
        })() : (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Set a goal →</span>
              <Button size="sm" onClick={() => setIsGoalsModalOpen(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                Set Goal
              </Button>
            </div>
          </div>
        )}

        {/* Insight Line */}
        {insightText && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <p className="text-sm text-slate-300">{insightText}</p>
          </div>
        )}

        {/* Status Pills */}
        {latestStats && bodyStats.length > 1 && (() => {
          const trends = getThreeMonthTrend();
          return (
            <div className="flex space-x-3">
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                trends.fatMassTrend === 'improving'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : trends.fatMassTrend === 'hold'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                Fat Loss: {trends.fatMassTrend === 'improving' ? 'Improving' : trends.fatMassTrend === 'hold' ? 'Hold' : 'Focus'}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                trends.smmTrend === 'strong'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : trends.smmTrend === 'steady'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                Muscle: {trends.smmTrend === 'strong' ? 'Strong' : trends.smmTrend === 'steady' ? 'Steady' : 'Improve'}
              </div>
            </div>
          );
        })()}

        {/* Trend Summary */}
        {bodyStats.length > 1 && (
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
            <p className="text-sm text-slate-300">{generateTrendSummary()}</p>
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
      <GoalsModal
        isOpen={isGoalsModalOpen}
        onClose={() => setIsGoalsModalOpen(false)}
        onSave={refreshData}
      />
    </div>
  );
}