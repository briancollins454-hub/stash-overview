import React from 'react';
import { Loader2 } from 'lucide-react';
import type { StockTakeLocation, StockTakeSession } from '../../services/stockTakeService';

const LOCATION_LABELS: Record<StockTakeLocation, string> = {
  church_st: '20 Church Street',
  local_stock: 'Local stock',
  all: 'All locations (book)',
};

interface Props {
  loading: boolean;
  openSessions: StockTakeSession[];
  committedSessions: StockTakeSession[];
  newLabel: string;
  newLocation: StockTakeLocation;
  onChangeLabel: (value: string) => void;
  onChangeLocation: (value: StockTakeLocation) => void;
  onStart: () => void;
  onResume: (id: string) => void;
  hasLocalDraft: boolean;
  onRestoreLocalDraft?: () => void;
  onDiscardLocalDraft?: () => void;
}

function formatSessionWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SessionListPanel: React.FC<Props> = ({
  loading,
  openSessions,
  committedSessions,
  newLabel,
  newLocation,
  onChangeLabel,
  onChangeLocation,
  onStart,
  onResume,
  hasLocalDraft,
  onRestoreLocalDraft,
  onDiscardLocalDraft,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
    {hasLocalDraft && (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-bold text-indigo-900">
          We found scans from a previous session on this device that were not committed.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRestoreLocalDraft}
            className="min-h-[40px] px-3 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={onDiscardLocalDraft}
            className="min-h-[40px] px-3 rounded-lg border border-indigo-200 text-indigo-700 text-[10px] font-black uppercase tracking-widest"
          >
            Discard
          </button>
        </div>
      </div>
    )}

    <div>
      <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">Start new count</h2>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={newLabel}
          onChange={e => onChangeLabel(e.target.value)}
          placeholder="Session name (optional)"
          className="flex-1 min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold"
        />
        <select
          value={newLocation}
          onChange={e => onChangeLocation(e.target.value as StockTakeLocation)}
          className="min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-[10px] font-black uppercase tracking-widest"
        >
          {Object.entries(LOCATION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onStart}
          className="min-h-[44px] px-5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
        >
          Start
        </button>
      </div>
    </div>

    {loading ? (
      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
    ) : (
      <div className="space-y-6">
        {openSessions.length > 0 && (
          <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Resume open session</h2>
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
              {openSessions.map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onResume(s.id)}
                    className="w-full text-left min-h-[56px] px-4 py-3 hover:bg-indigo-50/50 flex flex-wrap justify-between items-center gap-2"
                  >
                    <span className="font-bold text-gray-900 text-sm">{s.label}</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {LOCATION_LABELS[s.location as StockTakeLocation] || s.location}
                      {' · '}{formatSessionWhen(s.created_at)}
                      {s.reopened_count ? ` · re-opened ${s.reopened_count}×` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {committedSessions.length > 0 && (
          <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">
              Committed counts
            </h2>
            <p className="text-[11px] text-gray-500 mb-2">
              Reopen a finished count to view lines, print the PDF report, or re-open for adjustment.
            </p>
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
              {committedSessions.map(s => {
                const varianceClass = (s.net_variance ?? 0) > 0
                  ? 'text-amber-700'
                  : (s.net_variance ?? 0) < 0
                    ? 'text-red-600'
                    : 'text-emerald-700';
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onResume(s.id)}
                      className="w-full text-left min-h-[64px] px-4 py-3 hover:bg-emerald-50/50 flex flex-col gap-1.5"
                    >
                      <span className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 text-sm">{s.label}</span>
                        <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest shrink-0">
                          {formatSessionWhen(s.committed_at || s.created_at)}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        <span>{LOCATION_LABELS[s.location as StockTakeLocation] || s.location}</span>
                        {s.total_skus != null && <span>{s.total_skus} SKUs</span>}
                        {s.total_units != null && <span>{s.total_units} units</span>}
                        {s.net_variance != null && (
                          <span className={varianceClass}>
                            net {s.net_variance > 0 ? `+${s.net_variance}` : s.net_variance}
                          </span>
                        )}
                        {(s.committed_by || s.created_by) && (
                          <span className="normal-case tracking-normal text-gray-400">by {s.committed_by || s.created_by}</span>
                        )}
                        {s.reopened_count ? <span className="text-indigo-600">re-opened {s.reopened_count}×</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    )}
  </div>
);

export default SessionListPanel;
