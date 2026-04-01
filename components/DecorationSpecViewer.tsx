import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { Paintbrush, ChevronDown, ChevronUp, Package, Search, Layers } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface DecoSpec {
  orderNumber: string;
  customerName: string;
  itemName: string;
  productCode: string;
  decorationDetails: string;
  quantity: number;
  status: string;
  assignedTo?: string;
}

const DecorationSpecViewer: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [search, setSearch] = useState('');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'order' | 'type'>('order');

  const { specs, decoTypes, hasData } = useMemo(() => {
    const all: DecoSpec[] = [];

    for (const o of orders) {
      if (!o.deco?.items) continue;
      for (const item of o.deco.items) {
        if (item.decorationDetails) {
          all.push({
            orderNumber: o.shopify.orderNumber,
            customerName: o.shopify.customerName,
            itemName: item.name,
            productCode: item.productCode,
            decorationDetails: item.decorationDetails,
            quantity: item.quantity,
            status: item.status || (item.isProduced ? 'Produced' : item.isReceived ? 'Received' : 'Pending'),
            assignedTo: item.assignedTo,
          });
        }
      }
    }

    // Extract decoration types from the details text
    const typeMap = new Map<string, number>();
    for (const s of all) {
      const details = s.decorationDetails.toLowerCase();
      const types = ['embroidery', 'screen print', 'heat press', 'dtg', 'sublimation', 'vinyl', 'badge', 'patch', 'laser', 'engrav'];
      for (const t of types) {
        if (details.includes(t)) {
          typeMap.set(t, (typeMap.get(t) || 0) + 1);
        }
      }
    }

    return { specs: all, decoTypes: typeMap, hasData: all.length > 0 };
  }, [orders]);

  const filtered = useMemo(() => {
    if (!search) return specs;
    const q = search.toLowerCase();
    return specs.filter(s =>
      s.orderNumber.includes(q) || s.itemName.toLowerCase().includes(q) ||
      s.decorationDetails.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q) ||
      s.productCode.toLowerCase().includes(q)
    );
  }, [specs, search]);

  const grouped = useMemo(() => {
    if (groupBy === 'order') {
      const map = new Map<string, DecoSpec[]>();
      for (const s of filtered) {
        const key = s.orderNumber;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(s);
      }
      return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
    }
    // Group by decoration type keyword
    const map = new Map<string, DecoSpec[]>();
    for (const s of filtered) {
      const details = s.decorationDetails.toLowerCase();
      let matched = false;
      for (const t of ['embroidery', 'screen print', 'heat press', 'dtg', 'sublimation', 'vinyl', 'badge', 'patch', 'laser']) {
        if (details.includes(t)) {
          if (!map.has(t)) map.set(t, []);
          map.get(t)!.push(s);
          matched = true;
        }
      }
      if (!matched) {
        if (!map.has('other')) map.set('other', []);
        map.get('other')!.push(s);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered, groupBy]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Paintbrush className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Decoration Specs</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{specs.length} items with decoration details</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search specs..."
                className="pl-8 pr-3 py-1.5 text-xs border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 w-48" />
            </div>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)}
              className="text-xs border rounded-lg px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">
              <option value="order">Group: By Order</option>
              <option value="type">Group: By Type</option>
            </select>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <Paintbrush className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No decoration details available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Decoration specs appear when DecoNetwork workflow items include embellishment data</p>
        </div>
      ) : (
        <>
          {/* Type Summary */}
          {decoTypes.size > 0 && (
            <div className="flex flex-wrap gap-2 px-6 pt-5">
              {Array.from(decoTypes.entries()).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <span key={type} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 capitalize">
                  <Layers className="w-3 h-3" /> {type} ({count})
                </span>
              ))}
            </div>
          )}

          {/* Grouped Items */}
          <div className="px-6 py-4 space-y-2">
            {grouped.slice(0, 30).map(([key, items]) => (
              <div key={key} className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => setExpandedOrder(expandedOrder === key ? null : key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex items-center gap-2">
                    {groupBy === 'order' ? (
                      <>
                        <button onClick={e => { e.stopPropagation(); onNavigateToOrder?.(key); }}
                          className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline text-sm">#{key}</button>
                        <span className="text-xs text-gray-400">{items[0].customerName}</span>
                      </>
                    ) : (
                      <span className="font-medium text-sm text-gray-900 dark:text-white capitalize">{key}</span>
                    )}
                    <span className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full text-xs">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  </div>
                  {expandedOrder === key ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {expandedOrder === key && (
                  <div className="border-t dark:border-gray-700">
                    {items.map((item, i) => (
                      <div key={i} className="px-4 py-3 border-b last:border-b-0 dark:border-gray-700/50">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{item.itemName}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.productCode} · Qty {item.quantity}</p>
                          </div>
                          <div className="text-right">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${item.status === 'Produced' ? 'bg-emerald-100 text-emerald-700' : item.status === 'Received' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                              {item.status}
                            </span>
                            {item.assignedTo && <p className="text-xs text-gray-400 mt-1">→ {item.assignedTo}</p>}
                          </div>
                        </div>
                        <div className="mt-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2">
                          <p className="text-xs text-purple-800 dark:text-purple-200 whitespace-pre-wrap">{item.decorationDetails}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default DecorationSpecViewer;
