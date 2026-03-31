import React, { useState, useMemo } from 'react';
import { PhysicalStockItem } from '../types';
import { AlertTriangle, Bell, Package, ShoppingCart, Save, X } from 'lucide-react';

export interface ReorderPoint {
  id: string;
  productCode: string;
  description: string;
  minQuantity: number;
  preferredSupplier: string;
  reorderQuantity: number;
  lastReordered?: number;
}

interface Props {
  physicalStock: PhysicalStockItem[];
  reorderPoints: ReorderPoint[];
  onSaveReorderPoints: (points: ReorderPoint[]) => void;
}

const STORAGE_KEY = 'stash_reorder_points';

export function loadReorderPoints(): ReorderPoint[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveReorderPoints(points: ReorderPoint[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
}

const StockAlerts: React.FC<Props> = ({ physicalStock, reorderPoints, onSaveReorderPoints }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPoint, setNewPoint] = useState<Partial<ReorderPoint>>({});
  const [showAddForm, setShowAddForm] = useState(false);

  // Aggregate stock by productCode
  const aggregated = useMemo(() => {
    const map = new Map<string, { total: number; description: string; vendor: string }>();
    physicalStock.forEach(item => {
      const key = item.productCode;
      const existing = map.get(key);
      if (existing) {
        existing.total += item.quantity;
      } else {
        map.set(key, { total: item.quantity, description: item.description, vendor: item.vendor });
      }
    });
    return map;
  }, [physicalStock]);

  // Find items below reorder point
  const alerts = useMemo(() => {
    return reorderPoints
      .map(rp => {
        const stock = aggregated.get(rp.productCode);
        const currentQty = stock?.total ?? 0;
        return {
          ...rp,
          currentQty,
          belowMin: currentQty < rp.minQuantity,
          deficit: rp.minQuantity - currentQty,
        };
      })
      .sort((a, b) => (b.belowMin ? 1 : 0) - (a.belowMin ? 1 : 0) || b.deficit - a.deficit);
  }, [reorderPoints, aggregated]);

  const lowStockCount = alerts.filter(a => a.belowMin).length;

  const handleAdd = () => {
    if (!newPoint.productCode || !newPoint.minQuantity) return;
    const point: ReorderPoint = {
      id: `rp-${Date.now()}`,
      productCode: newPoint.productCode,
      description: newPoint.description || aggregated.get(newPoint.productCode)?.description || '',
      minQuantity: newPoint.minQuantity,
      preferredSupplier: newPoint.preferredSupplier || '',
      reorderQuantity: newPoint.reorderQuantity || newPoint.minQuantity * 2,
    };
    const next = [...reorderPoints, point];
    onSaveReorderPoints(next);
    setNewPoint({});
    setShowAddForm(false);
  };

  const handleDelete = (id: string) => {
    onSaveReorderPoints(reorderPoints.filter(rp => rp.id !== id));
  };

  const handleUpdate = (id: string, updates: Partial<ReorderPoint>) => {
    onSaveReorderPoints(reorderPoints.map(rp => rp.id === id ? { ...rp, ...updates } : rp));
    setEditingId(null);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Stock Alerts & Reorder Points</h3>
          {lowStockCount > 0 && (
            <span className="px-2 py-0.5 bg-red-500 text-white rounded-full text-[9px] font-black">{lowStockCount} low</span>
          )}
        </div>
        <button onClick={() => setShowAddForm(true)} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors">
          + Add Reorder Point
        </button>
      </div>

      {showAddForm && (
        <div className="p-4 border-b border-gray-100 bg-indigo-50/30 animate-in slide-in-from-top-1">
          <div className="grid grid-cols-5 gap-2">
            <input placeholder="Product Code" value={newPoint.productCode || ''} onChange={e => setNewPoint(p => ({ ...p, productCode: e.target.value }))} className="px-3 py-2 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
            <input placeholder="Description" value={newPoint.description || ''} onChange={e => setNewPoint(p => ({ ...p, description: e.target.value }))} className="px-3 py-2 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
            <input type="number" placeholder="Min Qty" value={newPoint.minQuantity || ''} onChange={e => setNewPoint(p => ({ ...p, minQuantity: Number(e.target.value) }))} className="px-3 py-2 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
            <input placeholder="Supplier" value={newPoint.preferredSupplier || ''} onChange={e => setNewPoint(p => ({ ...p, preferredSupplier: e.target.value }))} className="px-3 py-2 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
            <div className="flex gap-1">
              <button onClick={handleAdd} className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase hover:bg-emerald-600"><Save className="w-3 h-3 inline" /> Add</button>
              <button onClick={() => { setShowAddForm(false); setNewPoint({}); }} className="px-2 py-2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2" />
            <p className="text-xs font-bold uppercase tracking-widest">No reorder points configured</p>
            <p className="text-[9px] mt-1">Add products above to get low-stock alerts.</p>
          </div>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Product</th>
                <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Current</th>
                <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Min</th>
                <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Status</th>
                <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Supplier</th>
                <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Reorder Qty</th>
                <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(alert => (
                <tr key={alert.id} className={`border-t border-gray-50 ${alert.belowMin ? 'bg-red-50/50' : ''}`}>
                  <td className="px-4 py-2">
                    <span className="font-black text-gray-800">{alert.productCode}</span>
                    <span className="text-gray-400 ml-1 font-bold">{alert.description}</span>
                  </td>
                  <td className="px-4 py-2 text-center font-black">{alert.currentQty}</td>
                  <td className="px-4 py-2 text-center font-bold text-gray-500">{alert.minQuantity}</td>
                  <td className="px-4 py-2 text-center">
                    {alert.belowMin ? (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-black flex items-center gap-1 justify-center">
                        <AlertTriangle className="w-3 h-3" /> LOW ({alert.deficit})
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-black">OK</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-bold text-gray-600">{alert.preferredSupplier || '—'}</td>
                  <td className="px-4 py-2 text-center font-bold text-gray-600">{alert.reorderQuantity}</td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => handleDelete(alert.id)} className="text-gray-300 hover:text-red-500 p-1">
                      <X className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default StockAlerts;
