import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, FileUp, Loader2, Upload } from 'lucide-react';
import type { ReferenceProduct, SupplierImport } from '../types';
import type { SupplierCsvField } from '../utils/csvParse';
import {
  fetchSupplierImports,
  parseSupplierCsvFile,
  uploadSupplierCsv,
} from '../services/supplierCatalogService';
import { isSupabaseReady } from '../services/supabase';

const FIELD_LABELS: Record<SupplierCsvField, string> = {
  ean: 'EAN / barcode *',
  vendor: 'Vendor / brand',
  productCode: 'Style / SKU code',
  description: 'Description',
  colour: 'Colour',
  size: 'Size',
};

interface Props {
  referenceProducts: ReferenceProduct[];
  onCatalogUpdated: () => Promise<void>;
  onReferenceMerged: (next: ReferenceProduct[]) => void;
  uploadedBy?: string;
}

const SupplierCatalogPanel: React.FC<Props> = ({
  referenceProducts,
  onCatalogUpdated,
  onReferenceMerged,
  uploadedBy,
}) => {
  const [open, setOpen] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<SupplierCsvField, string>>({
    ean: '', vendor: '', productCode: '', description: '', colour: '', size: '',
  });
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [imports, setImports] = useState<SupplierImport[]>([]);

  const loadImports = useCallback(async () => {
    try {
      setImports(await fetchSupplierImports());
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    if (open) void loadImports();
  }, [open, loadImports]);

  const onPickFile = async (f: File) => {
    setFile(f);
    setError(null);
    setSuccess(null);
    const text = await f.text();
    setCsvText(text);
    const parsed = parseSupplierCsvFile(text);
    setHeaders(parsed.headers);
    setSampleRows(parsed.sampleRows);
    setMapping(parsed.mapping);
    if (!supplierName.trim()) {
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (base) setSupplierName(base);
    }
  };

  const startUpload = async () => {
    if (!file || !csvText) {
      setError('Choose a CSV file first.');
      return;
    }
    if (!supplierName.trim()) {
      setError('Enter the supplier name (e.g. Mizuno, AWDis).');
      return;
    }
    if (!mapping.ean) {
      setError('Map the EAN / barcode column.');
      return;
    }
    if (!isSupabaseReady()) {
      setError('Supabase not configured — run migrations/stash_supplier_catalog.sql');
      return;
    }
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await uploadSupplierCsv(
        {
          supplierName: supplierName.trim(),
          fileName: file.name,
          csvText,
          mapping,
          replaceExisting,
          uploadedBy,
        },
        referenceProducts,
      );
      onReferenceMerged(result.mergedReference);
      await onCatalogUpdated();
      await loadImports();
      setSuccess(
        `Uploaded ${result.import.rowCount} barcodes for ${result.import.supplierName}. Master reference updated.`,
      );
      setFile(null);
      setCsvText('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!isSupabaseReady()) {
    return (
      <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Run <code className="text-[9px]">migrations/stash_supplier_catalog.sql</code> in Supabase to enable supplier feeds.
      </p>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-600 flex items-center gap-2">
          <FileUp className="w-4 h-4 text-indigo-500" />
          Supplier barcode feeds
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-500 pt-2">
            Upload a supplier CSV to match scans by EAN. Re-uploading replaces that supplier&apos;s feed; master reference is merged automatically.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              placeholder="Supplier name *"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold"
            />
            <label className="flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-indigo-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-indigo-600 cursor-pointer hover:bg-indigo-50">
              <Upload className="w-3.5 h-3.5" />
              {file ? file.name.slice(0, 28) : 'Choose CSV'}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                }}
              />
            </label>
          </div>

          {headers.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(Object.keys(FIELD_LABELS) as SupplierCsvField[]).map(field => (
                <label key={field} className="text-[9px] font-black uppercase text-gray-400">
                  {FIELD_LABELS[field]}
                  <select
                    value={mapping[field]}
                    onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                    className="mt-0.5 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-800"
                  >
                    <option value="">— skip —</option>
                    {headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={e => setReplaceExisting(e.target.checked)}
            />
            Replace this supplier&apos;s previous feed (recommended)
          </label>

          {error && (
            <p className="text-[11px] font-semibold text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          {success && (
            <p className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>
          )}

          <button
            type="button"
            disabled={uploading || !file}
            onClick={() => void startUpload()}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-indigo-500 flex items-center justify-center gap-2"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload feed
          </button>

          {imports.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Recent uploads</p>
              <ul className="text-[11px] text-gray-600 space-y-0.5 max-h-24 overflow-y-auto">
                {imports.slice(0, 8).map(imp => (
                  <li key={imp.id}>
                    {imp.supplierName} — {imp.rowCount} rows · {new Date(imp.createdAt).toLocaleDateString('en-GB')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupplierCatalogPanel;
