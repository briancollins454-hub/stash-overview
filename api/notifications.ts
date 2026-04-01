import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Firebase Firestore Config ──────────────────────────────────────────────
const FIREBASE_PROJECT_ID = 'stash-shop-bridge';
const FIREBASE_API_KEY = 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = 'stash_notifications';

async function getAnonToken(): Promise<string> {
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!resp.ok) throw new Error('Failed to get anonymous auth token');
  const data = await resp.json();
  return data.idToken;
}

function fsHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// Convert JS object to Firestore field format
function toFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { integerValue: String(value) };
    else if (value === null) fields[key] = { nullValue: null };
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
    else if (val.nullValue !== undefined) out[key] = null;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action required' });

  try {
    const authToken = await getAnonToken();

    switch (action) {
      // ─── CREATE: batch-create notification docs ──────────────────────
      case 'create': {
        const { notifications } = req.body;
        if (!Array.isArray(notifications) || notifications.length === 0) {
          return res.status(400).json({ error: 'notifications array required' });
        }
        // Create each notification as a Firestore doc
        const results = await Promise.allSettled(
          notifications.map(async (n: any) => {
            const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}?key=${FIREBASE_API_KEY}`, {
              method: 'POST',
              headers: fsHeaders(authToken),
              body: JSON.stringify({ fields: toFields(n) }),
            });
            if (!resp.ok) throw new Error(`Create failed: ${resp.status}`);
          })
        );
        const failed = results.filter(r => r.status === 'rejected').length;
        return res.json({ created: results.length - failed, failed });
      }

      // ─── LIST: get unread notifications for a user ───────────────────
      case 'list': {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'username required' });

        // Firestore REST structured query: filter by recipient + unread
        const query = {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  { fieldFilter: { field: { fieldPath: 'recipient_username' }, op: 'EQUAL', value: { stringValue: username } } },
                  { fieldFilter: { field: { fieldPath: 'is_read' }, op: 'EQUAL', value: { booleanValue: false } } },
                ],
              },
            },
            orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }],
            limit: 50,
          },
        };

        const resp = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: fsHeaders(authToken), body: JSON.stringify(query) }
        );
        if (!resp.ok) return res.status(500).json({ error: `Query failed: ${resp.status}` });
        const results = await resp.json();
        const notifs = results
          .filter((r: any) => r.document)
          .map((r: any) => fromDoc(r.document));
        return res.json(notifs);
      }

      // ─── MARK_READ: mark a single notification as read ───────────────
      case 'mark_read': {
        const { notifId } = req.body;
        if (!notifId) return res.status(400).json({ error: 'notifId required' });

        const updateMask = 'updateMask.fieldPaths=is_read';
        const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${notifId}?${updateMask}&key=${FIREBASE_API_KEY}`, {
          method: 'PATCH',
          headers: fsHeaders(authToken),
          body: JSON.stringify({ fields: toFields({ is_read: true }) }),
        });
        if (!resp.ok) return res.status(500).json({ error: `Update failed: ${resp.status}` });
        return res.json({ success: true });
      }

      // ─── MARK_ALL_READ: mark all unread for a user as read ───────────
      case 'mark_all_read': {
        const { username: user } = req.body;
        if (!user) return res.status(400).json({ error: 'username required' });

        // First query unread docs for this user
        const query = {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  { fieldFilter: { field: { fieldPath: 'recipient_username' }, op: 'EQUAL', value: { stringValue: user } } },
                  { fieldFilter: { field: { fieldPath: 'is_read' }, op: 'EQUAL', value: { booleanValue: false } } },
                ],
              },
            },
            limit: 200,
          },
        };
        const qResp = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: fsHeaders(authToken), body: JSON.stringify(query) }
        );
        if (!qResp.ok) return res.status(500).json({ error: 'Query failed' });
        const docs = (await qResp.json()).filter((r: any) => r.document);

        // Batch update each to is_read=true
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
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
