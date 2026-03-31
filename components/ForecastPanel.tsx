import React, { useMemo, useState } from 'react';
import { UnifiedOrder } from '../types';
import { forecastProduction, ForecastResult } from '../services/forecastService';
import { TrendingUp, Calendar, AlertTriangle, ChevronDown, ChevronUp, Eye } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

const ForecastPanel: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [showAll, setShowAll] = useState(false);
  const forecasts = useMemo(() => forecastProduction(orders), [orders]);

  const displayed = showAll ? forecasts : forecasts.slice(0, 10);

  const confidenceColor = (level: string) => {
    if (level === 'high') return 'text-emerald-600 bg-emerald-50';
    if (level === 'medium') return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
  };

  if (forecasts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-400">
        <TrendingUp className="w-8 h-8 mx-auto mb-2" />
        <p className="text-xs font-bold uppercase tracking-widest">Not enough data for forecasting</p>
        <p className="text-[9px] mt-1">Forecasts require fulfilled order history to calculate turnaround baselines.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-purple-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Production Forecast</h3>
          <span className="text-[9px] font-bold text-gray-400">({forecasts.length} active orders)</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Order</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Customer</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Est. Complete</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Est. Ship</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Days Left</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Confidence</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Basis</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(f => (
              <tr
                key={f.orderId}
                className={`border-t border-gray-50 hover:bg-indigo-50/50 transition-colors ${onNavigateToOrder ? 'cursor-pointer' : ''}`}
                onClick={() => onNavigateToOrder?.(f.orderNumber)}
              >
                <td className="px-4 py-2 font-black text-gray-800 group">
                  <span className="hover:text-indigo-600 transition-colors">#{f.orderNumber}</span>
                  {onNavigateToOrder && <Eye className="w-3 h-3 text-indigo-400 inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />}
                </td>
                <td className="px-4 py-2 font-bold text-gray-600 truncate max-w-[150px]">{f.customerName}</td>
                <td className="px-4 py-2 text-center font-bold text-gray-700">
                  <Calendar className="w-3 h-3 inline-block mr-1 text-gray-400" />
                  {f.estimatedCompletionDate}
                </td>
                <td className="px-4 py-2 text-center font-bold text-gray-700">{f.estimatedShipDate}</td>
                <td className="px-4 py-2 text-center font-black">
                  <span className={f.daysUntilCompletion <= 2 ? 'text-red-600' : f.daysUntilCompletion <= 5 ? 'text-amber-600' : 'text-gray-600'}>
                    {f.daysUntilCompletion}d
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${confidenceColor(f.confidenceLevel)}`}>
                    {f.confidenceLevel}
                  </span>
                </td>
                <td className="px-4 py-2 font-bold text-gray-400 text-[9px] max-w-[200px] truncate">{f.basedOn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {forecasts.length > 10 && (
        <div className="px-4 py-2 border-t border-gray-100 text-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest flex items-center gap-1 mx-auto"
          >
            {showAll ? <><ChevronUp className="w-3 h-3" /> Show Less</> : <><ChevronDown className="w-3 h-3" /> Show All ({forecasts.length})</>}
          </button>
        </div>
      )}
    </div>
  );
};

export default ForecastPanel;
