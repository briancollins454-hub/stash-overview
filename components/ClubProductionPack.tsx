import React, { useMemo, useState, useCallback } from 'react';
import type { UnifiedOrder } from '../types';
import {
  buildProductionPackReport,
  collectAvailableTags,
  type ProductionPackReport,
} from '../utils/clubProductionPack';
import { openClubProductionPackPrint } from '../utils/printClubProductionPack';
import {
  Package,
  Calendar,
  Printer,
  Table2,
  ListOrdered,
  ChevronDown,
  Search,
} from 'lucide-react';

export interface ClubProductionPackProps {
  orders: UnifiedOrder[];
  excludedTags: string[];
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const ClubProductionPack: React.FC<ClubProductionPackProps> = ({ orders, excludedTags }) => {
  const availableTags = useMemo(
    () => collectAvailableTags(orders, excludedTags),
    [orders, excludedTags]
  );

  const [tag, setTag] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [dateFrom, setDateFrom] = useState(ymdDaysAgo(30));
  const [dateTo, setDateTo] = useState(todayYmd());
  const [view, setView] = useState<'pivot' | 'orders'>('pivot');

  const filteredTagOptions = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return availableTags;
    return availableTags.filter(t => t.toLowerCase().includes(q));
  }, [availableTags, tagQuery]);

  const report: ProductionPackReport | null = useMemo(() => {
    if (!tag.trim()) return null;
    return buildProductionPackReport(orders, {
      tag: tag.trim(),
      dateFrom,
      dateTo,
      unfulfilledOnly: true,
    });
  }, [orders, tag, dateFrom, dateTo]);

  const handlePrint = useCallback(() => {
    if (!report || report.stats.lineCount === 0) return;
    openClubProductionPackPrint(report);
  }, [report]);

  const handleExportCsv = useCallback(() => {
    if (!report?.lines.length) return;
    const header = ['Order', 'Customer', 'Email', 'Date', 'Product', 'Qty', 'SKU', 'Personalisation'];
    const rows = report.lines.map(l => {
      const pers =
        l.displayProperties.map(p => `${p.name}: ${p.value}`).join('; ') ||
        l.pivotPersonalization ||
        '';
      return [
        l.orderNumber,
        l.customerName,
        l.email,
        fmtDate(l.orderDate),
        l.lineName,
        String(l.quantity),
        l.sku,
        pers,
      ];
    });
    const esc = (v: string) => {
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `production-pack-${tag.replace(/[^a-z0-9]+/gi, '-')}-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, tag, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-violet-50/90 to-white flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-2">
            <div className="p-2 rounded-lg bg-violet-100 text-violet-700">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-900">
                Club production pack
              </h2>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5 max-w-xl">
                Replaces the Excel export + pivot: pick a Shopify tag and date range, get quantity
                totals by product &amp; personalisation, plus per-order detail for Deco entry.
                Unfulfilled orders only.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!report?.stats.lineCount}
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </button>
            <button
              type="button"
              disabled={!report?.stats.lineCount}
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-[10px] font-black uppercase tracking-widest text-gray-600 hover:border-gray-300 disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 border-b border-gray-100">
          <label className="block sm:col-span-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Shopify tag
            </span>
            <div className="relative mt-1">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={tagQuery || tag}
                onChange={e => {
                  const v = e.target.value;
                  setTagQuery(v);
                  const exact = availableTags.find(
                    t => t.toLowerCase() === v.trim().toLowerCase()
                  );
                  setTag(exact || '');
                }}
                onFocus={() => {
                  if (tag && !tagQuery) setTagQuery(tag);
                }}
                onBlur={() => {
                  const v = tagQuery.trim();
                  if (!v) return;
                  const exact = availableTags.find(
                    t => t.toLowerCase() === v.toLowerCase()
                  );
                  if (exact) {
                    setTag(exact);
                    setTagQuery('');
                  }
                }}
                placeholder="e.g. Haileybury Leavers"
                className="w-full pl-8 pr-8 py-2 rounded-lg border border-gray-200 text-[12px] font-bold focus:ring-1 focus:ring-violet-500 outline-none"
                list="production-pack-tags"
              />
              <datalist id="production-pack-tags">
                {filteredTagOptions.slice(0, 80).map(t => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <select
              value={tag}
              onChange={e => {
                setTag(e.target.value);
                setTagQuery('');
              }}
              className="mt-1 w-full text-[11px] font-bold border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50"
            >
              <option value="">Select tag…</option>
              {filteredTagOptions.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> From
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="mt-1 w-full py-2 px-2 rounded-lg border border-gray-200 text-[12px] font-bold"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> To
            </span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="mt-1 w-full py-2 px-2 rounded-lg border border-gray-200 text-[12px] font-bold"
            />
          </label>
        </div>

        {report && (
          <div className="px-4 py-3 bg-slate-50 border-b border-gray-100 flex flex-wrap gap-3">
            <Stat label="Orders" value={report.stats.orderCount} />
            <Stat label="Lines" value={report.stats.lineCount} />
            <Stat label="Units" value={report.stats.totalUnits} highlight />
            <Stat label="Pivot rows" value={report.stats.pivotRowCount} />
          </div>
        )}

        {!tag && (
          <p className="p-8 text-center text-[11px] font-bold text-gray-400 uppercase tracking-widest">
            Choose a tag to build the pack
          </p>
        )}

        {tag && report && report.stats.lineCount === 0 && (
          <p className="p-8 text-center text-[11px] font-bold text-amber-700 uppercase tracking-widest">
            No unfulfilled lines for this tag and date range
          </p>
        )}

        {report && report.stats.lineCount > 0 && (
          <>
            <div className="px-4 pt-3 flex gap-2 border-b border-gray-100">
              <TabButton
                active={view === 'pivot'}
                onClick={() => setView('pivot')}
                icon={<Table2 className="w-3.5 h-3.5" />}
                label="Quantity pivot"
              />
              <TabButton
                active={view === 'orders'}
                onClick={() => setView('orders')}
                icon={<ListOrdered className="w-3.5 h-3.5" />}
                label="Orders & personalisation"
              />
            </div>

            {view === 'pivot' ? (
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="sticky top-0 z-[1] bg-gray-50 border-b border-gray-200">
                    <tr className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                      <th className="px-3 py-2 w-10">#</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 w-28">Personalisation</th>
                      <th className="px-3 py-2 text-right w-16">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.pivot.map((row, i) => (
                      <tr key={`${row.lineName}-${row.personalization}`} className="hover:bg-violet-50/30">
                        <td className="px-3 py-2 text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-gray-900">{row.lineName}</td>
                        <td className="px-3 py-2">
                          {row.personalization ? (
                            <span className="inline-block px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 font-black text-[12px]">
                              {row.personalization}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-black text-gray-900 tabular-nums">
                          {row.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right font-black uppercase text-[9px] tracking-widest text-gray-500">
                        Total units
                      </td>
                      <td className="px-3 py-2 text-right font-black text-lg tabular-nums">
                        {report.stats.totalUnits}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                {report.orders.map(o => (
                  <article
                    key={o.orderNumber}
                    className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm"
                  >
                    <header className="px-3 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-gray-100 flex flex-wrap justify-between gap-2">
                      <div>
                        <span className="font-black text-gray-900">#{o.orderNumber}</span>
                        <span className="text-gray-500 font-medium ml-2">{o.customerName}</span>
                        {o.email && (
                          <span className="block text-[10px] text-gray-400 truncate max-w-md">
                            {o.email}
                          </span>
                        )}
                      </div>
                      <div className="text-right text-[10px] text-gray-500 font-bold">
                        <span>{fmtDate(o.orderDate)}</span>
                        <span className="block text-violet-700 font-black">
                          {o.totalUnits} unit{o.totalUnits === 1 ? '' : 's'}
                        </span>
                      </div>
                    </header>
                    <table className="min-w-full text-[11px]">
                      <tbody className="divide-y divide-gray-50">
                        {o.lines.map((line, idx) => (
                          <tr key={`${line.orderId}-${idx}`}>
                            <td className="px-3 py-2 font-medium text-gray-800 w-[45%]">
                              {line.lineName}
                            </td>
                            <td className="px-3 py-2 text-center font-black tabular-nums w-12">
                              {line.quantity}
                            </td>
                            <td className="px-3 py-2">
                              {line.displayProperties.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {line.displayProperties.map(p => (
                                    <span
                                      key={p.name}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-[10px]"
                                    >
                                      <span className="font-black text-violet-800">{p.name}:</span>
                                      <span className="font-bold text-gray-800">{p.value}</span>
                                    </span>
                                  ))}
                                </div>
                              ) : line.pivotPersonalization ? (
                                <span className="px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 font-black">
                                  {line.pivotPersonalization}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-[10px]">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 border ${
        highlight ? 'bg-violet-100 border-violet-200' : 'bg-white border-gray-200'
      }`}
    >
      <span className="block text-[8px] font-black uppercase tracking-widest text-gray-500">
        {label}
      </span>
      <strong className={`text-lg tabular-nums ${highlight ? 'text-violet-900' : 'text-gray-900'}`}>
        {value}
      </strong>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-[10px] font-black uppercase tracking-widest border border-b-0 transition-colors ${
        active
          ? 'bg-white border-gray-200 text-violet-700'
          : 'bg-gray-50 border-transparent text-gray-400 hover:text-gray-600'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default ClubProductionPack;
