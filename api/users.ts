import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';

// ─── Firebase Firestore Config ──────────────────────────────────────────────
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stash-shop-bridge';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = 'stash_users';

const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET env var is required');
}

// ─── Password Hashing ──────────────────────────────────────────────────────
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const derivedKey = scryptSync(password, salt, 64);
  if (hashBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(hashBuffer, derivedKey);
}

// ─── Session Tokens ────────────────────────────────────────────────────────
function createToken(userId: string, role: string): string {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${userId}|${role}|${expiry}`;
  const hmac = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}|${hmac}`).toString('base64');
}

function verifyToken(token: string): { userId: string; role: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split('|');
    if (parts.length !== 4) return null;
    const [userId, role, expiryStr, hmac] = parts;
    const payload = `${userId}|${role}|${expiryStr}`;
    const expectedHmac = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (hmac.length !== expectedHmac.length || !timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) return null;
    if (Date.now() > parseInt(expiryStr)) return null;
    return { userId, role };
  } catch {
    return null;
  }
}

// ─── Firestore Helpers ─────────────────────────────────────────────────────
interface FirestoreUser {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
  allowed_tabs: string[];
}

function toFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      fields[key] = { arrayValue: { values: value.map((v: string) => ({ stringValue: v })) } };
    } else if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { integerValue: String(value) };
    else if (value === null) fields[key] = { nullValue: null };
  }
  return fields;
}

// Default tab access per role
const DEFAULT_TABS: Record<string, string[]> = {
  superuser: ['dashboard','command','kanban','intelligence','production','reports','operations','stock','efficiency','mto','deco','revenue','autolink','fulfill','analyst','finance','users','manual','alerts','settings'],
  admin: ['dashboard','command','kanban','intelligence','production','reports','operations','stock','efficiency','mto','deco','revenue','autolink','fulfill','analyst','finance','users','manual','alerts'],
  manager: ['dashboard','command','kanban','production','operations','stock','mto','deco','fulfill','manual'],
  viewer: ['dashboard','reports','revenue'],
};

function fromFirestoreDoc(doc: any): FirestoreUser {
  const f = doc.fields || {};
  const name = (doc.name || '').split('/').pop() || '';
  const role = f.role?.stringValue || 'viewer';
  const tabValues = f.allowed_tabs?.arrayValue?.values;
  return {
    id: name,
    first_name: f.first_name?.stringValue || '',
    last_name: f.last_name?.stringValue || '',
    username: f.username?.stringValue || '',
    password_hash: f.password_hash?.stringValue || '',
    role,
    is_active: f.is_active?.booleanValue !== false,
    created_at: f.created_at?.stringValue || '',
    created_by: f.created_by?.stringValue || '',
    allowed_tabs: tabValues ? tabValues.map((v: any) => v.stringValue) : (DEFAULT_TABS[role] || DEFAULT_TABS.viewer),
  };
}

// Get a server-side anonymous Firebase token for unauthenticated operations (login, verify, bootstrap)
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

function fsHeaders(authToken?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

async function firestoreList(authToken?: string): Promise<FirestoreUser[]> {
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}?key=${FIREBASE_API_KEY}`, {
    headers: fsHeaders(authToken),
  });
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Firestore list error: ${resp.status}`);
  }
  const data = await resp.json();
  return (data.documents || []).map(fromFirestoreDoc);
}

async function firestoreGet(docId: string, authToken?: string): Promise<FirestoreUser | null> {
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${docId}?key=${FIREBASE_API_KEY}`, {
    headers: fsHeaders(authToken),
  });
  if (!resp.ok) return null;
  return fromFirestoreDoc(await resp.json());
}

async function firestoreCreate(fields: Record<string, any>, authToken?: string): Promise<string> {
  fields.created_at = new Date().toISOString();
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: fsHeaders(authToken),
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!resp.ok) throw new Error(`Firestore create error: ${resp.status} ${await resp.text()}`);
  const doc = await resp.json();
  return (doc.name || '').split('/').pop() || '';
}

async function firestoreUpdate(docId: string, updates: Record<string, any>, authToken?: string): Promise<void> {
  const updateMask = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const resp = await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${docId}?${updateMask}&key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: fsHeaders(authToken),
    body: JSON.stringify({ fields: toFirestoreFields(updates) }),
  });
  if (!resp.ok) throw new Error(`Firestore update error: ${resp.status} ${await resp.text()}`);
}

// ─── Firebase ID Token Verification ────────────────────────────────────────
async function verifyFirebaseIdToken(idToken: string): Promise<{ email: string } | null> {
  try {
    // Use Firebase Auth REST API to verify the ID token and get user info
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
    if (domain !== 'marxcorporate.com' && domain !== 'stashshop.co.uk') return null;
    return { email: user.email };
  } catch {
    return null;
  }
}

// ─── Auth Check ────────────────────────────────────────────────────────────
async function requireAdmin(tokenStr: string | undefined, firebaseIdToken?: string): Promise<{ userId: string; role: string }> {
  if (firebaseIdToken) {
    const result = await verifyFirebaseIdToken(firebaseIdToken);
    if (!result) throw new Error('Invalid Firebase token or unauthorized domain');
    return { userId: `google:${result.email}`, role: 'superuser' };
  }
  if (!tokenStr) throw new Error('Authentication required');
  const verified = verifyToken(tokenStr);
  if (!verified) throw new Error('Invalid or expired session');
  if (verified.role !== 'superuser' && verified.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return verified;
}

// ─── Format user for API response ──────────────────────────────────────────
function formatUser(u: FirestoreUser) {
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    role: u.role,
    is_active: u.is_active,
    created_at: u.created_at,
    created_by: u.created_by,
    allowed_tabs: u.allowed_tabs,
  };
}

function formatUserLogin(u: FirestoreUser) {
  return {
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    username: u.username,
    role: u.role,
    displayName: `${u.first_name} ${u.last_name}`,
    allowedTabs: u.allowed_tabs,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, token, firebaseIdToken, ...data } = req.body || {};

  // For operations without a Firebase ID token (login, verify, bootstrap), get an anonymous token
  const authToken = firebaseIdToken || await getAnonToken().catch(() => undefined);

  try {
    switch (action) {
      // ─── LOGIN ────────────────────────────────────────
      case 'login': {
        const { username, password } = data;
        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password required' });
        }
        const allUsers = await firestoreList(authToken);
        const user = allUsers.find(u => u.username === username && u.is_active);
        if (!user) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        if (!verifyPassword(password, user.password_hash)) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        const sessionToken = createToken(user.id, user.role);
        return res.json({ token: sessionToken, user: formatUserLogin(user) });
      }

      // ─── VERIFY TOKEN ────────────────────────────────
      case 'verify': {
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const verified = verifyToken(token);
        if (!verified) return res.status(401).json({ error: 'Invalid or expired token' });
        const user = await firestoreGet(verified.userId, authToken);
        if (!user || !user.is_active) {
          return res.status(401).json({ error: 'User no longer active' });
        }
        return res.json({ user: formatUserLogin(user) });
      }

      // ─── LIST USERS ──────────────────────────────────
      case 'list': {
        await requireAdmin(token, firebaseIdToken);
        const users = await firestoreList(authToken);
        return res.json(users.map(formatUser));
      }

      // ─── CREATE USER ─────────────────────────────────
      case 'create': {
        const caller = await requireAdmin(token, firebaseIdToken);
        const { firstName, lastName, username, password, role } = data;
        if (!firstName || !lastName || !username || !password) {
          return res.status(400).json({ error: 'All fields are required' });
        }
        const validRoles = ['superuser', 'admin', 'manager', 'viewer'];
        if (!validRoles.includes(role)) {
          return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }
        if (role === 'superuser' && caller.role !== 'superuser') {
          return res.status(403).json({ error: 'Only superusers can create superuser accounts' });
        }
        // Check for duplicate username
        const allUsers = await firestoreList(authToken);
        if (allUsers.some(u => u.username === username)) {
          return res.status(409).json({ error: 'Username already exists' });
        }
        const passwordHash = hashPassword(password);
        const allowedTabs = Array.isArray(data.allowedTabs) ? data.allowedTabs : (DEFAULT_TABS[role] || DEFAULT_TABS.viewer);
        await firestoreCreate({
          first_name: firstName,
          last_name: lastName,
          username,
          password_hash: passwordHash,
          role,
          is_active: true,
          created_by: caller.userId,
          allowed_tabs: allowedTabs,
        }, authToken);
        return res.json({ success: true });
      }

      // ─── UPDATE USER ─────────────────────────────────
      case 'update': {
        const caller = await requireAdmin(token, firebaseIdToken);
        const { userId, firstName, lastName, role, password, isActive, allowedTabs } = data;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const updates: Record<string, any> = {};
        if (firstName !== undefined) updates.first_name = firstName;
        if (lastName !== undefined) updates.last_name = lastName;
        if (role !== undefined) {
          const validRoles = ['superuser', 'admin', 'manager', 'viewer'];
          if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
          }
          if (role === 'superuser' && caller.role !== 'superuser') {
            return res.status(403).json({ error: 'Only superusers can assign superuser role' });
          }
          updates.role = role;
        }
        if (password) updates.password_hash = hashPassword(password);
        if (isActive !== undefined) updates.is_active = isActive;
        if (Array.isArray(allowedTabs)) {
          if (caller.role !== 'superuser') {
            return res.status(403).json({ error: 'Only superusers can change tab permissions' });
          }
          updates.allowed_tabs = allowedTabs;
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: 'No updates provided' });
        }
        await firestoreUpdate(userId, updates, authToken);
        return res.json({ success: true });
      }

      // ─── DELETE USER (soft delete) ────────────────────
      case 'delete': {
        const caller = await requireAdmin(token, firebaseIdToken);
        const { userId } = data;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (userId === caller.userId) {
          return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        await firestoreUpdate(userId, { is_active: false }, authToken);
        return res.json({ success: true });
      }

      // ─── BOOTSTRAP: create first superuser (no auth needed) ──
      case 'bootstrap': {
        const allUsers = await firestoreList(authToken);
        if (allUsers.length > 0) {
          return res.status(403).json({ error: 'Users already exist. Use admin panel to add users.' });
        }
        const { firstName, lastName, username, password } = data;
        if (!firstName || !lastName || !username || !password) {
          return res.status(400).json({ error: 'All fields required for bootstrap' });
        }
        const passwordHash = hashPassword(password);
        await firestoreCreate({
          first_name: firstName,
          last_name: lastName,
          username,
          password_hash: passwordHash,
          role: 'superuser',
          is_active: true,
          created_by: 'bootstrap',
        }, authToken);
        return res.json({ success: true, message: 'Superuser created. You can now log in.' });
      }

      // ─── LIST BASIC: public user list for @mentions (no admin required) ──
      case 'list_basic': {
        const users = await firestoreList(authToken);
        return res.json(users.filter(u => u.is_active).map(u => ({
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          displayName: `${u.first_name} ${u.last_name}`,
        })));
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    const status = err.message?.includes('Authentication') || err.message?.includes('Invalid') || err.message?.includes('expired')
      ? 401
      : err.message?.includes('Admin access') || err.message?.includes('Only superusers')
        ? 403
        : 500;
    return res.status(status).json({ error: err.message });
  }
}
