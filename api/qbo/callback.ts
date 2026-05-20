import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * QuickBooks OAuth2 callback handler.
 * Route: GET /api/qbo/callback?code=xxx&realmId=xxx&state=xxx
 *
 * QBO_REDIRECT_URI in Intuit must match this URL exactly.
 */

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_ROW_ID = 'qbo_tokens';
const APP_SUCCESS_URL = 'https://stashoverview.co.uk/?tab=finance&qbo=connected';

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
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function supabaseServerKey(): string {
  return (
    process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || ''
  ).trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.QBO_CLIENT_ID?.trim();
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.QBO_REDIRECT_URI?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = supabaseServerKey();

  const code = req.query?.code as string;
  const realmId = req.query?.realmId as string;
  const state = (req.query?.state as string) || '';

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
    return res.status(500).json({ error: 'Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_KEY)' });
  }

  if (isSignedState(state)) {
    if (!verifySignedState(state, clientSecret)) {
      console.warn('[qbo/callback] rejected: invalid signed state');
      return res.status(400).json({ error: 'Invalid OAuth state. Please restart the QuickBooks connection.' });
    }
  } else if (state) {
    console.warn('[qbo/callback] accepting legacy unsigned state');
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    let tokenRes: Response;
    try {
      tokenRes = await fetch(QBO_TOKEN_URL, {
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
        signal: AbortSignal.timeout(30000),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Token exchange failed';
      return res.status(504).json({
        error: `QuickBooks token exchange timed out or failed: ${msg}`,
        hint: 'Try Connect again in a minute.',
      });
    }

    const tokenText = await tokenRes.text();
    let tokenData: Record<string, unknown>;
    try {
      tokenData = JSON.parse(tokenText) as Record<string, unknown>;
    } catch {
      return res.status(502).json({
        error: 'QuickBooks returned invalid JSON during token exchange',
        detail: tokenText.slice(0, 300),
      });
    }

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(tokenRes.status || 502).json({
        error: 'Token exchange failed',
        detail: tokenData,
      });
    }

    let storeRes: Response;
    try {
      storeRes = await fetch(`${supabaseUrl}/rest/v1/stash_qbo_tokens`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: TOKEN_ROW_ID,
          realm_id: realmId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type || 'bearer',
          expires_in: tokenData.expires_in || 3600,
          x_refresh_token_expires_in: tokenData.x_refresh_token_expires_in || 8726400,
          updated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(25000),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Storage failed';
      return res.status(504).json({
        error: `Connected to QuickBooks but saving tokens timed out: ${msg}`,
        hint: 'Check SUPABASE_SERVICE_KEY in Vercel and that table stash_qbo_tokens exists.',
      });
    }

    if (!storeRes.ok) {
      const storeDetail = await storeRes.text().catch(() => '');
      console.error('[qbo/callback] Supabase store failed', storeRes.status, storeDetail.slice(0, 500));
      return res.status(500).json({
        error: 'Failed to store QuickBooks tokens in Supabase',
        status: storeRes.status,
        detail: storeDetail.slice(0, 400),
        hint: storeRes.status === 401 || storeRes.status === 403
          ? 'Set SUPABASE_SERVICE_KEY (service role) in Vercel env vars.'
          : 'Ensure table stash_qbo_tokens exists with upsert on id.',
      });
    }

    res.setHeader('Location', APP_SUCCESS_URL);
    return res.status(302).end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'OAuth callback failed';
    console.error('[qbo/callback]', message, err);
    return res.status(500).json({ error: message });
  }
}
