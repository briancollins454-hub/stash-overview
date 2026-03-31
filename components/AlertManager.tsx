import React, { useState, useMemo } from 'react';
import { AlertRule, AlertEvent, loadAlertRules, saveAlertRules, loadAlertEvents } from '../services/alertService';
import { Bell, BellOff, Plus, Trash2, Save, Clock, CheckCircle2, X, AlertTriangle, MessageSquare, Mail } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const AlertManager: React.FC<Props> = ({ isOpen, onClose }) => {
  const [rules, setRules] = useState<AlertRule[]>(() => loadAlertRules());
  const [events] = useState<AlertEvent[]>(() => loadAlertEvents());
  const [tab, setTab] = useState<'rules' | 'history'>('rules');
  const [editingRule, setEditingRule] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    saveAlertRules(rules);
  };

  const toggleRule = (id: string) => {
    setRules(prev => {
      const next = prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
      saveAlertRules(next);
      return next;
    });
  };

  const updateRule = (id: string, updates: Partial<AlertRule>) => {
    setRules(prev => {
      const next = prev.map(r => r.id === id ? { ...r, ...updates } : r);
      return next;
    });
  };

  const addRule = () => {
    const newRule: AlertRule = {
      id: `custom-${Date.now()}`,
      name: 'New Alert Rule',
      type: 'custom',
      enabled: false,
      cooldownMinutes: 60,
    };
    setRules(prev => [...prev, newRule]);
    setEditingRule(newRule.id);
  };

  const deleteRule = (id: string) => {
    setRules(prev => {
      const next = prev.filter(r => r.id !== id);
      saveAlertRules(next);
      return next;
    });
  };

  const channelIcon = (channel: string) => {
    if (channel === 'slack') return <MessageSquare className="w-3 h-3 text-purple-500" />;
    if (channel === 'email') return <Mail className="w-3 h-3 text-blue-500" />;
    return <Bell className="w-3 h-3 text-gray-500" />;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-500" />
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-800">Alert Manager</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          <button onClick={() => setTab('rules')} className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors ${tab === 'rules' ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Rules</button>
          <button onClick={() => setTab('history')} className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors ${tab === 'history' ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>History ({events.length})</button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {tab === 'rules' && (
            <div className="space-y-3">
              {rules.map(rule => (
                <div key={rule.id} className={`border rounded-xl p-4 transition-all ${rule.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleRule(rule.id)} className={`p-1 rounded ${rule.enabled ? 'text-indigo-500' : 'text-gray-300'}`}>
                        {rule.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                      </button>
                      <div>
                        {editingRule === rule.id ? (
                          <input
                            value={rule.name}
                            onChange={e => updateRule(rule.id, { name: e.target.value })}
                            onBlur={() => setEditingRule(null)}
                            className="text-xs font-bold border border-indigo-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none w-full"
                            autoFocus
                          />
                        ) : (
                          <span className="text-xs font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onClick={() => setEditingRule(rule.id)}>{rule.name}</span>
                        )}
                        <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">
                          {rule.type} • Cooldown: {rule.cooldownMinutes}min
                          {rule.lastTriggered && ` • Last: ${new Date(rule.lastTriggered).toLocaleString()}`}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => deleteRule(rule.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>

                  {editingRule === rule.id && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 animate-in slide-in-from-top-1">
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Slack Webhook URL</label>
                        <input value={rule.webhookUrl || ''} onChange={e => updateRule(rule.id, { webhookUrl: e.target.value })} placeholder="https://hooks.slack.com/services/..." className="w-full mt-1 px-3 py-1.5 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Email To</label>
                        <input value={rule.emailTo || ''} onChange={e => updateRule(rule.id, { emailTo: e.target.value })} placeholder="team@example.com" className="w-full mt-1 px-3 py-1.5 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Cooldown (min)</label>
                          <input type="number" value={rule.cooldownMinutes} onChange={e => updateRule(rule.id, { cooldownMinutes: Number(e.target.value) })} className="w-full mt-1 px-3 py-1.5 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
                        </div>
                        {rule.threshold !== undefined && (
                          <div className="flex-1">
                            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Threshold</label>
                            <input type="number" value={rule.threshold} onChange={e => updateRule(rule.id, { threshold: Number(e.target.value) })} className="w-full mt-1 px-3 py-1.5 text-[10px] font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <div className="flex gap-2 pt-2">
                <button onClick={addRule} className="flex-1 px-4 py-2 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold text-gray-400 hover:text-indigo-500 hover:border-indigo-300 transition-colors flex items-center justify-center gap-1">
                  <Plus className="w-3 h-3" /> Add Rule
                </button>
                <button onClick={handleSave} className="px-6 py-2 bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors flex items-center gap-1">
                  <Save className="w-3 h-3" /> Save Rules
                </button>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              {events.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Clock className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-xs font-bold uppercase tracking-widest">No alert history yet</p>
                </div>
              ) : (
                events.map(event => (
                  <div key={event.id} className="flex items-center gap-3 px-3 py-2 border border-gray-100 rounded-lg">
                    {channelIcon(event.channel)}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-gray-700 truncate">{event.message}</p>
                      <p className="text-[9px] text-gray-400">{event.ruleName} • {new Date(event.timestamp).toLocaleString()}</p>
                    </div>
                    {event.delivered ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertManager;
