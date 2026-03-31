import React, { useState, useMemo, useCallback } from 'react';
import { Bookmark, Plus, Trash2, X, Save as SaveIcon, CheckCircle2 } from 'lucide-react';

export interface SavedView {
  id: string;
  name: string;
  filters: {
    activeQuickFilter: string | null;
    showFulfilled: boolean;
    includeMto: boolean;
    searchTerm: string;
    startDate: string;
    endDate: string;
    selectedGroups: string[];
    groupingMode: 'club' | 'vendor';
    partialThreshold: number;
  };
  createdAt: number;
}

const STORAGE_KEY = 'stash_saved_views';

export function loadSavedViews(): SavedView[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveSavedViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

interface Props {
  currentFilters: SavedView['filters'];
  onApplyView: (filters: SavedView['filters']) => void;
}

const SavedFilters: React.FC<Props> = ({ currentFilters, onApplyView }) => {
  const [views, setViews] = useState<SavedView[]>(loadSavedViews);
  const [isNaming, setIsNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const handleSave = () => {
    if (!newName.trim()) return;
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: newName.trim(),
      filters: { ...currentFilters },
      createdAt: Date.now(),
    };
    const next = [...views, view];
    setViews(next);
    saveSavedViews(next);
    setNewName('');
    setIsNaming(false);
  };

  const handleDelete = (id: string) => {
    const next = views.filter(v => v.id !== id);
    setViews(next);
    saveSavedViews(next);
    if (activeViewId === id) setActiveViewId(null);
  };

  const handleApply = (view: SavedView) => {
    setActiveViewId(view.id);
    onApplyView(view.filters);
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {views.map(view => (
        <div key={view.id} className="group flex items-center">
          <button
            onClick={() => handleApply(view)}
            className={`px-3 py-1.5 rounded-l-lg text-[10px] font-bold uppercase tracking-widest border transition-all ${
              activeViewId === view.id
                ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            <Bookmark className={`w-3 h-3 inline-block mr-1 ${activeViewId === view.id ? 'fill-indigo-500' : ''}`} />
            {view.name}
          </button>
          <button
            onClick={() => handleDelete(view.id)}
            className="px-1.5 py-1.5 border border-l-0 border-gray-200 rounded-r-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors hidden group-hover:block"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}

      {isNaming ? (
        <div className="flex items-center gap-1 animate-in slide-in-from-left-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="View name..."
            className="px-2 py-1 text-[10px] font-bold border border-indigo-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none w-32"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setIsNaming(false); }}
          />
          <button onClick={handleSave} className="px-2 py-1 bg-indigo-500 text-white rounded-lg text-[9px] font-black uppercase">
            <SaveIcon className="w-3 h-3" />
          </button>
          <button onClick={() => setIsNaming(false)} className="px-1 py-1 text-gray-400 hover:text-gray-600">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsNaming(true)}
          className="px-2 py-1.5 border border-dashed border-gray-300 rounded-lg text-[10px] font-bold text-gray-400 hover:text-indigo-500 hover:border-indigo-300 transition-colors flex items-center gap-1"
          title="Save current filters as a view"
        >
          <Plus className="w-3 h-3" /> Save View
        </button>
      )}

      {activeViewId && (
        <button
          onClick={() => { setActiveViewId(null); }}
          className="px-2 py-1 text-[9px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest"
        >
          Clear
        </button>
      )}
    </div>
  );
};

export default SavedFilters;
