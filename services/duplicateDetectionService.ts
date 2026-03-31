import { UnifiedOrder } from '../types';

export interface DuplicateGroup {
  key: string;
  reason: string;
  orders: UnifiedOrder[];
}

/**
 * Detects potential duplicate orders based on multiple heuristics:
 * - Same customer + same total + orders within 24h
 * - Same customer email + overlapping items
 */
export function detectDuplicates(orders: UnifiedOrder[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();

  // Group by customer email
  const byEmail = new Map<string, UnifiedOrder[]>();
  for (const o of orders) {
    const email = (o.shopify.email || '').toLowerCase().trim();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(o);
  }

  for (const [email, emailOrders] of byEmail) {
    if (emailOrders.length < 2) continue;

    // Sort by date
    const sorted = emailOrders.sort((a, b) => new Date(a.shopify.date).getTime() - new Date(b.shopify.date).getTime());

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const pairKey = `${a.shopify.id}|${b.shopify.id}`;
        if (seen.has(pairKey)) continue;

        const timeDiff = Math.abs(new Date(a.shopify.date).getTime() - new Date(b.shopify.date).getTime());
        const sameTotal = a.shopify.totalPrice === b.shopify.totalPrice;
        const within24h = timeDiff < 24 * 60 * 60 * 1000;

        // Check item overlap
        const aSkus = new Set(a.shopify.items.map(i => i.sku).filter(Boolean));
        const bSkus = new Set(b.shopify.items.map(i => i.sku).filter(Boolean));
        const overlapping = [...aSkus].filter(s => bSkus.has(s));
        const hasOverlap = overlapping.length > 0 && overlapping.length >= Math.min(aSkus.size, bSkus.size) * 0.5;

        if (sameTotal && within24h) {
          seen.add(pairKey);
          groups.push({
            key: pairKey,
            reason: `Same customer (${email}), same total (£${a.shopify.totalPrice}), within 24 hours`,
            orders: [a, b],
          });
        } else if (hasOverlap && within24h) {
          seen.add(pairKey);
          groups.push({
            key: pairKey,
            reason: `Same customer (${email}), ${overlapping.length} overlapping SKUs, within 24 hours`,
            orders: [a, b],
          });
        }
      }
    }
  }

  return groups;
}
