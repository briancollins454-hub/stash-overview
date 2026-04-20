
import React, { useState, useEffect } from 'react';
import { 
    ArrowRight, Database, MonitorSmartphone, TerminalSquare, FileCode2, Award, 
    Sparkles, Rocket, History, Layout, PlusCircle, Check, Copy, Trash2, 
    Save, MousePointer2, ExternalLink, AlertTriangle, HelpCircle, 
    CheckCircle2, Box, Wand2, Info, StepForward, AlertOctagon, Bot, Wrench,
    Search, LifeBuoy, Activity, Globe, ShieldAlert, Edit3, Server, Globe2,
    ShoppingBag, Cpu, StepBack, X, Zap, AlertCircle, ShieldCheck
} from 'lucide-react';

interface IntegrationGuideProps {
    onComplete?: () => void;
}

const IntegrationGuide: React.FC<IntegrationGuideProps> = ({ onComplete }) => {
  const [activeStep, setActiveStep] = useState(5); 
  const [copied, setCopied] = useState<string | null>(null);
  
  const [urlMode, setUrlMode] = useState<'standard' | 'full_path' | 'naked'>('standard');
  const [manualOverride, setManualOverride] = useState('');
  const [detectedBase, setDetectedBase] = useState('');

  useEffect(() => {
    const loc = window.location;
    const pathSegments = loc.pathname.split('/');
    pathSegments.pop(); 
    const cleanPath = pathSegments.join('/');
    
    const result = `${loc.origin}${cleanPath}`.replace(/\/$/, '');
    setDetectedBase(result);
    setManualOverride(result);
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const steps = [
    { id: 1, title: "Prerequisites", icon: <MonitorSmartphone className="w-4 h-4" /> },
    { id: 2, title: "Extension Setup", icon: <TerminalSquare className="w-4 h-4" /> },
    { id: 3, title: "Database", icon: <Database className="w-4 h-4" /> },
    { id: 4, title: "The Bridge Code", icon: <FileCode2 className="w-4 h-4" /> },
    { id: 5, title: "Final Step: URLs", icon: <Award className="w-4 h-4" /> }
  ];

  const getConstructedUrl = () => {
      const base = manualOverride || detectedBase;
      switch(urlMode) {
          case 'full_path': return `${base}/index.html`;
          case 'naked': return window.location.origin;
          case 'standard': 
          default: return base;
      }
  };

  const currentAppUrl = getConstructedUrl();
  const currentRedirectUrl = `${manualOverride || detectedBase}/api/auth`;

  const sqlCode = `-- Table for Shopify Order Data Cache
CREATE TABLE IF NOT EXISTS stash_orders (
    order_id TEXT PRIMARY KEY,
    order_number TEXT,
    order_data JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Manual Item Mappings
CREATE TABLE IF NOT EXISTS stash_mappings (
    item_id TEXT PRIMARY KEY,
    deco_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Job Links (Order to Deco Job)
CREATE TABLE IF NOT EXISTS stash_job_links (
    order_id TEXT PRIMARY KEY,
    job_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Physical Stock
CREATE TABLE IF NOT EXISTS stash_stock (
    id TEXT PRIMARY KEY,
    ean TEXT,
    name TEXT,
    sku TEXT,
    quantity INTEGER,
    location TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Return Stock
CREATE TABLE IF NOT EXISTS stash_returns (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    customer_name TEXT,
    reason TEXT,
    items JSONB,
    status TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Reference Products (Master Data)
CREATE TABLE IF NOT EXISTS stash_reference_products (
    ean TEXT PRIMARY KEY,
    name TEXT,
    sku TEXT,
    brand TEXT,
    category TEXT,
    image_url TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Learned Product Patterns
CREATE TABLE IF NOT EXISTS stash_product_patterns (
    shopify_pattern TEXT PRIMARY KEY,
    deco_pattern TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Realtime on key tables for live cross-device sync
ALTER PUBLICATION supabase_realtime ADD TABLE stash_mappings;
ALTER PUBLICATION supabase_realtime ADD TABLE stash_job_links;
ALTER PUBLICATION supabase_realtime ADD TABLE stash_product_patterns;
ALTER PUBLICATION supabase_realtime ADD TABLE stash_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE stash_deco_jobs;`;

  return (
    <div className="max-w-5xl mx-auto pb-24 space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="bg-indigo-950 rounded-2xl p-8 text-white shadow-2xl relative overflow-hidden border-b-4 border-indigo-500">
        <div className="absolute top-0 right-0 p-10 opacity-10 rotate-12">
            <Sparkles className="w-40 h-40" />
        </div>
        <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
                <div className="bg-emerald-500 p-2 rounded-lg text-white">
                    <Rocket className="w-6 h-6" />
                </div>
                <h2 className="text-3xl font-black uppercase tracking-widest text-white">Final Sync Configuration</h2>
            </div>
            <p className="text-emerald-300 font-bold uppercase tracking-widest text-[10px] opacity-80 max-w-xl leading-relaxed flex items-center gap-2">
                <ShieldAlert className="w-3 h-3" /> Fix: <span className="text-white font-black italic underline">The "Broken Robot" Error Resolution</span>
            </p>
        </div>
        
        <div className="mt-10 flex flex-wrap gap-2">
            {steps.map((s) => (
                <button 
                    key={s.id}
                    onClick={() => setActiveStep(s.id)}
                    className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${activeStep === s.id ? 'bg-white text-indigo-900 border-white shadow-lg scale-105 font-black' : 'bg-indigo-900/40 border-indigo-800 text-indigo-400 font-bold hover:bg-indigo-800/60'}`}
                >
                    {s.icon}
                    <span className="uppercase tracking-widest text-[9px]">{s.id}. {s.title}</span>
                </button>
            ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden min-h-[650px] flex flex-col md:flex-row">
        
        {/* Left Sidebar */}
        <div className="w-full md:w-72 bg-slate-900 p-6 text-slate-400 border-r border-slate-800 flex flex-col justify-between">
            <div className="space-y-6">
                <div className="p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                    <div className="flex items-center gap-2 text-indigo-400 mb-3">
                        <Globe2 className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Permanent Fix</span>
                    </div>
                    <p className="text-[10px] text-slate-300 font-bold uppercase leading-relaxed mb-3">
                        Deploying to a <span className="text-white italic">Static URL</span> (like Vercel) is highly recommended.
                    </p>
                    <p className="text-[9px] text-slate-500 uppercase italic font-bold">
                        It removes directory errors and provides a consistent domain for Shopify.
                    </p>
                </div>

                <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <div className="flex items-center gap-2 text-amber-400 mb-2">
                        <HelpCircle className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">What's a Naked URL?</span>
                    </div>
                    <p className="text-[9px] text-slate-400 font-bold uppercase leading-tight tracking-tight">
                        Just the domain name (e.g. your-app.com). Try this if standard links still show a robot inside Shopify.
                    </p>
                </div>
            </div>

            <div className="pt-8 border-t border-slate-800">
                 <button onClick={onComplete} className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[10px] font-black uppercase tracking-widest border border-white/10 transition-all">
                    Skip Guide
                 </button>
            </div>
        </div>

        {/* Right Area */}
        <div className="flex-1 p-10 bg-gray-50/30 overflow-y-auto">
            {activeStep === 1 && (
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                    <div className="bg-white border-2 border-indigo-100 rounded-3xl p-10 shadow-2xl">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="bg-emerald-100 p-4 rounded-2xl text-emerald-600">
                                <ShoppingBag className="w-8 h-8" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Shopify API Setup</h2>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Connect your store data</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div className="flex gap-4">
                                    <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-xs font-black shrink-0">1</div>
                                    <p className="text-[11px] font-bold text-slate-600 uppercase leading-relaxed">
                                        Go to <span className="text-indigo-600 font-black underline">Settings &gt; Apps and sales channels</span> in your Shopify admin.
                                    </p>
                                </div>
                                <div className="flex gap-4">
                                    <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-xs font-black shrink-0">2</div>
                                    <p className="text-[11px] font-bold text-slate-600 uppercase leading-relaxed">
                                        Click <span className="text-indigo-600 font-black underline">Develop apps</span> and create a new app named "Sync Master".
                                    </p>
                                </div>
                                <div className="flex gap-4">
                                    <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-xs font-black shrink-0">3</div>
                                    <p className="text-[11px] font-bold text-slate-600 uppercase leading-relaxed">
                                        Configure <span className="text-indigo-600 font-black underline">Admin API scopes</span>: read_orders, read_products, write_orders.
                                    </p>
                                </div>
                            </div>
                            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-100">
                                <div className="flex items-center gap-3 mb-4">
                                    <AlertCircle className="w-5 h-5 text-indigo-600" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-900">Pro Tip</h4>
                                </div>
                                <p className="text-[10px] font-bold text-slate-500 uppercase leading-relaxed">
                                    Make sure to save your Access Token immediately after generating it. Shopify only shows it once for security reasons.
                                </p>
                            </div>
                        </div>

                        <div className="mt-12 pt-8 border-t border-slate-100 flex justify-end">
                            <button 
                                onClick={() => setActiveStep(2)}
                                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2"
                            >
                                Next Step <StepForward className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeStep === 2 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white border-2 border-indigo-100 rounded-3xl p-10 shadow-2xl">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="bg-indigo-100 p-4 rounded-2xl text-indigo-600">
                                <Cpu className="w-8 h-8" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">DecoNetwork Integration</h2>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Connect your production engine</p>
                            </div>
                        </div>

                        <div className="space-y-8">
                            <div className="bg-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
                                <div className="absolute right-0 top-0 p-4 opacity-10">
                                    <ShieldCheck className="w-20 h-20" />
                                </div>
                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-4">Security Requirement</h4>
                                <p className="text-xs font-bold uppercase leading-relaxed mb-6">
                                    You must enable the <span className="text-indigo-400">External API</span> in your DecoNetwork settings under <span className="underline">Manage &gt; Settings &gt; API</span>.
                                </p>
                                <div className="flex items-center gap-4">
                                    <div className="px-4 py-2 bg-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest">API Key Required</div>
                                    <div className="px-4 py-2 bg-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest">Store URL Required</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="p-6 bg-indigo-50 rounded-2xl border border-indigo-100">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-900 mb-2">Finding your Store URL</h4>
                                    <p className="text-[10px] font-bold text-indigo-700 uppercase leading-relaxed">
                                        Use the full URL including https:// (e.g., https://yourstore.deconetwork.com). Do not include a trailing slash.
                                    </p>
                                </div>
                                <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-900 mb-2">API Permissions</h4>
                                    <p className="text-[10px] font-bold text-emerald-700 uppercase leading-relaxed">
                                        Ensure your API user has permissions to view orders, view products, and manage production jobs.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-12 pt-8 border-t border-slate-100 flex justify-between">
                            <button 
                                onClick={() => setActiveStep(1)}
                                className="px-8 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2"
                            >
                                <StepBack className="w-4 h-4" /> Previous
                            </button>
                            <button 
                                onClick={() => setActiveStep(3)}
                                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2"
                            >
                                Next Step <StepForward className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeStep === 3 && (
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                    <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl flex items-center justify-between group overflow-hidden relative">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                             <Database className="w-24 h-24" />
                        </div>
                        <div className="relative z-10 max-w-md">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 bg-emerald-500 rounded text-[8px] font-black uppercase tracking-widest">Required</span>
                                <h3 className="text-sm font-black uppercase tracking-widest">Supabase Database Setup</h3>
                            </div>
                            <p className="text-[10px] font-bold text-indigo-100 uppercase leading-relaxed">
                                To persist mappings and stock data, you need to create the following tables in your Supabase project.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white border-2 border-indigo-100 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="bg-indigo-600 p-2 rounded-lg text-white">
                                <TerminalSquare className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-indigo-900 uppercase tracking-widest">SQL Editor Instructions</h3>
                                <p className="text-[10px] text-indigo-400 font-bold uppercase">Run this in your Supabase SQL Editor</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <p className="text-xs text-slate-600 font-bold leading-relaxed">
                                1. Go to your <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Supabase Dashboard</a>.<br/>
                                2. Select your project and click on the <strong>SQL Editor</strong> in the left sidebar.<br/>
                                3. Click <strong>New Query</strong> and paste the following SQL code:<br/>
                            </p>
                            
                            <div className="relative group">
                                <pre className="bg-slate-900 text-emerald-400 p-6 rounded-2xl font-mono text-[10px] overflow-x-auto max-h-[400px] shadow-2xl border border-slate-800">
                                    {sqlCode}
                                </pre>
                                <button 
                                    onClick={() => handleCopy(sqlCode, 'sql')}
                                    className="absolute top-4 right-4 bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-500 transition-colors shadow-lg flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                                >
                                    {copied === 'sql' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    {copied === 'sql' ? 'Copied' : 'Copy SQL'}
                                </button>
                            </div>
                        </div>

                        <div className="pt-8 border-t border-slate-100 flex justify-between">
                            <button 
                                onClick={() => setActiveStep(2)}
                                className="px-8 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2"
                            >
                                <StepBack className="w-4 h-4" /> Previous
                            </button>
                            <button 
                                onClick={() => setActiveStep(4)}
                                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2"
                            >
                                Next Step <StepForward className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeStep === 4 && (
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                    <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl flex items-center justify-between group overflow-hidden relative">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                             <Server className="w-24 h-24" />
                        </div>
                        <div className="relative z-10 max-w-md">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 bg-emerald-500 rounded text-[8px] font-black uppercase tracking-widest">Recommended</span>
                                <h3 className="text-sm font-black uppercase tracking-widest">Switch to Static Deployment?</h3>
                            </div>
                            <p className="text-[10px] font-bold text-indigo-100 uppercase leading-relaxed">
                                Deploying this code to <span className="text-white underline italic font-black">Vercel</span> or <span className="text-white underline italic font-black">Netlify</span> gives you a single, stable link. This solves the "Robot" 404 error forever.
                            </p>
                        </div>
                        <button 
                            onClick={() => window.open('https://vercel.com/new', '_blank')}
                            className="relative z-10 px-4 py-2 bg-white text-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-indigo-50 transition-all shrink-0"
                        >
                            Explore Vercel
                        </button>
                    </div>

                    <div className="bg-white border-2 border-indigo-100 rounded-3xl shadow-2xl overflow-hidden">
                        <div className="bg-indigo-50 px-8 py-6 border-b border-indigo-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="bg-indigo-600 p-2 rounded-lg text-white">
                                    <Wand2 className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-indigo-900 uppercase tracking-widest">Current Link Lab</h3>
                                    <p className="text-[10px] text-indigo-400 font-bold uppercase">Troubleshooting temporary preview paths</p>
                                </div>
                            </div>
                            
                            <div className="flex bg-white rounded-xl p-1 border border-indigo-200 shadow-sm shrink-0">
                                <button 
                                    onClick={() => setUrlMode('standard')}
                                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${urlMode === 'standard' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                                > Standard </button>
                                <button 
                                    onClick={() => setUrlMode('full_path')}
                                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${urlMode === 'full_path' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                                > /index.html </button>
                                <button 
                                    onClick={() => setUrlMode('naked')}
                                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${urlMode === 'naked' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                                > Naked </button>
                            </div>
                        </div>
                        
                        <div className="p-8 space-y-8">
                            <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl flex flex-col md:flex-row items-center gap-6">
                                <div className="bg-emerald-600 text-white p-4 rounded-2xl shadow-lg shrink-0">
                                    <Activity className="w-10 h-10" />
                                </div>
                                <div className="flex-1 text-center md:text-left">
                                    <h4 className="text-sm font-black text-emerald-900 uppercase tracking-widest mb-1">Verify Link Protocol</h4>
                                    <p className="text-[10px] text-emerald-700 font-bold uppercase leading-relaxed mb-4">
                                        Click the button. If it loads the dashboard in a new tab, <span className="underline italic">that specific URL mode</span> is what Shopify needs.
                                    </p>
                                    <a 
                                        href={currentAppUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-3 px-8 py-3 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-[0.2em] hover:bg-emerald-700 transition-all shadow-xl active:scale-95"
                                    >
                                        <ExternalLink className="w-5 h-5" /> Open Test Link
                                    </a>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                                <div className="flex items-center gap-2 mb-3">
                                    <Edit3 className="w-4 h-4 text-slate-400" />
                                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Manual URL Override (Optional)</span>
                                </div>
                                <input 
                                    type="text" 
                                    value={manualOverride}
                                    onChange={(e) => setManualOverride(e.target.value)}
                                    placeholder="Paste exactly what you see in your browser bar..."
                                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-inner"
                                />
                            </div>

                            <div className="pt-8 border-t border-slate-100 flex justify-between">
                                <button 
                                    onClick={() => setActiveStep(3)}
                                    className="px-8 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2"
                                >
                                    <StepBack className="w-4 h-4" /> Previous
                                </button>
                                <button 
                                    onClick={() => setActiveStep(5)}
                                    className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2"
                                >
                                    Next Step <StepForward className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeStep === 5 && (
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                    <div className="bg-white border-2 border-indigo-100 rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-8 space-y-8">
                            <div className="grid grid-cols-1 gap-6">
                                <div className="space-y-3">
                                    <div className="text-xs text-slate-700 font-black uppercase tracking-widest flex items-center gap-3">
                                        <div className="w-6 h-6 bg-indigo-600 text-white rounded-lg flex items-center justify-center text-[10px]">1</div>
                                        App URL (Shopify URLs section)
                                    </div>
                                    <div className="flex gap-2">
                                        <code className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-4 text-emerald-400 font-mono text-xs break-all leading-relaxed shadow-2xl">
                                            {currentAppUrl}
                                        </code>
                                        <button 
                                            onClick={() => handleCopy(currentAppUrl, 'app_url')}
                                            className="bg-indigo-600 text-white px-6 py-2 rounded-xl hover:bg-indigo-500 transition-colors shadow-lg flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shrink-0"
                                        >
                                            {copied === 'app_url' ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                                            {copied === 'app_url' ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="text-xs text-slate-700 font-black uppercase tracking-widest flex items-center gap-3">
                                        <div className="w-6 h-6 bg-slate-900 text-white rounded-lg flex items-center justify-center text-[10px]">2</div>
                                        Redirect URL (Shopify Access section)
                                    </div>
                                    <div className="flex gap-2">
                                        <code className="flex-1 bg-slate-100 border border-slate-200 rounded-xl px-4 py-4 text-slate-600 font-mono text-xs break-all leading-relaxed">
                                            {currentRedirectUrl}
                                        </code>
                                        <button 
                                            onClick={() => handleCopy(currentRedirectUrl, 'redirect')}
                                            className="bg-indigo-600 text-white px-6 py-2 rounded-xl hover:bg-indigo-500 transition-colors shadow-lg flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shrink-0"
                                        >
                                            {copied === 'redirect' ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                                            {copied === 'redirect' ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-8 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                                <div className="flex items-center gap-4 bg-amber-50 border border-amber-200 p-5 rounded-2xl flex-1">
                                    <div className="bg-amber-500 p-2 rounded-lg text-white">
                                        <Save className="w-5 h-5" />
                                    </div>
                                    <p className="text-[10px] text-amber-800 font-black uppercase leading-relaxed tracking-widest">
                                        Update your App Version and click <span className="underline font-black italic text-amber-900">"Release"</span> at the top of the Shopify Dashboard to finish.
                                    </p>
                                </div>
                                <button 
                                    onClick={onComplete}
                                    className="px-12 py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-[0.3em] shadow-2xl hover:bg-black transition-all hover:scale-105 flex items-center gap-3 shrink-0"
                                >
                                    Finish Setup <StepForward className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-900 rounded-3xl p-10 flex items-center justify-between border-b-8 border-indigo-500 shadow-2xl overflow-hidden relative group">
                         <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                             <Bot className="w-60 h-60" />
                         </div>
                        <div className="relative z-10 w-full">
                            <p className="text-[12px] font-black uppercase tracking-[0.4em] text-indigo-400 mb-6 flex items-center gap-2">
                                <HelpCircle className="w-5 h-5" /> Final Check Checklist
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <ul className="space-y-5">
                                    <li className="flex items-start gap-4 text-xs font-bold uppercase text-white tracking-widest">
                                        <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" /> 
                                        <span>If <span className="text-indigo-400">Standard</span> fails, try <span className="text-indigo-400">Naked</span>.</span>
                                    </li>
                                    <li className="flex items-start gap-4 text-xs font-bold uppercase text-white tracking-widest">
                                        <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" /> 
                                        <span>Shopify Admin &rarr; App Settings &rarr; <strong>Embedded: TRUE</strong>.</span>
                                    </li>
                                </ul>
                                <ul className="space-y-5">
                                    <li className="flex items-start gap-4 text-xs font-bold uppercase text-white tracking-widest">
                                        <CheckCircle2 className="w-6 h-6 text-indigo-400 shrink-0" /> 
                                        <span>Always use <strong>HTTPS</strong>.</span>
                                    </li>
                                    <li className="flex items-start gap-4 text-xs font-bold uppercase text-white tracking-widest">
                                        <CheckCircle2 className="w-6 h-6 text-indigo-400 shrink-0" /> 
                                        <span>Refresh Shopify Admin page after clicking "Release".</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default IntegrationGuide;
