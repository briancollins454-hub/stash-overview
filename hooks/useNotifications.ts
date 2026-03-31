import { useCallback, useEffect, useRef } from 'react';

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(p => { permissionRef.current = p; });
    }
  }, []);

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    if (typeof Notification === 'undefined' || permissionRef.current !== 'granted') return;
    if (document.hasFocus()) return; // Only notify when tab is not focused
    new Notification(title, { icon: '/favicon.ico', ...options });
  }, []);

  return { notify };
}
