import React, { useMemo, useState } from 'react';
import { ArrowDownAZ, ArrowDown01, ArrowUp01, Package, Search, Trash2, Undo2 } from 'lucide-react';
import type { ReferenceDriftRow, StockTakeLineView } from '../../services/stockTakeService';

type SortMode = 'recent' | 'alpha' | 'qty_desc' | 'variance_desc';

interface Props {
  lines: StockTakeLineView[];
  bookByKey: Map<string, number>;
  lastKey: string | null;
  isReadOnly: boolean;
  drift: ReferenceDriftRow[];
  onSetQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onApplyDrift: (lineId: string) => void;
  onIgnoreDrift: (lineId: string) => void;
  onUndoLastScan?: () => void;
  canUndo?: boolean;
}

interface VariancePillProps {
  counted: number;
  book: number;
}

function VariancePill({ counted, book }: VariancePillProps) {
  if (book <= 0 && counted > 0) {
    return (
      <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-widest">
        not on book
      </span>
    );
  }
  const diff = counted - book;
  if (diff === 0) {
    return (
      <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-widest">
        match
      </span>
    );
  }
  const intensity = Math.abs(diff) / Math.max(book, 1);
  const isLarge = intensity > 0.1 || Math.abs(diff) >= 5;
  const isPos = diff > 0;
  const colourClass = isPos
    ? isLarge
      ? 'bg-amber-200 text-amber-900'
      : 'bg-amber-100 text-amber-800'
    : isLarge
      ? 'bg-red-600 text-white'
      : 'bg-red-100 text-red-700';
  return (
    <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${colourClass}`}>
      {diff > 0 ? `+${diff}` : diff} vs {book}
    </span>
  );
}

const LinesPanel: React.FC<Props> = ({
  lines,
  bookByKey,
  lastKey,
  isReadOnly,
  drift,
  onSetQty,
  onRemove,
  onApplyDrift,
  onIgnoreDrift,
  onUndoLastScan,
  canUndo = false,
}) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [showVendorGroups, setShowVendorGroups] = useState(false);

  const driftByLine = useMemo(() => {
    const m = new Map<string, ReferenceDriftRow>();
    for (const d of drift) m.set(d.lineId, d);
    return m;
  }, [drift]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? lines.filter(line => {
          const haystack = [line.ean, line.description, line.vendor, line.productCode, line.colour, line.size, line.clubName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(term);
        })
      : lines;

    const sorted = [...list];
    switch (sort) {
      case 'alpha':
        sorted.sort((a, b) => a.description.localeCompare(b.description) || a.ean.localeCompare(b.ean));
        break;
      case 'qty_desc':
        sorted.sort((a, b) => b.qty - a.qty);
        break;
      case 'variance_desc':
        sorted.sort((a, b) => {
          const va = Math.abs(a.qty - (bookByKey.get(a.stockKey) || 0));
          const vb = Math.abs(b.qty - (bookByKey.get(b.stockKey) || 0));
          return vb - va;
        });
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        break;
    }
    return sorted;
  }, [lines, search, sort, bookByKey]);

  const groups = useMemo(() => {
    if (!showVendorGroups) return null;
    const m = new Map<string, StockTakeLineView[]>();
    for (const line of filtered) {
      const v = (line.vendor || 'Unspecified vendor').trim() || 'Unspecified vendor';
      const arr = m.get(v) || [];
      arr.push(line);
      m.set(v, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, showVendorGroups]);

  const renderRow = (line: StockTakeLineView) => {
    const book = bookByKey.get(line.stockKey) ?? 0;
    const highlight = line.stockKey === lastKey;
    const driftRow = driftByLine.get(line.id);
    return (
      <li
        key={line.id}
        className={`px-4 py-3 flex flex-wrap items-center gap-3 ${highlight ? 'bg-indigo-50/80' : ''}`}
      >
        <div className="flex-1 min-w-[200px]">
          <p className="font-bold text-gray-900 text-sm leading-tight">
            {line.description}
            {line.isEmbellished && (
              <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[9px] font-black uppercase tracking-widest">
                Embellished{line.clubName ? ` · ${line.clubName}` : ''}
              </span>
            )}
          </p>
          <p className="text-[10px] font-mono text-indigo-600 mt-0.5">{line.ean}</p>
          {line.productCode && line.productCode !== line.ean && (
            <p className="text-[9px] font-mono text-gray-500">Style / SKU {line.productCode}</p>
          )}
          <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">
            {[line.colour, line.size, line.vendor].filter(Boolean).join(' · ') || '—'}
            {' · '}{line.resolvedVia}
          </p>
          {driftRow && (
            <div className="mt-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-900 flex items-center justify-between gap-2 flex-wrap">
              <span>
                <strong>Doesn't match book:</strong>{' '}
                {driftRow.fields.map(f => `${f.label}: "${f.scan}" ≠ "${f.reference}"`).join(' · ')}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onApplyDrift(line.id)}
                  className="px-2 py-1 rounded bg-amber-600 text-white text-[9px] font-black uppercase tracking-widest min-h-[32px]"
                >
                  Use scan
                </button>
                <button
                  type="button"
                  onClick={() => onIgnoreDrift(line.id)}
                  className="px-2 py-1 rounded border border-amber-300 text-amber-800 text-[9px] font-black uppercase tracking-widest min-h-[32px]"
                >
                  Ignore
                </button>
              </span>
            </div>
          )}
        </div>
        <VariancePill counted={line.qty} book={book} />
        {isReadOnly ? (
          <p className="text-lg font-black text-indigo-700 tabular-nums">{line.qty}</p>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSetQty(line.id, line.qty - 1)}
              className="w-11 h-11 rounded-lg border border-gray-200 font-black text-gray-700 text-lg hover:bg-gray-50 active:bg-gray-100"
              aria-label={`Subtract one from ${line.description}`}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={0}
              value={line.qty}
              onChange={e => onSetQty(line.id, parseInt(e.target.value, 10) || 0)}
              className="w-16 h-11 text-center font-black text-base border border-gray-200 rounded-lg"
            />
            <button
              type="button"
              onClick={() => onSetQty(line.id, line.qty + 1)}
              className="w-11 h-11 rounded-lg border border-gray-200 font-black text-gray-700 text-lg hover:bg-gray-50 active:bg-gray-100"
              aria-label={`Add one to ${line.description}`}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => onRemove(line.id)}
              className="w-11 h-11 rounded-lg text-gray-400 hover:text-red-600 flex items-center justify-center"
              title="Remove line"
              aria-label={`Remove ${line.description}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <Package className="w-3.5 h-3.5" /> {isReadOnly ? 'Counted lines (committed)' : 'Counted lines'}
          <span className="text-gray-400">· {lines.length}</span>
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {!isReadOnly && canUndo && (
            <button
              type="button"
              onClick={() => onUndoLastScan?.()}
              className="flex items-center gap-1 min-h-[36px] px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-black uppercase tracking-widest hover:bg-amber-100"
              title="Undo last scan"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo last
            </button>
          )}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1 min-h-[36px]">
            <Search className="w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search EAN, name, vendor…"
              className="text-xs font-bold outline-none bg-transparent w-40 sm:w-52"
            />
          </div>
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden text-[10px] font-black uppercase tracking-widest">
            {([
              { id: 'recent', label: 'Recent', icon: <ArrowDown01 className="w-3 h-3" /> },
              { id: 'variance_desc', label: 'Variance', icon: <ArrowUp01 className="w-3 h-3" /> },
              { id: 'qty_desc', label: 'Qty', icon: <ArrowUp01 className="w-3 h-3" /> },
              { id: 'alpha', label: 'A–Z', icon: <ArrowDownAZ className="w-3 h-3" /> },
            ] as const).map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSort(opt.id)}
                className={`min-h-[36px] px-2.5 flex items-center gap-1 ${
                  sort === opt.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowVendorGroups(v => !v)}
            className={`min-h-[36px] px-2.5 rounded-lg border text-[10px] font-black uppercase tracking-widest ${
              showVendorGroups
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Group by vendor
          </button>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-400 font-bold">
          {isReadOnly ? 'No lines were saved for this session.' : 'No scans yet — start scanning.'}
        </p>
      ) : groups ? (
        <div className="max-h-[55vh] overflow-y-auto divide-y divide-gray-100">
          {groups.map(([vendor, items]) => (
            <div key={vendor}>
              <p className="sticky top-0 bg-gray-100 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600 z-[1]">
                {vendor} · {items.length}
              </p>
              <ul className="divide-y divide-gray-50">{items.map(renderRow)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-gray-50 max-h-[55vh] overflow-y-auto">
          {filtered.map(renderRow)}
        </ul>
      )}
    </div>
  );
};

export default LinesPanel;
