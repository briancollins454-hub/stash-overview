import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Barcode, Camera, CheckCircle2, Keyboard, Loader2, Package, Printer, Save, ScanLine, Trash2,
} from 'lucide-react';
import { openStockTakePrint } from '../utils/stockTakePrint';
import BarcodeCameraScanner from './BarcodeCameraScanner';
import SupplierCatalogPanel from './SupplierCatalogPanel';
import type { DecoJob, PhysicalStockItem, ReferenceProduct, SupplierCatalogItem } from '../types';
import { fetchSupplierCatalog } from '../services/supplierCatalogService';
import { isSupabaseReady } from '../services/supabase';
import {
  createBarcodeLookup,
  isPlausibleScanCode,
  normalizeBarcodeInput,
  physicalStockAggregateKey,
  type ResolvedProduct,
} from '../services/productResolver';
import {
  buildPhysicalStockFromStockTake,
  createStockTakeSession,
  deleteStockTakeLine,
  fetchOpenStockTakeSessions,
  fetchStockTakeSession,
  lineFromResolved,
  manualProductFromForm,
  markSessionCommitted,
  mergeReferenceFromLines,
  upsertStockTakeLine,
  type StockTakeLineView,
  type StockTakeLocation,
  type StockTakeSession,
} from '../services/stockTakeService';

const DRAFT_KEY = 'stash_stock_take_draft';

function prefersCameraScan(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
}

const LOCATION_LABELS: Record<StockTakeLocation, string> = {
  church_st: '20 Church Street',
  local_stock: 'Local stock',
  all: 'All locations (book)',
};

interface Props {
  physicalStock: PhysicalStockItem[];
  referenceProducts: ReferenceProduct[];
  decoJobs: DecoJob[];
  currentUser?: { email?: string | null; displayName?: string | null };
  onCommitStock: (next: PhysicalStockItem[]) => void;
  onUpdateReferenceProducts: (next: ReferenceProduct[]) => void;
}

const StockTakeScanner: React.FC<Props> = ({
  physicalStock,
  referenceProducts,
  decoJobs,
  currentUser,
  onCommitStock,
  onUpdateReferenceProducts,
}) => {
  const scanRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<StockTakeSession | null>(null);
  const [lines, setLines] = useState<StockTakeLineView[]>([]);
  const [openSessions, setOpenSessions] = useState<StockTakeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newLocation, setNewLocation] = useState<StockTakeLocation>('church_st');
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [regForm, setRegForm] = useState({
    description: '',
    vendor: '',
    productCode: '',
    colour: '',
    size: '',
  });
  const [scanMode, setScanMode] = useState<'camera' | 'keyboard'>(() =>
    prefersCameraScan() ? 'camera' : 'keyboard',
  );
  const [cameraOpen, setCameraOpen] = useState(true);
  const [cameraFlash, setCameraFlash] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [supplierCatalog, setSupplierCatalog] = useState<SupplierCatalogItem[]>([]);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const lastCamScanRef = useRef<{ code: string; at: number; counted?: boolean }>({ code: '', at: 0 });
  const dismissedCodesRef = useRef<Map<string, number>>(new Map());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const barcodeLookup = useMemo(
    () => createBarcodeLookup({ supplierCatalog, referenceProducts, physicalStock, decoJobs }),
    [supplierCatalog, referenceProducts, physicalStock, decoJobs],
  );
  const barcodeLookupRef = useRef(barcodeLookup);
  barcodeLookupRef.current = barcodeLookup;

  useEffect(() => () => {
    setCameraOpen(false);
  }, []);

  const isScanDismissed = useCallback((code: string) => {
    const until = dismissedCodesRef.current.get(code);
    if (!until) return false;
    if (Date.now() > until) {
      dismissedCodesRef.current.delete(code);
      return false;
    }
    return true;
  }, []);

  const bookByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of physicalStock) {
      const k = physicalStockAggregateKey(item);
      m.set(k, (m.get(k) || 0) + item.quantity);
    }
    return m;
  }, [physicalStock]);

  const reloadSupplierCatalog = useCallback(async () => {
    if (!isSupabaseReady()) {
      setSupplierCatalog([]);
      return;
    }
    try {
      setCatalogLoadError(null);
      const items = await fetchSupplierCatalog();
      setSupplierCatalog(items);
    } catch (e: unknown) {
      setSupplierCatalog([]);
      setCatalogLoadError(e instanceof Error ? e.message : 'Could not load supplier catalog');
    }
  }, []);

  const loadOpen = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const open = await fetchOpenStockTakeSessions();
      await reloadSupplierCatalog();
      setOpenSessions(open);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load sessions');
    } finally {
      setLoading(false);
    }
  }, [reloadSupplierCatalog]);

  useEffect(() => {
    void loadOpen();
  }, [loadOpen]);

  useEffect(() => {
    if (session) void reloadSupplierCatalog();
  }, [session?.id, reloadSupplierCatalog]);

  useEffect(() => {
    if (session) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ sessionId: session.id, lines }));
    }
  }, [session, lines]);

  useEffect(() => {
    if (scanMode === 'keyboard' && !unknownCode) {
      scanRef.current?.focus();
    }
  }, [session, unknownCode, scanMode]);

  const totals = useMemo(() => {
    const skus = lines.length;
    const units = lines.reduce((s, l) => s + l.qty, 0);
    return { skus, units };
  }, [lines]);

  const startSession = async () => {
    setError(null);
    try {
      const createdBy = currentUser?.email || currentUser?.displayName || null;
      const s = await createStockTakeSession({
        label: newLabel.trim() || `Count ${new Date().toLocaleDateString('en-GB')}`,
        location: newLocation,
        createdBy: createdBy || undefined,
      });
      setSession(s);
      setLines([]);
      setOpenSessions(prev => [s, ...prev]);
      setNewLabel('');
    } catch (e: unknown) {
      if (!isSupabaseReady()) {
        const local: StockTakeSession = {
          id: `local_${Date.now()}`,
          label: newLabel.trim() || 'Local draft',
          location: newLocation,
          status: 'open',
          created_by: null,
          created_at: new Date().toISOString(),
          committed_at: null,
        };
        setSession(local);
        setLines([]);
        setError('Cloud offline — counting locally; commit still updates stock on this device.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to start session');
      }
    }
  };

  const resumeSession = async (id: string) => {
    setLoading(true);
    try {
      const { session: s, lines: ls } = await fetchStockTakeSession(id);
      if (!s) throw new Error('Session not found');
      setSession(s);
      setLines(ls);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  };

  const persistLine = async (line: StockTakeLineView) => {
    if (!session || session.id.startsWith('local_')) return;
    try {
      await upsertStockTakeLine(line);
    } catch {
      /* keep in UI */
    }
  };

  const addScan = (product: ResolvedProduct, qty: number) => {
    if (!session) return;
    const isEmbellished = false;
    const stockKey = physicalStockAggregateKey({
      ean: product.ean,
      isEmbellished,
      size: product.size,
      colour: product.colour,
    });
    setLines(prev => {
      const idx = prev.findIndex(l => l.stockKey === stockKey);
      if (idx >= 0) {
        const next = [...prev];
        const updated: StockTakeLineView = {
          ...next[idx],
          qty: next[idx].qty + qty,
          updatedAt: new Date().toISOString(),
        };
        next[idx] = updated;
        void persistLine(updated);
        return next;
      }
      const line = lineFromResolved(session.id, product, qty);
      void persistLine(line);
      return [line, ...prev];
    });
    setLastKey(stockKey);
    setScanValue('');
    setAddQty(1);
  };

  const showUnknown = useCallback((code: string) => {
    setUnknownCode(code);
    setRegForm({ description: '', vendor: '', productCode: '', colour: '', size: '' });
  }, []);

  const cancelUnknown = useCallback(() => {
    if (unknownCode) {
      dismissedCodesRef.current.set(unknownCode, Date.now() + 10_000);
    }
    setUnknownCode(null);
    setRegForm({ description: '', vendor: '', productCode: '', colour: '', size: '' });
  }, [unknownCode]);

  const applyScan = useCallback(
    (raw: string, opts?: { fromCamera?: boolean }) => {
      const code = normalizeBarcodeInput(raw);
      if (!code || !sessionRef.current) return;
      if (isScanDismissed(code)) return;
      if (opts?.fromCamera && !isPlausibleScanCode(code)) return;

      const now = Date.now();
      const last = lastCamScanRef.current;
      if (opts?.fromCamera && last.code === code && last.counted && now - last.at < 1800) return;

      const product = barcodeLookupRef.current.resolve(code);
      if (!product) {
        if (opts?.fromCamera && last.code === code && now - last.at < 1200) return;
        showUnknown(code);
        lastCamScanRef.current = { code, at: now };
        return;
      }

      lastCamScanRef.current = { code, at: now, counted: true };
      setUnknownCode(null);
      try {
        navigator.vibrate?.(35);
      } catch { /* unsupported */ }
      if (opts?.fromCamera) {
        const matchedEan = normalizeBarcodeInput(product.ean);
        setCameraFlash(
          matchedEan !== code
            ? `Scanned ${code} → ${matchedEan}`
            : code,
        );
        window.setTimeout(() => setCameraFlash(null), 1200);
      }
      addScan(product, Math.max(1, addQty));
    },
    [addQty, isScanDismissed, showUnknown],
  );

  const processBarcode = useCallback(
    (raw: string) => applyScan(raw, { fromCamera: false }),
    [applyScan],
  );

  const handleCameraScan = useCallback(
    (raw: string) => applyScan(raw, { fromCamera: true }),
    [applyScan],
  );

  const handleCameraError = useCallback((msg: string) => setCameraError(msg), []);

  const handleScanSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!scanValue.trim()) return;
    processBarcode(scanValue);
  };

  const registerUnknown = () => {
    if (!unknownCode || !regForm.description.trim()) return;
    const product = manualProductFromForm(unknownCode, regForm);
    addScan(product, Math.max(1, addQty));
    setUnknownCode(null);
  };

  const setLineQty = (id: string, qty: number) => {
    const q = Math.max(0, qty);
    setLines(prev => {
      if (q === 0) return prev.filter(l => l.id !== id);
      return prev.map(l => {
        if (l.id !== id) return l;
        const updated = { ...l, qty: q, updatedAt: new Date().toISOString() };
        void persistLine(updated);
        return updated;
      });
    });
  };

  const removeLine = async (id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
    try {
      await deleteStockTakeLine(id);
    } catch { /* */ }
  };

  const handlePrintPdf = () => {
    if (!session || lines.length === 0) return;
    openStockTakePrint({
      session,
      locationLabel: LOCATION_LABELS[session.location as StockTakeLocation] || session.location,
      rows: lines.map(line => ({
        line,
        bookQty: bookByKey.get(line.stockKey) ?? 0,
      })),
      totals,
    });
  };

  const handleCommit = async () => {
    if (!session || lines.length === 0) return;
    const msg =
      `Commit ${totals.skus} SKU(s) / ${totals.units} unit(s) to branch stock?\n\n` +
      'Counted lines will REPLACE on-hand quantity for those products. ' +
      'Items you did not scan are left unchanged.';
    if (!window.confirm(msg)) return;

    setCommitting(true);
    setError(null);
    try {
      const { next, summary } = buildPhysicalStockFromStockTake(lines, physicalStock);
      onCommitStock(next);
      const refs = mergeReferenceFromLines(lines, referenceProducts);
      onUpdateReferenceProducts(refs);
      if (!session.id.startsWith('local_')) {
        await markSessionCommitted(session.id);
      }
      setSession(null);
      setLines([]);
      localStorage.removeItem(DRAFT_KEY);
      window.alert(
        `Stock take committed.\nUpdated: ${summary.updated}\nNew: ${summary.created}\nDuplicate rows removed: ${summary.removed}`,
      );
      void loadOpen();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  if (!isSupabaseReady() && !session) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
        <AlertTriangle className="w-5 h-5 inline mr-2" />
        Supabase is not configured. Stock take sessions need the cloud tables — run{' '}
        <code className="text-xs bg-amber-100 px-1 rounded">migrations/stash_stock_take.sql</code>{' '}
        in the SQL editor, then reload.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-16">
      <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-300">
            <ScanLine className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white tracking-tight">Stock take</h1>
            <p className="text-xs text-white/50 mt-0.5">
              Scan barcodes to count what is on site. Commit updates branch stock in Stock Manager.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-[11px] font-semibold text-amber-900" role="alert">
          {error}
        </div>
      )}

      <SupplierCatalogPanel
        referenceProducts={referenceProducts}
        onCatalogUpdated={reloadSupplierCatalog}
        onReferenceMerged={onUpdateReferenceProducts}
        uploadedBy={currentUser?.email || currentUser?.displayName || undefined}
      />

      <p className="text-[10px] text-gray-500 font-semibold px-1">
        Scan index:{' '}
        {barcodeLookup.stats.supplierKeys.toLocaleString()} supplier ·{' '}
        {barcodeLookup.stats.referenceKeys.toLocaleString()} reference ·{' '}
        {barcodeLookup.stats.physicalKeys.toLocaleString()} branch stock
        {barcodeLookup.stats.totalKeys === 0 && (
          <span className="text-amber-700"> — upload a supplier CSV or sync reference products first</span>
        )}
      </p>
      {catalogLoadError && (
        <p className="text-[10px] text-amber-800 font-semibold px-1" role="alert">
          Supplier catalog failed to load: {catalogLoadError}. Run migrations/stash_supplier_catalog.sql if needed.
        </p>
      )}

      {!session ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">Start new count</h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Session name (optional)"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold"
              />
              <select
                value={newLocation}
                onChange={e => setNewLocation(e.target.value as StockTakeLocation)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-[10px] font-black uppercase tracking-widest"
              >
                {Object.entries(LOCATION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void startSession()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
              >
                Start
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
          ) : openSessions.length > 0 ? (
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Resume open session</h2>
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                {openSessions.map(s => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => void resumeSession(s.id)}
                      className="w-full text-left px-4 py-3 hover:bg-indigo-50/50 flex justify-between items-center"
                    >
                      <span className="font-bold text-gray-900 text-sm">{s.label}</span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">
                        {LOCATION_LABELS[s.location as StockTakeLocation] || s.location}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-gray-900">{session.label}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {LOCATION_LABELS[session.location as StockTakeLocation] || session.location}
                {' · '}{totals.skus} lines · {totals.units} units
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={handlePrintPdf}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-gray-50"
              >
                <Printer className="w-4 h-4" />
                PDF
              </button>
              <button
                type="button"
                disabled={committing || lines.length === 0}
                onClick={() => void handleCommit()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-emerald-500"
              >
                {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Commit to stock
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border-2 border-indigo-200 shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-2">
                <Barcode className="w-4 h-4" /> Add items
              </label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] font-black uppercase tracking-widest">
                <button
                  type="button"
                  onClick={() => {
                    setScanMode('camera');
                    setCameraOpen(true);
                    setCameraError(null);
                    setCameraFlash(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${scanMode === 'camera' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                >
                  <Camera className="w-3.5 h-3.5" /> Camera
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCameraOpen(false);
                    setScanMode('keyboard');
                    setCameraError(null);
                    setCameraFlash(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 transition-colors ${scanMode === 'keyboard' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                >
                  <Keyboard className="w-3.5 h-3.5" /> Type
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-black uppercase text-gray-400">Qty per scan</span>
              <input
                type="number"
                min={1}
                value={addQty}
                onChange={e => setAddQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 py-1.5 text-center font-black text-sm border border-gray-200 rounded-lg"
              />
              <span className="text-[10px] text-gray-400">1 for singles; higher for cartons</span>
            </div>
            {scanMode === 'camera' && (
              <div className="relative space-y-2">
                <BarcodeCameraScanner
                  active={cameraOpen}
                  paused={!!unknownCode}
                  onScan={handleCameraScan}
                  onError={handleCameraError}
                  onClose={() => setCameraOpen(false)}
                />
                {!cameraOpen && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/95 p-6 text-center">
                    <Camera className="w-8 h-8 text-gray-400" />
                    <p className="text-sm font-bold text-gray-600">Camera is off</p>
                    <p className="text-[11px] text-gray-400 max-w-xs">
                      Turn it on to scan barcodes, or use Type for a USB scanner.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraOpen(true);
                        setCameraError(null);
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
                    >
                      Open camera
                    </button>
                  </div>
                )}
                {cameraError && (
                  <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {cameraError}
                  </p>
                )}
                {cameraFlash && !unknownCode && (
                  <p className="text-center text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg py-2 font-mono">
                    ✓ {cameraFlash}
                  </p>
                )}
                {unknownCode && (
                  <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center p-2 bg-black/50 rounded-xl">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3 w-full max-h-[85%] overflow-y-auto shadow-lg">
                      <p className="text-sm font-black text-amber-900">
                        Unknown barcode: <span className="font-mono">{unknownCode}</span>
                      </p>
                      <p className="text-[11px] text-amber-800">
                        Not in your supplier feeds or master list. Add once, or cancel to keep scanning.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          required
                          value={regForm.description}
                          onChange={e => setRegForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="Description *"
                          className="px-3 py-2 border border-amber-200 rounded-lg text-sm font-bold sm:col-span-2"
                        />
                        <input
                          value={regForm.vendor}
                          onChange={e => setRegForm(f => ({ ...f, vendor: e.target.value }))}
                          placeholder="Vendor"
                          className="px-3 py-2 border border-amber-200 rounded-lg text-sm"
                        />
                        <input
                          value={regForm.productCode}
                          onChange={e => setRegForm(f => ({ ...f, productCode: e.target.value }))}
                          placeholder="Product code"
                          className="px-3 py-2 border border-amber-200 rounded-lg text-sm"
                        />
                        <input
                          value={regForm.colour}
                          onChange={e => setRegForm(f => ({ ...f, colour: e.target.value }))}
                          placeholder="Colour"
                          className="px-3 py-2 border border-amber-200 rounded-lg text-sm"
                        />
                        <input
                          value={regForm.size}
                          onChange={e => setRegForm(f => ({ ...f, size: e.target.value }))}
                          placeholder="Size"
                          className="px-3 py-2 border border-amber-200 rounded-lg text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={registerUnknown}
                          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase"
                        >
                          Add to count
                        </button>
                        <button
                          type="button"
                          onClick={cancelUnknown}
                          className="px-4 py-2 border border-amber-300 rounded-lg text-[10px] font-black uppercase text-amber-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {scanMode === 'keyboard' && (
              <form onSubmit={handleScanSubmit} className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={scanRef}
                    value={scanValue}
                    onChange={e => setScanValue(e.target.value)}
                    placeholder="EAN / barcode — Enter to add"
                    className="flex-1 min-w-[200px] px-4 py-3 text-lg font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 outline-none"
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="px-4 py-3 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
                  >
                    Add
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  USB wedge scanners work here — focus stays in the box.
                </p>
              </form>
            )}
          </div>


          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Package className="w-3.5 h-3.5" /> Counted lines
            </div>
            {lines.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400 font-bold">No scans yet — start scanning.</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-[50vh] overflow-y-auto">
                {lines.map(line => {
                  const book = bookByKey.get(line.stockKey) ?? 0;
                  const highlight = line.stockKey === lastKey;
                  return (
                    <li
                      key={line.id}
                      className={`px-4 py-3 flex flex-wrap items-center gap-3 ${highlight ? 'bg-indigo-50/80' : ''}`}
                    >
                      <div className="flex-1 min-w-[180px]">
                        <p className="font-bold text-gray-900 text-sm leading-tight">{line.description}</p>
                        <p className="text-[10px] font-mono text-indigo-600 mt-0.5">{line.ean}</p>
                        {line.productCode && line.productCode !== line.ean && (
                          <p className="text-[9px] font-mono text-gray-500">Style / SKU {line.productCode}</p>
                        )}
                        <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">
                          {[line.colour, line.size].filter(Boolean).join(' · ') || '—'}
                          {' · '}{line.resolvedVia}
                          {book > 0 ? ` · was ${book} on book` : ' · not on book'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setLineQty(line.id, line.qty - 1)}
                          className="w-8 h-8 rounded-lg border border-gray-200 font-black text-gray-600 hover:bg-gray-50"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={line.qty}
                          onChange={e => setLineQty(line.id, parseInt(e.target.value, 10) || 0)}
                          className="w-14 h-8 text-center font-black border border-gray-200 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setLineQty(line.id, line.qty + 1)}
                          className="w-8 h-8 rounded-lg border border-gray-200 font-black text-gray-600 hover:bg-gray-50"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeLine(line.id)}
                          className="p-2 text-gray-400 hover:text-red-600"
                          title="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="text-[10px] text-gray-500 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            Commit replaces on-hand quantity for scanned products only. Run{' '}
            <code className="bg-gray-100 px-1 rounded">stash_stock_take.sql</code> in Supabase if sessions fail to save.
          </p>
        </>
      )}
    </div>
  );
};

export default StockTakeScanner;
