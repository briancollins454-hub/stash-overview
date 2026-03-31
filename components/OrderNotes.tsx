import React, { useState, useRef, useEffect } from 'react';
import { OrderNote, getNotesForOrder, saveNote, deleteNote, syncNotesToCloud } from '../services/notesService';
import { ApiSettings } from './SettingsModal';
import { MessageSquare, Send, Trash2, X, Edit3 } from 'lucide-react';

interface Props {
  orderId: string;
  orderNumber: string;
  authorEmail: string;
  settings: ApiSettings;
  onClose: () => void;
}

const OrderNotes: React.FC<Props> = ({ orderId, orderNumber, authorEmail, settings, onClose }) => {
  const [notes, setNotes] = useState<OrderNote[]>(() => getNotesForOrder(orderId));
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    };
    saveNote(note);
    setNotes(getNotesForOrder(orderId));
    setNewText('');
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

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-80 max-h-96 flex flex-col animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Notes — #{orderNumber}</span>
        </div>
        <button onClick={onClose} className="p-0.5 hover:bg-gray-100 rounded"><X className="w-3.5 h-3.5 text-gray-400" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {notes.length === 0 && (
          <p className="text-center text-[10px] text-gray-400 font-bold py-6">No notes yet. Add one below.</p>
        )}
        {notes.map(note => (
          <div key={note.id} className="group bg-gray-50 rounded-lg p-2.5 border border-gray-100">
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
                <p className="text-[10px] font-bold text-gray-700 leading-relaxed">{note.text}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[8px] font-bold text-gray-400">
                    {note.author.split('@')[0]} • {new Date(note.createdAt).toLocaleDateString('en-GB')} {new Date(note.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    {note.updatedAt !== note.createdAt && ' (edited)'}
                  </span>
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button onClick={() => { setEditingId(note.id); setEditText(note.text); }} className="p-0.5 text-gray-300 hover:text-indigo-500"><Edit3 className="w-3 h-3" /></button>
                    <button onClick={() => handleDelete(note.id)} className="p-0.5 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-100 flex gap-2">
        <input
          ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Add a note..."
          className="flex-1 px-3 py-2 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
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
  );
};

export default OrderNotes;
