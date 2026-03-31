import { UnifiedOrder } from '../types';

export interface ForecastResult {
  orderNumber: string;
  orderId: string;
  customerName: string;
  estimatedCompletionDate: string;
  estimatedShipDate: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  basedOn: string;
  daysUntilCompletion: number;
}

/**
 * Production Forecasting: Estimates completion dates for in-progress orders
 * based on historical turnaround data from fulfilled orders.
 */
export function forecastProduction(orders: UnifiedOrder[]): ForecastResult[] {
  // Step 1: Build historical baseline from fulfilled orders
  const fulfilledDurations: number[] = [];
  const clubDurations = new Map<string, number[]>();
  const statusDurations = new Map<string, number[]>();

  for (const o of orders) {
    if (o.shopify.fulfillmentStatus === 'fulfilled' && o.fulfillmentDuration && o.fulfillmentDuration > 0) {
      fulfilledDurations.push(o.fulfillmentDuration);

      const club = o.clubName || 'Other';
      if (!clubDurations.has(club)) clubDurations.set(club, []);
      clubDurations.get(club)!.push(o.fulfillmentDuration);

      const status = o.productionStatus || 'Unknown';
      if (!statusDurations.has(status)) statusDurations.set(status, []);
      statusDurations.get(status)!.push(o.fulfillmentDuration);
    }
  }

  if (fulfilledDurations.length === 0) return [];

  const globalMedian = median(fulfilledDurations);

  // Step 2: Forecast active orders
  const results: ForecastResult[] = [];

  for (const o of orders) {
    if (o.shopify.fulfillmentStatus === 'fulfilled') continue;

    // Determine best estimate
    let estimate: number;
    let basedOn: string;
    let confidence: 'high' | 'medium' | 'low';

    const clubData = clubDurations.get(o.clubName);
    if (clubData && clubData.length >= 3) {
      estimate = median(clubData);
      basedOn = `${clubData.length} similar ${o.clubName} orders (median ${estimate}d)`;
      confidence = clubData.length >= 10 ? 'high' : 'medium';
    } else {
      estimate = globalMedian;
      basedOn = `Global average of ${fulfilledDurations.length} orders (median ${estimate}d)`;
      confidence = fulfilledDurations.length >= 20 ? 'medium' : 'low';
    }

    // Adjust for progress already made
    const daysAlreadyElapsed = o.daysInProduction;
    const remainingDays = Math.max(1, estimate - daysAlreadyElapsed);

    // Adjust for completion percentage
    if (o.completionPercentage > 50) {
      const adjustedRemaining = Math.max(1, Math.round(remainingDays * (1 - o.completionPercentage / 200)));
      const completionDate = addWorkingDays(new Date(), adjustedRemaining);
      const shipDate = addWorkingDays(completionDate, 1); // +1 day for fulfillment processing

      results.push({
        orderNumber: o.shopify.orderNumber,
        orderId: o.shopify.id,
        customerName: o.shopify.customerName,
        estimatedCompletionDate: completionDate.toLocaleDateString('en-GB'),
        estimatedShipDate: shipDate.toLocaleDateString('en-GB'),
        confidenceLevel: confidence,
        basedOn,
        daysUntilCompletion: adjustedRemaining,
      });
    } else {
      const completionDate = addWorkingDays(new Date(), remainingDays);
      const shipDate = addWorkingDays(completionDate, 2);

      results.push({
        orderNumber: o.shopify.orderNumber,
        orderId: o.shopify.id,
        customerName: o.shopify.customerName,
        estimatedCompletionDate: completionDate.toLocaleDateString('en-GB'),
        estimatedShipDate: shipDate.toLocaleDateString('en-GB'),
        confidenceLevel: confidence,
        basedOn,
        daysUntilCompletion: remainingDays,
      });
    }
  }

  return results.sort((a, b) => a.daysUntilCompletion - b.daysUntilCompletion);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function addWorkingDays(start: Date, days: number): Date {
  const date = new Date(start);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date;
}
