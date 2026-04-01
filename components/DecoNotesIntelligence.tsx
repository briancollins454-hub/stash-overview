import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { MessageSquareText, Search, ChevronDown, ChevronUp, AlertTriangle, Tag, Hash } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface KeywordGroup {
  keyword: string;
  category: string;
  count: number;
  orders: Array<{ orderNumber: string; customerName: string; noteSnippet: string; date: string }>;
}

const KEYWORD_CATEGORIES: Record<string, string[]> = {
  'Urgent / Priority': ['urgent', 'rush', 'asap', 'priority', 'express', 'fast track', 'expedite'],
  'Quality Issues': ['reprint', 'redo', 'defect', 'damaged', 'wrong', 'error', 'mistake', 'quality', 'reject', 'return'],
  'Customer Requests': ['customer request', 'special request', 'custom', 'bespoke', 'personalise', 'personalize', 'name', 'number'],
  'Stock / Supply': ['out of stock', 'back order', 'backorder', 'awaiting stock', 'delay', 'delayed', 'waiting for', 'on order'],
  'Shipping': ['collect', 'collection', 'deliver', 'delivery', 'pickup', 'pick up', 'courier', 'tracked', 'signed'],
  'Payment': ['paid', 'unpaid', 'invoice', 'credit', 'refund', 'payment', 'pro forma', 'proforma'],
  'Design / Art': ['artwork', 'art', 'proof', 'design', 'logo', 'mock', 'sample', 'colour change', 'color change'],
};

const DecoNotesIntelligence: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [search, setSearch] = useState('');
  const [expandedKw, setExpandedKw] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const { keywords, categories, hasData, totalNotes } = useMemo(() => {
    const kwMap = new Map<string, KeywordGroup>();
    let notesCount = 0;

    for (const o of orders) {
      const notes = o.deco?.notes;
      if (!notes || notes.trim().length === 0) continue;
      notesCount++;
      const notesLower = notes.toLowerCase();

      for (const [category, words] of Object.entries(KEYWORD_CATEGORIES)) {
        for (const kw of words) {
          if (notesLower.includes(kw)) {
            if (!kwMap.has(kw)) {
              kwMap.set(kw, { keyword: kw, category, count: 0, orders: [] });
            }
            const g = kwMap.get(kw)!;
            g.count++;

            // Extract snippet around keyword
            const idx = notesLower.indexOf(kw);
            const start = Math.max(0, idx - 30);
            const end = Math.min(notes.length, idx + kw.length + 50);
            const snippet = (start > 0 ? '...' : '') + notes.slice(start, end).trim() + (end < notes.length ? '...' : '');

            g.orders.push({
              orderNumber: o.shopify.orderNumber,
              customerName: o.shopify.customerName,
              noteSnippet: snippet,
              date: o.shopify.date,
            });
          }
        }
      }
    }

    const sorted = Array.from(kwMap.values()).sort((a, b) => b.count - a.count);

    // Build category summary
    const catMap = new Map<string, number>();
    for (const g of sorted) {
      catMap.set(g.category, (catMap.get(g.category) || 0) + g.count);
    }

    return {
      keywords: sorted,
      categories: catMap,
      hasData: sorted.length > 0,
      totalNotes: notesCount
    };
  }, [orders]);

  const filtered = useMemo(() => {
    let list = keywords;
    if (selectedCategory) list = list.filter(k => k.category === selectedCategory);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(k => k.keyword.includes(q) || k.orders.some(o => o.noteSnippet.toLowerCase().includes(q) || o.orderNumber.includes(q)));
    }
    return list;
  }, [keywords, search, selectedCategory]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <MessageSquareText className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Deco Notes Intelligence</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{totalNotes} orders with notes · {keywords.length} keywords detected</p>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes..."
              className="pl-8 pr-3 py-1.5 text-xs border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 w-48" />
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <MessageSquareText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No note patterns found</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Intelligence appears when DecoNetwork orders contain notes with identifiable keywords</p>
        </div>
      ) : (
        <>
          {/* Category Pills */}
          <div className="flex flex-wrap gap-2 px-6 pt-5">
            <button onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!selectedCategory ? 'bg-teal-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
              All ({keywords.reduce((s, k) => s + k.count, 0)})
            </button>
            {Array.from(categories.entries()).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <button key={cat} onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedCategory === cat ? 'bg-teal-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {cat} ({count})
              </button>
            ))}
          </div>

          {/* Keyword Groups */}
          <div className="px-6 py-4 space-y-2">
            {filtered.slice(0, 30).map(kw => (
              <div key={kw.keyword} className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => setExpandedKw(expandedKw === kw.keyword ? null : kw.keyword)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-teal-500" />
                    <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">{kw.keyword}</span>
                    <span className="text-xs bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full">
                      {kw.count} match{kw.count !== 1 ? 'es' : ''}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{kw.category}</span>
                  </div>
                  {expandedKw === kw.keyword ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {expandedKw === kw.keyword && (
                  <div className="border-t dark:border-gray-700 max-h-64 overflow-y-auto">
                    {kw.orders.map((o, i) => (
                      <div key={i} className="px-4 py-2.5 border-b last:border-b-0 dark:border-gray-700/50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <button onClick={() => onNavigateToOrder?.(o.orderNumber)}
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium">#{o.orderNumber}</button>
                            <span className="text-xs text-gray-400">{o.customerName}</span>
                          </div>
                          <span className="text-xs text-gray-400">{new Date(o.date).toLocaleDateString('en-GB')}</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/30 rounded-lg px-3 py-1.5 italic">
                          &ldquo;{o.noteSnippet}&rdquo;
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default DecoNotesIntelligence;
