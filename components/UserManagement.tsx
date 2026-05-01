import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Edit3, Trash2, Shield, ShieldCheck, Eye, Crown, Loader2, X, Check, RefreshCw, UserPlus, AlertTriangle, Lock, ToggleLeft, ToggleRight } from 'lucide-react';
import { APP_TAB_DEFINITIONS, APP_TAB_IDS, getDefaultTabsForRole } from '../constants/tabPermissions';
import SeniorManagementAccess from './SeniorManagementAccess';

export interface AppUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  role: string;
  displayName: string;
  allowedTabs: string[];
}

interface StashUser {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
  allowed_tabs: string[];
}

interface Props {
  currentUser: AppUser;
  token?: string;
  firebaseIdToken?: string;
}

const ROLES = [
  { value: 'superuser', label: 'Super User', icon: Crown, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  { value: 'admin', label: 'Admin', icon: ShieldCheck, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' },
  { value: 'manager', label: 'Manager', icon: Shield, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  { value: 'viewer', label: 'Viewer', icon: Eye, color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' },
];

/** Tab labels + ids — single source: `constants/tabPermissions.ts` (sync with App.tsx `validTabs`). */
const ALL_TABS = APP_TAB_DEFINITIONS;

function sanitizeAllowedTabs(tabs: string[] | undefined): string[] {
  if (!tabs?.length) return [];
  const allowed = new Set(APP_TAB_IDS);
  return tabs.filter(id => allowed.has(id));
}

function getRoleMeta(role: string) {
  return ROLES.find(r => r.value === role) || ROLES[3];
}

async function usersApi(body: Record<string, any>) {
  const resp = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const UserManagement: React.FC<Props> = ({ currentUser, token, firebaseIdToken }) => {
  const [users, setUsers] = useState<StashUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUser, setEditingUser] = useState<StashUser | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [allowedTabs, setAllowedTabs] = useState<string[]>(() => getDefaultTabsForRole('viewer'));

  // Build auth params to pass to every API call
  const authParams = token ? { token } : firebaseIdToken ? { firebaseIdToken } : {};

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await usersApi({ action: 'list', ...authParams });
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, firebaseIdToken]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setUsername('');
    setPassword('');
    setRole('viewer');
    setAllowedTabs(getDefaultTabsForRole('viewer'));
    setShowAddForm(false);
    setEditingUser(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await usersApi({ action: 'create', ...authParams, firstName, lastName, username, password, role, allowedTabs });
      resetForm();
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    setError(null);
    try {
      const updates: Record<string, any> = {
        action: 'update',
        ...authParams,
        userId: editingUser.id,
        firstName,
        lastName,
        role,
        allowedTabs,
      };
      if (password) updates.password = password;
      await usersApi(updates);
      resetForm();
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Deactivate this user? They will no longer be able to log in.')) return;
    setError(null);
    try {
      await usersApi({ action: 'delete', ...authParams, userId });
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleReactivate = async (userId: string) => {
    setError(null);
    try {
      await usersApi({ action: 'update', ...authParams, userId, isActive: true });
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEdit = (user: StashUser) => {
    setEditingUser(user);
    setFirstName(user.first_name);
    setLastName(user.last_name);
    setUsername(user.username);
    setPassword('');
    setRole(user.role);
    const cleaned = sanitizeAllowedTabs(user.allowed_tabs);
    setAllowedTabs(cleaned.length ? cleaned : getDefaultTabsForRole(user.role));
    setShowAddForm(false);
  };

  const activeUsers = users.filter(u => u.is_active);
  const inactiveUsers = users.filter(u => !u.is_active);
  const canManage = currentUser.role === 'superuser' || currentUser.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-400" />
            User Management
          </h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
            {activeUsers.length} active user{activeUsers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadUsers} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 flex items-center gap-1.5 transition-all">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          {canManage && (
            <button
              onClick={() => { resetForm(); setShowAddForm(true); }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 flex items-center gap-1.5 transition-all shadow-lg"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add User
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Add / Edit Form */}
      {(showAddForm || editingUser) && canManage && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
            {editingUser ? <Edit3 className="w-4 h-4 text-amber-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
            {editingUser ? 'Edit User' : 'Add New User'}
          </h3>
          <form onSubmit={editingUser ? handleUpdate : handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="Smith"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                disabled={!!editingUser}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50"
                placeholder="jsmith"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                Password {editingUser && <span className="text-slate-500">(leave blank to keep current)</span>}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required={!editingUser}
                minLength={6}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white text-xs font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder={editingUser ? '••••••••' : 'Min 6 characters'}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map(r => {
                  // Only superusers can assign superuser role
                  const disabled = r.value === 'superuser' && currentUser.role !== 'superuser';
                  return (
                    <button
                      key={r.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => { setRole(r.value); setAllowedTabs(getDefaultTabsForRole(r.value)); }}
                      className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all flex items-center gap-1.5 ${
                        role === r.value
                          ? `${r.bg} ${r.color} border-current`
                          : 'bg-slate-900 text-slate-500 border-slate-700 hover:border-slate-500'
                      } ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <r.icon className="w-3 h-3" /> {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Tab Permissions — superusers only */}
            {currentUser.role === 'superuser' && (
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Tab Access</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
                  {ALL_TABS.map(tab => {
                    const enabled = allowedTabs.includes(tab.id);
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setAllowedTabs(prev => enabled ? prev.filter(t => t !== tab.id) : [...prev, tab.id])}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border transition-all ${
                          enabled
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-slate-900 text-slate-600 border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        {enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => setAllowedTabs([...APP_TAB_IDS])} className="text-[8px] font-bold uppercase tracking-widest text-indigo-400 hover:text-indigo-300">Select All</button>
                  <button type="button" onClick={() => setAllowedTabs([])} className="text-[8px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-400">Clear All</button>
                  <button type="button" onClick={() => setAllowedTabs(getDefaultTabsForRole(role))} className="text-[8px] font-bold uppercase tracking-widest text-amber-400 hover:text-amber-300">Reset to Default</button>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-lg"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {editingUser ? 'Save Changes' : 'Create User'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2.5 bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-600 transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {activeUsers.map(u => {
            const roleMeta = getRoleMeta(u.role);
            const isSelf = u.id === currentUser.id;
            return (
              <div key={u.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-center gap-4 hover:border-slate-600 transition-all">
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black ${
                  u.role === 'superuser' ? 'bg-amber-500/20 text-amber-400' :
                  u.role === 'admin' ? 'bg-indigo-500/20 text-indigo-400' :
                  u.role === 'manager' ? 'bg-emerald-500/20 text-emerald-400' :
                  'bg-slate-600/30 text-slate-400'
                }`}>
                  {u.first_name[0]}{u.last_name[0]}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{u.first_name} {u.last_name}</span>
                    {isSelf && <span className="text-[8px] font-black text-indigo-400 uppercase bg-indigo-500/10 px-1.5 py-0.5 rounded">You</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-slate-400 font-bold">@{u.username}</span>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${roleMeta.bg} ${roleMeta.color}`}>
                      {roleMeta.label}
                    </span>
                    <span className="text-[8px] font-bold text-slate-500">{(u.allowed_tabs || []).length}/{ALL_TABS.length} tabs</span>
                  </div>
                </div>

                {/* Actions */}
                {canManage && !isSelf && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => startEdit(u)}
                      className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-all"
                      title="Edit user"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(u.id)}
                      className="p-2 rounded-lg bg-slate-700 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all"
                      title="Deactivate user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Inactive users section */}
          {inactiveUsers.length > 0 && (
            <div className="mt-6">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Deactivated Users</h3>
              {inactiveUsers.map(u => (
                <div key={u.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center gap-4 opacity-50 mb-2">
                  <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-sm font-black text-slate-600">
                    {u.first_name[0]}{u.last_name[0]}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-bold text-slate-500">{u.first_name} {u.last_name}</span>
                    <span className="text-[10px] text-slate-600 font-bold ml-2">@{u.username}</span>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => handleReactivate(u.id)}
                      className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-all"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeUsers.length === 0 && !loading && (
            <div className="text-center py-20">
              <Lock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">No users found</p>
            </div>
          )}
        </div>
      )}

      {/* Google sign-in allow-list (senior management). Superuser-only.
          The existing username/password table above is left untouched so
          it continues to work as a fallback if anyone loses Google access. */}
      {currentUser.role === 'superuser' && (
        <SeniorManagementAccess
          token={token}
          firebaseIdToken={firebaseIdToken}
          isSuperuser={currentUser.role === 'superuser'}
        />
      )}
    </div>
  );
};

export default UserManagement;
