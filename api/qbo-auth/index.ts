import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * QuickBooks Online OAuth2 flow handler.
 *
 * Actions:
 *   authorize  → returns the QBO OAuth2 authorization URL (redirect the user here)
 *   callback   → exchanges the auth code for tokens, stores in Supabase
 *   refresh    → refreshes an expired access token using the refresh token
 *   status     → checks if valid tokens exist
 *
 * Env vars required: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, SUPABASE_URL, SUPABASE_ANON_KEY
 */

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_ROW_ID = 'qbo_tokens';

// ── Signed OAuth state helpers ────────────────────────────────────────
// Format: "v1.<nonce-hex>.<hmac-hex>" where hmac = HMAC-SHA256(nonce,
// QBO_CLIENT_SECRET). Stateless CSRF defence: an attacker can't forge a
// valid state without the client secret, and we don't need session storage.
// Legacy unsigned states (any value not starting with "v1.") are passed
// through unchanged so in-flight OAuth flows from before this change
// continue to work.
const STATE_VERSION = 'v1';

function signState(secret: string): string {
  const nonce = randomBytes(16).toString('hex');
  const sig = createHmac('sha256', secret).update(nonce).digest('hex');
  return `${STATE_VERSION}.${nonce}.${sig}`;
}

function isSignedState(state: string | undefined | null): boolean {
  return !!state && state.startsWith(`${STATE_VERSION}.`);
}

function verifySignedState(state: string, secret: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) return false;
  const [, nonce, sig] = parts;
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', secret).update(nonce).digest('hex');
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getSupabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('Supabase not configured');
  return { url, key };
}

async function supabaseGet(table: string, id: string) {
  const { url, key } = getSupabase();
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function supabaseUpsert(table: string, row: Record<string, unknown>) {
  const { url, key } = getSupabase();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.QBO_CLIENT_ID?.trim();
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.QBO_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set in environment.' });
  }

  // Determine action from query param (GET) or body (POST)
  // Auto-detect callback if code+realmId are present (QuickBooks redirect)
  let action = (req.query?.action as string) || (req.body?.action as string) || '';
  if (!action && req.query?.code && req.query?.realmId) {
    action = 'callback';
  }

  try {
    // ─── AUTHORIZE ───────────────────────────────────────────
    if (action === 'authorize') {
      if (!redirectUri) return res.status(500).json({ error: 'QBO_REDIRECT_URI not configured' });
      // Signed state — see signState() above. Prevents CSRF on the callback
      // because an attacker can't forge a valid HMAC without the client secret.
      const state = signState(clientSecret);
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'com.intuit.quickbooks.accounting',
        state,
      });
      const authUrl = `${QBO_AUTH_URL}?${params.toString()}`;
      return res.json({ ok: true, authUrl, state });
    }

    // ─── CALLBACK ────────────────────────────────────────────
    // Handles the redirect from QuickBooks after user authorizes
    if (action === 'callback') {
      const code = (req.query?.code as string) || (req.body?.code as string);
      const realmId = (req.query?.realmId as string) || (req.body?.realmId as string);
      const state = (req.query?.state as string) || (req.body?.state as string) || '';

      if (!code || !realmId) {
        return res.status(400).json({ error: 'Missing code or realmId from QuickBooks callback' });
      }
      if (!redirectUri) return res.status(500).json({ error: 'QBO_REDIRECT_URI not configured' });

      // If the state uses our signed format, require it to verify. Legacy
      // unsigned states are allowed through so any OAuth flow started before
      // this change still completes. After a week of clean deploys we can
      // tighten this to "require signed state".
      if (isSignedState(state)) {
        if (!verifySignedState(state, clientSecret)) {
          console.warn('[qbo-auth] callback rejected: invalid signed state');
          return res.status(400).json({ error: 'Invalid OAuth state. Please restart the QuickBooks connection.' });
        }
      } else if (state) {
        console.warn('[qbo-auth] callback accepting legacy unsigned state; this will be required in a future release');
      }

      // Exchange authorization code for tokens
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });

      const tokenData = await tokenRes.json() as Record<string, unknown>;

      if (!tokenRes.ok || !tokenData.access_token) {
        return res.status(tokenRes.status).json({
          error: 'Token exchange failed',
          detail: tokenData,
        });
      }

      // Store tokens in Supabase
      const tokenRow = {
        id: TOKEN_ROW_ID,
        realm_id: realmId,
        access_token: tokenData.access_token as string,
        refresh_token: tokenData.refresh_token as string,
        token_type: tokenData.token_type || 'bearer',
        expires_in: tokenData.expires_in || 3600,
        x_refresh_token_expires_in: tokenData.x_refresh_token_expires_in || 8726400,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const saved = await supabaseUpsert('stash_qbo_tokens', tokenRow);
      if (!saved) {
        return res.status(500).json({ error: 'Failed to store tokens in Supabase' });
      }

      // If this is a browser redirect (GET with code), redirect to the app
      if (req.method === 'GET') {
        res.setHeader('Location', '/?qbo=connected');
        return res.status(302).end();
      }

      return res.json({ ok: true, realmId, expiresIn: tokenData.expires_in });
    }

    // ─── REFRESH ─────────────────────────────────────────────
    if (action === 'refresh') {
      const existing = await supabaseGet('stash_qbo_tokens', TOKEN_ROW_ID);
      if (!existing?.refresh_token) {
        return res.status(400).json({ error: 'No refresh token found. Please re-authorize QuickBooks.' });
      }

      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: existing.refresh_token,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });

      const tokenData = await tokenRes.json() as Record<string, unknown>;

      if (!tokenRes.ok || !tokenData.access_token) {
        return res.status(tokenRes.status).json({
          error: 'Token refresh failed',
          detail: tokenData,
        });
      }

      const updated = await supabaseUpsert('stash_qbo_tokens', {
        id: TOKEN_ROW_ID,
        realm_id: existing.realm_id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || existing.refresh_token,
        token_type: tokenData.token_type || 'bearer',
        expires_in: tokenData.expires_in || 3600,
        x_refresh_token_expires_in: tokenData.x_refresh_token_expires_in || 8726400,
        updated_at: new Date().toISOString(),
      });

      if (!updated) {
        return res.status(500).json({ error: 'Failed to update tokens in Supabase' });
      }

      return res.json({ ok: true, expiresIn: tokenData.expires_in });
    }

    // ─── STATUS ──────────────────────────────────────────────
    if (action === 'status') {
      const existing = await supabaseGet('stash_qbo_tokens', TOKEN_ROW_ID);
      if (!existing?.access_token) {
        return res.json({ connected: false });
      }

      const updatedAt = new Date(existing.updated_at || existing.created_at).getTime();
      const expiresIn = (existing.expires_in || 3600) * 1000;
      const isExpired = Date.now() > updatedAt + expiresIn;

      return res.json({
        connected: true,
        realmId: existing.realm_id,
        isExpired,
        updatedAt: existing.updated_at || existing.created_at,
        expiresIn: existing.expires_in,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}. Use authorize, callback, refresh, or status.` });

  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'QBO auth failed' });
  }
}
