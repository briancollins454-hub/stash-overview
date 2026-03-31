import React, { useState, useMemo } from 'react';
import { ReorderPoint } from './StockAlerts';
import { PhysicalStockItem } from '../types';
import { ShoppingCart, Download, ClipboardCopy, Truck, ExternalLink, CheckCircle2 } from 'lucide-react';

interface Props {
  physicalStock: PhysicalStockItem[];
  reorderPoints: ReorderPoint[];
  onMarkReordered: (pointId: string) => void;
}

interface PurchaseOrderLine {
  productCode: string;
  description: string;
  currentQty: number;
  reorderQty: number;
  supplier: string;
}

const SupplierReorder: React.FC<Props> = ({ physicalStock, reorderPoints, onMarkReordered }) => {
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Aggregate current stock
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    physicalStock.forEach(item => {
      map.set(item.productCode, (map.get(item.productCode) || 0) + item.quantity);
    });
    return map;
  }, [physicalStock]);

  // Generate lines that need reordering
  const lines = useMemo(() => {
    return reorderPoints
      .filter(rp => {
        const current = stockMap.get(rp.productCode) || 0;
        return current < rp.minQuantity;
      })
      .map(rp => ({
        id: rp.id,
        productCode: rp.productCode,
        description: rp.description,
        currentQty: stockMap.get(rp.productCode) || 0,
        reorderQty: rp.reorderQuantity,
        supplier: rp.preferredSupplier || 'Unassigned',
        lastReordered: rp.lastReordered,
      }));
  }, [reorderPoints, stockMap]);

  // Group by supplier
  const suppliers = useMemo(() => {
    const set = new Set<string>();
    lines.forEach(l => set.add(l.supplier));
    return ['all', ...Array.from(set).sort()];
  }, [lines]);

  const filteredLines = selectedSupplier === 'all' ? lines : lines.filter(l => l.supplier === selectedSupplier);

  const generatePOText = (supplierName: string, supplierLines: typeof lines) => {
    const date = new Date().toLocaleDateString('en-GB');
    let text = `PURCHASE ORDER — ${supplierName}\nDate: ${date}\nFrom: Stash Shop\n\n`;
    text += 'Code\t\tDescription\t\tQty\n';
    text += '━'.repeat(60) + '\n';
    supplierLines.forEach(l => {
      text += `${l.productCode}\t\t${l.description}\t\t${l.reorderQty}\n`;
    });
    text += '\n━'.repeat(60) + '\n';
    text += `Total Lines: ${supplierLines.length}\n`;
    text += `Total Units: ${supplierLines.reduce((sum, l) => sum + l.reorderQty, 0)}\n`;
    return text;
  };

  const handleCopyPO = (supplier: string) => {
    const supplierLines = lines.filter(l => l.supplier === supplier);
    const text = generatePOText(supplier, supplierLines);
    navigator.clipboard.writeText(text);
    setCopiedId(supplier);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadPO = (supplier: string) => {
    const supplierLines = lines.filter(l => l.supplier === supplier);
    const csv = [
      ['Product Code', 'Description', 'Current Stock', 'Reorder Quantity', 'Supplier'],
      ...supplierLines.map(l => [l.productCode, l.description, l.currentQty, l.reorderQty, l.supplier]),
    ]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PO-${supplier}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (lines.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-gray-400">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
        <p className="text-xs font-bold uppercase tracking-widest">All stock levels are above reorder points</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-blue-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Supplier Reorder</h3>
          <span className="text-[9px] font-bold text-gray-400">({lines.length} items need reorder)</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedSupplier}
            onChange={e => setSelectedSupplier(e.target.value)}
            className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none"
          >
            {suppliers.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All Suppliers' : s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Supplier action buttons */}
      {selectedSupplier !== 'all' && (
        <div className="px-4 py-2 bg-blue-50/30 border-b border-gray-100 flex items-center gap-2">
          <button
            onClick={() => handleCopyPO(selectedSupplier)}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            {copiedId === selectedSupplier ? <><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Copied</> : <><ClipboardCopy className="w-3 h-3" /> Copy PO</>}
          </button>
          <button
            onClick={() => handleDownloadPO(selectedSupplier)}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Download CSV
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Product</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Current</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Reorder Qty</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Supplier</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredLines.map(line => (
              <tr key={line.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2">
                  <span className="font-black text-gray-800">{line.productCode}</span>
                  <span className="text-gray-400 ml-1 font-bold">{line.description}</span>
                </td>
                <td className="px-4 py-2 text-center font-black text-red-600">{line.currentQty}</td>
                <td className="px-4 py-2 text-center font-black text-blue-600">{line.reorderQty}</td>
                <td className="px-4 py-2 font-bold text-gray-600">{line.supplier}</td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => onMarkReordered(line.id)}
                    className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded text-[9px] font-black uppercase hover:bg-emerald-100 transition-colors flex items-center gap-1 mx-auto"
                  >
                    <Truck className="w-3 h-3" /> Mark Ordered
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierReorder;
