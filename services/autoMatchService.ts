import { UnifiedOrder, DecoItem } from '../types';

export interface AutoMatchResult {
  orderNumber: string;
  itemId: string;
  itemName: string;
  suggestedJobId: string;
  suggestedDecoItemId: string;
  suggestedDecoItemName: string;
  confidence: number;
  reason: string;
}

/**
 * Normalizes a product name for fuzzy matching by removing noise words, 
 * whitespace, and converting to lowercase.
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an|in|on|of|for|with|and|or)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates string similarity using Dice coefficient.
 */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) matches++;
  }
  return (2 * matches) / (a.length - 1 + b.length - 1);
}

/**
 * Extracts size tokens from a string.
 */
function extractSize(str: string): string | null {
  const sizeMatch = str.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|\d{1,3})\b/i);
  return sizeMatch ? sizeMatch[1].toUpperCase() : null;
}

/**
 * Extracts colour tokens from a string.
 */
function extractColour(str: string): string | null {
  const colours = ['black', 'white', 'red', 'blue', 'green', 'navy', 'grey', 'gray', 'yellow', 'orange', 'purple', 'pink', 'brown', 'maroon', 'teal', 'cyan', 'royal', 'charcoal', 'heather'];
  const lower = str.toLowerCase();
  return colours.find(c => lower.includes(c)) || null;
}

/**
 * Auto-match engine: Suggests matches between Shopify order items and
 * Deco job items based on SKU, name similarity, size, and colour.
 */
export function autoMatch(
  orders: UnifiedOrder[],
  productMappings: Record<string, string>
): AutoMatchResult[] {
  const results: AutoMatchResult[] = [];

  for (const order of orders) {
    // Only process unfulfilled orders that have a linked deco job
    if (order.shopify.fulfillmentStatus === 'fulfilled') continue;
    if (!order.decoJobId || !order.deco) continue;

    for (const item of order.shopify.items) {
      // Skip already-mapped items
      if (item.linkedDecoItemId) continue;
      // Skip fulfilled items
      if (item.itemStatus === 'fulfilled') continue;

      const candidates: { decoItem: DecoItem; score: number; reason: string; decoId: string }[] = [];
      const shopifySku = (item.sku || '').trim().toLowerCase();
      const shopifyName = normalize(item.name);
      const shopifySize = extractSize(item.name);
      const shopifyColour = extractColour(item.name);

      // Check learned product mappings first
      if (productMappings) {
        for (const [sPattern, dPattern] of Object.entries(productMappings)) {
          if (shopifyName.includes(normalize(sPattern)) || shopifySku === sPattern.toLowerCase()) {
            // Find the deco item matching the learned pattern
            const decoMatch = order.deco.items.find(d => {
              const dId = (d.vendorSku || d.productCode || d.name || '').trim().toLowerCase();
              return dId.includes(dPattern.toLowerCase()) || normalize(d.name).includes(normalize(dPattern));
            });
            if (decoMatch) {
              const decoId = (decoMatch.vendorSku || decoMatch.productCode || decoMatch.name || '').trim().toLowerCase();
              candidates.push({ decoItem: decoMatch, score: 0.95, reason: 'Learned product mapping', decoId });
            }
          }
        }
      }

      for (let idx = 0; idx < order.deco.items.length; idx++) {
        const decoItem = order.deco.items[idx];
        const decoSku = (decoItem.vendorSku || decoItem.productCode || '').trim().toLowerCase();
        const decoName = normalize(decoItem.name);
        const decoSize = extractSize(decoItem.name);
        const decoColour = extractColour(decoItem.name);
        const decoId = decoSku || normalize(decoItem.name);

        let score = 0;
        const reasons: string[] = [];

        // SKU exact match: high confidence
        if (shopifySku && decoSku && shopifySku === decoSku) {
          score += 0.5;
          reasons.push('SKU match');
        }

        // EAN match
        if (item.ean && decoItem.ean && item.ean === decoItem.ean) {
          score += 0.4;
          reasons.push('EAN match');
        }

        // Name similarity
        const nameSim = diceCoefficient(shopifyName, decoName);
        if (nameSim > 0.4) {
          score += nameSim * 0.3;
          reasons.push(`Name ${Math.round(nameSim * 100)}%`);
        }

        // Size match bonus
        if (shopifySize && decoSize && shopifySize === decoSize) {
          score += 0.1;
          reasons.push('Size match');
        } else if (shopifySize && decoSize && shopifySize !== decoSize) {
          score -= 0.15;
        }

        // Colour match bonus
        if (shopifyColour && decoColour && shopifyColour === decoColour) {
          score += 0.1;
          reasons.push('Colour match');
        }

        // Quantity match bonus
        if (item.quantity === decoItem.quantity) {
          score += 0.05;
          reasons.push('Qty match');
        }

        if (score > 0.3) {
          candidates.push({ decoItem, score: Math.min(1, score), reason: reasons.join(', '), decoId: `${decoId}@@@${idx}` });
        }
      }

      // Pick best candidate
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0 && candidates[0].score >= 0.4) {
        const best = candidates[0];
        results.push({
          orderNumber: order.shopify.orderNumber,
          itemId: item.id,
          itemName: item.name,
          suggestedJobId: order.decoJobId,
          suggestedDecoItemId: best.decoId,
          suggestedDecoItemName: best.decoItem.name,
          confidence: Math.round(best.score * 100),
          reason: best.reason,
        });
      }
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
