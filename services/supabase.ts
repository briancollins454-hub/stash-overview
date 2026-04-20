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
