import { useState, useEffect } from 'react';
import { Plus, Minus, TrendingUp, TrendingDown, Edit3, Trash2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import BodyStatsModal from '@/components/BodyStatsModal';
import GoalsModal from '@/components/GoalsModal';
import { Button } from '@/components/ui/button';
import { collection, query, orderBy, limit, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface BodyStats {
  id: string;
  date: string;
  weight: number;
  pbf: number;
  smm?: number;
  legLeanMass?: number;
  ecwRatio?: number;
  waist?: number;
  neck?: number;
  chest?: number;
  thigh?: number;
  notes?: string;
  createdAt: any;
}

interface Goal {
  id: string;
  metric: 'weight' | 'pbf' | 'smm';
  target: number;
  targetDate?: string;
  createdAt: any;
}

export default function Body() {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);
  const [bodyStats, setBodyStats] = useState<BodyStats[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'3M' | '6M' | 'All'>('All');
  const [editData, setEditData] = useState<{
    id: string;
    date: string;
    weight: number;
    pbf: number;
    smm?: number | undefined;
    legLeanMass?: number | undefined;
    waist?: number | undefined;
  } | undefined>(undefined);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        // Fetch body stats
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

        // Fetch goals
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
        // Fetch body stats
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

        // Fetch goals
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
      weight: stat.weight,
      pbf: stat.pbf,
      smm: stat.smm,
      legLeanMass: stat.legLeanMass,
      waist: stat.waist,
    });
    setIsModalOpen(true);
  };

  const latestStats = bodyStats[0];
  const previousStats = bodyStats[1];

  const calculateDelta = (current: number, previous: number | undefined, metric: string = 'weight') => {
    if (previous === undefined || previous === 0) return null;
    const delta = current - previous;
    
    // Metric-specific improvement logic
    let isImprovement = false;
    switch (metric) {
      case 'weight':
      case 'pbf':
      case 'fatMass':
        // DOWN is good for weight, PBF%, and fat mass
        isImprovement = delta < 0;
        break;
      case 'smm':
      case 'legLeanMass':
      case 'leanMass':
        // UP is good for muscle metrics
        isImprovement = delta > 0;
        break;
      default:
        // Default: UP is good
        isImprovement = delta > 0;
    }
    
    return { value: delta, isImprovement };
  };

  const formatDelta = (delta: { value: number; isImprovement: boolean } | null) => {
    if (!delta) return null;
    const sign = delta.value > 0 ? '+' : '';
    const color = delta.isImprovement ? 'text-emerald-500' : 'text-red-500';
    const Icon = delta.isImprovement ? TrendingUp : TrendingDown;
    
    return (
      <div className={`flex items-center space-x-1 ${color}`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs font-medium">
          {sign}{delta.value.toFixed(1)}
        </span>
      </div>
    );
  };

  
  // Calculate Y axis domains for zooming into data range
  const calculateDomain = (dataKey: keyof typeof chartData[0]) => {
    const values = chartData.map(d => d[dataKey]).filter(v => v !== undefined && v !== null) as number[];
    if (values.length === 0) return [0, 100];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.1, 2); // 10% padding or minimum 2 units
    return [min - padding, max + padding];
  };

  // Filter data based on time range
  const getFilteredData = () => {
    if (timeRange === 'All') return bodyStats;
    
    const now = new Date();
    const cutoffDate = new Date();
    if (timeRange === '3M') {
      cutoffDate.setMonth(now.getMonth() - 3);
    } else if (timeRange === '6M') {
      cutoffDate.setMonth(now.getMonth() - 6);
    }
    
    return bodyStats.filter(stat => new Date(stat.date) >= cutoffDate);
  };

  const filteredStats = getFilteredData();

  // Calculate derived metrics
  const calculateDerivedMetrics = (stats: BodyStats) => {
    const fatMass = stats.weight * (stats.pbf / 100);
    const leanMass = stats.weight - fatMass;
    return { fatMass, leanMass };
  };

  // Calculate 3-month trend analysis
  const getThreeMonthTrend = () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentStats = bodyStats.filter(stat => new Date(stat.date) >= threeMonthsAgo);
    
    if (recentStats.length < 2) return { fatMassTrend: 'hold', smmTrend: 'hold' };
    
    const oldest = recentStats[recentStats.length - 1];
    const newest = recentStats[0];
    
    const oldestFatMass = oldest.weight * (oldest.pbf / 100);
    const newestFatMass = newest.weight * (newest.pbf / 100);
    
    const fatMassChange = newestFatMass - oldestFatMass;
    const smmChange = (newest.smm || 0) - (oldest.smm || 0);
    
    return {
      fatMassTrend: fatMassChange < -0.5 ? 'improving' : fatMassChange > 0.5 ? 'focus' : 'hold',
      smmTrend: smmChange > 0.5 ? 'strong' : smmChange < -0.5 ? 'improve' : 'steady'
    };
  };

  // Generate trend summary
  const generateTrendSummary = () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentStats = bodyStats.filter(stat => new Date(stat.date) >= threeMonthsAgo);
    
    if (recentStats.length < 2) return 'Insufficient data for trend analysis';
    
    const oldest = recentStats[recentStats.length - 1];
    const newest = recentStats[0];
    
    const oldestFatMass = oldest.weight * (oldest.pbf / 100);
    const newestFatMass = newest.weight * (newest.pbf / 100);
    const fatMassChange = newestFatMass - oldestFatMass;
    
    const smmChange = (newest.smm || 0) - (oldest.smm || 0);
    
    const parts = [];
    if (Math.abs(fatMassChange) > 0.1) {
      parts.push(`Fat mass ${fatMassChange >= 0 ? 'up' : 'down'} ${Math.abs(fatMassChange).toFixed(1)} kg over 3 months`);
    }
    if (Math.abs(smmChange) > 0.1) {
      parts.push(`SMM ${smmChange >= 0 ? 'up' : 'down'} ${Math.abs(smmChange).toFixed(1)} kg`);
    }
    
    return parts.length > 0 ? parts.join(' · ') : 'No significant changes over 3 months';
  };

  // Update chart data with filtered stats
  const chartData = filteredStats.slice().reverse().map(stat => {
    const { fatMass, leanMass } = calculateDerivedMetrics(stat);
    return {
      date: new Date(stat.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      weight: stat.weight,
      'Weight': stat.weight,
      pbf: stat.pbf,
      'BF%': stat.pbf,
      smm: stat.smm || 0,
      'SMM': stat.smm || 0,
      legLeanMass: stat.legLeanMass || 0,
      'Leg Lean Mass': stat.legLeanMass || 0,
      fatMass,
      'Fat Mass': fatMass,
      leanMass,
      'Lean Mass': leanMass,
    };
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Body</h1>

        {/* Latest Stats Card */}
        {latestStats ? (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Latest Stats
            </h2>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-3xl font-bold text-white">{latestStats.weight}</span>
                  <span className="text-slate-400">kg</span>
                </div>
                <div className="flex items-baseline space-x-2 mt-1">
                  <span className="text-xl font-semibold text-emerald-400">{latestStats.pbf}</span>
                  <span className="text-slate-400">PBF%</span>
                </div>
              </div>
              <div className="flex flex-col space-y-2">
                {formatDelta(calculateDelta(latestStats.weight, previousStats?.weight, 'weight'))}
                {formatDelta(calculateDelta(latestStats.pbf, previousStats?.pbf, 'pbf'))}
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
          const getCurrentValue = () => {
            switch (activeGoal.metric) {
              case 'weight': return latestStats.weight;
              case 'pbf': return latestStats.pbf;
              case 'smm': return latestStats.smm || 0;
              default: return latestStats.weight;
            }
          };
          
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

          const currentValue = getCurrentValue();
          const targetValue = activeGoal.target;
          const isWeightLoss = activeGoal.metric === 'weight';
          
          // Calculate progress
          let progress = 0;
          let statusText = '';
          let isGoalReached = false;
          
          if (isWeightLoss) {
            // For weight loss: progress = (start - current) / (start - goal)
            // We need to estimate start weight from the oldest entry
            const startWeight = bodyStats[bodyStats.length - 1]?.weight || currentValue;
            const totalToLose = startWeight - targetValue;
            const lostSoFar = startWeight - currentValue;
            
            if (totalToLose > 0) {
              progress = Math.max(0, Math.min(100, (lostSoFar / totalToLose) * 100));
            }
            
            if (currentValue <= targetValue) {
              isGoalReached = true;
              statusText = 'Goal reached! 🎉';
            } else {
              statusText = `${(currentValue - targetValue).toFixed(1)}${getMetricUnit(activeGoal.metric)} to go`;
            }
          } else {
            // For muscle gain or PBF reduction
            if (activeGoal.metric === 'pbf') {
              // PBF: lower is better
              progress = Math.max(0, Math.min(100, ((targetValue - currentValue) / targetValue) * 100));
              if (currentValue <= targetValue) {
                isGoalReached = true;
                statusText = 'Goal reached! 🎉';
              } else {
                statusText = `${(currentValue - targetValue).toFixed(1)}% to go`;
              }
            } else {
              // SMM: higher is better
              progress = Math.max(0, Math.min(100, (currentValue / targetValue) * 100));
              if (currentValue >= targetValue) {
                isGoalReached = true;
                statusText = 'Goal reached! 🎉';
              } else {
                statusText = `${(targetValue - currentValue).toFixed(1)}${getMetricUnit(activeGoal.metric)} to go`;
              }
            }
          }

          return (
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">
                  Goal: {getMetricLabel(activeGoal.metric)} {targetValue}{getMetricUnit(activeGoal.metric)}
                </span>
                <span className="text-sm text-slate-400">{statusText}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-300 ${
                    isGoalReached ? 'bg-emerald-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs text-slate-400">
                  {currentValue.toFixed(1)}{getMetricUnit(activeGoal.metric)}
                </span>
                <span className="text-xs text-emerald-400">{Math.round(progress)}%</span>
              </div>
            </div>
          );
        })() : (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Set a goal →</span>
              <Button
                size="sm"
                onClick={() => setIsGoalsModalOpen(true)}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                <span className="w-4 h-4 mr-2 inline-block"></span>
                Set Goal
              </Button>
            </div>
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

        {/* Weight Trend Chart */}
        {filteredStats.length > 0 && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-xs text-slate-500 uppercase tracking-wider">Entered</span>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                  Weight Trend
                </h2>
              </div>
              <div className="flex space-x-2">
                {(['3M', '6M', 'All'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      timeRange === range
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                <YAxis 
                  stroke="#64748b" 
                  fontSize={12} 
                  domain={calculateDomain('Weight')}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="Weight" 
                  stroke="#10b981" 
                  fill="#10b981" 
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Change vs Previous Table */}
        {latestStats && previousStats && (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Change vs Previous
            </h2>
            <div className="space-y-2">
              {[
                { label: 'Weight', current: latestStats.weight, previous: previousStats.weight, unit: 'kg', metricType: 'weight' },
                { label: 'Body Fat %', current: latestStats.pbf, previous: previousStats.pbf, unit: '%', metricType: 'pbf' },
                { label: 'Body Fat (kg)', current: latestStats.weight * (latestStats.pbf / 100), previous: previousStats.weight * (previousStats.pbf / 100), unit: 'kg', metricType: 'fatMass' },
                { label: 'SMM', current: latestStats.smm, previous: previousStats.smm, unit: 'kg', metricType: 'smm' },
                { label: 'Leg Lean Mass', current: latestStats.legLeanMass, previous: previousStats.legLeanMass, unit: 'kg', metricType: 'legLeanMass' },
                { label: 'Waist', current: latestStats.waist, previous: previousStats.waist, unit: 'cm', metricType: 'waist' },
              ].map((metric) => {
                const delta = metric.current && metric.previous 
                  ? calculateDelta(metric.current, metric.previous, metric.metricType)
                  : null;
                
                return (
                  <div key={metric.label} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                    <span className="text-slate-300 text-sm">{metric.label}</span>
                    <div className="flex items-center space-x-3">
                      <span className="text-white text-sm font-medium">
                        {metric.current ? `${metric.current.toFixed(1)}${metric.unit}` : '--'}
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
                  <div className="text-xl font-bold text-white mb-1">
                    {currentDerived.fatMass.toFixed(1)} kg
                  </div>
                  {previousDerived && formatDelta(calculateDelta(currentDerived.fatMass, previousDerived.fatMass, 'fatMass'))}
                </div>
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                  <div className="text-sm text-slate-400 mb-1">Lean Mass</div>
                  <div className="text-xl font-bold text-white mb-1">
                    {currentDerived.leanMass.toFixed(1)} kg
                  </div>
                  {previousDerived && formatDelta(calculateDelta(currentDerived.leanMass, previousDerived.leanMass, 'leanMass'))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Individual Trend Charts */}
        {filteredStats.length > 0 && (
          <div className="space-y-4">
            {/* Entered Charts */}
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Entered</div>
              <div className="space-y-4">
                {[
                  { key: 'BF%', label: 'Body Fat %', unit: '%' },
                  { key: 'SMM', label: 'SMM', unit: 'kg' },
                ].map((chart) => (
                  <div key={chart.key} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                        {chart.label} Trend
                      </h3>
                      <div className="flex space-x-2">
                        {(['3M', '6M', 'All'] as const).map((range) => (
                          <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              timeRange === range
                                ? 'bg-emerald-500 text-white'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            {range}
                          </button>
                        ))}
                      </div>
                    </div>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                    <YAxis 
                      stroke="#64748b" 
                      fontSize={12} 
                      domain={calculateDomain(chart.key as keyof typeof chartData[0])}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey={chart.key} 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={{ fill: '#10b981', r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
            </div>
            </div>

            {/* Other Entries Charts */}
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Other entries</div>
              <div className="space-y-4">
                {[
                  { key: 'Leg Lean Mass', label: 'Leg Lean Mass', unit: 'kg' },
                ].map((chart) => (
                  <div key={chart.key} className="bg-slate-900 rounded-lg p-4 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                        {chart.label} Trend
                      </h3>
                      <div className="flex space-x-2">
                        {(['3M', '6M', 'All'] as const).map((range) => (
                          <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              timeRange === range
                                ? 'bg-emerald-500 text-white'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            {range}
                          </button>
                        ))}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                        <YAxis 
                          stroke="#64748b" 
                          fontSize={12} 
                          domain={calculateDomain(chart.key as keyof typeof chartData[0])}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                          labelStyle={{ color: '#e2e8f0' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey={chart.key} 
                          stroke="#10b981" 
                          strokeWidth={2}
                          dot={{ fill: '#10b981', r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* History Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            History
          </h2>
          {bodyStats.length > 0 ? (
            <div className="space-y-2">
              {bodyStats.map((stat) => (
                <div key={stat.id} className="bg-slate-900 rounded-lg p-4 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white">
                      {new Date(stat.date).toLocaleDateString('en-US', { 
                        weekday: 'short', 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </div>
                    <div className="text-sm text-slate-400">
                      {stat.weight} kg • {stat.pbf}% PBF
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => editEntry(stat)}
                      className="text-slate-400 hover:text-emerald-400 p-2"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteEntry(stat.id)}
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
          <p className="text-xs text-slate-500 text-center">
            Long press to delete entries
          </p>
        </div>
      </div>

      {/* Floating + Button */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-24 right-6 w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg hover:bg-emerald-600 transition-colors z-40"
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      {/* Modals */}
      <BodyStatsModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditData(undefined);
        }}
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
