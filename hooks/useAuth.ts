import { useState, useEffect } from 'react';
import { auth, loginWithGoogle, logout, isAuthorizedEmail } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        if (isAuthorizedEmail(currentUser.email)) {
          setUser(currentUser);
          setAuthError(null);
        } else {
          setUser(null);
          setAuthError(`Access Denied: ${currentUser.email} is not authorized. Please use a @marxcorporate.com or @stashshop.co.uk email.`);
          logout();
        }
      } else {
        setUser(null);
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return { user, isAuthLoading, authError, loginWithGoogle, logout };
}
