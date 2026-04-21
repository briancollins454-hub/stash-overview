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

/**
 * Direct fetch to Supabase PostgREST — same path/method/body/prefer interface
 * as the old proxy, but without the Vercel middleman.
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

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
 */
export const supabaseExistsBatch = async (
  table: string,
  column: string,
  values: string[]
): Promise<Set<string>> => {
  const found = new Set<string>();
  if (!supabaseUrl || !supabaseKey || values.length === 0) return found;
  try {
    // PostgREST in.() syntax: quote every value and escape internal quotes,
    // then URL-encode the whole comma list (but leave the =in.( ) syntax alone).
    const filter = values
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
    if (!res.ok) return found;
    const rows = await res.json();
    if (Array.isArray(rows)) {
      rows.forEach(r => {
        if (r && r[column] != null) found.add(String(r[column]));
      });
    }
  } catch {
    // Any failure → treat as "nothing found" (caller reports it as missing).
  }
  return found;
};
