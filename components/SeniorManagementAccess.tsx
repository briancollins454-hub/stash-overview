/**
 * Senior Management Access — allow-list manager (Phase 1)
 * --------------------------------------------------------
 * Superuser-only admin UI for the `stash_authorized_users` Firestore
 * collection. Every row here is a person who is permitted to sign in
 * with Google and access the app.
 *
 * Phone numbers are captured now but are not yet used to authenticate.
 * They will be used in Phase 2 (SMS OTP verification).
 *
 * The owner email (configured server-side) is always implicitly
 * authorised even if this list is empty, so access cannot accidentally
 * be revoked from everyone.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Crown, Loader2, Plus, Trash2, Edit3, Check, X, RefreshCw, AlertTriangle, Phone, Mail, ShieldCheck } from 'lucide-react';

interface AuthorizedUser {
  email: string;
  phone: string;
  displayName: string;
  addedBy: string;
  addedAt: string;
  notes: string;
  isActive: boolean;
}

interface Props {
  token?: string;
  firebaseIdToken?: string;
  /** Only superusers should ever see this component, but we also gate
   *  server-side so a leaked client bundle can't bypass anything. */
  isSuperuser: boolean;
}

async function allowListApi(body: Record<string, any>) {
  const resp = await fetch('/api/authorized-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const SeniorManagementAccess: React.FC<Props> = ({ token, firebaseIdToken, isSuperuser }) => {
  const [rows, setRows] = useState<AuthorizedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AuthorizedUser | null>(null);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const authParams = token ? { token } : firebaseIdToken ? { firebaseIdToken } : {};

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await allowListApi({ action: 'list', ...authParams });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, firebaseIdToken]);

  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setEmail(''); setDisplayName(''); setPhone(''); setNotes('');
    setEditing(null); setShowForm(false);
  };

  const startEdit = (row: AuthorizedUser) => {
    setEditing(row);
    setEmail(row.email);
    setDisplayName(row.displayName);
    setPhone(row.phone);
    setNotes(row.notes);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      if (editing) {
        await allowListApi({ action: 'update', ...authParams, email: editing.email, displayName, phone, notes });
      } else {
        await allowListApi({ action: 'add', ...authParams, email, displayName, phone, notes });
      }
      reset();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (row: AuthorizedUser) => {
    if (!confirm(`Remove ${row.displayName} (${row.email}) from the allow-list? They will no longer be able to sign in with Google.`)) return;
    setError(null);
    try {
      await allowListApi({ action: 'remove', ...authParams, email: row.email });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggleActive = async (row: AuthorizedUser) => {
    setError(null);
    try {
      await allowListApi({ action: 'update', ...authParams, email: row.email, isActive: !row.isActive });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!isSuperuser) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
        Only superusers can manage senior-management access.
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
            <Crown className="w-6 h-6 text-amber-400" />
            Senior Management Access
          </h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
            Google sign-in allow-list &mdash; {rows.length} authorised {rows.length === 1 ? 'account' : 'accounts'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 flex items-center gap-1.5 transition-all">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button
            onClick={() => { reset(); setShowForm(true); }}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-500 flex items-center gap-1.5 transition-all shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Phase-1 info banner */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-[10px] text-amber-200 font-bold flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <div className="uppercase tracking-widest text-amber-400 font-black">Phase 1 &mdash; Email allow-list</div>
          <div className="mt-0.5 normal-case tracking-normal font-normal text-amber-100/80">
            Only the Google accounts listed here (plus the system owner) can sign in. Phone numbers are captured
            now and will be used for SMS verification in Phase 2.
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {showForm && (
        <div className="bg-slate-800/60 border border-amber-500/20 rounded-2xl p-6">
          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
            {editing ? <Edit3 className="w-4 h-4 text-amber-400" /> : <Plus className="w-4 h-4 text-amber-400" />}
            {editing ? `Edit ${editing.email}` : 'Add Authorised Account'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Google Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={!!editing}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none disabled:opacity-50"
                placeholder="name@example.com"
              />
              <div className="text-[9px] text-slate-500 mt-1">Any Google account — the allow-list itself controls access.</div>
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                Phone <span className="text-slate-500 normal-case">(E.164, for Phase 2 SMS)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                placeholder="+447123456789"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                placeholder="Finance Director"
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-500 transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-lg"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {editing ? 'Save Changes' : 'Add to Allow-list'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2.5 bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-600 transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-amber-500 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 bg-slate-800/30 border border-slate-700 rounded-xl">
          <Crown className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">No authorised accounts yet</p>
          <p className="text-[9px] text-slate-600 mt-1">Only the system owner can sign in until you add one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <div
              key={row.email}
              className={`border rounded-xl p-4 flex items-center gap-4 transition-all ${
                row.isActive
                  ? 'bg-slate-800/50 border-slate-700 hover:border-amber-500/40'
                  : 'bg-slate-900/40 border-slate-800 opacity-60'
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-black">
                {(row.displayName || row.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-black text-white">{row.displayName}</span>
                  {!row.isActive && <span className="text-[8px] font-black text-red-400 uppercase bg-red-500/10 px-1.5 py-0.5 rounded">Disabled</span>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap text-[10px] font-bold">
                  <span className="text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {row.email}</span>
                  {row.phone && <span className="text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {row.phone}</span>}
                  {row.notes && <span className="text-slate-600 italic normal-case">&ldquo;{row.notes}&rdquo;</span>}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleToggleActive(row)}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                    row.isActive
                      ? 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                  }`}
                  title={row.isActive ? 'Disable sign-in' : 'Re-enable sign-in'}
                >
                  {row.isActive ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => startEdit(row)}
                  className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-all"
                  title="Edit"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleRemove(row)}
                  className="p-2 rounded-lg bg-slate-700 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all"
                  title="Remove from allow-list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SeniorManagementAccess;
