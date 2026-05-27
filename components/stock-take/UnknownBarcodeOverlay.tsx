import React from 'react';

interface Props {
  unknownCode: string;
  hint: string | null;
  form: {
    description: string;
    vendor: string;
    productCode: string;
    colour: string;
    size: string;
  };
  onChangeForm: (next: Props['form']) => void;
  onRegister: () => void;
  onCancel: () => void;
}

const UnknownBarcodeOverlay: React.FC<Props> = ({
  unknownCode,
  hint,
  form,
  onChangeForm,
  onRegister,
  onCancel,
}) => (
  <div className="absolute inset-0 z-30 flex items-end sm:items-center justify-center p-2 bg-black/50 rounded-xl">
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3 w-full max-h-[88%] overflow-y-auto shadow-lg">
      <p className="text-sm font-black text-amber-900">
        Unknown barcode: <span className="font-mono">{unknownCode}</span>
      </p>
      <p className="text-[11px] text-amber-800 leading-relaxed">
        {hint || 'Not in your supplier feeds or master list. Add once, or cancel to keep scanning.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          required
          value={form.description}
          onChange={e => onChangeForm({ ...form, description: e.target.value })}
          placeholder="Description *"
          className="min-h-[44px] px-3 py-2 border border-amber-200 rounded-lg text-sm font-bold sm:col-span-2"
        />
        <input
          value={form.vendor}
          onChange={e => onChangeForm({ ...form, vendor: e.target.value })}
          placeholder="Vendor"
          className="min-h-[44px] px-3 py-2 border border-amber-200 rounded-lg text-sm"
        />
        <input
          value={form.productCode}
          onChange={e => onChangeForm({ ...form, productCode: e.target.value })}
          placeholder="Product code"
          className="min-h-[44px] px-3 py-2 border border-amber-200 rounded-lg text-sm"
        />
        <input
          value={form.colour}
          onChange={e => onChangeForm({ ...form, colour: e.target.value })}
          placeholder="Colour"
          className="min-h-[44px] px-3 py-2 border border-amber-200 rounded-lg text-sm"
        />
        <input
          value={form.size}
          onChange={e => onChangeForm({ ...form, size: e.target.value })}
          placeholder="Size"
          className="min-h-[44px] px-3 py-2 border border-amber-200 rounded-lg text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRegister}
          className="min-h-[44px] px-4 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest"
        >
          Add to count
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 border border-amber-300 rounded-lg text-[10px] font-black uppercase tracking-widest text-amber-800"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
);

export default UnknownBarcodeOverlay;
