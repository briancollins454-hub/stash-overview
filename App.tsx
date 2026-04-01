import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useDebounce } from './hooks/useDebounce';
import { useNotifications } from './hooks/useNotifications';
import { useDarkMode } from './hooks/useDarkMode';
import { exportOrdersToCSV } from './services/exportService';
import { fulfillShopifyOrder } from './services/fulfillmentService';
import { evaluateAlerts, loadAlertRules } from './services/alertService';
import { loadReorderPoints, saveReorderPoints, ReorderPoint } from './components/StockAlerts';
import { getNoteCounts } from './services/notesService';
import { fetchShopifyOrders, fetchDecoJobs, fetchSingleDecoJob, fetchBulkDecoJobs, fetchSingleShopifyOrder, fetchOrderTimeline, isEligibleForMapping, standardizeSize } from './services/apiService';
import { fetchShipStationShipments, ShipStationTracking, getCarrierName, getTrackingUrl } from './services/shipstationService';
import { fetchCloudData, saveCloudJobLink, saveCloudOrders, saveCloudMappingBatch, savePhysicalStockItem, deletePhysicalStockItem, saveReturnStockItem, deleteReturnStockItem, saveReferenceProducts, saveProductMapping } from './services/syncService';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getItem as getLocalItem, setItem as setLocalItem } from './services/localStore';
import { UnifiedOrder, DecoJob, DecoItem, ShopifyOrder, PhysicalStockItem, ReturnStockItem, ReferenceProduct } from './types';
import OrderTable from './components/OrderTable';
import SettingsModal, { ApiSettings, HolidayRange } from './components/SettingsModal';
import IntegrationGuide from './components/IntegrationGuide';
import StatsCard from './components/StatsCard';
import SavedFilters from './components/SavedFilters';

// Retry wrapper for lazy imports — auto-reloads on stale chunk failures after deploy
function lazyRetry<T extends React.ComponentType<any>>(importFn: () => Promise<{ default: T }>) {
  return lazy(() => importFn().catch((err) => {
    const lastReload = sessionStorage.getItem('chunk_reload');
    if (!lastReload || Date.now() - Number(lastReload) > 10000) {
      sessionStorage.setItem('chunk_reload', String(Date.now()));
      window.location.reload();
    }
    throw err;
  }));
}

const ProcessAnalyst = lazyRetry(() => import('./components/ProcessAnalyst'));
const EfficiencyDashboard = lazyRetry(() => import('./components/EfficiencyDashboard'));
const MtoDashboard = lazyRetry(() => import('./components/MtoDashboard'));
import ScanConsoleModal, { ScanLog } from './components/ScanConsoleModal';
const DecoDashboard = lazyRetry(() => import('./components/DecoDashboard'));
import MultiSelectFilter from './components/MultiSelectFilter';
const StockManager = lazyRetry(() => import('./components/StockManager'));
const KanbanBoard = lazyRetry(() => import('./components/KanbanBoard'));
const AutoMatchPanel = lazyRetry(() => import('./components/AutoMatchPanel'));
const DuplicateDetector = lazyRetry(() => import('./components/DuplicateDetector'));
const ForecastPanel = lazyRetry(() => import('./components/ForecastPanel'));
const StockAlerts = lazyRetry(() => import('./components/StockAlerts'));
const SupplierReorder = lazyRetry(() => import('./components/SupplierReorder'));
const AlertManager = lazyRetry(() => import('./components/AlertManager'));
const OrderNotes = lazyRetry(() => import('./components/OrderNotes'));
const BatchPrintSheets = lazyRetry(() => import('./components/BatchPrintSheets'));
const PriorityQueue = lazyRetry(() => import('./components/PriorityQueue'));
const ProductionCalendar = lazyRetry(() => import('./components/ProductionCalendar'));
const ReturnsTracker = lazyRetry(() => import('./components/ReturnsTracker'));
const ProfitabilityReport = lazyRetry(() => import('./components/ProfitabilityReport'));
const ClubLeaderboard = lazyRetry(() => import('./components/ClubLeaderboard'));
const LateOrderReport = lazyRetry(() => import('./components/LateOrderReport'));
const EanCoverageReport = lazyRetry(() => import('./components/EanCoverageReport'));
const ArtworkApprovalTracker = lazyRetry(() => import('./components/ArtworkApprovalTracker'));
const ShippingManager = lazyRetry(() => import('./components/ShippingManager'));
const RevenueDashboard = lazyRetry(() => import('./components/RevenueDashboard'));
const AutoJobLinker = lazyRetry(() => import('./components/AutoJobLinker'));
const BatchFulfillment = lazyRetry(() => import('./components/BatchFulfillment'));
const UserManagement = lazyRetry(() => import('./components/UserManagement'));
import CustomerStatusPage, { buildTrackingData } from './components/CustomerStatusPage';
import ErrorBoundary from './components/ErrorBoundary';
import OrderWidget from './components/OrderWidget';
import { 
    RefreshCw, Settings, LayoutDashboard, Search, CheckSquare, 
    AlertTriangle, X, Calendar as CalendarIcon, Square, Package, ShoppingBag, 
    Boxes, CheckCircle2, Loader2, TrendingUp, Link2, ChevronDown, ArrowDownToLine, Percent,
    Zap, Store, LogOut, ShieldCheck, Download, Menu, Moon, Sun, Monitor,
    Bell, Kanban, MessageSquare, Truck
} from 'lucide-react';

const getHolidayDateSet = (ranges: HolidayRange[] = []) => {
    const dates = new Set<string>();
    ranges.forEach(range => {
        const start = new Date(range.start);
        const end = new Date(range.end);
        const curr = new Date(start);
        while (curr <= end) {
            dates.add(curr.toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
        }
    });
    return dates;
};

const isDateInHolidaySet = (date: Date, holidaySet: Set<string>) => {
    return holidaySet.has(date.toISOString().split('T')[0]);
};

// ─── Login Screen (supports Google + Username/Password) ──────────────────────
const LoginScreen: React.FC<{
  signIn: () => void;
  loginWithPassword: (u: string, p: string) => Promise<void>;
  authError: string | null;
}> = ({ signIn, loginWithPassword, authError }) => {
  const [showPasswordLogin, setShowPasswordLogin] = React.useState(false);
  const [loginUsername, setLoginUsername] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [loginLoading, setLoginLoading] = React.useState(false);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    await loginWithPassword(loginUsername, loginPassword);
    setLoginLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 rounded-3xl shadow-2xl border-b-8 border-indigo-600 p-10 text-center animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-8 rotate-3 shadow-lg">
          <ShieldCheck className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">Secure Access</h1>
        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-8 leading-relaxed">
          Stash Shop Sync is restricted to authorized personnel only.
        </p>

        {authError && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[10px] font-black uppercase leading-relaxed">
            <AlertTriangle className="w-4 h-4 inline-block mr-2 mb-0.5" />
            {authError}
          </div>
        )}

        {/* Google Sign-In */}
        <button
          onClick={() => signIn()}
          className="w-full bg-white text-slate-900 py-4 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-indigo-50 transition-all active:scale-95 shadow-xl"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
          Sign in with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        {/* Username/Password Toggle */}
        {!showPasswordLogin ? (
          <button
            onClick={() => setShowPasswordLogin(true)}
            className="w-full bg-slate-800 text-slate-300 py-4 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-slate-700 transition-all active:scale-95 border border-slate-700"
          >
            <ShieldCheck className="w-4 h-4" />
            Sign in with Username
          </button>
        ) : (
          <form onSubmit={handlePasswordLogin} className="space-y-3 text-left">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                required
                autoFocus
                className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="Enter your username"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="Enter your password"
              />
            </div>
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-indigo-500 transition-all active:scale-95 disabled:opacity-50 shadow-lg"
            >
              {loginLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4 rotate-180" />}
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setShowPasswordLogin(false)}
              className="w-full text-[10px] text-slate-500 font-bold uppercase tracking-widest hover:text-slate-300 transition-all py-2"
            >
              Back to options
            </button>
          </form>
        )}

        <div className="mt-10 pt-8 border-t border-slate-800">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-[0.2em]">
            Authorized Domains: marxcorporate.com | stashshop.co.uk
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── Google User Management Wrapper ──────────────────────────────────────────
// Gets a Firebase ID token and passes it to UserManagement so Google-authed admins can manage users
const GoogleUserManagement: React.FC<{ user: any }> = ({ user }) => {
  const [firebaseIdToken, setFirebaseIdToken] = React.useState<string | null>(null);
  const [tokenError, setTokenError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user?.getIdToken) {
      user.getIdToken().then((t: string) => setFirebaseIdToken(t)).catch((e: any) => setTokenError(e.message));
    }
  }, [user]);

  if (tokenError) return <div className="text-center py-20 text-red-400 text-xs font-bold uppercase">{tokenError}</div>;
  if (!firebaseIdToken) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;

  const googleUser = {
    id: `google:${user.email}`,
    firstName: (user.displayName || '').split(' ')[0] || 'Admin',
    lastName: (user.displayName || '').split(' ').slice(1).join(' ') || '',
    username: user.email || '',
    role: 'superuser',
    displayName: user.displayName || user.email || 'Admin',
  };

  return <UserManagement currentUser={googleUser} firebaseIdToken={firebaseIdToken} />;
};

const App: React.FC = () => {
  const { user, isAuthLoading, authError, loginWithGoogle: signIn, loginWithPassword, logout: signOut, customToken, customUserData, isCustomUser } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs = ['dashboard', 'stock', 'efficiency', 'mto', 'deco', 'analyst', 'guide', 'widget', 'kanban', 'intelligence', 'alerts', 'production', 'reports', 'operations', 'revenue', 'autolink', 'fulfill', 'users'];
  const activeTab = validTabs.includes(searchParams.get('tab') || '') ? searchParams.get('tab')! : 'dashboard';
  const setActiveTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'dashboard') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => {
      const defaults: ApiSettings = {
          useLiveData: true,
          shopifyDomain: '',
          shopifyAccessToken: '',
          decoDomain: '',
          decoUsername: '',
          decoPassword: '',
          syncLookbackDays: 365,
          connectionMethod: 'proxy',
          autoRefreshInterval: 5,
          holidayRanges: [
              { id: 'xmas-2025', start: '2025-12-22', end: '2026-01-04', label: 'Christmas Closure' }
          ],
          supabaseUrl: '',
          supabaseAnonKey: ''
      };
      const saved = localStorage.getItem('stash_api_settings');
      if (saved) {
          try {
              const parsed = JSON.parse(saved);
              return { ...defaults, ...parsed };
          } catch (e) { return defaults; }
      }
      return defaults;
  });
  
  const [excludedTags, setExcludedTags] = useState<string[]>([]);
  const [groupingMode, setGroupingMode] = useState<'club' | 'vendor'>('club');
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [showFulfilled, setShowFulfilled] = useState(false);
  const [includeMto, setIncludeMto] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const { notify } = useNotifications();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeQuickFilter, setActiveQuickFilter] = useState<'missing_po' | 'ready' | 'order_complete' | 'stock_ready' | 'partially_ready' | 'late' | 'mapping_gap' | 'overdue5' | 'overdue10' | 'production_after_dispatch' | 'due_soon' | null>(null);
  const [partialThreshold, setPartialThreshold] = useState<number>(1);

  const [rawShopifyOrders, setRawShopifyOrders] = useState<ShopifyOrder[]>([]);
  const [rawDecoJobs, setRawDecoJobs] = useState<DecoJob[]>([]);
  const [shipStationData, setShipStationData] = useState<Map<string, ShipStationTracking>>(new Map());
  const [loading, setLoading] = useState(false);
  const [isDeepSyncRunning, setIsDeepSyncRunning] = useState(false);
  const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);
  const [toastMsg, setToastMsg] = useState<{text: string, type: 'success' | 'error'} | null>(null);
  const [confirmedMatches, setConfirmedMatches] = useState<Record<string, string>>({});
  const [productMappings, setProductMappings] = useState<Record<string, string>>({});
  const [itemJobLinks, setItemJobLinks] = useState<Record<string, string>>({}); 
  const [showSettings, setShowSettings] = useState(false);
  const [physicalStock, setPhysicalStock] = useState<PhysicalStockItem[]>([]);
  const [returnStock, setReturnStock] = useState<ReturnStockItem[]>([]);
  const [referenceProducts, setReferenceProducts] = useState<ReferenceProduct[]>([]);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [missingCloudTables, setMissingCloudTables] = useState<string[]>([]);
  const [widgetOrderId, setWidgetOrderId] = useState<string | null>(null);
  const [isWidgetView, setIsWidgetView] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLog] = useState<ScanLog[]>([]);
  const [scanCount, setScanCount] = useState({ current: 0, total: 0 });
  const [showScanConsole, setShowScanConsole] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const stopScanRef = useRef(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [lastSyncLabel, setLastSyncLabel] = useState<string>('');
  const syncAbortRef = useRef<AbortController | null>(null);

  // New feature state
  const { theme, isDark, setTheme } = useDarkMode();
  const [showAlertManager, setShowAlertManager] = useState(false);
  const [notesOrderId, setNotesOrderId] = useState<string | null>(null);
  const [notesOrderNumber, setNotesOrderNumber] = useState<string>('');
  const [dashboardView, setDashboardView] = useState<'table' | 'kanban'>('table');
  const [reorderPoints, setReorderPoints] = useState<ReorderPoint[]>(() => loadReorderPoints());
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>(() => getNoteCounts());

  useEffect(() => {
    // Detect if we are in a Shopify Admin Block/Action context
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id && id.includes('Order')) {
      setWidgetOrderId(id);
      setIsWidgetView(true);
      setActiveTab('widget');
    }
  }, [setActiveTab]);

  // Customer tracking page detection
  const trackOrderNumber = searchParams.get('track');

  useEffect(() => {
    if (user && widgetOrderId) {
      const loadWidgetOrder = async () => {
        setLoading(true);
        try {
          const order = await fetchSingleShopifyOrder(apiSettings, widgetOrderId);
          if (order) {
            setRawShopifyOrders(prev => {
              const map = new Map(prev.map(o => [o.id, o]));
              map.set(order.id, order);
              return Array.from(map.values());
            });
            
            // Also try to find a linked job
            const commentId = (order.timelineComments || []).join(' ').match(/(?:^|[^0-9])(2\d{5})(?![0-9])/)?.[1];
            if (commentId) {
              const job = await fetchSingleDecoJob(apiSettings, commentId);
              if (job) {
                setRawDecoJobs(prev => {
                  const map = new Map(prev.map(j => [j.jobNumber, j]));
                  map.set(job.jobNumber, job);
                  return Array.from(map.values());
                });
              }
            }
          }
        } catch (e) {
          console.error("Widget load error:", e);
        } finally {
          setLoading(false);
        }
      };
      loadWidgetOrder();
    }
  }, [user, widgetOrderId]);

  const isConfigMissing = false; // Credentials are now server-side

  const loadData = async (isDeepSync: boolean = false, baseOrdersOverride?: ShopifyOrder[]) => {
    if (loading) return;
    if (isConfigMissing) {
        setToastMsg({ text: "API Credentials Missing.", type: "error" });
        return;
    }

    // Abort any in-flight sync
    if (syncAbortRef.current) syncAbortRef.current.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;
    
    setLoading(true);
    if (isDeepSync) setIsDeepSyncRunning(true);
    setSyncStatusMsg(isDeepSync ? 'Rebuilding Archive...' : 'Syncing Recent...');
    
    try {
        let sOrders: ShopifyOrder[] = [];
        let dRecentJobs: DecoJob[] = [];
        
        if (apiSettings.useLiveData) { 
            let sinceDate: string | undefined = undefined;
            const currentBaseOrders = baseOrdersOverride || rawShopifyOrders;

            if (!isDeepSync && currentBaseOrders.length > 0) {
                const latestUpdate = Math.max(...currentBaseOrders.map(o => new Date(o.updatedAt).getTime()), Date.now() - (72 * 60 * 60 * 1000));
                sinceDate = new Date(latestUpdate - 1800000).toISOString();
            }

            // Parallel fetch for speed
            setSyncStatusMsg('Syncing APIs...');
            const [shopifyResult, decoResult, ssResult] = await Promise.allSettled([
                fetchShopifyOrders(apiSettings, sinceDate, (msg) => setSyncStatusMsg(msg), isDeepSync, currentBaseOrders.length),
                fetchDecoJobs(apiSettings, (msg) => setSyncStatusMsg(msg), isDeepSync),
                fetchShipStationShipments(apiSettings)
            ]);

            if (shopifyResult.status === 'fulfilled') {
                sOrders = shopifyResult.value;
            } else {
                setToastMsg({ text: `Shopify Error: ${shopifyResult.reason.message}`, type: 'error' });
            }

            if (decoResult.status === 'fulfilled') {
                dRecentJobs = decoResult.value;
            } else {
                setToastMsg({ text: `Deco Error: ${decoResult.reason.message}`, type: 'error' });
            }

            if (ssResult.status === 'fulfilled' && ssResult.value.length > 0) {
                const ssMap = new Map<string, ShipStationTracking>();
                ssResult.value.forEach(s => ssMap.set(s.orderNumber, s));
                setShipStationData(ssMap);
            }

            const orderMap = new Map<string, ShopifyOrder>();
            if (!isDeepSync) {
                currentBaseOrders.forEach(o => orderMap.set(o.id, o));
            } else {
                // Deep sync: keep cached orders as base, fresh data overwrites
                currentBaseOrders.forEach(o => orderMap.set(o.id, o));
            }
            sOrders.forEach(o => orderMap.set(o.id, o)); 
            const mergedOrders = Array.from(orderMap.values());
            setRawShopifyOrders(mergedOrders);
            setLocalItem('stash_raw_shopify_orders', mergedOrders).catch(console.error);
            
            const existingJobNumbers = new Set(dRecentJobs.map(j => j.jobNumber));
            const mergedDecoJobs = [...dRecentJobs];
            rawDecoJobs.forEach(p => { if (!existingJobNumbers.has(p.jobNumber)) mergedDecoJobs.push(p); });
            setRawDecoJobs(mergedDecoJobs);
            setLocalItem('stash_raw_deco_jobs', mergedDecoJobs).catch(console.error);

            const unfulfilledShopifyOrders = mergedOrders.filter(o => 
                o.fulfillmentStatus !== 'fulfilled' && 
                o.fulfillmentStatus !== 'restocked'
            );

            const linkedJobIdsToSync = new Set<string>();
            const currentLinks: Record<string, string> = itemJobLinks;
            
            unfulfilledShopifyOrders.forEach((o: ShopifyOrder) => {
                const orderIdKey = String(o.id);
                const commentId = (o.timelineComments || []).join(' ').match(/(?:^|[^0-9])(2\d{5})(?![0-9])/)?.[1] || currentLinks[orderIdKey];
                if (commentId) linkedJobIdsToSync.add(commentId);
                
                o.items.forEach((it) => {
                    const itemIdKey = String(it.id);
                    const linkedId = currentLinks[itemIdKey];
                    if (linkedId) linkedJobIdsToSync.add(linkedId);
                });
            });

            const currentJobSet = new Set(dRecentJobs.map(j => j.jobNumber));
            const missingIds = Array.from(linkedJobIdsToSync).filter(id => !currentJobSet.has(id));
            
            if (missingIds.length > 0) {
                setSyncStatusMsg(`Syncing ${missingIds.length} missing jobs...`);
                
                const newFetchedJobs = await fetchBulkDecoJobs(apiSettings, missingIds);

                if (newFetchedJobs.length > 0) {
                    setRawDecoJobs(prev => {
                        const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
                        newFetchedJobs.forEach(j => jobMap.set(j.jobNumber, j));
                        const updated = Array.from(jobMap.values());
                        setLocalItem('stash_raw_deco_jobs', updated).catch(console.error);
                        return updated;
                    });
                }
            }

            if (sOrders.length > 0) {
                saveCloudOrders(apiSettings, mergedOrders).catch(console.error);
            }
        } else {
            const { MOCK_SHOPIFY_ORDERS, MOCK_DECO_JOBS } = await import('./constants');
            setRawShopifyOrders(MOCK_SHOPIFY_ORDERS); 
            setRawDecoJobs(MOCK_DECO_JOBS); 
        }
    } catch (e: any) { 
        if (e.name !== 'AbortError') {
            setToastMsg({ text: `Sync issue: ${e.message}`, type: 'error' });
        }
    } finally { 
        setLoading(false); 
        setIsDeepSyncRunning(false);
        setSyncStatusMsg('');
        setLastSyncTime(Date.now());
        notify('Stash Shop Sync', { body: 'Data sync completed.' });
        // Evaluate alert rules after sync
        try {
          const rules = loadAlertRules();
          const lowStockCount = reorderPoints.filter(rp => {
            const qty = physicalStock.filter(s => s.productCode === rp.productCode).reduce((sum, s) => sum + s.quantity, 0);
            return qty < rp.minQuantity;
          }).length;
          evaluateAlerts(rules, { notOnDeco5Plus: 0, late: 0 }, apiSettings, lowStockCount).catch(console.error);
        } catch {}
    }
  };

  const handleAutoFulfill = async (orderId: string, trackingNumber?: string) => {
    const result = await fulfillShopifyOrder(apiSettings, orderId, trackingNumber);
    if (result.success) {
      setToastMsg({ text: 'Order fulfilled successfully!', type: 'success' });
      // Refresh the order
      const numericId = orderId.includes('/') ? orderId : `gid://shopify/Order/${orderId}`;
      const updated = await fetchSingleShopifyOrder(apiSettings, numericId);
      if (updated) {
        setRawShopifyOrders(prev => {
          const map = new Map(prev.map(o => [o.id, o]));
          map.set(updated.id, updated);
          return Array.from(map.values());
        });
      }
    } else {
      setToastMsg({ text: `Fulfillment failed: ${result.error}`, type: 'error' });
    }
  };

  const handleReorderPointsSave = (points: ReorderPoint[]) => {
    setReorderPoints(points);
    saveReorderPoints(points);
  };

  const handleMarkReordered = (pointId: string) => {
    setReorderPoints(prev => {
      const next = prev.map(rp => rp.id === pointId ? { ...rp, lastReordered: Date.now() } : rp);
      saveReorderPoints(next);
      return next;
    });
    setToastMsg({ text: 'Marked as reordered', type: 'success' });
  };

  const openNotes = (orderId: string, orderNumber: string) => {
    setNotesOrderId(orderId);
    setNotesOrderNumber(orderNumber);
  };

  const handleApplyView = (filters: any) => {
    if (filters.activeQuickFilter !== undefined) setActiveQuickFilter(filters.activeQuickFilter);
    if (filters.showFulfilled !== undefined) setShowFulfilled(filters.showFulfilled);
    if (filters.includeMto !== undefined) setIncludeMto(filters.includeMto);
    if (filters.searchTerm !== undefined) setSearchTerm(filters.searchTerm);
    if (filters.startDate !== undefined) setStartDate(filters.startDate);
    if (filters.endDate !== undefined) setEndDate(filters.endDate);
    if (filters.selectedGroups) setSelectedGroups(new Set(filters.selectedGroups));
    if (filters.groupingMode) setGroupingMode(filters.groupingMode);
    if (filters.partialThreshold !== undefined) setPartialThreshold(filters.partialThreshold);
  };

  // Auto-refresh: delta sync on configurable interval
  useEffect(() => {
    if (!user || isConfigMissing || !apiSettings.autoRefreshInterval) return;
    const intervalMs = (apiSettings.autoRefreshInterval || 5) * 60 * 1000;
    const interval = setInterval(() => {
      if (!loading && !isBulkRefreshing && !isScanning) {
        loadData(false);
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [user, isConfigMissing, loading, isBulkRefreshing, isScanning, apiSettings.autoRefreshInterval]);

  // Visibility-aware refresh: sync when tab regains focus after >2 min
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && lastSyncTime && Date.now() - lastSyncTime > 2 * 60 * 1000) {
        if (!loading && !isBulkRefreshing && !isScanning && user && !isConfigMissing) {
          loadData(false);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [lastSyncTime, loading, isBulkRefreshing, isScanning, user, isConfigMissing]);

  // Update "last synced" label every 30 seconds
  useEffect(() => {
    const updateLabel = () => {
      if (!lastSyncTime) { setLastSyncLabel(''); return; }
      const diff = Math.floor((Date.now() - lastSyncTime) / 1000);
      if (diff < 60) setLastSyncLabel('just now');
      else if (diff < 3600) setLastSyncLabel(`${Math.floor(diff / 60)}m ago`);
      else setLastSyncLabel(`${Math.floor(diff / 3600)}h ago`);
    };
    updateLabel();
    const timer = setInterval(updateLabel, 30000);
    return () => clearInterval(timer);
  }, [lastSyncTime]);

  // Toast auto-dismiss after 5 seconds
  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 5000);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
        searchInput?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        if (!loading && !isBulkRefreshing && user) loadData(false);
      }
      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowScanConsole(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, isBulkRefreshing, user]);

  useEffect(() => {
    const initialize = async () => {
        let initialOrders: ShopifyOrder[] = [];
        try {
            const savedExcluded = localStorage.getItem('stash_excluded_tags');
            if (savedExcluded) setExcludedTags(JSON.parse(savedExcluded));

            // Load from IndexedDB first for instant UI
            const [cachedOrders, cachedJobs] = await Promise.all([
                getLocalItem<ShopifyOrder[]>('stash_raw_shopify_orders'),
                getLocalItem<DecoJob[]>('stash_raw_deco_jobs')
            ]);
            if (cachedOrders) {
                initialOrders = cachedOrders;
                setRawShopifyOrders(cachedOrders);
            }
            if (cachedJobs) setRawDecoJobs(cachedJobs);

            // Load settings from Firestore (tied to user account)
            if (user?.uid) {
                try {
                    setSyncStatusMsg('Loading your settings...');
                    const settingsDoc = await getDoc(doc(db, 'user_settings', user.uid));
                    if (settingsDoc.exists()) {
                        const cloudSettings = settingsDoc.data().settings as Partial<ApiSettings>;
                        if (cloudSettings) {
                            // Only merge non-credential settings from Firestore
                            const { shopifyAccessToken, decoPassword, supabaseAnonKey, shipStationApiSecret, ...safeSettings } = cloudSettings as any;
                            const merged = { ...apiSettings, ...safeSettings };
                            setApiSettings(merged);
                            localStorage.setItem('stash_api_settings', JSON.stringify(merged));
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load cloud settings:', e);
                }
            }

            setSyncStatusMsg('Loading Cloud State...');
            const cloudData = await fetchCloudData(apiSettings);
            if (cloudData) {
                setConfirmedMatches(cloudData.mappings || {});
                setProductMappings(cloudData.productMappings || {});
                setItemJobLinks(cloudData.links || {});
                setPhysicalStock(cloudData.physicalStock || []);
                setReturnStock(cloudData.returnStock || []);
                setReferenceProducts(cloudData.referenceProducts || []);
                setMissingCloudTables(cloudData.missingTables || []);
                if (cloudData.orders && cloudData.orders.length > 0) {
                    // Merge cloud orders with local cache, preferring whichever has more complete data
                    const orderMap = new Map<string, ShopifyOrder>();
                    initialOrders.forEach(o => orderMap.set(o.id, o));
                    cloudData.orders.forEach(o => {
                        const existing = orderMap.get(o.id);
                        if (!existing) {
                            orderMap.set(o.id, o);
                        } else if (!existing.shippingAddress && o.shippingAddress) {
                            orderMap.set(o.id, o);
                        } else if (existing.shippingAddress && !o.shippingAddress) {
                            // keep existing — it has address data
                        } else if (new Date(o.updatedAt) > new Date(existing.updatedAt)) {
                            orderMap.set(o.id, o);
                        }
                    });
                    initialOrders = Array.from(orderMap.values());
                    setRawShopifyOrders(initialOrders);
                }
            }
        } catch (e: any) {
            console.error("Initialization issue:", e);
        }
        
        if (!isConfigMissing) {
            loadData(false, initialOrders);
        }
    };
    initialize();
  }, []);

  useEffect(() => {
      localStorage.setItem('stash_api_settings', JSON.stringify(apiSettings));
      // Save non-credential settings to Firestore so they load on any device
      if (user?.uid) {
          const { shopifyAccessToken, decoPassword, supabaseAnonKey, shipStationApiSecret, ...safeSettings } = apiSettings as any;
          setDoc(doc(db, 'user_settings', user.uid), {
              settings: safeSettings,
              updatedAt: new Date().toISOString(),
              email: user.email
          }, { merge: true }).catch(console.error);
      }
  }, [apiSettings, user]);

  const updatePhysicalStock = (updater: (prev: PhysicalStockItem[]) => PhysicalStockItem[]) => {
      setPhysicalStock(prev => {
          const next = updater(prev);
          {
             const removed = prev.filter(p => !next.find(n => n.id === p.id));
             const addedOrEdited = next.filter(n => {
                 const old = prev.find(p => p.id === n.id);
                 return !old || JSON.stringify(old) !== JSON.stringify(n);
             });
             removed.forEach(r => deletePhysicalStockItem(apiSettings, r.id).catch(console.error));
             addedOrEdited.forEach(a => savePhysicalStockItem(apiSettings, a).catch(console.error));
             if (addedOrEdited.length > 0 || removed.length > 0) {
                 setToastMsg({ text: "Inventory Cloud Sync Successful", type: 'success' });
             }
          }
          return next;
      });
  };

  const updateReturnStock = (updater: (prev: ReturnStockItem[]) => ReturnStockItem[]) => {
      setReturnStock(prev => {
          const next = updater(prev);
          {
             const removed = prev.filter(p => !next.find(n => n.id === p.id));
             const added = next.filter(n => !prev.find(p => p.id === n.id));
             removed.forEach(r => deleteReturnStockItem(apiSettings, r.id).catch(console.error));
             added.forEach(a => saveReturnStockItem(apiSettings, a).catch(console.error));
          }
          return next;
      });
  };

  const updateReferenceProducts = (products: ReferenceProduct[]) => {
      setReferenceProducts(products);
      saveReferenceProducts(apiSettings, products).then(() => {
          setToastMsg({ text: "Master Database Updated", type: 'success' });
      }).catch(console.error);
  };

  const holidaySet = useMemo(() => getHolidayDateSet(apiSettings.holidayRanges), [apiSettings.holidayRanges]);

  const calculateWorkingDays = (startStr: string, endStr: string, holidaySet: Set<string>) => {
      const start = new Date(startStr);
      const end = new Date(endStr);
      start.setHours(0,0,0,0); end.setHours(0,0,0,0);
      let count = 0; const current = new Date(start);
      while (current < end) { 
          const day = current.getDay(); 
          if (day !== 0 && day !== 6 && !isDateInHolidaySet(current, holidaySet)) count++; 
          current.setDate(current.getDate() + 1); 
      }
      return count;
  };

  const getWorkingDaysSLA = (startDate: Date, holidaySet: Set<string>, fulfillmentDate?: string): { daysRemaining: number; targetDateStr: string; targetDate: Date } => {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      let addedDays = 0; let targetDate = new Date(start);
      while (addedDays < 20) { 
          targetDate.setDate(targetDate.getDate() + 1); 
          const day = targetDate.getDay(); 
          if (day !== 0 && day !== 6 && !isDateInHolidaySet(targetDate, holidaySet)) addedDays++; 
      }
      const targetDateStr = targetDate.toLocaleDateString('en-GB');
      const end = fulfillmentDate ? new Date(fulfillmentDate) : new Date(); end.setHours(0, 0, 0, 0);
      let daysPassed = 0; let counterDate = new Date(start);
      while (counterDate < end) { 
          counterDate.setDate(counterDate.getDate() + 1); 
          if (counterDate > end) break; 
          const day = counterDate.getDay(); 
          if (day !== 0 && day !== 6 && !isDateInHolidaySet(counterDate, holidaySet)) daysPassed++;
      }
      return { daysRemaining: 20 - daysPassed, targetDateStr, targetDate };
  };

  const unifiedOrders = useMemo(() => {
      // Pre-index jobs and their items for O(1) lookup
      const jobCache = new Map<string, { job: DecoJob, itemMap: Map<string, DecoItem[]> }>();
      
      rawDecoJobs.forEach(j => {
          const itemMap = new Map<string, DecoItem[]>();
          j.items.forEach(item => {
              const id = (item.vendorSku || item.productCode || item.name || '').trim().toLowerCase();
              if (!itemMap.has(id)) itemMap.set(id, []);
              itemMap.get(id)!.push(item);
          });
          jobCache.set(j.jobNumber, { job: j, itemMap });
      });
      
      const currentLinks: Record<string, string> = itemJobLinks;
      const currentMatches: Record<string, string> = confirmedMatches;
      
      return rawShopifyOrders.map((order: ShopifyOrder): UnifiedOrder => {
          const orderIdKey = String(order.id);
          const timelineJobId = (order.timelineComments || []).join(' ').match(/(?:^|[^0-9])(2\d{5})(?![0-9])/)?.[1];
          const mainJobId = currentLinks[orderIdKey] || timelineJobId;
          
          const isMtoOrder = order.tags.includes('MTO') || order.items.some(i => i.name.toLowerCase().includes('mto'));
          const sla = getWorkingDaysSLA(new Date(order.date), holidaySet, order.closedAt);
          
          const mappedItems = order.items.map((item: any) => { 
              const uniqueMappingKey: string = String(item.id);
              const skuKey: string = `${order.orderNumber}-${item.sku}`;
              const isMtoItem = item.name.toLowerCase().includes('mto');
              
              const specificJobId = currentLinks[uniqueMappingKey];
              const effectiveJobId = specificJobId || (!isMtoItem ? mainJobId : undefined);
              
              const jobData = (effectiveJobId && jobCache.has(effectiveJobId)) ? jobCache.get(effectiveJobId) : undefined;
              const effectiveJob = jobData?.job;
              const manualDecoId = currentMatches[uniqueMappingKey] || currentMatches[skuKey];
              
              let matchedDeco = undefined;
              if (manualDecoId && effectiveJob && jobData) {
                  // Handle unique mapping with index (SKU@@@index)
                  if (manualDecoId.includes('@@@')) {
                      const [sku, idxStr] = manualDecoId.split('@@@');
                      const idx = parseInt(idxStr);
                      const d = effectiveJob.items[idx];
                      if (d) {
                          const dId = (d.vendorSku || d.productCode || d.name || '').trim().toLowerCase();
                          if (dId === sku.trim().toLowerCase()) {
                              matchedDeco = d;
                          }
                      }
                  }
                  
                  // Fallback to SKU matching if not matched by index (for legacy or AI mappings)
                  if (!matchedDeco && manualDecoId !== '__NO_MAP__') {
                      const targetId = manualDecoId.split('@@@')[0].trim().toLowerCase();
                      const candidates = jobData.itemMap.get(targetId) || [];
                      
                      if (candidates.length > 1) {
                          // If multiple items have same SKU, try to find best name match
                          const sName = item.name.toLowerCase();
                          matchedDeco = candidates.find(c => c.name.toLowerCase().includes(sName) || sName.includes(c.name.toLowerCase())) || candidates[0];
                      } else if (candidates.length === 1) {
                          matchedDeco = candidates[0];
                      }
                  }
              }

              return {
                  ...item,
                  itemDecoJobId: effectiveJobId,
                  itemDecoData: effectiveJob,
                  decoStatus: matchedDeco?.status,
                  linkedDecoItemId: manualDecoId,
                  decoReceived: matchedDeco?.isReceived,
                  decoProduced: matchedDeco?.isProduced,
                  decoShipped: matchedDeco?.isShipped,
                  procurementStatus: matchedDeco?.procurementStatus,
                  productionStatus: matchedDeco?.productionStatus,
                  shippingStatus: matchedDeco?.shippingStatus,
                  candidateDecoItems: effectiveJob?.items || []
              };
          });

          const eligibleItems = mappedItems.filter(i => isEligibleForMapping(i.name, i.productType) && i.itemStatus !== 'fulfilled');
          const stockItems = eligibleItems.filter(i => !i.name.toLowerCase().includes('mto'));
          const mtoItems = eligibleItems.filter(i => i.name.toLowerCase().includes('mto'));
          
          const isReady = (i: any) => i.decoProduced || i.decoShipped || i.linkedDecoItemId === '__NO_MAP__';
          
          // Refined "Stock Ready" logic:
          // Must have at least one unfulfilled stock item, AND all such stock items must be ready,
          // AND the order must contain at least one unfulfilled MTO item (which is why the order is still open).
          const isStockDispatchReady = stockItems.length > 0 && stockItems.every(isReady) && mtoItems.length > 0;
          
          const mappedCount = eligibleItems.filter(i => !!i.linkedDecoItemId).length;
          const itemJobIds = Array.from(new Set(mappedItems.map(i => i.itemDecoJobId).filter(Boolean)));
          const resolvedDecoJobId = mainJobId || itemJobIds[0];

          let decoJob: DecoJob | undefined = resolvedDecoJobId ? jobCache.get(resolvedDecoJobId)?.job : undefined;
          let currentStatus = 'Not Ordered';
          if (decoJob) {
              currentStatus = decoJob.status;
          } else if (resolvedDecoJobId) {
              currentStatus = 'Awaiting Deco Detail...'; 
          } else if (order.fulfillmentStatus === 'fulfilled') {
              currentStatus = 'Shipped';
          } else if (20 - sla.daysRemaining < 5) {
              currentStatus = 'Not Ordered';
          }

          return {
              shopify: { ...order, items: mappedItems },
              deco: decoJob,
              matchStatus: (decoJob || resolvedDecoJobId) ? 'linked' : 'unlinked',
              productionStatus: currentStatus,
              completionPercentage: eligibleItems.length > 0 ? Math.round((eligibleItems.filter(i => i.itemStatus === 'fulfilled' || isReady(i)).length / eligibleItems.length) * 100) : 100,
              stockCompletionPercentage: stockItems.length > 0 ? Math.round((stockItems.filter(i => i.itemStatus === 'fulfilled' || isReady(i)).length / stockItems.length) * 100) : 100,
              mtoCompletionPercentage: mtoItems.length > 0 ? Math.round((mtoItems.filter(i => i.itemStatus === 'fulfilled' || i.readyMtoCount || isReady(i)).length / mtoItems.length) * 100) : 100,
              mappedPercentage: eligibleItems.length > 0 ? Math.round((mappedCount / eligibleItems.length) * 100) : 100,
              mappedCount,
              eligibleCount: eligibleItems.length,
              readyStockCount: stockItems.filter(i => i.itemStatus === 'fulfilled' || isReady(i)).length,
              totalStockCount: stockItems.length,
              readyMtoCount: mtoItems.filter(i => i.itemStatus === 'fulfilled' || i.readyMtoCount || isReady(i)).length,
              totalMtoCount: mtoItems.length,
              daysInProduction: 20 - sla.daysRemaining,
              daysRemaining: sla.daysRemaining,
              slaTargetDate: sla.targetDateStr,
              clubName: order.tags.find(t => !excludedTags.includes(t)) || 'Other',
              decoJobId: resolvedDecoJobId,
              isMto: isMtoOrder,
              hasStockItems: stockItems.length > 0,
              isStockDispatchReady, 
              fulfillmentDate: order.closedAt,
              fulfillmentDuration: order.closedAt ? calculateWorkingDays(order.date, order.closedAt, holidaySet) : undefined,
              productionDueDate: decoJob?.productionDueDate,
              shipStationTracking: (() => {
                  const ssData = shipStationData.get(order.orderNumber);
                  if (!ssData) return undefined;
                  return {
                      trackingNumber: ssData.trackingNumber,
                      carrier: ssData.carrier,
                      carrierCode: ssData.carrier,
                      shipDate: ssData.shipDate,
                      shippingCost: ssData.cost,
                  };
              })(),
              _rawOrderDate: new Date(order.date),
              _rawDispatchDate: sla.targetDate,
              _rawProductionDate: decoJob?.productionDueDate ? new Date(decoJob.productionDueDate) : undefined
          } as UnifiedOrder;
      });
  }, [rawShopifyOrders, rawDecoJobs, confirmedMatches, itemJobLinks, excludedTags, apiSettings.holidayRanges, shipStationData]);

  const allAvailableTags = useMemo(() => {
      const tags = new Set<string>();
      rawShopifyOrders.forEach(o => o.tags.forEach(t => tags.add(t)));
      return Array.from(tags).sort();
  }, [rawShopifyOrders]);

  const handleRefreshJob = async (jobId: string) => {
      try {
          const job = await fetchSingleDecoJob(apiSettings, jobId);
          if (job) {
              setRawDecoJobs(prev => {
                  const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
                  jobMap.set(job.jobNumber, job);
                  return Array.from(jobMap.values());
              });
              return job;
          }
      } catch (e: any) {
          console.error(`Sync Error for Job ${jobId}:`, e.message);
      }
      return null;
  };

  const handleBulkStatusSync = async () => {
    if (isBulkRefreshing || loading) return;
    
    // 1. Identify active orders that have links
    const activeLinkedOrders = unifiedOrders.filter(o => 
        o.shopify.fulfillmentStatus !== 'fulfilled' && 
        (o.decoJobId || o.shopify.items.some(i => i.itemDecoJobId))
    );

    if (activeLinkedOrders.length === 0) {
        setToastMsg({ text: "No active linked jobs to refresh.", type: 'error' });
        return;
    }

    setIsBulkRefreshing(true);
    setScanProgress(0);
    setScanLog([{ 
        id: 'start', 
        message: `Starting Global Sync for ${activeLinkedOrders.length} active orders...`, 
        type: 'info', 
        timestamp: new Date().toLocaleTimeString() 
    }]);
    setScanCount({ current: 0, total: activeLinkedOrders.length });
    setShowScanConsole(true);
    stopScanRef.current = false;

    // Use a set to track unique job numbers to avoid redundant API hits for the same batch
    const uniqueJobIdsToRefresh = new Set<string>();
    activeLinkedOrders.forEach(o => {
        if (o.decoJobId) uniqueJobIdsToRefresh.add(o.decoJobId);
        o.shopify.items.forEach(i => {
            if (i.itemDecoJobId) uniqueJobIdsToRefresh.add(i.itemDecoJobId);
        });
    });

    const jobIdsArray = Array.from(uniqueJobIdsToRefresh);
    setScanCount({ current: 0, total: jobIdsArray.length });

    const concurrency = 3; // Safe concurrency for Deco
    const updatedJobs: DecoJob[] = [];

    for (let i = 0; i < jobIdsArray.length; i += concurrency) {
        if (stopScanRef.current) {
            setScanLog(prev => [...prev, { id: 'stop', message: 'Sync stopped by user.', type: 'warning', timestamp: new Date().toLocaleTimeString() }]);
            break;
        }

        const batch = jobIdsArray.slice(i, i + concurrency);
        setScanCount(prev => ({ ...prev, current: Math.min(i + batch.length, jobIdsArray.length) }));
        setScanProgress(Math.round((Math.min(i + batch.length, jobIdsArray.length) / jobIdsArray.length) * 100));

        const results = await Promise.all(batch.map(async (jobId) => {
            try {
                const updated = await fetchSingleDecoJob(apiSettings, jobId);
                if (updated) {
                    setScanLog(prev => [...prev, { 
                        id: `${jobId}-${Date.now()}`, 
                        message: `Job #${jobId}: Sync OK (${updated.status})`, 
                        type: 'success', 
                        timestamp: new Date().toLocaleTimeString() 
                    }]);
                    return updated;
                }
            } catch (e: any) {
                setScanLog(prev => [...prev, { 
                    id: `${jobId}-fail`, 
                    message: `Job #${jobId}: API Error`, 
                    type: 'error', 
                    timestamp: new Date().toLocaleTimeString() 
                }]);
            }
            return null;
        }));

        results.forEach(j => { if (j) updatedJobs.push(j); });

        // MANDATORY THROTTLE: 1.5s between batches to stay under Deco API limits
        if (i + concurrency < jobIdsArray.length) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    // Update state ONCE at the end to prevent massive re-renders during sync
    if (updatedJobs.length > 0) {
        setRawDecoJobs(prev => {
            const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
            updatedJobs.forEach(j => jobMap.set(j.jobNumber, j));
            const next = Array.from(jobMap.values());
            setLocalItem('stash_raw_deco_jobs', next).catch(console.error);
            return next;
        });
    }

    setIsBulkRefreshing(false);
    notify('Stash Shop Sync', { body: `Status refresh complete. ${updatedJobs.length} jobs updated.` });
    setScanLog(prev => [...prev, { 
        id: 'end', 
        message: `Global Sync Finished. Statuses mirrored to Shopify dashboard.`, 
        type: 'success', 
        timestamp: new Date().toLocaleTimeString() 
    }]);
  };

  const handleManualJobLink = async (orderIdOrIds: string | string[], jobId: string) => {
      const ids: string[] = Array.isArray(orderIdOrIds) ? orderIdOrIds : [orderIdOrIds];
      setItemJobLinks((prev: Record<string, string>) => {
          const next: Record<string, string> = { ...prev };
          ids.forEach((id: string) => { next[id] = jobId; });
          return next;
      });
      ids.forEach((id: string) => saveCloudJobLink(apiSettings, id, jobId).catch(console.error));
      handleRefreshJob(jobId);
  };

  const handleBulkConfirmMatch = (mappings: { itemKey: string, decoId: string }[], jobId?: string, learnedPatterns?: Record<string, string>) => {
      setConfirmedMatches((prev: Record<string, string>) => {
          const next: Record<string, string> = { ...prev };
          mappings.forEach(m => { next[m.itemKey] = m.decoId; });
          return next;
      });

      if (learnedPatterns && Object.keys(learnedPatterns).length > 0) {
          setProductMappings(prev => {
              const next = { ...prev };
              Object.entries(learnedPatterns).forEach(([sPattern, dPattern]) => { next[sPattern] = dPattern; });
              return next;
          });
          Object.entries(learnedPatterns).forEach(([sPattern, dPattern]) => saveProductMapping(apiSettings, sPattern, dPattern).catch(console.error));
      }

      if (jobId) {
          setItemJobLinks(prev => {
              const next = { ...prev };
              mappings.forEach(m => { next[m.itemKey] = jobId; });
              return next;
          });
          mappings.forEach(m => saveCloudJobLink(apiSettings, m.itemKey, jobId).catch(console.error));
          handleRefreshJob(jobId);
      }
      if (mappings.length > 0) {
          saveCloudMappingBatch(apiSettings, mappings.map(m => ({ item_id: m.itemKey, deco_id: m.decoId }))).catch(console.error);
      }
  };

  const handleBulkScan = async (orderIds: string[]) => {
    if (isScanning) return;
    setIsScanning(true); setScanProgress(0); setScanLog([]); setScanCount({ current: 0, total: orderIds.length });
    setShowScanConsole(true); stopScanRef.current = false;
    
    const concurrency = 5;
    let completed = 0;
    
    for (let i = 0; i < orderIds.length; i += concurrency) {
        if (stopScanRef.current) break;
        const batch = orderIds.slice(i, i + concurrency);
        
        await Promise.all(batch.map(async (id) => {
            try {
                const { comments } = await fetchOrderTimeline(apiSettings, id);
                const match = comments.join(' ').match(/(?:^|[^0-9])(2\d{5})(?![0-9])/);
                if (match) {
                    setScanLog(prev => [...prev, { id: `${id}-${Date.now()}`, message: `Order #${id.split('/').pop()}: Job #${match[1]} Found`, type: 'success', timestamp: new Date().toLocaleTimeString() }]);
                    handleManualJobLink(id, match[1]);
                }
            } catch (e: any) {
                setScanLog(prev => [...prev, { id: `${id}-err-${Date.now()}`, message: `Error scanning order #${id.split('/').pop()}`, type: 'error', timestamp: new Date().toLocaleTimeString() }]);
            }
        }));
        
        completed += batch.length;
        setScanCount({ current: Math.min(completed, orderIds.length), total: orderIds.length });
        setScanProgress(Math.round((Math.min(completed, orderIds.length) / orderIds.length) * 100));
        
        if (i + concurrency < orderIds.length) {
            await new Promise(r => setTimeout(r, 300)); // Reduced delay
        }
    }
    setIsScanning(false);
  };

  const stats = useMemo(() => {
      let baseSet = unifiedOrders;
      if (!includeMto) baseSet = baseSet.filter(o => !o.isMto || o.hasStockItems);
      const active = baseSet.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled');
      const fulfilled7d = baseSet.filter(o => o.shopify.fulfillmentStatus === 'fulfilled' && o.fulfillmentDate && (Date.now() - new Date(o.fulfillmentDate).getTime() < 7 * 24 * 60 * 60 * 1000));
      return {
          notOnDeco: active.filter(o => !o.decoJobId).length,
          notOnDeco5Plus: active.filter(o => !o.decoJobId && o.daysInProduction >= 5).length,
          notOnDeco10Plus: active.filter(o => !o.decoJobId && o.daysInProduction >= 10).length,
          orderComplete: active.filter(o => o.completionPercentage === 100).length,
          stockReady: active.filter(o => o.isStockDispatchReady).length,
          partiallyReady: active.filter(o => o.completionPercentage >= partialThreshold && o.completionPercentage < 100).length,
          late: active.filter(o => o.daysRemaining < 0).length,
          dueSoon: active.filter(o => o.daysRemaining >= 0 && o.daysRemaining <= 5).length,
          readyForShipping: active.filter(o => o.productionStatus === 'Ready for Shipping' || o.completionPercentage === 100 || (o.completionPercentage >= partialThreshold && o.completionPercentage < 100) || o.isStockDispatchReady).length,
          unfulfilled: active.length,
          productionAfterDispatch: active.filter(o => o.decoJobId && o._rawProductionDate && o._rawDispatchDate && o._rawProductionDate.getTime() > o._rawDispatchDate.getTime() + 12 * 60 * 60 * 1000).length,
          fulfilled7d: fulfilled7d.length,
          mappingGap: active.filter(o => !!o.decoJobId && (o.mappedPercentage ?? 0) < 100).length,
          partiallyFulfilled7d: baseSet.filter(o => o.shopify.fulfillmentStatus === 'partial').length
      };
  }, [unifiedOrders, includeMto, partialThreshold]);

  const baseFilteredOrders = useMemo(() => {
      let filtered = [...unifiedOrders];
      
      // Filter out orders that have ONLY excluded tags
      if (excludedTags.length > 0) {
          filtered = filtered.filter(o => {
              if (o.shopify.tags.length === 0) return true; // Keep orders with no tags
              return o.shopify.tags.some(t => !excludedTags.includes(t));
          });
      }

      if (!includeMto) filtered = filtered.filter(o => !o.isMto || o.hasStockItems);
      if (showFulfilled) filtered = filtered.filter(o => o.shopify.fulfillmentStatus === 'fulfilled' && o.fulfillmentDate && (Date.now() - new Date(o.fulfillmentDate).getTime() < 7 * 24 * 60 * 60 * 1000));
      else {
          filtered = filtered.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled');
          if (activeQuickFilter === 'missing_po') filtered = filtered.filter(o => !o.decoJobId);
          else if (activeQuickFilter === 'ready') filtered = filtered.filter(o => o.productionStatus === 'Ready for Shipping' || o.completionPercentage === 100 || (o.completionPercentage >= partialThreshold && o.completionPercentage < 100) || o.isStockDispatchReady);
          else if (activeQuickFilter === 'order_complete') filtered = filtered.filter(o => o.completionPercentage === 100);
          else if (activeQuickFilter === 'stock_ready') filtered = filtered.filter(o => o.isStockDispatchReady);
          else if (activeQuickFilter === 'partially_ready') filtered = filtered.filter(o => o.completionPercentage >= partialThreshold && o.completionPercentage < 100);
          else if (activeQuickFilter === 'late') filtered = filtered.filter(o => o.daysRemaining < 0);
          else if (activeQuickFilter === 'mapping_gap') filtered = filtered.filter(o => !!o.decoJobId && (o.mappedPercentage ?? 0) < 100);
          else if (activeQuickFilter === 'overdue5') filtered = filtered.filter(o => !o.decoJobId && o.daysInProduction >= 5);
          else if (activeQuickFilter === 'overdue10') filtered = filtered.filter(o => !o.decoJobId && o.daysInProduction >= 10);
          else if (activeQuickFilter === 'production_after_dispatch') filtered = filtered.filter(o => o.decoJobId && o._rawProductionDate && o._rawDispatchDate && o._rawProductionDate.getTime() > o._rawDispatchDate.getTime() + 12 * 60 * 60 * 1000);
          else if (activeQuickFilter === 'due_soon') filtered = filtered.filter(o => o.daysRemaining >= 0 && o.daysRemaining <= 5);
      }
      if (startDate && endDate) {
          const s = new Date(startDate); const e = new Date(endDate); e.setHours(23, 59, 59, 999);
          filtered = filtered.filter(o => { const d = new Date(o.shopify.date); return d >= s && d <= e; });
      }
      if (debouncedSearch) { 
          const lower = debouncedSearch.toLowerCase(); 
          filtered = filtered.filter(o => o.shopify.orderNumber.includes(lower) || o.shopify.customerName.toLowerCase().includes(lower) || (o.decoJobId && o.decoJobId.includes(lower))); 
      }
      return filtered;
  }, [unifiedOrders, debouncedSearch, showFulfilled, includeMto, activeQuickFilter, startDate, endDate, partialThreshold]);

  const tableOrders = useMemo(() => {
      let filtered = [...baseFilteredOrders];
      if (selectedGroups.size > 0) {
          filtered = filtered.filter(o => {
              if (groupingMode === 'club') {
                  return o.shopify.tags.some(t => selectedGroups.has(t)) || (selectedGroups.has('Other') && (o.shopify.tags.length === 0 || o.shopify.tags.every(t => excludedTags.includes(t))));
              } else {
                  const vendors = o.shopify.items.map(i => i.vendor || 'No Vendor');
                  return vendors.some(v => selectedGroups.has(v));
              }
          });
      }
      return filtered.sort((a, b) => {
          const timeA = a._rawOrderDate ? a._rawOrderDate.getTime() : 0;
          const timeB = b._rawOrderDate ? b._rawOrderDate.getTime() : 0;
          return timeB - timeA;
      });
  }, [baseFilteredOrders, selectedGroups, excludedTags, groupingMode]);

  const groupOptions = useMemo(() => { 
      const counts: Record<string, number> = {}; 
      const allUniqueItems = new Set<string>();
      let otherCount = 0;

      // Get all possible tags/vendors from all unified orders to ensure visibility
      unifiedOrders.forEach(o => {
          if (groupingMode === 'club') {
              const validTags = o.shopify.tags.filter(t => !excludedTags.includes(t));
              if (validTags.length === 0) allUniqueItems.add('Other');
              else validTags.forEach(t => allUniqueItems.add(t));
          } else {
              const vendors = new Set<string>();
              o.shopify.items.forEach(i => { if (i.vendor) vendors.add(i.vendor); });
              if (vendors.size === 0) allUniqueItems.add('No Vendor');
              else vendors.forEach(v => allUniqueItems.add(v));
          }
      });

      // Count only currently filtered orders
      baseFilteredOrders.forEach(o => { 
          if (groupingMode === 'club') {
              const validTags = o.shopify.tags.filter(t => !excludedTags.includes(t));
              if (validTags.length === 0) otherCount++;
              else {
                  validTags.forEach(tag => { 
                      counts[tag] = (counts[tag] || 0) + 1;
                  });
              }
          } else {
              const vendors = new Set<string>();
              o.shopify.items.forEach(i => {
                  if (i.vendor) vendors.add(i.vendor);
              });
              if (vendors.size === 0) otherCount++;
              else {
                  vendors.forEach(vendor => {
                      counts[vendor] = (counts[vendor] || 0) + 1;
                  });
              }
          }
      }); 

      const options = Array.from(allUniqueItems).map(item => ({ 
          label: item, 
          count: (item === 'Other' || item === 'No Vendor') ? otherCount : (counts[item] || 0) 
      })).sort((a, b) => {
          if (a.label === 'Other' || a.label === 'No Vendor') return 1;
          if (b.label === 'Other' || b.label === 'No Vendor') return -1;
          return b.count - a.count || a.label.localeCompare(b.label);
      }); 
      
      return options;
  }, [unifiedOrders, baseFilteredOrders, excludedTags, groupingMode]);

  // Customer tracking page — public, no auth needed
  if (trackOrderNumber) {
    const trackedOrder = unifiedOrders.find(o => o.shopify.orderNumber === trackOrderNumber);
    const trackingData = trackedOrder ? buildTrackingData(trackedOrder) : null;
    return <CustomerStatusPage trackingData={trackingData} loading={loading && !trackedOrder} error={!loading && !trackedOrder ? 'Order not found' : undefined} />;
  }

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
          <p className="text-indigo-300 font-black uppercase tracking-widest animate-pulse">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen signIn={signIn} loginWithPassword={loginWithPassword} authError={authError} />;
  }

  if (isWidgetView && widgetOrderId) {
    const widgetOrder = unifiedOrders.find(o => o.shopify.id === widgetOrderId);
    if (loading && !widgetOrder) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center p-8">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Loading Order Data...</p>
          </div>
        </div>
      );
    }
    if (!widgetOrder) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-8">
              <div className="text-center">
                <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-4" />
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Order not found.</p>
                <button onClick={() => window.location.reload()} className="mt-4 text-[10px] font-black text-indigo-600 uppercase underline">Retry</button>
              </div>
            </div>
        );
    }
    return (
        <OrderWidget 
            order={widgetOrder}
            shopifyDomain={apiSettings.shopifyDomain}
            onManualLink={handleManualJobLink}
            onRefreshJob={async (id) => { await handleRefreshJob(id); }} 
            onSearchJob={async (id) => { 
              const job = await fetchSingleDecoJob(apiSettings, id); 
              if(job) { 
                setRawDecoJobs(prev => { 
                  const map = new Map(prev.map(j => [j.jobNumber, j])); 
                  map.set(job.jobNumber, job); 
                  return Array.from(map.values()); 
                }); 
              } 
              return job; 
            }}
            onItemJobLink={async (orderNumber, itemId, jobId) => { 
              setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId })); 
              saveCloudJobLink(apiSettings, itemId, jobId); 
              handleRefreshJob(jobId); 
            }}
        />
    );
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans relative ${isDark ? 'dark bg-slate-900 text-slate-100' : 'bg-[#f3f4f6]'}`}>
        {loading && <div className="fixed top-0 left-0 w-full h-1 z-[100] bg-indigo-100 overflow-hidden"><div className="h-full bg-indigo-600 animate-[loading_2s_ease-in-out_infinite] origin-left"></div></div>}
        <style>{`@keyframes loading { 0% { transform: scaleX(0); } 50% { transform: scaleX(0.7); } 100% { transform: scaleX(1); transform: translateX(100%); } } @keyframes pulse-opacity { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } } .animate-pulse-sync { animation: pulse-opacity 1.5s ease-in-out infinite; }`}</style>
        {toastMsg && <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-xl shadow-2xl z-[200] text-white flex items-center gap-3 font-bold border-b-4 ${toastMsg.type === 'success' ? 'bg-green-600 border-green-800' : 'bg-red-600 border-red-800'}`}>{toastMsg.text} <button onClick={() => setToastMsg(null)} className="ml-2 opacity-50 hover:opacity-100"><X className="w-4 h-4" /></button></div>}
        
        <SettingsModal 
          isOpen={showSettings} 
          onClose={() => setShowSettings(false)} 
          onSave={(s, e) => {
            setApiSettings(s); 
            setExcludedTags(e); 
            localStorage.setItem('stash_excluded_tags', JSON.stringify(e));
          }} 
          currentApiSettings={apiSettings} 
          currentExcludedTags={excludedTags} 
          availableTags={allAvailableTags} 
          onTriggerFullSync={() => loadData(true)} 
        />
        <ScanConsoleModal isOpen={showScanConsole} onClose={() => setShowScanConsole(false)} isScanning={isScanning || isBulkRefreshing} progress={scanProgress} current={scanCount.current} total={scanCount.total} logs={scanLogs} onStop={() => stopScanRef.current = true} />
        
        <nav className="bg-[#2d2d5f] text-white px-3 sm:px-4 md:px-6 h-14 md:h-16 flex items-center justify-between sticky top-0 z-50 shadow-md">
            <div className="flex items-center gap-2 shrink-0"><div className="bg-white/10 p-1.5 rounded"><LayoutDashboard className="w-5 h-5 text-indigo-300" /></div><h1 className="text-base sm:text-lg md:text-xl font-bold tracking-widest uppercase">STASH <span className="font-light opacity-80 hidden sm:inline">SHOP OVERVIEW</span></h1></div>
            
            {/* Mobile hamburger */}
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="lg:hidden p-2 text-indigo-200 hover:text-white"><Menu className="w-5 h-5" /></button>
            
            {/* Desktop nav */}
            <div className="hidden lg:flex items-center gap-1 overflow-x-auto scrollbar-hide">
                {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'kanban', label: 'KANBAN' }, { id: 'intelligence', label: 'INTEL' }, { id: 'production', label: 'PRODUCTION' }, { id: 'reports', label: 'REPORTS' }, { id: 'operations', label: 'OPS' }, { id: 'stock', label: 'STOCK' }, { id: 'efficiency', label: 'EFFICIENCY' }, { id: 'mto', label: 'MTO' }, { id: 'deco', label: 'DECO' }, { id: 'revenue', label: 'REVENUE' }, { id: 'autolink', label: 'LINKER' }, { id: 'fulfill', label: 'FULFILL' }, { id: 'analyst', label: 'ANALYST' }, ...(isCustomUser && (customUserData?.role === 'superuser' || customUserData?.role === 'admin') ? [{ id: 'users', label: 'USERS' }] : !isCustomUser ? [{ id: 'users', label: 'USERS' }] : [])].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-3 py-2 rounded text-[10px] font-bold tracking-widest transition-all uppercase ${activeTab === tab.id ? 'bg-[#3e3e7a] text-white shadow-inner' : 'text-indigo-200 hover:text-white hover:bg-white/5'}`}>{tab.label}</button>
                ))}
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button onClick={() => setShowAlertManager(true)} className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors" title="Alert Manager"><Bell className="w-4 h-4" /></button>
                <button onClick={() => setShowSettings(true)} className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors" title="Settings (⌘,)"><Settings className="w-4 h-4" /></button>
                <button onClick={() => setTheme(isDark ? 'light' : 'dark')} className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors" title="Toggle Dark Mode">
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                {lastSyncLabel && (
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded ${
                        lastSyncTime && Date.now() - lastSyncTime > 10 * 60 * 1000
                            ? 'text-amber-300 bg-amber-500/10'
                            : 'text-indigo-400 bg-indigo-500/10'
                    }`} title="Last successful sync">
                        Synced {lastSyncLabel}
                    </span>
                )}
                
                <div className="w-px h-6 bg-white/10 mx-2"></div>
                
                <div className="flex items-center gap-3 pl-2">
                    <div className="flex flex-col items-end">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white leading-none">{user.displayName || 'User'}</span>
                        <span className="text-[8px] font-bold text-indigo-300 uppercase leading-none mt-1">{user.email}</span>
                    </div>
                    {user.photoURL ? (
                        <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-indigo-400/30 shadow-lg" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center border border-indigo-400/30 shadow-lg">
                            <span className="text-[10px] font-black text-white">{user.email?.[0].toUpperCase()}</span>
                        </div>
                    )}
                    <button 
                        onClick={() => signOut()} 
                        className="p-2 text-indigo-300 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                        title="Logout"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </nav>
        
        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
            <div className="lg:hidden fixed inset-0 z-[60] bg-black/50" onClick={() => setMobileMenuOpen(false)}>
                <div className="absolute top-14 left-0 right-0 bg-[#2d2d5f] border-t border-indigo-500/20 shadow-2xl p-4 space-y-1 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'kanban', label: 'KANBAN' }, { id: 'intelligence', label: 'INTEL' }, { id: 'production', label: 'PRODUCTION' }, { id: 'reports', label: 'REPORTS' }, { id: 'operations', label: 'OPS' }, { id: 'stock', label: 'STOCK' }, { id: 'efficiency', label: 'EFFICIENCY' }, { id: 'mto', label: 'MTO' }, { id: 'deco', label: 'DECO' }, { id: 'revenue', label: 'REVENUE' }, { id: 'autolink', label: 'LINKER' }, { id: 'fulfill', label: 'FULFILL' }, { id: 'analyst', label: 'ANALYST' }, ...(isCustomUser && (customUserData?.role === 'superuser' || customUserData?.role === 'admin') ? [{ id: 'users', label: 'USERS' }] : !isCustomUser ? [{ id: 'users', label: 'USERS' }] : [])].map(tab => (
                        <button key={tab.id} onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }} className={`w-full text-left px-4 py-2.5 sm:py-3 rounded-lg text-xs font-bold tracking-widest uppercase transition-all ${activeTab === tab.id ? 'bg-[#3e3e7a] text-white' : 'text-indigo-200 hover:bg-white/5'}`}>{tab.label}</button>
                    ))}
                    <div className="border-t border-indigo-500/20 pt-3 mt-3 flex items-center justify-between">
                        <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }} className="text-indigo-200 text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Settings className="w-4 h-4" /> Settings</button>
                        <button onClick={() => { signOut(); setMobileMenuOpen(false); }} className="text-red-300 text-xs font-bold uppercase tracking-widest flex items-center gap-2"><LogOut className="w-4 h-4" /> Logout</button>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'dashboard' && (
            <div className="bg-white border-b border-gray-200 px-3 sm:px-4 md:px-6 py-3 sm:py-4 shadow-sm space-y-3 sm:space-y-4">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <MultiSelectFilter 
                        title={groupingMode === 'club' ? "Filter Tags" : "Filter Vendors"} 
                        options={groupOptions} 
                        selectedValues={selectedGroups} 
                        onChange={setSelectedGroups} 
                        showZeroByDefault={true}
                    />
                    
                    <div className="flex items-center border border-gray-300 rounded-lg bg-white overflow-hidden shadow-sm flex-wrap sm:flex-nowrap">
                        <div className="px-3 py-2 border-r border-gray-200 bg-gray-50 flex items-center gap-2 cursor-pointer hover:bg-gray-100 transition-colors">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600">Order Date</span>
                            <ChevronDown className="w-3 h-3 text-gray-400" />
                        </div>
                        <div className="flex items-center px-2 sm:px-3 gap-1 sm:gap-2 flex-wrap sm:flex-nowrap">
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[120px] sm:w-32 text-[11px] font-bold border-none focus:ring-0 p-0 bg-transparent uppercase text-gray-900" />
                            <CalendarIcon className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
                            <span className="text-gray-300 font-light">—</span>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[120px] sm:w-32 text-[11px] font-bold border-none focus:ring-0 p-0 bg-transparent uppercase text-gray-900" />
                            <CalendarIcon className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
                            {(startDate || endDate) && <button onClick={() => {setStartDate(''); setEndDate('')}} className="ml-1 sm:ml-2 p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500"><X className="w-3 h-3"/></button>}
                        </div>
                    </div>

                    <button onClick={() => setIncludeMto(!includeMto)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${includeMto ? 'bg-purple-50 text-purple-700 border-purple-200 shadow-inner' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}>{includeMto ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />} MTO Inclusion</button>
                    <button onClick={() => setShowFulfilled(!showFulfilled)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${showFulfilled ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-inner' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}>{showFulfilled ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />} Show Fulfilled</button>
                    <button 
                        onClick={() => {
                            setGroupingMode(prev => prev === 'club' ? 'vendor' : 'club');
                            setSelectedGroups(new Set()); 
                        }} 
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${groupingMode === 'vendor' ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-inner' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
                    >
                        <Store className="w-3.5 h-3.5" /> 
                        {groupingMode === 'club' ? 'Group by Vendor' : 'Group by Club'}
                    </button>
                    <div className="flex-1 min-w-0 sm:min-w-[200px] relative"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search Orders, Job IDs, Customers..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold uppercase tracking-widest text-gray-900 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none" /></div>
                    <div className="flex flex-wrap items-center gap-2">
                        {loading && !isDeepSyncRunning && <div className="flex items-center gap-2 px-2 sm:px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100 text-[10px] font-bold text-indigo-600 uppercase tracking-widest shadow-sm"><span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>{syncStatusMsg || 'SYNCING...'}</div>}
                        {isDeepSyncRunning && <div className="flex items-center gap-2 px-2 sm:px-3 py-2 bg-amber-50 rounded-lg border border-amber-200 text-[10px] font-bold text-amber-700 uppercase tracking-widest shadow-sm"><Loader2 className="w-3.5 h-3.5 animate-spin" />{syncStatusMsg || 'DEEP SCANNING...'}</div>}
                        {!loading && <div className="flex items-center gap-2 px-2 sm:px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-100 text-[10px] font-bold text-emerald-600 uppercase tracking-widest shadow-sm"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>{rawShopifyOrders.length} ARCHIVED</div>}
                        
                        <div className="flex border border-gray-200 rounded-lg overflow-hidden shadow-sm bg-white">
                            <button onClick={() => handleBulkStatusSync()} disabled={loading || isBulkRefreshing} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 text-[10px] font-black transition-all uppercase tracking-widest border-r border-gray-100 ${isBulkRefreshing ? 'bg-emerald-100 text-emerald-800' : 'text-emerald-600 hover:bg-emerald-50'}`}>
                                <Zap className={`w-3.5 h-3.5 ${isBulkRefreshing ? 'animate-pulse' : ''}`} /> <span className="hidden sm:inline">Status</span> Refresh
                            </button>
                            <button onClick={() => loadData(false)} title="Quick Sync: Last 120 days Shopify / 600 Deco Jobs" disabled={loading} className="flex items-center gap-2 px-4 py-2 text-[10px] font-black transition-all uppercase tracking-widest border-r border-gray-100 text-gray-600 hover:bg-gray-50">
                                <RefreshCw className={`w-3.5 h-3.5 ${loading && !isDeepSyncRunning ? 'animate-spin' : ''}`} /> Sync
                            </button>
                            <button onClick={() => { if(window.confirm("Deep scan will fetch updates across the full 365-day window. Your cached data will be preserved and updated. Proceed?")) loadData(true); }} disabled={loading} className={`flex items-center gap-2 px-4 py-2 text-[10px] font-black transition-all uppercase tracking-widest ${isDeepSyncRunning ? 'bg-amber-100 text-amber-800' : 'text-indigo-500 hover:bg-indigo-50'}`}>
                                {isDeepSyncRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5" />} Deep Scan
                            </button>
                        </div>
                        <button onClick={() => exportOrdersToCSV(tableOrders)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-black text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-gray-200 transition-all uppercase tracking-widest shadow-sm bg-white" title="Export filtered orders to CSV">
                            <Download className="w-3.5 h-3.5" /> Export
                        </button>
                    </div>
                </div>
                {/* Saved Filters */}
                <div className="pt-2">
                  <SavedFilters
                    currentFilters={{
                      activeQuickFilter,
                      showFulfilled,
                      includeMto,
                      searchTerm,
                      startDate,
                      endDate,
                      selectedGroups: Array.from(selectedGroups),
                      groupingMode,
                      partialThreshold,
                    }}
                    onApplyView={handleApplyView}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 pt-4">
                    <StatsCard title="NOT ON DECO" value={stats.notOnDeco} icon={<AlertTriangle />} colorClass="bg-red-500" onClick={() => setActiveQuickFilter(prev => prev === 'missing_po' ? null : 'missing_po')} isActive={activeQuickFilter === 'missing_po'}>
                        <div className="space-y-1.5 pt-1">
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'overdue5' ? null : 'overdue5'); }} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:text-red-700 cursor-pointer transition-colors ${activeQuickFilter === 'overdue5' ? 'text-red-700 font-black' : 'text-gray-400'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'overdue5' ? 'fill-red-500 text-red-500' : ''}`} /> 5+ DAYS ({stats.notOnDeco5Plus})
                            </div>
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'overdue10' ? null : 'overdue10'); }} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:text-red-700 cursor-pointer transition-colors ${activeQuickFilter === 'overdue10' ? 'text-red-700 font-black' : 'text-gray-400'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'overdue10' ? 'fill-red-700 text-red-700' : ''}`} /> 10+ DAYS ({stats.notOnDeco10Plus})
                            </div>
                        </div>
                    </StatsCard>
                    <StatsCard title="MAPPING GAPS" value={stats.mappingGap} icon={<Link2 />} colorClass="bg-amber-500" onClick={() => setActiveQuickFilter(prev => prev === 'mapping_gap' ? null : 'mapping_gap')} isActive={activeQuickFilter === 'mapping_gap'}>
                        <div className="space-y-1.5 pt-1"><p className="text-[9px] font-bold text-amber-700 uppercase leading-tight">Job ID exists but items need mapping to track progress.</p></div>
                    </StatsCard>
                    <StatsCard title="READY TO SHIP" value={stats.readyForShipping} icon={<Package />} colorClass="bg-emerald-500" onClick={() => { setPartialThreshold(1); setActiveQuickFilter(prev => prev === 'ready' ? null : 'ready'); }} isActive={activeQuickFilter === 'ready'}>
                         <div className="space-y-1.5 pt-1">
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'order_complete' ? null : 'order_complete'); }} className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest hover:text-emerald-700 cursor-pointer transition-colors ${activeQuickFilter === 'order_complete' ? 'text-emerald-700' : 'text-emerald-600'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'order_complete' ? 'fill-emerald-500 text-emerald-500' : ''}`} /> ORDER COMPLETE ({stats.orderComplete})
                            </div>
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'stock_ready' ? null : 'stock_ready'); }} className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest hover:text-blue-700 cursor-pointer transition-colors ${activeQuickFilter === 'stock_ready' ? 'text-blue-700' : 'text-blue-500'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'stock_ready' ? 'fill-blue-500 text-blue-500' : ''}`} /> STOCK READY ({stats.stockReady})
                            </div>
                            <div onClick={(e) => { e.stopPropagation(); const isOpening = activeQuickFilter !== 'partially_ready'; setPartialThreshold(1); setActiveQuickFilter(prev => prev === 'partially_ready' ? null : 'partially_ready'); }} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:text-indigo-700 cursor-pointer transition-colors ${activeQuickFilter === 'partially_ready' ? 'text-indigo-700 font-black' : 'text-gray-400'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'partially_ready' ? 'fill-indigo-500 text-indigo-500' : ''}`} /> PARTIALLY READY ({stats.partiallyReady})
                            </div>
                            {activeQuickFilter === 'partially_ready' && (
                                <div className="mt-2 pt-2 border-t border-indigo-100 flex items-center gap-2 animate-in slide-in-from-top-1" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">MIN % READY:</span>
                                    <div className="flex items-center bg-slate-900 rounded px-1.5 py-0.5 border border-indigo-500/30">
                                        <input 
                                            type="number" 
                                            min="1" 
                                            max="99" 
                                            value={partialThreshold} 
                                            onChange={(e) => setPartialThreshold(Math.min(99, Math.max(1, parseInt(e.target.value) || 1)))} 
                                            className="bg-transparent border-none text-[10px] font-black text-indigo-400 w-8 p-0 focus:ring-0 text-center" 
                                        />
                                        <Percent className="w-2.5 h-2.5 text-indigo-500" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </StatsCard>
                    <StatsCard title="UNFULFILLED" value={stats.unfulfilled} icon={<ShoppingBag />} colorClass="bg-blue-500" onClick={() => { setActiveQuickFilter(null); setShowFulfilled(false); }} isActive={!showFulfilled && !activeQuickFilter}>
                         <div className="space-y-1.5 pt-1">
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'late' ? null : 'late'); }} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:text-blue-700 cursor-pointer transition-colors ${activeQuickFilter === 'late' ? 'text-blue-700 font-black' : 'text-gray-400'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'late' ? 'fill-blue-500 text-blue-500' : ''}`} /> LATE (20D+) ({stats.late})
                            </div>
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'production_after_dispatch' ? null : 'production_after_dispatch'); }} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:text-red-700 cursor-pointer transition-colors ${activeQuickFilter === 'production_after_dispatch' ? 'text-red-700 font-black' : 'text-gray-400'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'production_after_dispatch' ? 'fill-red-500 text-red-500' : ''}`} /> PRODUCTION AFTER DISPATCH ({stats.productionAfterDispatch})
                            </div>
                            <div onClick={(e) => { e.stopPropagation(); setActiveQuickFilter(prev => prev === 'due_soon' ? null : 'due_soon'); }} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:text-amber-700 cursor-pointer transition-colors ${activeQuickFilter === 'due_soon' ? 'text-amber-700 font-black' : 'text-gray-400'}`}>
                                <Square className={`w-3.5 h-3.5 ${activeQuickFilter === 'due_soon' ? 'fill-amber-500 text-amber-500' : ''}`} /> DUE SOON ({stats.dueSoon})
                            </div>
                        </div>
                    </StatsCard>
                    <StatsCard title="FULFILLED (7D)" value={stats.fulfilled7d} icon={<CheckCircle2 />} colorClass="bg-emerald-500" onClick={() => { setShowFulfilled(true); setActiveQuickFilter(null); }} isActive={showFulfilled}>
                         <div className="space-y-1.5 pt-1">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600"><TrendingUp className="w-3.5 h-3.5" /> Recent Activity</div>
                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-purple-600"><Boxes className="w-3.5 h-3.5" /> {stats.partiallyFulfilled7d} PARTIAL</div>
                        </div>
                    </StatsCard>
                </div>
            </div>
        )}

        {missingCloudTables.length > 0 && (
            <div className="mx-4 md:mx-8 mt-4 bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in slide-in-from-top-2">
                <div className="flex items-center gap-4">
                    <div className="bg-amber-500 p-2 rounded-lg text-white shadow-lg">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div>
                        <h4 className="text-sm font-black text-amber-900 uppercase tracking-widest">Supabase Setup Incomplete</h4>
                        <p className="text-[10px] text-amber-700 font-bold uppercase">
                            Missing Tables: <span className="text-amber-900 italic">{missingCloudTables.join(', ')}</span>. 
                            Cloud sync is disabled for these features.
                        </p>
                    </div>
                </div>
                <button 
                    onClick={() => setActiveTab('guide')}
                    className="px-6 py-2 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md hover:bg-amber-700 transition-all"
                >
                    Fix in Integration Guide
                </button>
            </div>
        )}

        <main className="flex-1 p-2 sm:p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
            {activeTab === 'dashboard' && (
              <OrderTable 
                orders={tableOrders} 
                excludedTags={excludedTags} 
                groupingMode={groupingMode}
                shopifyDomain={apiSettings.shopifyDomain} 
                onOpenNotes={openNotes}
                noteCounts={noteCounts} 
                onConfirmMatch={(i, d) => handleBulkConfirmMatch([{itemKey: i, decoId: d}])} 
                onRefreshJob={async (id) => { await handleRefreshJob(id); }} 
                onSearchJob={async (id) => { 
                  const job = await fetchSingleDecoJob(apiSettings, id); 
                  if(job) { 
                    setRawDecoJobs(prev => { 
                      const map = new Map(prev.map(j => [j.jobNumber, j])); 
                      map.set(job.jobNumber, job); 
                      return Array.from(map.values()); 
                    }); 
                  } 
                  return job; 
                }} 
                onBulkMatch={(m, lp) => handleBulkConfirmMatch(m, m[0]?.jobId, lp)} 
                onManualLink={handleManualJobLink} 
                onItemJobLink={async (orderNumber, itemId, jobId) => { 
                  setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId })); 
                  saveCloudJobLink(apiSettings, itemId, jobId); 
                  handleRefreshJob(jobId); 
                }} 
                onNavigateToJob={(id) => {setSearchTerm(id); setActiveTab('deco');}} 
                onBulkScan={handleBulkScan} 
                sortOption="date_desc" 
                onSortChange={() => {}} 
                selectedOrderIds={selectedOrderIds}
                onSelectionChange={setSelectedOrderIds}
                productMappings={productMappings}
                confirmedMatches={confirmedMatches}
              />
            )}
            {activeTab === 'stock' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Stock Manager Error"><StockManager physicalStock={physicalStock} setPhysicalStock={updatePhysicalStock} returnStock={returnStock} setReturnStock={updateReturnStock} referenceProducts={referenceProducts} setReferenceProducts={updateReferenceProducts} orders={unifiedOrders} availableTags={allAvailableTags} /></ErrorBoundary></Suspense>}
            {activeTab === 'efficiency' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Dashboard Error"><EfficiencyDashboard orders={unifiedOrders} excludedTags={excludedTags} /></ErrorBoundary></Suspense>}
            {activeTab === 'mto' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><MtoDashboard orders={unifiedOrders} excludedTags={excludedTags} shopifyDomain={apiSettings.shopifyDomain} onBulkScan={handleBulkScan} onManualLink={handleManualJobLink} onRefreshJob={async (id) => { await handleRefreshJob(id); }} onItemJobLink={async (orderNumber, itemId, jobId) => { setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId })); saveCloudJobLink(apiSettings, itemId, jobId); handleRefreshJob(jobId); }} selectedFilterTags={selectedGroups} /></Suspense>}
            {activeTab === 'deco' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
              <DecoDashboard 
                apiSettings={apiSettings} 
                orders={unifiedOrders} 
                excludedTags={excludedTags} 
                onManualLink={handleManualJobLink} 
                onConfirmMatch={(i, d) => handleBulkConfirmMatch([{itemKey: i, decoId: d}])} 
                onBulkMatch={(m, lp) => handleBulkConfirmMatch(m, undefined, lp)} 
                onSearchJob={async (id) => { 
                  const job = await fetchSingleDecoJob(apiSettings, id); 
                  if(job) { 
                    setRawDecoJobs(prev => { 
                      const map = new Map(prev.map(j => [j.jobNumber, j])); 
                      map.set(job.jobNumber, job); 
                      return Array.from(map.values()); 
                    }); 
                  } 
                  return job; 
                }} 
                onRefreshJob={async (id) => { await handleRefreshJob(id); }} 
                initialSearchId={searchTerm} 
                onClearInitialSearch={() => setSearchTerm('')} 
                selectedFilterTags={selectedGroups} 
                selectedOrderIds={selectedOrderIds}
                onSelectionChange={setSelectedOrderIds}
                productMappings={productMappings}
                confirmedMatches={confirmedMatches}
              />
            </Suspense>)}
            {activeTab === 'analyst' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Analyst Error"><ProcessAnalyst orders={unifiedOrders} /></ErrorBoundary></Suspense>}
            {activeTab === 'guide' && <ErrorBoundary fallbackTitle="Guide Error"><IntegrationGuide onComplete={() => setActiveTab('dashboard')} /></ErrorBoundary>}

            {/* Kanban Board */}
            {activeTab === 'kanban' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Kanban Error">
                  <KanbanBoard
                    orders={unifiedOrders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled')}
                    shopifyDomain={apiSettings.shopifyDomain}
                    onManualLink={handleManualJobLink}
                    onNavigateToJob={(id) => { setSearchTerm(id); setActiveTab('deco'); }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Intelligence Tab: Auto-Match, Duplicates, Forecast */}
            {activeTab === 'intelligence' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <div className="space-y-6">
                  <ErrorBoundary fallbackTitle="Auto-Match Error">
                    <AutoMatchPanel
                      orders={unifiedOrders}
                      productMappings={productMappings}
                      onApplyMatches={(m, jobId, lp) => handleBulkConfirmMatch(m, jobId, lp)}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Duplicate Detection Error">
                    <DuplicateDetector
                      orders={unifiedOrders}
                      shopifyDomain={apiSettings.shopifyDomain}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Forecast Error">
                    <ForecastPanel
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                </div>
              </Suspense>
            )}

            {/* Stock tab now also includes Alerts & Supplier */}
            {activeTab === 'alerts' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <div className="space-y-6">
                  <ErrorBoundary fallbackTitle="Stock Alerts Error">
                    <StockAlerts
                      physicalStock={physicalStock}
                      reorderPoints={reorderPoints}
                      onSaveReorderPoints={handleReorderPointsSave}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Supplier Reorder Error">
                    <SupplierReorder
                      physicalStock={physicalStock}
                      reorderPoints={reorderPoints}
                      onMarkReordered={handleMarkReordered}
                    />
                  </ErrorBoundary>
                </div>
              </Suspense>
            )}

            {/* Production Tab: Print Sheets, Priority Queue, Calendar */}
            {activeTab === 'production' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <div className="space-y-6">
                  <ErrorBoundary fallbackTitle="Priority Queue Error">
                    <PriorityQueue
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                      userEmail={user?.email || 'unknown'}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Production Calendar Error">
                    <ProductionCalendar
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Batch Print Error">
                    <BatchPrintSheets
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                </div>
              </Suspense>
            )}

            {/* Reports Tab: Profitability, Club Leaderboard, Late Orders */}
            {activeTab === 'reports' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <div className="space-y-6">
                  <ErrorBoundary fallbackTitle="Profitability Error">
                    <ProfitabilityReport
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Club Leaderboard Error">
                    <ClubLeaderboard
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Late Order Report Error">
                    <LateOrderReport
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="EAN Coverage Error">
                    <EanCoverageReport
                      orders={unifiedOrders}
                      settings={apiSettings}
                      physicalStock={physicalStock}
                      referenceProducts={referenceProducts}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                </div>
              </Suspense>
            )}

            {/* Operations Tab: Returns, Artwork, Shipping */}
            {activeTab === 'operations' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <div className="space-y-6">
                  <ErrorBoundary fallbackTitle="Returns Tracker Error">
                    <ReturnsTracker
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                      userEmail={user?.email || 'unknown'}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Artwork Approval Error">
                    <ArtworkApprovalTracker
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                      userEmail={user?.email || 'unknown'}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Shipping Error">
                    <ShippingManager
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                </div>
              </Suspense>
            )}

            {/* Revenue Dashboard Tab */}
            {activeTab === 'revenue' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Revenue Dashboard Error">
                  <RevenueDashboard
                    orders={unifiedOrders}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Auto Job Linker Tab */}
            {activeTab === 'autolink' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Auto Linker Error">
                  <AutoJobLinker
                    orders={unifiedOrders}
                    decoJobs={rawDecoJobs}
                    settings={apiSettings}
                    itemJobLinks={itemJobLinks}
                    onLink={(orderNumber, itemId, jobId) => {
                      setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId }));
                      saveCloudJobLink(apiSettings, itemId, jobId);
                      handleRefreshJob(jobId);
                    }}
                    onBulkLink={(links) => {
                      setItemJobLinks((prev: Record<string, string>) => {
                        const next = { ...prev };
                        links.forEach(l => { next[l.itemId] = l.jobId; });
                        return next;
                      });
                      links.forEach(l => saveCloudJobLink(apiSettings, l.itemId, l.jobId));
                    }}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Batch Fulfillment Tab */}
            {activeTab === 'fulfill' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Batch Fulfillment Error">
                  <BatchFulfillment
                    orders={unifiedOrders}
                    settings={apiSettings}
                    onFulfilled={async (orderId) => {
                      const numericId = orderId.includes('/') ? orderId : `gid://shopify/Order/${orderId}`;
                      const updated = await fetchSingleShopifyOrder(apiSettings, numericId);
                      if (updated) {
                        setRawShopifyOrders(prev => {
                          const map = new Map(prev.map(o => [o.id, o]));
                          map.set(updated.id, updated);
                          return Array.from(map.values());
                        });
                      }
                    }}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* User Management Tab */}
            {activeTab === 'users' && user && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="User Management Error">
                  {isCustomUser && customUserData && customToken ? (
                    <UserManagement currentUser={customUserData} token={customToken} />
                  ) : (
                    <GoogleUserManagement user={user} />
                  )}
                </ErrorBoundary>
              </Suspense>
            )}
        </main>
        <Suspense fallback={null}>
          <AlertManager isOpen={showAlertManager} onClose={() => setShowAlertManager(false)} />
        </Suspense>

        {/* Order Notes Popover */}
        {notesOrderId && user && (
          <div className="fixed bottom-4 right-4 z-[150]">
            <Suspense fallback={null}>
              <OrderNotes
                orderId={notesOrderId}
                orderNumber={notesOrderNumber}
                authorEmail={user.email || 'unknown'}
                settings={apiSettings}
                onClose={() => { setNotesOrderId(null); setNoteCounts(getNoteCounts()); }}
              />
            </Suspense>
          </div>
        )}
    </div>
  );
};

export default App;