import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stash-shop-bridge';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const ALLOWLIST_COLLECTION = 'stash_authorized_users';
const USERS_COLLECTION = 'stash_users';
const OWNER_EMAIL = 'office@marxcorporate.com';
const SESSION_SECRET = process.env.SESSION_SECRET || '';

const ALLOWED_ROTA_TABLES = new Set([
    'stash_rota_employees',
    'stash_rota_shifts',
    'stash_rota_time_off',
    'stash_rota_closures',
    'stash_rota_swap_requests',
    'stash_rota_shift_acks',
    'stash_rota_toil',
    'stash_rota_blocked_dates',
    'stash_rota_audit',
]);

function allowCors(req: VercelRequest, res: VercelResponse): void {
    const origin = req.headers.origin || '';
    if (
        origin === 'https://stashoverview.co.uk' ||
        origin === 'https://www.stashoverview.co.uk' ||
        origin === 'http://localhost:3000' ||
        (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))
    ) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');
}

function allowlistDocId(email: string): string {
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
    } catch {
        return undefined;
    }
}

function fsHeaders(authToken?: string): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
}

async function isOnAllowList(email: string, authToken?: string): Promise<boolean> {
    const id = allowlistDocId(email);
    try {
        const resp = await fetch(`${FIRESTORE_BASE}/${ALLOWLIST_COLLECTION}/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`, {
            headers: fsHeaders(authToken),
        });
        if (!resp.ok) return false;
        const doc = await resp.json();
        return doc?.fields?.is_active?.booleanValue !== false;
    } catch {
        return false;
    }
}

async function verifyFirebaseIdToken(idToken: string, authToken?: string): Promise<{ email: string } | null> {
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
        const email = String(user.email).toLowerCase();
        if (email === OWNER_EMAIL.toLowerCase()) return { email };
        const ok = await isOnAllowList(email, authToken);
        if (!ok) return null;
        return { email };
    } catch {
        return null;
    }
}

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
    } catch {
        return null;
    }
}

type Actor = {
    id: string;
    rotaUserId: string;
    role: string;
    isSenior: boolean;
};

async function authenticate(body: any): Promise<Actor> {
    const token = String(body?.token || '').trim();
    const firebaseIdToken = String(body?.firebaseIdToken || '').trim();
    const firestoreAuth = await getAnonToken().catch(() => undefined);

    if (firebaseIdToken) {
        const verified = await verifyFirebaseIdToken(firebaseIdToken, firestoreAuth);
        if (!verified) throw new Error('Invalid Firebase token or email not on allow-list');
        return {
            id: `google:${verified.email}`,
            rotaUserId: verified.email,
            role: 'superuser',
            isSenior: true,
        };
    }

    const session = verifyCustomToken(token);
    if (!session) throw new Error('Invalid or expired session');
    let username = session.userId;
    try {
        const resp = await fetch(`${FIRESTORE_BASE}/${USERS_COLLECTION}/${encodeURIComponent(session.userId)}?key=${FIREBASE_API_KEY}`, {
            headers: fsHeaders(firestoreAuth),
        });
        if (resp.ok) {
            const doc = await resp.json();
            username = doc?.fields?.username?.stringValue || session.userId;
        }
    } catch {
        // fallback to id
    }
    return {
        id: session.userId,
        rotaUserId: username,
        role: session.role,
        isSenior: session.role === 'superuser' || session.role === 'admin',
    };
}

function tableFromPath(path: string): string {
    return String(path || '').split('?')[0];
}

function methodUpper(method: string): string {
    return String(method || 'GET').toUpperCase();
}

function idFromEqPath(path: string): number | null {
    const m = path.match(/(?:\?|&)id=eq\.([0-9]+)/);
    if (!m) return null;
    const id = parseInt(m[1], 10);
    return Number.isFinite(id) ? id : null;
}

async function fetchOneById(table: string, id: number, supabaseUrl: string, supabaseKey: string): Promise<any | null> {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&id=eq.${id}&limit=1`, {
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
        },
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
}

async function assertAllowedWrite(
    actor: Actor,
    table: string,
    method: string,
    path: string,
    body: any,
    supabaseUrl: string,
    supabaseKey: string,
): Promise<void> {
    if (actor.isSenior) return;

    // Non-senior users can only perform request-style actions.
    // They cannot amend rota structure, employees, closures, reports, etc.
    if (table === 'stash_rota_time_off') {
        if (method === 'POST') {
            const row = Array.isArray(body) ? body[0] : body;
            if (!row || row.user_id !== actor.rotaUserId || row.status !== 'pending') {
                throw new Error('You can only create your own pending time-off request.');
            }
            return;
        }
        if (method === 'PATCH') {
            const id = idFromEqPath(path);
            if (!id) throw new Error('Invalid request id.');
            const existing = await fetchOneById(table, id, supabaseUrl, supabaseKey);
            if (!existing) throw new Error('Time-off request not found.');
            const next = body || {};
            const onlyCancel =
                next.status === 'cancelled' &&
                !('decided_by' in next) &&
                !('decided_at' in next) &&
                !('decided_note' in next);
            if (existing.user_id !== actor.rotaUserId || existing.status !== 'pending' || !onlyCancel) {
                throw new Error('Only pending requests created by you can be cancelled.');
            }
            return;
        }
        throw new Error('Write not permitted on time-off.');
    }

    if (table === 'stash_rota_swap_requests') {
        if (method === 'POST') {
            const row = Array.isArray(body) ? body[0] : body;
            if (!row || row.requester_id !== actor.rotaUserId || row.status !== 'pending') {
                throw new Error('You can only create your own pending swap request.');
            }
            return;
        }
        if (method === 'PATCH') {
            const id = idFromEqPath(path);
            if (!id) throw new Error('Invalid swap id.');
            const existing = await fetchOneById(table, id, supabaseUrl, supabaseKey);
            if (!existing) throw new Error('Swap request not found.');
            const next = body || {};
            const onlyCancel =
                next.status === 'cancelled' &&
                !('decided_by' in next) &&
                !('decided_at' in next);
            if (existing.requester_id !== actor.rotaUserId || existing.status !== 'pending' || !onlyCancel) {
                throw new Error('Only your own pending swap request can be cancelled.');
            }
            return;
        }
        throw new Error('Write not permitted on swap requests.');
    }

    if (table === 'stash_rota_shift_acks' && method === 'POST') {
        const row = Array.isArray(body) ? body[0] : body;
        if (!row || row.user_id !== actor.rotaUserId) {
            throw new Error('You can only acknowledge your own shifts.');
        }
        return;
    }

    throw new Error('Only senior management can amend the rota.');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    allowCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey =
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        '';
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: 'Supabase credentials not configured on server' });
    }

    const { path, method, body, prefer } = req.body || {};
    const reqPath = String(path || '');
    const reqMethod = methodUpper(method);
    const table = tableFromPath(reqPath);

    if (!reqPath) return res.status(400).json({ error: 'path is required' });
    if (!ALLOWED_ROTA_TABLES.has(table)) return res.status(403).json({ error: 'Table not allowed' });

    try {
        const actor = await authenticate(req.body || {});
        if (!['GET', 'HEAD'].includes(reqMethod)) {
            await assertAllowedWrite(actor, table, reqMethod, reqPath, body, supabaseUrl, supabaseKey);
        }

        const headers: Record<string, string> = {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
        };
        if (prefer) headers.Prefer = String(prefer);

        const response = await fetch(`${supabaseUrl}/rest/v1/${reqPath}`, {
            method: reqMethod,
            headers,
            body: body && !['GET', 'HEAD'].includes(reqMethod) ? JSON.stringify(body) : undefined,
        });

        const text = await response.text();
        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        return res.send(text);
    } catch (err: any) {
        const msg = err?.message || 'Access denied';
        const status =
            msg.includes('Invalid') || msg.includes('Authentication')
                ? 401
                : msg.includes('Only') || msg.includes('permitted')
                    ? 403
                    : 400;
        return res.status(status).json({ error: msg });
    }
}

