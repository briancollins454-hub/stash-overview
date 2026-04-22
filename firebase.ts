import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

/**
 * Fast, client-side domain fence. This is the first line of defence
 * only — the authoritative gate is the server allow-list (see
 * `checkServerAuthorization` below and the `api/authorized-users`
 * endpoint). We keep this check in place so we can reject obviously
 * wrong accounts immediately, without a network round-trip.
 */
export const isAuthorizedEmail = (email: string | null): boolean => {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return domain === 'marxcorporate.com' || domain === 'stashshop.co.uk';
};

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
  user?: { email: string; displayName: string; phone: string; isOwner: boolean };
}

/**
 * Senior-management allow-list check. Called immediately after Google
 * sign-in with the user's Firebase ID token. The server verifies the
 * token and consults the Firestore allow-list (collection
 * `stash_authorized_users`). Owner email is always authorised.
 */
export async function checkServerAuthorization(idToken: string): Promise<AuthorizationResult> {
  try {
    const resp = await fetch('/api/authorized-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', firebaseIdToken: idToken }),
    });
    if (!resp.ok) {
      // Server error — fail closed so we don't accidentally grant access.
      return { authorized: false, reason: `server_error_${resp.status}` };
    }
    return await resp.json();
  } catch {
    return { authorized: false, reason: 'network_error' };
  }
}
