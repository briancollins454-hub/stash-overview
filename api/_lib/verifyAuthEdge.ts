/**
 * Edge-runtime variant of verifyAuth.
 *
 * Vercel's edge runtime uses the standard web Fetch API (Request/Response)
 * rather than VercelRequest/VercelResponse from @vercel/node, so the
 * Node helper in ./verifyAuth.ts isn't directly reusable. This file
 * mirrors the same behaviour — same env var (API_AUTH_MODE), same
 * Google identity-toolkit verification, same 5-minute token cache —
 * but with the edge-native request shape.
 *
 * NOTE: Edge functions run in a cold-start-prone V8 isolate, so the
 * in-memory cache only survives within a single instance. That's
 * still useful because most real usage bursts (an open dashboard
 * making 5-10 calls in a second) reuse the same instance.
 */

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';

type AuthMode = 'disabled' | 'soft' | 'strict';

function resolveMode(): AuthMode {
  const raw = (process.env.API_AUTH_MODE || '').toLowerCase().trim();
  if (raw === 'strict' || raw === 'soft' || raw === 'disabled') return raw;
  return 'disabled';
}

interface CacheEntry { email: string; uid: string; expiresAt: number }
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function verifyFirebaseToken(idToken: string): Promise<{ ok: boolean; email?: string; reason?: string }> {
  if (!idToken) return { ok: false, reason: 'missing_token' };

  const cached = tokenCache.get(idToken);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, email: cached.email };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!resp.ok) return { ok: false, reason: `google_${resp.status}` };
    const data: any = await resp.json();
    const user = Array.isArray(data.users) && data.users.length > 0 ? data.users[0] : null;
    if (!user?.email || !user?.localId) return { ok: false, reason: 'incomplete_user' };

    tokenCache.set(idToken, {
      email: user.email,
      uid: user.localId,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return { ok: true, email: user.email };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, reason: 'google_timeout' };
    return { ok: false, reason: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

export interface EdgeAuthDecision {
  /** If non-null, the handler should return this Response immediately. */
  reject: Response | null;
  /** Verified email when available. */
  email?: string;
}

export async function requireAuthEdge(req: Request, route: string, corsHeaders?: Record<string, string>): Promise<EdgeAuthDecision> {
  const mode = resolveMode();
  if (mode === 'disabled') return { reject: null };

  const idToken = req.headers.get('x-firebase-id-token') || '';
  const result = await verifyFirebaseToken(idToken.trim());

  if (result.ok) {
    console.log(`[auth] ${route} ok user=${result.email}`);
    return { reject: null, email: result.email };
  }

  if (mode === 'soft') {
    console.warn(`[auth:soft] ${route} unauthenticated (${result.reason}) — allowing`);
    return { reject: null };
  }

  console.warn(`[auth:strict] ${route} REJECTED (${result.reason})`);
  return {
    reject: new Response(
      JSON.stringify({ error: 'Unauthorized', reason: result.reason }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...(corsHeaders || {}) } },
    ),
  };
}
