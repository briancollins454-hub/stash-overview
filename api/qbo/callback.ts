import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * QuickBooks OAuth2 callback handler.
 * Route: GET /api/qbo/callback?code=xxx&realmId=xxx&state=xxx
 *
 * QuickBooks redirects here after the user authorizes. We exchange the
 * authorization code for access + refresh tokens, store them in Supabase,
 * and redirect the user back to the app.
 */

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_ROW_ID = 'qbo_tokens';

// Mirror of the helpers in api/qbo-auth/index.ts. Legacy unsigned states
// pass through; signed "v1.<nonce>.<sig>" states must verify against
// QBO_CLIENT_SECRET (the same secret used by /authorize to sign them).
const STATE_VERSION = 'v1';
function isSignedState(state: string | undefined | null): boolean {
  return !!state && state.startsWith(`${STATE_VERSION}.`);
}
function verifySignedState(state: string, secret: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) return false;
  const [, nonce, sig] = parts;
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', secret).update(nonce).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.QBO_CLIENT_ID?.trim();
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.QBO_REDIRECT_URI?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();

  const code = req.query?.code as string;
  const realmId = req.query?.realmId as string;
  const state = (req.query?.state as string) || '';

  // Validate required params
  if (!code || !realmId) {
    return res.status(400).json({ error: 'Missing code or realmId from QuickBooks callback' });
  }
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'QBO_CLIENT_ID and QBO_CLIENT_SECRET not set' });
  }
  if (!redirectUri) {
    return res.status(500).json({ error: 'QBO_REDIRECT_URI not set' });
  }
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Signed-state check (legacy-safe — unsigned states still pass).
  if (isSignedState(state)) {
    if (!verifySignedState(state, clientSecret)) {
      console.warn('[qbo/callback] rejected: invalid signed state');
      return res.status(400).json({ error: 'Invalid OAuth state. Please restart the QuickBooks connection.' });
    }
  } else if (state) {
    console.warn('[qbo/callback] accepting legacy unsigned state; this will be required in a future release');
  }

  try {
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
      return res.status(tokenRes.status || 502).json({
        error: 'Token exchange failed',
        detail: tokenData,
      });
    }

    // Store tokens in Supabase
    const storeRes = await fetch(`${supabaseUrl}/rest/v1/stash_qbo_tokens`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: TOKEN_ROW_ID,
        realm_id: realmId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'bearer',
        expires_in: tokenData.expires_in || 3600,
        x_refresh_token_expires_in: tokenData.x_refresh_token_expires_in || 8726400,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!storeRes.ok) {
      return res.status(500).json({ error: 'Failed to store tokens in Supabase', status: storeRes.status });
    }

    // Redirect user back to the app
    const appUrl = 'https://stashoverview.co.uk/?tab=finance&qbo=connected';
    res.setHeader('Location', appUrl);
    return res.status(302).end();

  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'OAuth callback failed' });
  }
}
