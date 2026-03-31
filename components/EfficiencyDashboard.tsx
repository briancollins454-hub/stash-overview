
import React, { useMemo, useState } from 'react';
import { UnifiedOrder } from '../types';
import { BarChart3, TrendingUp, TrendingDown, Clock, Calendar, X, Filter, AreaChart as AreaChartIcon } from 'lucide-react';
import MultiSelectFilter from './MultiSelectFilter';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface EfficiencyDashboardProps {
  orders: UnifiedOrder[];
  excludedTags: string[];
}

const EfficiencyDashboard: React.FC<EfficiencyDashboardProps> = ({ orders, excludedTags }) => {
  const [selectedClubs, setSelectedClubs] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Filter Orders: Must be fulfilled, NOT MTO
  const relevantOrders = useMemo(() => {
    return orders.filter(o => {
      const isFulfilled = !!o.fulfillmentDate;
      const notMto = !o.isMto;
      if (!isFulfilled || !notMto) return false;

      if (selectedClubs.size === 0) return true;

      const matchesTag = o.shopify.tags.some(t => selectedClubs.has(t));
      const isOther = selectedClubs.has('Other') && (o.shopify.tags.length === 0 || o.shopify.tags.every(t => excludedTags.includes(t)));
      
      return matchesTag || isOther;
    });
  }, [orders, selectedClubs, excludedTags]);

  // Chart Data: Group by month/week
  const chartData = useMemo(() => {
    const groups: {[key: string]: { total: number, count: number }} = {};
    
    relevantOrders.forEach(o => {
        if (!o.fulfillmentDate) return;
        const date = new Date(o.fulfillmentDate);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!groups[key]) groups[key] = { total: 0, count: 0 };
        groups[key].total += (o.fulfillmentDuration || 0);
        groups[key].count += 1;
    });

    return Object.entries(groups)
        .map(([key, val]) => ({
            name: key,
            avg: parseFloat((val.total / val.count).toFixed(1)),
            count: val.count
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
  }, [relevantOrders]);

  const clubOptions = useMemo(() => {
    const counts: {[key: string]: number} = {};
    const tags = new Set<string>();
    
    orders.forEach(o => {
        const isRelevant = !!o.fulfillmentDate && !o.isMto;
        const validTags = o.shopify.tags.filter(t => !excludedTags.includes(t));
        
        if (validTags.length === 0) {
            tags.add('Other');
            if (isRelevant) {
                counts['Other'] = (counts['Other'] || 0) + 1;
            }
        } else {
            validTags.forEach(t => {
                tags.add(t);
                if (isRelevant) {
                    counts[t] = (counts[t] || 0) + 1;
                }
            });
        }
    });
    
    return Array.from(tags).map(tag => ({
      label: tag,
      count: counts[tag] || 0
    })).sort((a, b) => {
        if (a.label === 'Other') return 1;
        if (b.label === 'Other') return -1;
        return b.count - a.count || a.label.localeCompare(b.label);
    });
  }, [orders, excludedTags]);

  // Helper to calculate stats for any arbitrary date range
  const calculateRangeStats = (start: Date, end: Date) => {
    // 1. Filter current period orders
    const currentPeriodOrders = relevantOrders.filter(o => {
      if (!o.fulfillmentDate) return false;
      const fDate = new Date(o.fulfillmentDate);
      return fDate >= start && fDate <= end;
    });

    // 2. Calculate duration of chosen range to find the "comparison" period
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1); // 1ms before current start
    const prevStart = new Date(start.getTime() - durationMs);

    const prevPeriodOrders = relevantOrders.filter(o => {
      if (!o.fulfillmentDate) return false;
      const fDate = new Date(o.fulfillmentDate);
      return fDate >= prevStart && fDate <= prevEnd;
    });

    const getAvg = (list: UnifiedOrder[]) => {
      if (list.length === 0) return 0;
      const total = list.reduce((acc, curr) => acc + (curr.fulfillmentDuration || 0), 0);
      return parseFloat((total / list.length).toFixed(1));
    };

    const currentAvg = getAvg(currentPeriodOrders);
    const prevAvg = getAvg(prevPeriodOrders);
    const diff = prevAvg > 0 ? ((currentAvg - prevAvg) / prevAvg) * 100 : 0;
    
    return {
      avgDays: currentAvg,
      count: currentPeriodOrders.length,
      diffPct: diff,
      trend: diff < 0 ? 'improved' : diff > 0 ? 'slowed' : 'neutral',
      durationDays: Math.ceil(durationMs / (1000 * 3600 * 24))
    };
  };

  // Preset Stats
  const getPresetStats = (daysBack: number) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysBack);
    return calculateRangeStats(start, end);
  };

  const stats7 = getPresetStats(7);
  const stats15 = getPresetStats(15);
  const stats30 = getPresetStats(30);
  const stats60 = getPresetStats(60);

  // Custom Stats (if dates provided)
  const customStats = useMemo(() => {
    if (startDate && endDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        return calculateRangeStats(s, e);
    }
    return null;
  }, [startDate, endDate, relevantOrders]);

  const renderStatCard = (title: string, stats: any, compareLabel: string, isCustom = false) => {
    const isImproved = stats.trend === 'improved';
    const isNeutral = stats.trend === 'neutral';
    
    return (
      <div className={`bg-white p-6 rounded-xl border shadow-sm flex flex-col justify-between h-full transition-all duration-300 ${isCustom ? 'border-indigo-500 ring-4 ring-indigo-50 shadow-indigo-100/50' : 'border-gray-200'}`}>
        <div>
           <div className="flex items-center justify-between mb-4">
              <h3 className={`text-sm font-bold uppercase tracking-widest ${isCustom ? 'text-indigo-600' : 'text-gray-500'}`}>{title}</h3>
              <div className={`p-2 rounded-lg ${isCustom ? 'bg-indigo-600 text-white' : isImproved ? 'bg-green-50 text-green-600' : isNeutral ? 'bg-gray-50 text-gray-500' : 'bg-red-50 text-red-500'}`}>
                 {isCustom ? <Calendar className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
           </div>
           <div className="flex items-baseline gap-2">
               <span className={`text-4xl font-black ${isCustom ? 'text-indigo-900' : 'text-gray-900'}`}>{stats.avgDays || '-'}</span>
               <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">working days</span>
           </div>
           <p className="text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-widest">Based on {stats.count} fulfilled orders</p>
        </div>

        <div className={`mt-6 pt-4 border-t ${isCustom ? 'border-indigo-100' : 'border-gray-100'}`}>
           <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-black">
              {isImproved && <TrendingDown className="w-4 h-4 text-green-500" />} 
              {!isImproved && !isNeutral && <TrendingUp className="w-4 h-4 text-red-500" />}
              {isNeutral && <div className="w-4 h-4 text-gray-400">-</div>}
              
              <span className={`${isImproved ? 'text-green-600' : isNeutral ? 'text-gray-500' : 'text-red-600'}`}>
                 {Math.abs(stats.diffPct).toFixed(1)}% {isImproved ? 'Faster' : isNeutral ? 'Change' : 'Slower'}
              </span>
              <span className="text-gray-400 font-bold text-[9px]">vs {compareLabel}</span>
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 max-w-[1200px] mx-auto animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-widest">Dispatch Efficiency</h2>
          <p className="text-sm text-slate-500 mt-1 font-bold uppercase tracking-widest">Analyzing fulfillment speed (stock items only)</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center bg-white border border-gray-300 rounded-xl p-1.5 shadow-sm">
                <div className="flex items-center gap-2 px-3 border-r border-gray-200 mr-2">
                    <Calendar className="w-4 h-4 text-indigo-500" />
                    <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Custom Range</span>
                </div>
                <input 
                    type="date" 
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)} 
                    className="text-xs border-none bg-transparent p-0 focus:ring-0 text-gray-700 font-bold w-28 uppercase" 
                />
                <span className="text-gray-300 mx-2">—</span>
                <input 
                    type="date" 
                    value={endDate} 
                    onChange={(e) => setEndDate(e.target.value)} 
                    className="text-xs border-none bg-transparent p-0 focus:ring-0 text-gray-700 font-bold w-28 uppercase" 
                />
                {(startDate || endDate) && (
                    <button 
                        onClick={() => {setStartDate(''); setEndDate('')}} 
                        className="ml-3 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

             <MultiSelectFilter 
                title="Filter Club"
                options={clubOptions}
                selectedValues={selectedClubs}
                onChange={setSelectedClubs}
                showZeroByDefault={true}
             />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {customStats && (
              <div className="md:col-span-2 lg:col-span-4 animate-in zoom-in-95 duration-500">
                  {renderStatCard(`Custom Selection (${customStats.durationDays} Days)`, customStats, `previous ${customStats.durationDays}d period`, true)}
              </div>
          )}
          {renderStatCard("Last 7 Days", stats7, "last week")}
          {renderStatCard("Last 15 Days", stats15, "prev 15d")}
          {renderStatCard("Last 30 Days", stats30, "last month")}
          {renderStatCard("Last 60 Days", stats60, "prev 60d")}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trend Chart */}
          {chartData.length > 1 && (
              <div className="lg:col-span-3 bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2 uppercase tracking-widest">
                      <AreaChartIcon className="w-5 h-5 text-indigo-500" />
                      Monthly Dispatch Trend
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} />
                          <YAxis tick={{ fontSize: 10, fontWeight: 700 }} />
                          <Tooltip 
                              contentStyle={{ borderRadius: 12, fontSize: 11, fontWeight: 700 }} 
                              formatter={(value: any) => [`${value} days`, 'Avg Dispatch']}
                              labelFormatter={(label: any) => `Period: ${label}`}
                          />
                          <ReferenceLine y={20} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: "20d Target", position: "right", fontSize: 9, fontWeight: 900 }} />
                          <Area type="monotone" dataKey="avg" stroke="#6366f1" fill="#eef2ff" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} />
                      </AreaChart>
                  </ResponsiveContainer>
              </div>
          )}

          {/* Visual Chart Bars */}
          <div className="lg:col-span-2 bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-black text-slate-800 mb-8 flex items-center gap-2 uppercase tracking-widest">
                  <BarChart3 className="w-5 h-5 text-indigo-500" />
                  Efficiency Breakdown
              </h3>
              <div className="space-y-8">
                  {[
                      ...(customStats ? [{ label: 'Custom Selected Range', val: customStats.avgDays, custom: true }] : []),
                      { label: 'Last 7 Days', val: stats7.avgDays }, 
                      { label: 'Last 15 Days', val: stats15.avgDays }, 
                      { label: 'Last 30 Days', val: stats30.avgDays },
                      { label: 'Last 60 Days', val: stats60.avgDays }
                    ].map((item, idx) => (
                      <div key={idx} className="group">
                          <div className="flex justify-between items-end mb-2">
                              <span className={`text-xs font-black uppercase tracking-widest ${item.custom ? 'text-indigo-600' : 'text-slate-600'}`}>{item.label}</span>
                              <span className="text-sm font-black text-slate-900">{item.val || 0} <span className="text-[10px] text-slate-400">WORKING DAYS</span></span>
                          </div>
                          <div className="h-4 bg-slate-50 rounded-full overflow-hidden border border-slate-100 p-0.5">
                              <div 
                                 className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                     item.custom ? 'bg-indigo-600' : 
                                     (item.val || 0) <= 15 ? 'bg-green-500' : 
                                     (item.val || 0) <= 20 ? 'bg-blue-500' : 
                                     (item.val || 0) > 0 ? 'bg-orange-500' : 'bg-gray-200'
                                 }`}
                                 style={{ width: `${Math.min(100, ((item.val || 0) / 25) * 100)}%` }}
                              ></div>
                          </div>
                          <div className="flex justify-between mt-1 text-[8px] font-black text-slate-400 uppercase tracking-tighter">
                               <span>0 days</span>
                               <span className="text-slate-300">Target: 20 days</span>
                               <span>25+ days</span>
                          </div>
                      </div>
                  ))}
              </div>
          </div>

          {/* Guidelines / Legend */}
          <div className="bg-slate-900 p-8 rounded-xl text-white">
              <h3 className="text-lg font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Filter className="w-5 h-5 text-indigo-400" />
                  Insight Summary
              </h3>
              <div className="space-y-6">
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Business Closures</p>
                      <p className="text-xs text-slate-300 font-bold leading-relaxed uppercase tracking-tight">
                          Calculations skip weekends and <span className="text-white italic">manual closure intervals</span> set in Preferences.
                      </p>
                  </div>

                  <div className="space-y-4">
                      <div className="flex items-start gap-3">
                          <div className="w-4 h-4 rounded-full bg-green-500 mt-0.5 shadow-sm shadow-green-500/50"></div>
                          <div>
                              <p className="text-[10px] font-black uppercase tracking-widest">Excellent</p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Avg Dispatch under 15 working days.</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <div className="w-4 h-4 rounded-full bg-blue-500 mt-0.5 shadow-sm shadow-blue-500/50"></div>
                          <div>
                              <p className="text-[10px] font-black uppercase tracking-widest">On Target</p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Avg Dispatch between 15-20 working days.</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <div className="w-4 h-4 rounded-full bg-orange-500 mt-0.5 shadow-sm shadow-orange-500/50"></div>
                          <div>
                              <p className="text-[10px] font-black uppercase tracking-widest">Over Target</p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Avg Dispatch over 20 working days.</p>
                          </div>
                      </div>
                  </div>

                  <div className="pt-4 border-t border-white/10">
                      <p className="text-[10px] text-slate-500 font-bold uppercase italic tracking-widest leading-relaxed">
                          * Lead times are recalculated in real-time based on your custom calendar settings.
                      </p>
                  </div>
              </div>
          </div>
      </div>

    </div>
  );
};

export default EfficiencyDashboard;
