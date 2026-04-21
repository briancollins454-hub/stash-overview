/**
 * Auth fetch interceptor.
 *
 * Phase A of API hardening: attach the user's auth credentials to every
 * request the frontend makes to `/api/*`, so the backend can validate
 * them. This commit is *observationally invisible*:
 *   - Backends currently ignore unknown headers, so nothing changes.
 *   - In Phase B, individual API routes will start actually reading and
 *     verifying these headers. One route at a time, each independently
 *     revertible.
 *
 * Credentials attached (only when present):
 *   Authorization: Bearer <session-token>   (custom username/password login)
 *   X-Firebase-Id-Token: <id-token>         (Google sign-in)
 *
 * Never overrides a header the caller explicitly set.
 * Never intercepts non-/api/ requests (Shopify, third-party APIs, etc.).
 * Never throws — on any failure we pass through to the original fetch so
 * a broken interceptor can't take the app down.
 */

import { auth } from '../firebase';

const CUSTOM_AUTH_KEY = 'stash_custom_auth';

function getCustomToken(): string | null {
    try {
        const stored = localStorage.getItem(CUSTOM_AUTH_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return typeof parsed?.token === 'string' ? parsed.token : null;
    } catch {
        return null;
    }
}

async function getFirebaseIdToken(): Promise<string | null> {
    try {
        const user = auth.currentUser;
        if (!user) return null;
        // Does NOT force-refresh; getIdToken() returns the cached token if
        // still valid and refreshes transparently when it isn't. If the
        // refresh fails we just return null rather than blocking the fetch.
        return await user.getIdToken();
    } catch {
        return null;
    }
}

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
    try {
        let url: string;
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof URL) {
            url = input.toString();
        } else {
            return false; // Request objects handled separately (pass-through).
        }
        if (url.startsWith('/api/')) return true;
        const parsed = new URL(url, window.location.origin);
        return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
    } catch {
        return false;
    }
}

let installed = false;

export function installAuthFetchInterceptor(): void {
    if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    installed = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        // Request objects already carry their own sealed headers/body; mutating
        // them is risky and unnecessary in this codebase (all call sites use
        // fetch(url, init)). Pass through unchanged.
        if (input instanceof Request) {
            return originalFetch(input, init);
        }

        if (!isSameOriginApiRequest(input)) {
            return originalFetch(input, init);
        }

        try {
            const headers = new Headers(init?.headers || {});

            if (!headers.has('Authorization') && !headers.has('authorization')) {
                const token = getCustomToken();
                if (token) headers.set('Authorization', `Bearer ${token}`);
            }

            if (!headers.has('X-Firebase-Id-Token')) {
                const idToken = await getFirebaseIdToken();
                if (idToken) headers.set('X-Firebase-Id-Token', idToken);
            }

            return originalFetch(input, { ...init, headers });
        } catch (e) {
            // Never block a request just because our interceptor had a bad day.
            console.warn('[auth-interceptor] header injection failed, passing through:', e);
            return originalFetch(input, init);
        }
    };
}
