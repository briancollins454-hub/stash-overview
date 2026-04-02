import React, { useState, useEffect, useMemo, useRef } from 'react';
import { UnifiedOrder } from '../types';
import {
  Activity, Package, Truck, CheckCircle2, AlertTriangle, Clock, TrendingUp,
  Zap, Eye, BarChart3, Target, ArrowRight, Radio
} from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  excludedTags: string[];
}

// Animated counter hook
function useAnimatedNumber(target: number, duration = 1200) {
  const [current, setCurrent] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const start = ref.current;
    const diff = target - start;
    if (diff === 0) return;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = Math.round(start + diff * eased);
      setCurrent(val);
      ref.current = val;
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target, duration]);
  return current;
}

function StatCard({ label, value, icon: Icon, color, subText }: { label: string; value: number; icon: React.ElementType; color: string; subText?: string }) {
  const animated = useAnimatedNumber(value);
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${color} p-5 shadow-2xl`}>
      <div className="absolute -right-4 -top-4 opacity-10">
        <Icon className="w-24 h-24" />
      </div>
      <div className="relative z-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70 mb-1">{label}</p>
        <p className="text-4xl font-black text-white tabular-nums">{animated}</p>
        {subText && <p className="text-xs text-white/50 mt-1">{subText}</p>}
      </div>
    </div>
  );
}

function CircularGauge({ value, label, color, size = 120 }: { value: number; label: string; color: string; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedValue(value), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const strokeDashoffset = circumference - (animatedValue / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black text-white">{Math.round(animatedValue)}%</span>
        </div>
      </div>
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/60">{label}</span>
    </div>
  );
}

function PipelineStage({ label, count, color, isLast, icon: Icon }: { label: string; count: number; color: string; isLast?: boolean; icon: React.ElementType }) {
  const animated = useAnimatedNumber(count);
  return (
    <div className="flex items-center flex-1 min-w-0">
      <div className={`flex-1 rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4 text-center relative overflow-hidden group hover:from-white/10 transition-all duration-500`}>
        <div className={`absolute inset-x-0 bottom-0 h-1 ${color}`} />
        <Icon className="w-5 h-5 mx-auto mb-2 text-white/50 group-hover:text-white/80 transition-colors" />
        <p className="text-3xl font-black text-white tabular-nums mb-1">{animated}</p>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">{label}</p>
      </div>
      {!isLast && (
        <div className="flex-shrink-0 px-1">
          <ArrowRight className="w-5 h-5 text-white/20 animate-pulse" />
        </div>
      )}
    </div>
  );
}

interface ActivityItem {
  id: string;
  text: string;
  time: string;
  type: 'new' | 'production' | 'ready' | 'shipped' | 'alert';
}

const CommandCenter: React.FC<Props> = ({ orders, excludedTags }) => {
  const [clock, setClock] = useState(new Date());
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Pulse animation every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => setPulseKey(k => k + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (excludedTags.length === 0) return true;
      if (o.shopify.tags.length === 0) return true;
      return o.shopify.tags.some(t => !excludedTags.includes(t));
    });
  }, [orders, excludedTags]);

  const stats = useMemo(() => {
    const unfulfilled = filtered.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled');
    const fulfilled = filtered.filter(o => o.shopify.fulfillmentStatus === 'fulfilled');
    const noJob = unfulfilled.filter(o => !o.decoJobId);
    const inProduction = unfulfilled.filter(o => o.decoJobId && o.completionPercentage < 100);
    const ready = unfulfilled.filter(o => o.completionPercentage === 100 || o.productionStatus === 'Ready for Shipping' || o.isStockDispatchReady);
    const late = unfulfilled.filter(o => o.daysRemaining < 0);
    const dueSoon = unfulfilled.filter(o => o.daysRemaining >= 0 && o.daysRemaining <= 3);
    const fulfilledToday = fulfilled.filter(o => {
      if (!o.fulfillmentDate) return false;
      const d = new Date(o.fulfillmentDate);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    });

    // Revenue
    const todayRevenue = fulfilledToday.reduce((sum, o) => sum + (parseFloat(o.shopify.totalPrice) || 0), 0);
    const totalUnfulfilledValue = unfulfilled.reduce((sum, o) => sum + (parseFloat(o.shopify.totalPrice) || 0), 0);

    // Avg completion
    const withJobs = unfulfilled.filter(o => o.decoJobId);
    const avgCompletion = withJobs.length > 0
      ? Math.round(withJobs.reduce((s, o) => s + o.completionPercentage, 0) / withJobs.length)
      : 0;

    // SLA compliance (unfulfilled orders NOT overdue)
    const slaCompliance = unfulfilled.length > 0
      ? Math.round(((unfulfilled.length - late.length) / unfulfilled.length) * 100)
      : 100;

    // On-time rate for fulfilled (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentFulfilled = fulfilled.filter(o => o.fulfillmentDate && new Date(o.fulfillmentDate).getTime() > thirtyDaysAgo);
    const onTime = recentFulfilled.filter(o => o.daysRemaining >= 0);
    const onTimeRate = recentFulfilled.length > 0 ? Math.round((onTime.length / recentFulfilled.length) * 100) : 100;

    return {
      total: unfulfilled.length,
      noJob: noJob.length,
      inProduction: inProduction.length,
      ready: ready.length,
      fulfilled: fulfilled.length,
      late: late.length,
      dueSoon: dueSoon.length,
      fulfilledToday: fulfilledToday.length,
      todayRevenue,
      totalUnfulfilledValue,
      avgCompletion,
      slaCompliance,
      onTimeRate,
    };
  }, [filtered]);

  // Priority queue — top 8 most urgent orders
  const priorities = useMemo(() => {
    return filtered
      .filter(o => o.shopify.fulfillmentStatus !== 'fulfilled')
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 8);
  }, [filtered]);

  // Simulated activity feed from order data
  const activityFeed = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    const recent = [...filtered]
      .sort((a, b) => new Date(b.shopify.date).getTime() - new Date(a.shopify.date).getTime())
      .slice(0, 30);

    recent.forEach(o => {
      if (o.shopify.fulfillmentStatus === 'fulfilled' && o.fulfillmentDate) {
        items.push({
          id: 'ship-' + o.shopify.id,
          text: `#${o.shopify.orderNumber} ${o.shopify.customerName} — Shipped`,
          time: new Date(o.fulfillmentDate).toLocaleDateString('en-GB'),
          type: 'shipped',
        });
      } else if (o.completionPercentage === 100) {
        items.push({
          id: 'ready-' + o.shopify.id,
          text: `#${o.shopify.orderNumber} ${o.shopify.customerName} — Ready`,
          time: new Date(o.shopify.date).toLocaleDateString('en-GB'),
          type: 'ready',
        });
      } else if (o.daysRemaining < 0) {
        items.push({
          id: 'late-' + o.shopify.id,
          text: `#${o.shopify.orderNumber} — ${Math.abs(o.daysRemaining)}d overdue`,
          time: new Date(o.shopify.date).toLocaleDateString('en-GB'),
          type: 'alert',
        });
      } else if (o.decoJobId) {
        items.push({
          id: 'prod-' + o.shopify.id,
          text: `#${o.shopify.orderNumber} ${o.shopify.customerName} — ${o.completionPercentage}%`,
          time: o.decoJobId,
          type: 'production',
        });
      } else {
        items.push({
          id: 'new-' + o.shopify.id,
          text: `#${o.shopify.orderNumber} ${o.shopify.customerName}`,
          time: new Date(o.shopify.date).toLocaleDateString('en-GB'),
          type: 'new',
        });
      }
    });
    return items.slice(0, 15);
  }, [filtered]);

  const typeColors = {
    new: 'text-blue-400',
    production: 'text-amber-400',
    ready: 'text-emerald-400',
    shipped: 'text-purple-400',
    alert: 'text-red-400',
  };

  const typeIcons = {
    new: Package,
    production: Activity,
    ready: CheckCircle2,
    shipped: Truck,
    alert: AlertTriangle,
  };

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Radio className="w-8 h-8 text-emerald-400" />
            <span key={pulseKey} className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-ping" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-[0.3em] bg-gradient-to-r from-white via-indigo-200 to-purple-300 bg-clip-text text-transparent">
              Command Center
            </h1>
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold">Live Production Overview</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black tabular-nums text-white/90">
            {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-xs text-white/40 font-bold uppercase tracking-widest">
            {clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Production Pipeline */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Production Pipeline</h2>
        </div>
        <div className="flex gap-1 items-stretch">
          <PipelineStage label="Not Linked" count={stats.noJob} color="bg-red-500" icon={AlertTriangle} />
          <PipelineStage label="In Production" count={stats.inProduction} color="bg-amber-500" icon={Activity} />
          <PipelineStage label="Ready to Ship" count={stats.ready} color="bg-emerald-500" icon={CheckCircle2} />
          <PipelineStage label="Shipped" count={stats.fulfilledToday} color="bg-purple-500" icon={Truck} isLast />
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-5">
        {/* Stats Cards - left column */}
        <div className="col-span-8 grid grid-cols-4 gap-4">
          <StatCard label="Active Orders" value={stats.total} icon={Package} color="from-indigo-600/40 to-indigo-900/40" />
          <StatCard label="Overdue" value={stats.late} icon={AlertTriangle} color="from-red-600/40 to-red-900/40" subText={stats.dueSoon > 0 ? `${stats.dueSoon} due within 3 days` : undefined} />
          <StatCard label="Shipped Today" value={stats.fulfilledToday} icon={Truck} color="from-purple-600/40 to-purple-900/40" />
          <StatCard label="Pipeline Value" value={Math.round(stats.totalUnfulfilledValue)} icon={TrendingUp} color="from-emerald-600/40 to-emerald-900/40" subText={`£${stats.totalUnfulfilledValue.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`} />

          {/* Priority Queue */}
          <div className="col-span-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-red-400" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Priority Queue</h2>
              <span className="ml-auto text-[10px] text-white/30 font-bold uppercase tracking-widest">Most Urgent First</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {priorities.map((o, idx) => {
                const isOverdue = o.daysRemaining < 0;
                const isUrgent = o.daysRemaining >= 0 && o.daysRemaining <= 3;
                return (
                  <div key={o.shopify.id}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all duration-300 ${
                      isOverdue ? 'border-red-500/30 bg-red-500/10' :
                      isUrgent ? 'border-amber-500/30 bg-amber-500/10' :
                      'border-white/5 bg-white/[0.02]'
                    }`}>
                    <span className={`text-lg font-black tabular-nums w-7 ${
                      isOverdue ? 'text-red-400' : isUrgent ? 'text-amber-400' : 'text-white/40'
                    }`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">#{o.shopify.orderNumber}</p>
                      <p className="text-[10px] text-white/50 truncate">{o.shopify.customerName}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-black tabular-nums ${
                        isOverdue ? 'text-red-400' : isUrgent ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {isOverdue ? `${Math.abs(o.daysRemaining)}d late` : `${o.daysRemaining}d`}
                      </p>
                      <p className="text-[9px] text-white/30">{o.completionPercentage}% done</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column - Gauges + Activity */}
        <div className="col-span-4 space-y-5">
          {/* Performance Gauges */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Performance</h2>
            </div>
            <div className="flex justify-around">
              <CircularGauge value={stats.slaCompliance} label="SLA Compliance" color="#6366f1" />
              <CircularGauge value={stats.avgCompletion} label="Avg Completion" color="#f59e0b" />
              <CircularGauge value={stats.onTimeRate} label="On-Time Rate" color="#10b981" />
            </div>
          </div>

          {/* Activity Feed */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 max-h-[320px] overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Activity Feed</h2>
              <span className="ml-auto relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </div>
            <div className="space-y-1.5">
              {activityFeed.map((item) => {
                const TypeIcon = typeIcons[item.type];
                return (
                  <div key={item.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                    <TypeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${typeColors[item.type]}`} />
                    <p className="text-xs text-white/70 truncate flex-1">{item.text}</p>
                    <span className="text-[9px] text-white/30 flex-shrink-0 tabular-nums">{item.time}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3">
        <div className="flex items-center gap-6">
          <Stat label="Today's Revenue" value={`£${stats.todayRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} />
          <Stat label="Total Pipeline" value={`£${stats.totalUnfulfilledValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} />
          <Stat label="Avg Completion" value={`${stats.avgCompletion}%`} />
        </div>
        <div className="flex items-center gap-2 text-white/30">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Auto-refreshing</span>
        </div>
      </div>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</span>
      <span className="text-sm font-black text-white tabular-nums">{value}</span>
    </div>
  );
}

export default CommandCenter;
