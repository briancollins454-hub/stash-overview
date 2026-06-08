
import React, { useState, useEffect, useRef } from 'react';
import { Job, Box, LineItem } from './types';
import { searchJobApi } from './services/jobService';
import { ThermalLabel, LabelSettings } from './components/ThermalLabel';
import { Search, Plus, Trash2, Package, ArrowRight, ArrowLeft, RefreshCw, Box as BoxIcon, Settings, X, CheckSquare, Square, TriangleAlert, Download, History, Loader2, AlertCircle, Edit3 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const SETTINGS_KEY = 'thermal_label_settings';

const DEFAULT_SETTINGS: LabelSettings = {
  logo1Url: 'https://cdn.shopify.com/s/files/1/1075/6304/files/M9dBXzrC4sAfkv047lSrhcxKZEdr7eEZPKrjEYPxb7fqFWWt3EDFpG8cBc8JzY8jYujZSS.png?v=1764029643',
  logo2Url: 'https://cdn.shopify.com/s/files/1/1075/6304/files/jMxGqK2uKSdZtLDqi9tStMNYzHPOljcqrDdkBntCBfbo1S6Zj3dspgFqCYvTH3ujLcDPhQ.svg?v=1764029725',
  logo1Width: 75,
  logo2Width: 150,
  webhookUrl: 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZkMDYzNjA0MzA1MjZiNTUzMjUxMzQi_pc'
};

const BLANK_JOB: Job = {
  jobNumber: '000000',
  customerName: 'CUSTOMER NAME',
  jobName: 'JOB DESCRIPTION',
  dateScheduled: '',
  items: []
};

const BLANK_BOX: Box = {
  id: 0,
  items: [],
  packerName: '',
  packedAt: new Date().toISOString(),
  isPrint: false,
  isEmb: false,
  customLabel: ''
};

const App: React.FC = () => {
  const [jobQuery, setJobQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [slowSearch, setSlowSearch] = useState(false);
  const [error, setError] = useState('');
  
  const [genStatus, setGenStatus] = useState<'idle' | 'preparing' | 'capturing'>('idle');
  const [genScope, setGenScope] = useState<'single' | 'batch'>('single');
  const [genType, setGenType] = useState<'pdf' | 'print'>('pdf');
  const printContainerRef = useRef<HTMLDivElement>(null);
  
  const [job, setJob] = useState<Job>(BLANK_JOB);
  const [totalBoxesInput, setTotalBoxesInput] = useState<number>(1);
  const [boxes, setBoxes] = useState<Box[]>([BLANK_BOX]);
  const [currentBoxIndex, setCurrentBoxIndex] = useState(0);
  const [assignedItems, setAssignedItems] = useState<Record<string, number>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<LabelSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch (e) {
        console.error("Failed to parse settings", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (genStatus === 'preparing') {
      const timer = setTimeout(() => {
        setGenStatus('capturing');
      }, 500); 
      return () => clearTimeout(timer);
    }

    if (genStatus === 'capturing') {
      const processGeneration = async () => {
        try {
          let sourceElements: HTMLElement[] = [];
          if (genScope === 'single') {
             const previewEl = document.getElementById('thermal-label-preview');
             if (previewEl) sourceElements = [previewEl];
          } else {
             if (printContainerRef.current) {
                sourceElements = Array.from(printContainerRef.current.children) as HTMLElement[];
             }
          }
          if (sourceElements.length > 0) {
              const images = await captureElements(sourceElements);
              handleOutput(images);
          }
        } catch (err) {
          console.error("Generation Error", err);
          alert("Failed to process labels.");
        } finally {
          setGenStatus('idle');
        }
      };
      processGeneration();
    }
  }, [genStatus, genScope, genType, currentBoxIndex, job.jobNumber, settings.webhookUrl]);

  const captureElements = async (elements: HTMLElement[]): Promise<string[]> => {
    const images: string[] = [];
    for (let i = 0; i < elements.length; i++) {
      const original = elements[i];
      const clone = original.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.zIndex = '99999';
      clone.style.transform = 'none';
      clone.style.margin = '0';
      clone.style.boxShadow = 'none';
      clone.style.border = 'none';
      clone.style.overflow = 'visible';
      const editables = clone.querySelectorAll('[contenteditable]');
      editables.forEach(el => el.setAttribute('contenteditable', 'false'));
      document.body.appendChild(clone);
      await new Promise(r => setTimeout(r, 50));
      const canvas = await html2canvas(clone, {
        scale: 4, 
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: 384,
        height: 576,
        windowWidth: 384,
        windowHeight: 576,
        scrollY: 0,
        scrollX: 0,
      });
      document.body.removeChild(clone);
      images.push(canvas.toDataURL('image/png'));
    }
    return images;
  };

  const handleOutput = (images: string[]) => {
      if (genType === 'pdf') {
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: [4, 6] });
          images.forEach((imgData, index) => {
            if (index > 0) pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, 0, 4, 6);
          });
          const filename = genScope === 'single' 
            ? `Job-${job.jobNumber}-Box-${currentBoxIndex + 1}.pdf`
            : `Job-${job.jobNumber}-All-Labels.pdf`;
          pdf.save(filename);
          notifyWebhook('Download PDF', genScope);
      } else {
          printImages(images);
          notifyWebhook('Print', genScope);
      }
  };

  const printImages = (imageUrls: string[]) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(`
        <html>
        <head>
            <style>
                @page { size: 4in 6in; margin: 0; }
                body { margin: 0; padding: 0; }
                img { width: 100%; height: auto; display: block; break-after: page; page-break-after: always; }
                img:last-child { break-after: auto; page-break-after: auto; }
            </style>
        </head>
        <body>
            ${imageUrls.map(url => `<img src="${url}" />`).join('')}
        </body>
        </html>
    `);
    doc.close();
    iframe.contentWindow?.focus();
    setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 500);
  };

  const notifyWebhook = async (action: string, scope: 'single' | 'batch') => {
    if (!settings.webhookUrl) return;
    const payload = {
        text: `Label Action: ${action} (${scope})`,
        action, scope, timestamp: new Date().toISOString(),
        job: { number: job.jobNumber, customer: job.customerName, name: job.jobName },
        packer: boxes[currentBoxIndex]?.packerName || 'Unknown',
        totalBoxes: boxes.length,
        boxInfo: scope === 'single' ? {
            number: currentBoxIndex + 1,
            items: boxes[currentBoxIndex].items.map(i => i.description)
        } : boxes.map((b, i) => ({
            number: i + 1,
            items: b.items.map(item => item.description)
        }))
    };
    try {
        await fetch(settings.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) { console.error("Webhook notification failed", e); }
  };

  const handleTrigger = (type: 'pdf' | 'print', scope: 'single' | 'batch') => {
    setGenType(type);
    setGenScope(scope);
    setGenStatus('preparing');
  };

  const startManualMode = () => {
    setJob({ ...BLANK_JOB, jobNumber: jobQuery || '000000' });
    initializeBoxes(1);
    setLoading(false);
    setSlowSearch(false);
    setError('');
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobQuery) return;
    
    setLoading(true);
    setSlowSearch(false);
    setError('');
    
    // Timer to show manual option if search hangs
    const slowTimer = setTimeout(() => setSlowSearch(true), 6000);
    
    try {
      const result = await searchJobApi(jobQuery);
      clearTimeout(slowTimer);
      if (result) {
        setJob(result);
        setAssignedItems({});
        initializeBoxes(totalBoxesInput);
      } else {
        setError('Job not found. Check the number and try again.');
      }
    } catch (err: any) {
      clearTimeout(slowTimer);
      console.error(err);
      setError(err.message || 'Could not reach the job lookup service.');
    } finally {
      setLoading(false);
    }
  };

  const initializeBoxes = (count: number) => {
    const newBoxes: Box[] = [];
    for (let i = 0; i < count; i++) {
      newBoxes.push({
        id: i, items: [], packerName: '', packedAt: new Date().toISOString(),
        isPrint: false, isEmb: false, customLabel: ''
      });
    }
    setBoxes(newBoxes);
    setCurrentBoxIndex(0);
  };

  const handleUpdateTotalBoxes = () => {
    const currentCount = boxes.length;
    if (totalBoxesInput > currentCount) {
       const needed = totalBoxesInput - currentCount;
       const newBoxes = [...boxes];
       for(let i=0; i<needed; i++) {
         newBoxes.push({
            id: currentCount + i, items: [], packerName: '', 
            packedAt: new Date().toISOString(), isPrint: false, isEmb: false, customLabel: ''
         });
       }
       setBoxes(newBoxes);
    } else if (totalBoxesInput < currentCount) {
       const newBoxes = boxes.slice(0, totalBoxesInput);
       const newAssigned = { ...assignedItems };
       boxes.slice(totalBoxesInput).forEach(box => {
          box.items.forEach(item => delete newAssigned[item.id]);
       });
       setAssignedItems(newAssigned);
       setBoxes(newBoxes);
       if (currentBoxIndex >= totalBoxesInput) setCurrentBoxIndex(totalBoxesInput - 1);
    }
  };

  const handleAddItemToBox = (item: LineItem) => {
    const currentBox = boxes[currentBoxIndex];
    if (currentBox.items.length >= 10) {
      alert("This box is full (Max 10 items).");
      return;
    }
    const updatedBoxes = [...boxes];
    updatedBoxes[currentBoxIndex] = { ...currentBox, items: [...currentBox.items, { ...item }] };
    setBoxes(updatedBoxes);
    setAssignedItems(prev => ({ ...prev, [item.id]: currentBoxIndex }));
  };

  const handleRemoveItemFromBox = (item: LineItem) => {
    const currentBox = boxes[currentBoxIndex];
    const updatedBoxes = [...boxes];
    updatedBoxes[currentBoxIndex] = { ...currentBox, items: currentBox.items.filter(i => i.id !== item.id) };
    setBoxes(updatedBoxes);
    const newAssigned = { ...assignedItems };
    delete newAssigned[item.id];
    setAssignedItems(newAssigned);
  };

  const handlePackerNameChange = (name: string) => {
    const updatedBoxes = [...boxes];
    updatedBoxes[currentBoxIndex].packerName = name.toUpperCase();
    setBoxes(updatedBoxes);
  };

  const toggleBoxAttribute = (attr: 'isPrint' | 'isEmb') => {
    const updatedBoxes = [...boxes];
    updatedBoxes[currentBoxIndex][attr] = !updatedBoxes[currentBoxIndex][attr];
    setBoxes(updatedBoxes);
  };

  const handleUpdateJob = (field: keyof Job, value: string) => setJob(prev => ({ ...prev, [field]: value }));

  const handleUpdateBoxItem = (itemIndex: number, newText: string) => {
    const currentBox = boxes[currentBoxIndex];
    const updatedBoxes = [...boxes];
    const updatedItems = [...currentBox.items];
    if (itemIndex < updatedItems.length) {
       updatedItems[itemIndex] = { ...updatedItems[itemIndex], description: newText };
    } else if (newText.trim()) {
        updatedItems.push({ id: `manual-${Date.now()}-${itemIndex}`, description: newText, quantity: 1 });
    }
    updatedBoxes[currentBoxIndex] = { ...currentBox, items: updatedItems };
    setBoxes(updatedBoxes);
  };

  const handleUpdateBoxDetail = (field: keyof Box, value: string) => {
    const updatedBoxes = [...boxes];
    const box = updatedBoxes[currentBoxIndex];
    if (field === 'packerName') box.packerName = value;
    else if (field === 'customLabel') box.customLabel = value;
    else if (field === 'isPrint' || field === 'isEmb') {
        if (value === 'toggle') box[field] = !box[field];
    }
    setBoxes(updatedBoxes);
  };

  const isToday = (dateStr?: string) => {
    if (!dateStr) return true;
    const d = new Date(dateStr);
    const today = new Date();
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  };

  const waitingItems = job.items.filter(i => i.isReceived === false);
  const receivedItems = job.items.filter(i => i.isReceived !== false);
  const todaysItems = receivedItems.filter(i => isToday(i.receivedDate));
  const previousItems = receivedItems.filter(i => !isToday(i.receivedDate));

  const renderItemList = (items: LineItem[], title: string, variant: 'default' | 'warning' | 'info' = 'default') => (
    <div className="mb-4">
      {items.length > 0 && (
        <h3 className={`text-xs font-bold uppercase mb-2 sticky top-0 py-1 z-10 flex items-center gap-2 
          ${variant === 'warning' ? 'text-amber-600 bg-amber-50' : variant === 'info' ? 'text-slate-600 bg-slate-50' : 'text-green-600 bg-white'}`}>
           {variant === 'warning' && <TriangleAlert className="w-3 h-3" />}
           {variant === 'info' && <History className="w-3 h-3" />}
           {title}
        </h3>
      )}
      <div className="space-y-2">
        {items.map(item => {
          const isAssigned = assignedItems[item.id] !== undefined;
          const assignedToBox = assignedItems[item.id];
          let cardClasses = 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-sm cursor-pointer text-gray-800';
          if (isAssigned) cardClasses = 'bg-gray-100 border-gray-100 text-gray-400';
          else if (variant === 'warning') cardClasses = 'bg-amber-50 border-amber-200 hover:border-amber-400 cursor-pointer text-gray-800';
          else if (variant === 'info') cardClasses = 'bg-slate-50 border-slate-200 hover:border-slate-400 cursor-pointer text-gray-800';
          return (
            <div key={item.id} className={`p-3 rounded border transition flex justify-between items-center ${cardClasses}`} onClick={() => !isAssigned && handleAddItemToBox(item)}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" title={item.description}>{item.description}</p>
                <div className="flex justify-between items-center pr-2">
                    <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                    {item.receivedDate && <span className="text-[10px] text-gray-400">{new Date(item.receivedDate).toLocaleDateString()}</span>}
                </div>
                {isAssigned && <p className="text-[10px] uppercase mt-1">In Box {assignedToBox + 1}</p>}
              </div>
              {!isAssigned && <Plus className={`w-4 h-4 ${variant === 'warning' ? 'text-amber-500' : 'text-blue-500'}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-neutral-100 font-roboto-condensed text-neutral-800 relative">
      {genStatus !== 'idle' && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mb-4" />
          <h2 className="text-2xl font-bold">{genType === 'pdf' ? 'Generating PDF...' : 'Preparing Print...'}</h2>
        </div>
      )}

      <div ref={printContainerRef} className="fixed top-0 left-0 z-[50] bg-white"
        style={{ width: '384px', height: 'auto', visibility: genStatus !== 'idle' && genScope === 'batch' ? 'visible' : 'hidden' }}>
        {genStatus !== 'idle' && genScope === 'batch' && boxes.map((box, idx) => (
              <div key={box.id}><ThermalLabel job={job} box={box} totalBoxes={boxes.length} boxNumber={idx + 1} settings={settings} printing={true} /></div>
        ))}
      </div>

      {showSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-2xl p-6 w-96 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Label Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-700"><X className="w-6 h-6" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Left Logo URL</label><input type="text" value={settings.logo1Url} onChange={(e) => setSettings({...settings, logo1Url: e.target.value})} className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Right Logo URL</label><input type="text" value={settings.logo2Url} onChange={(e) => setSettings({...settings, logo2Url: e.target.value})} className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label><input type="text" value={settings.webhookUrl || ''} onChange={(e) => setSettings({...settings, webhookUrl: e.target.value})} className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900" /></div>
            </div>
            <div className="mt-6 flex justify-end"><button onClick={() => setShowSettings(false)} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-bold">Save</button></div>
          </div>
        </div>
      )}

      <div className="w-1/2 flex flex-col border-r border-gray-300 bg-white no-print overflow-y-auto">
        <div className="p-6 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-800"><Package className="w-6 h-6" /> Label Printer</h1>
          <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-gray-200 rounded-full text-gray-600"><Settings className="w-6 h-6" /></button>
        </div>

        <div className="p-6 border-b border-gray-200">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input type="text" className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md bg-white text-gray-900" placeholder="Enter Job Number..." value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} />
            </div>
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium disabled:opacity-50" disabled={loading}>
              {loading ? <RefreshCw className="animate-spin w-5 h-5" /> : 'Search'}
            </button>
          </form>

          {loading && slowSearch && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                <p className="text-sm font-bold text-blue-800">Connection is slow...</p>
              </div>
              <button 
                onClick={startManualMode}
                className="w-full bg-white border border-blue-300 text-blue-700 py-2 rounded font-bold text-sm hover:bg-blue-100 flex items-center justify-center gap-2"
              >
                <Edit3 className="w-4 h-4" /> Skip & Enter Manually
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex flex-col gap-3">
                <div className="flex gap-3 items-start">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold text-red-800">Lookup Failed</p>
                        <p className="text-red-700 whitespace-pre-line">{error}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={startManualMode} className="flex-1 bg-white border border-red-300 text-red-700 py-2 rounded font-bold text-xs hover:bg-red-100 uppercase">Manual Entry</button>
                    <button onClick={() => setJobQuery('DEMO')} className="flex-1 bg-white border border-gray-300 text-gray-600 py-2 rounded font-bold text-xs hover:bg-gray-100 uppercase">Try Demo</button>
                </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-blue-50 border-b border-blue-100">
            <div className="mb-4">
                <h2 className="font-bold text-2xl leading-none truncate text-gray-900">{job.customerName}</h2>
                <p className="text-gray-600">{job.jobName} — #{job.jobNumber}</p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex items-end gap-2">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-bold uppercase text-gray-500 mb-1">Total Boxes</label>
                        <input type="number" min="1" max="100" className="w-20 h-9 p-1 border border-gray-300 rounded text-center font-bold bg-white text-gray-900" value={totalBoxesInput} onChange={(e) => setTotalBoxesInput(parseInt(e.target.value) || 1)} onBlur={handleUpdateTotalBoxes} />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-bold uppercase text-gray-500 mb-1">Initials</label>
                        <input type="text" maxLength={5} className="w-20 h-9 p-1 border border-gray-300 rounded text-center font-bold bg-white text-gray-900 uppercase" value={boxes[currentBoxIndex]?.packerName || ''} onChange={(e) => handlePackerNameChange(e.target.value)} />
                    </div>
                    <button onClick={() => toggleBoxAttribute('isPrint')} className={`h-9 px-3 border rounded font-bold text-xs transition flex items-center gap-2 ${boxes[currentBoxIndex]?.isPrint ? 'bg-black text-white' : 'bg-white'}`}>PRINT</button>
                    <button onClick={() => toggleBoxAttribute('isEmb')} className={`h-9 px-3 border rounded font-bold text-xs transition flex items-center gap-2 ${boxes[currentBoxIndex]?.isEmb ? 'bg-black text-white' : 'bg-white'}`}>EMB</button>
                </div>
                <div className="flex items-center bg-white border border-gray-300 rounded h-9">
                    <button onClick={() => setCurrentBoxIndex(prev => Math.max(0, prev - 1))} disabled={currentBoxIndex === 0} className="h-full px-2 hover:bg-gray-100 disabled:opacity-30"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="px-3 text-sm font-bold min-w-[90px] text-center">BOX {currentBoxIndex + 1} / {boxes.length}</span>
                    <button onClick={() => setCurrentBoxIndex(prev => Math.min(boxes.length - 1, prev + 1))} disabled={currentBoxIndex === boxes.length - 1} className="h-full px-2 hover:bg-gray-100 disabled:opacity-30"><ArrowRight className="w-4 h-4" /></button>
                </div>
            </div>
        </div>

        <div className="flex-grow flex overflow-hidden">
            <div className="w-1/2 p-4 overflow-y-auto border-r border-gray-200 bg-white">
                {job.items.length === 0 ? <p className="text-xs text-gray-400 italic">No items found.</p> : (
                  <>{renderItemList(todaysItems, "Ready to Pack", 'default')}{renderItemList(previousItems, "History", 'info')}{renderItemList(waitingItems, "Waiting", 'warning')}</>
                )}
            </div>
            <div className="w-1/2 p-4 overflow-y-auto bg-gray-50">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-3 sticky top-0 bg-gray-50 py-2 z-10">Box {currentBoxIndex + 1} Contents</h3>
                <div className="space-y-2">
                {boxes[currentBoxIndex]?.items.map(item => (
                    <div key={item.id} className="p-3 bg-white border border-green-200 rounded shadow-sm flex justify-between items-center group">
                      <p className="text-sm font-bold text-gray-800 truncate">{item.description}</p>
                      <button onClick={() => handleRemoveItemFromBox(item)} className="p-1 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                ))}
                </div>
            </div>
        </div>
      </div>

      <div className="w-1/2 bg-gray-800 flex flex-col items-center justify-center relative p-8 print:bg-white print:p-0">
        <div className="mb-4 text-gray-300 font-medium flex items-center gap-2 no-print">
            <span>Previewing Box {currentBoxIndex + 1}</span>
            <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-400">Editable</span>
        </div>
        <div className="transform scale-90 sm:scale-100 shadow-2xl">
            <ThermalLabel id="thermal-label-preview" job={job} box={boxes[currentBoxIndex]} totalBoxes={boxes.length} boxNumber={currentBoxIndex + 1} settings={settings} onUpdateJob={handleUpdateJob} onUpdateBoxItem={handleUpdateBoxItem} onUpdateBoxDetail={handleUpdateBoxDetail} />
        </div>
        <div className="no-print absolute bottom-8 right-8 flex flex-col gap-2">
            <button onClick={() => handleTrigger('pdf', 'single')} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 font-bold text-lg transition-transform hover:scale-105 active:scale-95">
                <Download className="w-6 h-6" /> DOWNLOAD LABEL
            </button>
        </div>
      </div>
    </div>
  );
};

export default App;
