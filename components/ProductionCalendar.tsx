import React, { useMemo, useState } from 'react';
import { UnifiedOrder } from '../types';
import { Calendar, ChevronLeft, ChevronRight, Eye, Package } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface CalendarDay {
  date: Date;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  orders: UnifiedOrder[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

const ProductionCalendar: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Build a map of orders by their estimated date (due date or SLA target)
  const ordersByDate = useMemo(() => {
    const map = new Map<string, UnifiedOrder[]>();
    orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled').forEach(o => {
      const dateStr = (o.productionDueDate || o.slaTargetDate || '').split('T')[0];
      if (!dateStr) return;
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr)!.push(o);
    });
    return map;
  }, [orders]);

  const calendarDays = useMemo<CalendarDay[]>(() => {
    const days: CalendarDay[] = [];
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (view === 'month') {
      const firstOfMonth = new Date(year, month, 1);
      const lastOfMonth = new Date(year, month + 1, 0);
      // Start from Monday before/on the 1st
      let startDay = firstOfMonth.getDay();
      if (startDay === 0) startDay = 7;
      const start = new Date(year, month, 1 - (startDay - 1));

      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        days.push({
          date: d,
          dateStr,
          isCurrentMonth: d.getMonth() === month,
          isToday: dateStr === todayStr,
          orders: ordersByDate.get(dateStr) || [],
        });
      }
    } else {
      const monday = getMonday(currentDate);
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        days.push({
          date: d,
          dateStr,
          isCurrentMonth: true,
          isToday: dateStr === todayStr,
          orders: ordersByDate.get(dateStr) || [],
        });
      }
    }
    return days;
  }, [year, month, currentDate, view, ordersByDate]);

  const navigate = (dir: -1 | 1) => {
    if (view === 'month') {
      setCurrentDate(new Date(year, month + dir, 1));
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + dir * 7);
      setCurrentDate(d);
    }
  };

  const goToday = () => setCurrentDate(new Date());

  const selectedOrders = selectedDay ? (ordersByDate.get(selectedDay) || []) : [];

  // Daily workload summary
  const totalUnitsToday = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return (ordersByDate.get(todayStr) || []).reduce((sum, o) => sum + o.shopify.items.reduce((s, i) => s + i.quantity, 0), 0);
  }, [ordersByDate]);

  const dayColor = (count: number) => {
    if (count === 0) return '';
    if (count <= 3) return 'bg-indigo-50';
    if (count <= 8) return 'bg-indigo-100';
    if (count <= 15) return 'bg-indigo-200';
    return 'bg-indigo-300';
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-purple-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Production Calendar</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView(view === 'month' ? 'week' : 'month')} className="px-2 py-1 text-[9px] font-bold border border-gray-200 rounded uppercase tracking-widest text-gray-500 hover:bg-gray-50">
            {view === 'month' ? 'Week View' : 'Month View'}
          </button>
          <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-700"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={goToday} className="px-2 py-1 text-[9px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest">Today</button>
          <button onClick={() => navigate(1)} className="p-1 text-gray-400 hover:text-gray-700"><ChevronRight className="w-4 h-4" /></button>
          <span className="text-xs font-black text-gray-700 min-w-[120px] text-center">
            {view === 'month'
              ? currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
              : `Week of ${getMonday(currentDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            }
          </span>
        </div>
      </div>

      <div className="p-4">
        {/* Calendar grid */}
        <div className={`grid grid-cols-7 gap-1 ${view === 'week' ? '' : ''}`}>
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[8px] font-black uppercase tracking-widest text-gray-400 py-1">{d}</div>
          ))}
          {calendarDays.map(day => (
            <button
              key={day.dateStr}
              onClick={() => setSelectedDay(selectedDay === day.dateStr ? null : day.dateStr)}
              className={`
                relative p-1 rounded-lg text-center transition-all min-h-[60px] border
                ${day.isCurrentMonth ? 'text-gray-700' : 'text-gray-300'}
                ${day.isToday ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-transparent'}
                ${selectedDay === day.dateStr ? 'bg-indigo-50 border-indigo-300' : ''}
                ${dayColor(day.orders.length)}
                hover:bg-indigo-50/50
              `}
            >
              <span className={`text-[10px] font-black ${day.isToday ? 'text-indigo-600' : ''}`}>
                {day.date.getDate()}
              </span>
              {day.orders.length > 0 && (
                <div className="mt-0.5">
                  <span className={`text-[8px] font-black rounded-full px-1.5 py-0.5 ${
                    day.orders.length > 10 ? 'bg-red-500 text-white' : day.orders.length > 5 ? 'bg-amber-500 text-white' : 'bg-indigo-500 text-white'
                  }`}>
                    {day.orders.length}
                  </span>
                </div>
              )}
              {view === 'week' && day.orders.slice(0, 3).map(o => (
                <div key={o.shopify.id} className="text-[7px] font-bold text-gray-500 truncate mt-0.5">
                  #{o.shopify.orderNumber}
                </div>
              ))}
            </button>
          ))}
        </div>

        {/* Heat legend */}
        <div className="flex items-center gap-2 mt-3 justify-center">
          <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Less</span>
          {[0, 3, 8, 15, 20].map(n => (
            <div key={n} className={`w-4 h-4 rounded ${dayColor(n) || 'bg-gray-100'} border border-gray-200`} />
          ))}
          <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">More</span>
        </div>

        {/* Selected day detail */}
        {selectedDay && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2">
              {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              <span className="text-gray-400 ml-2">— {selectedOrders.length} orders, {selectedOrders.reduce((s, o) => s + o.shopify.items.reduce((si, i) => si + i.quantity, 0), 0)} units</span>
            </h4>
            {selectedOrders.length === 0 ? (
              <p className="text-[10px] text-gray-400 text-center py-3">No orders due this day</p>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {selectedOrders.map(o => (
                  <button
                    key={o.shopify.id}
                    onClick={() => onNavigateToOrder?.(o.shopify.orderNumber)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-black text-gray-800 group-hover:text-indigo-600 transition-colors">#{o.shopify.orderNumber}</span>
                      <span className="text-[10px] font-bold text-gray-500 truncate">{o.shopify.customerName}</span>
                      {o.clubName && <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">{o.clubName}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-gray-400">{o.completionPercentage}%</span>
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${o.completionPercentage === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${o.completionPercentage}%` }} />
                      </div>
                      <Eye className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductionCalendar;
