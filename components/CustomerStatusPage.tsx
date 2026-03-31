import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Truck, CheckCircle2, Clock, AlertTriangle, Loader2, ShoppingBag } from 'lucide-react';

/**
 * CustomerStatusPage: A public-facing order tracking page.
 * Accessible at /?track=ORDER_NUMBER
 * Shows order progress without requiring auth.
 * 
 * Note: In production, this should be backed by a public API endpoint
 * that exposes only non-sensitive order status data.
 */

interface TrackingData {
  orderNumber: string;
  status: string;
  progress: number;
  stages: { label: string; done: boolean; current: boolean; date?: string }[];
  estimatedShip?: string;
  customerName?: string;
}

interface Props {
  trackingData: TrackingData | null;
  loading: boolean;
  error?: string;
}

const CustomerStatusPage: React.FC<Props> = ({ trackingData, loading, error }) => {
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Looking up your order...</p>
        </div>
      </div>
    );
  }

  if (error || !trackingData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-10 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-black text-gray-800 uppercase tracking-wider mb-2">Order Not Found</h1>
          <p className="text-sm text-gray-500">{error || 'We could not find an order with that number. Please check and try again.'}</p>
        </div>
      </div>
    );
  }

  const { orderNumber, status, progress, stages, estimatedShip } = trackingData;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#2d2d5f] text-white px-8 py-6">
          <div className="flex items-center gap-3 mb-1">
            <ShoppingBag className="w-6 h-6 text-indigo-300" />
            <h1 className="text-lg font-black uppercase tracking-widest">Order Tracking</h1>
          </div>
          <p className="text-indigo-300 text-sm font-bold">Order #{orderNumber}</p>
        </div>

        {/* Progress */}
        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-widest text-gray-500">Progress</span>
            <span className="text-xs font-black text-indigo-600">{progress}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2 text-right">
            <span className={`text-xs font-black uppercase tracking-widest ${progress === 100 ? 'text-emerald-600' : 'text-indigo-600'}`}>
              {status}
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div className="px-8 pb-6">
          <div className="space-y-0">
            {stages.map((stage, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    stage.done ? 'bg-emerald-500 text-white' : stage.current ? 'bg-indigo-500 text-white animate-pulse' : 'bg-gray-200 text-gray-400'
                  }`}>
                    {stage.done ? <CheckCircle2 className="w-4 h-4" /> : stage.current ? <Clock className="w-4 h-4" /> : <div className="w-2 h-2 rounded-full bg-gray-400" />}
                  </div>
                  {i < stages.length - 1 && (
                    <div className={`w-0.5 h-8 ${stage.done ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                  )}
                </div>
                <div className="pt-1.5">
                  <span className={`text-sm font-black uppercase tracking-wider ${stage.done ? 'text-gray-800' : stage.current ? 'text-indigo-700' : 'text-gray-400'}`}>
                    {stage.label}
                  </span>
                  {stage.date && <p className="text-xs text-gray-400 font-bold mt-0.5">{stage.date}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Estimated shipping */}
        {estimatedShip && progress < 100 && (
          <div className="px-8 pb-6">
            <div className="bg-indigo-50 rounded-xl p-4 flex items-center gap-3">
              <Truck className="w-5 h-5 text-indigo-500" />
              <div>
                <span className="text-xs font-black uppercase tracking-widest text-indigo-700">Estimated Ship Date</span>
                <p className="text-sm font-bold text-indigo-600">{estimatedShip}</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-gray-50 px-8 py-4 text-center">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            Powered by Stash Shop Sync
          </p>
        </div>
      </div>
    </div>
  );
};

export default CustomerStatusPage;

/**
 * Helper to build tracking data from a UnifiedOrder.
 * Used internally when the order is found.
 */
export function buildTrackingData(order: any): TrackingData {
  const stages = [
    {
      label: 'Order Received',
      done: true,
      current: false,
      date: new Date(order.shopify.date).toLocaleDateString('en-GB'),
    },
    {
      label: 'In Production',
      done: order.completionPercentage > 0 || order.decoJobId != null,
      current: order.decoJobId != null && order.completionPercentage < 100 && order.shopify.fulfillmentStatus !== 'fulfilled',
    },
    {
      label: 'Quality Check',
      done: order.completionPercentage === 100,
      current: order.completionPercentage >= 80 && order.completionPercentage < 100,
    },
    {
      label: 'Shipped',
      done: order.shopify.fulfillmentStatus === 'fulfilled',
      current: order.completionPercentage === 100 && order.shopify.fulfillmentStatus !== 'fulfilled',
      date: order.fulfillmentDate ? new Date(order.fulfillmentDate).toLocaleDateString('en-GB') : undefined,
    },
  ];

  let status = 'Processing';
  if (order.shopify.fulfillmentStatus === 'fulfilled') status = 'Delivered';
  else if (order.completionPercentage === 100) status = 'Ready to Ship';
  else if (order.completionPercentage > 0) status = 'In Production';
  else if (order.decoJobId) status = 'Job Created';

  return {
    orderNumber: order.shopify.orderNumber,
    status,
    progress: order.shopify.fulfillmentStatus === 'fulfilled' ? 100 : order.completionPercentage,
    stages,
    estimatedShip: order.slaTargetDate,
    customerName: order.shopify.customerName,
  };
}
