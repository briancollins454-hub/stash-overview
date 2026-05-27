import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, Printer, RotateCcw, Save, ScanLine,
} from 'lucide-react';
import { openStockTakePrint } from '../utils/stockTakePrint';
import { downloadStockTakeCsv } from '../utils/stockTakeCsv';
import SupplierCatalogPanel from './SupplierCatalogPanel';
import LinesPanel from './stock-take/LinesPanel';
import SessionListPanel from './stock-take/SessionListPanel';
import ScanInputPanel from './stock-take/ScanInputPanel';
import UnknownBarcodeOverlay from './stock-take/UnknownBarcodeOverlay';
import PreCommitReviewModal from './stock-take/PreCommitReviewModal';
import {
  isScanFeedbackEnabled,
  playScanFeedback,
  setScanFeedbackEnabled,
} from './stock-take/scanFeedback';
import type { DecoJob, PhysicalStockItem, ReferenceProduct, SupplierCatalogItem } from '../types';
import { fetchSupplierCatalog } from '../services/supplierCatalogService';
import { isSupabaseReady } from '../services/supabase';
import {
  createBarcodeLookup,
  explainBarcodeLookup,
  isPlausibleScanCode,
  normalizeBarcodeInput,
  physicalStockAggregateKey,
  type ResolvedProduct,
} from '../services/productResolver';
import {
  addStockTakeLineQty,
  applyScanToReference,
  buildAuditRows,
  buildPhysicalStockFromStockTake,
  createStockTakeSession,
  deleteStockTakeLine,
  fetchCommittedStockTakeSessions,
  fetchOpenStockTakeSessions,
  fetchStockTakeSession,
  lineFromResolved,
  manualProductFromForm,
  markSessionCommitted,
  mergeReferenceFromLines,
  missingFromCount,
  reopenStockTakeSession,
  referenceDrift,
  upsertStockTakeLine,
  writeStockTakeAudit,
  type MissingLine,
  type StockTakeLineView,
  type StockTakeLocation,
  type StockTakeSession,
} from '../services/stockTakeService';

const DRAFT_KEY = 'stash_stock_take_draft';
const FEEDBACK_PREF_KEY = 'stash_stock_take_sound';

interface DraftSnapshot {
  sessionId: string;
  session?: StockTakeSession;
  lines: StockTakeLineView[];
  savedAt: string;
}

function prefersCameraScan(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
}

const LOCATION_LABELS: Record<StockTakeLocation, string> = {
  church_st: '20 Church Street',
  local_stock: 'Local stock',
  all: 'All locations (book)',
};

function formatSessionWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface UndoState {
  lineId: string;
  prevQty: number;
  /** True if the line did not exist before this scan (so undo deletes it). */
  isNew: boolean;
}

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
  const [committedSessions, setCommittedSessions] = useState<StockTakeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [cartonMode, setCartonMode] = useState(false);
  const [embellished, setEmbellished] = useState(false);
  const [clubName, setClubName] = useState('');
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
  const [unknownHint, setUnknownHint] = useState<string | null>(null);
  const [localDraft, setLocalDraft] = useState<DraftSnapshot | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);
  const [ignoredDrift, setIgnoredDrift] = useState<Set<string>>(() => new Set());
  const [soundEnabled, setSoundEnabled] = useState(() => isScanFeedbackEnabled());

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

  // ─── Sound pref persistence ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FEEDBACK_PREF_KEY);
      if (raw === '0') {
        setScanFeedbackEnabled(false);
        setSoundEnabled(false);
      }
    } catch { /* ignore */ }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      setScanFeedbackEnabled(next);
      try {
        localStorage.setItem(FEEDBACK_PREF_KEY, next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ─── Local draft restore (bug 1) ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || session) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as DraftSnapshot;
      if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
        setLocalDraft(parsed);
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [session]);

  const restoreLocalDraft = useCallback(() => {
    if (!localDraft) return;
    if (localDraft.session) {
      setSession(localDraft.session);
    } else {
      setSession({
        id: localDraft.sessionId,
        label: 'Restored draft',
        location: 'church_st',
        status: 'open',
        created_by: null,
        created_at: new Date().toISOString(),
        committed_at: null,
      });
    }
    setLines(localDraft.lines);
    setLocalDraft(null);
  }, [localDraft]);

  const discardLocalDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setLocalDraft(null);
  }, []);

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
      const [open, committed] = await Promise.all([
        fetchOpenStockTakeSessions(),
        fetchCommittedStockTakeSessions(),
      ]);
      await reloadSupplierCatalog();
      setOpenSessions(open);
      setCommittedSessions(committed);
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

  // Persist a recoverable draft on every line change.
  useEffect(() => {
    if (!session || session.status !== 'open') return;
    const snapshot: DraftSnapshot = {
      sessionId: session.id,
      session,
      lines,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot));
    } catch { /* storage full or disabled */ }
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

  const netVariance = useMemo(() => {
    let net = 0;
    for (const line of lines) {
      const book = bookByKey.get(line.stockKey) || 0;
      net += line.qty - book;
    }
    return net;
  }, [lines, bookByKey]);

  const driftRows = useMemo(
    () => referenceDrift(lines, referenceProducts).filter(row => !ignoredDrift.has(row.lineId)),
    [lines, referenceProducts, ignoredDrift],
  );

  const missing: MissingLine[] = useMemo(
    () => (session ? missingFromCount(lines, physicalStock) : []),
    [session, lines, physicalStock],
  );

  // ─── Session control ──────────────────────────────────────────────────────
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
      setUndoStack([]);
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
    setError(null);
    try {
      const { session: s, lines: ls } = await fetchStockTakeSession(id);
      if (!s) throw new Error('Session not found');
      setSession(s);
      setLines(ls);
      setUndoStack([]);
      setCameraOpen(s.status === 'open');
      setUnknownCode(null);
      setCameraFlash(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  };

  const exitSession = () => {
    setSession(null);
    setLines([]);
    setUnknownCode(null);
    setCameraFlash(null);
    setCameraError(null);
    setUndoStack([]);
    setIgnoredDrift(new Set());
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  };

  const isReadOnly = session?.status === 'committed';

  const persistLineRow = async (line: StockTakeLineView) => {
    if (!session || session.id.startsWith('local_')) return;
    try {
      await upsertStockTakeLine(line);
    } catch {
      /* keep in UI */
    }
  };

  // ─── Adding a scan (with undo bookkeeping) ────────────────────────────────
  const addScan = (product: ResolvedProduct, qty: number, opts?: { source?: 'manual' | 'scan' }) => {
    if (!session) return;
    const isEmb = embellished;
    const club = isEmb ? clubName.trim() : '';
    const stockKey = physicalStockAggregateKey({
      ean: product.ean,
      isEmbellished: isEmb,
      clubName: club || undefined,
      size: product.size,
      colour: product.colour,
    });

    setLines(prev => {
      const idx = prev.findIndex(l => l.stockKey === stockKey);
      if (idx >= 0) {
        const next = [...prev];
        const prevQty = next[idx].qty;
        const updated: StockTakeLineView = {
          ...next[idx],
          qty: prevQty + qty,
          updatedAt: new Date().toISOString(),
        };
        next[idx] = updated;
        setUndoStack(s => [...s, { lineId: updated.id, prevQty, isNew: false }]);
        if (session.id.startsWith('local_')) {
          // no-op
        } else {
          void addStockTakeLineQty(updated, qty).then(serverLine => {
            if (!serverLine) return;
            setLines(curr => curr.map(l => (l.id === updated.id ? { ...l, qty: serverLine.qty } : l)));
          });
        }
        return next;
      }
      const line = lineFromResolved(session.id, product, qty, { isEmbellished: isEmb, clubName: club });
      setUndoStack(s => [...s, { lineId: line.id, prevQty: 0, isNew: true }]);
      if (session.id.startsWith('local_')) {
        // local only
      } else {
        void addStockTakeLineQty(line, qty).then(serverLine => {
          if (!serverLine) {
            void persistLineRow(line);
            return;
          }
          setLines(curr => curr.map(l => (l.id === line.id ? { ...l, qty: serverLine.qty } : l)));
        });
      }
      return [line, ...prev];
    });
    setLastKey(stockKey);
    setScanValue('');
    if (!cartonMode) setAddQty(1);
    if (opts?.source !== 'manual') playScanFeedback('ok');
  };

  const undoLastScan = useCallback(() => {
    setUndoStack(stack => {
      if (stack.length === 0) return stack;
      const next = [...stack];
      const last = next.pop()!;
      setLines(prev => {
        if (last.isNew) {
          const removed = prev.find(l => l.id === last.lineId);
          if (removed && !session?.id.startsWith('local_')) {
            void deleteStockTakeLine(last.lineId).catch(() => undefined);
          }
          return prev.filter(l => l.id !== last.lineId);
        }
        return prev.map(l => {
          if (l.id !== last.lineId) return l;
          const restored = { ...l, qty: last.prevQty, updatedAt: new Date().toISOString() };
          void persistLineRow(restored);
          return restored;
        });
      });
      return next;
    });
  }, [session]);

  const showUnknown = useCallback((code: string) => {
    const explanation = explainBarcodeLookup(code, {
      supplierCatalog,
      referenceProducts,
      physicalStock,
      decoJobs,
    });
    setUnknownCode(code);
    setUnknownHint(explanation.hint);
    setRegForm({ description: '', vendor: '', productCode: '', colour: '', size: '' });
  }, [supplierCatalog, referenceProducts, physicalStock, decoJobs]);

  const cancelUnknown = useCallback(() => {
    if (unknownCode) {
      dismissedCodesRef.current.set(unknownCode, Date.now() + 10_000);
    }
    setUnknownCode(null);
    setUnknownHint(null);
    setRegForm({ description: '', vendor: '', productCode: '', colour: '', size: '' });
  }, [unknownCode]);

  const applyScan = useCallback(
    (raw: string, opts?: { fromCamera?: boolean }): boolean => {
      const code = normalizeBarcodeInput(raw);
      if (!code || !sessionRef.current) return false;
      if (isScanDismissed(code)) {
        playScanFeedback('reject');
        return false;
      }
      if (opts?.fromCamera && !isPlausibleScanCode(code)) return false;

      const now = Date.now();
      const last = lastCamScanRef.current;
      const camCooldownMs = 3000;

      if (opts?.fromCamera && now - last.at < 1200) {
        playScanFeedback('duplicate');
        return true;
      }

      if (opts?.fromCamera && last.code === code && now - last.at < camCooldownMs) {
        playScanFeedback('duplicate');
        return true;
      }

      const product = barcodeLookupRef.current.resolve(code);
      if (!product) {
        if (opts?.fromCamera && unknownCode === code) return true;
        playScanFeedback('reject');
        showUnknown(code);
        lastCamScanRef.current = { code, at: now };
        if (opts?.fromCamera) {
          setCameraFlash(null);
        }
        return true;
      }

      if (opts?.fromCamera && last.code === code && last.counted && now - last.at < camCooldownMs) {
        playScanFeedback('duplicate');
        return true;
      }

      lastCamScanRef.current = { code, at: now, counted: true };
      setUnknownCode(null);
      if (opts?.fromCamera) {
        const matchedEan = normalizeBarcodeInput(product.ean);
        setCameraFlash(
          matchedEan !== code
            ? `Scanned ${code} → ${matchedEan}`
            : code,
        );
        window.setTimeout(() => setCameraFlash(null), 1500);
      }
      addScan(product, Math.max(1, addQty));
      return true;
    },
    [addQty, isScanDismissed, showUnknown, unknownCode, embellished, clubName, cartonMode],
  );

  const processBarcode = useCallback(
    (raw: string) => {
      applyScan(raw, { fromCamera: false });
    },
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
    addScan(product, Math.max(1, addQty), { source: 'manual' });
    playScanFeedback('ok');
    setUnknownCode(null);
  };

  const setLineQty = (id: string, qty: number) => {
    const q = Math.max(0, qty);
    setLines(prev => {
      if (q === 0) {
        const removed = prev.find(l => l.id === id);
        if (removed && session && !session.id.startsWith('local_')) {
          void deleteStockTakeLine(id).catch(() => undefined);
        }
        return prev.filter(l => l.id !== id);
      }
      return prev.map(l => {
        if (l.id !== id) return l;
        const updated = { ...l, qty: q, updatedAt: new Date().toISOString() };
        void persistLineRow(updated);
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

  const applyDriftToReference = (lineId: string) => {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const next = applyScanToReference(line, referenceProducts);
    onUpdateReferenceProducts(next);
    setIgnoredDrift(prev => {
      const out = new Set(prev);
      out.add(lineId);
      return out;
    });
  };

  const ignoreDrift = (lineId: string) => {
    setIgnoredDrift(prev => {
      const out = new Set(prev);
      out.add(lineId);
      return out;
    });
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
      missing,
    });
  };

  const handleCsv = () => {
    if (!session || lines.length === 0) return;
    downloadStockTakeCsv({
      session,
      locationLabel: LOCATION_LABELS[session.location as StockTakeLocation] || session.location,
      rows: lines.map(line => ({
        line,
        bookQty: bookByKey.get(line.stockKey) ?? 0,
      })),
      missing: missing.map(m => ({
        ean: m.ean,
        description: m.description,
        vendor: m.vendor,
        productCode: m.productCode,
        colour: m.colour,
        size: m.size,
        bookQty: m.bookQty,
      })),
    });
  };

  const handleReopen = async () => {
    if (!session) return;
    if (!window.confirm('Re-open this committed session so you can adjust qty? On-hand stock will not change until you commit again.')) return;
    try {
      if (!session.id.startsWith('local_')) {
        await reopenStockTakeSession(session);
      }
      setSession({ ...session, status: 'open', committed_at: null, reopened_count: (session.reopened_count || 0) + 1 });
      setUndoStack([]);
      void loadOpen();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to re-open session');
    }
  };

  const handleStartCommit = () => {
    if (!session || lines.length === 0) return;
    setReviewOpen(true);
  };

  const performCommit = async (opts: { zeroKeys: string[] }) => {
    if (!session || lines.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const { next, summary } = buildPhysicalStockFromStockTake(lines, physicalStock, opts.zeroKeys);
      onCommitStock(next);
      const refs = mergeReferenceFromLines(lines, referenceProducts);
      onUpdateReferenceProducts(refs);
      const committedAt = new Date().toISOString();
      const committedBy = currentUser?.email || currentUser?.displayName || null;
      const audit = buildAuditRows(session, lines, physicalStock, committedBy);
      if (!session.id.startsWith('local_')) {
        await markSessionCommitted(session.id, {
          skus: totals.skus,
          units: totals.units,
          netVariance,
          committedBy,
        });
        void writeStockTakeAudit(session, audit);
      }
      setSession({
        ...session,
        status: 'committed',
        committed_at: committedAt,
        total_skus: totals.skus,
        total_units: totals.units,
        net_variance: netVariance,
        committed_by: committedBy,
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      window.alert(
        `Stock take committed.\nUpdated: ${summary.updated}\nNew: ${summary.created}\nZeroed (missing): ${summary.zeroed}\nDuplicate rows removed: ${summary.removed}`,
      );
      setReviewOpen(false);
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
        and{' '}
        <code className="text-xs bg-amber-100 px-1 rounded">migrations/stash_stock_take_v2.sql</code>{' '}
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

      <div className="flex flex-wrap items-center gap-2 px-1 text-[10px] text-gray-500 font-semibold">
        <span>
          Scan index:{' '}
          {supplierCatalog.length.toLocaleString()} supplier rows ·{' '}
          {barcodeLookup.stats.referenceKeys.toLocaleString()} reference ·{' '}
          {barcodeLookup.stats.physicalKeys.toLocaleString()} branch stock
          {barcodeLookup.stats.totalKeys === 0 && (
            <span className="text-amber-700"> — upload a supplier CSV or sync reference products first</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void reloadSupplierCatalog()}
          className="px-2 py-0.5 rounded border border-gray-200 text-[9px] font-black uppercase tracking-wider text-indigo-600 hover:bg-indigo-50"
        >
          Reload catalog
        </button>
      </div>
      {catalogLoadError && (
        <p className="text-[10px] text-amber-800 font-semibold px-1" role="alert">
          Supplier catalog failed to load: {catalogLoadError}. Run migrations/stash_supplier_catalog.sql if needed.
        </p>
      )}

      {!session ? (
        <SessionListPanel
          loading={loading}
          openSessions={openSessions}
          committedSessions={committedSessions}
          newLabel={newLabel}
          newLocation={newLocation}
          onChangeLabel={setNewLabel}
          onChangeLocation={setNewLocation}
          onStart={() => void startSession()}
          onResume={id => void resumeSession(id)}
          hasLocalDraft={!!localDraft}
          onRestoreLocalDraft={restoreLocalDraft}
          onDiscardLocalDraft={discardLocalDraft}
        />
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-gray-900">{session.label}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {LOCATION_LABELS[session.location as StockTakeLocation] || session.location}
                {' · '}{totals.skus} lines · {totals.units} units
                {' · net '}<span className={netVariance > 0 ? 'text-amber-700' : netVariance < 0 ? 'text-red-600' : 'text-emerald-700'}>
                  {netVariance >= 0 ? `+${netVariance}` : netVariance}
                </span>
                {isReadOnly && session.committed_at && (
                  <> · Committed {formatSessionWhen(session.committed_at)}</>
                )}
              </p>
              {isReadOnly && (
                <span className="inline-block mt-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase tracking-widest">
                  Committed — view only
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exitSession}
                className="flex items-center gap-2 min-h-[44px] px-4 border border-gray-200 text-gray-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-50"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={handleCsv}
                className="flex items-center gap-2 min-h-[44px] px-4 border border-gray-200 text-gray-700 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-gray-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                CSV
              </button>
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={handlePrintPdf}
                className="flex items-center gap-2 min-h-[44px] px-4 border border-gray-200 text-gray-700 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-gray-50"
              >
                <Printer className="w-4 h-4" />
                PDF
              </button>
              {isReadOnly && (
                <button
                  type="button"
                  onClick={() => void handleReopen()}
                  className="flex items-center gap-2 min-h-[44px] px-4 border border-indigo-200 text-indigo-700 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50"
                  title="Re-open for adjustment"
                >
                  <RotateCcw className="w-4 h-4" />
                  Re-open
                </button>
              )}
              {!isReadOnly && (
                <button
                  type="button"
                  disabled={committing || lines.length === 0}
                  onClick={handleStartCommit}
                  className="flex items-center gap-2 min-h-[44px] px-4 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-emerald-500"
                >
                  {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Review &amp; commit
                </button>
              )}
            </div>
          </div>

          {!isReadOnly && (
            <ScanInputPanel
              scanMode={scanMode}
              onChangeMode={mode => {
                if (mode === 'camera') {
                  setScanMode('camera');
                  setCameraOpen(true);
                  setCameraError(null);
                  setCameraFlash(null);
                } else {
                  setCameraOpen(false);
                  setScanMode('keyboard');
                  setCameraError(null);
                  setCameraFlash(null);
                }
              }}
              cameraOpen={cameraOpen}
              cameraError={cameraError}
              cameraFlash={cameraFlash && !unknownCode ? cameraFlash : null}
              onCameraOpen={() => {
                setCameraOpen(true);
                setCameraError(null);
              }}
              onCameraScan={handleCameraScan}
              onCameraError={handleCameraError}
              onCameraClose={() => setCameraOpen(false)}
              pauseCamera={!!unknownCode}
              scanValue={scanValue}
              onChangeScanValue={setScanValue}
              onScanSubmit={handleScanSubmit}
              scanInputRef={scanRef}
              addQty={addQty}
              onChangeAddQty={setAddQty}
              cartonMode={cartonMode}
              onToggleCartonMode={() => setCartonMode(v => !v)}
              embellished={embellished}
              onToggleEmbellished={() => setEmbellished(v => !v)}
              clubName={clubName}
              onChangeClubName={setClubName}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
              unknownOverlay={
                unknownCode ? (
                  <UnknownBarcodeOverlay
                    unknownCode={unknownCode}
                    hint={unknownHint}
                    form={regForm}
                    onChangeForm={setRegForm}
                    onRegister={registerUnknown}
                    onCancel={cancelUnknown}
                  />
                ) : undefined
              }
            />
          )}

          <LinesPanel
            lines={lines}
            bookByKey={bookByKey}
            lastKey={lastKey}
            isReadOnly={!!isReadOnly}
            drift={driftRows}
            onSetQty={setLineQty}
            onRemove={removeLine}
            onApplyDrift={applyDriftToReference}
            onIgnoreDrift={ignoreDrift}
            onUndoLastScan={undoLastScan}
            canUndo={undoStack.length > 0}
          />

          <p className="text-[10px] text-gray-500 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            {isReadOnly
              ? 'This count is committed. Use PDF / CSV for a printable report, or Re-open to amend.'
              : (
                <>
                  Commit replaces on-hand quantity for scanned products only. Run{' '}
                  <code className="bg-gray-100 px-1 rounded">stash_stock_take_v2.sql</code> in Supabase to enable the audit log and atomic line increments.
                </>
              )}
          </p>
        </>
      )}

      <PreCommitReviewModal
        open={reviewOpen && !!session}
        location={session?.location || 'church_st'}
        locationLabel={session ? LOCATION_LABELS[session.location as StockTakeLocation] || session.location : ''}
        totals={totals}
        missing={missing}
        committing={committing}
        onCancel={() => setReviewOpen(false)}
        onConfirm={performCommit}
      />
    </div>
  );
};

export default StockTakeScanner;
