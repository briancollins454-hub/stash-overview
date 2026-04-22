import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Palette, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';

/* ================================================================
   SLACK FEEDS — live #print-updates + #embroidery-updates panels
   ================================================================
   - Two side-by-side panels at the top of the Production tab.
   - Messages come from Supabase table `stash_slack_messages`, which is
     populated by /api/slack-events (real-time webhook) and seeded by
     /api/slack-backfill (last 3 days on first load).
   - Polls Supabase every 15s so users see new chatter without a refresh.
   - Anyone logged in can view. No write access.
   ================================================================ */

interface SlackMessage {
  id: string;
  channel_id: string;
  channel_name: 'print-updates' | 'embroidery-updates' | string;
  user_id: string | null;
  user_name: string | null;
  user_avatar: string | null;
  text: string;
  ts: string;
  ts_epoch: number;
  subtype: string | null;
  edited: boolean;
  thread_ts: string | null;
}

type ChannelKey = 'print-updates' | 'embroidery-updates';

const POLL_INTERVAL_MS = 15_000;
const BACKFILL_DAYS = 3;
const MAX_MESSAGES_PER_FEED = 200;

/* ----------------------------------------------------------------
   Slack text → HTML
   Slack sends <@USER>, <#CHAN|name>, <https://url|label>, and *bold* /
   _italic_ / `code` / ```block```. We render a conservative subset so
   staff see readable messages without XSS risk.
   ---------------------------------------------------------------- */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function renderSlackText(text: string): string {
  if (!text) return '';
  let out = escapeHtml(text);

  // <https://foo|label> → <a>label</a>
  out = out.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g, (_m, url, label) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:underline">${label}</a>`);
  // Bare <https://foo> links
  out = out.replace(/&lt;(https?:\/\/[^|&]+)&gt;/g, (_m, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:underline">${url}</a>`);
  // <@USERID> — we don't have a user map on the client, so show @mention
  out = out.replace(/&lt;@([UW][A-Z0-9]+)&gt;/g, (_m) => `<span class="text-sky-400 font-medium">@mention</span>`);
  // <#CHANID|name> → #name
  out = out.replace(/&lt;#[CG][A-Z0-9]+\|([^&]+)&gt;/g, (_m, name) =>
    `<span class="text-sky-400 font-medium">#${name}</span>`);

  // Code block ``` ``` — handle before inline code/bold/italic
  out = out.replace(/```([\s\S]+?)```/g, (_m, code) =>
    `<pre class="bg-slate-900/80 border border-slate-700 rounded p-2 text-xs font-mono text-slate-200 overflow-x-auto my-1">${code}</pre>`);
  // Inline code
  out = out.replace(/`([^`]+?)`/g, (_m, code) =>
    `<code class="bg-slate-900/60 border border-slate-700 rounded px-1 text-xs font-mono text-slate-200">${code}</code>`);
  // *bold*
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*/g, (_m, pre, inner) => `${pre}<strong class="font-semibold text-slate-100">${inner}</strong>`);
  // _italic_
  out = out.replace(/(^|[^_])_([^_\n]+?)_/g, (_m, pre, inner) => `${pre}<em class="italic">${inner}</em>`);

  // Preserve newlines inside the paragraph.
  out = out.replace(/\n/g, '<br/>');

  return out;
}

function formatRelative(tsEpoch: number): string {
  if (!Number.isFinite(tsEpoch) || tsEpoch <= 0) return '';
  const delta = Date.now() / 1000 - tsEpoch;
  if (delta < 30) return 'just now';
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
  const d = new Date(tsEpoch * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatAbsolute(tsEpoch: number): string {
  if (!Number.isFinite(tsEpoch) || tsEpoch <= 0) return '';
  const d = new Date(tsEpoch * 1000);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ----------------------------------------------------------------
   Supabase queries
   We read newest-first from `stash_slack_messages` scoped to each channel.
   ---------------------------------------------------------------- */
async function fetchMessages(channel: ChannelKey): Promise<SlackMessage[]> {
  const oldest = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;
  const params = new URLSearchParams({
    select: '*',
    channel_name: `eq.${channel}`,
    ts_epoch: `gte.${oldest}`,
    order: 'ts_epoch.desc',
    limit: String(MAX_MESSAGES_PER_FEED),
  });
  const res = await supabaseFetch(`stash_slack_messages?${params}`, 'GET');
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function triggerBackfill(): Promise<void> {
  // Fire-and-forget from the client's perspective — we'll re-query Supabase
  // a second or two later. No auth needed: the endpoint is idempotent and
  // only the server holds the bot token.
  await fetch(`/api/slack-backfill?days=${BACKFILL_DAYS}`, { method: 'GET' });
}

/* ----------------------------------------------------------------
   Feed column
   ---------------------------------------------------------------- */
interface FeedColumnProps {
  title: string;
  channel: ChannelKey;
  accent: 'indigo' | 'pink';
  icon: React.ReactNode;
  messages: SlackMessage[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const ACCENT_STYLES: Record<'indigo' | 'pink', { headerBg: string; headerText: string; dot: string }> = {
  indigo: {
    headerBg: 'bg-indigo-900/40 border-indigo-700/60',
    headerText: 'text-indigo-200',
    dot: 'bg-indigo-400',
  },
  pink: {
    headerBg: 'bg-pink-900/40 border-pink-700/60',
    headerText: 'text-pink-200',
    dot: 'bg-pink-400',
  },
};

function FeedColumn({ title, channel, accent, icon, messages, isLoading, error, lastUpdated }: FeedColumnProps) {
  const style = ACCENT_STYLES[accent];

  // Non-user messages (bot_message, channel_join, etc.) are mostly noise.
  // Hide the really chatty ones but keep bot_message (covers integrations
  // like Shopify / our own notifier posting into the channel).
  const visible = useMemo(() => messages.filter(m => {
    if (!m.subtype) return true;
    return m.subtype === 'bot_message' || m.subtype === 'thread_broadcast' || m.subtype === 'me_message';
  }), [messages]);

  return (
    <div className="flex-1 flex flex-col bg-slate-800/60 border border-slate-700 rounded-lg overflow-hidden min-h-[360px] max-h-[520px]">
      <div className={`px-4 py-2.5 border-b ${style.headerBg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={`relative flex h-2 w-2`}>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dot} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dot}`}></span>
          </span>
          {icon}
          <span className={`text-sm font-semibold ${style.headerText}`}>{title}</span>
          <span className="text-xs text-slate-400">#{channel}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          {isLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
          <span>{lastUpdated ? formatRelative(lastUpdated / 1000) : '—'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700/60 rounded p-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">Couldn't load messages</div>
              <div className="text-xs text-red-200/80 mt-0.5">{error}</div>
            </div>
          </div>
        )}
        {!error && visible.length === 0 && !isLoading && (
          <div className="text-center text-sm text-slate-500 py-8">
            No messages in the last {BACKFILL_DAYS} days.
            <div className="text-xs mt-1">Waiting for activity…</div>
          </div>
        )}
        {visible.map(m => (
          <article key={m.id} className="flex gap-2.5 group">
            <div className="flex-shrink-0">
              {m.user_avatar ? (
                // Slack avatars are CDN-served, no auth needed.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.user_avatar} alt={m.user_name || 'user'} className="w-8 h-8 rounded" />
              ) : (
                <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                  {(m.user_name || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-slate-100 truncate">
                  {m.user_name || 'Unknown'}
                </span>
                <span className="text-xs text-slate-500 flex-shrink-0" title={formatAbsolute(m.ts_epoch)}>
                  {formatRelative(m.ts_epoch)}
                </span>
                {m.edited && <span className="text-[10px] text-slate-500">(edited)</span>}
              </div>
              <div
                className="text-sm text-slate-200 mt-0.5 break-words leading-snug"
                dangerouslySetInnerHTML={{ __html: renderSlackText(m.text) }}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Main component
   ---------------------------------------------------------------- */
export default function SlackFeeds() {
  const [printMessages, setPrintMessages] = useState<SlackMessage[]>([]);
  const [embMessages, setEmbMessages] = useState<SlackMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [hasBackfilled, setHasBackfilled] = useState(false);
  const backfillInFlight = useRef(false);

  const loadBoth = useCallback(async (): Promise<{ printCount: number; embCount: number }> => {
    const [pr, em] = await Promise.all([
      fetchMessages('print-updates'),
      fetchMessages('embroidery-updates'),
    ]);
    setPrintMessages(pr);
    setEmbMessages(em);
    setLastUpdated(Date.now());
    return { printCount: pr.length, embCount: em.length };
  }, []);

  const refresh = useCallback(async () => {
    if (!isSupabaseReady()) {
      setError('Supabase not configured — enter Supabase URL & anon key in Settings.');
      setIsLoading(false);
      return;
    }
    setError(null);
    try {
      const counts = await loadBoth();

      // If we just came up empty on first load, trigger a backfill once so
      // staff aren't staring at a blank panel. Subsequent polls won't retry.
      if (!hasBackfilled && counts.printCount === 0 && counts.embCount === 0 && !backfillInFlight.current) {
        backfillInFlight.current = true;
        setHasBackfilled(true);
        try {
          await triggerBackfill();
          // Give Supabase a beat to commit before we re-query.
          await new Promise(r => setTimeout(r, 1500));
          await loadBoth();
        } finally {
          backfillInFlight.current = false;
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load Slack messages');
    } finally {
      setIsLoading(false);
    }
  }, [hasBackfilled, loadBoth]);

  // Manual "Sync last 3 days" — also available to admins in case Slack
  // events aren't wired up yet.
  const runBackfill = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await triggerBackfill();
      await new Promise(r => setTimeout(r, 1500));
      await loadBoth();
    } catch (e: any) {
      setError(e?.message || 'Backfill failed');
    } finally {
      setIsLoading(false);
    }
  }, [loadBoth]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
    // refresh's own dependencies cover hasBackfilled; don't re-arm the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="space-y-2" aria-label="Slack production feeds">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Live from Slack
        </h2>
        <button
          onClick={runBackfill}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-slate-800 transition-colors"
          title={`Re-sync the last ${BACKFILL_DAYS} days from Slack`}
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Sync {BACKFILL_DAYS}d
        </button>
      </div>
      <div className="flex flex-col lg:flex-row gap-3">
        <FeedColumn
          title="Print Updates"
          channel="print-updates"
          accent="indigo"
          icon={<Printer className="w-4 h-4 text-indigo-300" />}
          messages={printMessages}
          isLoading={isLoading}
          error={error}
          lastUpdated={lastUpdated}
        />
        <FeedColumn
          title="Embroidery Updates"
          channel="embroidery-updates"
          accent="pink"
          icon={<Palette className="w-4 h-4 text-pink-300" />}
          messages={embMessages}
          isLoading={isLoading}
          error={error}
          lastUpdated={lastUpdated}
        />
      </div>
    </section>
  );
}
