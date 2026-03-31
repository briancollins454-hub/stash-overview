import React, { useState } from 'react';
import { Copy, ExternalLink, Pencil, Unlink, RefreshCw } from 'lucide-react';

interface JobIdBadgeProps {
    id: string;
    onEdit: (e: React.MouseEvent) => void;
    onUnlink?: (e: React.MouseEvent) => void;
    onNavigate?: (id: string) => void;
    onRefresh?: (id: string) => Promise<void>;
    variant?: 'indigo' | 'purple';
}

const JobIdBadge: React.FC<JobIdBadgeProps> = ({ id, onEdit, onUnlink, onNavigate, onRefresh, variant = 'indigo' }) => {
    const [copied, setCopied] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleNavigate = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onNavigate) onNavigate(id);
    };

    const handleRefresh = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onRefresh) return;
        setRefreshing(true);
        try {
            await onRefresh(id);
        } finally {
            setRefreshing(false);
        }
    };

    const colors = variant === 'purple' 
        ? 'bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100 hover:text-purple-900' 
        : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100 hover:text-indigo-900';

    return (
        <div className="flex flex-col gap-1.5 group/container">
            <div className="flex items-center gap-1.5">
                <span 
                    onClick={onNavigate ? handleNavigate : handleCopy}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-all duration-200 uppercase tracking-widest ${
                        copied ? 'bg-green-100 text-green-700 border-green-200' : colors
                    } group/badge`}
                    title={onNavigate ? "Click to View Job Details" : "Click to Copy"}
                >
                    {copied ? 'Copied!' : `#${id}`}
                    {!copied && (
                        onNavigate 
                        ? <ExternalLink className="w-2.5 h-2.5 opacity-40 group-hover/badge:opacity-100 transition-opacity" />
                        : <Copy className="w-2.5 h-2.5 opacity-40 group-hover/badge:opacity-100 transition-opacity" />
                    )}
                </span>
                <div className="flex gap-1 opacity-0 group-hover/container:opacity-100 transition-all">
                    <button 
                        onClick={onEdit} 
                        className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 rounded"
                        title="Edit Job Link"
                    >
                        <Pencil className="w-2.5 h-2.5" />
                    </button>
                    {onUnlink && (
                        <button 
                            onClick={onUnlink} 
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Unlink from Job"
                        >
                            <Unlink className="w-2.5 h-2.5" />
                        </button>
                    )}
                </div>
            </div>
            
            {onRefresh && (
                <button 
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border transition-all w-fit ${
                        refreshing 
                        ? 'bg-blue-50 text-blue-400 border-blue-100' 
                        : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-600 hover:text-white shadow-sm'
                    }`}
                >
                    <RefreshCw className={`w-2.5 h-2.5 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Syncing...' : 'Sync Deco'}
                </button>
            )}
        </div>
    );
};

export default JobIdBadge;
