import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { UnifiedOrder } from '../types';
import {
  buildFulfillmentPickFromReport,
  buildFulfillmentPivotCsv,
  buildProductionPackReport,
  buildWorkRowsFromReport,
  collectAvailableTags,
  formatOrderHash,
  formatProductionPackItemMeta,
  isFulfillmentAllocationDone,
  isFulfillmentBundleDone,
  isPackRowFullyDone,
  loadProductionPackDoneIds,
  loadProductionPackBasketSelection,
  loadProductionPackMode,
  productionPackDoneStorageKeyForMode,
  resolveActivePackReport,
  saveProductionPackBasketSelection,
  saveProductionPackDoneIds,
  saveProductionPackMode,
  type ClubBatchBasket,
  type FulfillmentPickAllocation,
  type FulfillmentPickBundle,
  type ProductionPackBasketSelection,
  type ProductionPackMode,
  type ProductionPackReport,
  type ProductionPackWorkRow,
} from '../utils/clubProductionPack';
import {
  openClubProductionPackPrint,
  openFulfillmentPickPrint,
} from '../utils/printClubProductionPack';
import {
  Package,
  Calendar,
  Printer,
  Table2,
  ListOrdered,
  ChevronDown,
  Search,
  Truck,
  Sparkles,
  FileSpreadsheet,
  Inbox,
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
  const [packMode, setPackMode] = useState<ProductionPackMode>(() => loadProductionPackMode());
  const [basketSelection, setBasketSelection] = useState<ProductionPackBasketSelection>(() =>
    loadProductionPackBasketSelection()
  );
  const [view, setView] = useState<'pivot' | 'orders'>('pivot');
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const setPackModePersisted = useCallback((mode: ProductionPackMode) => {
    setPackMode(mode);
    saveProductionPackMode(mode);
  }, []);

  const setBasketSelectionPersisted = useCallback((sel: ProductionPackBasketSelection) => {
    setBasketSelection(sel);
    saveProductionPackBasketSelection(sel);
  }, []);

  const filteredTagOptions = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return availableTags;
    return availableTags.filter(t => t.toLowerCase().includes(q));
  }, [availableTags, tagQuery]);

  const fullReport: ProductionPackReport | null = useMemo(() => {
    if (!tag.trim()) return null;
    return buildProductionPackReport(orders, {
      tag: tag.trim(),
      dateFrom,
      dateTo,
      unfulfilledOnly: true,
    });
  }, [orders, tag, dateFrom, dateTo]);

  useEffect(() => {
    if (!fullReport) return;
    if (
      basketSelection !== 'standard' &&
      !fullReport.batchBaskets.some(b => b.basketKey === basketSelection)
    ) {
      setBasketSelectionPersisted('standard');
    }
  }, [fullReport, basketSelection, setBasketSelectionPersisted]);

  const activeBasket: ClubBatchBasket | null = useMemo(() => {
    if (!fullReport || basketSelection === 'standard') return null;
    return fullReport.batchBaskets.find(b => b.basketKey === basketSelection) ?? null;
  }, [fullReport, basketSelection]);

  const report: ProductionPackReport | null = useMemo(
    () => (fullReport ? resolveActivePackReport(fullReport, basketSelection) : null),
    [fullReport, basketSelection]
  );

  const storageKey = useMemo(
    () =>
      report
        ? productionPackDoneStorageKeyForMode(report.filters, packMode, basketSelection)
        : '',
    [report, packMode, basketSelection]
  );

  const fulfilmentPick = useMemo(
    () => (report ? buildFulfillmentPickFromReport(report) : null),
    [report]
  );

  const { pivotRows, orderRows } = useMemo(
    () => (report ? buildWorkRowsFromReport(report) : { pivotRows: [], orderRows: [] }),
    [report]
  );

  const ordersForView = useMemo(() => {
    if (!report) return [];
    if (packMode === 'fulfilment' && fulfilmentPick) {
      return fulfilmentPick.ordersOldestFirst;
    }
    return report.orders;
  }, [report, packMode, fulfilmentPick]);

  useEffect(() => {
    if (!storageKey) return;
    setDoneIds(loadProductionPackDoneIds(storageKey));
  }, [storageKey]);

  const toggleRowDone = useCallback(
    (id: string) => {
      if (!storageKey) return;
      setDoneIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveProductionPackDoneIds(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const toggleChipDone = useCallback(
    (chipId: string, copyValue: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!storageKey) return;

      setDoneIds(prev => {
        const next = new Set(prev);
        if (next.has(chipId)) {
          next.delete(chipId);
          saveProductionPackDoneIds(storageKey, next);
          setCopyHint('Unmarked');
          window.setTimeout(() => setCopyHint(null), 1200);
          return next;
        }
        next.add(chipId);
        saveProductionPackDoneIds(storageKey, next);
        const showCopied = () => {
          setCopyHint(copyValue);
          window.setTimeout(() => setCopyHint(null), 1400);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(copyValue).then(showCopied).catch(showCopied);
        } else {
          showCopied();
        }
        return next;
      });
    },
    [storageKey]
  );

  const chipProgress = useMemo(() => {
    let total = 0;
    let done = 0;
    if (packMode === 'fulfilment' && fulfilmentPick) {
      for (const b of fulfilmentPick.bundles) {
        for (const a of b.allocations) {
          if (a.personalizationChips.length === 0) {
            total += 1;
            if (doneIds.has(a.id)) done += 1;
          } else {
            for (const c of a.personalizationChips) {
              total += 1;
              if (doneIds.has(c.id)) done += 1;
            }
          }
        }
      }
      return { total, done };
    }
    for (const row of pivotRows) {
      if (row.personalizationChips.length === 0) {
        total += 1;
        if (doneIds.has(row.id) || doneIds.has(`${row.id}:plain`)) done += 1;
      } else {
        for (const c of row.personalizationChips) {
          total += 1;
          if (doneIds.has(c.id)) done += 1;
        }
      }
    }
    return { total, done };
  }, [pivotRows, doneIds, packMode, fulfilmentPick]);

  const handlePrint = useCallback(() => {
    if (!report || report.stats.lineCount === 0) return;
    if (packMode === 'fulfilment') openFulfillmentPickPrint(report);
    else openClubProductionPackPrint(report);
  }, [report, packMode]);

  const handleExportPivotCsv = useCallback(() => {
    if (!report?.lines.length) return;
    const csv = buildFulfillmentPivotCsv(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fulfilment-pivot-${tag.replace(/[^a-z0-9]+/gi, '-')}-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, tag, dateFrom, dateTo]);

  const handleExportCsv = useCallback(() => {
    if (!report?.lines.length) return;
    const header = [
      'Order',
      'Customer',
      'Email',
      'Date',
      'Item name',
      'Line name',
      'SKU',
      'Vendor',
      'Colour',
      'Size',
      'Qty',
      'Personalisation',
    ];
    const rows = report.lines.map(l => {
      const pers =
        l.personalizationValues.join(' ') ||
        l.personalizationLabel ||
        '';
      return [
        l.orderNumber,
        l.customerName,
        l.email,
        fmtDate(l.orderDate),
        l.itemName,
        l.lineName,
        l.sku,
        l.vendor,
        l.colorLabel,
        l.sizeLabel,
        String(l.quantity),
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
                Pick a Shopify tag and date range. Excludes refunded orders and refunded lines.
                {packMode === 'personalised'
                  ? ' Personalised mode: qty by product with initials/names. '
                  : ' Fulfilment mode: product pick list with order # under each line (like Excel pivot). '}
                Click to mark done; personalisation click copies. Syncs with interactive pack.
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
              <Printer className="w-3.5 h-3.5" /> Interactive pack
            </button>
            {packMode === 'fulfilment' && (
              <button
                type="button"
                disabled={!report?.stats.lineCount}
                onClick={handleExportPivotCsv}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-200 bg-teal-50 text-[10px] font-black uppercase tracking-widest text-teal-800 hover:border-teal-300 disabled:opacity-40"
                title="Excel pivot: Row Labels + Sum of Lineitem quantity"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Pivot CSV
              </button>
            )}
            <button
              type="button"
              disabled={!report?.stats.lineCount}
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-[10px] font-black uppercase tracking-widest text-gray-600 hover:border-gray-300 disabled:opacity-40"
            >
              Export lines CSV
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2 bg-white">
          <ModeButton
            active={packMode === 'personalised'}
            onClick={() => setPackModePersisted('personalised')}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label="Personalised pick"
            hint="Wendy — qty & initials"
          />
          <ModeButton
            active={packMode === 'fulfilment'}
            onClick={() => setPackModePersisted('fulfilment')}
            icon={<Truck className="w-3.5 h-3.5" />}
            label="Fulfilment pick"
            hint="Lucian — order # per unit"
          />
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

        {fullReport && fullReport.batchBaskets.length > 0 && (
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/80">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-900 flex items-center gap-1.5">
              <Inbox className="w-3.5 h-3.5" />
              Batch jobs (Shopify note · on Deco · not fully done)
            </p>
            <p className="text-[10px] text-amber-800/90 mt-1 max-w-3xl">
              Orders with a club batch note are in a separate basket from the standard pick.
              Fulfilled Shopify orders stay listed until the Deco job is complete.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <BasketChip
                active={basketSelection === 'standard'}
                onClick={() => setBasketSelectionPersisted('standard')}
                label="Standard pick"
                detail="No batch note"
              />
              {fullReport.batchBaskets.map(b => (
                <BasketChip
                  key={b.basketKey}
                  active={basketSelection === b.basketKey}
                  onClick={() => setBasketSelectionPersisted(b.basketKey)}
                  label={`Deco #${b.parsed.decoJobNumber}`}
                  detail={b.parsed.raw}
                  linked={b.linkedToDeco}
                  units={b.report.stats.totalUnits}
                />
              ))}
            </div>
          </div>
        )}

        {report && (
          <>
            <div className="px-4 py-3 bg-slate-50 border-b border-gray-100 flex flex-wrap gap-3">
              <Stat label="Orders" value={report.stats.orderCount} />
              <Stat label="Lines" value={report.stats.lineCount} />
              <Stat label="Units" value={report.stats.totalUnits} highlight />
              <Stat label="Products" value={report.stats.productCount} />
            </div>
            {activeBasket && (
              <p className="px-4 py-2 text-[11px] font-bold text-amber-900 bg-amber-50 border-b border-amber-100">
                {activeBasket.parsed.raw}
                {activeBasket.linkedToDeco ? (
                  <span className="ml-2 text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                    · On Deco
                  </span>
                ) : (
                  <span className="ml-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    · Note only
                  </span>
                )}
              </p>
            )}
            {packMode === 'fulfilment' && fulfilmentPick && fulfilmentPick.batch.maxOrderNumeric > 0 && (
              <p className="px-4 py-2 text-[11px] font-bold text-teal-900 bg-teal-50 border-b border-teal-100">
                {fulfilmentPick.batch.pivotTitle}
              </p>
            )}
          </>
        )}

        {!tag && (
          <p className="p-8 text-center text-[11px] font-bold text-gray-400 uppercase tracking-widest">
            Choose a tag to build the pack
          </p>
        )}

        {tag && fullReport && report && report.stats.lineCount === 0 && (
          <p className="p-8 text-center text-[11px] font-bold text-amber-700 uppercase tracking-widest max-w-lg mx-auto">
            {basketSelection === 'standard' && fullReport.batchBaskets.length > 0
              ? 'No standard unfulfilled lines — select a batch job above'
              : 'No remaining pick lines in this basket'}
          </p>
        )}

        {copyHint && (
          <p className="px-4 py-2 text-[10px] font-bold text-emerald-800 bg-emerald-50 border-b border-emerald-100">
            Copied: {copyHint}
          </p>
        )}

        {report && (report.stats.lineCount > 0 || report.orders.length > 0) && (
          <>
            <div className="px-4 py-2 text-[10px] text-gray-600 border-b border-gray-100 bg-white">
              <span className="font-bold text-violet-800">
                {chipProgress.done} / {chipProgress.total}
              </span>{' '}
              {packMode === 'fulfilment' ? 'units' : 'fields'} done · click to copy & mark (row green when all done)
            </div>
            <div className="px-4 pt-3 flex gap-2 border-b border-gray-100">
              <TabButton
                active={view === 'pivot'}
                onClick={() => setView('pivot')}
                icon={<Table2 className="w-3.5 h-3.5" />}
                label={
                  packMode === 'fulfilment' ? 'Pick by product' : 'Quantity by product'
                }
              />
              <TabButton
                active={view === 'orders'}
                onClick={() => setView('orders')}
                icon={<ListOrdered className="w-3.5 h-3.5" />}
                label={
                  packMode === 'fulfilment'
                    ? 'Orders (oldest first)'
                    : 'Orders & personalisation'
                }
              />
            </div>

            {view === 'pivot' ? (
              packMode === 'fulfilment' && fulfilmentPick ? (
                <div className="overflow-x-auto max-h-[70vh]">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="sticky top-0 z-[1] bg-teal-50 border-b border-teal-200">
                      <tr className="text-[9px] font-black uppercase tracking-widest text-teal-800">
                        <th className="px-3 py-2 w-10">#</th>
                        <th className="px-3 py-2">Row labels</th>
                        <th className="px-3 py-2 w-16 text-center">Size</th>
                        <th className="px-3 py-2 w-14 text-center">Qty</th>
                        <th className="px-3 py-2 min-w-[180px]">Order / detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fulfilmentPick.bundles.map((bundle, i) => (
                        <FulfilmentBundleRows
                          key={bundle.lineName}
                          bundle={bundle}
                          index={i}
                          doneIds={doneIds}
                          onToggleAllocation={toggleRowDone}
                          onChipToggle={toggleChipDone}
                        />
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-2 text-right font-black uppercase text-[9px] tracking-widest text-gray-500"
                        >
                          Grand total
                        </td>
                        <td className="px-3 py-2 text-center font-black text-lg tabular-nums">
                          {report.stats.totalUnits}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[70vh]">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="sticky top-0 z-[1] bg-gray-50 border-b border-gray-200">
                      <tr className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                        <th className="px-3 py-2 w-10">#</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 w-16 text-center">Size</th>
                        <th className="px-3 py-2 w-12 text-center">Qty</th>
                        <th className="px-3 py-2 min-w-[200px]">Personalisation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pivotRows.map((row, i) => (
                        <PackWorkRow
                          key={row.id}
                          row={row}
                          index={i}
                          doneIds={doneIds}
                          onToggleRow={toggleRowDone}
                          onChipToggle={toggleChipDone}
                        />
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-2 text-right font-black uppercase text-[9px] tracking-widest text-gray-500"
                        >
                          Total units
                        </td>
                        <td className="px-3 py-2 text-center font-black text-lg tabular-nums">
                          {report.stats.totalUnits}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            ) : (
              <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                {ordersForView.map(o => (
                  <article
                    key={o.orderNumber}
                    className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm"
                  >
                    <header className="px-3 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-gray-100 flex flex-wrap justify-between gap-2">
                      <div>
                        <span className="font-black text-gray-900">#{o.orderNumber}</span>
                        <span className="text-gray-500 font-medium ml-2">{o.customerName}</span>
                        {o.shopifyFulfillment && (
                          <span
                            className={`ml-2 text-[9px] font-black uppercase tracking-wider ${
                              o.shopifyFulfillment === 'fulfilled'
                                ? 'text-gray-400'
                                : 'text-amber-700'
                            }`}
                          >
                            {o.shopifyFulfillment}
                          </span>
                        )}
                        {o.email && (
                          <span className="block text-[10px] text-gray-400 truncate max-w-md">
                            {o.email}
                          </span>
                        )}
                        {o.batchNote && o.totalUnits === 0 && (
                          <span className="block text-[10px] text-amber-700 font-bold mt-1">
                            No pick lines left — batch job still open
                          </span>
                        )}
                      </div>
                      <div className="text-right text-[10px] text-gray-500 font-bold">
                        <span>{fmtDate(o.orderDate)}</span>
                        <span className="block text-violet-700 font-black">
                          {o.totalUnits} unit{o.totalUnits === 1 ? '' : 's'}
                        </span>
                        {o.decoJobNumber && (
                          <span className="block text-[9px] text-emerald-700 font-black mt-0.5">
                            Deco #{o.decoJobNumber}
                          </span>
                        )}
                      </div>
                    </header>
                    <table className="min-w-full text-[11px]">
                      <thead>
                        <tr className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-gray-50/80">
                          <th className="px-3 py-1.5 text-left">Item</th>
                          <th className="px-3 py-1.5 text-center">Size</th>
                          <th className="px-3 py-1.5 text-center">Qty</th>
                          <th className="px-3 py-1.5 text-left">Personalisation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {orderRows
                          .filter(r => r.orderNumber === o.orderNumber)
                          .map((row, idx) => (
                            <PackWorkRow
                              key={row.id}
                              row={row}
                              index={idx}
                              doneIds={doneIds}
                              onToggleRow={toggleRowDone}
                              onChipToggle={toggleChipDone}
                              compact
                            />
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

function PackWorkRow({
  row,
  index,
  doneIds,
  onToggleRow,
  onChipToggle,
  compact,
}: {
  row: ProductionPackWorkRow;
  index: number;
  doneIds: Set<string>;
  onToggleRow: (id: string) => void;
  onChipToggle: (chipId: string, copyValue: string, e?: React.MouseEvent) => void;
  compact?: boolean;
}) {
  const py = compact ? 'py-2' : 'py-3';
  const rowDone = isPackRowFullyDone(row, doneIds);
  const chips = row.personalizationChips;
  const plainStock = chips.length === 0 && !row.personalization.trim();

  return (
    <tr
      onClick={plainStock ? () => onToggleRow(row.id) : undefined}
      title={
        plainStock
          ? 'Click row to mark done'
          : 'Click to copy & mark — click again to unmark — row green when all done'
      }
      className={`align-top transition-colors ${
        rowDone
          ? 'bg-emerald-100 hover:bg-emerald-100'
          : plainStock
            ? 'cursor-pointer hover:bg-violet-50/40'
            : 'hover:bg-violet-50/20'
      }`}
    >
      {!compact && <td className={`px-3 ${py} text-gray-400 font-mono`}>{index + 1}</td>}
      <td className={`px-3 ${py} max-w-lg min-w-[240px]`}>
        {row.itemName !== formatProductionPackItemMeta(row) && (
          <div className="text-[15px] font-bold text-gray-900 leading-snug mb-1">
            {row.itemName}
          </div>
        )}
        <div className="text-[15px] font-black text-gray-900 leading-snug">
          {formatProductionPackItemMeta(row)}
        </div>
      </td>
      <td className={`px-3 ${py} text-center`}>
        {row.sizeLabel ? (
          <span className="text-[15px] font-black text-violet-900 tabular-nums">{row.sizeLabel}</span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className={`px-3 ${py} text-center`}>
        <span className="inline-block min-w-[2rem] px-2.5 py-1 rounded-lg bg-violet-600 text-white font-black text-[13px] tabular-nums">
          {row.quantity}
        </span>
      </td>
      <td className={`px-3 ${py}`}>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => {
              const chipDone = doneIds.has(chip.id);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={e => onChipToggle(chip.id, chip.value, e)}
                  title={
                    chipDone
                      ? `Click to unmark ${chip.label.toLowerCase()}`
                      : `Click to copy ${chip.label.toLowerCase()}`
                  }
                  className={`inline-flex flex-col items-start max-w-[200px] px-2 py-1 rounded-md border text-left transition-colors ${
                    chipDone
                      ? 'bg-emerald-200 border-emerald-400 text-emerald-950 ring-2 ring-emerald-400/60'
                      : 'bg-violet-100 border-violet-200 text-violet-900 hover:bg-violet-200'
                  }`}
                >
                  <span className="text-[8px] font-black uppercase tracking-widest opacity-80">
                    {chip.label}
                  </span>
                  <span className="font-black text-[12px] leading-tight">{chip.value}</span>
                </button>
              );
            })}
          </div>
        ) : row.personalization.trim() ? (
          <button
            type="button"
            onClick={e => onChipToggle(`${row.id}:plain`, row.personalization, e)}
            className={`inline-flex flex-col items-start px-2 py-1 rounded-md border text-left ${
              doneIds.has(`${row.id}:plain`)
                ? 'bg-emerald-200 border-emerald-400 text-emerald-950'
                : 'bg-violet-100 border-violet-200 text-violet-900'
            }`}
          >
            <span className="text-[8px] font-black uppercase tracking-widest">Text</span>
            <span className="font-black text-[12px]">{row.personalization}</span>
          </button>
        ) : (
          <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
            Plain stock
          </span>
        )}
      </td>
    </tr>
  );
}

function BasketChip({
  active,
  onClick,
  label,
  detail,
  linked,
  units,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
  linked?: boolean;
  units?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={detail}
      className={`max-w-xs text-left px-3 py-2 rounded-lg border transition-colors ${
        active
          ? 'bg-amber-100 border-amber-400 ring-1 ring-amber-400/60'
          : 'bg-white border-amber-200 hover:border-amber-300'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-amber-950">
          {label}
        </span>
        {linked && (
          <span className="text-[8px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
            Deco
          </span>
        )}
        {units != null && (
          <span className="text-[9px] font-black tabular-nums text-amber-800">{units}u</span>
        )}
      </span>
      <span className="block text-[9px] text-amber-900/80 mt-1 line-clamp-2">{detail}</span>
    </button>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${
        active
          ? 'bg-teal-50 border-teal-300 ring-1 ring-teal-400/50'
          : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${
          active ? 'text-teal-900' : 'text-gray-600'
        }`}
      >
        {icon}
        {label}
      </span>
      <span className="text-[9px] font-medium text-gray-500 mt-0.5">{hint}</span>
    </button>
  );
}

function FulfilmentBundleRows({
  bundle,
  index,
  doneIds,
  onToggleAllocation,
  onChipToggle,
}: {
  bundle: FulfillmentPickBundle;
  index: number;
  doneIds: Set<string>;
  onToggleAllocation: (id: string) => void;
  onChipToggle: (chipId: string, copyValue: string, e?: React.MouseEvent) => void;
}) {
  const bundleDone = isFulfillmentBundleDone(bundle, doneIds);
  const meta = formatProductionPackItemMeta(bundle);

  return (
    <>
      <tr
        className={`border-t border-gray-200 ${
          bundleDone ? 'bg-emerald-50' : 'bg-teal-50/60'
        }`}
      >
        <td className="px-3 py-3 text-gray-400 font-mono align-top">{index + 1}</td>
        <td className="px-3 py-3 max-w-lg min-w-[240px] align-top">
          {bundle.itemName !== meta && (
            <div className="text-[15px] font-bold text-gray-900 leading-snug mb-1">
              {bundle.itemName}
            </div>
          )}
          <div className="text-[15px] font-black text-gray-900 leading-snug">{meta}</div>
        </td>
        <td className="px-3 py-3 text-center align-top">
          {bundle.sizeLabel ? (
            <span className="text-[15px] font-black text-teal-900 tabular-nums">
              {bundle.sizeLabel}
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-center align-top">
          <span className="inline-block min-w-[2rem] px-2.5 py-1 rounded-lg bg-teal-700 text-white font-black text-[13px] tabular-nums">
            {bundle.totalQuantity}
          </span>
        </td>
        <td className="px-3 py-3 text-[10px] font-bold text-teal-800 uppercase tracking-wider align-top">
          Pick by order ↓
        </td>
      </tr>
      {bundle.allocations.map(allocation => (
        <FulfilmentAllocationRow
          key={allocation.id}
          allocation={allocation}
          doneIds={doneIds}
          onToggleAllocation={onToggleAllocation}
          onChipToggle={onChipToggle}
        />
      ))}
    </>
  );
}

function FulfilmentAllocationRow({
  allocation,
  doneIds,
  onToggleAllocation,
  onChipToggle,
}: {
  allocation: FulfillmentPickAllocation;
  doneIds: Set<string>;
  onToggleAllocation: (id: string) => void;
  onChipToggle: (chipId: string, copyValue: string, e?: React.MouseEvent) => void;
}) {
  const rowDone = isFulfillmentAllocationDone(allocation, doneIds);
  const chips = allocation.personalizationChips;
  const plainStock = chips.length === 0;

  return (
    <tr
      onClick={plainStock ? () => onToggleAllocation(allocation.id) : undefined}
      className={`border-b border-gray-50 align-top transition-colors ${
        rowDone
          ? 'bg-emerald-100'
          : plainStock
            ? 'cursor-pointer hover:bg-teal-50/50 bg-white'
            : 'bg-white hover:bg-teal-50/30'
      }`}
    >
      <td className="px-3 py-2" />
      <td className="px-3 py-2 pl-8" colSpan={2}>
        <span className="text-[14px] font-black text-teal-900">
          {formatOrderHash(allocation.orderNumber)}
        </span>
        <span className="text-gray-500 font-medium ml-2 text-[11px]">
          {allocation.customerName}
        </span>
        <span className="block text-[10px] text-gray-400">{fmtDate(allocation.orderDate)}</span>
      </td>
      <td className="px-3 py-2 text-center">
        <span className="text-[12px] font-black tabular-nums text-gray-700">1</span>
      </td>
      <td className="px-3 py-2">
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => {
              const chipDone = doneIds.has(chip.id);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={e => onChipToggle(chip.id, chip.value, e)}
                  className={`inline-flex flex-col items-start max-w-[200px] px-2 py-1 rounded-md border text-left ${
                    chipDone
                      ? 'bg-emerald-200 border-emerald-400 text-emerald-950'
                      : 'bg-teal-100 border-teal-200 text-teal-900 hover:bg-teal-200'
                  }`}
                >
                  <span className="text-[8px] font-black uppercase tracking-widest opacity-80">
                    {chip.label}
                  </span>
                  <span className="font-black text-[12px] leading-tight">{chip.value}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-gray-300 text-[10px]">—</span>
        )}
      </td>
    </tr>
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
