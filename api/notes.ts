import type { VercelRequest, VercelResponse } from '@vercel/node';

const FIREBASE_PROJECT_ID = 'stash-shop-bridge';
const FIREBASE_API_KEY = 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = 'stash_notes';

async function getAnonToken(): Promise<string> {
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!resp.ok) throw new Error('Failed to get anonymous auth token');
  return (await resp.json()).idToken;
}

function fsHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

function toFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { integerValue: String(value) };
    else if (value === null || value === undefined) fields[key] = { nullValue: null };
  }
  return fields;
}

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
      // ─── SAVE: upsert a note (create or update) ─────────────────────
      case 'save': {
        const { note } = req.body;
        if (!note || !note.note_id) return res.status(400).json({ error: 'note with note_id required' });

        // Use note_id as the Firestore document ID for consistent upserts
        const docId = note.note_id;
        const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${docId}?key=${FIREBASE_API_KEY}`, {
          method: 'PATCH',
          headers: fsHeaders(authToken),
          body: JSON.stringify({ fields: toFields(note) }),
        });
        if (!resp.ok) return res.status(500).json({ error: `Save failed: ${resp.status}` });
        return res.json({ success: true });
      }

      // ─── LIST: get all notes for an order ────────────────────────────
      case 'list': {
        const { order_id } = req.body;
        if (!order_id) return res.status(400).json({ error: 'order_id required' });

        const query = {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              fieldFilter: { field: { fieldPath: 'order_id' }, op: 'EQUAL', value: { stringValue: order_id } },
            },
            limit: 500,
          },
        };
        const resp = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: fsHeaders(authToken), body: JSON.stringify(query) }
        );
        if (!resp.ok) return res.status(500).json({ error: `Query failed: ${resp.status}` });
        const results = await resp.json();
        const notes = results.filter((r: any) => r.document).map((r: any) => fromDoc(r.document));
        return res.json(notes);
      }

      // ─── DELETE: remove a note ───────────────────────────────────────
      case 'delete': {
        const { note_id } = req.body;
        if (!note_id) return res.status(400).json({ error: 'note_id required' });

        const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${note_id}?key=${FIREBASE_API_KEY}`, {
          method: 'DELETE',
          headers: fsHeaders(authToken),
        });
        if (!resp.ok && resp.status !== 404) return res.status(500).json({ error: `Delete failed: ${resp.status}` });
        return res.json({ success: true });
      }

      // ─── PARTICIPANTS: get unique authors for an order ───────────────
      case 'participants': {
        const { order_id } = req.body;
        if (!order_id) return res.status(400).json({ error: 'order_id required' });

        const query = {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              fieldFilter: { field: { fieldPath: 'order_id' }, op: 'EQUAL', value: { stringValue: order_id } },
            },
            limit: 500,
          },
        };
        const resp = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: fsHeaders(authToken), body: JSON.stringify(query) }
        );
        if (!resp.ok) return res.json([]);
        const results = await resp.json();
        const authors = new Set<string>();
        results.filter((r: any) => r.document).forEach((r: any) => {
          const doc = fromDoc(r.document);
          if (doc.author) authors.add(doc.author as string);
        });
        return res.json([...authors]);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
