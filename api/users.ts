import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';

// Use a dedicated secret, falling back to Supabase key
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SUPABASE_ANON_KEY || '';

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

function createToken(userId: string, role: string): string {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 day expiry
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
    if (hmac !== expectedHmac) return null;
    if (Date.now() > parseInt(expiryStr)) return null;
    return { userId, role };
  } catch {
    return null;
  }
}

async function supabaseRequest(path: string, method: string, body?: any, prefer?: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase not configured');

  const headers: Record<string, string> = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers['Prefer'] = prefer;

  const opts: RequestInit = { method, headers };
  if (body && !['GET', 'HEAD'].includes(method)) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, opts);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// Verify a Firebase ID token by calling Google's tokeninfo endpoint
async function verifyFirebaseToken(idToken: string): Promise<{ email: string } | null> {
  try {
    const resp = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.email) return null;
    const domain = data.email.split('@')[1]?.toLowerCase();
    if (domain !== 'marxcorporate.com' && domain !== 'stashshop.co.uk') return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

// Check if caller has admin-level role (superuser or admin)
// Also accepts Firebase ID tokens from authorized Google accounts (treated as superuser)
function requireAdmin(tokenStr: string | undefined, firebaseIdToken?: string): { userId: string; role: string } | Promise<{ userId: string; role: string }> {
  if (firebaseIdToken) {
    return verifyFirebaseToken(firebaseIdToken).then(result => {
      if (!result) throw new Error('Invalid Firebase token or unauthorized domain');
      return { userId: `google:${result.email}`, role: 'superuser' };
    });
  }
  if (!tokenStr) throw new Error('Authentication required');
  const verified = verifyToken(tokenStr);
  if (!verified) throw new Error('Invalid or expired session');
  if (verified.role !== 'superuser' && verified.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return verified;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const { action, token, firebaseIdToken, ...data } = req.body || {};

  try {
    switch (action) {
      // ─── LOGIN ────────────────────────────────────────
      case 'login': {
        const { username, password } = data;
        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password required' });
        }
        // Query user by username
        const users = await supabaseRequest(
          `stash_users?username=eq.${encodeURIComponent(username)}&is_active=eq.true&select=*`,
          'GET'
        );
        if (!users || users.length === 0) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        const user = users[0];
        if (!verifyPassword(password, user.password_hash)) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        const sessionToken = createToken(user.id, user.role);
        return res.json({
          token: sessionToken,
          user: {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
            role: user.role,
            displayName: `${user.first_name} ${user.last_name}`,
          },
        });
      }

      // ─── VERIFY TOKEN ────────────────────────────────
      case 'verify': {
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const verified = verifyToken(token);
        if (!verified) return res.status(401).json({ error: 'Invalid or expired token' });

        // Fetch fresh user data
        const users = await supabaseRequest(
          `stash_users?id=eq.${encodeURIComponent(verified.userId)}&is_active=eq.true&select=id,first_name,last_name,username,role`,
          'GET'
        );
        if (!users || users.length === 0) {
          return res.status(401).json({ error: 'User no longer active' });
        }
        const u = users[0];
        return res.json({
          user: {
            id: u.id,
            firstName: u.first_name,
            lastName: u.last_name,
            username: u.username,
            role: u.role,
            displayName: `${u.first_name} ${u.last_name}`,
          },
        });
      }

      // ─── LIST USERS ──────────────────────────────────
      case 'list': {
        await requireAdmin(token, firebaseIdToken);
        const users = await supabaseRequest(
          'stash_users?select=id,first_name,last_name,username,role,is_active,created_at,created_by&order=created_at.asc',
          'GET'
        );
        return res.json(users || []);
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
        // Only superusers can create superusers
        if (role === 'superuser' && caller.role !== 'superuser') {
          return res.status(403).json({ error: 'Only superusers can create superuser accounts' });
        }
        // Check for duplicate username
        const existing = await supabaseRequest(
          `stash_users?username=eq.${encodeURIComponent(username)}&select=id`,
          'GET'
        );
        if (existing && existing.length > 0) {
          return res.status(409).json({ error: 'Username already exists' });
        }
        const passwordHash = hashPassword(password);
        await supabaseRequest('stash_users', 'POST', {
          first_name: firstName,
          last_name: lastName,
          username,
          password_hash: passwordHash,
          role,
          is_active: true,
          created_by: caller.userId,
        }, 'return=minimal');
        return res.json({ success: true });
      }

      // ─── UPDATE USER ─────────────────────────────────
      case 'update': {
        const caller = await requireAdmin(token, firebaseIdToken);
        const { userId, firstName, lastName, role, password, isActive } = data;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const updates: Record<string, any> = {};
        if (firstName !== undefined) updates.first_name = firstName;
        if (lastName !== undefined) updates.last_name = lastName;
        if (role !== undefined) {
          const validRoles = ['superuser', 'admin', 'manager', 'viewer'];
          if (!validRoles.includes(role)) {
            return res.status(400).json({ error: `Invalid role` });
          }
          if (role === 'superuser' && caller.role !== 'superuser') {
            return res.status(403).json({ error: 'Only superusers can assign superuser role' });
          }
          updates.role = role;
        }
        if (password) {
          updates.password_hash = hashPassword(password);
        }
        if (isActive !== undefined) updates.is_active = isActive;

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: 'No updates provided' });
        }

        await supabaseRequest(
          `stash_users?id=eq.${encodeURIComponent(userId)}`,
          'PATCH',
          updates,
          'return=minimal'
        );
        return res.json({ success: true });
      }

      // ─── DELETE USER (soft delete) ────────────────────
      case 'delete': {
        const caller = await requireAdmin(token, firebaseIdToken);
        const { userId } = data;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        // Prevent self-delete
        if (userId === caller.userId) {
          return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        await supabaseRequest(
          `stash_users?id=eq.${encodeURIComponent(userId)}`,
          'PATCH',
          { is_active: false },
          'return=minimal'
        );
        return res.json({ success: true });
      }

      // ─── SETUP: create table bootstrap ────────────────
      case 'setup': {
        // Check if any users exist — if not, this is first-time setup
        try {
          const users = await supabaseRequest('stash_users?select=id&limit=1', 'GET');
          return res.json({ hasUsers: users && users.length > 0, tableExists: true });
        } catch (e: any) {
          // Table likely doesn't exist
          return res.json({ hasUsers: false, tableExists: false, setupRequired: true,
            sql: `CREATE TABLE stash_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

-- Allow anonymous key access (matches your existing RLS pattern)
ALTER TABLE stash_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON stash_users FOR ALL USING (true) WITH CHECK (true);`
          });
        }
      }

      // ─── BOOTSTRAP: create first superuser (no token needed) ──
      case 'bootstrap': {
        // Only works if no users exist yet
        try {
          const users = await supabaseRequest('stash_users?select=id&limit=1', 'GET');
          if (users && users.length > 0) {
            return res.status(403).json({ error: 'Users already exist. Use admin panel to add users.' });
          }
        } catch {
          return res.status(500).json({ error: 'Table stash_users does not exist. Create it first using the SQL from the setup action.' });
        }
        const { firstName, lastName, username, password } = data;
        if (!firstName || !lastName || !username || !password) {
          return res.status(400).json({ error: 'All fields required for bootstrap' });
        }
        const passwordHash = hashPassword(password);
        await supabaseRequest('stash_users', 'POST', {
          first_name: firstName,
          last_name: lastName,
          username,
          password_hash: passwordHash,
          role: 'superuser',
          is_active: true,
          created_by: 'bootstrap',
        }, 'return=minimal');
        return res.json({ success: true, message: 'Superuser created. You can now log in.' });
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
