import React, { useCallback, useEffect, useState } from 'react';
import {
  flushPending,
  getPendingCount,
  readPendingQueueForUI,
  type PendingQueueItemForUI,
} from '../services/pendingSyncQueue';

const POLL_INTERVAL_MS = 5_000;
const STUCK_ATTEMPTS = 3;

const formatAge = (ageMs: number) => {
  const seconds = Math.floor(ageMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const SyncHealthBadge: React.FC = () => {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<PendingQueueItemForUI[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextCount, nextItems] = await Promise.all([
        getPendingCount(),
        readPendingQueueForUI(),
      ]);
      setCount(nextCount);
      setItems(nextItems);
    } catch (error) {
      console.warn('[pending-sync] failed to read queue health:', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const isStuck = items.some(item => item.attempts >= STUCK_ATTEMPTS);
  const tone = count === 0
    ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'
    : isStuck
      ? 'bg-red-500/15 text-red-200 border-red-400/30'
      : 'bg-amber-500/15 text-amber-200 border-amber-400/30';
  const dot = count === 0 ? 'bg-emerald-400' : isStuck ? 'bg-red-400' : 'bg-amber-400';
  const label = count === 0 ? 'Synced' : `${count} pending${isStuck ? ' (stuck)' : ''}`;

  const retryNow = async () => {
    setIsRetrying(true);
    try {
      await flushPending();
    } catch (error) {
      console.warn('[pending-sync] manual retry failed:', error);
    } finally {
      setIsRetrying(false);
      await refresh();
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => count > 0 && setIsOpen(open => !open)}
        className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider whitespace-nowrap ${tone}`}
        title={count === 0 ? 'All queued changes are synced' : 'View queued changes'}
        aria-expanded={isOpen}
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </button>

      {isOpen && count > 0 && (
        <div className="absolute right-0 top-full z-[90] mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 text-left text-slate-800 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black">Pending cloud writes</p>
              <p className="text-[10px] text-slate-500">Kept locally and retried automatically.</p>
            </div>
            {isStuck && (
              <button
                type="button"
                onClick={() => void retryNow()}
                disabled={isRetrying}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
              >
                {isRetrying ? 'Retrying…' : 'Retry now'}
              </button>
            )}
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setExpandedId(id => id === item.id ? null : item.id)}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-left"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] font-bold">
                    {item.kind}: {item.keyLabel}
                  </span>
                  <span className="shrink-0 text-[9px] text-slate-500">
                    {item.attempts} attempt{item.attempts === 1 ? '' : 's'} · {formatAge(item.ageMs)}
                  </span>
                </span>
                {item.lastError && (
                  <span className="mt-1 block truncate text-[10px] text-red-600">{item.lastError}</span>
                )}
                {expandedId === item.id && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[9px] text-slate-100">
                    {JSON.stringify(item.identifiers, null, 2)}
                  </pre>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncHealthBadge;
