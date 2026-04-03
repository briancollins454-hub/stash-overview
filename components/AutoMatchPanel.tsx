import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { UnifiedOrder, PhysicalStockItem, ReferenceProduct } from '../types';
import { autoMatch, AutoMatchResult, EanIndex } from '../services/autoMatchService';
import { CheckCircle2, X, Zap, ChevronDown, ChevronRight, AlertTriangle, ExternalLink, Barcode } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  productMappings: Record<string, string>;
  physicalStock?: PhysicalStockItem[];
  referenceProducts?: ReferenceProduct[];
  onApplyMatches: (matches: { itemKey: string; decoId: string }[], jobId?: string, learnedPatterns?: Record<string, string>) => void;
  onNavigateToOrder?: (orderNumber: string) => void;
}

const AutoMatchPanel: React.FC<Props> = ({ orders, productMappings, physicalStock, referenceProducts, onApplyMatches, onNavigateToOrder }) => {
  const [results, setResults] = useState<AutoMatchResult[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState(60);
  const [eanAutoApplied, setEanAutoApplied] = useState(0);

  // Build EAN enrichment index from reference products + physical stock
  const eanIndex = useMemo<EanIndex>(() => {
    const idx: EanIndex = new Map();
    // Physical stock (barcode scanner — highest trust)
    if (physicalStock) {
      for (const s of physicalStock) {
        if (s.ean && s.ean.trim().length >= 8 && s.productCode) {
          idx.set(s.productCode.toLowerCase(), s.ean.trim());
        }
      }
    }
    // Reference products (supplier CSVs)
    if (referenceProducts) {
      for (const r of referenceProducts) {
        if (r.ean && r.ean.trim().length >= 8 && r.productCode) {
          const key = r.productCode.toLowerCase();
          if (!idx.has(key)) idx.set(key, r.ean.trim());
        }
      }
    }
    return idx;
  }, [physicalStock, referenceProducts]);

  const runAutoMatch = useCallback(() => {
    const matches = autoMatch(orders, productMappings, eanIndex);

    // EAN matches are 100% certain — apply them immediately, no user intervention needed
    const eanMatches = matches.filter(m => m.isEanMatch);
    const manualMatches = matches.filter(m => !m.isEanMatch);

    if (eanMatches.length > 0) {
      const byJob = new Map<string, { itemKey: string; decoId: string }[]>();
      eanMatches.forEach(r => {
        if (!byJob.has(r.suggestedJobId)) byJob.set(r.suggestedJobId, []);
        byJob.get(r.suggestedJobId)!.push({ itemKey: r.itemId, decoId: r.suggestedDecoItemId });
      });
      byJob.forEach((mappings, jobId) => onApplyMatches(mappings, jobId));
    }
    setEanAutoApplied(eanMatches.length);

    // Only show non-EAN matches for manual review
    setResults(manualMatches);
    setHasRun(true);
    const highConf = new Set(manualMatches.filter(m => m.confidence >= 80).map(m => m.itemId));
    setSelected(highConf);
  }, [orders, productMappings, eanIndex, onApplyMatches]);

  // Auto-run on mount — disabled (user can manually trigger matching)
  // useEffect(() => {
  //   if (!hasRun && orders.length > 0) runAutoMatch();
  // }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => results.filter(r => r.confidence >= minConfidence), [results, minConfidence]);

  // Group by order
  const grouped = useMemo(() => {
    const map = new Map<string, AutoMatchResult[]>();
    filtered.forEach(r => {
      if (!map.has(r.orderNumber)) map.set(r.orderNumber, []);
      map.get(r.orderNumber)!.push(r);
    });
    return map;
  }, [filtered]);

  const applySelected = () => {
    const toApply = filtered.filter(r => selected.has(r.itemId));
    if (toApply.length === 0) return;

    // Group by job
    const byJob = new Map<string, { itemKey: string; decoId: string }[]>();
    toApply.forEach(r => {
      if (!byJob.has(r.suggestedJobId)) byJob.set(r.suggestedJobId, []);
      byJob.get(r.suggestedJobId)!.push({ itemKey: r.itemId, decoId: r.suggestedDecoItemId });
    });

    byJob.forEach((mappings, jobId) => {
      onApplyMatches(mappings, jobId);
    });

    // Remove applied from results
    setResults(prev => prev.filter(r => !selected.has(r.itemId)));
    setSelected(new Set());
  };

  const confidenceColor = (c: number) => {
    if (c >= 80) return 'text-emerald-600 bg-emerald-50';
    if (c >= 60) return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Auto-Match Engine</h3>
        </div>
        <div className="flex items-center gap-2">
          {hasRun && (
            <>
              <span className="text-[10px] font-bold text-gray-400">Min confidence:</span>
              <select
                value={minConfidence}
                onChange={e => setMinConfidence(Number(e.target.value))}
                className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none"
              >
                <option value={40}>40%</option>
                <option value={60}>60%</option>
                <option value={80}>80%</option>
              </select>
            </>
          )}
          <button
            onClick={runAutoMatch}
            className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> {hasRun ? 'Re-scan' : 'Scan for Matches'}
          </button>
        </div>
      </div>

      {hasRun && (
        <div className="p-4">
          {eanAutoApplied > 0 && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg">
              <Barcode className="w-4 h-4 text-indigo-600" />
              <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">
                {eanAutoApplied} product{eanAutoApplied !== 1 ? 's' : ''} auto-mapped by EAN barcode
              </span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
              <p className="text-xs font-bold uppercase tracking-widest">{eanAutoApplied > 0 ? 'All remaining items are matched!' : 'No unmapped items found — everything looks matched!'}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  {filtered.length} suggestions • {selected.size} selected
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(new Set(filtered.map(r => r.itemId)))} className="text-[9px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest">Select All</button>
                  <button onClick={() => setSelected(new Set())} className="text-[9px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest">Clear</button>
                  <button
                    onClick={applySelected}
                    disabled={selected.size === 0}
                    className="px-3 py-1 bg-emerald-500 text-white rounded text-[9px] font-black uppercase tracking-widest hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Apply ({selected.size})
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {Array.from(grouped.entries()).map(([orderNum, matches]) => (
                  <div key={orderNum} className="border border-gray-100 rounded-lg">
                    <div className="flex items-center">
                      <button
                        onClick={() => setExpandedOrder(expandedOrder === orderNum ? null : orderNum)}
                        className="flex-1 px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <span className="text-xs font-black text-gray-700">#{orderNum} <span className="text-gray-400 font-bold">({matches.length} matches)</span></span>
                        {expandedOrder === orderNum ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                      </button>
                      {onNavigateToOrder && (
                        <button onClick={() => onNavigateToOrder(orderNum)} className="px-2 py-1 mr-2 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded transition-colors" title="View in Dashboard">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {expandedOrder === orderNum && (
                      <div className="px-3 pb-2 space-y-1.5">
                        {matches.map(m => (
                          <label key={m.itemId} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected.has(m.itemId)}
                              onChange={e => {
                                const next = new Set(selected);
                                e.target.checked ? next.add(m.itemId) : next.delete(m.itemId);
                                setSelected(next);
                              }}
                              className="rounded border-gray-300 text-indigo-500 focus:ring-indigo-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-bold text-gray-700 truncate">{m.itemName}</p>
                              <p className="text-[9px] text-gray-400 truncate">→ {m.suggestedDecoItemName}</p>
                              <p className="text-[8px] text-gray-400">{m.reason}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${confidenceColor(m.confidence)}`}>
                                {m.confidence}%
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AutoMatchPanel;
