import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/verifyAuth';

// ─── Firebase Firestore Config ──────────────────────────────────────────────
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stash-shop-bridge';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = 'stash_notifications';

// ─── Cached anonymous token ─────────────────────────────────────────────────
// Firebase rate-limits anonymous sign-ups aggressively (every call creates a
// brand-new anonymous user). Cache the token across warm invocations so we
// only mint a fresh one when we have to. Tokens are valid ~1 hour; we refresh
// a couple of minutes early as a safety margin.
let cachedAuthToken: string | null = null;
let cachedAuthExpiry = 0;

async function getAuthToken(): Promise<string> {
  const now = Date.now();
  if (cachedAuthToken && cachedAuthExpiry > now + 60_000) return cachedAuthToken;

  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Anonymous token mint failed (${resp.status}): ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (!data.idToken) throw new Error('Anonymous token response missing idToken');
    cachedAuthToken = data.idToken as string;
    // Firebase tokens live 3600s; refresh 2 min early.
    const ttlSec = parseInt(data.expiresIn, 10);
    cachedAuthExpiry = now + (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 3600) * 1000 - 120_000;
    return cachedAuthToken;
  } catch (e) {
    cachedAuthToken = null;
    cachedAuthExpiry = 0;
    throw e;
  }
}

function fsHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// Convert JS object to Firestore field format. Unknown shapes (arrays,
// nested objects) are stringified rather than silently dropped.
function toFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) { fields[key] = { nullValue: null }; continue; }
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
    else if (Array.isArray(value)) fields[key] = {
      arrayValue: {
        values: value.map(v =>
          typeof v === 'string' ? { stringValue: v } :
          typeof v === 'number' ? { integerValue: String(v) } :
          typeof v === 'boolean' ? { booleanValue: v } :
          { stringValue: JSON.stringify(v) }
        ),
      },
    };
    else fields[key] = { stringValue: JSON.stringify(value) };
  }
  return fields;
}

// Convert Firestore doc to plain object
function fromDoc(doc: any): Record<string, any> {
  const f = doc.fields || {};
  const id = (doc.name || '').split('/').pop() || '';
  const out: Record<string, any> = { id };
  for (const [key, val] of Object.entries(f) as any) {
    if (val.stringValue !== undefined) out[key] = val.stringValue;
    else if (val.booleanValue !== undefined) out[key] = val.booleanValue;
    else if (val.integerValue !== undefined) out[key] = Number(val.integerValue);
    else if (val.doubleValue !== undefined) out[key] = Number(val.doubleValue);
    else if (val.arrayValue !== undefined) {
      out[key] = (val.arrayValue.values || []).map((v: any) =>
        v.stringValue ?? v.integerValue ?? v.booleanValue ?? null
      );
    } else if (val.nullValue !== undefined) out[key] = null;
  }
  return out;
}

// Small helper to bail out with a consistent error shape + server-side log.
function fail(res: VercelResponse, status: number, message: string, context?: unknown) {
  console.error(`[api/notifications] ${message}`, context ?? '');
  return res.status(status).json({ error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (await requireAuth(req, res, { route: 'notifications' })) return;

  const { action } = req.body || {};
  if (!action) return fail(res, 400, 'action required');

  let authToken: string;
  try {
    authToken = await getAuthToken();
  } catch (e: any) {
    return fail(res, 503, 'Notification auth unavailable', e?.message);
  }

  try {
    switch (action) {
      // ─── CREATE: batch-create notification docs ──────────────────────
      case 'create': {
        const { notifications } = req.body;
        if (!Array.isArray(notifications) || notifications.length === 0) {
          return fail(res, 400, 'notifications array required');
        }
        const results = await Promise.allSettled(
          notifications.map(async (n: any) => {
            const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}?key=${FIREBASE_API_KEY}`, {
              method: 'POST',
              headers: fsHeaders(authToken),
              body: JSON.stringify({ fields: toFields(n) }),
            });
            if (!resp.ok) {
              const body = await resp.text().catch(() => '');
              throw new Error(`Create failed: ${resp.status} ${body.slice(0, 200)}`);
            }
          })
        );
        const rejected = results.filter(r => r.status === 'rejected');
        if (rejected.length > 0) {
          console.warn('[api/notifications] partial create failure', rejected.map(r => (r as PromiseRejectedResult).reason?.message));
        }
        return res.json({ created: results.length - rejected.length, failed: rejected.length });
      }

      // ─── LIST: get unread notifications for a user ───────────────────
      case 'list': {
        const { username } = req.body;
        if (!username) return fail(res, 400, 'username required');

        const query = {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              fieldFilter: { field: { fieldPath: 'recipient_username' }, op: 'EQUAL', value: { stringValue: username } },
            },
            limit: 200,
          },
        };

        const resp = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: fsHeaders(authToken), body: JSON.stringify(query) }
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          return fail(res, 502, `Query failed: ${resp.status}`, body.slice(0, 200));
        }
        const results = await resp.json();
        const notifs = (Array.isArray(results) ? results : [])
          .filter((r: any) => r && r.document)
          .map((r: any) => fromDoc(r.document))
          .filter((n: any) => n.is_read === false)
          .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
          .slice(0, 50);
        return res.json(notifs);
      }

      // ─── MARK_READ: mark a single notification as read ───────────────
      case 'mark_read': {
        const { notifId } = req.body;
        if (!notifId) return fail(res, 400, 'notifId required');

        const updateMask = 'updateMask.fieldPaths=is_read';
        const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${notifId}?${updateMask}&key=${FIREBASE_API_KEY}`, {
          method: 'PATCH',
          headers: fsHeaders(authToken),
          body: JSON.stringify({ fields: toFields({ is_read: true }) }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          return fail(res, 502, `Update failed: ${resp.status}`, body.slice(0, 200));
        }
        return res.json({ success: true });
      }

      // ─── MARK_ALL_READ: mark all unread for a user as read ───────────
      case 'mark_all_read': {
        const { username: user } = req.body;
        if (!user) return fail(res, 400, 'username required');

        const query = {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              fieldFilter: { field: { fieldPath: 'recipient_username' }, op: 'EQUAL', value: { stringValue: user } },
            },
            limit: 200,
          },
        };
        const qResp = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: fsHeaders(authToken), body: JSON.stringify(query) }
        );
        if (!qResp.ok) {
          const body = await qResp.text().catch(() => '');
          return fail(res, 502, 'Query failed', body.slice(0, 200));
        }
        const payload = await qResp.json();
        const docs = (Array.isArray(payload) ? payload : [])
          .filter((r: any) => r && r.document)
          .filter((r: any) => fromDoc(r.document).is_read === false);

        await Promise.allSettled(
          docs.map(async (r: any) => {
            const docId = (r.document.name || '').split('/').pop();
            const updateMask = 'updateMask.fieldPaths=is_read';
            await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${docId}?${updateMask}&key=${FIREBASE_API_KEY}`, {
              method: 'PATCH',
              headers: fsHeaders(authToken),
              body: JSON.stringify({ fields: toFields({ is_read: true }) }),
            });
          })
        );
        return res.json({ success: true, updated: docs.length });
      }

      default:
        return fail(res, 400, `Unknown action: ${action}`);
    }
  } catch (err: any) {
    return fail(res, 500, err?.message || 'Unexpected server error', err?.stack);
  }
}
