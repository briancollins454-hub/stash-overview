import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useDebounce } from './hooks/useDebounce';
import { useNotifications } from './hooks/useNotifications';
import { useDarkMode } from './hooks/useDarkMode';
import { exportOrdersToCSV } from './services/exportService';
import { evaluateAlerts, loadAlertRules } from './services/alertService';
import { loadReorderPoints, saveReorderPoints, ReorderPoint } from './components/StockAlerts';
import { getNoteCounts } from './services/notesService';
import { fetchShopifyOrders, fetchAllUnfulfilledOrders, fetchDecoJobs, fetchSingleDecoJob, fetchBulkDecoJobs, fetchSingleShopifyOrder, fetchOrderTimeline, searchDecoByName, isEligibleForMapping, standardizeSize, enrichDecoStitchBatch } from './services/apiService';
import { fetchShipStationShipments, ShipStationTracking, getCarrierName, getTrackingUrl } from './services/shipstationService';
import { fetchCloudData, saveCloudOrders, saveCloudDecoJobs, savePhysicalStockItem, deletePhysicalStockItem, saveReturnStockItem, deleteReturnStockItem, saveReferenceProducts, fetchStitchCache, saveStitchCache } from './services/syncService';
import { enqueueMappingUpsert, enqueueJobLinkUpsert, enqueuePatternUpsert, flushPending, getPendingCount, getPendingOverlay } from './services/pendingSyncQueue';
import { initSupabase } from './services/supabase';
import { startRealtime, stopRealtime } from './services/realtimeService';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getItem as getLocalItem, setItem as setLocalItem, clearAll as clearLocalDB } from './services/localStore';
import { UnifiedOrder, DecoJob, DecoItem, ShopifyOrder, PhysicalStockItem, ReturnStockItem, ReferenceProduct } from './types';
import { autoMatch } from './services/autoMatchService';
import OrderTable from './components/OrderTable';
import SettingsModal, { ApiSettings, HolidayRange } from './components/SettingsModal';
import IntegrationGuide from './components/IntegrationGuide';
import StatsCard from './components/StatsCard';
import WorkingDaysPlanner from './components/WorkingDaysPlanner';
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
const ShopifyInventory = lazyRetry(() => import('./components/ShopifyInventory'));
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
const CarrierPerformanceReport = lazyRetry(() => import('./components/CarrierPerformanceReport'));
const BottleneckReport = lazyRetry(() => import('./components/BottleneckReport'));
const CompletionTracker = lazyRetry(() => import('./components/CompletionTracker'));
const DecoNotesIntelligence = lazyRetry(() => import('./components/DecoNotesIntelligence'));
const PaymentStatusSync = lazyRetry(() => import('./components/PaymentStatusSync'));
const CapacityForecast = lazyRetry(() => import('./components/CapacityForecast'));
const SeasonalDemandCalendar = lazyRetry(() => import('./components/SeasonalDemandCalendar'));
const ArtworkApprovalTracker = lazyRetry(() => import('./components/ArtworkApprovalTracker'));
const ShippingManager = lazyRetry(() => import('./components/ShippingManager'));
const RevenueDashboard = lazyRetry(() => import('./components/RevenueDashboard'));
const AutoJobLinker = lazyRetry(() => import('./components/AutoJobLinker'));
const BatchFulfillment = lazyRetry(() => import('./components/BatchFulfillment'));
const FinancialDashboard = lazyRetry(() => import('./components/FinancialDashboard'));
const SalesAnalytics = lazyRetry(() => import('./components/SalesAnalytics'));
const ShippedNotInvoiced = lazyRetry(() => import('./components/ShippedNotInvoiced'));
const CreditBlockList = lazyRetry(() => import('./components/CreditBlockList'));
const UnpaidOrders = lazyRetry(() => import('./components/UnpaidOrders'));
const UserManagement = lazyRetry(() => import('./components/UserManagement'));
const CommandCenter = lazyRetry(() => import('./components/CommandCenter'));
const MorningBriefing = lazyRetry(() => import('./components/MorningBriefing'));
const PriorityBoard = lazyRetry(() => import('./components/PriorityBoard'));
const DigestManager = lazyRetry(() => import('./components/DigestManager'));
const ProductionIntelligence = lazyRetry(() => import('./components/ProductionIntelligence'));
const DecoProductionTable = lazyRetry(() => import('./components/DecoProductionTable'));
const SlackFeeds = lazyRetry(() => import('./components/SlackFeeds'));
const VoiceAssistant = lazyRetry(() => import('./components/VoiceAssistant'));
const CloudHealth = lazyRetry(() => import('./components/CloudHealth'));
const MobileSummary = lazyRetry(() => import('./components/MobileSummary'));
const ProductionIssueLog = lazyRetry(() => import('./components/ProductionIssueLog'));
const WholesalerLookup = lazyRetry(() => import('./components/WholesalerLookup'));
import NotificationBell from './components/NotificationBell';
import CustomerStatusPage, { buildTrackingData } from './components/CustomerStatusPage';
import ErrorBoundary from './components/ErrorBoundary';
import OrderWidget from './components/OrderWidget';
import { 
    RefreshCw, Settings, LayoutDashboard, Search, CheckSquare, 
    AlertTriangle, X, Calendar as CalendarIcon, Square, Package, ShoppingBag, 
    Boxes, CheckCircle2, Loader2, TrendingUp, Link2, ChevronDown, ArrowDownToLine, Percent,
    Zap, Store, LogOut, ShieldCheck, Download, Menu, Moon, Sun, Monitor,
    Bell, BellRing, Kanban, MessageSquare, Truck, BookOpen, PoundSterling
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

  const googleUser: import('./components/UserManagement').AppUser = {
    id: `google:${user.email}`,
    firstName: (user.displayName || '').split(' ')[0] || 'Admin',
    lastName: (user.displayName || '').split(' ').slice(1).join(' ') || '',
    username: user.email || '',
    role: 'superuser',
    displayName: user.displayName || user.email || 'Admin',
    allowedTabs: ['dashboard','command','kanban','intelligence','production','shop-floor','reports','operations','stock','inventory','efficiency','mto','deco','revenue','autolink','fulfill','analyst','finance','sales','users','manual','alerts','settings','briefing','priority','digest','shipped-not-invoiced','credit-block','unpaid-orders'],
  };

  return <UserManagement currentUser={googleUser} firebaseIdToken={firebaseIdToken} />;
};

/**
 * An order is "ready to ship" when either:
 *   - all of its Deco-produced items are at 100% completion, OR
 *   - it is a pure-stock order whose stock items are ready to dispatch.
 *
 * This is its own bucket, distinct from "Unfulfilled" — otherwise ready-to-ship
 * orders show up in BOTH the Ready to Ship card and the Unfulfilled card and
 * the dashboard double-counts.
 */
const isReadyToShip = (o: UnifiedOrder): boolean =>
    !!((o.decoJobId && (o.eligibleCount ?? 0) > 0 && o.completionPercentage === 100) || o.isStockDispatchReady);

const App: React.FC = () => {
  const { user, isAuthLoading, authError, loginWithGoogle: signIn, loginWithPassword, logout: signOut, customToken, customUserData, isCustomUser } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs = ['dashboard', 'summary', 'stock', 'inventory', 'efficiency', 'mto', 'deco', 'analyst', 'guide', 'widget', 'kanban', 'intelligence', 'alerts', 'production', 'shop-floor', 'reports', 'operations', 'revenue', 'autolink', 'fulfill', 'finance', 'sales', 'users', 'manual', 'command', 'briefing', 'priority', 'digest', 'shipped-not-invoiced', 'credit-block', 'unpaid-orders', 'cloud-health', 'issues', 'wholesale'];
  // Permissions: Google users = superuser (all tabs), custom users = their allowed_tabs
  const userAllowedTabs: string[] | null = isCustomUser && customUserData ? (customUserData.allowedTabs || null) : null;
  const isTabAllowed = useCallback((tabId: string) => {
    if (!isCustomUser) return true; // Google auth = superuser = all
    if (!userAllowedTabs) return true; // No restrictions set
    return userAllowedTabs.includes(tabId);
  }, [isCustomUser, userAllowedTabs]);
  const activeTab = (() => {
    const param = searchParams.get('tab') || '';
    const tab = validTabs.includes(param) ? param : 'dashboard';
    // If user doesn't have access to requested tab, fall back to dashboard
    if (tab !== 'dashboard' && !isTabAllowed(tab)) return 'dashboard';
    return tab;
  })();
  // Tab changes push a new URL by default so the browser back button walks
  // back through the user's tab history rather than leaving the app entirely.
  // Pass { replace: true } for programmatic redirects on first load (mobile
  // auto-redirect, widget bootstrap, etc.) where adding a history entry would
  // be confusing — back should take the user out, not bounce them between
  // states they never explicitly chose.
  const setActiveTab = useCallback((tab: string, opts?: { replace?: boolean }) => {
    if (tab !== 'dashboard' && !isTabAllowed(tab)) return; // Block navigation to disallowed tabs
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'dashboard') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: opts?.replace ?? false });
  }, [setSearchParams, isTabAllowed]);

  // Mobile auto-redirect: first time a phone-sized client lands on the
  // dashboard with no explicit ?tab=, send them to the Mobile Summary
  // page (if their account has access). Honoured once per session so a
  // user who manually navigates away stays where they put themselves.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams.get('tab')) return; // explicit tab — respect it
    if (!isTabAllowed('summary')) return;
    try {
      if (sessionStorage.getItem('mobileSummary.redirectedThisSession') === '1') return;
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (!isMobile) return;
      sessionStorage.setItem('mobileSummary.redirectedThisSession', '1');
      // Replace, not push — back from the auto-redirected mobile summary
      // should leave the app, not bounce the user back to the dashboard
      // they never asked to see.
      setActiveTab('summary', { replace: true });
    } catch {
      /* sessionStorage unavailable — skip the redirect rather than break boot */
    }
    // We deliberately only run this on first mount; subsequent navigation
    // uses setActiveTab directly and should not be hijacked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
          autoRefreshInterval: 0,
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
  const [isEnrichingProduction, setIsEnrichingProduction] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navDropdown, setNavDropdown] = useState<string | null>(null);
  const navDropRef = useRef<HTMLDivElement>(null);
  const stopScanRef = useRef(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [lastSyncLabel, setLastSyncLabel] = useState<string>('');
  const syncAbortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const autoRefreshRef = useRef<() => void>(() => {});

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
      // Widget bootstrap from a deep link — don't add a history entry for it,
      // back should leave the embedding page rather than land on the dashboard.
      setActiveTab('widget', { replace: true });
    }
  }, [setActiveTab]);

  // Close nav dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navDropRef.current && !navDropRef.current.contains(e.target as Node)) setNavDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  // Dedicated production enrichment: fetches decoration types + stitch counts for ALL jobs
  const handleEnrichProduction = useCallback(async () => {
    if (isEnrichingProduction || !apiSettings.useLiveData) return;
    setIsEnrichingProduction(true);
    setEnrichMsg('Loading cache...');
    try {
      const stitchCache = await fetchStitchCache();

      // Re-enrich every job that still lacks decoration types, regardless of cache
      const jobs = rawDecoJobs;
      const needsEnrichment = jobs
        .filter(j => !j.items.some(i => i.decorationType && i.stitchCount))
        .map(j => j.jobNumber);

      if (needsEnrichment.length === 0) {
        setEnrichMsg('All jobs already enriched');
        setTimeout(() => { setIsEnrichingProduction(false); setEnrichMsg(''); }, 2000);
        return;
      }

      setEnrichMsg(`Enriching 0/${needsEnrichment.length}...`);
      const newEntries = await enrichDecoStitchBatch(
        apiSettings,
        needsEnrichment,
        (done, total) => setEnrichMsg(`Enriching ${done}/${total}...`),
      );

      // Save to Supabase cache
      await saveStitchCache(newEntries);

      // Apply enriched data to state
      const withData = newEntries.filter(e => e.items.length > 0);
      if (withData.length > 0) {
        setRawDecoJobs(prev => {
          const updated = prev.map(job => {
            const entry = newEntries.find(e => e.job_number === job.jobNumber);
            if (!entry || entry.items.length === 0) return job;
            const updatedItems = job.items.map((item, idx) => {
              const match = entry.items.find(c => c.lineIndex === idx);
              if (!match) return item;
              return {
                ...item,
                decorationType: item.decorationType || match.decorationType,
                stitchCount: item.stitchCount || match.stitchCount,
              };
            });
            return { ...job, items: updatedItems };
          });
          setLocalItem('stash_raw_deco_jobs', updated).catch(console.error);
          saveCloudDecoJobs(apiSettings, updated).catch(console.error);
          return updated;
        });
      }

      setEnrichMsg(`Done — ${withData.length} jobs enriched`);
      setTimeout(() => { setIsEnrichingProduction(false); setEnrichMsg(''); }, 3000);
    } catch (e: any) {
      console.warn('Production enrichment failed:', e);
      setEnrichMsg('Failed');
      setTimeout(() => { setIsEnrichingProduction(false); setEnrichMsg(''); }, 3000);
    }
  }, [apiSettings, rawDecoJobs, isEnrichingProduction]);

  const loadData = async (isDeepSync: boolean = false, baseOrdersOverride?: ShopifyOrder[]) => {
    if (loadingRef.current) return;
    if (isConfigMissing) {
        setToastMsg({ text: "API Credentials Missing.", type: "error" });
        return;
    }

    // Abort any in-flight sync
    if (syncAbortRef.current) syncAbortRef.current.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;
    
    loadingRef.current = true;
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
                const latestUpdate = currentBaseOrders.reduce((max, o) => Math.max(max, new Date(o.updatedAt).getTime()), Date.now() - (72 * 60 * 60 * 1000));
                sinceDate = new Date(latestUpdate - 1800000).toISOString();
            }

            // Parallel fetch for speed — but NOT unfulfilled orders (would hit Shopify rate limit)
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

            // Fetch ALL unfulfilled orders AFTER Shopify date-window fetch to avoid rate limiting
            setSyncStatusMsg('Fetching unfulfilled orders...');
            let unfulfilledOrders: ShopifyOrder[] = [];
            let unfulfilledFetchOk = false;
            try {
                unfulfilledOrders = await fetchAllUnfulfilledOrders(apiSettings, (msg) => setSyncStatusMsg(msg));
                unfulfilledFetchOk = true;
            } catch (e1) {
                // Retry once after a short delay
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    unfulfilledOrders = await fetchAllUnfulfilledOrders(apiSettings, (msg) => setSyncStatusMsg(msg));
                    unfulfilledFetchOk = true;
                } catch (e2: any) {
                    console.warn('Unfulfilled orders fetch failed after retry:', e2.message);
                    setToastMsg({ text: `⚠️ Unfulfilled orders sync failed — counts may be incomplete. Try syncing again.`, type: 'error' });
                }
            }

            // Merge: base orders + date-window orders + ALL unfulfilled orders + cloud orders from other devices
            const orderMap = new Map<string, ShopifyOrder>();
            currentBaseOrders.forEach(o => orderMap.set(o.id, o));
            
            // Merge deco jobs: API data (freshly parsed) is authoritative for jobs it returns.
            // Cloud data fills in gaps (jobs outside lookback window, status updates from other devices).
            // For jobs present in BOTH API and cloud, API wins (has latest extraction code).
            const jobMap = new Map(rawDecoJobs.map(j => [j.jobNumber, j]));
            // Layer cloud data first (lower priority) — includes orders + deco from other devices
            let cloudFetchOk = false;
            try {
              setSyncStatusMsg('Syncing cloud data...');
              const cloudData = await fetchCloudData(apiSettings, { includeOrders: true });
              if (cloudData) {
                cloudFetchOk = true;
                // Cloud orders fill gaps — only unfulfilled/partial, never stale fulfilled.
                // Never downgrade a locally-fulfilled record back to unfulfilled just
                // because cloud is stale (fulfilled orders are never pushed to cloud,
                // so cloud's copy is permanently stuck on the pre-fulfillment state).
                // Also skip if local updatedAt is newer — local data is authoritative.
                (cloudData.orders || []).forEach((o: ShopifyOrder) => {
                  if (o.fulfillmentStatus === 'fulfilled' || o.fulfillmentStatus === 'restocked') return;
                  const existing = orderMap.get(o.id);
                  if (existing) {
                    if (existing.fulfillmentStatus === 'fulfilled' || existing.fulfillmentStatus === 'restocked') return;
                    const localMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
                    const cloudMs = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
                    if (localMs && cloudMs && localMs >= cloudMs) return;
                  }
                  orderMap.set(o.id, o);
                });
                // Cloud deco jobs OVERWRITE local cache — cloud is safe because only
                // API-fresh data gets pushed there (stale cache is never pushed)
                if (cloudData.decoJobs && cloudData.decoJobs.length > 0) {
                  cloudData.decoJobs.forEach((j: DecoJob) => jobMap.set(j.jobNumber, j));
                }
              }
            } catch {}
            // Layer fresh API data on top (highest priority)
            sOrders.forEach(o => orderMap.set(o.id, o));
            unfulfilledOrders.forEach(o => orderMap.set(o.id, o));

            // Reconcile stale "unfulfilled" orders that Shopify has since fulfilled.
            // Deep sync caps at 5000 orders; if an order became fulfilled AFTER falling
            // out of that window, its local copy stays permanently stale. When the full
            // unfulfilled list succeeded we treat it as ground truth — any local
            // unfulfilled/partial order NOT in that set is a stale candidate. We
            // re-fetch those individually (capped + concurrency-limited to protect
            // the API budget and avoid racing with fresh webhooks).
            if (unfulfilledFetchOk) {
                const currentUnfulfilledIds = new Set(unfulfilledOrders.map(o => o.id));
                const nowMs = Date.now();
                const STALE_AGE_MS = 24 * 60 * 60 * 1000;
                // High cap to drain legacy backlog in one sync. Empty dashboards
                // see near-zero stale candidates ongoing, so this only bites on
                // first run after this fix ships. Shopify GraphQL cost budget
                // (2000 bucket + 100/s restore) + fetchServerRoute 429 retries
                // absorbs the burst safely.
                const RECONCILE_CAP = 2000;
                // Collect ALL candidates, then prioritise oldest updatedAt first —
                // those are most likely to be truly fulfilled and least likely to
                // collide with in-flight webhooks. Guarantees any given stale order
                // is processed within a bounded number of syncs regardless of where
                // it sits in cache insertion order.
                const allStale: ShopifyOrder[] = [];
                for (const o of orderMap.values()) {
                    const isLocallyOpen = o.fulfillmentStatus !== 'fulfilled' && o.fulfillmentStatus !== 'restocked';
                    if (!isLocallyOpen) continue;
                    if (currentUnfulfilledIds.has(o.id)) continue;
                    const updatedMs = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
                    if (!updatedMs || nowMs - updatedMs < STALE_AGE_MS) continue;
                    allStale.push(o);
                }
                allStale.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
                const totalStale = allStale.length;
                const staleCandidates = allStale.slice(0, RECONCILE_CAP);

                console.log(`[sync] stale-unfulfilled: ${totalStale} found, ${staleCandidates.length} scheduled for reconcile (cap ${RECONCILE_CAP}, oldest-first)`);

                if (staleCandidates.length > 0) {
                    setSyncStatusMsg(`Reconciling ${staleCandidates.length} stale order${staleCandidates.length === 1 ? '' : 's'}...`);
                    const CONCURRENCY = 5;
                    let reconciled = 0;
                    let failed: ShopifyOrder[] = [];

                    const runBatch = async (candidates: ShopifyOrder[], concurrency: number, label: string) => {
                        const localFailed: ShopifyOrder[] = [];
                        for (let i = 0; i < candidates.length; i += concurrency) {
                            const slice = candidates.slice(i, i + concurrency);
                            const results = await Promise.allSettled(
                                slice.map(o => fetchSingleShopifyOrder(apiSettings, o.id))
                            );
                            results.forEach((r, idx) => {
                                if (r.status === 'fulfilled' && r.value) {
                                    orderMap.set(r.value.id, r.value);
                                    reconciled++;
                                } else {
                                    localFailed.push(slice[idx]);
                                }
                            });
                            if (candidates.length > 20 && (i + concurrency) % 50 === 0) {
                                setSyncStatusMsg(`${label} ${Math.min(i + concurrency, candidates.length)}/${candidates.length} stale orders...`);
                            }
                        }
                        return localFailed;
                    };

                    // Main pass — aggressive concurrency
                    failed = await runBatch(staleCandidates, CONCURRENCY, 'Reconciling');

                    // If anything failed (usually tail-end Shopify throttle), wait for
                    // the cost bucket to refill and retry once at lower concurrency.
                    // Throttle bucket is 2000 pts, restores 100/s → a 5s pause restores
                    // ~500 pts, enough for a low-concurrency retry pass to complete.
                    if (failed.length > 0) {
                        console.log(`[sync] ${failed.length} reconcile calls failed (likely throttle) — retrying after cooldown`);
                        setSyncStatusMsg(`Retrying ${failed.length} throttled orders (5s cooldown)...`);
                        await new Promise(r => setTimeout(r, 5000));
                        const stillFailed = await runBatch(failed, 2, 'Retrying');
                        if (stillFailed.length > 0) {
                            // Second cooldown + final single-threaded attempt for stragglers
                            console.log(`[sync] ${stillFailed.length} still failed — final pass serial`);
                            setSyncStatusMsg(`Final reconcile pass for ${stillFailed.length} orders (8s cooldown)...`);
                            await new Promise(r => setTimeout(r, 8000));
                            await runBatch(stillFailed, 1, 'Final reconcile');
                        }
                    }

                    console.log(`[sync] reconciled ${reconciled}/${staleCandidates.length} stale unfulfilled orders`);
                }
            }

            const mergedOrders = Array.from(orderMap.values());
            setRawShopifyOrders(mergedOrders);
            setLocalItem('stash_raw_shopify_orders', mergedOrders).catch(console.error);

            // Then layer API deco jobs on top (highest priority — freshly parsed with latest code)
            dRecentJobs.forEach(j => jobMap.set(j.jobNumber, j));
            const mergedDecoJobs = Array.from(jobMap.values());
            setRawDecoJobs(mergedDecoJobs);
            setLocalItem('stash_raw_deco_jobs', mergedDecoJobs).catch(console.error);

            // Track API-fresh deco jobs — only these get pushed to cloud
            const apiFreshJobs = [...dRecentJobs];

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
                    apiFreshJobs.push(...newFetchedJobs);
                    setRawDecoJobs(prev => {
                        const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
                        newFetchedJobs.forEach(j => jobMap.set(j.jobNumber, j));
                        const updated = Array.from(jobMap.values());
                        setLocalItem('stash_raw_deco_jobs', updated).catch(console.error);
                        return updated;
                    });
                }
            }

            if (sOrders.length > 0 && cloudFetchOk) {
                // Only push unfulfilled/partial orders to cloud — NOT fulfilled orders.
                // Also pass the IDs of orders that are now fulfilled/restocked locally
                // so saveCloudOrders can prune any stale copies still sitting in cloud
                // marked as unfulfilled (accumulated drift — fixes CloudHealth delta).
                const cloudOrders = mergedOrders.filter(o => o.fulfillmentStatus !== 'fulfilled' && o.fulfillmentStatus !== 'restocked');
                const staleIds = mergedOrders
                    .filter(o => o.fulfillmentStatus === 'fulfilled' || o.fulfillmentStatus === 'restocked')
                    .map(o => o.id);
                saveCloudOrders(apiSettings, cloudOrders, staleIds).catch(console.error);
            }

            // Push only API-fresh deco jobs to cloud — never stale local cache
            if (apiFreshJobs.length > 0 && cloudFetchOk) {
                saveCloudDecoJobs(apiSettings, apiFreshJobs).catch(console.error);
            }

            // Background stitch enrichment: fetch detailed decoration/stitch data for jobs missing from cache
            (async () => {
                try {
                    setSyncStatusMsg('Loading stitch cache...');
                    const stitchCache = await fetchStitchCache();
                    
                    // Apply cached data to existing jobs first
                    if (stitchCache.size > 0) {
                        setRawDecoJobs(prev => {
                            let changed = false;
                            const updated = prev.map(job => {
                                const cached = stitchCache.get(job.jobNumber);
                                if (!cached || !cached.decoration_data?.items?.length) return job;
                                const updatedItems = job.items.map((item, idx) => {
                                    const match = cached.decoration_data.items.find(c => c.lineIndex === idx);
                                    if (!match) return item;
                                    if (item.decorationType && item.stitchCount) return item;
                                    changed = true;
                                    return {
                                        ...item,
                                        decorationType: item.decorationType || match.decorationType,
                                        stitchCount: item.stitchCount || match.stitchCount,
                                    };
                                });
                                return { ...job, items: updatedItems };
                            });
                            if (!changed) return prev;
                            setLocalItem('stash_raw_deco_jobs', updated).catch(console.error);
                            return updated;
                        });
                    }

                    // Find jobs needing enrichment: not in cache OR in cache but with empty items AND job still lacks decoration types
                    const needsEnrichment = mergedDecoJobs
                        .filter(j => {
                            const cached = stitchCache.get(j.jobNumber);
                            // Not in cache at all → needs enrichment
                            if (!cached) return true;
                            // In cache with data → skip
                            if (cached.decoration_data?.items?.length > 0) return false;
                            // In cache but empty, AND job still has no decoration types → re-enrich
                            return !j.items.some(i => i.decorationType);
                        })
                        .map(j => j.jobNumber);

                    if (needsEnrichment.length > 0) {
                        setSyncStatusMsg(`Enriching stitch data: 0/${needsEnrichment.length}...`);
                        const newEntries = await enrichDecoStitchBatch(
                            apiSettings,
                            needsEnrichment,
                            (done, total) => setSyncStatusMsg(`Enriching stitch data: ${done}/${total}...`),
                        );

                        // Save to Supabase cache
                        await saveStitchCache(newEntries);

                        // Apply to jobs in state
                        if (newEntries.some(e => e.items.length > 0)) {
                            setRawDecoJobs(prev => {
                                const updated = prev.map(job => {
                                    const entry = newEntries.find(e => e.job_number === job.jobNumber);
                                    if (!entry || entry.items.length === 0) return job;
                                    const updatedItems = job.items.map((item, idx) => {
                                        const match = entry.items.find(c => c.lineIndex === idx);
                                        if (!match) return item;
                                        return {
                                            ...item,
                                            decorationType: item.decorationType || match.decorationType,
                                            stitchCount: item.stitchCount || match.stitchCount,
                                        };
                                    });
                                    return { ...job, items: updatedItems };
                                });
                                setLocalItem('stash_raw_deco_jobs', updated).catch(console.error);
                                saveCloudDecoJobs(apiSettings, updated).catch(console.error);
                                return updated;
                            });
                        }
                        setSyncStatusMsg(`Stitch data enriched for ${newEntries.filter(e => e.items.length > 0).length} jobs`);
                    }
                } catch (e) {
                    console.warn('Stitch enrichment failed (non-blocking):', e);
                }
            })();

            // Two-way cloud sync: retry any queued local writes, then pull cloud as source of truth.
            // We no longer re-push the ENTIRE local mappings dict here — that is what used to
            // let stale tabs overwrite fresh cloud values authored by other users. Only genuinely
            // pending (not-yet-confirmed) writes from this device go out, via the pending queue.
            setSyncStatusMsg('Flushing pending local writes...');
            try {
                const pc = await getPendingCount();
                if (pc > 0) await flushPending();
            } catch (e) {
                console.warn('Pending-sync flush mid-load failed:', e);
            }
            try {
                setSyncStatusMsg('Fetching cloud mappings...');
                const cloudData = await fetchCloudData(apiSettings);
                if (cloudData) {
                    // Cloud-wins merge with pending queue as overlay. See the startup
                    // merge block for the rationale — the short version is: cloud is
                    // authoritative except where we have locally-queued writes that
                    // haven't confirmed yet.
                    const overlay = await getPendingOverlay();
                    const cloudMappings = cloudData.mappings || {};
                    const mergedMappings: Record<string, string> = { ...cloudMappings, ...overlay.mappings };
                    overlay.mappingDeletes.forEach(k => { delete mergedMappings[k]; });
                    setConfirmedMatches(mergedMappings);
                    setLocalItem('stash_confirmed_matches', mergedMappings).catch(console.error);

                    const cloudPM = cloudData.productMappings || {};
                    const mergedPM: Record<string, string> = { ...cloudPM, ...overlay.patterns };
                    overlay.patternDeletes.forEach(k => { delete mergedPM[k]; });
                    setProductMappings(mergedPM);
                    setLocalItem('stash_product_mappings', mergedPM).catch(console.error);

                    const cloudLinks = cloudData.links || {};
                    const mergedLinks: Record<string, string> = { ...cloudLinks, ...overlay.jobLinks };
                    overlay.jobLinkDeletes.forEach(k => { delete mergedLinks[k]; });
                    setItemJobLinks(mergedLinks);
                    setLocalItem('stash_item_job_links', mergedLinks).catch(console.error);
                }
            } catch (e) {
                console.warn('Cloud mapping sync failed:', e);
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
        loadingRef.current = false;
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

  // Keep a ref to the latest auto-refresh callback so setInterval/visibility
  // handlers never call a stale closure (which would merge against old state
  // and wipe orders — the "103 → 3" bug).
  autoRefreshRef.current = () => {
    if (!loading && !isBulkRefreshing && !isScanning && user && !isConfigMissing) {
      loadData(false);
    }
  };

  // Auto-refresh: delta sync on configurable interval
  useEffect(() => {
    if (!user || isConfigMissing || !apiSettings.autoRefreshInterval) return;
    const intervalMs = apiSettings.autoRefreshInterval * 60 * 1000;
    const interval = setInterval(() => autoRefreshRef.current(), intervalMs);
    return () => clearInterval(interval);
  }, [user, isConfigMissing, apiSettings.autoRefreshInterval]);

  // Visibility-aware refresh: sync when tab regains focus after configured interval
  const lastSyncRef = useRef(lastSyncTime);
  lastSyncRef.current = lastSyncTime;
  useEffect(() => {
    if (!apiSettings.autoRefreshInterval) return; // respect OFF setting
    const refreshMs = apiSettings.autoRefreshInterval * 60 * 1000;
    const handleVisibility = () => {
      if (!document.hidden && lastSyncRef.current && Date.now() - lastSyncRef.current > refreshMs) {
        autoRefreshRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [apiSettings.autoRefreshInterval]);

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
        if (isTabAllowed('settings')) setShowSettings(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        autoRefreshRef.current();
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

            // Early Supabase init from cached settings (so components mounting before config fetch still work)
            try {
                const cached = localStorage.getItem('stash_api_settings');
                if (cached) {
                    const s = JSON.parse(cached);
                    if (s.supabaseUrl && s.supabaseAnonKey) initSupabase(s.supabaseUrl, s.supabaseAnonKey);
                }
            } catch {}

            // Load from IndexedDB first for instant UI
            const [cachedOrders, cachedJobs, cachedMatches, cachedProductMappings, cachedJobLinks] = await Promise.all([
                getLocalItem<ShopifyOrder[]>('stash_raw_shopify_orders'),
                getLocalItem<DecoJob[]>('stash_raw_deco_jobs'),
                getLocalItem<Record<string, string>>('stash_confirmed_matches'),
                getLocalItem<Record<string, string>>('stash_product_mappings'),
                getLocalItem<Record<string, string>>('stash_item_job_links'),
            ]);
            if (cachedOrders) {
                initialOrders = cachedOrders;
                setRawShopifyOrders(cachedOrders);
            }
            if (cachedJobs) setRawDecoJobs(cachedJobs);
            if (cachedMatches) setConfirmedMatches(cachedMatches);
            if (cachedProductMappings) setProductMappings(cachedProductMappings);
            if (cachedJobLinks) setItemJobLinks(cachedJobLinks);

            // Load settings from Firestore (tied to user account)
            // Fetch shared system config FIRST — these are system-wide values, not per-user
            try {
                const cfgRes = await fetch('/api/config');
                if (cfgRes.ok) {
                    const serverCfg = await cfgRes.json();
                    // Initialise direct Supabase client before any sync calls
                    initSupabase(serverCfg.supabaseUrl, serverCfg.supabaseAnonKey);

                    // Start Supabase Realtime — live sync across all devices
                    startRealtime(serverCfg.supabaseUrl, serverCfg.supabaseAnonKey, {
                      onMappingChange: (itemId, decoId) => {
                        setConfirmedMatches(prev => {
                          if (prev[itemId] === decoId) return prev; // no-op
                          const next = { ...prev, [itemId]: decoId };
                          setLocalItem('stash_confirmed_matches', next).catch(console.error);
                          return next;
                        });
                      },
                      onJobLinkChange: (orderId, jobId) => {
                        setItemJobLinks(prev => {
                          if (prev[orderId] === jobId) return prev;
                          const next = { ...prev, [orderId]: jobId };
                          setLocalItem('stash_item_job_links', next).catch(console.error);
                          return next;
                        });
                      },
                      onPatternChange: (shopifyPattern, decoPattern) => {
                        setProductMappings(prev => {
                          if (prev[shopifyPattern] === decoPattern) return prev;
                          const next = { ...prev, [shopifyPattern]: decoPattern };
                          setLocalItem('stash_product_mappings', next).catch(console.error);
                          return next;
                        });
                      },
                      onDataChange: async (table) => {
                        // Lightweight cloud pull when orders or deco jobs change on another device
                        try {
                          const cloudData = await fetchCloudData(apiSettings, { includeOrders: table === 'stash_orders' });
                          if (!cloudData) return;
                          if (table === 'stash_orders' && cloudData.orders?.length) {
                            setRawShopifyOrders(prev => {
                              const orderMap = new Map(prev.map(o => [o.id, o]));
                              // Only merge unfulfilled/partial cloud orders — skip stale fulfilled ones.
                              // Critically: never downgrade a locally-fulfilled record back to
                              // unfulfilled just because cloud is stale (cloud doesn't receive
                              // fulfilled orders, so its copy of a reconciled fulfillment is
                              // permanently out-of-date). Also skip if our local updatedAt is
                              // newer than cloud's — local reconciliation is authoritative.
                              cloudData.orders.forEach(o => {
                                if (o.fulfillmentStatus === 'fulfilled' || o.fulfillmentStatus === 'restocked') return;
                                const existing = orderMap.get(o.id);
                                if (existing) {
                                  if (existing.fulfillmentStatus === 'fulfilled' || existing.fulfillmentStatus === 'restocked') return;
                                  const localMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
                                  const cloudMs = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
                                  if (localMs && cloudMs && localMs >= cloudMs) return;
                                }
                                orderMap.set(o.id, o);
                              });
                              const merged = Array.from(orderMap.values());
                              setLocalItem('stash_raw_shopify_orders', merged).catch(console.error);
                              return merged;
                            });
                          }
                          if (table === 'stash_deco_jobs' && cloudData.decoJobs?.length) {
                            setRawDecoJobs(prev => {
                              const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
                              // Cloud overwrites local — cloud only contains API-fresh data
                              cloudData.decoJobs.forEach(j => jobMap.set(j.jobNumber, j));
                              const merged = Array.from(jobMap.values());
                              setLocalItem('stash_raw_deco_jobs', merged).catch(console.error);
                              return merged;
                            });
                          }
                          // Also pick up any new mappings/links from the same cloud pull,
                          // with the pending-overlay respected so our own unconfirmed
                          // writes aren't stomped by this intermediate fetch.
                          const overlay = await getPendingOverlay();
                          if (cloudData.mappings) {
                            const merged: Record<string, string> = { ...cloudData.mappings, ...overlay.mappings };
                            overlay.mappingDeletes.forEach(k => { delete merged[k]; });
                            setConfirmedMatches(merged);
                            setLocalItem('stash_confirmed_matches', merged).catch(console.error);
                          }
                          if (cloudData.links) {
                            const merged: Record<string, string> = { ...cloudData.links, ...overlay.jobLinks };
                            overlay.jobLinkDeletes.forEach(k => { delete merged[k]; });
                            setItemJobLinks(merged);
                            setLocalItem('stash_item_job_links', merged).catch(console.error);
                          }
                        } catch (e) {
                          console.warn('[Realtime] Cloud pull failed:', e);
                        }
                      },
                      onReconnect: async () => {
                        // The websocket came back after being disconnected — our local
                        // state may have missed any number of writes from other devices.
                        // Flush our own queued writes first, then pull cloud as the
                        // source of truth (with pending overlay still protecting our
                        // unconfirmed mutations).
                        console.log('[Realtime] Reconnected — resyncing state');
                        try { await flushPending(); } catch (e) { console.warn('[Realtime] reconnect flush failed:', e); }
                        try {
                          const cloudData = await fetchCloudData(apiSettings, { includeOrders: true });
                          if (!cloudData) return;
                          const overlay = await getPendingOverlay();

                          if (cloudData.mappings) {
                            const merged: Record<string, string> = { ...cloudData.mappings, ...overlay.mappings };
                            overlay.mappingDeletes.forEach(k => { delete merged[k]; });
                            setConfirmedMatches(merged);
                            setLocalItem('stash_confirmed_matches', merged).catch(console.error);
                          }
                          if (cloudData.links) {
                            const merged: Record<string, string> = { ...cloudData.links, ...overlay.jobLinks };
                            overlay.jobLinkDeletes.forEach(k => { delete merged[k]; });
                            setItemJobLinks(merged);
                            setLocalItem('stash_item_job_links', merged).catch(console.error);
                          }
                          if (cloudData.productMappings) {
                            const merged: Record<string, string> = { ...cloudData.productMappings, ...overlay.patterns };
                            overlay.patternDeletes.forEach(k => { delete merged[k]; });
                            setProductMappings(merged);
                            setLocalItem('stash_product_mappings', merged).catch(console.error);
                          }

                          if (cloudData.orders?.length) {
                            setRawShopifyOrders(prev => {
                              const orderMap = new Map(prev.map(o => [o.id, o]));
                              // Never downgrade a locally-fulfilled order back to unfulfilled —
                              // cloud's copy of any fulfilled order is permanently stale because
                              // saveCloudOrders excludes fulfilled records. Also skip when our
                              // local copy is newer than cloud's (updatedAt comparison).
                              cloudData.orders.forEach(o => {
                                if (o.fulfillmentStatus === 'fulfilled' || o.fulfillmentStatus === 'restocked') return;
                                const existing = orderMap.get(o.id);
                                if (existing) {
                                  if (existing.fulfillmentStatus === 'fulfilled' || existing.fulfillmentStatus === 'restocked') return;
                                  const localMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
                                  const cloudMs = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
                                  if (localMs && cloudMs && localMs >= cloudMs) return;
                                }
                                orderMap.set(o.id, o);
                              });
                              const merged = Array.from(orderMap.values());
                              setLocalItem('stash_raw_shopify_orders', merged).catch(console.error);
                              return merged;
                            });
                          }
                          if (cloudData.decoJobs?.length) {
                            setRawDecoJobs(prev => {
                              const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
                              cloudData.decoJobs.forEach(j => jobMap.set(j.jobNumber, j));
                              const merged = Array.from(jobMap.values());
                              setLocalItem('stash_raw_deco_jobs', merged).catch(console.error);
                              return merged;
                            });
                          }
                          setToastMsg({ text: 'Reconnected to live sync', type: 'success' });
                        } catch (e) {
                          console.warn('[Realtime] reconnect resync failed:', e);
                        }
                      },
                    });

                    setApiSettings(prev => {
                        const merged = {
                            ...prev,
                            // Server is authoritative for system-wide settings
                            shopifyDomain: serverCfg.shopifyDomain || prev.shopifyDomain || '',
                            decoDomain: serverCfg.decoDomain || prev.decoDomain || '',
                            supabaseUrl: serverCfg.supabaseUrl || prev.supabaseUrl || '',
                            supabaseAnonKey: serverCfg.supabaseAnonKey || prev.supabaseAnonKey || '',
                        };
                        localStorage.setItem('stash_api_settings', JSON.stringify(merged));
                        return merged;
                    });
                }
            } catch {}

            if (user?.uid) {
                try {
                    setSyncStatusMsg('Loading your settings...');

                    const settingsDoc = await getDoc(doc(db, 'user_settings', user.uid));
                    if (settingsDoc.exists()) {
                        const cloudSettings = settingsDoc.data().settings as Partial<ApiSettings>;
                        if (cloudSettings) {
                            // Only merge non-credential, non-system settings from Firestore
                            const { shopifyAccessToken, decoPassword, supabaseAnonKey, shipStationApiSecret,
                                    shopifyDomain, decoDomain, supabaseUrl, ...safeSettings } = cloudSettings as any;
                            setApiSettings(prev => {
                                const merged = { ...prev, ...safeSettings };
                                localStorage.setItem('stash_api_settings', JSON.stringify(merged));
                                return merged;
                            });
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load cloud settings:', e);
                }
            }

            setSyncStatusMsg('Loading Cloud State...');
            // Retry any previously-failed local writes (only ops that were actually
            // made on THIS device — we never blindly re-push the whole local cache,
            // which used to cause stale tabs to overwrite other users' work).
            try {
                const pendingCount = await getPendingCount();
                if (pendingCount > 0) {
                    setSyncStatusMsg(`Retrying ${pendingCount} pending changes...`);
                    const result = await flushPending();
                    if (result.failed > 0) {
                        console.warn('[startup] pending-sync flush: some ops still failing', result);
                    } else if (result.sent > 0) {
                        console.log('[startup] pending-sync flush: recovered', result);
                    }
                }
            } catch (e) {
                console.warn('Pending-sync flush on startup failed:', e);
            }
            // Orders cache is still pushed on startup (this is how other devices
            // bootstrap mid-flight sync data that isn't user-authored).
            const hasLocalOrders = initialOrders.length > 0;
            if (hasLocalOrders) {
                const activeOrders = initialOrders.filter(o => o.fulfillmentStatus !== 'fulfilled' && o.fulfillmentStatus !== 'restocked');
                const staleIds = initialOrders
                    .filter(o => o.fulfillmentStatus === 'fulfilled' || o.fulfillmentStatus === 'restocked')
                    .map(o => o.id);
                saveCloudOrders(apiSettings, activeOrders, staleIds).catch(e => console.warn('Order cache push failed:', e));
            }

            setSyncStatusMsg('Fetching cloud data...');
            const cloudData = await fetchCloudData(apiSettings, { includeOrders: true });
            if (cloudData) {
                // Cloud is authoritative for mappings/links/patterns EXCEPT for rows
                // we still have queued-but-unconfirmed writes for (the overlay).
                // This is the opposite of the old "local wins" merge, which caused
                // stale tabs to retain their out-of-date view of other users' work.
                const overlay = await getPendingOverlay();
                const mergeWithOverlay = (
                    cloud: Record<string, string>,
                    upserts: Record<string, string>,
                    deletes: Set<string>
                ): Record<string, string> => {
                    const out: Record<string, string> = { ...cloud, ...upserts };
                    deletes.forEach(k => { delete out[k]; });
                    return out;
                };

                const cloudMappings = cloudData.mappings || {};
                const mergedMappings = mergeWithOverlay(cloudMappings, overlay.mappings, overlay.mappingDeletes);
                setConfirmedMatches(mergedMappings);
                setLocalItem('stash_confirmed_matches', mergedMappings).catch(console.error);

                const cloudPM = cloudData.productMappings || {};
                const mergedPM = mergeWithOverlay(cloudPM, overlay.patterns, overlay.patternDeletes);
                setProductMappings(mergedPM);
                setLocalItem('stash_product_mappings', mergedPM).catch(console.error);

                const cloudLinks = cloudData.links || {};
                const mergedLinks = mergeWithOverlay(cloudLinks, overlay.jobLinks, overlay.jobLinkDeletes);
                setItemJobLinks(mergedLinks);
                setLocalItem('stash_item_job_links', mergedLinks).catch(console.error);

                setPhysicalStock(cloudData.physicalStock || []);
                setReturnStock(cloudData.returnStock || []);
                setReferenceProducts(cloudData.referenceProducts || []);
                setMissingCloudTables(cloudData.missingTables || []);

                // Merge cloud Deco jobs with local — cloud wins on conflicts (newer data from deep scans on other devices)
                if (cloudData.decoJobs && cloudData.decoJobs.length > 0) {
                    setRawDecoJobs(prev => {
                        const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
                        cloudData.decoJobs.forEach(j => jobMap.set(j.jobNumber, j));
                        const merged = Array.from(jobMap.values());
                        setLocalItem('stash_raw_deco_jobs', merged).catch(console.error);
                        return merged;
                    });
                }

                if (cloudData.orders && cloudData.orders.length > 0) {
                    // Merge cloud orders with local cache — only unfulfilled/partial orders
                    const orderMap = new Map<string, ShopifyOrder>();
                    initialOrders.forEach(o => orderMap.set(o.id, o));
                    cloudData.orders.forEach(o => {
                        // Skip fulfilled/restocked orders from cloud to prevent count inflation
                        if (o.fulfillmentStatus === 'fulfilled' || o.fulfillmentStatus === 'restocked') return;
                        const existing = orderMap.get(o.id);
                        if (!existing) {
                            orderMap.set(o.id, o);
                        } else {
                            // Field-level merge: keep the version with more complete data, but always preserve populated fields
                            const winner = new Date(o.updatedAt) > new Date(existing.updatedAt) ? o : existing;
                            const loser = winner === o ? existing : o;
                            const mergedItems = winner.items.map(item => {
                                if (item.imageUrl) return item;
                                const match = loser.items.find(li => li.id === item.id);
                                return match?.imageUrl ? { ...item, imageUrl: match.imageUrl } : item;
                            });
                            orderMap.set(o.id, {
                                ...winner,
                                items: mergedItems,
                                shippingAddress: winner.shippingAddress || loser.shippingAddress
                            });
                        }
                    });
                    initialOrders = Array.from(orderMap.values());
                    setRawShopifyOrders(initialOrders);
                    setLocalItem('stash_raw_shopify_orders', initialOrders).catch(console.error);
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
    return () => { stopRealtime(); };
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

  // EAN enrichment index: maps lowercase identifier → EAN barcode
  // Built from physical stock, reference products, Deco product catalog, AND deco job items
  const eanIndex = useMemo(() => {
    const idx = new Map<string, string>();
    // 1. Physical stock scans (barcode scanner — highest trust)
    for (const s of physicalStock) {
      if (s.ean && s.ean.trim().length >= 8 && s.productCode) {
        idx.set(s.productCode.toLowerCase(), s.ean.trim());
      }
    }
    // 2. Reference products (supplier CSVs) — productCode → EAN
    for (const r of referenceProducts) {
      if (r.ean && r.ean.trim().length >= 8 && r.productCode) {
        const key = r.productCode.toLowerCase();
        if (!idx.has(key)) idx.set(key, r.ean.trim());
      }
    }
    // 3. Bridge: Deco jobs link productCode to vendorSku.
    //    If we have an EAN for a productCode, also index its vendorSku
    //    so Shopify items (which use vendorSku-like SKUs) can match.
    for (const job of rawDecoJobs) {
      if (!job.items) continue;
      for (const item of job.items) {
        const pc = (item.productCode || '').trim().toLowerCase();
        const vs = (item.vendorSku || '').trim().toLowerCase();
        // If productCode has an EAN, also register vendorSku
        if (pc && vs && vs !== pc && idx.has(pc) && !idx.has(vs)) {
          idx.set(vs, idx.get(pc)!);
        }
        // If vendorSku has an EAN but productCode doesn't, register productCode too
        if (pc && vs && idx.has(vs) && !idx.has(pc)) {
          idx.set(pc, idx.get(vs)!);
        }
        // If the deco item itself carries an EAN, register both codes
        const decoEan = (item.ean || '').trim();
        if (decoEan.length >= 8) {
          if (pc && !idx.has(pc)) idx.set(pc, decoEan);
          if (vs && !idx.has(vs)) idx.set(vs, decoEan);
        }
      }
    }
    return idx;
  }, [physicalStock, referenceProducts, rawDecoJobs]);

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
      const targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
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
              const identifiers = [item.vendorSku, item.productCode, item.name];
              identifiers.forEach(t => {
                  const id = (t || '').trim().toLowerCase();
                  if (id) {
                      if (!itemMap.has(id)) itemMap.set(id, []);
                      // Avoid pushing the same item multiple times if identifiers are identical
                      if (!itemMap.get(id)!.includes(item)) {
                          itemMap.get(id)!.push(item);
                      }
                  }
              });
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
                  if (manualDecoId.includes('@@@')) {
                      const [sku, idxStr] = manualDecoId.split('@@@');
                      const idx = parseInt(idxStr);
                      const d = effectiveJob.items[idx];
                      if (d) {
                          const skuTarget = sku.trim().toLowerCase();
                          const matchTokens = [d.vendorSku, d.productCode, d.name];
                          const isValidMatch = matchTokens.some(t => (t||'').trim().toLowerCase() === skuTarget);
                          
                          if (isValidMatch) {
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

          // Segregate fully produced Deco jobs out of the live queue, treating them as effectively fulfilled.
          const hasShippingTracking = shipStationData.has(order.orderNumber);
          const isPhysicallyShipped = currentStatus === 'Shipped' || currentStatus === 'Invoiced' || (currentStatus === 'Completed' && hasShippingTracking);
          const effectiveFulfillmentStatus = isPhysicallyShipped ? 'fulfilled' : order.fulfillmentStatus;
          const effectiveClosedAt = isPhysicallyShipped && !order.closedAt ? (decoJob?.productionDueDate || order.date) : order.closedAt;

          return {
              shopify: { ...order, fulfillmentStatus: effectiveFulfillmentStatus, items: mappedItems },
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
              fulfillmentDate: effectiveClosedAt,
              fulfillmentDuration: effectiveClosedAt ? calculateWorkingDays(order.date, effectiveClosedAt, holidaySet) : undefined,
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

  // ── EAN Auto-Map: DISABLED — was running on every data load and slowing things down ──
  // Can be re-enabled by removing the early return below
  const eanAutoMapRanRef = useRef(new Set<string>());
  useEffect(() => {
    return; // Disabled — auto-matching turned off
    if (unifiedOrders.length === 0) return;
    console.log(`[EAN Auto-Map] eanIndex size: ${eanIndex.size}, orders: ${unifiedOrders.length}`);
    // Debug: log sample items with EAN/SKU data
    const linkedOrders = unifiedOrders.filter(o => o.deco && o.shopify.fulfillmentStatus !== 'fulfilled');
    if (linkedOrders.length > 0) {
      const sample = linkedOrders.slice(0, 3);
      for (const o of sample) {
        const unmapped = o.shopify.items.filter(i => !i.linkedDecoItemId && i.itemStatus !== 'fulfilled');
        if (unmapped.length > 0 && o.deco) {
          const decoItems = o.deco!.items;
          console.log(`[EAN Auto-Map] Order ${o.shopify.orderNumber}: ${unmapped.length} unmapped items`);
          unmapped.slice(0, 2).forEach(i => console.log(`  Shopify: "${i.name}" sku="${i.sku}" ean="${i.ean}"`));
          decoItems.slice(0, 2).forEach(d => console.log(`  Deco: "${d.name}" vendorSku="${d.vendorSku}" productCode="${d.productCode}" ean="${d.ean}"`));
        }
      }
    }
    const results = autoMatch(unifiedOrders, productMappings, eanIndex);
    console.log(`[EAN Auto-Map] autoMatch returned ${results.length} total results, ${results.filter(r => r.isEanMatch).length} auto-matches (EAN/SKU)`);
    if (results.length > 0 && results.filter(r => r.isEanMatch).length === 0) {
      console.log('[EAN Auto-Map] Non-auto matches found but no exact SKU/EAN matches. Sample:', results.slice(0, 3).map(r => `${r.itemName} → ${r.suggestedDecoItemName} (${r.confidence}, ${r.reason})`));
    }
    const eanMatches = results.filter(r => r.isEanMatch);
    if (eanMatches.length === 0) return;

    // Deduplicate: skip items already confirmed or already auto-mapped this session
    const newMappings: { itemKey: string; decoId: string }[] = [];
    for (const m of eanMatches) {
      const key = `${m.itemId}::${m.suggestedDecoItemId}`;
      if (confirmedMatches[m.itemId]) continue;
      if (eanAutoMapRanRef.current.has(key)) continue;
      eanAutoMapRanRef.current.add(key);
      newMappings.push({ itemKey: m.itemId, decoId: m.suggestedDecoItemId });
    }
    if (newMappings.length === 0) return;

    // Group by job and apply
    const byJob = new Map<string, { itemKey: string; decoId: string }[]>();
    for (const m of newMappings) {
      const match = eanMatches.find(r => r.itemId === m.itemKey);
      const jobId = match?.suggestedJobId || '';
      if (!byJob.has(jobId)) byJob.set(jobId, []);
      byJob.get(jobId)!.push(m);
    }
    for (const [jobId, mappings] of byJob) {
      handleBulkConfirmMatch(mappings, jobId || undefined);
    }
    console.log(`[EAN Auto-Map] Applied ${newMappings.length} EAN matches`);
  }, [unifiedOrders, eanIndex, confirmedMatches, productMappings]);

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

  // Re-check the supplied job numbers against Deco and surface what's now
  // shipped / cancelled, persisting the refreshed status to BOTH local
  // cache and cloud before resolving.
  //
  // Why this exists: the standard sync (fetchDecoJobs) is gated to a
  // 120-day date window. Orders placed before that — even if dispatched
  // yesterday — never get their status refreshed by a normal sync, so
  // they stay stuck on whatever status they had the last time they were
  // inside the window. The Priority Board needs a way to walk every
  // visible row, ask Deco "what's the real status now?", and have that
  // answer durable enough that a follow-up sync won't undo it.
  //
  // The cloud save is AWAITED, not fire-and-forget. Earlier versions of
  // this code returned the moment local state was updated, but a click
  // of "Sync now" immediately afterwards would read stale cloud data
  // and resurrect the cleared rows. Awaiting closes that race.
  const clearCompletedDecoJobs = useCallback(async (
      jobNumbers: string[],
      onProgress?: (current: number, total: number) => void,
  ) => {
      const result = { checked: 0, shipped: 0, cancelled: 0, failed: 0 };
      if (!apiSettings.useLiveData) return result;
      const unique = Array.from(new Set(jobNumbers.filter(Boolean)));
      if (unique.length === 0) return result;
      result.checked = unique.length;

      let refreshed: DecoJob[] = [];
      try {
          refreshed = await fetchBulkDecoJobs(apiSettings, unique, onProgress);
      } catch (e: any) {
          console.warn('[clearCompletedDecoJobs] bulk fetch failed:', e?.message || e);
          result.failed = unique.length;
          return result;
      }

      if (refreshed.length === 0) {
          result.failed = unique.length;
          return result;
      }
      result.failed = unique.length - refreshed.length;

      for (const j of refreshed) {
          const st = (j.status || '').toLowerCase();
          if (st === 'shipped') result.shipped += 1;
          // Cancelled is signalled by either status text or paymentStatus = '7'.
          else if (st === 'cancelled' || j.paymentStatus === '7') result.cancelled += 1;
      }

      setRawDecoJobs(prev => {
          const jobMap = new Map(prev.map(j => [j.jobNumber, j]));
          for (const j of refreshed) jobMap.set(j.jobNumber, j);
          const next = Array.from(jobMap.values());
          setLocalItem('stash_raw_deco_jobs', next).catch(console.error);
          return next;
      });

      // CRITICAL: await the cloud save. Without this, the next loadData()
      // can race ahead and read stale cloud data, undoing the clear.
      try {
          await saveCloudDecoJobs(apiSettings, refreshed);
      } catch (e: any) {
          console.warn('[clearCompletedDecoJobs] cloud save failed:', e?.message || e);
          // Local state still updated; just warn the caller they may
          // see ghosts again on next sync until cloud catches up.
          result.failed = Math.max(result.failed, 1);
      }

      return result;
  }, [apiSettings]);

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

    try {
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
        // Persist status-refreshed jobs to cloud so all devices keep accurate statuses
        saveCloudDecoJobs(apiSettings, updatedJobs).catch(e => console.warn('Failed to save status-refreshed jobs to cloud:', e));
    }

    notify('Stash Shop Sync', { body: `Status refresh complete. ${updatedJobs.length} jobs updated.` });
    setScanLog(prev => [...prev, { 
        id: 'end', 
        message: `Global Sync Finished. Statuses mirrored to Shopify dashboard.`, 
        type: 'success', 
        timestamp: new Date().toLocaleTimeString() 
    }]);
    } finally {
      setIsBulkRefreshing(false);
    }
  };

  const handleManualJobLink = async (orderIdOrIds: string | string[], jobId: string) => {
      const ids: string[] = Array.isArray(orderIdOrIds) ? orderIdOrIds : [orderIdOrIds];
      setItemJobLinks((prev: Record<string, string>) => {
          const next: Record<string, string> = { ...prev };
          ids.forEach((id: string) => { next[id] = jobId; });
          setLocalItem('stash_item_job_links', next).catch(console.error);
          return next;
      });
      await persistJobLinks(ids.map(id => ({ itemId: id, jobId })));
      handleRefreshJob(jobId);
  };

  /**
   * Shared helper — queues one or more item→job link writes and kicks off a
   * flush. Every job-link persistence path in the app routes through this so
   * that silent network failures are impossible.
   */
  const persistJobLinks = async (links: { itemId: string; jobId: string }[]) => {
      const now = new Date().toISOString();
      for (const l of links) {
          try { await enqueueJobLinkUpsert(l.itemId, l.jobId, now); }
          catch (e) { console.error('[job link] enqueue failed:', e); }
      }
      flushPending().catch(e => console.warn('[job link] flush failed:', e));
  };

  /**
   * Confirm a batch of Shopify-to-Deco item mappings.
   *
   * Durability model: every write is enqueued in the pending-sync queue
   * BEFORE we attempt the cloud POST. That queue is what guarantees the
   * mapping eventually reaches Supabase even if the current network call
   * fails — it's retried on next load, realtime reconnect, or manual flush.
   *
   * Returns { ok, failed } so the caller (modal) can show the user a real
   * success / failure toast instead of the previous silent-fail pattern.
   */
  const handleBulkConfirmMatch = async (
      mappings: { itemKey: string, decoId: string, jobId?: string }[],
      jobId?: string,
      learnedPatterns?: Record<string, string>
  ): Promise<{ ok: boolean; failed: number; total: number }> => {
      const now = new Date().toISOString();

      // 1. Optimistic local state update (instant UI) + IndexedDB persistence.
      setConfirmedMatches((prev: Record<string, string>) => {
          const next: Record<string, string> = { ...prev };
          mappings.forEach(m => { next[m.itemKey] = m.decoId; });
          setLocalItem('stash_confirmed_matches', next).catch(console.error);
          return next;
      });

      if (learnedPatterns && Object.keys(learnedPatterns).length > 0) {
          setProductMappings(prev => {
              const next = { ...prev };
              Object.entries(learnedPatterns).forEach(([sPattern, dPattern]) => { next[sPattern] = dPattern; });
              setLocalItem('stash_product_mappings', next).catch(console.error);
              return next;
          });
      }

      const jobsToRefresh = new Set<string>();
      const itemsWithJobs = mappings.filter(m => m.jobId || jobId);
      if (itemsWithJobs.length > 0) {
          setItemJobLinks(prev => {
              const next = { ...prev };
              itemsWithJobs.forEach(m => {
                  const j = m.jobId || jobId;
                  if (j) next[m.itemKey] = j;
              });
              setLocalItem('stash_item_job_links', next).catch(console.error);
              return next;
          });
          itemsWithJobs.forEach(m => { const j = m.jobId || jobId; if (j) jobsToRefresh.add(j); });
      }

      // 2. Enqueue cloud writes. If any enqueue throws, we DO NOT continue —
      // better to fail loudly than silently.
      try {
          for (const m of mappings) {
              await enqueueMappingUpsert(m.itemKey, m.decoId, now);
          }
          if (learnedPatterns) {
              for (const [sP, dP] of Object.entries(learnedPatterns)) {
                  await enqueuePatternUpsert(sP, dP, now);
              }
          }
          for (const m of itemsWithJobs) {
              const j = m.jobId || jobId;
              if (j) await enqueueJobLinkUpsert(m.itemKey, j, now);
          }
      } catch (e) {
          console.error('[mapping save] enqueue failed:', e);
          return { ok: false, failed: mappings.length, total: mappings.length };
      }

      // 3. Attempt to flush the queue now. Anything that fails stays queued
      // for the next retry cycle — the user's work is never lost.
      let result = { total: 0, sent: 0, failed: 0, skipped: 0, remaining: 0 };
      try {
          result = await flushPending();
      } catch (e) {
          console.error('[mapping save] flush errored:', e);
      }

      // 4. Refresh affected Deco jobs so the UI reflects the mapped state.
      jobsToRefresh.forEach(j => handleRefreshJob(j));

      const ok = result.failed === 0 && result.remaining === 0;
      return { ok, failed: result.failed + result.remaining, total: result.total };
  };

  const handleBulkScan = async (orderIds: string[]) => {
    if (isScanning) return;
    setIsScanning(true); setScanProgress(0); setScanLog([]); setScanCount({ current: 0, total: orderIds.length });
    setShowScanConsole(true); stopScanRef.current = false;
    try {
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
    } finally {
    setIsScanning(false);
    }
  };

  // Auto-link "Not On Deco" orders by matching customer names against cached Deco jobs + API search
  const handleAutoLinkNotOnDeco = async () => {
    if (isScanning) return;
    const notOnDeco = unifiedOrders.filter(o => !o.decoJobId && o.shopify.fulfillmentStatus !== 'fulfilled');
    if (notOnDeco.length === 0) return;

    setIsScanning(true); setScanProgress(0); setScanLog([]); setShowScanConsole(true); stopScanRef.current = false;
    setScanCount({ current: 0, total: notOnDeco.length });
    setScanLog([{ id: 'start', message: `Auto-Link: Scanning ${notOnDeco.length} orders against ${rawDecoJobs.length} cached Deco jobs...`, type: 'info', timestamp: new Date().toLocaleTimeString() }]);

    // Build name index from cached Deco jobs for fast lookup
    const nameNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const decoByName = new Map<string, DecoJob[]>();
    rawDecoJobs.forEach(j => {
      const key = nameNorm(j.customerName);
      if (key && key !== 'unknown') {
        if (!decoByName.has(key)) decoByName.set(key, []);
        decoByName.get(key)!.push(j);
      }
    });

    let linked = 0;
    let cacheHits = 0;
    let apiHits = 0;
    const needsApiSearch: typeof notOnDeco = [];

    // Phase 1: Match against cached Deco jobs by customer name
    const phase1Linked = new Set(unifiedOrders.filter(o => o.decoJobId).map(o => o.decoJobId));
    for (let i = 0; i < notOnDeco.length; i++) {
      if (stopScanRef.current) break;
      const order = notOnDeco[i];
      const shopifyName = nameNorm(order.shopify.customerName);
      if (!shopifyName || shopifyName === 'guest') { needsApiSearch.push(order); continue; }

      // Exact name match in cache
      const cachedMatches = decoByName.get(shopifyName);
      if (cachedMatches && cachedMatches.length > 0) {
        // Pick the most recent unlinked job
        const bestMatch = cachedMatches.find(j => !phase1Linked.has(j.jobNumber));
        if (!bestMatch) { needsApiSearch.push(order); continue; }
        handleManualJobLink(order.shopify.id, bestMatch.jobNumber);
        phase1Linked.add(bestMatch.jobNumber);
        linked++; cacheHits++;
        setScanLog(prev => [...prev, { id: `cache-${order.shopify.orderNumber}`, message: `#${order.shopify.orderNumber} ${order.shopify.customerName} → Job #${bestMatch.jobNumber} (cache match)`, type: 'success', timestamp: new Date().toLocaleTimeString() }]);
      } else {
        // Also try partial / surname matching
        const nameParts = shopifyName.split(' ');
        const surname = nameParts[nameParts.length - 1];
        let partialMatch: DecoJob | undefined;
        if (surname.length >= 3) {
          for (const [decoName, jobs] of decoByName.entries()) {
            if (decoName.includes(surname) && decoName.includes(nameParts[0])) {
              partialMatch = jobs.find(j => !phase1Linked.has(j.jobNumber));
              break;
            }
          }
        }
        if (partialMatch) {
          handleManualJobLink(order.shopify.id, partialMatch.jobNumber);
          phase1Linked.add(partialMatch.jobNumber);
          linked++; cacheHits++;
          setScanLog(prev => [...prev, { id: `partial-${order.shopify.orderNumber}`, message: `#${order.shopify.orderNumber} ${order.shopify.customerName} → Job #${partialMatch!.jobNumber} (name match)`, type: 'success', timestamp: new Date().toLocaleTimeString() }]);
        } else {
          needsApiSearch.push(order);
        }
      }

      setScanCount({ current: i + 1, total: notOnDeco.length });
      setScanProgress(Math.round(((i + 1) / notOnDeco.length) * 100));
    }

    setScanLog(prev => [...prev, { id: 'phase1-done', message: `Phase 1 done: ${cacheHits} linked from cache. ${needsApiSearch.length} need Deco API search...`, type: 'info', timestamp: new Date().toLocaleTimeString() }]);

    // Phase 2: Search Deco API by customer name for remaining unmatched orders
    const alreadyLinked = new Set(unifiedOrders.filter(o => o.decoJobId).map(o => o.decoJobId));
    const searchedNames = new Set<string>();

    for (let i = 0; i < needsApiSearch.length; i += 3) {
      if (stopScanRef.current) break;
      const batch = needsApiSearch.slice(i, i + 3);

      await Promise.all(batch.map(async (order) => {
        const custName = order.shopify.customerName;
        const normName = nameNorm(custName);
        if (!normName || normName === 'guest' || searchedNames.has(normName)) return;
        searchedNames.add(normName);

        // Search by surname (more specific, fewer false positives)
        const parts = custName.trim().split(/\s+/);
        const searchTerm = parts.length > 1 ? parts[parts.length - 1] : custName;

        try {
          const results = await searchDecoByName(apiSettings, searchTerm);
          if (results.length > 0) {
            // Find best match by comparing full name
            const exactMatch = results.find(j => nameNorm(j.customerName) === normName && !alreadyLinked.has(j.jobNumber));
            const partialMatch = results.find(j => {
              const dn = nameNorm(j.customerName);
              return (dn.includes(normName) || normName.includes(dn)) && !alreadyLinked.has(j.jobNumber);
            });
            const match = exactMatch || partialMatch;
            if (match) {
              handleManualJobLink(order.shopify.id, match.jobNumber);
              alreadyLinked.add(match.jobNumber);
              // Also add to cache for future fast lookups
              setRawDecoJobs(prev => {
                const exists = prev.some(j => j.jobNumber === match.jobNumber);
                if (exists) return prev;
                return [...prev, match];
              });
              linked++; apiHits++;
              setScanLog(prev => [...prev, { id: `api-${order.shopify.orderNumber}`, message: `#${order.shopify.orderNumber} ${custName} → Job #${match.jobNumber} (API match)`, type: 'success', timestamp: new Date().toLocaleTimeString() }]);
            } else {
              setScanLog(prev => [...prev, { id: `nomatch-${order.shopify.orderNumber}`, message: `#${order.shopify.orderNumber} ${custName} — ${results.length} Deco results, no name match`, type: 'warning', timestamp: new Date().toLocaleTimeString() }]);
            }
          } else {
            setScanLog(prev => [...prev, { id: `none-${order.shopify.orderNumber}`, message: `#${order.shopify.orderNumber} ${custName} — No Deco jobs found`, type: 'warning', timestamp: new Date().toLocaleTimeString() }]);
          }
        } catch {
          setScanLog(prev => [...prev, { id: `err-${order.shopify.orderNumber}`, message: `#${order.shopify.orderNumber} ${custName} — API error`, type: 'error', timestamp: new Date().toLocaleTimeString() }]);
        }
      }));

      const done = notOnDeco.length - needsApiSearch.length + Math.min(i + 3, needsApiSearch.length);
      setScanCount({ current: done, total: notOnDeco.length });
      setScanProgress(Math.round((done / notOnDeco.length) * 100));

      if (i + 3 < needsApiSearch.length) await new Promise(r => setTimeout(r, 1500)); // API throttle
    }

    setScanLog(prev => [...prev, { id: 'done', message: `✅ Auto-Link complete: ${linked} linked (${cacheHits} cache, ${apiHits} API). ${notOnDeco.length - linked} remain unlinked.`, type: 'success', timestamp: new Date().toLocaleTimeString() }]);
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
          orderComplete: active.filter(o => o.decoJobId && o.eligibleCount && o.eligibleCount > 0 && o.completionPercentage === 100).length,
          stockReady: active.filter(o => o.isStockDispatchReady).length,
          partiallyReady: active.filter(o => o.decoJobId && o.eligibleCount && o.eligibleCount > 0 && o.completionPercentage >= partialThreshold && o.completionPercentage < 100).length,
          late: active.filter(o => o.daysRemaining < 0).length,
          dueSoon: active.filter(o => o.daysRemaining >= 0 && o.daysRemaining <= 5).length,
          readyForShipping: active.filter(isReadyToShip).length,
          // "Unfulfilled" excludes ready-to-ship orders so the two cards are
          // mutually exclusive. Ready orders now live only in the Ready card.
          unfulfilled: active.filter(o => !isReadyToShip(o)).length,
          productionAfterDispatch: active.filter(o => o.decoJobId && o._rawProductionDate && o._rawDispatchDate && o._rawProductionDate.getTime() > o._rawDispatchDate.getTime() + 12 * 60 * 60 * 1000).length,
          fulfilled7d: fulfilled7d.length,
          mappingGap: active.filter(o => !!o.decoJobId && (o.mappedPercentage ?? 0) < 100).length,
          // Partial fulfillments whose latest fulfillment landed in the last 7
          // days, so this matches the "FULFILLED (7D)" parent card.
          partiallyFulfilled7d: baseSet.filter(o =>
              o.shopify.fulfillmentStatus === 'partial'
              && o.fulfillmentDate
              && (Date.now() - new Date(o.fulfillmentDate).getTime() < 7 * 24 * 60 * 60 * 1000)
          ).length
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
          else if (activeQuickFilter === 'ready') filtered = filtered.filter(isReadyToShip);
          else if (activeQuickFilter === 'order_complete') filtered = filtered.filter(o => o.decoJobId && o.eligibleCount && o.eligibleCount > 0 && o.completionPercentage === 100);
          else if (activeQuickFilter === 'stock_ready') filtered = filtered.filter(o => o.isStockDispatchReady);
          else if (activeQuickFilter === 'partially_ready') filtered = filtered.filter(o => o.decoJobId && o.eligibleCount && o.eligibleCount > 0 && o.completionPercentage >= partialThreshold && o.completionPercentage < 100);
          else if (activeQuickFilter === 'late') filtered = filtered.filter(o => o.daysRemaining < 0);
          else if (activeQuickFilter === 'mapping_gap') filtered = filtered.filter(o => !!o.decoJobId && (o.mappedPercentage ?? 0) < 100);
          else if (activeQuickFilter === 'overdue5') filtered = filtered.filter(o => !o.decoJobId && o.daysInProduction >= 5);
          else if (activeQuickFilter === 'overdue10') filtered = filtered.filter(o => !o.decoJobId && o.daysInProduction >= 10);
          else if (activeQuickFilter === 'production_after_dispatch') filtered = filtered.filter(o => o.decoJobId && o._rawProductionDate && o._rawDispatchDate && o._rawProductionDate.getTime() > o._rawDispatchDate.getTime() + 12 * 60 * 60 * 1000);
          else if (activeQuickFilter === 'due_soon') filtered = filtered.filter(o => o.daysRemaining >= 0 && o.daysRemaining <= 5);
          // No quick filter = default "Unfulfilled" view — hide ready-to-ship
          // orders so they live only in the Ready to Ship card.
          else filtered = filtered.filter(o => !isReadyToShip(o));
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
  }, [unifiedOrders, debouncedSearch, showFulfilled, includeMto, activeQuickFilter, startDate, endDate, partialThreshold, excludedTags]);

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
              await persistJobLinks([{ itemId, jobId }]);
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
          isOpen={showSettings && isTabAllowed('settings')} 
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
            <div className="hidden lg:flex items-center gap-1 min-w-0 flex-1" ref={navDropRef}>
                <div className="flex items-center gap-1">
                {/* Direct tabs — daily drivers */}
                {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'briefing', label: 'BRIEFING' }, { id: 'summary', label: '📱 SUMMARY' }, { id: 'command', label: '⚡ LIVE' }].filter(t => isTabAllowed(t.id)).map(tab => (
                    <button key={tab.id} onClick={() => { setActiveTab(tab.id); setNavDropdown(null); }} className={`px-3 py-2 rounded text-[10px] font-bold tracking-widest transition-all uppercase ${activeTab === tab.id ? 'bg-[#3e3e7a] text-white shadow-inner' : 'text-indigo-200 hover:text-white hover:bg-white/5'}`}>{tab.label}</button>
                ))}
                {/* Grouped dropdowns */}
                {[
                  { group: 'ORDERS', tabs: [{ id: 'priority', label: 'Priority Board' }, { id: 'kanban', label: 'Kanban' }, { id: 'operations', label: 'Ops Centre' }, { id: 'fulfill', label: 'Fulfillment' }, { id: 'autolink', label: 'Auto Linker' }] },
                  { group: 'PRODUCTION', tabs: [{ id: 'production', label: 'Production' }, { id: 'shop-floor', label: 'Shop Floor' }, { id: 'deco', label: 'Deco Network' }, { id: 'mto', label: 'Made to Order' }, { id: 'stock', label: 'Stock Manager' }, { id: 'inventory', label: 'Shopify Inventory' }, { id: 'wholesale', label: 'Wholesale Lookup' }, { id: 'issues', label: 'Issue Log' }] },
                  { group: 'ANALYTICS', tabs: [{ id: 'intelligence', label: 'Intel' }, { id: 'reports', label: 'Reports' }, { id: 'efficiency', label: 'Efficiency' }, { id: 'analyst', label: 'Process Analyst' }] },
                  { group: 'FINANCE', tabs: [{ id: 'revenue', label: 'Revenue' }, { id: 'sales', label: 'Sales Analytics' }, { id: 'shipped-not-invoiced', label: 'Shipped Not Invoiced' }, { id: 'credit-block', label: 'Credit Block List' }, { id: 'unpaid-orders', label: 'Unpaid Orders' }, { id: 'digest', label: 'Email Digest' }] },
                  { group: 'ADMIN', tabs: [{ id: 'users', label: 'User Management' }, { id: 'cloud-health', label: 'Cloud Health' }] },
                ].map(group => {
                  const allowedTabs = group.tabs.filter(t => isTabAllowed(t.id));
                  if (allowedTabs.length === 0) return null;
                  const isActive = allowedTabs.some(t => t.id === activeTab);
                  const isOpen = navDropdown === group.group;
                  return (
                    <div key={group.group} className="relative">
                      <button
                        onClick={() => setNavDropdown(isOpen ? null : group.group)}
                        className={`flex items-center gap-1 px-3 py-2 rounded text-[10px] font-bold tracking-widest transition-all uppercase ${
                          isActive ? 'bg-[#3e3e7a] text-white shadow-inner' : 'text-indigo-200 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {group.group}
                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && (
                        <div className="absolute top-full left-0 mt-1 bg-[#2a2a55] border border-indigo-500/20 rounded-lg shadow-xl min-w-[180px] py-1 z-[70]">
                          {allowedTabs.map(tab => (
                            <button
                              key={tab.id}
                              onClick={() => { setActiveTab(tab.id); setNavDropdown(null); }}
                              className={`w-full text-left px-4 py-2 text-[10px] font-bold tracking-wider uppercase transition-all ${
                                activeTab === tab.id ? 'bg-indigo-500/20 text-white' : 'text-indigo-200 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <NotificationBell username={isCustomUser ? (customUserData?.username || '') : (user?.email || '')} onOpenOrder={(oid, onum) => { setNotesOrderId(oid); setNotesOrderNumber(onum); }} />
                {isTabAllowed('alerts') && <button onClick={() => setShowAlertManager(true)} className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors" title="Alert Manager"><BellRing className="w-4 h-4" /></button>}
                {isTabAllowed('manual') && <button onClick={() => setActiveTab('manual')} className={`p-2 rounded hover:bg-white/5 transition-colors ${activeTab === 'manual' ? 'text-white bg-white/10' : 'text-indigo-300 hover:text-white'}`} title="Instruction Manual"><BookOpen className="w-4 h-4" /></button>}
{isTabAllowed('finance') && <button onClick={() => setActiveTab('finance')} className={`p-2 rounded hover:bg-white/5 transition-colors ${activeTab === 'finance' ? 'text-white bg-white/10' : 'text-indigo-300 hover:text-white'}`} title="Accounts & Finance"><PoundSterling className="w-4 h-4" /></button>}
                {isTabAllowed('settings') && <button onClick={() => setShowSettings(true)} className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors" title="Settings (⌘,)"><Settings className="w-4 h-4" /></button>}
                <button onClick={() => setTheme(isDark ? 'light' : 'dark')} className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors" title="Toggle Dark Mode">
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                {lastSyncLabel && (
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded whitespace-nowrap ${
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
                        <span className="text-[9px] font-black uppercase tracking-widest text-white leading-none whitespace-nowrap">{user.displayName || 'User'}</span>
                        <span className="text-[8px] font-bold text-indigo-300 uppercase leading-none mt-1 whitespace-nowrap">{user.email}</span>
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
            </div>
        </nav>
        
        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
            <div className="lg:hidden fixed inset-0 z-[60] bg-black/50" onClick={() => setMobileMenuOpen(false)}>
                <div className="absolute top-14 left-0 right-0 bg-[#2d2d5f] border-t border-indigo-500/20 shadow-2xl p-4 space-y-1 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    {/* Direct tabs */}
                    {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'briefing', label: 'BRIEFING' }, { id: 'summary', label: '📱 SUMMARY' }, { id: 'command', label: '⚡ LIVE' }].filter(t => isTabAllowed(t.id)).map(tab => (
                        <button key={tab.id} onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }} className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-bold tracking-widest uppercase transition-all ${activeTab === tab.id ? 'bg-[#3e3e7a] text-white' : 'text-indigo-200 hover:bg-white/5'}`}>{tab.label}</button>
                    ))}
                    {/* Grouped sections */}
                    {[
                      { group: 'ORDERS', tabs: [{ id: 'priority', label: 'Priority Board' }, { id: 'kanban', label: 'Kanban' }, { id: 'operations', label: 'Ops Centre' }, { id: 'fulfill', label: 'Fulfillment' }, { id: 'autolink', label: 'Auto Linker' }] },
                      { group: 'PRODUCTION', tabs: [{ id: 'production', label: 'Production' }, { id: 'shop-floor', label: 'Shop Floor' }, { id: 'deco', label: 'Deco Network' }, { id: 'mto', label: 'Made to Order' }, { id: 'stock', label: 'Stock Manager' }, { id: 'inventory', label: 'Shopify Inventory' }, { id: 'wholesale', label: 'Wholesale Lookup' }, { id: 'issues', label: 'Issue Log' }] },
                      { group: 'ANALYTICS', tabs: [{ id: 'intelligence', label: 'Intel' }, { id: 'reports', label: 'Reports' }, { id: 'efficiency', label: 'Efficiency' }, { id: 'analyst', label: 'Process Analyst' }] },
                      { group: 'FINANCE', tabs: [{ id: 'revenue', label: 'Revenue' }, { id: 'sales', label: 'Sales Analytics' }, { id: 'shipped-not-invoiced', label: 'Shipped Not Invoiced' }, { id: 'credit-block', label: 'Credit Block List' }, { id: 'unpaid-orders', label: 'Unpaid Orders' }, { id: 'digest', label: 'Email Digest' }] },
                      { group: 'ADMIN', tabs: [{ id: 'users', label: 'User Management' }, { id: 'cloud-health', label: 'Cloud Health' }] },
                    ].map(group => {
                      const allowedTabs = group.tabs.filter(t => isTabAllowed(t.id));
                      if (allowedTabs.length === 0) return null;
                      return (
                        <div key={group.group}>
                          <div className="px-4 pt-3 pb-1 text-[9px] font-black text-indigo-400/50 uppercase tracking-[0.2em]">{group.group}</div>
                          {allowedTabs.map(tab => (
                            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }} className={`w-full text-left px-6 py-2.5 rounded-lg text-xs font-bold tracking-widest uppercase transition-all ${activeTab === tab.id ? 'bg-[#3e3e7a] text-white' : 'text-indigo-200 hover:bg-white/5'}`}>{tab.label}</button>
                          ))}
                        </div>
                      );
                    })}
                    <div className="border-t border-indigo-500/20 pt-3 mt-3 flex items-center justify-between">
                        {isTabAllowed('manual') && <button onClick={() => { setActiveTab('manual'); setMobileMenuOpen(false); }} className="text-indigo-200 text-xs font-bold uppercase tracking-widest flex items-center gap-2"><BookOpen className="w-4 h-4" /> Manual</button>}
                {isTabAllowed('finance') && <button onClick={() => { setActiveTab('finance'); setMobileMenuOpen(false); }} className="text-indigo-200 text-xs font-bold uppercase tracking-widest flex items-center gap-2"><PoundSterling className="w-4 h-4" /> Finance</button>}
                        {isTabAllowed('settings') && <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }} className="text-indigo-200 text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Settings className="w-4 h-4" /> Settings</button>}
                        <NotificationBell username={isCustomUser ? (customUserData?.username || '') : (user?.email || '')} onOpenOrder={(oid, onum) => { setNotesOrderId(oid); setNotesOrderNumber(onum); setMobileMenuOpen(false); }} />
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
                        showZeroByDefault={false}
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
                            <button onClick={async () => { if(!window.confirm("FULL RESET: This will wipe ALL local cached data and re-download everything from scratch (APIs + cloud mappings). All computers should do this to get in sync. Proceed?")) return; setSyncStatusMsg('Wiping local cache...'); loadingRef.current = true; setLoading(true); try { await clearLocalDB(); setRawShopifyOrders([]); setRawDecoJobs([]); setConfirmedMatches({}); setProductMappings({}); setItemJobLinks({}); setPhysicalStock([]); setReturnStock([]); setReferenceProducts([]); setSyncStatusMsg('Fetching cloud data...'); const cloudData = await fetchCloudData(apiSettings, { includeOrders: true }); if (cloudData) { if (cloudData.mappings) { setConfirmedMatches(cloudData.mappings); await setLocalItem('stash_confirmed_matches', cloudData.mappings); } if (cloudData.productMappings) { setProductMappings(cloudData.productMappings); await setLocalItem('stash_product_mappings', cloudData.productMappings); } if (cloudData.links) { setItemJobLinks(cloudData.links); await setLocalItem('stash_item_job_links', cloudData.links); } if (cloudData.decoJobs && cloudData.decoJobs.length > 0) { setRawDecoJobs(cloudData.decoJobs); await setLocalItem('stash_raw_deco_jobs', cloudData.decoJobs); } if (cloudData.orders && cloudData.orders.length > 0) { setRawShopifyOrders(cloudData.orders); await setLocalItem('stash_raw_shopify_orders', cloudData.orders); } if (cloudData.physicalStock) setPhysicalStock(cloudData.physicalStock); if (cloudData.returnStock) setReturnStock(cloudData.returnStock); if (cloudData.referenceProducts) setReferenceProducts(cloudData.referenceProducts); } loadingRef.current = false; setLoading(false); await loadData(true); setToastMsg({ text: 'Full reset complete — all data re-synced from cloud', type: 'success' }); } catch(e: any) { loadingRef.current = false; setLoading(false); setToastMsg({ text: `Reset failed: ${e.message}`, type: 'error' }); } }} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-[10px] font-black transition-all uppercase tracking-widest text-red-500 hover:bg-red-50 border-l border-gray-100">
                                <RefreshCw className="w-3.5 h-3.5" /> Full Reset
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
                {/* Working-day planning horizon (15 and 20 business days
                    from today, skipping weekends + configured closures). */}
                <div className="pt-3">
                  <WorkingDaysPlanner holidayRanges={apiSettings.holidayRanges} />
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
                            <div className="pt-1 border-t border-red-100 mt-1">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleAutoLinkNotOnDeco(); }}
                                    disabled={isScanning || stats.notOnDeco === 0}
                                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-800 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-full"
                                >
                                    {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Auto-Link All
                                </button>
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
                settings={apiSettings}
                onOpenNotes={openNotes}
                noteCounts={noteCounts} 
                onConfirmMatch={async (i, d) => {
                  const r = await handleBulkConfirmMatch([{itemKey: i, decoId: d}]);
                  if (!r.ok) setToastMsg({ text: `Mapping save queued — cloud retry pending (${r.failed} failed)`, type: 'error' });
                }}
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
                onBulkMatch={async (m, lp) => {
                  const r = await handleBulkConfirmMatch(m, m[0]?.jobId, lp);
                  if (r.ok) setToastMsg({ text: `Saved ${m.length} mapping${m.length === 1 ? '' : 's'} to cloud`, type: 'success' });
                  else setToastMsg({ text: `Save partially failed — ${r.failed} of ${r.total} queued for retry. Changes will re-send automatically.`, type: 'error' });
                  return r.ok;
                }}
                onManualLink={handleManualJobLink} 
                onItemJobLink={async (orderNumber, itemId, jobId) => { 
                  setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId })); 
                  await persistJobLinks([{ itemId, jobId }]);
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
                eanIndex={eanIndex}
                itemJobLinks={itemJobLinks}
              />
            )}
            {activeTab === 'stock' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Stock Manager Error"><StockManager physicalStock={physicalStock} setPhysicalStock={updatePhysicalStock} returnStock={returnStock} setReturnStock={updateReturnStock} referenceProducts={referenceProducts} setReferenceProducts={updateReferenceProducts} orders={unifiedOrders} availableTags={allAvailableTags} /></ErrorBoundary></Suspense>}
            {activeTab === 'inventory' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Inventory Error"><ShopifyInventory /></ErrorBoundary></Suspense>}
            {activeTab === 'efficiency' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Dashboard Error"><EfficiencyDashboard orders={unifiedOrders} excludedTags={excludedTags} /></ErrorBoundary></Suspense>}
            {activeTab === 'mto' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><MtoDashboard orders={unifiedOrders} excludedTags={excludedTags} shopifyDomain={apiSettings.shopifyDomain} onBulkScan={handleBulkScan} onManualLink={handleManualJobLink} onRefreshJob={async (id) => { await handleRefreshJob(id); }} onItemJobLink={async (orderNumber, itemId, jobId) => { setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId })); await persistJobLinks([{ itemId, jobId }]); handleRefreshJob(jobId); }} selectedFilterTags={selectedGroups} /></Suspense>}
            {activeTab === 'deco' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
              <DecoDashboard 
                apiSettings={apiSettings} 
                orders={unifiedOrders} 
                excludedTags={excludedTags} 
                onManualLink={handleManualJobLink} 
                onConfirmMatch={async (i, d) => {
                  const r = await handleBulkConfirmMatch([{itemKey: i, decoId: d}]);
                  if (!r.ok) setToastMsg({ text: `Mapping save queued — cloud retry pending (${r.failed} failed)`, type: 'error' });
                }}
                onBulkMatch={async (m, lp) => {
                  const r = await handleBulkConfirmMatch(m, m[0]?.jobId, lp);
                  if (r.ok) setToastMsg({ text: `Saved ${m.length} mapping${m.length === 1 ? '' : 's'} to cloud`, type: 'success' });
                  else setToastMsg({ text: `Save partially failed — ${r.failed} of ${r.total} queued for retry. Changes will re-send automatically.`, type: 'error' });
                  return r.ok;
                }}
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
                eanIndex={eanIndex}
                itemJobLinks={itemJobLinks}
              />
            </Suspense>)}
            {activeTab === 'analyst' && <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}><ErrorBoundary fallbackTitle="Analyst Error"><ProcessAnalyst orders={unifiedOrders} /></ErrorBoundary></Suspense>}
            {activeTab === 'guide' && <ErrorBoundary fallbackTitle="Guide Error"><IntegrationGuide onComplete={() => setActiveTab('dashboard')} /></ErrorBoundary>}
            {activeTab === 'manual' && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 120px)' }}>
                <div className="flex items-center justify-between bg-gray-50 border-b border-gray-200 px-6 py-3">
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-800">Instruction Manual</h2>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">v4.0</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href="/INSTRUCTION_MANUAL.html" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"><Download className="w-3.5 h-3.5" /> Open in New Tab</a>
                  </div>
                </div>
                <iframe src="/INSTRUCTION_MANUAL.html" className="w-full border-0" style={{ height: 'calc(100% - 52px)' }} title="Instruction Manual" />
              </div>
            )}

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
                      physicalStock={physicalStock}
                      referenceProducts={referenceProducts}
                      onApplyMatches={async (m, jobId, lp) => {
                        const r = await handleBulkConfirmMatch(m, jobId, lp);
                        if (r.ok) setToastMsg({ text: `Saved ${m.length} mapping${m.length === 1 ? '' : 's'} to cloud`, type: 'success' });
                        else setToastMsg({ text: `Save partially failed — ${r.failed} of ${r.total} queued for retry.`, type: 'error' });
                      }}
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

            {/* Shop Floor Tab: live #print-updates / #embroidery-updates / #delivery-updates feeds */}
            {activeTab === 'shop-floor' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Slack Feeds Error">
                  <SlackFeeds />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Production Tab: Print Sheets, Priority Queue, Calendar */}
            {activeTab === 'production' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <div className="space-y-6">
                  <ErrorBoundary fallbackTitle="Production Intelligence Error">
                    <ProductionIntelligence
                      decoJobs={rawDecoJobs}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('deco'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Deco Production Table Error">
                    <DecoProductionTable
                      decoJobs={rawDecoJobs}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('deco'); }}
                      onEnrichProduction={handleEnrichProduction}
                      isEnriching={isEnrichingProduction}
                      enrichMsg={enrichMsg}
                    />
                  </ErrorBoundary>
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
                  <ErrorBoundary fallbackTitle="Carrier Performance Error">
                    <CarrierPerformanceReport
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Bottleneck Analysis Error">
                    <BottleneckReport
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Completion Tracker Error">
                    <CompletionTracker
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Deco Notes Error">
                    <DecoNotesIntelligence
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Payment Sync Error">
                    <PaymentStatusSync
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Capacity Forecast Error">
                    <CapacityForecast
                      orders={unifiedOrders}
                      onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary fallbackTitle="Seasonal Demand Error">
                    <SeasonalDemandCalendar
                      orders={unifiedOrders}
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

            {/* Accounts & Finance Tab */}
            {activeTab === 'finance' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Financial Dashboard Error">
                  <FinancialDashboard
                    decoJobs={rawDecoJobs}
                    shopifyOrders={rawShopifyOrders}
                    isDark={isDark}
                    settings={apiSettings}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Sales Analytics Tab */}
            {activeTab === 'sales' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Sales Analytics Error">
                  <SalesAnalytics
                    settings={apiSettings}
                    isDark={isDark}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Shipped Not Invoiced Tab */}
            {activeTab === 'shipped-not-invoiced' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Shipped Not Invoiced Error">
                  <ShippedNotInvoiced
                    decoJobs={rawDecoJobs}
                    isDark={isDark}
                    settings={apiSettings}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('dashboard'); }}
                    currentUserEmail={isCustomUser ? (customUserData?.username || '') : (user?.email || '')}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Credit Block List Tab */}
            {activeTab === 'credit-block' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Credit Block List Error">
                  <CreditBlockList
                    decoJobs={rawDecoJobs}
                    isDark={isDark}
                    settings={apiSettings}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('deco'); }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Unpaid Orders Tab */}
            {activeTab === 'unpaid-orders' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Unpaid Orders Error">
                  <UnpaidOrders
                    decoJobs={rawDecoJobs}
                    isDark={isDark}
                    settings={apiSettings}
                    onNavigateToOrder={(num) => { setSearchTerm(num); setActiveTab('deco'); }}
                    currentUserEmail={isCustomUser ? (customUserData?.username || '') : (user?.email || '')}
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
                    onLink={async (orderNumber, itemId, jobId) => {
                      setItemJobLinks((prev: Record<string, string>) => ({ ...prev, [itemId]: jobId }));
                      await persistJobLinks([{ itemId, jobId }]);
                      handleRefreshJob(jobId);
                    }}
                    onBulkLink={async (links) => {
                      setItemJobLinks((prev: Record<string, string>) => {
                        const next = { ...prev };
                        links.forEach(l => { next[l.itemId] = l.jobId; });
                        setLocalItem('stash_item_job_links', next).catch(console.error);
                        return next;
                      });
                      await persistJobLinks(links);
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

            {/* Cloud Health — Admin-only Supabase sync audit */}
            {activeTab === 'cloud-health' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Cloud Health Error">
                  <CloudHealth
                    localCounts={{
                      stash_orders: rawShopifyOrders.length,
                      stash_deco_jobs: rawDecoJobs.length,
                      stash_mappings: Object.keys(confirmedMatches).length,
                      stash_product_patterns: Object.keys(productMappings).length,
                      stash_job_links: Object.keys(itemJobLinks).length,
                      stash_stock: physicalStock.length,
                      stash_returns: returnStock.length,
                      stash_reference_products: referenceProducts.length,
                    }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Morning Briefing */}
            {activeTab === 'briefing' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Morning Briefing Error">
                  <MorningBriefing decoJobs={rawDecoJobs} orders={unifiedOrders} onNavigateToOrder={(num) => { setActiveTab('dashboard'); setSearchTerm(num); }} />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Mobile Summary — phone-first quick stats + search */}
            {activeTab === 'summary' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Summary Error">
                  <MobileSummary
                    stats={stats}
                    unifiedOrders={unifiedOrders}
                    decoJobs={rawDecoJobs}
                    holidayRanges={apiSettings.holidayRanges}
                    lastSyncTime={lastSyncTime}
                    syncStatusMsg={syncStatusMsg}
                    isSyncing={loading}
                    onRefresh={() => loadData(false)}
                    onJumpToOrder={(num) => { setActiveTab('dashboard'); setSearchTerm(num); }}
                    onJumpToFilter={(filter) => {
                      setActiveTab('dashboard');
                      if (filter === 'fulfilled7d') {
                        setShowFulfilled(true);
                        setActiveQuickFilter(null);
                      } else if (filter === 'unfulfilled') {
                        setShowFulfilled(false);
                        setActiveQuickFilter(null);
                      } else {
                        setShowFulfilled(false);
                        setActiveQuickFilter(filter as any);
                      }
                    }}
                    onJumpToTab={(tab) => {
                      // Map mobile-summary section IDs to the real dashboard tab IDs.
                      // The Credit Block List has its own dedicated tab.
                      const target = tab === 'credit' ? 'credit-block' : tab;
                      setActiveTab(target);
                    }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Wholesale Lookup — sales admin types a code, sees price + stock across every wholesaler */}
            {activeTab === 'wholesale' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Wholesale Lookup Error">
                  <WholesalerLookup />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Production Issue Log — production team logs missing/incorrect product info */}
            {activeTab === 'issues' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Issue Log Error">
                  <ProductionIssueLog
                    currentUser={{
                      name: isCustomUser ? (customUserData?.displayName || customUserData?.username || '') : (user?.displayName || user?.email || ''),
                      email: isCustomUser ? (customUserData?.username || '') : (user?.email || ''),
                    }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Priority Board */}
            {activeTab === 'priority' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Priority Board Error">
                  <PriorityBoard
                    decoJobs={rawDecoJobs}
                    onNavigateToOrder={(num) => { setActiveTab('dashboard'); setSearchTerm(num); }}
                    onRefresh={() => loadData(false)}
                    onClearCompleted={clearCompletedDecoJobs}
                    lastSyncTime={lastSyncTime}
                    loading={loading}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Email Digest */}
            {activeTab === 'digest' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Digest Error">
                  <DigestManager decoJobs={rawDecoJobs} />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* Command Center */}
            {activeTab === 'command' && (
              <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
                <ErrorBoundary fallbackTitle="Command Center Error">
                  <CommandCenter orders={unifiedOrders} excludedTags={excludedTags} onExit={() => setActiveTab('dashboard')} onNavigateToOrder={(orderNum) => { setActiveTab('dashboard'); setSearchTerm(orderNum); }} />
                </ErrorBoundary>
              </Suspense>
            )}
        </main>
        <Suspense fallback={null}>
          <AlertManager isOpen={showAlertManager} onClose={() => setShowAlertManager(false)} />
        </Suspense>

        {/* Order Notes Popover */}
        {notesOrderId && (user || customUserData) && (
          <div className="fixed bottom-4 right-4 z-[150]">
            <Suspense fallback={null}>
              <OrderNotes
                orderId={notesOrderId}
                orderNumber={notesOrderNumber}
                authorEmail={isCustomUser ? (customUserData?.username || 'unknown') : (user?.email || 'unknown')}
                authorName={isCustomUser ? (customUserData?.displayName || customUserData?.username || 'User') : (user?.displayName || user?.email || 'User')}
                settings={apiSettings}
                onClose={() => { setNotesOrderId(null); setNoteCounts(getNoteCounts()); }}
              />
            </Suspense>
          </div>
        )}

        {/* Voice AI Assistant */}
        <Suspense fallback={null}>
          <VoiceAssistant stats={stats} orders={unifiedOrders} onNavigate={setActiveTab} onSync={(deep) => loadData(!!deep)} activeTab={activeTab} />
        </Suspense>
    </div>
  );
};

export default App;