import React, { useMemo, useState, useRef } from 'react';
import { UnifiedOrder } from '../types';
import { Printer, Package, ChevronDown, ChevronRight, Filter, CheckSquare, Square } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type GroupMode = 'method' | 'club' | 'date';

interface PrintLine {
  orderNumber: string;
  customer: string;
  itemName: string;
  sku: string;
  size: string;
  quantity: number;
  club: string;
  method: string;
  dueDate: string;
  jobId?: string;
  priority?: boolean;
}

function guessMethod(item: { name: string; sku: string; properties?: { name: string; value: string | number }[] }): string {
  const n = (item.name + ' ' + item.sku).toLowerCase();
  const props = (item.properties || []).map(p => `${p.name} ${p.value}`.toLowerCase()).join(' ');
  const all = n + ' ' + props;
  if (all.includes('embroider') || all.includes('embroid')) return 'Embroidery';
  if (all.includes('screen') || all.includes('silk')) return 'Screen Print';
  if (all.includes('dtf')) return 'DTF';
  if (all.includes('dtg') || all.includes('direct to garment')) return 'DTG';
  if (all.includes('vinyl') || all.includes('heat press') || all.includes('transfer')) return 'Heat Press';
  if (all.includes('sublim')) return 'Sublimation';
  if (all.includes('print') || all.includes('personalise') || all.includes('custom')) return 'Print (General)';
  return 'Stock / No Decoration';
}

const BatchPrintSheets: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [groupMode, setGroupMode] = useState<GroupMode>('method');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__all__']));
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const printRef = useRef<HTMLDivElement>(null);

  const lines = useMemo<PrintLine[]>(() => {
    return orders
      .filter(o => o.shopify.fulfillmentStatus !== 'fulfilled')
      .flatMap(o =>
        o.shopify.items
          .filter(i => i.itemStatus !== 'fulfilled')
          .map(i => ({
            orderNumber: o.shopify.orderNumber,
            customer: o.shopify.customerName,
            itemName: i.name,
            sku: i.sku || '',
            size: i.properties?.find(p => p.name.toLowerCase().includes('size'))?.value?.toString() || '',
            quantity: i.quantity - (i.fulfilledQuantity || 0),
            club: o.clubName || 'No Club',
            method: guessMethod(i),
            dueDate: o.productionDueDate || o.slaTargetDate || '',
            jobId: o.decoJobId,
            priority: (o.shopify.tags || []).some(t => t.toLowerCase().includes('rush') || t.toLowerCase().includes('urgent') || t.toLowerCase().includes('priority')),
          }))
      )
      .filter(l => l.quantity > 0)
      .sort((a, b) => {
        if (a.priority && !b.priority) return -1;
        if (!a.priority && b.priority) return 1;
        return a.dueDate.localeCompare(b.dueDate);
      });
  }, [orders]);

  const allMethods = useMemo(() => [...new Set(lines.map(l => l.method))].sort(), [lines]);

  // Initialize selectedMethods with all methods
  useState(() => { if (selectedMethods.size === 0 && allMethods.length > 0) setSelectedMethods(new Set(allMethods)); });

  const filteredLines = useMemo(() => {
    if (selectedMethods.size === 0) return lines;
    return lines.filter(l => selectedMethods.has(l.method));
  }, [lines, selectedMethods]);

  const grouped = useMemo(() => {
    const map = new Map<string, PrintLine[]>();
    filteredLines.forEach(l => {
      const key = groupMode === 'method' ? l.method : groupMode === 'club' ? l.club : (l.dueDate || 'No Date');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    });
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [filteredLines, groupMode]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpandedGroups(new Set([...grouped.keys()]));
  const collapseAll = () => setExpandedGroups(new Set());

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Print Sheets - ${new Date().toLocaleDateString('en-GB')}</title>
      <style>
        body { font-family: 'Arial', sans-serif; font-size: 11px; margin: 20px; }
        h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; page-break-after: avoid; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; page-break-inside: auto; }
        th { background: #f0f0f0; font-weight: bold; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
        tr { page-break-inside: avoid; }
        .rush { background: #fff3cd; font-weight: bold; }
        .rush::after { content: ' ⚡'; }
        .total { font-weight: bold; text-align: right; padding-right: 16px; font-size: 12px; margin-top: 4px; }
        @media print { .no-print { display: none; } }
      </style></head><body>`);
    grouped.forEach((items, group) => {
      const totalQty = items.reduce((s, i) => s + i.quantity, 0);
      win.document.write(`<h2>${group} (${items.length} lines, ${totalQty} units)</h2>`);
      win.document.write(`<table><thead><tr><th>Order</th><th>Customer</th><th>Item</th><th>SKU</th><th>Size</th><th>Qty</th><th>Job ID</th><th>Due</th><th>Done ✓</th></tr></thead><tbody>`);
      items.forEach(i => {
        win.document.write(`<tr class="${i.priority ? 'rush' : ''}"><td>#${i.orderNumber}</td><td>${i.customer}</td><td>${i.itemName}</td><td>${i.sku}</td><td>${i.size}</td><td>${i.quantity}</td><td>${i.jobId || '-'}</td><td>${i.dueDate ? new Date(i.dueDate).toLocaleDateString('en-GB') : '-'}</td><td style="width:40px"></td></tr>`);
      });
      win.document.write(`</tbody></table><p class="total">Total: ${totalQty} units</p>`);
    });
    win.document.write(`<p style="color:#999;font-size:9px;margin-top:20px;">Generated ${new Date().toLocaleString('en-GB')} — Stash Shop Sync</p></body></html>`);
    win.document.close();
    win.print();
  };

  const toggleMethod = (method: string) => {
    setSelectedMethods(prev => {
      const next = new Set(prev);
      next.has(method) ? next.delete(method) : next.add(method);
      return next;
    });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Printer className="w-4 h-4 text-indigo-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Batch Print Sheets</h3>
          <span className="text-[9px] font-bold text-gray-400">({filteredLines.length} lines, {filteredLines.reduce((s, l) => s + l.quantity, 0)} units)</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={groupMode} onChange={e => setGroupMode(e.target.value as GroupMode)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="method">By Method</option>
            <option value="club">By Club</option>
            <option value="date">By Due Date</option>
          </select>
          <button onClick={expandAll} className="text-[9px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest">Expand All</button>
          <button onClick={collapseAll} className="text-[9px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest">Collapse</button>
          <button onClick={handlePrint} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors flex items-center gap-1">
            <Printer className="w-3 h-3" /> Print
          </button>
        </div>
      </div>

      {/* Method filter bar */}
      <div className="px-4 py-2 border-b border-gray-50 flex items-center gap-2 flex-wrap">
        <Filter className="w-3 h-3 text-gray-400" />
        {allMethods.map(m => (
          <button key={m} onClick={() => toggleMethod(m)} className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest transition-all ${selectedMethods.has(m) ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'text-gray-400 border border-gray-200 hover:border-gray-300'}`}>
            {selectedMethods.has(m) ? <CheckSquare className="w-2.5 h-2.5" /> : <Square className="w-2.5 h-2.5" />} {m}
          </button>
        ))}
      </div>

      <div ref={printRef} className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
        {Array.from(grouped.entries()).map(([group, items]) => {
          const totalQty = items.reduce((s, i) => s + i.quantity, 0);
          const isExpanded = expandedGroups.has(group) || expandedGroups.has('__all__');
          return (
            <div key={group}>
              <button onClick={() => toggleGroup(group)} className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                  <span className="text-xs font-black text-gray-800 uppercase tracking-widest">{group}</span>
                  <span className="text-[9px] font-bold text-gray-400">{items.length} lines</span>
                </div>
                <span className="text-[10px] font-black text-indigo-600">{totalQty} units</span>
              </button>
              {isExpanded && (
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Order</th>
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Customer</th>
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Item</th>
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">SKU</th>
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Size</th>
                      <th className="px-4 py-1.5 text-center font-black uppercase tracking-widest text-gray-500">Qty</th>
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Job</th>
                      <th className="px-4 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={`${item.orderNumber}-${item.sku}-${idx}`} className={`border-t border-gray-50 hover:bg-gray-50 transition-colors ${item.priority ? 'bg-amber-50' : ''}`}>
                        <td className="px-4 py-1.5">
                          <button onClick={() => onNavigateToOrder?.(item.orderNumber)} className="font-black text-gray-800 hover:text-indigo-600 transition-colors">
                            #{item.orderNumber} {item.priority && <span className="text-amber-500" title="Rush">⚡</span>}
                          </button>
                        </td>
                        <td className="px-4 py-1.5 font-bold text-gray-600 truncate max-w-[120px]">{item.customer}</td>
                        <td className="px-4 py-1.5 font-bold text-gray-700 truncate max-w-[200px]">{item.itemName}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-500">{item.sku || '-'}</td>
                        <td className="px-4 py-1.5 font-bold text-gray-500">{item.size || '-'}</td>
                        <td className="px-4 py-1.5 text-center font-black text-gray-800">{item.quantity}</td>
                        <td className="px-4 py-1.5 font-mono text-indigo-500">{item.jobId || '-'}</td>
                        <td className="px-4 py-1.5 font-bold text-gray-500">{item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-GB') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {filteredLines.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2" />
            <p className="text-xs font-bold uppercase tracking-widest">No unfulfilled items to print</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BatchPrintSheets;
