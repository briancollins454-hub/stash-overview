import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, MessageSquare, CheckCheck } from 'lucide-react';
import { AppNotification, fetchUnreadNotifications, markNotificationRead, markAllNotificationsRead } from '../services/notificationService';

interface Props {
  username: string;
  onOpenOrder?: (orderId: string, orderNumber: string) => void;
}

const POLL_INTERVAL = 30_000; // 30 seconds

// Play a notification sound
function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
    // Second tone
    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1100;
        osc2.type = 'sine';
        gain2.gain.value = 0.15;
        osc2.start();
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc2.stop(ctx.currentTime + 0.3);
      } catch {}
    }, 150);
  } catch {}
}

// Show notification via service worker (works in PWAs on mobile)
async function showPushNotification(title: string, body: string, tag: string) {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      // `vibrate` and `renotify` are non-standard extensions (Chrome/Android)
      // that the current TS DOM lib does not type. Cast to sidestep the type.
      const opts: NotificationOptions = {
        body,
        tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        requireInteraction: false,
      };
      (opts as any).vibrate = [200, 100, 200];
      (opts as any).renotify = true;
      await reg.showNotification(title, opts);
      return;
    }
  } catch {}
  // Fallback to basic Notification API
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag, icon: '/icon-192.png' });
    }
  } catch {}
}

const NotificationBell: React.FC<Props> = ({ username, onOpenOrder }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set<string>());
  const initedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load seenIds from localStorage once on mount
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    try {
      const saved = localStorage.getItem('stash_seen_notif_ids');
      if (saved) seenIdsRef.current = new Set<string>(JSON.parse(saved));
    } catch {}
  }, []);

  const poll = useCallback(async () => {
    if (!username) return;
    const notifs = await fetchUnreadNotifications(username);
    setNotifications(notifs);

    // Check for truly new notifications
    const newOnes = notifs.filter(n => !seenIdsRef.current.has(n.id));
    if (newOnes.length > 0) {
      // Request permission if needed
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';

      // Show OS-level notifications
      if (canNotify) {
        for (const n of newOnes.slice(0, 3)) {
          showPushNotification(
            `💬 ${n.sender_name} mentioned you`,
            `Order #${n.order_number}: ${n.message_preview.slice(0, 80)}`,
            `mention-${n.id}`
          );
        }
      }

      // Play sound
      playNotificationSound();

      // Update seen IDs
      newOnes.forEach(n => seenIdsRef.current.add(n.id));
      // Trim to last 200
      const arr = [...seenIdsRef.current].slice(-200);
      seenIdsRef.current = new Set(arr);
      localStorage.setItem('stash_seen_notif_ids', JSON.stringify(arr));
    }
  }, [username]);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [poll]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = (notif: AppNotification) => {
    markNotificationRead(notif.id);
    setNotifications(prev => prev.filter(n => n.id !== notif.id));
    setOpen(false);
    onOpenOrder?.(notif.order_id, notif.order_number);
  };

  const handleMarkAllRead = () => {
    markAllNotificationsRead(username);
    setNotifications([]);
  };

  const count = notifications.length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="text-indigo-300 hover:text-white p-2 rounded hover:bg-white/5 transition-colors relative"
        title={`${count} unread mention${count !== 1 ? 's' : ''}`}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[9px] font-black rounded-full px-1 shadow-lg animate-pulse">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-16 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px] max-h-[420px] bg-white rounded-xl shadow-2xl border border-gray-200 z-[200] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white">
            <span className="text-xs font-black uppercase tracking-widest text-gray-700">Mentions</span>
            <div className="flex items-center gap-2">
              {count > 0 && (
                <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1" title="Mark all read">
                  <CheckCheck className="w-3.5 h-3.5" /> All read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto max-h-[360px]">
            {count === 0 ? (
              <div className="text-center py-10">
                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No unread mentions</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full text-left px-4 py-3 hover:bg-indigo-50/60 border-b border-gray-50 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-black shrink-0 mt-0.5">
                      {n.sender_name[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-gray-800">{n.sender_name}</span>
                        <span className="text-[10px] text-gray-400 font-bold">mentioned you</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <MessageSquare className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Order #{n.order_number}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">{n.message_preview}</p>
                      <span className="text-[9px] text-gray-300 font-bold mt-1 block">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default NotificationBell;
