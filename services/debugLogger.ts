/**
 * Site-wide debug logger.
 * ------------------------------------------------------------------
 * Captures everything useful while clicking around the app so you can
 * eyeball the console and see what's going wrong where:
 *
 *   • Uncaught JS errors           (window.error)
 *   • Unhandled promise rejections (window.unhandledrejection)
 *   • Failed fetches               (non-2xx) with URL / status / timing
 *   • Slow fetches                 (> 5s)
 *   • React error-boundary catches (reportBoundaryError)
 *   • Route changes                (pushState / popstate / hashchange)
 *   • Reboot / full reloads
 *
 * How to turn it on:
 *   • Add `?debug=1` to any URL once, e.g. https://…/?debug=1
 *     – the flag is stored in localStorage so it survives refresh.
 *   • Or run in the console:  localStorage.setItem('stash_debug','1')
 *                             then reload.
 *   • Turn off:               localStorage.removeItem('stash_debug')
 *                             or add ?debug=0
 *
 * Console commands (once active):
 *   stashDebug.summary()  → prints counts & last 20 events
 *   stashDebug.clear()    → wipes the in-memory log
 *   stashDebug.export()   → returns a JSON blob you can copy/paste
 *   stashDebug.off()      → turn off and reload
 */

interface DebugEvent {
  t: number;                  // ms since page load
  wall: string;               // wall-clock HH:MM:SS.mmm
  path: string;               // location.pathname at time of event
  kind: 'error' | 'reject' | 'fetch' | 'slow' | 'react' | 'route' | 'info';
  level: 'err' | 'warn' | 'info';
  msg: string;
  extra?: Record<string, any>;
}

const MAX_EVENTS = 500;
const SLOW_FETCH_MS = 5_000;

function isEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('debug') === '1') {
      localStorage.setItem('stash_debug', '1');
      return true;
    }
    if (qs.get('debug') === '0') {
      localStorage.removeItem('stash_debug');
      return false;
    }
    return localStorage.getItem('stash_debug') === '1';
  } catch {
    return false;
  }
}

function wallClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

const events: DebugEvent[] = [];
const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

function push(ev: Omit<DebugEvent, 't' | 'wall' | 'path'>) {
  const full: DebugEvent = {
    ...ev,
    t: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
    wall: wallClock(),
    path: typeof window !== 'undefined' ? window.location.pathname + window.location.hash : '',
  };
  events.push(full);
  if (events.length > MAX_EVENTS) events.shift();
  print(full);
}

// Colour palette (hex) – subtle, works on dark + light consoles.
const C = {
  err:   'color:#fff;background:#b91c1c;padding:1px 5px;border-radius:3px',
  warn:  'color:#1f2937;background:#fde047;padding:1px 5px;border-radius:3px',
  info:  'color:#fff;background:#1e40af;padding:1px 5px;border-radius:3px',
  route: 'color:#fff;background:#7c3aed;padding:1px 5px;border-radius:3px',
  dim:   'color:#6b7280',
  reset: '',
};

function tagStyle(ev: DebugEvent): string {
  if (ev.kind === 'route') return C.route;
  if (ev.level === 'err') return C.err;
  if (ev.level === 'warn') return C.warn;
  return C.info;
}

function icon(ev: DebugEvent): string {
  switch (ev.kind) {
    case 'error': return '✖';
    case 'reject': return '⚠';
    case 'fetch': return ev.level === 'err' ? '🔴' : '🟡';
    case 'slow': return '🐢';
    case 'react': return '⚛';
    case 'route': return '🧭';
    default: return 'ℹ';
  }
}

function print(ev: DebugEvent) {
  const label = `%c[debug ${ev.wall}] ${icon(ev)} ${ev.kind.toUpperCase()}`;
  const tail = `%c @ ${ev.path}`;
  if (ev.extra) {
    // Collapsed groups keep the console readable.
    (console.groupCollapsed as any)(label + ' ' + ev.msg + tail, tagStyle(ev), C.dim);
    try {
      console.log(ev.extra);
    } finally {
      console.groupEnd();
    }
  } else {
    console.log(label + ' ' + ev.msg + tail, tagStyle(ev), C.dim);
  }
}

// -------- Fetch wrapping -----------------------------------------------

function wrapFetch() {
  if (typeof window === 'undefined' || !window.fetch) return;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')).toUpperCase();
    try {
      const res = await orig(input as any, init);
      const ms = Math.round(performance.now() - started);
      if (!res.ok) {
        push({
          kind: 'fetch',
          level: res.status >= 500 ? 'err' : 'warn',
          msg: `${method} ${shortenUrl(url)} → ${res.status} (${ms}ms)`,
          extra: { url, method, status: res.status, ms, ok: false },
        });
      } else if (ms >= SLOW_FETCH_MS) {
        push({
          kind: 'slow',
          level: 'warn',
          msg: `${method} ${shortenUrl(url)} slow: ${ms}ms`,
          extra: { url, method, status: res.status, ms },
        });
      }
      return res;
    } catch (e: any) {
      const ms = Math.round(performance.now() - started);
      push({
        kind: 'fetch',
        level: 'err',
        msg: `${method} ${shortenUrl(url)} threw after ${ms}ms: ${e?.message || e}`,
        extra: { url, method, ms, error: String(e?.message || e), name: e?.name },
      });
      throw e;
    }
  };
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) return u.pathname + (u.search ? '?…' : '');
    return `${u.host}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return url;
  }
}

// -------- Global error + rejection -----------------------------------

function hookGlobalErrors() {
  window.addEventListener('error', (e: ErrorEvent) => {
    // Swallow noisy browser-extension errors (content-script.js etc).
    const src = (e.filename || '') + '';
    if (src.includes('content-script') || src.includes('extension://')) return;
    push({
      kind: 'error',
      level: 'err',
      msg: e.message || 'uncaught error',
      extra: {
        source: e.filename,
        line: e.lineno,
        col: e.colno,
        stack: e.error?.stack,
      },
    });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason: any = e.reason;
    push({
      kind: 'reject',
      level: 'err',
      msg: reason?.message || String(reason) || 'unhandled rejection',
      extra: {
        name: reason?.name,
        stack: reason?.stack,
      },
    });
  });
}

// -------- Route change tracking --------------------------------------

function hookRouter() {
  let last = window.location.pathname + window.location.hash;
  const fire = () => {
    const now = window.location.pathname + window.location.hash;
    if (now === last) return;
    push({ kind: 'route', level: 'info', msg: `${last} → ${now}` });
    last = now;
  };
  window.addEventListener('popstate', fire);
  window.addEventListener('hashchange', fire);

  // React-router uses history.pushState / replaceState — patch them so
  // we actually see in-app navigations.
  for (const fn of ['pushState', 'replaceState'] as const) {
    const orig = history[fn];
    history[fn] = function (this: History, ...args: any[]) {
      const ret = orig.apply(this, args as any);
      // Microtask so window.location is already updated when we read it.
      queueMicrotask(fire);
      return ret;
    } as any;
  }
}

// -------- Public API (window.stashDebug) -----------------------------

function install() {
  wrapFetch();
  hookGlobalErrors();
  hookRouter();
  push({ kind: 'info', level: 'info', msg: 'debug logger active' });

  (window as any).stashDebug = {
    summary() {
      const byKind: Record<string, number> = {};
      const byLevel: Record<string, number> = {};
      for (const ev of events) {
        byKind[ev.kind] = (byKind[ev.kind] || 0) + 1;
        byLevel[ev.level] = (byLevel[ev.level] || 0) + 1;
      }
      console.group(
        `%c[stashDebug] ${events.length} events — ${byLevel.err || 0} err / ${byLevel.warn || 0} warn`,
        C.info,
      );
      console.table(byKind);
      console.log('Last 20:');
      console.table(
        events.slice(-20).map((e) => ({
          t: e.wall,
          kind: e.kind,
          level: e.level,
          path: e.path,
          msg: e.msg,
        })),
      );
      console.groupEnd();
    },
    clear() {
      events.length = 0;
      console.log('%c[stashDebug] cleared', C.info);
    },
    export() {
      return JSON.stringify(events, null, 2);
    },
    off() {
      try { localStorage.removeItem('stash_debug'); } catch {}
      console.log('%c[stashDebug] turning off — reloading', C.info);
      setTimeout(() => window.location.reload(), 150);
    },
    events,
  };

  console.log(
    `%c[stashDebug] active — type %cstashDebug.summary()%c for a report, %cstashDebug.off()%c to disable`,
    C.info,
    'font-weight:bold',
    '',
    'font-weight:bold',
    '',
  );
}

export function reportBoundaryError(error: Error, componentStack: string) {
  if (!isEnabled()) return;
  push({
    kind: 'react',
    level: 'err',
    msg: error.message || 'React error boundary',
    extra: { stack: error.stack, componentStack },
  });
}

export function installDebugLogger() {
  if (typeof window === 'undefined') return;
  if (!isEnabled()) return;
  if ((window as any).__stashDebugInstalled) return;
  (window as any).__stashDebugInstalled = true;
  install();
}
