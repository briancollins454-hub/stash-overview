import React, { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';

export interface ScanLog {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: string;
}

interface ScanConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  isScanning: boolean;
  progress: number;
  current: number;
  total: number;
  logs: ScanLog[];
  onStop: () => void;
}

const ScanConsoleModal: React.FC<ScanConsoleModalProps> = ({
  isOpen, onClose, isScanning, progress, current, total, logs, onStop
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden border border-gray-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
          <div>
            <h2 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
              {isScanning && <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />}
              DecoNetwork Discovery Console
            </h2>
            <p className="text-xs text-indigo-600 font-medium">
              {isScanning ? 'Scanning Shopify Timeline for Job IDs...' : 'Scan Complete'}
            </p>
          </div>
          {!isScanning && (
            <button onClick={onClose} className="p-2 hover:bg-indigo-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-indigo-500" />
            </button>
          )}
        </div>

        {/* Progress Section */}
        <div className="px-8 py-6 bg-white border-b border-gray-100">
            <div className="flex justify-between text-sm font-bold text-gray-700 mb-2">
                <span>Processing Order {current} of {total}</span>
                <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden border border-gray-100">
                <div 
                    className={`h-full transition-all duration-300 ${isScanning ? 'bg-indigo-600' : 'bg-green-500'}`} 
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
        </div>

        {/* Terminal/Log Area */}
        <div className="flex-1 bg-slate-900 p-6 overflow-y-auto font-mono text-xs border-t border-b border-slate-800 shadow-inner">
            <div className="space-y-2">
                {logs.length === 0 && <span className="text-slate-500">Initializing scanner...</span>}
                {logs.map((log) => (
                    <div key={log.id} className="flex gap-3 border-b border-slate-800/50 pb-1 last:border-0">
                        <span className="text-slate-500 shrink-0 min-w-[60px]">[{log.timestamp}]</span>
                        <span className={`${
                            log.type === 'success' ? 'text-green-400 font-bold' : 
                            log.type === 'error' ? 'text-red-400 font-bold' : 
                            log.type === 'warning' ? 'text-amber-400' :
                            'text-slate-300'
                        }`}>
                            {log.type === 'success' && '✅ '}
                            {log.type === 'error' && '❌ '}
                            {log.type === 'warning' && '⚡ '}
                            {log.message}
                        </span>
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            {isScanning ? (
                <button 
                    onClick={onStop}
                    className="px-6 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-bold transition-colors border border-red-200"
                >
                    Stop Scanning
                </button>
            ) : (
                <button 
                    onClick={onClose}
                    className="px-6 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-sm font-bold transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                >
                    Close Console
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default ScanConsoleModal;