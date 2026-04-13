
import React, { useState, useEffect } from 'react';
import { 
    Save, Lock, AlertTriangle, Eye, EyeOff, X, Sliders, Globe, CheckSquare, Square, 
    Search, CalendarClock, Zap, Copy, Terminal, MonitorSmartphone, CheckCircle2, 
    Mail, Link as LinkIcon, ExternalLink, Calendar, Trash2, CalendarDays, Plus, 
    CalendarRange, Database, Server, Info, ShieldCheck, Code2, History, RefreshCw, Key,
    ShieldAlert, Truck
} from 'lucide-react';

export interface HolidayRange {
    id: string;
    start: string;
    end: string;
    label?: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentApiSettings: ApiSettings;
  currentExcludedTags: string[];
  availableTags: string[];
  onSave: (apiSettings: ApiSettings, excludedTags: string[]) => void;
  onTriggerFullSync?: () => void;
}

export interface ApiSettings {
  useLiveData: boolean;
  shopifyDomain: string;
  shopifyAccessToken: string;
  decoDomain: string;
  decoUsername: string;
  decoPassword: string;
  syncLookbackDays: number;
  connectionMethod?: string;
  googleClientId?: string;
  holidayRanges?: HolidayRange[];
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  autoRefreshInterval?: number;
  shipStationApiKey?: string;
  shipStationApiSecret?: string;
  qboRealmId?: string;
  qboAccessToken?: string;
  qboBaseUrl?: string;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, onClose, onSave, currentApiSettings, currentExcludedTags, availableTags, onTriggerFullSync
}) => {
  const [activeTab, setActiveTab] = useState<'preferences' | 'connections' | 'database'>('preferences');
  const [apiSettings, setApiSettings] = useState<ApiSettings>(({ ...currentApiSettings }));
  const [excludedTags, setExcludedTags] = useState<Set<string>>(new Set(currentExcludedTags));
  const [showSecrets, setShowSecrets] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [newRangeStart, setNewRangeStart] = useState('');
  const [newRangeEnd, setNewRangeEnd] = useState('');

  useEffect(() => {
    if (isOpen) {
      setApiSettings({ ...currentApiSettings });
      setExcludedTags(new Set(currentExcludedTags));
    }
  }, [isOpen, currentApiSettings, currentExcludedTags]);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SHOPIFY_AUTH_SUCCESS') {
        const { accessToken, shop } = event.data;
        setApiSettings(prev => ({
          ...prev,
          shopifyAccessToken: accessToken,
          shopifyDomain: shop,
          useLiveData: true
        }));
        alert(`Successfully connected to ${shop}!`);
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, []);

  if (!isOpen) return null;

  const handleShopifyConnect = async () => {
    if (!apiSettings.shopifyDomain) {
      alert("Please enter your Shopify store domain (e.g., store-name.myshopify.com) first.");
      return;
    }

    const cleanDomain = apiSettings.shopifyDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    try {
      const response = await fetch(`/api/auth/shopify/url?shop=${cleanDomain}`);
      const data = await response.json();
      
      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      window.open(
        data.url,
        'shopify_oauth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (error: any) {
      alert(`Failed to start authentication: ${error.message}`);
    }
  };

  const handleApiChange = (field: keyof ApiSettings, value: any) => {
    setApiSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(apiSettings, Array.from(excludedTags));
    onClose();
  };

  const sqlSetup = `-- SUPABASE SQL EDITOR SETUP
-- RUN ALL TO ENSURE ALL TABLES EXIST

CREATE TABLE IF NOT EXISTS stash_mappings (
    item_id TEXT PRIMARY KEY,
    deco_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stash_job_links (
    order_id TEXT PRIMARY KEY,
    job_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stash_orders (
    order_id TEXT PRIMARY KEY,
    order_number TEXT,
    order_data JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stash_stock (
    id TEXT PRIMARY KEY,
    ean TEXT,
    vendor TEXT,
    productCode TEXT,
    description TEXT,
    colour TEXT,
    size TEXT,
    quantity INTEGER,
    isEmbellished BOOLEAN,
    clubName TEXT,
    addedAt BIGINT
);

CREATE TABLE IF NOT EXISTS stash_returns (
    id TEXT PRIMARY KEY,
    orderNumber TEXT,
    itemName TEXT,
    sku TEXT,
    quantity INTEGER,
    addedAt BIGINT
);

CREATE TABLE IF NOT EXISTS stash_reference_products (
    ean TEXT PRIMARY KEY,
    vendor TEXT,
    productCode TEXT,
    description TEXT,
    colour TEXT,
    size TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ENABLE RLS & POLICIES
ALTER TABLE stash_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_mappings FOR ALL USING (true);

ALTER TABLE stash_job_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_job_links FOR ALL USING (true);

ALTER TABLE stash_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_orders FOR ALL USING (true);

ALTER TABLE stash_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_stock FOR ALL USING (true);

ALTER TABLE stash_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_returns FOR ALL USING (true);

ALTER TABLE stash_reference_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_reference_products FOR ALL USING (true);`;

  return (
    <div 
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-indigo-900 uppercase tracking-widest">Global Configuration</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex border-b border-gray-200 bg-gray-50">
            {['preferences', 'connections', 'database'].map((tab) => (
                <button 
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-center border-b-2 transition-all ${
                        activeTab === tab ? 'border-indigo-600 text-indigo-600 bg-white shadow-inner' : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                >
                    {tab === 'database' && <Database className="w-3 h-3 inline-block mr-1.5 mb-0.5" />}
                    {tab}
                </button>
            ))}
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-10">
          
          {activeTab === 'preferences' && (
              <div className="space-y-10 animate-in fade-in duration-300">
                  <div className="bg-slate-900 p-6 rounded-2xl shadow-xl border-b-4 border-indigo-500 text-white">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <History className="w-5 h-5 text-indigo-400" />
                            <h3 className="text-sm font-bold uppercase tracking-widest text-white">Sync Configuration</h3>
                        </div>
                        <span className="text-[10px] font-black uppercase bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/30">freshness filter</span>
                      </div>
                      
                      <div className="space-y-4">
                          <div>
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1.5 block">Historical Lookback (Days)</label>
                              <div className="flex gap-3">
                                  <input 
                                      type="number" 
                                      value={apiSettings.syncLookbackDays || 365} 
                                      onChange={e => handleApiChange('syncLookbackDays', parseInt(e.target.value) || 0)} 
                                      className="w-24 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm font-black text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500" 
                                  />
                                  <div className="flex-1 flex gap-1 bg-slate-800/50 p-1 rounded-xl border border-slate-700 overflow-x-auto">
                                      {[30, 90, 180, 365, 730].map(days => (
                                          <button 
                                              key={days}
                                              onClick={() => handleApiChange('syncLookbackDays', days)}
                                              className={`flex-1 min-w-[40px] py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-all ${apiSettings.syncLookbackDays === days ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                          >
                                              {days === 365 ? '1YR' : days >= 365 ? `${Math.floor(days/365)}Y` : `${days}d`}
                                          </button>
                                      ))}
                                  </div>
                              </div>
                          </div>
                          
                          <div>
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1.5 block">Auto-Refresh Interval (Minutes)</label>
                              <div className="flex gap-3">
                                  <input 
                                      type="number" 
                                      min="0"
                                      value={apiSettings.autoRefreshInterval ?? 0} 
                                      onChange={e => handleApiChange('autoRefreshInterval', parseInt(e.target.value) || 0)} 
                                      className="w-24 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm font-black text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500" 
                                  />
                                  <div className="flex-1 flex gap-1 bg-slate-800/50 p-1 rounded-xl border border-slate-700 overflow-x-auto">
                                      {[0, 2, 5, 10, 15, 30, 60].map(mins => (
                                          <button 
                                              key={mins}
                                              onClick={() => handleApiChange('autoRefreshInterval', mins)}
                                              className={`flex-1 min-w-[40px] py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-all ${(apiSettings.autoRefreshInterval ?? 0) === mins ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                          >
                                              {mins === 0 ? 'OFF' : `${mins}m`}
                                          </button>
                                      ))}
                                  </div>
                              </div>
                          </div>

                          <div className="flex items-start gap-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                              <Info className="w-5 h-5 text-indigo-400 shrink-0" />
                              <p className="text-[9px] text-indigo-200/70 font-bold uppercase leading-relaxed">
                                  Lookback is currently set to <span className="text-white italic">{apiSettings.syncLookbackDays} days</span>. Auto-refresh {apiSettings.autoRefreshInterval ? <>performs a delta sync every <span className="text-white italic">{apiSettings.autoRefreshInterval} minutes</span></> : <span className="text-white italic">is OFF</span>}. Set to 0 to disable.
                              </p>
                          </div>
                      </div>
                  </div>

                   <div className="bg-indigo-900 text-white p-6 rounded-2xl shadow-xl border-b-4 border-indigo-500">
                      <div className="flex items-center gap-2 mb-4">
                          <CalendarRange className="w-5 h-5 text-indigo-400" />
                          <h3 className="text-sm font-bold uppercase tracking-widest">Business Closures</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="space-y-1">
                              <label className="text-[9px] font-black uppercase text-indigo-400">Start Date</label>
                              <input type="date" value={newRangeStart} onChange={e => setNewRangeStart(e.target.value)} className="w-full bg-indigo-950 border border-indigo-700 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                          </div>
                          <div className="space-y-1">
                              <label className="text-[9px] font-black uppercase text-indigo-400">End Date</label>
                              <input type="date" value={newRangeEnd} onChange={e => setNewRangeEnd(e.target.value)} className="w-full bg-indigo-950 border border-indigo-700 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                          </div>
                      </div>
                      <button onClick={() => {
                          if(!newRangeStart || !newRangeEnd) return;
                          const newRange = { id: Math.random().toString(36).substr(2, 9), start: newRangeStart, end: newRangeEnd };
                          handleApiChange('holidayRanges', [...(apiSettings.holidayRanges || []), newRange]);
                          setNewRangeStart(''); setNewRangeEnd('');
                      }} className="w-full bg-indigo-500 hover:bg-indigo-400 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg"><Plus className="w-4 h-4" /> Add Closure Range</button>
                      <div className="mt-6 space-y-2">
                          {(apiSettings.holidayRanges || []).map(r => (
                              <div key={r.id} className="flex items-center justify-between bg-indigo-950/50 p-3 rounded-xl border border-indigo-800">
                                  <span className="text-[10px] font-bold font-mono text-indigo-200">{r.start} — {r.end}</span>
                                  <button onClick={() => handleApiChange('holidayRanges', apiSettings.holidayRanges?.filter(x => x.id !== r.id))} className="text-indigo-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                              </div>
                          ))}
                      </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl shadow-xl border-b-4 border-slate-200">
                     <div className="flex items-center justify-between mb-4">
                       <div className="flex items-center gap-2">
                           <CheckSquare className="w-5 h-5 text-indigo-600" />
                           <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900">Tag Visibility</h3>
                       </div>
                       <span className="text-[10px] font-black uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">Exclusion List</span>
                     </div>
                     
                     <div className="space-y-4">
                         <div className="relative">
                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                             <input 
                                 type="text" 
                                 value={tagSearch} 
                                 onChange={e => setTagSearch(e.target.value)} 
                                 placeholder="Search tags to exclude..." 
                                 className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                             />
                         </div>
                         
                         <div className="max-h-48 overflow-y-auto space-y-1 pr-2 scrollbar-hide">
                             {availableTags
                               .filter(tag => tag.toLowerCase().includes(tagSearch.toLowerCase()))
                               .map(tag => (
                                 <button 
                                     key={tag}
                                     onClick={() => {
                                         const next = new Set(excludedTags);
                                         if (next.has(tag)) next.delete(tag);
                                         else next.add(tag);
                                         setExcludedTags(next);
                                     }}
                                     className={`w-full flex items-center justify-between p-2 rounded-lg text-[10px] font-bold uppercase transition-all ${excludedTags.has(tag) ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-slate-50 text-slate-600 border border-slate-100 hover:bg-slate-100'}`}
                                 >
                                     <span>{tag}</span>
                                     {excludedTags.has(tag) ? <Square className="w-4 h-4 fill-red-500 text-red-500" /> : <CheckSquare className="w-4 h-4 text-slate-300" />}
                                 </button>
                             ))}
                         </div>
                         
                         <p className="text-[9px] text-slate-400 font-bold uppercase italic">
                             * Selected tags will be hidden from the main dashboard and filters.
                         </p>
                     </div>
                 </div>
              </div>
          )}

          {activeTab === 'connections' && (
              <div className="space-y-6">
                   <div className="flex items-center justify-between bg-indigo-900 text-white p-5 rounded-2xl shadow-xl">
                        <div>
                            <h3 className="font-bold text-sm uppercase tracking-widest">Live Engine Mode</h3>
                            <p className="text-[9px] text-indigo-300 uppercase font-bold tracking-tighter mt-1">Disconnect from Demo data and use Real-Time APIs</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={apiSettings.useLiveData} onChange={e => handleApiChange('useLiveData', e.target.checked)} className="sr-only peer" />
                            <div className="w-11 h-6 bg-indigo-950 rounded-full peer peer-checked:bg-emerald-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all border border-indigo-800"></div>
                        </label>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                             <h4 className="text-[10px] font-black uppercase text-indigo-900 tracking-widest flex items-center gap-2"><Globe className="w-4 h-4" /> Shopify Store</h4>
                             <div className="space-y-3">
                                 <input type="text" value={apiSettings.shopifyDomain} onChange={e => handleApiChange('shopifyDomain', e.target.value)} placeholder="Store Domain" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                 <input type={showSecrets ? "text" : "password"} value={apiSettings.shopifyAccessToken} onChange={e => handleApiChange('shopifyAccessToken', e.target.value)} placeholder="Access Token" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                             </div>
                        </div>
                        <div className="space-y-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                             <h4 className="text-[10px] font-black uppercase text-indigo-900 tracking-widest flex items-center gap-2"><Server className="w-4 h-4" /> DecoNetwork</h4>
                             <div className="space-y-3">
                                 <input type="text" value={apiSettings.decoDomain} onChange={e => handleApiChange('decoDomain', e.target.value)} placeholder="Hub Domain" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                 <input type="text" value={apiSettings.decoUsername} onChange={e => handleApiChange('decoUsername', e.target.value)} placeholder="Username" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                 <input type={showSecrets ? "text" : "password"} value={apiSettings.decoPassword} onChange={e => handleApiChange('decoPassword', e.target.value)} placeholder="Password" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                             </div>
                        </div>
                   </div>
                   <div className="space-y-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                        <h4 className="text-[10px] font-black uppercase text-indigo-900 tracking-widest flex items-center gap-2"><Truck className="w-4 h-4" /> ShipStation</h4>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Pull tracking & carrier data from ShipStation automatically</p>
                        <div className="space-y-3">
                            <input type={showSecrets ? "text" : "password"} value={apiSettings.shipStationApiKey || ''} onChange={e => handleApiChange('shipStationApiKey', e.target.value)} placeholder="API Key" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                            <input type={showSecrets ? "text" : "password"} value={apiSettings.shipStationApiSecret || ''} onChange={e => handleApiChange('shipStationApiSecret', e.target.value)} placeholder="API Secret" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                   </div>
                   <div className="space-y-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                        <h4 className="text-[10px] font-black uppercase text-indigo-900 tracking-widest flex items-center gap-2">📒 QuickBooks Online</h4>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Pull A/P aging, A/R balances, and customer credits from QuickBooks</p>
                        <div className="space-y-3">
                            <input type="text" value={apiSettings.qboRealmId || ''} onChange={e => handleApiChange('qboRealmId', e.target.value)} placeholder="Company ID (Realm ID)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                            <input type={showSecrets ? "text" : "password"} value={apiSettings.qboAccessToken || ''} onChange={e => handleApiChange('qboAccessToken', e.target.value)} placeholder="OAuth Access Token" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                            <input type="text" value={apiSettings.qboBaseUrl || ''} onChange={e => handleApiChange('qboBaseUrl', e.target.value)} placeholder="Base URL (default: https://quickbooks.api.intuit.com)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                   </div>
                   <button onClick={() => setShowSecrets(!showSecrets)} className="text-[9px] font-black uppercase text-indigo-600 hover:text-indigo-800 tracking-widest flex items-center gap-1">{showSecrets ? <EyeOff className="w-3 h-3"/> : <Eye className="w-3 h-3"/>} {showSecrets ? 'Hide Passwords' : 'Reveal Secrets'}</button>
              </div>
          )}

          {activeTab === 'database' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                   <div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-xl flex items-center justify-between overflow-hidden relative">
                        <div className="absolute right-0 top-0 p-4 opacity-10 rotate-12"><Database className="w-32 h-32" /></div>
                        <div className="relative z-10 max-w-sm">
                             <h3 className="text-sm font-black uppercase tracking-[0.2em] mb-2 flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Cloud Persistence</h3>
                             <p className="text-[10px] font-bold uppercase text-emerald-100 leading-relaxed">Ensure orders and mappings are synced across your team. Historical data stays safe here even if your Shopify token limits real-time history.</p>
                        </div>
                        <a href="https://supabase.com" target="_blank" className="relative z-10 px-6 py-3 bg-white text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:scale-105 transition-all">Get Free DB</a>
                   </div>

                   <div className="grid grid-cols-1 gap-6">
                        <div className="bg-indigo-50 border-l-4 border-indigo-500 p-5 rounded-r-2xl">
                             <div className="flex items-center gap-2 text-indigo-900 font-black uppercase tracking-widest text-xs mb-2">
                                <ShieldAlert className="w-5 h-5" /> Shopify 365-Day Requirement
                             </div>
                             <p className="text-[10px] text-indigo-700 font-bold uppercase leading-relaxed">
                                To sync a full 365-day archive, you <span className="underline italic">must</span> check the <span className="font-black text-indigo-900">"Read all orders"</span> box in your Shopify App configuration. 
                             </p>
                        </div>

                        <div className="space-y-4 p-6 bg-slate-900 text-white rounded-2xl border-b-4 border-emerald-500 shadow-2xl">
                             <div className="flex items-center justify-between mb-4">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Database Credentials</h4>
                                <Database className="w-5 h-5 text-emerald-500/50" />
                             </div>
                             <div className="space-y-4">
                                 <div className="space-y-1">
                                     <label className="text-[8px] font-black uppercase text-slate-500 tracking-widest">Project API URL</label>
                                     <input type="text" value={apiSettings.supabaseUrl || ''} onChange={e => handleApiChange('supabaseUrl', e.target.value)} placeholder="https://abc.supabase.co" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-xs font-mono text-emerald-400 outline-none focus:ring-2 focus:ring-emerald-500" />
                                 </div>
                                 <div className="space-y-1">
                                     <label className="text-[8px] font-black uppercase text-slate-500 tracking-widest">Publishable Key (Anon)</label>
                                     <input type={showSecrets ? "text" : "password"} value={apiSettings.supabaseAnonKey || ''} onChange={e => handleApiChange('supabaseAnonKey', e.target.value)} placeholder="sb_publishable_..." className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-xs font-mono text-emerald-400 outline-none focus:ring-2 focus:ring-emerald-500" />
                                 </div>
                             </div>
                        </div>

                        <div className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl">
                             <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4 flex items-center gap-2"><Code2 className="w-4 h-4" /> Setup Code (Run in SQL Editor)</h4>
                             <div className="relative group">
                                 <pre className="bg-slate-800 text-slate-300 p-5 rounded-xl text-[9px] font-mono h-40 overflow-y-auto select-all">{sqlSetup}</pre>
                                 <button onClick={() => {navigator.clipboard.writeText(sqlSetup); alert("SQL Copied!");}} className="absolute top-3 right-3 bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 shadow-xl"><Copy className="w-4 h-4" /></button>
                             </div>
                        </div>
                   </div>
              </div>
          )}

        </div>

        <div className="px-8 py-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
            <button onClick={onClose} className="px-6 py-2 text-xs font-black uppercase text-slate-500 tracking-widest hover:text-slate-800 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-10 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-[0.2em] shadow-xl hover:bg-indigo-700 transition-all hover:scale-105 flex items-center gap-2"><Save className="w-5 h-5" /> Save Configuration</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;