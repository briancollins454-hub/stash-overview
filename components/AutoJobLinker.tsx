import React, { useState, useMemo, useCallback } from 'react';
import { UnifiedOrder, DecoJob, ShopifyOrder } from '../types';
import { Link2, Zap, CheckCircle2, XCircle, Search, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import { fetchSingleDecoJob } from '../services/apiService';
import { ApiSettings } from './SettingsModal';

interface Props {
  orders: UnifiedOrder[];
  decoJobs: DecoJob[];
  settings: ApiSettings;
  itemJobLinks: Record<string, string>;
  onLink: (orderNumber: string, itemId: string, jobId: string) => void;
  onBulkLink: (links: { itemId: string; jobId: string }[]) => void;
  onNavigateToOrder: (orderNumber: string) => void;
}

interface SuggestedLink {
  orderId: string;
  orderNumber: string;
  customerName: string;
  decoJobId: string;
  decoJobNumber: string;
  decoCustomerName: string;
  confidence: number;
  matchReason: string;
  poMatch: boolean;
  nameMatch: boolean;
  commentMatch: boolean;
}

const AutoJobLinker: React.FC<Props> = ({ orders, decoJobs, settings, itemJobLinks, onLink, onBulkLink, onNavigateToOrder }) => {
  const [isLinking, setIsLinking] = useState(false);
  const [appliedLinks, setAppliedLinks] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // Build suggestions by matching Shopify orders to Deco jobs
  const suggestions = useMemo(() => {
    const results: SuggestedLink[] = [];
    const decoJobMap = new Map(decoJobs.map(j => [j.jobNumber, j]));
    const decoByPO = new Map<string, DecoJob>();
    const decoByCustomer = new Map<string, DecoJob[]>();

    decoJobs.forEach(j => {
      if (j.poNumber) decoByPO.set(j.poNumber.toLowerCase().trim(), j);
      const name = j.customerName.toLowerCase().trim();
      if (!decoByCustomer.has(name)) decoByCustomer.set(name, []);
      decoByCustomer.get(name)!.push(j);
    });

    const unlinkedOrders = orders.filter(o =>
      o.matchStatus === 'unlinked' &&
      o.shopify.fulfillmentStatus !== 'fulfilled' &&
      o.shopify.fulfillmentStatus !== 'restocked'
    );

    unlinkedOrders.forEach(o => {
      const orderNum = o.shopify.orderNumber;
      const customerName = o.shopify.customerName.toLowerCase().trim();
      const comments = (o.shopify.timelineComments || []).join(' ');
      let bestMatch: SuggestedLink | null = null;

      // 1. Check if order number appears as PO in Deco
      const poJob = decoByPO.get(orderNum.toLowerCase()) || decoByPO.get(`#${orderNum.toLowerCase()}`);
      if (poJob) {
        bestMatch = {
          orderId: o.shopify.id, orderNumber: orderNum, customerName: o.shopify.customerName,
          decoJobId: poJob.id, decoJobNumber: poJob.jobNumber, decoCustomerName: poJob.customerName,
          confidence: 95, matchReason: `PO number matches: ${poJob.poNumber}`, poMatch: true, nameMatch: false, commentMatch: false
        };
      }

      // 2. Check timeline comments for Deco job IDs
      if (!bestMatch) {
        const jobIdMatch = comments.match(/(?:^|[^0-9])(2\d{5})(?![0-9])/);
        if (jobIdMatch) {
          const jobId = jobIdMatch[1];
          const job = decoJobMap.get(jobId);
          if (job) {
            bestMatch = {
              orderId: o.shopify.id, orderNumber: orderNum, customerName: o.shopify.customerName,
              decoJobId: job.id, decoJobNumber: job.jobNumber, decoCustomerName: job.customerName,
              confidence: 90, matchReason: `Job ID ${jobId} found in order notes`, poMatch: false, nameMatch: false, commentMatch: true
            };
          }
        }
      }

      // 3. Customer name matching — find close Deco jobs by date
      if (!bestMatch) {
        const customerJobs = decoByCustomer.get(customerName);
        if (customerJobs && customerJobs.length > 0) {
          const orderDate = new Date(o.shopify.date);
          // Find closest job by date
          const closest = customerJobs.reduce((best, j) => {
            const jDate = new Date(j.dateOrdered || j.productionDueDate);
            const diff = Math.abs(jDate.getTime() - orderDate.getTime());
            const bestDiff = best ? Math.abs(new Date(best.dateOrdered || best.productionDueDate).getTime() - orderDate.getTime()) : Infinity;
            return diff < bestDiff ? j : best;
          }, null as DecoJob | null);

          if (closest) {
            const daysDiff = Math.abs((new Date(closest.dateOrdered || closest.productionDueDate).getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
            const confidence = daysDiff <= 2 ? 80 : daysDiff <= 7 ? 60 : 40;
            bestMatch = {
              orderId: o.shopify.id, orderNumber: orderNum, customerName: o.shopify.customerName,
              decoJobId: closest.id, decoJobNumber: closest.jobNumber, decoCustomerName: closest.customerName,
              confidence, matchReason: `Customer "${closest.customerName}" — ${daysDiff <= 1 ? 'same day' : `${Math.round(daysDiff)}d apart`}`,
              poMatch: false, nameMatch: true, commentMatch: false
            };
          }
        }
      }

      if (bestMatch && !dismissed.has(`${bestMatch.orderId}-${bestMatch.decoJobNumber}`)) {
        results.push(bestMatch);
      }
    });

    return results.sort((a, b) => b.confidence - a.confidence);
  }, [orders, decoJobs, dismissed]);

  const highConfidence = suggestions.filter(s => s.confidence >= 80);
  const lowConfidence = suggestions.filter(s => s.confidence < 80);

  const handleApply = useCallback((suggestion: SuggestedLink) => {
    onLink(suggestion.orderNumber, suggestion.orderId, suggestion.decoJobNumber);
    setAppliedLinks(prev => new Set(prev).add(`${suggestion.orderId}-${suggestion.decoJobNumber}`));
  }, [onLink]);

  const handleDismiss = useCallback((suggestion: SuggestedLink) => {
    setDismissed(prev => new Set(prev).add(`${suggestion.orderId}-${suggestion.decoJobNumber}`));
  }, []);

  const handleApplyAll = useCallback(async () => {
    setIsLinking(true);
    const links = highConfidence
      .filter(s => !appliedLinks.has(`${s.orderId}-${s.decoJobNumber}`))
      .map(s => ({ itemId: s.orderId, jobId: s.decoJobNumber, orderNumber: s.orderNumber }));
    
    for (const link of links) {
      onLink(link.orderNumber, link.itemId, link.jobId);
      setAppliedLinks(prev => new Set(prev).add(`${link.itemId}-${link.jobId}`));
    }
    setIsLinking(false);
  }, [highConfidence, appliedLinks, onLink]);

  const displaySuggestions = showAll ? suggestions : highConfidence;

  const ConfidenceBadge = ({ value }: { value: number }) => {
    const color = value >= 80 ? 'emerald' : value >= 50 ? 'amber' : 'red';
    return (
      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black bg-${color}-500/20 text-${color}-400`}>
        {value}%
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-white">Auto Job Linker</h2>
          <span className="px-2 py-0.5 rounded-full bg-white/10 text-[9px] font-black text-gray-300">
            {suggestions.length} suggestions
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll(!showAll)}
            className="px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-wider bg-white/5 border border-white/10 text-gray-300 hover:text-white transition-all"
          >
            {showAll ? 'High Confidence Only' : `Show All (${suggestions.length})`}
          </button>
          {highConfidence.length > 0 && (
            <button
              onClick={handleApplyAll}
              disabled={isLinking}
              className="px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {isLinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Apply All High ({highConfidence.filter(s => !appliedLinks.has(`${s.orderId}-${s.decoJobNumber}`)).length})
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      {suggestions.length === 0 ? (
        <div className="bg-white/5 rounded-xl border border-white/10 p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-bold text-white">All Clear</p>
          <p className="text-[10px] text-gray-400 mt-1">No unlinked orders with potential Deco matches found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displaySuggestions.map(s => {
            const isApplied = appliedLinks.has(`${s.orderId}-${s.decoJobNumber}`);
            return (
              <div key={`${s.orderId}-${s.decoJobNumber}`} className={`bg-white/5 rounded-xl border ${isApplied ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10'} p-3 flex items-center gap-4`}>
                {/* Shopify Order */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button onClick={() => onNavigateToOrder(s.orderNumber)} className="text-[11px] font-black text-indigo-300 hover:text-indigo-200">#{s.orderNumber}</button>
                    <span className="text-[10px] font-bold text-gray-400">{s.customerName}</span>
                  </div>
                </div>

                {/* Arrow / Match Reason */}
                <div className="flex items-center gap-2">
                  <ConfidenceBadge value={s.confidence} />
                  <div className="text-center">
                    <Link2 className="w-4 h-4 text-gray-500 mx-auto" />
                    <div className="text-[8px] text-gray-500 font-bold mt-0.5 max-w-[140px] truncate">{s.matchReason}</div>
                  </div>
                </div>

                {/* Deco Job */}
                <div className="flex-1 min-w-0 text-right">
                  <span className="text-[11px] font-black text-amber-300">Job #{s.decoJobNumber}</span>
                  <div className="text-[10px] font-bold text-gray-400">{s.decoCustomerName}</div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {isApplied ? (
                    <span className="text-[9px] font-black text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Linked</span>
                  ) : (
                    <>
                      <button onClick={() => handleApply(s)} className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded transition-all" title="Apply link">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDismiss(s)} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-all" title="Dismiss">
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Low confidence warning */}
      {!showAll && lowConfidence.length > 0 && (
        <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold">
          <AlertTriangle className="w-3.5 h-3.5" />
          {lowConfidence.length} lower-confidence suggestions hidden — click "Show All" to review
        </div>
      )}
    </div>
  );
};

export default AutoJobLinker;
