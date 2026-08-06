import React, { useMemo, useState } from 'react';
import { X, StickyNote, Loader2, CheckCircle2, XCircle, MinusCircle, Search } from 'lucide-react';
import type { ShopifyOrder } from '../types';
import type { ApiSettings } from './SettingsModal';
import {
  parseOrderNumbersFromText,
  resolveOrderIdsByNumber,
  fetchOrdersNoteState,
  updateOrderNotes,
  composeOrderNote,
  type OrderMutationTarget,
} from '../services/shopifyOrderMutations';

/**
 * Bulk add / append an order note across many Shopify orders at once.
 *
 * Workflow it replaces: exporting a CSV, then editing every order by hand to
 * paste in the Deco job reference. Paste the order numbers (plain list or a
 * whole CSV export — the #1234 "Name" column is picked out automatically),
 * type the note once, and it's appended to every order. Because the
 * dashboard auto-links orders to Deco jobs by scanning the order note for a
 * job number, appending e.g. "…47963…" also links those orders to the job.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: ShopifyOrder[];
  apiSettings: ApiSettings;
  /** Patch the local cache after successful writes so the dashboard updates immediately. */
  onApplied: (patches: { id: string; note: string }[]) => void;
}

type RowStatus = 'cached' | 'lookup' | 'notFound';

interface ResultRow {
  orderNumber: string;
  outcome: 'updated' | 'skipped' | 'failed' | 'notFound';
  detail?: string;
}

const BulkNoteModal: React.FC<Props> = ({ isOpen, onClose, orders, apiSettings, onApplied }) => {
  const [numbersText, setNumbersText] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);

  const cacheByNumber = useMemo(() => {
    const map = new Map<string, ShopifyOrder>();
    orders.forEach(o => { if (o.orderNumber) map.set(String(o.orderNumber), o); });
    return map;
  }, [orders]);

  const parsedNumbers = useMemo(() => parseOrderNumbersFromText(numbersText), [numbersText]);

  const preview = useMemo(() => {
    return parsedNumbers.map(num => {
      const cached = cacheByNumber.get(num);
      return {
        orderNumber: num,
        customer: cached?.customerName,
        currentNote: (cached?.timelineComments || []).join(' '),
        status: (cached ? 'cached' : 'lookup') as RowStatus,
      };
    });
  }, [parsedNumbers, cacheByNumber]);

  if (!isOpen) return null;

  const canRun = !running && parsedNumbers.length > 0 && note.trim().length > 0;

  const handleApply = async () => {
    if (!canRun) return;
    setRunning(true);
    setResults(null);
    const out: ResultRow[] = [];
    try {
      // 1. Resolve order numbers → Shopify GIDs (cache first, then live lookup
      //    for old/archived orders that aren't in the local cache).
      setProgress('Matching orders…');
      const targets = new Map<string, OrderMutationTarget>();
      const needLookup: string[] = [];
      for (const num of parsedNumbers) {
        const cached = cacheByNumber.get(num);
        if (cached?.id) targets.set(num, { id: cached.id, orderNumber: num });
        else needLookup.push(num);
      }
      if (needLookup.length > 0) {
        setProgress(`Looking up ${needLookup.length} order${needLookup.length === 1 ? '' : 's'} in Shopify…`);
        const found = await resolveOrderIdsByNumber(apiSettings, needLookup);
        found.forEach((t, num) => targets.set(num, { id: t.id, orderNumber: num }));
      }
      parsedNumbers.filter(n => !targets.has(n)).forEach(n => out.push({ orderNumber: n, outcome: 'notFound', detail: 'Order not found in Shopify' }));

      // 2. Pull each order's CURRENT note from Shopify (never trust the local
      //    cache for appends — another device may have written since).
      const targetList = Array.from(targets.values());
      let noteStates = new Map<string, { note: string }>();
      if (targetList.length > 0) {
        setProgress(`Reading current notes for ${targetList.length} order${targetList.length === 1 ? '' : 's'}…`);
        noteStates = await fetchOrdersNoteState(apiSettings, targetList.map(t => t.id));
      }

      // 3. Compose per-order notes; skip orders that already contain the text.
      const updates: { id: string; orderNumber: string; note: string }[] = [];
      for (const t of targetList) {
        const current = noteStates.get(t.id)?.note ?? '';
        const composed = composeOrderNote(current, note, mode);
        if (composed === null) out.push({ orderNumber: t.orderNumber, outcome: 'skipped', detail: 'Note already present' });
        else updates.push({ ...t, note: composed });
      }

      // 4. Write.
      if (updates.length > 0) {
        const writeResults = await updateOrderNotes(apiSettings, updates, (done, total) => {
          setProgress(`Updating notes ${done}/${total}…`);
        });
        const noteById = new Map(updates.map(u => [u.id, u.note]));
        const patches: { id: string; note: string }[] = [];
        for (const r of writeResults) {
          if (r.ok) {
            out.push({ orderNumber: r.orderNumber, outcome: 'updated' });
            const n = noteById.get(r.id);
            if (n !== undefined) patches.push({ id: r.id, note: n });
          } else {
            out.push({ orderNumber: r.orderNumber, outcome: 'failed', detail: r.error });
          }
        }
        if (patches.length > 0) onApplied(patches);
      }
    } catch (e: any) {
      out.push({ orderNumber: '—', outcome: 'failed', detail: e?.message || 'Unexpected error' });
    } finally {
      const order: Record<ResultRow['outcome'], number> = { failed: 0, notFound: 1, updated: 2, skipped: 3 };
      out.sort((a, b) => order[a.outcome] - order[b.outcome]);
      setResults(out);
      setProgress(null);
      setRunning(false);
    }
  };

  const updatedCount = (results || []).filter(r => r.outcome === 'updated').length;
  const skippedCount = (results || []).filter(r => r.outcome === 'skipped').length;
  const failedCount = (results || []).filter(r => r.outcome === 'failed' || r.outcome === 'notFound').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={running ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-indigo-500" />
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Bulk Order Notes</h3>
          </div>
          <button onClick={onClose} disabled={running} className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">
              Order numbers <span className="normal-case font-bold text-gray-400">(paste a list or a whole CSV export — #1234 numbers are picked out automatically)</span>
            </label>
            <textarea
              value={numbersText}
              onChange={e => setNumbersText(e.target.value)}
              disabled={running}
              rows={4}
              placeholder={'#224981, #224992, #225004\n…or paste the CSV export straight in'}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-800 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none resize-y"
            />
            <div className="mt-1 text-[10px] font-bold text-gray-400">
              {parsedNumbers.length > 0
                ? <>{parsedNumbers.length} order{parsedNumbers.length === 1 ? '' : 's'} detected · {preview.filter(p => p.status === 'cached').length} matched in dashboard · {preview.filter(p => p.status === 'lookup').length} will be looked up in Shopify</>
                : 'No order numbers detected yet'}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">
              Note to add <span className="normal-case font-bold text-gray-400">(include the Deco job number to auto-link orders to that job)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={running}
              rows={3}
              placeholder="Order #224981 Haileybury Leavers Stash Shop - Fleeces - 47963 17/4 - 48529 12/5"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none resize-y"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Mode:</span>
            <button
              onClick={() => setMode('append')}
              disabled={running}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${mode === 'append' ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-inner' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
            >
              Append to existing note
            </button>
            <button
              onClick={() => setMode('replace')}
              disabled={running}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${mode === 'replace' ? 'bg-rose-50 text-rose-700 border-rose-200 shadow-inner' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
            >
              Replace note
            </button>
          </div>
          {mode === 'replace' && (
            <div className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              Replace overwrites whatever note is currently on each order. Use Append unless you're sure.
            </div>
          )}

          {/* Preview of matched orders */}
          {preview.length > 0 && !results && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Order</th>
                      <th className="px-3 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Customer</th>
                      <th className="px-3 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Current note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(p => (
                      <tr key={p.orderNumber} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 font-black text-gray-800 whitespace-nowrap">#{p.orderNumber}</td>
                        <td className="px-3 py-1.5 font-bold text-gray-600 truncate max-w-[140px]">
                          {p.customer || <span className="flex items-center gap-1 text-gray-400"><Search className="w-2.5 h-2.5" /> lookup</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 truncate max-w-[220px]">{p.currentNote || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-600">
                {updatedCount} updated · {skippedCount} already had the note · {failedCount} failed / not found
              </div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={`${r.orderNumber}-${i}`} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 font-black text-gray-800 whitespace-nowrap w-24">#{r.orderNumber}</td>
                        <td className="px-3 py-1.5">
                          {r.outcome === 'updated' && <span className="flex items-center gap-1 font-bold text-emerald-600"><CheckCircle2 className="w-3 h-3" /> Note added</span>}
                          {r.outcome === 'skipped' && <span className="flex items-center gap-1 font-bold text-gray-400"><MinusCircle className="w-3 h-3" /> Already present</span>}
                          {(r.outcome === 'failed' || r.outcome === 'notFound') && <span className="flex items-center gap-1 font-bold text-rose-600"><XCircle className="w-3 h-3" /> {r.detail || 'Failed'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest min-h-[14px]">
            {running && <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> {progress}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={running} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 border border-gray-200 hover:border-gray-300 disabled:opacity-40">
              {results ? 'Close' : 'Cancel'}
            </button>
            <button
              onClick={handleApply}
              disabled={!canRun}
              className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <StickyNote className="w-3 h-3" />
              {results ? 'Run again' : `Add note to ${parsedNumbers.length || 0} order${parsedNumbers.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkNoteModal;
