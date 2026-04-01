import { useState, useEffect, useCallback } from 'react';
import { auth, loginWithGoogle, logout as firebaseLogout, isAuthorizedEmail } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export interface CustomUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  role: string;
  displayName: string;
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
            // Token verify failed — still set the stored user for offline/fast load
            // It will re-verify on next API call
            if (storedUser) {
              setUser(storedUser);
              setCustomToken(token);
            }
          })
          .finally(() => setIsAuthLoading(false));
      } catch {
        localStorage.removeItem(CUSTOM_AUTH_KEY);
        setIsAuthLoading(false);
      }
    }
  }, []);

  // Firebase auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Only set Firebase user if we don't have a custom user
      if (!localStorage.getItem(CUSTOM_AUTH_KEY)) {
        if (currentUser) {
          if (isAuthorizedEmail(currentUser.email)) {
            setUser(currentUser);
            setAuthError(null);
          } else {
            setUser(null);
            setAuthError(`Access Denied: ${currentUser.email} is not authorized. Please use a @marxcorporate.com or @stashshop.co.uk email.`);
            firebaseLogout();
          }
        } else {
          // Only clear if no custom user
          if (!localStorage.getItem(CUSTOM_AUTH_KEY)) {
            setUser(null);
          }
        }
      }
      setIsAuthLoading(false);
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
