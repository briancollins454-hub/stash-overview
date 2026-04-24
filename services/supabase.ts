/**
 * Direct Supabase REST client — bypasses the Vercel proxy to avoid the 4.5MB body limit.
 * The anon key is public-by-design (Supabase relies on RLS for security).
 */

let supabaseUrl = '';
let supabaseKey = '';

export const initSupabase = (url: string, anonKey: string) => {
  if (url && anonKey) {
    supabaseUrl = url.replace(/\/$/, '');
    supabaseKey = anonKey;
  }
};

export const isSupabaseReady = () => Boolean(supabaseUrl && supabaseKey);

// Client-side Supabase query timeout. PostgREST's statement timeout is
// usually 8s; giving the browser ~30s covers high-latency mobile links
// but still aborts eventually so a stuck connection doesn't freeze
// whatever UI flow awaited the promise forever.
const SUPABASE_CLIENT_TIMEOUT_MS = 30_000;

/**
 * Direct fetch to Supabase PostgREST — same path/method/body/prefer interface
 * as the old proxy, but without the Vercel middleman.
 *
 * Always times out eventually. If you need a longer window (e.g. a
 * large bulk upsert), wrap your own AbortController and pass via
 * Supabase's batching helpers — don't raise this global.
 */
export const supabaseFetch = async (
  path: string,
  method: string,
  body?: any,
  prefer?: string
): Promise<Response> => {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase not initialised — call initSupabase(url, key) first');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  if (prefer) {
    headers['Prefer'] = prefer;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUPABASE_CLIENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      const err = new Error('Supabase request timed out') as any;
      err.status = 408;
      throw err;
    }
    throw e;
  }
  clearTimeout(timer);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const message = errData.message || errData.details || `Supabase ${response.status}`;
    const error = new Error(message) as any;
    error.status = response.status;
    throw error;
  }

  return response;
};

/**
 * Row count for a Supabase table using PostgREST's exact-count feature.
 * Sends a cheap GET with Range:0-0 + Prefer:count=exact and parses
 * Content-Range. Returns null on error or if the table is missing.
 */
export const supabaseCount = async (table: string): Promise<number | null> => {
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*`, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0',
      },
    });
    if (!res.ok && res.status !== 206) return null;
    const cr = res.headers.get('content-range') || '';
    const total = cr.split('/')[1];
    if (!total || total === '*') return 0;
    const n = parseInt(total, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

/**
 * Check whether a given set of primary-key values exists in a cloud table.
 * Returns a Set of keys that WERE found in the cloud. Used by the Cloud
 * Health integrity check.
 *
 * Requests are split into small sub-batches so that long id strings (e.g.
 * product pattern keys containing brand/category text) never blow past the
 * URL length limit — which used to silently return 0 matches and cause a
 * false "100/100 missing" alarm.
 */
export const supabaseExistsBatch = async (
  table: string,
  column: string,
  values: string[]
): Promise<Set<string>> => {
  const found = new Set<string>();
  if (!supabaseUrl || !supabaseKey || values.length === 0) return found;

  // Keep the encoded URL well below typical 4 KB / 8 KB proxy limits.
  // Dynamically size each chunk based on the longest value so we don't
  // overshoot when keys are long.
  const avgLen = values.reduce((s, v) => s + String(v).length, 0) / values.length;
  const maxLen = values.reduce((m, v) => Math.max(m, String(v).length), 0);
  // Budget ~2.5 KB of raw key characters per request (URL-encoded expands
  // roughly 3x). Minimum 5, maximum 50 per chunk.
  const budget = 2500;
  const baseline = Math.max(avgLen, maxLen);
  const chunkSize = Math.max(5, Math.min(50, Math.floor(budget / (baseline + 4))));

  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    try {
      // PostgREST in.() syntax: quote every value and escape internal quotes,
      // then URL-encode the whole comma list (but leave the =in.( ) syntax alone).
      const filter = chunk
        .map(v => `"${String(v).replace(/"/g, '\\"')}"`)
        .join(',');
      const url = `${supabaseUrl}/rest/v1/${table}?select=${column}&${column}=in.(${encodeURIComponent(filter)})`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      });
      if (!res.ok) continue; // skip this chunk; others may still succeed
      const rows = await res.json();
      if (Array.isArray(rows)) {
        rows.forEach(r => {
          if (r && r[column] != null) found.add(String(r[column]));
        });
      }
    } catch {
      // Any failure on this chunk → move on; caller will see those keys as missing.
    }
  }
  return found;
};
