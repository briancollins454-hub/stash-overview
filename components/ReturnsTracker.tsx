import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { loadReturns, addReturn, updateReturn, deleteReturn, ReturnRecord, REASON_LABELS, STATUS_LABELS } from '../services/returnsService';
import { RotateCcw, Plus, X, ChevronDown, ChevronRight, Trash2, Edit3, ExternalLink, Check, Package } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
  userEmail: string;
}

const ReturnsTracker: React.FC<Props> = ({ orders, onNavigateToOrder, userEmail }) => {
  const [returns, setReturns] = useState<ReturnRecord[]>(() => loadReturns());
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ReturnRecord['status'] | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formOrderNum, setFormOrderNum] = useState('');
  const [formItem, setFormItem] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formSize, setFormSize] = useState('');
  const [formQty, setFormQty] = useState(1);
  const [formReason, setFormReason] = useState<ReturnRecord['reason']>('print_defect');
  const [formDetail, setFormDetail] = useState('');

  // Look up order for the form
  const matchedOrder = useMemo(() => {
    const num = formOrderNum.replace('#', '');
    return orders.find(o => o.shopify.orderNumber === num);
  }, [orders, formOrderNum]);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return returns;
    return returns.filter(r => r.status === filterStatus);
  }, [returns, filterStatus]);

  const stats = useMemo(() => ({
    total: returns.length,
    open: returns.filter(r => r.status !== 'resolved').length,
    defects: returns.filter(r => r.reason === 'print_defect').length,
    wrongSize: returns.filter(r => r.reason === 'wrong_size').length,
  }), [returns]);

  const handleAdd = () => {
    if (!matchedOrder) return;
    const updated = addReturn({
      originalOrderNumber: matchedOrder.shopify.orderNumber,
      originalOrderId: matchedOrder.shopify.id,
      customerName: matchedOrder.shopify.customerName,
      itemName: formItem,
      sku: formSku,
      size: formSize,
      quantity: formQty,
      reason: formReason,
      reasonDetail: formDetail || undefined,
      status: 'received',
      createdBy: userEmail,
    });
    setReturns(updated);
    setShowForm(false);
    setFormOrderNum(''); setFormItem(''); setFormSku(''); setFormSize('');
    setFormQty(1); setFormDetail('');
  };

  const handleStatusChange = (id: string, status: ReturnRecord['status']) => {
    setReturns(updateReturn(id, { status }));
  };

  const handleRemakeJobId = (id: string, jobId: string) => {
    setReturns(updateReturn(id, { remakeJobId: jobId }));
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    setReturns(deleteReturn(id));
  };

  const statusColor = (status: ReturnRecord['status']) => {
    const colors: Record<string, string> = {
      received: 'bg-red-100 text-red-700',
      inspected: 'bg-amber-100 text-amber-700',
      remake_ordered: 'bg-blue-100 text-blue-700',
      remake_shipped: 'bg-purple-100 text-purple-700',
      resolved: 'bg-emerald-100 text-emerald-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const reasonColor = (reason: ReturnRecord['reason']) => {
    if (reason === 'print_defect') return 'text-red-600';
    if (reason === 'wrong_item' || reason === 'wrong_size') return 'text-amber-600';
    return 'text-gray-600';
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-orange-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Returns & Remakes</h3>
          {stats.open > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[9px] font-black">{stats.open} open</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="all">All ({returns.length})</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v} ({returns.filter(r => r.status === k).length})</option>
            ))}
          </select>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 transition-colors flex items-center gap-1">
            <Plus className="w-3 h-3" /> Log Return
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="px-4 py-2 border-b border-gray-50 flex items-center gap-4">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Total: {stats.total}</span>
        <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">Defects: {stats.defects}</span>
        <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">Wrong Size: {stats.wrongSize}</span>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-orange-50/50">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Order #</label>
              <input value={formOrderNum} onChange={e => setFormOrderNum(e.target.value)} placeholder="e.g. 1234" className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none" />
              {formOrderNum && !matchedOrder && <p className="text-[8px] text-red-500 mt-0.5">Order not found</p>}
              {matchedOrder && <p className="text-[8px] text-emerald-500 mt-0.5">{matchedOrder.shopify.customerName}</p>}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Item</label>
              {matchedOrder ? (
                <select value={formItem} onChange={e => {
                  setFormItem(e.target.value);
                  const item = matchedOrder.shopify.items.find(i => i.name === e.target.value);
                  if (item) { setFormSku(item.sku); }
                }} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none">
                  <option value="">Select item...</option>
                  {matchedOrder.shopify.items.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
                </select>
              ) : (
                <input value={formItem} onChange={e => setFormItem(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none" />
              )}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Size</label>
              <input value={formSize} onChange={e => setFormSize(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none" />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Qty</label>
              <input type="number" min={1} value={formQty} onChange={e => setFormQty(parseInt(e.target.value) || 1)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none" />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Reason</label>
              <select value={formReason} onChange={e => setFormReason(e.target.value as ReturnRecord['reason'])} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none">
                {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Detail</label>
              <input value={formDetail} onChange={e => setFormDetail(e.target.value)} placeholder="Additional notes..." className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-500 outline-none" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleAdd} disabled={!matchedOrder || !formItem} className="px-4 py-1.5 bg-orange-500 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 disabled:opacity-50 transition-colors">Save</button>
              <button onClick={() => setShowForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            <p className="text-xs font-bold uppercase tracking-widest">No returns logged</p>
          </div>
        ) : filtered.map(r => (
          <div key={r.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => onNavigateToOrder?.(r.originalOrderNumber)} className="text-xs font-black text-gray-800 hover:text-indigo-600 transition-colors">
                  #{r.originalOrderNumber}
                </button>
                <span className="text-[10px] font-bold text-gray-500">{r.customerName}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${statusColor(r.status)}`}>{STATUS_LABELS[r.status]}</span>
                <span className={`text-[9px] font-bold ${reasonColor(r.reason)}`}>{REASON_LABELS[r.reason]}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-gray-600">{r.itemName}</span>
                {r.size && <span className="text-[9px] text-gray-400">Size: {r.size}</span>}
                <span className="text-[9px] text-gray-400">x{r.quantity}</span>
                {r.reasonDetail && <span className="text-[9px] italic text-gray-400">— {r.reasonDetail}</span>}
              </div>
              {r.remakeJobId && (
                <div className="mt-1">
                  <span className="text-[9px] font-bold text-blue-500">Remake Job: #{r.remakeJobId}</span>
                </div>
              )}
              <div className="text-[8px] text-gray-400 mt-1">
                Logged {new Date(r.createdAt).toLocaleDateString('en-GB')} by {r.createdBy}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {r.status !== 'resolved' && (
                <select value={r.status} onChange={e => handleStatusChange(r.id, e.target.value as ReturnRecord['status'])} className="text-[9px] font-bold border border-gray-200 rounded px-1 py-0.5 focus:ring-1 focus:ring-orange-500 outline-none">
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
              {editingId === r.id ? (
                <form onSubmit={e => { e.preventDefault(); const input = (e.target as HTMLFormElement).elements.namedItem('jobId') as HTMLInputElement; handleRemakeJobId(r.id, input.value); }} className="flex items-center gap-1">
                  <input name="jobId" defaultValue={r.remakeJobId || ''} placeholder="Job ID" className="w-20 px-1 py-0.5 border border-gray-200 rounded text-[9px] font-bold outline-none" />
                  <button type="submit" className="text-emerald-500 hover:text-emerald-700"><Check className="w-3 h-3" /></button>
                </form>
              ) : (
                <button onClick={() => setEditingId(r.id)} className="p-1 text-gray-300 hover:text-indigo-500 transition-colors" title="Set remake job ID"><Edit3 className="w-3 h-3" /></button>
              )}
              <button onClick={() => handleDelete(r.id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors" title="Delete"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReturnsTracker;
