/**
 * Senior Management Access — allow-list for Google sign-in (Phase 1)
 * -------------------------------------------------------------------
 * Firestore collection `stash_authorized_users` holds the rows of
 * people who are permitted to sign in with Google. Every Google login
 * now goes through the `check` action on this endpoint; unauthorised
 * emails are rejected immediately.
 *
 * Why this file exists separately from api/users.ts:
 *   - Different collection, different concern (allow-list vs custom
 *     password logins). Kept separate so revoking/rolling back one
 *     does not touch the other.
 *   - Custom (username/password) users continue to work unchanged —
 *     they are a separate escape hatch if anyone loses Google access.
 *
 * Master-key safeguard:
 *   OWNER_EMAIL ('office@marxcorporate.com') is always treated as
 *   authorised, regardless of the list contents. This guarantees the
 *   owner can never be locked out if the Firestore record is missing,
 *   or on first deploy when the list is empty.
 *
 * Phase 1 scope: email allow-list only. Phone numbers are captured
 * now but not yet used for authentication — that is Phase 2 (SMS OTP
 * via Firebase Phone Auth).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stash-shop-bridge';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = 'stash_authorized_users';
const SESSION_SECRET = process.env.SESSION_SECRET || '';

/** Hardcoded master key — owner can never be locked out. */
const OWNER_EMAIL = 'office@marxcorporate.com';

/** The email domains that remain acceptable at the Firebase layer.
 *  Kept as defence-in-depth so a compromised allow-list entry cannot
 *  grant access to an arbitrary Google account. */
const TRUSTED_DOMAINS = new Set(['marxcorporate.com', 'stashshop.co.uk']);

/* ─── Firestore helpers (scoped to this endpoint's collection) ─────── */

interface AuthorisedUser {
  email: string;
  phone: string;
  display_name: string;
  added_by: string;
  added_at: string;
  notes?: string;
  is_active?: boolean;
}

function toFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      fields[key] = { arrayValue: { values: value.map((v: string) => ({ stringValue: String(v) })) } };
    } else if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { integerValue: String(value) };
    else if (value === null) fields[key] = { nullValue: null };
  }
  return fields;
}

function fromFirestoreDoc(doc: any): AuthorisedUser | null {
  if (!doc?.fields) return null;
  const f = doc.fields;
  return {
    email: f.email?.stringValue || '',
    phone: f.phone?.stringValue || '',
    display_name: f.display_name?.stringValue || '',
    added_by: f.added_by?.stringValue || '',
    added_at: f.added_at?.stringValue || '',
    notes: f.notes?.stringValue || '',
    is_active: f.is_active?.booleanValue !== false,
  };
}

/** Firestore doc IDs must not contain '/' and we want them stable and
 *  URL-safe. Lowercased email with '@' and '.' replaced is readable
 *  when you browse the DB and is unique per account. */
function emailToDocId(email: string): string {
  return email.toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_dot_');
}

async function getAnonToken(): Promise<string | undefined> {
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!resp.ok) return undefined;
    return (await resp.json()).idToken;
  } catch { return undefined; }
}

function fsHeaders(authToken?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

async function firestoreListAll(authToken?: string): Promise<AuthorisedUser[]> {
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}?key=${FIREBASE_API_KEY}`, {
    headers: fsHeaders(authToken),
  });
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Firestore list error: ${resp.status}`);
  }
  const data = await resp.json();
  return (data.documents || [])
    .map(fromFirestoreDoc)
    .filter((x: AuthorisedUser | null): x is AuthorisedUser => x !== null);
}

async function firestoreGetByEmail(email: string, authToken?: string): Promise<AuthorisedUser | null> {
  const id = emailToDocId(email);
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`, {
    headers: fsHeaders(authToken),
  });
  if (!resp.ok) return null;
  return fromFirestoreDoc(await resp.json());
}

async function firestoreUpsertByEmail(email: string, fields: Record<string, any>, authToken?: string): Promise<void> {
  const id = emailToDocId(email);
  // PATCH with documentId upserts in PostgREST-style; Firestore REST needs
  // a slightly different approach — we use createDocument if missing, else
  // patch. The simplest write-either-way path is `patch` which creates the
  // doc if the mask is provided.
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${updateMask}&key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: fsHeaders(authToken),
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!resp.ok) throw new Error(`Firestore upsert error: ${resp.status} ${await resp.text()}`);
}

async function firestoreDeleteByEmail(email: string, authToken?: string): Promise<void> {
  const id = emailToDocId(email);
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`, {
    method: 'DELETE',
    headers: fsHeaders(authToken),
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Firestore delete error: ${resp.status} ${await resp.text()}`);
  }
}

/* ─── Firebase ID-token verification ───────────────────────────────── */

async function verifyFirebaseIdToken(idToken: string): Promise<{ email: string } | null> {
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const user = data.users?.[0];
    if (!user?.email) return null;
    const domain = user.email.split('@')[1]?.toLowerCase();
    if (!TRUSTED_DOMAINS.has(domain)) return null;
    return { email: user.email.toLowerCase() };
  } catch {
    return null;
  }
}

/* ─── Custom session token (from api/users.ts) validation ──────────── */
// We accept the same HMAC token format that api/users.ts issues so a
// logged-in superuser can manage the allow-list without needing a
// separate Google session. Keeps the admin UI usable for username/
// password superusers.

function verifyCustomToken(token: string): { userId: string; role: string } | null {
  try {
    if (!SESSION_SECRET) return null;
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split('|');
    if (parts.length !== 4) return null;
    const [userId, role, expiryStr, hmac] = parts;
    const payload = `${userId}|${role}|${expiryStr}`;
    const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (hmac.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return null;
    if (Date.now() > parseInt(expiryStr, 10)) return null;
    return { userId, role };
  } catch { return null; }
}

/** Superuser gate — Google ID token OR custom session token. */
async function requireSuperuser(req: VercelRequest): Promise<{ who: string }> {
  const { token, firebaseIdToken } = (req.body || {}) as Record<string, string | undefined>;
  if (firebaseIdToken) {
    const result = await verifyFirebaseIdToken(firebaseIdToken);
    if (!result) throw new Error('Invalid Firebase token or untrusted domain');
    // Only the owner OR an existing authorised user with role=superuser
    // could be here, but we don't track roles on the allow-list in
    // Phase 1. Treat any successful Google auth whose email is either
    // the OWNER or is already on the allow-list as superuser-for-this-
    // endpoint. This is safe because adding to the list requires passing
    // this check in the first place (bootstrap via OWNER_EMAIL).
    if (result.email === OWNER_EMAIL.toLowerCase()) return { who: `google:${result.email}` };
    const authToken = await getAnonToken();
    const existing = await firestoreGetByEmail(result.email, authToken);
    if (existing && existing.is_active !== false) return { who: `google:${result.email}` };
    throw new Error('Email not on senior-management allow-list');
  }
  if (!token) throw new Error('Authentication required');
  const verified = verifyCustomToken(token);
  if (!verified) throw new Error('Invalid or expired session');
  if (verified.role !== 'superuser') throw new Error('Superuser access required');
  return { who: `custom:${verified.userId}` };
}

/* ─── Handler ──────────────────────────────────────────────────────── */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = (req.body || {}) as Record<string, any>;
  const action: string = body.action;

  try {
    switch (action) {
      /** Public-ish: called by the client right after Google sign-in to
       *  determine whether the user is allowed to proceed. Requires a
       *  valid Firebase ID token so we can trust the email. */
      case 'check': {
        const { firebaseIdToken } = body;
        if (!firebaseIdToken) return res.status(400).json({ authorized: false, error: 'firebaseIdToken required' });
        const verified = await verifyFirebaseIdToken(firebaseIdToken);
        if (!verified) return res.json({ authorized: false, reason: 'invalid_token_or_domain' });
        const email = verified.email;

        // Master key — owner is always authorised.
        if (email === OWNER_EMAIL.toLowerCase()) {
          return res.json({ authorized: true, user: { email, displayName: 'Owner', phone: '', isOwner: true } });
        }

        const authToken = await getAnonToken();
        const row = await firestoreGetByEmail(email, authToken);
        if (!row || row.is_active === false) {
          return res.json({ authorized: false, reason: 'not_on_list', email });
        }
        return res.json({
          authorized: true,
          user: {
            email: row.email || email,
            displayName: row.display_name,
            phone: row.phone,
            isOwner: false,
          },
        });
      }

      case 'list': {
        await requireSuperuser(req);
        const authToken = await getAnonToken();
        const rows = await firestoreListAll(authToken);
        return res.json(rows.map(r => ({
          email: r.email,
          phone: r.phone,
          displayName: r.display_name,
          addedBy: r.added_by,
          addedAt: r.added_at,
          notes: r.notes || '',
          isActive: r.is_active !== false,
        })));
      }

      case 'add': {
        const caller = await requireSuperuser(req);
        const { email, phone, displayName, notes } = body;
        if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });
        const clean = email.trim().toLowerCase();
        const domain = clean.split('@')[1];
        if (!domain || !TRUSTED_DOMAINS.has(domain)) {
          return res.status(400).json({ error: `Email must be on a trusted domain (${Array.from(TRUSTED_DOMAINS).join(', ')})` });
        }
        if (!displayName || typeof displayName !== 'string') return res.status(400).json({ error: 'displayName required' });
        // Phone is captured but not validated strictly in Phase 1 (Phase 2 will enforce E.164).
        const authToken = await getAnonToken();
        await firestoreUpsertByEmail(clean, {
          email: clean,
          phone: typeof phone === 'string' ? phone.trim() : '',
          display_name: displayName.trim(),
          added_by: caller.who,
          added_at: new Date().toISOString(),
          notes: typeof notes === 'string' ? notes.trim() : '',
          is_active: true,
        }, authToken);
        return res.json({ success: true });
      }

      case 'update': {
        const caller = await requireSuperuser(req);
        const { email, phone, displayName, notes, isActive } = body;
        if (!email) return res.status(400).json({ error: 'email required' });
        const clean = String(email).trim().toLowerCase();
        if (clean === OWNER_EMAIL.toLowerCase() && isActive === false) {
          return res.status(400).json({ error: 'The owner account cannot be disabled' });
        }
        const updates: Record<string, any> = {};
        if (phone !== undefined) updates.phone = String(phone).trim();
        if (displayName !== undefined) updates.display_name = String(displayName).trim();
        if (notes !== undefined) updates.notes = String(notes).trim();
        if (isActive !== undefined) updates.is_active = Boolean(isActive);
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });
        updates.added_by = caller.who; // last-edited-by; keeping added_by column for simplicity
        const authToken = await getAnonToken();
        await firestoreUpsertByEmail(clean, updates, authToken);
        return res.json({ success: true });
      }

      case 'remove': {
        await requireSuperuser(req);
        const { email } = body;
        if (!email) return res.status(400).json({ error: 'email required' });
        const clean = String(email).trim().toLowerCase();
        if (clean === OWNER_EMAIL.toLowerCase()) {
          return res.status(400).json({ error: 'The owner account cannot be removed' });
        }
        const authToken = await getAnonToken();
        await firestoreDeleteByEmail(clean, authToken);
        return res.json({ success: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    const msg: string = err?.message || 'Server error';
    const status = /Authentication|Invalid|expired|Superuser|allow-list|untrusted/i.test(msg) ? 401 : 500;
    return res.status(status).json({ error: msg });
  }
}
