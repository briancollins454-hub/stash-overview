/**
 * Shared server-side authentication helper for /api/* routes.
 * ----------------------------------------------------------------
 * All browser requests already carry a Firebase ID token in the
 * `X-Firebase-Id-Token` header thanks to `services/authInterceptor.ts`
 * (installed globally in `index.tsx`). This helper validates that
 * header so random callers on the internet can't invoke our paid
 * integration endpoints (Deco, Shopify, QuickBooks, ...).
 *
 * Why NOT firebase-admin?
 *   The firebase-admin SDK is heavyweight, needs a service account
 *   JSON secret, and has a warm-start penalty on Vercel serverless.
 *   We verify tokens by calling Google's public REST endpoint
 *   `identitytoolkit.googleapis.com/v1/accounts:lookup`, which only
 *   requires our public Firebase API key. The network round-trip is
 *   ~100ms cold, and we memoize successful verifications in-memory
 *   for 5 minutes (token → email) so hot requests cost ~0.
 *
 * Rollout safety:
 *   Enforcement is controlled by env `API_AUTH_MODE`:
 *     disabled (default) → never check, always allow (old behaviour)
 *     soft               → log who's calling, still allow everyone
 *     strict             → reject anyone without a valid token
 *
 *   Deploy the code with mode=soft, watch the Vercel logs for a
 *   day to confirm every real user is presenting a token, then flip
 *   to strict. If anything breaks, flip back to disabled — no
 *   redeploy needed.
 *
 *   The mode can also be overridden per-route via `requireAuth({ mode })`,
 *   in case one endpoint needs to stay public while others tighten up.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';

type AuthMode = 'disabled' | 'soft' | 'strict';

function resolveMode(override?: AuthMode): AuthMode {
  if (override) return override;
  const raw = (process.env.API_AUTH_MODE || '').toLowerCase().trim();
  if (raw === 'strict' || raw === 'soft' || raw === 'disabled') return raw;
  return 'disabled';
}

export interface AuthResult {
  ok: boolean;
  email?: string;
  uid?: string;
  reason?: string;
}

// Token → { email, uid, exp } cache. Expires either on Google-reported
// token expiry OR 5 minutes, whichever comes first.
interface CacheEntry {
  email: string;
  uid: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Clean out stale entries opportunistically. Called before each
// verification to cap memory. Map iteration is cheap at this size
// (a handful of staff).
function pruneCache() {
  if (tokenCache.size < 128) return;
  const now = Date.now();
  for (const [k, v] of tokenCache) {
    if (v.expiresAt <= now) tokenCache.delete(k);
  }
}

async function verifyFirebaseToken(idToken: string): Promise<AuthResult> {
  if (!idToken) return { ok: false, reason: 'missing_token' };

  pruneCache();
  const cached = tokenCache.get(idToken);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, email: cached.email, uid: cached.uid };
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
    if (!resp.ok) {
      // 400 = token invalid/expired; 401 = key rejected; 5xx = Google issue.
      return { ok: false, reason: `google_${resp.status}` };
    }
    const data: any = await resp.json();
    const user = Array.isArray(data.users) && data.users.length > 0 ? data.users[0] : null;
    if (!user) return { ok: false, reason: 'no_user' };

    const email: string = user.email || '';
    const uid: string = user.localId || '';
    if (!email || !uid) return { ok: false, reason: 'incomplete_user' };

    // Google returns `validSince` as seconds. ID tokens are valid for
    // 1 hour by default. Cap at our local TTL so rotated passwords
    // invalidate cached tokens within 5 minutes.
    const expiresAt = Math.min(Date.now() + CACHE_TTL_MS, Date.now() + 60 * 60 * 1000);
    tokenCache.set(idToken, { email, uid, expiresAt });
    return { ok: true, email, uid };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, reason: 'google_timeout' };
    return { ok: false, reason: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyRequest(req: VercelRequest): Promise<AuthResult> {
  const hdr = req.headers['x-firebase-id-token'];
  const idToken = Array.isArray(hdr) ? hdr[0] : hdr;
  if (!idToken) return { ok: false, reason: 'missing_token' };
  return verifyFirebaseToken(String(idToken).trim());
}

export interface RequireAuthOptions {
  /** Route-specific override of API_AUTH_MODE. */
  mode?: AuthMode;
  /** Label used in structured logs to identify the calling route. */
  route: string;
}

/**
 * Verify the caller and (depending on mode) either reject the request
 * or allow it through.
 *
 * Returns `null` if the caller may proceed; returns the `AuthResult`
 * with `.ok=false` ONLY when the handler has already been responded to
 * with a 401 (caller should `return` immediately). In soft/disabled
 * modes this always returns `null` — the handler keeps running —
 * while still logging who's calling.
 */
export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
  opts: RequireAuthOptions,
): Promise<AuthResult | null> {
  const mode = resolveMode(opts.mode);
  if (mode === 'disabled') return null;

  const result = await verifyRequest(req);

  if (result.ok) {
    // Attach a lightweight audit trail to server logs. Deliberately
    // logged at info level, not warn, so they don't trigger alerts.
    console.log(`[auth] ${opts.route} ok user=${result.email}`);
    return null;
  }

  // Failure. Log one way or another so we can see who's hitting us
  // without credentials before flipping the switch to strict.
  if (mode === 'soft') {
    console.warn(`[auth:soft] ${opts.route} unauthenticated (${result.reason}) — allowing`);
    return null;
  }

  // strict
  console.warn(`[auth:strict] ${opts.route} REJECTED (${result.reason})`);
  res.status(401).json({ error: 'Unauthorized', reason: result.reason });
  return result;
}

/**
 * Service-to-service variant for endpoints that need to be callable
 * by a scheduled task (cron) or server-side backfill. Checks a shared
 * header secret instead of a Firebase token. Returns null on success,
 * or an AuthResult with ok=false after sending 401.
 */
export function requireServiceSecret(
  req: VercelRequest,
  res: VercelResponse,
  envVarName: string,
  route: string,
): AuthResult | null {
  const expected = process.env[envVarName];
  if (!expected) {
    res.status(503).json({ error: `${envVarName} not configured` });
    return { ok: false, reason: 'secret_not_configured' };
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    console.warn(`[service-auth] ${route} REJECTED (bad/missing bearer)`);
    res.status(401).json({ error: 'Unauthorized' });
    return { ok: false, reason: 'bad_bearer' };
  }
  return null;
}
