import React, { useState, useRef, useEffect } from 'react';
import { OrderNote, getNotesForOrder, saveNote, deleteNote, syncNotesToCloud } from '../services/notesService';
import { ApiSettings } from './SettingsModal';
import { MessageSquare, Send, Trash2, X, Edit3, Pin, AtSign, Maximize2, Minimize2 } from 'lucide-react';

interface Props {
  orderId: string;
  orderNumber: string;
  authorEmail: string;
  settings: ApiSettings;
  onClose: () => void;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  normal: { bg: '', text: '', label: '' },
  urgent: { bg: 'bg-red-50 border-red-200', text: 'text-red-600', label: '🔴 URGENT' },
  info: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-600', label: 'ℹ️ INFO' },
  action: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-600', label: '⚡ ACTION NEEDED' },
};

const OrderNotes: React.FC<Props> = ({ orderId, orderNumber, authorEmail, settings, onClose }) => {
  const [notes, setNotes] = useState<OrderNote[]>(() => getNotesForOrder(orderId));
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pinned'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [notes.length]);

  // Sort: pinned first, then by date (newest first)
  const displayNotes = notes
    .filter(n => filter === 'all' || n.pinned)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.createdAt - a.createdAt;
    });

  const handleAdd = () => {
    if (!newText.trim()) return;
    const note: OrderNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId,
      orderNumber,
      text: newText.trim(),
      author: authorEmail,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      priority: priority !== 'normal' ? priority : undefined,
    };
    saveNote(note);
    setNotes(getNotesForOrder(orderId));
    setNewText('');
    setPriority('normal');
    syncNotesToCloud(settings, [note]).catch(console.error);
  };

  const handleDelete = (noteId: string) => {
    deleteNote(orderId, noteId);
    setNotes(getNotesForOrder(orderId));
  };

  const handleEdit = (note: OrderNote) => {
    if (!editText.trim()) return;
    const updated = { ...note, text: editText.trim(), updatedAt: Date.now() };
    saveNote(updated);
    setNotes(getNotesForOrder(orderId));
    setEditingId(null);
    setEditText('');
    syncNotesToCloud(settings, [updated]).catch(console.error);
  };

  const handleTogglePin = (note: OrderNote) => {
    const updated = { ...note, pinned: !note.pinned, updatedAt: Date.now() };
    saveNote(updated);
    setNotes(getNotesForOrder(orderId));
    syncNotesToCloud(settings, [updated]).catch(console.error);
  };

  // Parse @mentions in text
  const renderText = (text: string) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) =>
      part.startsWith('@') ? <span key={i} className="text-indigo-500 font-black">{part}</span> : part
    );
  };

  // Author color based on email
  const getAuthorColor = (email: string) => {
    const colors = ['text-indigo-500', 'text-emerald-500', 'text-amber-500', 'text-rose-500', 'text-cyan-500', 'text-violet-500'];
    let hash = 0;
    for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const pinnedCount = notes.filter(n => n.pinned).length;

  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-2xl flex flex-col animate-in slide-in-from-bottom-2 duration-200 ${expanded ? 'w-[500px] max-h-[600px]' : 'w-80 max-h-96'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Chat — #{orderNumber}</span>
          <span className="text-[9px] font-bold text-gray-400">{notes.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {pinnedCount > 0 && (
            <button
              onClick={() => setFilter(filter === 'all' ? 'pinned' : 'all')}
              className={`p-1 rounded transition-colors ${filter === 'pinned' ? 'bg-amber-100 text-amber-600' : 'text-gray-300 hover:text-amber-500'}`}
              title={filter === 'pinned' ? 'Show all' : `Show pinned (${pinnedCount})`}
            >
              <Pin className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-gray-100 rounded text-gray-300 hover:text-gray-600">
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="w-3.5 h-3.5 text-gray-400" /></button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {displayNotes.length === 0 && (
          <p className="text-center text-[10px] text-gray-400 font-bold py-6">
            {filter === 'pinned' ? 'No pinned messages' : 'No messages yet. Start the conversation below.'}
          </p>
        )}
        {displayNotes.map(note => {
          const isOwn = note.author === authorEmail;
          const priorityStyle = PRIORITY_COLORS[note.priority || 'normal'];

          return (
            <div key={note.id} className={`group rounded-lg p-2.5 border transition-all ${
              note.pinned ? 'bg-amber-50/50 border-amber-200/50' :
              priorityStyle.bg ? priorityStyle.bg : 
              isOwn ? 'bg-indigo-50/50 border-indigo-100' : 'bg-gray-50 border-gray-100'
            }`}>
              {editingId === note.id ? (
                <div className="flex gap-1">
                  <input
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="flex-1 text-[10px] font-bold border border-indigo-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none"
                    onKeyDown={e => { if (e.key === 'Enter') handleEdit(note); if (e.key === 'Escape') setEditingId(null); }}
                    autoFocus
                  />
                  <button onClick={() => handleEdit(note)} className="px-2 py-1 bg-indigo-500 text-white rounded text-[9px] font-black">Save</button>
                </div>
              ) : (
                <>
                  {/* Priority badge */}
                  {note.priority && note.priority !== 'normal' && (
                    <div className={`text-[8px] font-black uppercase mb-1 ${priorityStyle.text}`}>{priorityStyle.label}</div>
                  )}
                  {/* Pin indicator */}
                  {note.pinned && (
                    <div className="text-[8px] font-black text-amber-500 mb-1 flex items-center gap-0.5"><Pin className="w-2.5 h-2.5" /> Pinned</div>
                  )}
                  <p className="text-[10px] font-bold text-gray-700 leading-relaxed whitespace-pre-wrap">{renderText(note.text)}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[8px] font-bold">
                      <span className={getAuthorColor(note.author)}>{note.author.split('@')[0]}</span>
                      <span className="text-gray-400"> • {new Date(note.createdAt).toLocaleDateString('en-GB')} {new Date(note.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      {note.updatedAt !== note.createdAt && <span className="text-gray-300"> (edited)</span>}
                    </span>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button onClick={() => handleTogglePin(note)} className={`p-0.5 rounded ${note.pinned ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'}`} title={note.pinned ? 'Unpin' : 'Pin'}><Pin className="w-3 h-3" /></button>
                      {isOwn && <button onClick={() => { setEditingId(note.id); setEditText(note.text); }} className="p-0.5 text-gray-300 hover:text-indigo-500"><Edit3 className="w-3 h-3" /></button>}
                      {isOwn && <button onClick={() => handleDelete(note.id)} className="p-0.5 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-100 space-y-2">
        {/* Priority selector */}
        <div className="flex gap-1">
          {Object.entries(PRIORITY_COLORS).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setPriority(key)}
              className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border transition-all ${
                priority === key
                  ? key === 'normal' ? 'bg-gray-100 border-gray-300 text-gray-600' : `${val.bg} border-current ${val.text}`
                  : 'border-transparent text-gray-300 hover:text-gray-500'
              }`}
            >
              {key === 'normal' ? 'Normal' : val.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={newText}
            onChange={e => setNewText(e.target.value)}
            placeholder="Type a message... (use @name to mention)"
            className="flex-1 px-3 py-2 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            className="px-3 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderNotes;
