import React, { useState, useRef, useEffect, useCallback } from 'react';
import { OrderNote, getNotesForOrder, saveNote, deleteNote, syncNoteToCloud, fetchNotesFromCloud, deleteNoteFromCloud, mergeNotes, fetchMentionUsers, fetchChatParticipants, MentionUser } from '../services/notesService';
import { createMentionNotifications } from '../services/notificationService';
import { ApiSettings } from './SettingsModal';
import { MessageSquare, Send, Trash2, X, Edit3, Pin, Maximize2, Minimize2, Loader2, Bell } from 'lucide-react';

interface Props {
  orderId: string;
  orderNumber: string;
  authorEmail: string;
  authorName: string;
  settings: ApiSettings;
  onClose: () => void;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  normal: { bg: '', text: '', label: '' },
  urgent: { bg: 'bg-red-50 border-red-200', text: 'text-red-600', label: '🔴 URGENT' },
  info: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-600', label: 'ℹ️ INFO' },
  action: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-600', label: '⚡ ACTION NEEDED' },
};

const OrderNotes: React.FC<Props> = ({ orderId, orderNumber, authorEmail, authorName, settings, onClose }) => {
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pinned'>('all');
  const [loading, setLoading] = useState(true);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load notes from cloud + local and merge
  const loadAndMerge = useCallback(async () => {
    const local = getNotesForOrder(orderId);
    const cloud = await fetchNotesFromCloud(orderId);
    const merged = mergeNotes(local, cloud);
    // Save merged back to local
    merged.forEach(n => saveNote(n));
    setNotes(merged);
    return merged;
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    loadAndMerge().finally(() => setLoading(false));
    // Load mention users
    fetchMentionUsers().then(setMentionUsers);
    // Poll for new messages every 15 seconds
    pollRef.current = setInterval(() => {
      loadAndMerge();
    }, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadAndMerge]);

  useEffect(() => {
    if (scrollRef.current && !loading) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [notes.length, loading]);

  // Parse @mentions from text and return usernames
  const extractMentions = (text: string): string[] => {
    const matches = text.match(/@(\w+)/g);
    if (!matches) return [];
    return matches.map(m => m.slice(1));
  };

  // Sort: pinned first, then by date (oldest first for chat flow)
  const displayNotes = notes
    .filter(n => filter === 'all' || n.pinned)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.createdAt - b.createdAt;
    });

  const handleAdd = async () => {
    if (!newText.trim()) return;
    const mentions = extractMentions(newText);
    const note: OrderNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId,
      orderNumber,
      text: newText.trim(),
      author: authorEmail,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      priority: priority !== 'normal' ? priority : undefined,
      mentions: mentions.length > 0 ? mentions : undefined,
    };
    saveNote(note);
    setNotes(prev => [...prev, note]);
    setNewText('');
    setPriority('normal');
    setShowMentionPicker(false);
    syncNoteToCloud(note).catch(console.error);

    // Notify all other participants in this chat + any @mentioned users
    const notifyUsers = async () => {
      try {
        const participants = await fetchChatParticipants(orderId);
        // Combine participants + @mentioned users, exclude sender
        const allTargets = new Set([...participants, ...mentions]);
        allTargets.delete(authorEmail);
        if (allTargets.size > 0) {
          createMentionNotifications({
            mentions: [...allTargets],
            senderName: authorName,
            orderId,
            orderNumber,
            noteId: note.id,
            messageText: newText.trim(),
          });
        }
      } catch (e) {
        console.error('Failed to notify participants:', e);
      }
    };
    notifyUsers();
  };

  const handleDelete = async (noteId: string) => {
    deleteNote(orderId, noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
    deleteNoteFromCloud(noteId).catch(console.error);
  };

  const handleEdit = (note: OrderNote) => {
    if (!editText.trim()) return;
    const mentions = extractMentions(editText);
    const updated = { ...note, text: editText.trim(), updatedAt: Date.now(), mentions: mentions.length > 0 ? mentions : undefined };
    saveNote(updated);
    setNotes(prev => prev.map(n => n.id === note.id ? updated : n));
    setEditingId(null);
    setEditText('');
    syncNoteToCloud(updated).catch(console.error);
  };

  const handleTogglePin = (note: OrderNote) => {
    const updated = { ...note, pinned: !note.pinned, updatedAt: Date.now() };
    saveNote(updated);
    setNotes(prev => prev.map(n => n.id === note.id ? updated : n));
    syncNoteToCloud(updated).catch(console.error);
  };

  // Handle @mention typing
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart || 0;
    setNewText(val);

    // Check if we're typing an @mention
    const textBeforeCursor = val.slice(0, pos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionFilter(mentionMatch[1].toLowerCase());
      setMentionCursorPos(mentionMatch.index!);
      setShowMentionPicker(true);
      setSelectedMentionIdx(0);
    } else {
      setShowMentionPicker(false);
    }
  };

  const filteredMentionUsers = mentionUsers.filter(u =>
    u.username.toLowerCase().includes(mentionFilter) ||
    u.firstName.toLowerCase().includes(mentionFilter) ||
    u.lastName.toLowerCase().includes(mentionFilter)
  );

  const insertMention = (user: MentionUser) => {
    const before = newText.slice(0, mentionCursorPos);
    const after = newText.slice(mentionCursorPos + mentionFilter.length + 1); // +1 for @
    const newVal = `${before}@${user.username} ${after}`;
    setNewText(newVal);
    setShowMentionPicker(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionPicker && filteredMentionUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIdx(prev => Math.min(prev + 1, filteredMentionUsers.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIdx(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentionUsers[selectedMentionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentionPicker(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !showMentionPicker) {
      e.preventDefault();
      handleAdd();
    }
  };

  // Parse @mentions in text for rendering
  const renderText = (text: string) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) =>
      part.startsWith('@') ? <span key={i} className="bg-indigo-100 text-indigo-700 font-black px-1 rounded">{part}</span> : part
    );
  };

  const getAuthorColor = (email: string) => {
    const colors = ['text-indigo-600', 'text-emerald-600', 'text-amber-600', 'text-rose-600', 'text-cyan-600', 'text-violet-600'];
    let hash = 0;
    for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const getAuthorInitial = (email: string) => (email.split('@')[0]?.[0] || '?').toUpperCase();

  const pinnedCount = notes.filter(n => n.pinned).length;

  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col animate-in slide-in-from-bottom-4 duration-300 ${expanded ? 'w-[min(520px,calc(100vw-2rem))] h-[min(680px,calc(100vh-6rem))]' : 'w-[min(400px,calc(100vw-2rem))] h-[min(480px,calc(100vh-6rem))]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white rounded-t-2xl">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-500 p-2 rounded-lg shadow-sm">
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-gray-800">Order #{orderNumber}</span>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{notes.length} message{notes.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {pinnedCount > 0 && (
            <button
              onClick={() => setFilter(filter === 'all' ? 'pinned' : 'all')}
              className={`p-1.5 rounded-lg transition-colors ${filter === 'pinned' ? 'bg-amber-100 text-amber-600' : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'}`}
              title={filter === 'pinned' ? 'Show all' : `Show pinned (${pinnedCount})`}
            >
              <Pin className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600">
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            <span className="ml-2 text-xs font-bold text-gray-400 uppercase tracking-widest">Loading messages...</span>
          </div>
        )}
        {!loading && displayNotes.length === 0 && (
          <div className="text-center py-12">
            <MessageSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
              {filter === 'pinned' ? 'No pinned messages' : 'No messages yet'}
            </p>
            <p className="text-[10px] text-gray-300 font-bold mt-1">Start the conversation below. Use @name to mention someone.</p>
          </div>
        )}
        {displayNotes.map(note => {
          const isOwn = note.author === authorEmail;
          const priorityStyle = PRIORITY_COLORS[note.priority || 'normal'];

          return (
            <div key={note.id} className={`group rounded-xl p-3 border transition-all ${
              note.pinned ? 'bg-amber-50/60 border-amber-200/60 shadow-sm' :
              priorityStyle.bg ? `${priorityStyle.bg} shadow-sm` :
              isOwn ? 'bg-indigo-50/40 border-indigo-100' : 'bg-gray-50/60 border-gray-100'
            }`}>
              {editingId === note.id ? (
                <div className="flex gap-2">
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="flex-1 text-xs font-bold border border-indigo-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500/30 outline-none resize-none"
                    rows={2}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(note); } if (e.key === 'Escape') setEditingId(null); }}
                    autoFocus
                  />
                  <div className="flex flex-col gap-1">
                    <button onClick={() => handleEdit(note)} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-[10px] font-black hover:bg-indigo-600">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg text-[10px] font-black hover:bg-gray-200">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2.5">
                    {/* Avatar */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 ${
                      isOwn ? 'bg-indigo-500' : 'bg-gray-400'
                    }`}>
                      {getAuthorInitial(note.author)}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Priority / Pin badges */}
                      {note.priority && note.priority !== 'normal' && (
                        <div className={`text-[9px] font-black uppercase mb-1 ${priorityStyle.text}`}>{priorityStyle.label}</div>
                      )}
                      {note.pinned && (
                        <div className="text-[9px] font-black text-amber-500 mb-1 flex items-center gap-1"><Pin className="w-3 h-3" /> Pinned</div>
                      )}
                      {/* Mention badge */}
                      {note.mentions && note.mentions.length > 0 && (
                        <div className="text-[9px] font-black text-indigo-500 mb-1 flex items-center gap-1">
                          <Bell className="w-3 h-3" /> Mentioned: {note.mentions.map(m => `@${m}`).join(', ')}
                        </div>
                      )}
                      <p className="text-xs font-medium text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{renderText(note.text)}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-[10px] font-black ${getAuthorColor(note.author)}`}>{note.author.split('@')[0]}</span>
                        <span className="text-[10px] text-gray-300">•</span>
                        <span className="text-[10px] text-gray-400 font-bold">{new Date(note.createdAt).toLocaleDateString('en-GB')} {new Date(note.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                        {note.updatedAt !== note.createdAt && <span className="text-[10px] text-gray-300 italic">(edited)</span>}
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                      <button onClick={() => handleTogglePin(note)} className={`p-1 rounded-lg transition-colors ${note.pinned ? 'text-amber-500 bg-amber-50' : 'text-gray-300 hover:text-amber-500 hover:bg-amber-50'}`} title={note.pinned ? 'Unpin' : 'Pin'}><Pin className="w-3.5 h-3.5" /></button>
                      {isOwn && <button onClick={() => { setEditingId(note.id); setEditText(note.text); }} className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg"><Edit3 className="w-3.5 h-3.5" /></button>}
                      {isOwn && <button onClick={() => handleDelete(note.id)} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 space-y-2 bg-gray-50/50 rounded-b-2xl relative">
        {/* Mention picker dropdown */}
        {showMentionPicker && filteredMentionUsers.length > 0 && (
          <div ref={mentionRef} className="absolute bottom-full left-4 right-4 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-10">
            <div className="px-3 py-2 border-b border-gray-100">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Select a person</span>
            </div>
            {filteredMentionUsers.map((user, idx) => (
              <button
                key={user.id}
                onClick={() => insertMention(user)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-indigo-50 transition-colors ${idx === selectedMentionIdx ? 'bg-indigo-50' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-black text-white shrink-0">
                  {user.firstName[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-800">{user.displayName}</div>
                  <div className="text-[10px] text-gray-400 font-bold">@{user.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Priority selector */}
        <div className="flex gap-1.5 flex-wrap">
          {Object.entries(PRIORITY_COLORS).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setPriority(key)}
              className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border transition-all ${
                priority === key
                  ? key === 'normal' ? 'bg-gray-100 border-gray-300 text-gray-600 shadow-sm' : `${val.bg} border-current ${val.text} shadow-sm`
                  : 'border-transparent text-gray-300 hover:text-gray-500'
              }`}
            >
              {key === 'normal' ? 'Normal' : val.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={newText}
            onChange={handleInputChange}
            placeholder="Type a message... use @ to mention someone"
            className="flex-1 px-3 py-2.5 text-xs font-bold border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/30 outline-none resize-none bg-white"
            rows={2}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderNotes;
