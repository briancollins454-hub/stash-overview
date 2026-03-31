import React, { useState, useMemo } from 'react';
import { Search, Filter, ChevronDown, Check, X, SortAsc, SortDesc, Eye, EyeOff } from 'lucide-react';

interface FilterOption {
  label: string;
  count: number;
}

interface MultiSelectFilterProps {
  options: FilterOption[];
  selectedValues: Set<string>;
  onChange: (values: Set<string>) => void;
  placeholder?: string;
  title?: string;
  showZeroByDefault?: boolean;
}

const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({ 
  options, 
  selectedValues, 
  onChange, 
  placeholder = "Filter...", 
  title = "Filter",
  showZeroByDefault = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showZeroCounts, setShowZeroCounts] = useState(showZeroByDefault);

  const filteredOptions = useMemo(() => {
    let result = options.filter(opt => {
      const matchesSearch = opt.label.toLowerCase().includes(searchTerm.toLowerCase());
      const isSelected = selectedValues.has(opt.label);
      const hasOrders = opt.count > 0;
      
      // Show if it matches search AND (it has orders OR user wants to see zeros OR it is currently selected)
      return matchesSearch && (hasOrders || showZeroCounts || isSelected);
    });
    
    result.sort((a, b) => {
      if (sortOrder === 'asc') return a.label.localeCompare(b.label);
      return b.label.localeCompare(a.label);
    });
    
    return result;
  }, [options, searchTerm, sortOrder, showZeroCounts, selectedValues]);

  const toggleValue = (value: string) => {
    const next = new Set(selectedValues);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  };

  const handleSelectAll = () => {
    const next = new Set(selectedValues);
    filteredOptions.forEach(opt => next.add(opt.label));
    onChange(next);
  };

  const handleClearAll = () => {
    onChange(new Set());
  };

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-2 px-3 py-2 bg-white border rounded-lg text-sm font-medium transition-all duration-200 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 ${
          selectedValues.size > 0 ? 'border-indigo-500 text-indigo-700 bg-indigo-50' : 'border-gray-300 text-gray-700'
        }`}
      >
        <Filter className="w-4 h-4" />
        <span className="max-w-[120px] truncate">
          {selectedValues.size === 0 
            ? title 
            : selectedValues.size === 1 
              ? Array.from(selectedValues)[0] 
              : `${selectedValues.size} Selected`}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-left">
            <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</span>
              <div className="flex gap-1">
                <button 
                  onClick={() => setSortOrder('asc')}
                  className={`p-1.5 rounded hover:bg-white border transition-colors ${sortOrder === 'asc' ? 'bg-white text-indigo-600 border-gray-200' : 'text-gray-400 border-transparent'}`}
                  title="Sort A-Z"
                >
                  <SortAsc className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setSortOrder('desc')}
                  className={`p-1.5 rounded hover:bg-white border transition-colors ${sortOrder === 'desc' ? 'bg-white text-indigo-600 border-gray-200' : 'text-gray-400 border-transparent'}`}
                  title="Sort Z-A"
                >
                  <SortDesc className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-3">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  placeholder={placeholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex gap-3 text-[10px] font-bold uppercase tracking-wide">
                  <button onClick={handleSelectAll} className="text-indigo-600 hover:underline">Select All</button>
                  <button onClick={handleClearAll} className="text-gray-400 hover:text-red-500 hover:underline">Clear</button>
                </div>
                <button 
                  onClick={() => setShowZeroCounts(!showZeroCounts)}
                  className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${showZeroCounts ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                  title={showZeroCounts ? "Hiding tags with 0 orders" : "Showing tags with 0 orders"}
                >
                  {showZeroCounts ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {showZeroCounts ? "Hide 0s" : "Show 0s"}
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-gray-200">
                {filteredOptions.length === 0 ? (
                  <div className="py-8 text-center text-xs text-gray-400 italic">No matches found</div>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSelected = selectedValues.has(opt.label);
                    return (
                      <label 
                        key={opt.label} 
                        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          isSelected ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-gray-300'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className={`text-sm truncate ${opt.count === 0 && !isSelected ? 'text-gray-400' : ''}`}>
                            {opt.label}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          isSelected ? 'bg-white text-indigo-600 shadow-sm' : opt.count === 0 ? 'bg-gray-50 text-gray-300' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {opt.count}
                        </span>
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={isSelected}
                          onChange={() => toggleValue(opt.label)}
                        />
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button 
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-sm hover:bg-indigo-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MultiSelectFilter;