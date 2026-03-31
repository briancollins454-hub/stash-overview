import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { detectDuplicates, DuplicateGroup } from '../services/duplicateDetectionService';
import { AlertTriangle, Copy, ExternalLink, CheckCircle2, Search, X, Eye } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  shopifyDomain: string;
  onNavigateToOrder?: (orderNumber: string) => void;
}

const DuplicateDetector: React.FC<Props> = ({ orders, shopifyDomain, onNavigateToOrder }) => {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const duplicates = useMemo(() => {
    return detectDuplicates(orders).filter(g => !dismissed.has(g.key));
  }, [orders, dismissed]);

  const dismissGroup = (key: string) => {
    setDismissed(prev => new Set([...prev, key]));
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Copy className="w-4 h-4 text-amber-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Duplicate Detection</h3>
          {duplicates.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black">{duplicates.length} found</span>
          )}
        </div>
        {dismissed.size > 0 && (
          <button onClick={() => setDismissed(new Set())} className="text-[9px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest">
            Reset dismissed ({dismissed.size})
          </button>
        )}
      </div>

      <div className="p-4">
        {duplicates.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            <p className="text-xs font-bold uppercase tracking-widest">No duplicates detected</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">
              <AlertTriangle className="w-3 h-3 inline-block mr-1" />
              {duplicates.length} potential duplicate group(s) found — click an order to view it
            </p>
            {duplicates.map((group) => (
              <div key={group.key} className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-bold text-amber-700">{group.reason}</p>
                  <button onClick={() => dismissGroup(group.key)} className="text-[9px] font-bold text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors" title="Dismiss this group">
                    <X className="w-3 h-3" /> Dismiss
                  </button>
                </div>
                <div className="space-y-1.5">
                  {group.orders.map(o => (
                    <div key={o.shopify.id} className="flex items-center justify-between bg-white rounded px-3 py-2 border border-amber-100 hover:border-indigo-300 hover:shadow-sm transition-all group">
                      <button
                        onClick={() => onNavigateToOrder?.(o.shopify.orderNumber)}
                        className="flex items-center gap-2 text-left flex-1 min-w-0"
                      >
                        <span className="text-xs font-black text-gray-800 group-hover:text-indigo-600 transition-colors">#{o.shopify.orderNumber}</span>
                        <span className="text-[10px] text-gray-400 font-bold">{o.shopify.customerName}</span>
                        <span className="text-[10px] text-gray-400 font-bold">£{o.shopify.totalPrice}</span>
                        <span className="text-[10px] text-gray-400 font-bold">{new Date(o.shopify.date).toLocaleDateString('en-GB')}</span>
                        <Eye className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                      </button>
                      {shopifyDomain && (
                        <a
                          href={`https://${encodeURIComponent(shopifyDomain)}/admin/orders/${o.shopify.id.split('/').pop()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-500 hover:text-indigo-700 ml-2"
                          title="Open in Shopify"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DuplicateDetector;
