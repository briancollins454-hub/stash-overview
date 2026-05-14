import React, { useMemo, useState, useCallback } from 'react';
import type { UnifiedOrder } from '../types';
import { Tags, ChevronDown, ChevronRight, Search, ExternalLink, LayoutList } from 'lucide-react';

const UNTAGGED = 'Other (no visible tag)';

export interface ShopifyTagBundlesProps {
  orders: UnifiedOrder[];
  excludedTags: string[];
  shopifyDomain?: string;
  onNavigateToOrder: (orderNumber: string) => void;
}

function orderAdminUrl(domain: string | undefined, orderGid: string): string | null {
  if (!domain) return null;
  const numeric = orderGid.replace(/\D/g, '');
  if (!numeric) return null;
  const host = domain.replace(/^https?:\/\//, '').split('/')[0].replace(/\/$/, '');
  return `https://${host}/admin/orders/${numeric}`;
}

function validTagsForOrder(o: UnifiedOrder, excluded: Set<string>): string[] {
  return o.shopify.tags.filter(t => t && !excluded.has(t.trim()));
}

function isFulfilledBucket(o: UnifiedOrder): boolean {
  const s = o.shopify.fulfillmentStatus;
  return s === 'fulfilled' || s === 'restocked' || s === 'refunded';
}

function sortByDateDesc(a: UnifiedOrder, b: UnifiedOrder): number {
  const ta = a._rawOrderDate?.getTime() ?? new Date(a.shopify.date).getTime();
  const tb = b._rawOrderDate?.getTime() ?? new Date(b.shopify.date).getTime();
  return tb - ta;
}

const ShopifyTagBundles: React.FC<ShopifyTagBundlesProps> = ({
  orders,
  excludedTags,
  shopifyDomain,
  onNavigateToOrder,
}) => {
  const excluded = useMemo(() => new Set(excludedTags.map(t => t.trim())), [excludedTags]);
  const [query, setQuery] = useState('');
  const [datePreset, setDatePreset] = useState<'all' | '30' | '90' | '365'>('90');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const cutoff = useMemo(() => {
    if (datePreset === 'all') return null;
    const d = new Date();
    const days = datePreset === '30' ? 30 : datePreset === '90' ? 90 : 365;
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [datePreset]);

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (cutoff !== null) {
      list = list.filter(o => {
        const t = o._rawOrderDate?.getTime() ?? new Date(o.shopify.date).getTime();
        return t >= cutoff;
      });
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(o => {
      const num = o.shopify.orderNumber.toLowerCase();
      const name = o.shopify.customerName.toLowerCase();
      const tags = o.shopify.tags.join(' ').toLowerCase();
      return num.includes(q) || name.includes(q) || tags.includes(q);
    });
  }, [orders, cutoff, query]);

  const bundles = useMemo(() => {
    const byTag = new Map<string, UnifiedOrder[]>();
    for (const o of filteredOrders) {
      const tags = validTagsForOrder(o, excluded);
      const keys = tags.length > 0 ? tags : [UNTAGGED];
      for (const tag of keys) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(o);
      }
    }
    const sortedTags = Array.from(byTag.keys()).sort((a, b) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    return sortedTags.map(tag => {
      const all = byTag.get(tag)!;
      const open = all.filter(o => !isFulfilledBucket(o)).sort(sortByDateDesc);
      const done = all.filter(o => isFulfilledBucket(o)).sort(sortByDateDesc);
      return { tag, open, done, total: all.length };
    });
  }, [filteredOrders, excluded]);

  const toggle = useCallback((tag: string) => {
    setExpanded(prev => ({ ...prev, [tag]: prev[tag] === false ? true : false }));
  }, []);

  const expandAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    bundles.forEach(b => {
      next[b.tag] = true;
    });
    setExpanded(next);
  }, [bundles]);

  const collapseAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    bundles.forEach(b => {
      next[b.tag] = false;
    });
    setExpanded(next);
  }, [bundles]);

  const renderRows = (list: UnifiedOrder[], tag: string) => {
    if (list.length === 0) {
      return (
        <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest px-3 py-2">None</p>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-[9px] font-black uppercase tracking-widest text-gray-500">
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Shopify</th>
              <th className="px-3 py-2">Deco</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 w-24"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {list.map(o => {
              const admin = orderAdminUrl(shopifyDomain, o.shopify.id);
              const dateStr = new Date(o.shopify.date).toLocaleDateString('en-GB');
              return (
                <tr key={`${tag}-${o.shopify.id}`} className="hover:bg-indigo-50/40">
                  <td className="px-3 py-2 font-black text-gray-900">#{o.shopify.orderNumber}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={o.shopify.customerName}>
                    {o.shopify.customerName}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{dateStr}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${
                        o.shopify.fulfillmentStatus === 'fulfilled'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : o.shopify.fulfillmentStatus === 'partial'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {o.shopify.fulfillmentStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-indigo-600">{o.decoJobId || '—'}</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-800">{o.shopify.totalPrice || '0'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onNavigateToOrder(o.shopify.orderNumber)}
                      className="text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-800 mr-2"
                    >
                      Stash
                    </button>
                    {admin && (
                      <a
                        href={admin}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800"
                      >
                        Admin <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50/80 to-white flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
            <Tags className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-900">Orders by tag</h2>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">
              Each Shopify tag (except ones you exclude in Settings) gets its own block. Orders with several tags appear under each tag so you can find them from any label.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search #, customer, tag…"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-[11px] font-bold w-[220px] max-w-full focus:ring-1 focus:ring-indigo-500 outline-none"
            />
          </div>
          <select
            value={datePreset}
            onChange={e => setDatePreset(e.target.value as typeof datePreset)}
            className="text-[10px] font-black uppercase tracking-widest border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="all">All dates</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
          <button
            type="button"
            onClick={expandAll}
            className="text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded border border-indigo-100"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-50 px-2 py-1 rounded border border-gray-200"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="max-h-[calc(100vh-200px)] overflow-y-auto divide-y divide-gray-100">
        {bundles.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm font-bold">No orders match your filters.</div>
        ) : (
          bundles.map(({ tag, open, done, total }) => {
            const isOpen = expanded[tag] !== false;
            return (
              <section key={tag} className="bg-white">
                <button
                  type="button"
                  onClick={() => toggle(tag)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50/80 text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                  <LayoutList className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="font-black text-sm text-gray-900 uppercase tracking-tight flex-1 truncate">{tag}</span>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest shrink-0">
                    {total} order{total === 1 ? '' : 's'}
                  </span>
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded shrink-0">
                    {open.length} open
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded shrink-0">
                    {done.length} done
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2 pb-4 space-y-4 border-t border-gray-50 bg-gray-50/30">
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-800 px-3 pt-3 pb-1 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Unfulfilled & partial ({open.length})
                      </h3>
                      {renderRows(open, tag)}
                    </div>
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-800 px-3 pt-1 pb-1 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Fulfilled & restocked ({done.length})
                      </h3>
                      {renderRows(done, tag)}
                    </div>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ShopifyTagBundles;
