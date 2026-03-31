import React from 'react';
import { UnifiedOrder } from '../types';
import { CheckCircle2, Circle, Clock, Package, Truck, ShoppingBag, AlertTriangle, Link2 } from 'lucide-react';

interface TimelineStep {
  label: string;
  status: 'completed' | 'current' | 'upcoming' | 'warning';
  date?: string;
  detail?: string;
  icon: React.ReactNode;
}

interface Props {
  order: UnifiedOrder;
}

const OrderTimeline: React.FC<Props> = ({ order }) => {
  const steps: TimelineStep[] = [];

  // Step 1: Order Placed
  steps.push({
    label: 'Order Placed',
    status: 'completed',
    date: new Date(order.shopify.date).toLocaleDateString('en-GB'),
    detail: `#${order.shopify.orderNumber} — ${order.shopify.customerName}`,
    icon: <ShoppingBag className="w-4 h-4" />,
  });

  // Step 2: Linked to Deco
  if (order.decoJobId) {
    steps.push({
      label: 'Job Created',
      status: 'completed',
      detail: `Deco Job #${order.decoJobId}`,
      date: order.deco?.dateOrdered ? new Date(order.deco.dateOrdered).toLocaleDateString('en-GB') : undefined,
      icon: <Link2 className="w-4 h-4" />,
    });
  } else {
    steps.push({
      label: 'Awaiting Job',
      status: order.daysInProduction > 5 ? 'warning' : 'current',
      detail: `${order.daysInProduction} working days since order`,
      icon: <Link2 className="w-4 h-4" />,
    });
  }

  // Step 3: In Production
  const inProduction = order.deco && order.completionPercentage > 0 && order.completionPercentage < 100;
  const productionDone = order.completionPercentage === 100;
  if (productionDone) {
    steps.push({
      label: 'Production Complete',
      status: 'completed',
      detail: `${order.deco?.itemsProduced ?? 0}/${order.deco?.totalItems ?? 0} items produced`,
      icon: <Package className="w-4 h-4" />,
    });
  } else if (inProduction) {
    steps.push({
      label: 'In Production',
      status: 'current',
      detail: `${order.completionPercentage}% complete`,
      icon: <Package className="w-4 h-4" />,
    });
  } else if (order.decoJobId) {
    steps.push({
      label: 'Production Pending',
      status: 'upcoming',
      detail: order.productionDueDate ? `Due ${new Date(order.productionDueDate).toLocaleDateString('en-GB')}` : undefined,
      icon: <Package className="w-4 h-4" />,
    });
  } else {
    steps.push({
      label: 'Production',
      status: 'upcoming',
      icon: <Package className="w-4 h-4" />,
    });
  }

  // Step 4: Shipped / Fulfilled
  if (order.shopify.fulfillmentStatus === 'fulfilled') {
    steps.push({
      label: 'Fulfilled',
      status: 'completed',
      date: order.fulfillmentDate ? new Date(order.fulfillmentDate).toLocaleDateString('en-GB') : undefined,
      detail: order.fulfillmentDuration ? `${order.fulfillmentDuration} working days` : undefined,
      icon: <Truck className="w-4 h-4" />,
    });
  } else if (order.shopify.fulfillmentStatus === 'partial') {
    steps.push({
      label: 'Partially Shipped',
      status: 'current',
      icon: <Truck className="w-4 h-4" />,
    });
  } else if (productionDone) {
    steps.push({
      label: 'Ready to Ship',
      status: 'current',
      detail: 'Awaiting fulfillment',
      icon: <Truck className="w-4 h-4" />,
    });
  } else {
    const isLate = order.daysRemaining < 0;
    steps.push({
      label: 'Shipping',
      status: isLate ? 'warning' : 'upcoming',
      detail: isLate ? `${Math.abs(order.daysRemaining)} days overdue` : `${order.daysRemaining} days remaining`,
      icon: <Truck className="w-4 h-4" />,
    });
  }

  const statusColors = {
    completed: 'bg-emerald-500 text-white',
    current: 'bg-indigo-500 text-white animate-pulse',
    upcoming: 'bg-gray-200 text-gray-400',
    warning: 'bg-amber-500 text-white',
  };

  const lineColors = {
    completed: 'bg-emerald-500',
    current: 'bg-indigo-300',
    upcoming: 'bg-gray-200',
    warning: 'bg-amber-300',
  };

  return (
    <div className="flex items-start gap-0 w-full py-3">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center text-center min-w-[100px] flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${statusColors[step.status]} shadow-md`}>
              {step.status === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : step.status === 'warning' ? <AlertTriangle className="w-4 h-4" /> : step.icon}
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest mt-2 text-gray-700">{step.label}</span>
            {step.date && <span className="text-[8px] font-bold text-gray-400 mt-0.5">{step.date}</span>}
            {step.detail && <span className="text-[8px] font-bold text-gray-500 mt-0.5 max-w-[120px] leading-tight">{step.detail}</span>}
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mt-4 ${lineColors[step.status]} rounded-full min-w-[20px]`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default OrderTimeline;
