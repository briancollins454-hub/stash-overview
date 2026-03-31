import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { loadArtworkApprovals, addArtworkApproval, updateArtworkApproval, deleteArtworkApproval, ArtworkApproval, ARTWORK_STATUS_LABELS } from '../services/artworkService';
import { Palette, Plus, X, Trash2, Check, Send, RotateCcw, Eye, Package } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
  userEmail: string;
}

const ArtworkApprovalTracker: React.FC<Props> = ({ orders, onNavigateToOrder, userEmail }) => {
  const [approvals, setApprovals] = useState<ArtworkApproval[]>(() => loadArtworkApprovals());
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ArtworkApproval['status'] | 'all'>('all');

  // Form state
  const [formOrderNum, setFormOrderNum] = useState('');
  const [formItem, setFormItem] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const matchedOrder = useMemo(() => {
    const num = formOrderNum.replace('#', '');
    return orders.find(o => o.shopify.orderNumber === num);
  }, [orders, formOrderNum]);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return approvals;
    return approvals.filter(a => a.status === filterStatus);
  }, [approvals, filterStatus]);

  const stats = useMemo(() => ({
    total: approvals.length,
    pending: approvals.filter(a => a.status === 'pending').length,
    sent: approvals.filter(a => a.status === 'sent').length,
    revisions: approvals.filter(a => a.status === 'revision_needed').length,
    blocking: approvals.filter(a => !['approved', 'final_approved'].includes(a.status)).length,
  }), [approvals]);

  const handleAdd = () => {
    if (!matchedOrder) return;
    const updated = addArtworkApproval({
      orderId: matchedOrder.shopify.id,
      orderNumber: matchedOrder.shopify.orderNumber,
      customerName: matchedOrder.shopify.customerName,
      customerEmail: matchedOrder.shopify.email,
      itemName: formItem,
      status: 'pending',
      notes: formNotes || undefined,
      createdBy: userEmail,
    });
    setApprovals(updated);
    setShowForm(false);
    setFormOrderNum(''); setFormItem(''); setFormNotes('');
  };

  const handleStatusChange = (id: string, status: ArtworkApproval['status']) => {
    const updates: Partial<ArtworkApproval> = { status };
    if (status === 'sent') updates.sentAt = Date.now();
    if (status === 'approved' || status === 'final_approved') updates.respondedAt = Date.now();
    if (status === 'revision_needed') {
      const current = approvals.find(a => a.id === id);
      updates.revisionCount = (current?.revisionCount || 0) + 1;
    }
    setApprovals(updateArtworkApproval(id, updates));
  };

  const handleDelete = (id: string) => {
    setApprovals(deleteArtworkApproval(id));
  };

  const statusColor = (status: ArtworkApproval['status']) => {
    const colors: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700',
      sent: 'bg-blue-100 text-blue-700',
      approved: 'bg-emerald-100 text-emerald-700',
      revision_needed: 'bg-amber-100 text-amber-700',
      final_approved: 'bg-emerald-200 text-emerald-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const statusIcon = (status: ArtworkApproval['status']) => {
    if (status === 'pending') return '⏳';
    if (status === 'sent') return '📧';
    if (status === 'approved' || status === 'final_approved') return '✅';
    if (status === 'revision_needed') return '🔄';
    return '';
  };

  const waitingDays = (a: ArtworkApproval) => {
    if (['approved', 'final_approved'].includes(a.status)) return null;
    const since = a.sentAt || a.createdAt;
    return Math.floor((Date.now() - since) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-pink-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Artwork Approvals</h3>
          {stats.blocking > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black">{stats.blocking} blocking</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="all">All ({approvals.length})</option>
            {Object.entries(ARTWORK_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v} ({approvals.filter(a => a.status === k).length})</option>
            ))}
          </select>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-pink-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-pink-600 transition-colors flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add Approval
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 border-b border-gray-50 flex items-center gap-4">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">⏳ Pending: {stats.pending}</span>
        <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">📧 Sent: {stats.sent}</span>
        <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">🔄 Revisions: {stats.revisions}</span>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-pink-50/50">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Order #</label>
              <input value={formOrderNum} onChange={e => setFormOrderNum(e.target.value)} placeholder="e.g. 1234" className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-pink-500 outline-none" />
              {formOrderNum && !matchedOrder && <p className="text-[8px] text-red-500 mt-0.5">Order not found</p>}
              {matchedOrder && <p className="text-[8px] text-emerald-500 mt-0.5">{matchedOrder.shopify.customerName}</p>}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Item / Design</label>
              {matchedOrder ? (
                <select value={formItem} onChange={e => setFormItem(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-pink-500 outline-none">
                  <option value="">Select item...</option>
                  {matchedOrder.shopify.items.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
                  <option value="Full Order">Full Order Design</option>
                </select>
              ) : (
                <input value={formItem} onChange={e => setFormItem(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-pink-500 outline-none" />
              )}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Notes</label>
              <input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Design details..." className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-pink-500 outline-none" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleAdd} disabled={!matchedOrder || !formItem} className="px-4 py-1.5 bg-pink-500 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-pink-600 disabled:opacity-50 transition-colors">Save</button>
              <button onClick={() => setShowForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            <p className="text-xs font-bold uppercase tracking-widest">No artwork approvals pending</p>
          </div>
        ) : filtered.map(a => {
          const days = waitingDays(a);
          return (
            <div key={a.id} className={`px-4 py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors ${days !== null && days >= 5 ? 'bg-amber-50/30' : ''}`}>
              <div className="text-lg">{statusIcon(a.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => onNavigateToOrder?.(a.orderNumber)} className="text-xs font-black text-gray-800 hover:text-indigo-600 transition-colors">
                    #{a.orderNumber}
                  </button>
                  <span className="text-[10px] font-bold text-gray-500">{a.customerName}</span>
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${statusColor(a.status)}`}>{ARTWORK_STATUS_LABELS[a.status]}</span>
                  {a.revisionCount > 0 && <span className="text-[9px] font-bold text-amber-600">Rev {a.revisionCount}</span>}
                  {days !== null && days >= 3 && <span className="text-[9px] font-black text-red-500">Waiting {days}d</span>}
                </div>
                <p className="text-[10px] font-bold text-gray-600 mt-0.5">{a.itemName}</p>
                {a.notes && <p className="text-[9px] italic text-gray-400 mt-0.5">{a.notes}</p>}
                <p className="text-[8px] text-gray-400 mt-0.5">
                  Created {new Date(a.createdAt).toLocaleDateString('en-GB')}
                  {a.sentAt && ` • Sent ${new Date(a.sentAt).toLocaleDateString('en-GB')}`}
                  {a.respondedAt && ` • Responded ${new Date(a.respondedAt).toLocaleDateString('en-GB')}`}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <select value={a.status} onChange={e => handleStatusChange(a.id, e.target.value as ArtworkApproval['status'])} className="text-[9px] font-bold border border-gray-200 rounded px-1 py-0.5 focus:ring-1 focus:ring-pink-500 outline-none">
                  {Object.entries(ARTWORK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button onClick={() => handleDelete(a.id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors" title="Delete"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ArtworkApprovalTracker;
