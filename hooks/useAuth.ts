import { useState, useEffect, useCallback } from 'react';
import { auth, loginWithGoogle, logout as firebaseLogout, isAuthorizedEmail, checkServerAuthorization } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export interface CustomUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  role: string;
  displayName: string;
  allowedTabs: string[];
  // Compatibility with Firebase User shape used in App.tsx
  email: string;
  photoURL: null;
  uid: string;
}

const CUSTOM_AUTH_KEY = 'stash_custom_auth';

export function useAuth() {
  const [user, setUser] = useState<User | CustomUser | null>(null);
  const [customToken, setCustomToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Check for stored custom auth on mount
  useEffect(() => {
    const stored = localStorage.getItem(CUSTOM_AUTH_KEY);
    if (stored) {
      try {
        const { token, user: storedUser } = JSON.parse(stored);
        // Verify token is still valid
        fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', token }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.user) {
              const cu: CustomUser = {
                ...data.user,
                email: `@${data.user.username}`,
                photoURL: null,
                uid: data.user.id,
              };
              setUser(cu);
              setCustomToken(token);
            } else {
              localStorage.removeItem(CUSTOM_AUTH_KEY);
            }
          })
          .catch(() => {
            // Token verify failed — clear stored auth; require re-login
            localStorage.removeItem(CUSTOM_AUTH_KEY);
          })
          .finally(() => setIsAuthLoading(false));
      } catch {
        localStorage.removeItem(CUSTOM_AUTH_KEY);
        setIsAuthLoading(false);
      }
    }
  }, []);

  // Firebase auth listener. The listener itself is synchronous, but the
  // authorisation check requires a trip to the server (Firestore allow-
  // list). We run it inside an async IIFE so the subscription stays
  // non-blocking while the decision is being made.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (localStorage.getItem(CUSTOM_AUTH_KEY)) {
        // Custom username/password session takes precedence; ignore the
        // Firebase listener in that case.
        setIsAuthLoading(false);
        return;
      }
      if (!currentUser) {
        setUser(null);
        setIsAuthLoading(false);
        return;
      }

      (async () => {
        // Sanity check — Firebase should always give us an email, but
        // guard anyway. The authoritative gate is the server allow-list
        // check below; there is no domain restriction any more.
        if (!isAuthorizedEmail(currentUser.email)) {
          setUser(null);
          setAuthError(`Access Denied: no email was returned from your Google account.`);
          try { await firebaseLogout(); } catch {}
          setIsAuthLoading(false);
          return;
        }

        // Senior-management allow-list check (authoritative gate).
        try {
          const idToken = await currentUser.getIdToken();
          const result = await checkServerAuthorization(idToken);
          if (result.authorized) {
            setUser(currentUser);
            setAuthError(null);
          } else {
            setUser(null);
            const msg = result.reason === 'not_on_list'
              ? `Access Denied: ${currentUser.email} is not on the senior-management allow-list. Contact the system owner to request access.`
              : result.reason === 'invalid_token_or_domain'
                ? `Access Denied: we could not verify your account.`
                : `Access Denied: authorization check failed. Please try again in a moment.`;
            setAuthError(msg);
            try { await firebaseLogout(); } catch {}
          }
        } catch {
          setUser(null);
          setAuthError('Authorization check failed. Please try again.');
          try { await firebaseLogout(); } catch {}
        } finally {
          setIsAuthLoading(false);
        }
      })();
    });
    return () => unsubscribe();
  }, []);

  const loginWithPassword = useCallback(async (username: string, password: string) => {
    setAuthError(null);
    try {
      const resp = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAuthError(data.error || 'Login failed');
        return;
      }
      const cu: CustomUser = {
        ...data.user,
        email: `@${data.user.username}`,
        photoURL: null,
        uid: data.user.id,
      };
      setUser(cu);
      setCustomToken(data.token);
      localStorage.setItem(CUSTOM_AUTH_KEY, JSON.stringify({ token: data.token, user: cu }));
    } catch (e: any) {
      setAuthError(e.message || 'Login failed');
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(CUSTOM_AUTH_KEY);
    setCustomToken(null);
    setUser(null);
    setAuthError(null);
    try { await firebaseLogout(); } catch {}
  }, []);

  const isCustomUser = user !== null && 'username' in user;
  const customUserData = isCustomUser ? (user as CustomUser) : null;

  return {
    user,
    isAuthLoading,
    authError,
    loginWithGoogle,
    loginWithPassword,
    logout,
    customToken,
    customUserData,
    isCustomUser,
  };
}
