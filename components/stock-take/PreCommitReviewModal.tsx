import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, X } from 'lucide-react';
import type { MissingLine, StockTakeLocation } from '../../services/stockTakeService';

interface Props {
  open: boolean;
  location: StockTakeLocation;
  locationLabel: string;
  totals: { skus: number; units: number };
  missing: MissingLine[];
  committing: boolean;
  onCancel: () => void;
  onConfirm: (opts: { zeroKeys: string[] }) => void;
}

/**
 * Reviews the count before commit so staff have to confront missing-from-count
 * items.  Each missing row gets two actions:
 *   • "Zero out"   → confirm the SKU is gone; commit will set qty to 0
 *   • "Skip"       → keep book qty unchanged (default)
 * Staff *must* tick through the list (or hit "Mark all skip") before the
 * commit button activates, which guarantees nothing is silently overlooked.
 */
const PreCommitReviewModal: React.FC<Props> = ({
  open,
  locationLabel,
  totals,
  missing,
  committing,
  onCancel,
  onConfirm,
}) => {
  const [decisions, setDecisions] = useState<Map<string, 'zero' | 'skip'>>(new Map());
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return missing;
    return missing.filter(m => {
      const haystack = [m.ean, m.description, m.vendor, m.productCode, m.colour, m.size]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [missing, search]);

  const decided = decisions.size;
  const allDecided = missing.length === 0 || decided >= missing.length;
  const zeroCount = useMemo(
    () => Array.from(decisions.values()).filter(v => v === 'zero').length,
    [decisions],
  );

  const setDecision = (key: string, decision: 'zero' | 'skip') => {
    setDecisions(prev => {
      const next = new Map(prev);
      next.set(key, decision);
      return next;
    });
  };

  const skipAll = () => {
    const next = new Map<string, 'zero' | 'skip'>();
    for (const m of missing) next.set(m.stockKey, 'skip');
    setDecisions(next);
  };

  const handleConfirm = () => {
    const zeroKeys: string[] = [];
    decisions.forEach((value, key) => {
      if (value === 'zero') zeroKeys.push(key);
    });
    onConfirm({ zeroKeys });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-2 sm:p-6" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <header className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Review &amp; commit</p>
            <h2 className="text-lg font-black text-gray-900 leading-tight">Confirm count for {locationLabel}</h2>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              {totals.skus} SKUs · {totals.units} units counted.{' '}
              {missing.length === 0
                ? 'Every book SKU at this location has been scanned.'
                : `${missing.length} SKUs are on the book at this location but were not scanned — decide each below before committing.`}
            </p>
            <p className="text-[10px] text-amber-700 mt-2 leading-relaxed bg-amber-50 border border-amber-200 rounded px-2 py-1">
              <strong>Note:</strong> on-hand stock is tracked as one total per SKU.
              Committing this count overwrites that total with what was found at
              <strong> {locationLabel}</strong>. If the same SKU also lives at another
              location, switch the session to "All locations" or include those bays
              in this count.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {missing.length > 0 && (
          <div className="px-5 py-3 border-b border-gray-100 bg-amber-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4" />
              {decided} / {missing.length} reviewed
              {zeroCount > 0 && (
                <span className="ml-2 text-[10px] uppercase tracking-widest bg-red-100 text-red-700 px-2 py-0.5 rounded">
                  {zeroCount} will be zeroed
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-white rounded-lg border border-amber-200 px-2 py-1">
                <Search className="w-3.5 h-3.5 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search missing"
                  className="text-xs font-bold outline-none bg-transparent w-32"
                />
              </div>
              <button
                type="button"
                onClick={skipAll}
                className="px-3 py-1.5 rounded-lg border border-amber-300 text-[10px] font-black uppercase tracking-widest text-amber-900 hover:bg-amber-100"
              >
                Mark all skip
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {missing.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-sm font-black text-gray-900">Nothing missing</p>
              <p className="text-[11px] text-gray-500 mt-1">All on-book SKUs at this location were scanned.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map(m => {
                const decision = decisions.get(m.stockKey);
                return (
                  <li key={m.stockKey} className="px-5 py-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-bold text-sm text-gray-900 leading-tight">{m.description || '—'}</p>
                      <p className="text-[10px] font-mono text-indigo-600 mt-0.5">{m.ean}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                        {[m.vendor, m.productCode, m.colour, m.size].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500">
                      Book qty <span className="text-base font-black text-gray-900 ml-1">{m.bookQty}</span>
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setDecision(m.stockKey, 'skip')}
                        className={`min-h-[44px] px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                          decision === 'skip'
                            ? 'bg-gray-800 text-white'
                            : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecision(m.stockKey, 'zero')}
                        className={`min-h-[44px] px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                          decision === 'zero'
                            ? 'bg-red-600 text-white'
                            : 'border border-red-200 text-red-700 hover:bg-red-50'
                        }`}
                      >
                        Zero out
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] text-gray-500 leading-relaxed max-w-md">
            Commit replaces on-hand qty for every <strong>scanned</strong> SKU.{' '}
            {zeroCount > 0 && <>
              <span className="text-red-700 font-black">{zeroCount}</span> reviewed SKU(s) will be reset to 0.
            </>}
            {' '}Unscanned, "Skip" SKUs are left unchanged.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-4 rounded-lg border border-gray-200 text-gray-700 text-[11px] font-black uppercase tracking-widest hover:bg-white"
              disabled={committing}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={committing || !allDecided}
              className="min-h-[44px] px-5 rounded-lg bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {committing && <Loader2 className="w-4 h-4 animate-spin" />}
              Commit to stock
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PreCommitReviewModal;
