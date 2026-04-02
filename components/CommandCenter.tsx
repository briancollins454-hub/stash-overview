import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { UnifiedOrder } from '../types';
import {
  Activity, Package, Truck, CheckCircle2, AlertTriangle, Clock, TrendingUp,
  Zap, Eye, BarChart3, Target, ArrowRight, Radio, X, Maximize2, Minimize2,
  ChevronLeft, ChevronRight, Users, Calendar, DollarSign, ArrowUpRight,
  ArrowDownRight, ShoppingBag, Timer, Layers, Hash
} from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  excludedTags: string[];
  onExit: () => void;
  onNavigateToOrder?: (orderNumber: string) => void;
}

// ── Hooks ──────────────────────────────────────────────────────────────────

function useAnimatedNumber(target: number, duration = 800) {
  const [current, setCurrent] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const start = ref.current;
    const diff = target - start;
    if (diff === 0) return;
    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const v = Math.round(start + diff * (1 - Math.pow(1 - p, 3)));
      setCurrent(v); ref.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return current;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function AnimNum({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const v = useAnimatedNumber(value);
  return <>{prefix}{v.toLocaleString('en-GB')}{suffix}</>;
}

function Gauge({ value, label, color, size = 110 }: { value: number; label: string; color: string; size?: number }) {
  const r = (size - 14) / 2;
  const circ = 2 * Math.PI * r;
  const [anim, setAnim] = useState(0);
  useEffect(() => { const t = setTimeout(() => setAnim(value), 200); return () => clearTimeout(t); }, [value]);
  return (
    <div className="flex flex-col items-center gap-1.5 cursor-default group">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ - (anim / 100) * circ}
            style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 6px ${color}60)` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black text-white group-hover:scale-110 transition-transform">{Math.round(anim)}%</span>
        </div>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/50">{label}</span>
    </div>
  );
}

function MiniSparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 100;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * (height - 4)}`).join(' ');
  const fillPoints = `0,${height} ${points} ${w},${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polygon points={fillPoints} fill={`${color}15`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}60)` }} />
    </svg>
  );
}

function HeatmapRow({ data, label, maxVal }: { data: number[]; label: string; maxVal: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-white/40 w-8 text-right font-bold">{label}</span>
      {data.map((v, i) => {
        const intensity = maxVal > 0 ? v / maxVal : 0;
        return (
          <div key={i} className="flex-1 h-5 rounded-sm transition-all duration-300 hover:scale-y-125 cursor-default group relative"
            style={{ background: `rgba(99, 102, 241, ${0.05 + intensity * 0.9})` }}
            title={`${v} orders`}>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

const CommandCenter: React.FC<Props> = ({ orders, excludedTags, onExit, onNavigateToOrder }) => {
  const now = useNow();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<UnifiedOrder | null>(null);
  const [activeView, setActiveView] = useState<'overview' | 'pipeline' | 'clubs'>('overview');
  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen API
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedOrder) return; // don't intercept keys when detail drawer is open
      if (e.key === 'Escape') { onExit(); return; }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === '1') setActiveView('overview');
      if (e.key === '2') setActiveView('pipeline');
      if (e.key === '3') setActiveView('clubs');
      if (e.key === 'ArrowRight') setActiveView(v => v === 'overview' ? 'pipeline' : v === 'pipeline' ? 'clubs' : 'overview');
      if (e.key === 'ArrowLeft') setActiveView(v => v === 'clubs' ? 'pipeline' : v === 'pipeline' ? 'overview' : 'clubs');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onExit, toggleFullscreen, selectedOrder]);

  // ── Data processing ──────────────────────────────────────────────────

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
    const inProd = unfulfilled.filter(o => o.decoJobId && o.completionPercentage < 100);
    const ready = unfulfilled.filter(o => o.completionPercentage === 100 || o.productionStatus === 'Ready for Shipping' || o.isStockDispatchReady);
    const late = unfulfilled.filter(o => o.daysRemaining < 0);
    const dueSoon = unfulfilled.filter(o => o.daysRemaining >= 0 && o.daysRemaining <= 3);
    const today = new Date(); today.setHours(0,0,0,0);
    const fulfilledToday = fulfilled.filter(o => o.fulfillmentDate && new Date(o.fulfillmentDate) >= today);
    const todayRevenue = fulfilledToday.reduce((s, o) => s + (parseFloat(o.shopify.totalPrice) || 0), 0);
    const pipelineValue = unfulfilled.reduce((s, o) => s + (parseFloat(o.shopify.totalPrice) || 0), 0);
    const withJobs = unfulfilled.filter(o => o.decoJobId);
    const avgCompletion = withJobs.length > 0 ? Math.round(withJobs.reduce((s, o) => s + o.completionPercentage, 0) / withJobs.length) : 0;
    const slaCompliance = unfulfilled.length > 0 ? Math.round(((unfulfilled.length - late.length) / unfulfilled.length) * 100) : 100;
    const d30 = Date.now() - 30 * 86400000;
    const recent = fulfilled.filter(o => o.fulfillmentDate && new Date(o.fulfillmentDate).getTime() > d30);
    const onTime = recent.filter(o => (o.fulfillmentDuration ?? 0) <= 20);
    const onTimeRate = recent.length > 0 ? Math.round((onTime.length / recent.length) * 100) : 100;
    const totalItems = unfulfilled.reduce((s, o) => s + o.shopify.items.length, 0);
    const avgOrderValue = unfulfilled.length > 0 ? pipelineValue / unfulfilled.length : 0;

    return { unfulfilled, fulfilled, noJob: noJob.length, inProd: inProd.length, ready: ready.length,
      late: late.length, dueSoon: dueSoon.length, fulfilledToday: fulfilledToday.length,
      todayRevenue, pipelineValue, avgCompletion, slaCompliance, onTimeRate,
      totalItems, avgOrderValue, total: unfulfilled.length };
  }, [filtered]);

  // Orders by day (last 14 days) for sparkline
  const dailyOrders = useMemo(() => {
    const days: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      days.push(filtered.filter(o => { const od = new Date(o.shopify.date); return od >= d && od < next; }).length);
    }
    return days;
  }, [filtered]);

  // Revenue by day (last 14 days) for sparkline
  const dailyRevenue = useMemo(() => {
    const days: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      days.push(filtered.filter(o => {
        if (!o.fulfillmentDate) return false;
        const fd = new Date(o.fulfillmentDate);
        return fd >= d && fd < next;
      }).reduce((s, o) => s + (parseFloat(o.shopify.totalPrice) || 0), 0));
    }
    return days;
  }, [filtered]);

  // Heatmap: orders by day of week x last 4 weeks
  const heatmapData = useMemo(() => {
    const weeks: number[][] = [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let w = 0; w < 7; w++) weeks.push([]);
    for (let wk = 3; wk >= 0; wk--) {
      for (let d = 0; d < 7; d++) {
        const date = new Date();
        const dayOffset = ((date.getDay() + 6) % 7); // Monday = 0
        date.setDate(date.getDate() - dayOffset - wk * 7 + d);
        date.setHours(0,0,0,0);
        const next = new Date(date); next.setDate(next.getDate() + 1);
        const count = filtered.filter(o => { const od = new Date(o.shopify.date); return od >= date && od < next; }).length;
        weeks[d].push(count);
      }
    }
    const maxVal = Math.max(...weeks.flat(), 1);
    return { weeks, dayNames, maxVal };
  }, [filtered]);

  // Club breakdown
  const clubData = useMemo(() => {
    const map = new Map<string, { count: number; value: number; ready: number; late: number }>();
    filtered.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled').forEach(o => {
      const club = o.clubName || 'No Club';
      const existing = map.get(club) || { count: 0, value: 0, ready: 0, late: 0 };
      existing.count++;
      existing.value += parseFloat(o.shopify.totalPrice) || 0;
      if (o.completionPercentage === 100 || o.isStockDispatchReady) existing.ready++;
      if (o.daysRemaining < 0) existing.late++;
      map.set(club, existing);
    });
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  }, [filtered]);

  // Priority queue
  const priorities = useMemo(() =>
    filtered.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled')
      .sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 10),
  [filtered]);

  // Fulfillment velocity (last 7 days vs previous 7)
  const velocity = useMemo(() => {
    const d7 = Date.now() - 7 * 86400000;
    const d14 = Date.now() - 14 * 86400000;
    const thisWeek = filtered.filter(o => o.fulfillmentDate && new Date(o.fulfillmentDate).getTime() > d7).length;
    const lastWeek = filtered.filter(o => o.fulfillmentDate && new Date(o.fulfillmentDate).getTime() > d14 && new Date(o.fulfillmentDate).getTime() <= d7).length;
    const trend = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
    return { thisWeek, lastWeek, trend };
  }, [filtered]);

  // Activity feed
  const feed = useMemo(() => {
    const items: { id: string; text: string; time: string; type: 'new' | 'prod' | 'ready' | 'ship' | 'alert'; order: UnifiedOrder }[] = [];
    const recent = [...filtered].sort((a, b) => new Date(b.shopify.date).getTime() - new Date(a.shopify.date).getTime()).slice(0, 50);
    recent.forEach(o => {
      if (o.shopify.fulfillmentStatus === 'fulfilled' && o.fulfillmentDate) {
        items.push({ id: `s-${o.shopify.id}`, text: `#${o.shopify.orderNumber} ${o.shopify.customerName} — Shipped`, time: new Date(o.fulfillmentDate).toLocaleDateString('en-GB'), type: 'ship', order: o });
      } else if (o.completionPercentage === 100) {
        items.push({ id: `r-${o.shopify.id}`, text: `#${o.shopify.orderNumber} ${o.shopify.customerName} — Ready to Ship`, time: `${o.completionPercentage}%`, type: 'ready', order: o });
      } else if (o.daysRemaining < 0) {
        items.push({ id: `a-${o.shopify.id}`, text: `#${o.shopify.orderNumber} — ${Math.abs(o.daysRemaining)}d overdue`, time: o.clubName || '', type: 'alert', order: o });
      } else if (o.decoJobId) {
        items.push({ id: `p-${o.shopify.id}`, text: `#${o.shopify.orderNumber} ${o.shopify.customerName} — ${o.completionPercentage}%`, time: `Job ${o.decoJobId}`, type: 'prod', order: o });
      } else {
        items.push({ id: `n-${o.shopify.id}`, text: `#${o.shopify.orderNumber} ${o.shopify.customerName}`, time: new Date(o.shopify.date).toLocaleDateString('en-GB'), type: 'new', order: o });
      }
    });
    return items.slice(0, 20);
  }, [filtered]);

  const typeColors: Record<string, string> = { new: '#60a5fa', prod: '#fbbf24', ready: '#34d399', ship: '#a78bfa', alert: '#f87171' };
  const typeIcons: Record<string, React.ElementType> = { new: Package, prod: Activity, ready: CheckCircle2, ship: Truck, alert: AlertTriangle };
  const views = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'pipeline' as const, label: 'Pipeline & Trends' },
    { id: 'clubs' as const, label: 'Club Breakdown' },
  ];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100] bg-[#080818] text-white overflow-y-auto"
      style={{ backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(168,85,247,0.06) 0%, transparent 50%)' }}>

      {/* ── Top Bar ── */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-[#080818]/80 border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Radio className="w-6 h-6 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full" />
          </div>
          <div>
            <h1 className="text-lg font-black uppercase tracking-[0.3em] bg-gradient-to-r from-white via-indigo-200 to-purple-300 bg-clip-text text-transparent">
              Command Center
            </h1>
            <p className="text-[9px] uppercase tracking-[0.3em] text-white/30 font-bold">Stash Shop Live</p>
          </div>
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          {views.map((v, i) => (
            <button key={v.id} onClick={() => setActiveView(v.id)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                activeView === v.id ? 'bg-indigo-500/30 text-white shadow-lg shadow-indigo-500/10' : 'text-white/40 hover:text-white/70'}`}>
              {i + 1}. {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xl font-black tabular-nums text-white/90">
              {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
              {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all" title="Fullscreen (F)">
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onExit} className="p-2 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all" title="Exit (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">

        {/* ================================================================ */}
        {/*  VIEW 1: OVERVIEW                                                */}
        {/* ================================================================ */}
        {activeView === 'overview' && (
          <>
            {/* Pipeline */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Not Linked', count: stats.noJob, color: '#ef4444', icon: AlertTriangle, glow: 'shadow-red-500/20' },
                { label: 'In Production', count: stats.inProd, color: '#f59e0b', icon: Activity, glow: 'shadow-amber-500/20' },
                { label: 'Ready to Ship', count: stats.ready, color: '#10b981', icon: CheckCircle2, glow: 'shadow-emerald-500/20' },
                { label: 'Shipped Today', count: stats.fulfilledToday, color: '#8b5cf6', icon: Truck, glow: 'shadow-purple-500/20' },
              ].map((stage, i) => (
                <div key={stage.label} className="relative group">
                  <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:bg-white/[0.06] transition-all duration-300 shadow-xl ${stage.glow}`}>
                    <div className="absolute inset-x-0 bottom-0 h-1 rounded-b-2xl" style={{ background: stage.color }} />
                    <div className="flex items-center justify-between mb-3">
                      <stage.icon className="w-5 h-5" style={{ color: stage.color }} />
                      {i < 3 && <ArrowRight className="w-4 h-4 text-white/10 group-hover:text-white/30 transition-colors" />}
                    </div>
                    <p className="text-4xl font-black tabular-nums text-white"><AnimNum value={stage.count} /></p>
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40 mt-1">{stage.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Row 2: Stats + Gauges */}
            <div className="grid grid-cols-12 gap-4">
              {/* Key metrics */}
              <div className="col-span-5 grid grid-cols-2 gap-3">
                {[
                  { label: 'Active Orders', value: stats.total, icon: Package, color: 'from-indigo-600/30 to-indigo-900/30', border: 'border-indigo-500/20' },
                  { label: 'Overdue', value: stats.late, icon: AlertTriangle, color: 'from-red-600/30 to-red-900/30', border: 'border-red-500/20', sub: stats.dueSoon > 0 ? `${stats.dueSoon} due in 3d` : undefined },
                  { label: 'Pipeline Value', value: Math.round(stats.pipelineValue), icon: DollarSign, color: 'from-emerald-600/30 to-emerald-900/30', border: 'border-emerald-500/20', sub: `\u00A3${stats.pipelineValue.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
                  { label: 'Avg Order', value: Math.round(stats.avgOrderValue), icon: ShoppingBag, color: 'from-purple-600/30 to-purple-900/30', border: 'border-purple-500/20', sub: `\u00A3${stats.avgOrderValue.toFixed(2)}` },
                ].map(m => (
                  <div key={m.label} className={`relative overflow-hidden rounded-2xl border ${m.border} bg-gradient-to-br ${m.color} p-4 shadow-xl group hover:scale-[1.02] transition-all duration-300`}>
                    <div className="absolute -right-3 -top-3 opacity-[0.07] group-hover:opacity-[0.12] transition-opacity">
                      <m.icon className="w-20 h-20" />
                    </div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50 mb-1">{m.label}</p>
                    <p className="text-3xl font-black text-white tabular-nums"><AnimNum value={m.value} /></p>
                    {m.sub && <p className="text-[10px] text-white/40 mt-0.5">{m.sub}</p>}
                  </div>
                ))}
              </div>

              {/* Gauges */}
              <div className="col-span-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Performance</h3>
                </div>
                <div className="flex justify-around">
                  <Gauge value={stats.slaCompliance} label="SLA" color="#6366f1" />
                  <Gauge value={stats.avgCompletion} label="Completion" color="#f59e0b" />
                  <Gauge value={stats.onTimeRate} label="On-Time" color="#10b981" />
                </div>
              </div>

              {/* Velocity + sparkline */}
              <div className="col-span-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Fulfillment Velocity</h3>
                  </div>
                  <div className="flex items-end gap-4 mb-3">
                    <div>
                      <p className="text-3xl font-black text-white tabular-nums">{velocity.thisWeek}</p>
                      <p className="text-[9px] text-white/40">shipped this week</p>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                      velocity.trend >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {velocity.trend >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {Math.abs(velocity.trend)}%
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-white/30 mb-1">Orders received — last 14 days</p>
                  <MiniSparkline data={dailyOrders} color="#60a5fa" />
                </div>
              </div>
            </div>

            {/* Row 3: Priority Queue + Activity Feed */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-red-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Priority Queue</h3>
                  <span className="ml-auto text-[9px] text-white/25 font-bold uppercase tracking-widest">Click to view order</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {priorities.map((o, i) => {
                    const overdue = o.daysRemaining < 0;
                    const urgent = o.daysRemaining >= 0 && o.daysRemaining <= 3;
                    return (
                      <div key={o.shopify.id}
                        onClick={() => setSelectedOrder(selectedOrder?.shopify.id === o.shopify.id ? null : o)}
                        className={`flex items-center gap-3 rounded-xl px-4 py-3 border cursor-pointer transition-all duration-200 hover:scale-[1.01] ${
                          selectedOrder?.shopify.id === o.shopify.id ? 'border-indigo-500/50 bg-indigo-500/10 ring-1 ring-indigo-500/20' :
                          overdue ? 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10' :
                          urgent ? 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10' :
                          'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
                        }`}>
                        <span className={`text-lg font-black tabular-nums w-6 ${overdue ? 'text-red-400' : urgent ? 'text-amber-400' : 'text-white/30'}`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white truncate">#{o.shopify.orderNumber}</p>
                          <p className="text-[10px] text-white/40 truncate">{o.shopify.customerName}{o.clubName ? ` \u00B7 ${o.clubName}` : ''}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-black tabular-nums ${overdue ? 'text-red-400' : urgent ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {overdue ? `${Math.abs(o.daysRemaining)}d late` : `${o.daysRemaining}d`}
                          </p>
                          <div className="w-16 h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{
                              width: `${o.completionPercentage}%`,
                              background: o.completionPercentage === 100 ? '#10b981' : o.completionPercentage > 50 ? '#f59e0b' : '#ef4444'
                            }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Activity feed */}
              <div className="col-span-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col max-h-[400px]">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Activity Feed</h3>
                  <span className="ml-auto relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-0.5 pr-1" style={{ scrollbarWidth: 'none' }}>
                  {feed.map(item => {
                    const Icon = typeIcons[item.type];
                    return (
                      <div key={item.id}
                        onClick={() => onNavigateToOrder?.(item.order.shopify.orderNumber)}
                        className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group">
                        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: typeColors[item.type] }} />
                        <p className="text-[11px] text-white/60 group-hover:text-white/90 truncate flex-1 transition-colors">{item.text}</p>
                        <span className="text-[9px] text-white/25 shrink-0 tabular-nums">{item.time}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ================================================================ */}
        {/*  VIEW 2: PIPELINE & TRENDS                                       */}
        {/* ================================================================ */}
        {activeView === 'pipeline' && (
          <>
            <div className="grid grid-cols-12 gap-4">
              {/* Revenue sparkline */}
              <div className="col-span-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Revenue — Last 14 Days</h3>
                    </div>
                    <p className="text-2xl font-black text-white">{'\u00A3'}{stats.todayRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}<span className="text-sm text-white/40 ml-2">today</span></p>
                  </div>
                </div>
                <MiniSparkline data={dailyRevenue} color="#10b981" height={80} />
              </div>

              {/* Orders sparkline */}
              <div className="col-span-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="w-4 h-4 text-blue-400" />
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Order Volume — Last 14 Days</h3>
                    </div>
                    <p className="text-2xl font-black text-white"><AnimNum value={stats.total} /><span className="text-sm text-white/40 ml-2">active</span></p>
                  </div>
                </div>
                <MiniSparkline data={dailyOrders} color="#60a5fa" height={80} />
              </div>
            </div>

            {/* Heatmap + Pipeline detail */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Order Heatmap — 4 Weeks</h3>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="w-8" />
                    {['Wk-3', 'Wk-2', 'Wk-1', 'This'].map(w => (
                      <span key={w} className="flex-1 text-center text-[8px] text-white/25 font-bold">{w}</span>
                    ))}
                  </div>
                  {heatmapData.dayNames.map((name, i) => (
                    <HeatmapRow key={name} label={name} data={heatmapData.weeks[i]} maxVal={heatmapData.maxVal} />
                  ))}
                </div>
                <div className="flex items-center justify-end gap-2 mt-3">
                  <span className="text-[8px] text-white/30">Less</span>
                  {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
                    <div key={v} className="w-3 h-3 rounded-sm" style={{ background: `rgba(99,102,241,${v})` }} />
                  ))}
                  <span className="text-[8px] text-white/30">More</span>
                </div>
              </div>

              {/* Production funnel */}
              <div className="col-span-7 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2 mb-6">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Production Funnel</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { label: 'Not Linked', count: stats.noJob, color: '#ef4444', pct: stats.total > 0 ? (stats.noJob / stats.total) * 100 : 0 },
                    { label: 'In Production', count: stats.inProd, color: '#f59e0b', pct: stats.total > 0 ? (stats.inProd / stats.total) * 100 : 0 },
                    { label: 'Ready to Ship', count: stats.ready, color: '#10b981', pct: stats.total > 0 ? (stats.ready / stats.total) * 100 : 0 },
                    { label: 'Overdue', count: stats.late, color: '#ef4444', pct: stats.total > 0 ? (stats.late / stats.total) * 100 : 0 },
                    { label: 'Due Within 3 Days', count: stats.dueSoon, color: '#f59e0b', pct: stats.total > 0 ? (stats.dueSoon / stats.total) * 100 : 0 },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-3 group">
                      <span className="text-[10px] font-bold text-white/50 w-28 text-right group-hover:text-white/80 transition-colors">{row.label}</span>
                      <div className="flex-1 h-7 bg-white/5 rounded-lg overflow-hidden relative">
                        <div className="h-full rounded-lg transition-all duration-1000 flex items-center px-3"
                          style={{ width: `${Math.max(row.pct, 2)}%`, background: `${row.color}40`, borderLeft: `3px solid ${row.color}` }}>
                          <span className="text-xs font-black text-white tabular-nums">{row.count}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-white/30 tabular-nums w-10 text-right">{row.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                    <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Total Items</p>
                    <p className="text-xl font-black text-white"><AnimNum value={stats.totalItems} /></p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                    <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Velocity</p>
                    <p className="text-xl font-black text-white">{velocity.thisWeek}<span className="text-xs text-white/30">/wk</span></p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                    <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Avg Days</p>
                    <p className="text-xl font-black text-white">
                      {priorities.length > 0 ? Math.round(priorities.reduce((s, o) => s + o.daysInProduction, 0) / priorities.length) : 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ================================================================ */}
        {/*  VIEW 3: CLUB BREAKDOWN                                          */}
        {/* ================================================================ */}
        {activeView === 'clubs' && (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center gap-2 mb-5">
                <Users className="w-4 h-4 text-purple-400" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Club / Tag Breakdown — Active Orders</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {clubData.map(([name, data]) => {
                  const maxCount = clubData[0]?.[1].count || 1;
                  const barWidth = (data.count / maxCount) * 100;
                  return (
                    <div key={name} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 hover:bg-white/[0.05] transition-all duration-300 group cursor-default">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold text-white truncate flex-1">{name}</p>
                        <span className="text-2xl font-black text-white tabular-nums ml-2">{data.count}</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full mb-3 overflow-hidden">
                        <div className="h-full bg-indigo-500/60 rounded-full transition-all duration-700 group-hover:bg-indigo-400/80"
                          style={{ width: `${barWidth}%` }} />
                      </div>
                      <div className="flex items-center gap-4 text-[9px]">
                        <span className="text-white/40">{'\u00A3'}{data.value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                        <span className="text-emerald-400/70">{data.ready} ready</span>
                        {data.late > 0 && <span className="text-red-400/70">{data.late} late</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-club value bars + gauges */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Target className="w-4 h-4 text-amber-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Top Clubs by Value</h3>
                </div>
                <div className="space-y-2">
                  {clubData.slice(0, 6).map(([name, data]) => {
                    const maxValue = clubData[0]?.[1].value || 1;
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <span className="text-[10px] text-white/50 w-32 truncate text-right font-bold">{name}</span>
                        <div className="flex-1 h-5 bg-white/5 rounded overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-amber-500/40 to-amber-500/20 rounded transition-all duration-700 flex items-center px-2"
                            style={{ width: `${(data.value / maxValue) * 100}%` }}>
                            <span className="text-[9px] font-bold text-white">{'\u00A3'}{data.value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="col-span-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Overall Performance</h3>
                </div>
                <div className="flex justify-around">
                  <Gauge value={stats.slaCompliance} label="SLA Compliance" color="#6366f1" size={130} />
                  <Gauge value={stats.avgCompletion} label="Avg Completion" color="#f59e0b" size={130} />
                  <Gauge value={stats.onTimeRate} label="On-Time Rate" color="#10b981" size={130} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Order Detail Drawer ── */}
      {selectedOrder && (
        <div className="fixed bottom-0 left-0 right-0 z-[110]" style={{ animation: 'slideUp 0.3s ease-out' }}>
          <style>{`@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
          <div className="max-w-5xl mx-auto bg-[#12122a] border border-white/10 rounded-t-2xl shadow-2xl shadow-black/50 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-white">#{selectedOrder.shopify.orderNumber} — {selectedOrder.shopify.customerName}</h3>
                <p className="text-xs text-white/40">{selectedOrder.clubName || 'No Club'} {'\u00B7'} Ordered {new Date(selectedOrder.shopify.date).toLocaleDateString('en-GB')} {'\u00B7'} {selectedOrder.shopify.items.length} items</p>
              </div>
              <div className="flex items-center gap-2">
                {onNavigateToOrder && (
                  <button onClick={() => { onNavigateToOrder(selectedOrder.shopify.orderNumber); onExit(); }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs font-bold hover:bg-indigo-500/30 transition-colors">
                    Open in Dashboard {'\u2192'}
                  </button>
                )}
                <button onClick={() => setSelectedOrder(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-6">
              <div>
                <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Status</p>
                <p className={`text-sm font-bold ${selectedOrder.shopify.fulfillmentStatus === 'fulfilled' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {selectedOrder.shopify.fulfillmentStatus === 'fulfilled' ? 'Fulfilled' : selectedOrder.productionStatus}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Deco Job</p>
                <p className="text-sm font-bold text-white">{selectedOrder.decoJobId || 'Not Linked'}</p>
              </div>
              <div>
                <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Completion</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${selectedOrder.completionPercentage}%`,
                      background: selectedOrder.completionPercentage === 100 ? '#10b981' : '#f59e0b'
                    }} />
                  </div>
                  <span className="text-sm font-black text-white tabular-nums">{selectedOrder.completionPercentage}%</span>
                </div>
              </div>
              <div>
                <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Days Remaining</p>
                <p className={`text-sm font-bold ${selectedOrder.daysRemaining < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {selectedOrder.daysRemaining < 0 ? `${Math.abs(selectedOrder.daysRemaining)}d overdue` : `${selectedOrder.daysRemaining}d`}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Value</p>
                <p className="text-sm font-bold text-white">{'\u00A3'}{parseFloat(selectedOrder.shopify.totalPrice).toFixed(2)}</p>
              </div>
            </div>
            {/* Items list */}
            <div className="mt-4 border-t border-white/5 pt-3 max-h-32 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2">
                {selectedOrder.shopify.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    {item.imageUrl && <img src={item.imageUrl} className="w-8 h-8 rounded object-cover" alt="" />}
                    <div className="min-w-0">
                      <p className="text-[11px] text-white/70 truncate">{item.name}</p>
                      <p className="text-[9px] text-white/30">Qty: {item.quantity} {'\u00B7'} {item.itemStatus || 'unfulfilled'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom Bar ── */}
      <div className="sticky bottom-0 backdrop-blur-xl bg-[#080818]/80 border-t border-white/5 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-8">
          {[
            { label: "Today's Revenue", value: `\u00A3${stats.todayRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` },
            { label: 'Pipeline', value: `\u00A3${stats.pipelineValue.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
            { label: 'Active', value: `${stats.total}` },
            { label: 'Overdue', value: `${stats.late}` },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">{s.label}</span>
              <span className="text-xs font-black text-white tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 text-white/20">
          <span className="text-[9px] font-bold uppercase tracking-widest">F = Fullscreen {'\u00B7'} ESC = Exit {'\u00B7'} 1/2/3 = Switch View {'\u00B7'} {'\u2190\u2192'} = Navigate</span>
          <Clock className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '8s' }} />
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
