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
  isEanMatch?: boolean;
}

/** Map of lowercase SKU/productCode → EAN barcode string. Built from reference products & physical stock. */
export type EanIndex = Map<string, string>;

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
 * Resolves the best EAN for a SKU, checking the item's own EAN first,
 * then falling back to the enrichment index (reference products + stock scans).
 */
function resolveEan(ownEan: string | undefined, sku: string | undefined, productCode: string | undefined, eanIndex?: EanIndex): string | undefined {
  if (ownEan && ownEan !== '-' && ownEan.length >= 8) return ownEan;
  if (!eanIndex) return undefined;
  const skuKey = (sku || '').trim().toLowerCase();
  if (skuKey && eanIndex.has(skuKey)) return eanIndex.get(skuKey);
  const pcKey = (productCode || '').trim().toLowerCase();
  if (pcKey && eanIndex.has(pcKey)) return eanIndex.get(pcKey);
  return undefined;
}

/**
 * Auto-match engine: Suggests matches between Shopify order items and
 * Deco job items based on EAN barcode, SKU, name similarity, size, and colour.
 * When an eanIndex is provided, items without their own EAN are enriched
 * from reference products and physical stock scans.
 */
export function autoMatch(
  orders: UnifiedOrder[],
  productMappings: Record<string, string>,
  eanIndex?: EanIndex
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

      const candidates: { decoItem: DecoItem; score: number; reason: string; decoId: string; isEanMatch?: boolean }[] = [];
      const shopifySku = (item.sku || '').trim().toLowerCase();
      const shopifyName = normalize(item.name);
      const shopifySize = extractSize(item.name);
      const shopifyColour = extractColour(item.name);
      const shopifyEan = resolveEan(item.ean, item.sku, undefined, eanIndex);

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
        let isEanMatch = false;

        // SKU exact match: same SKU = same product. Auto-apply.
        if (shopifySku && decoSku && shopifySku === decoSku) {
          candidates.push({ decoItem, score: 1.0, reason: 'SKU exact match', decoId: `${decoId}@@@${idx}`, isEanMatch: true });
          continue;
        }
        
        // Also check vendorSku and productCode separately (decoSku uses vendorSku || productCode)
        const decoVendorSku = (decoItem.vendorSku || '').trim().toLowerCase();
        const decoProductCode = (decoItem.productCode || '').trim().toLowerCase();
        if (shopifySku && decoVendorSku && shopifySku === decoVendorSku) {
          candidates.push({ decoItem, score: 1.0, reason: 'Vendor SKU match', decoId: `${decoId}@@@${idx}`, isEanMatch: true });
          continue;
        }
        if (shopifySku && decoProductCode && shopifySku === decoProductCode) {
          candidates.push({ decoItem, score: 1.0, reason: 'Product code match', decoId: `${decoId}@@@${idx}`, isEanMatch: true });
          continue;
        }
        
        // Partial SKU overlap
        if (shopifySku && decoSku && (decoSku.includes(shopifySku) || shopifySku.includes(decoSku))) {
          score += 0.3;
          reasons.push('Partial SKU');
        }

        // EAN match (enriched from reference products + stock scans)
        // Same EAN = same product. 100% confidence, skip all other scoring.
        const decoEan = resolveEan(decoItem.ean, decoItem.vendorSku, decoItem.productCode, eanIndex);
        if (shopifyEan && decoEan && shopifyEan === decoEan) {
          candidates.push({ decoItem, score: 1.0, reason: 'EAN match', decoId: `${decoId}@@@${idx}`, isEanMatch: true });
          continue;
        }

        // Word-level name matching (better than pure bigram for product names)
        const sWords = shopifyName.split(/\s+/).filter(w => w.length > 1);
        const dWords = decoName.split(/\s+/).filter(w => w.length > 1);
        const dWordSet = new Set(dWords);
        let wordMatches = 0;
        sWords.forEach(w => { if (dWordSet.has(w)) wordMatches++; });
        const wordOverlap = sWords.length > 0 ? wordMatches / sWords.length : 0;
        if (wordOverlap > 0.3) {
          score += wordOverlap * 0.35;
          reasons.push(`Words ${Math.round(wordOverlap * 100)}%`);
        }

        // Bigram similarity as secondary signal
        const nameSim = diceCoefficient(shopifyName, decoName);
        if (nameSim > 0.4) {
          score += nameSim * 0.15;
          reasons.push(`Fuzzy ${Math.round(nameSim * 100)}%`);
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
        } else if (shopifyColour && decoColour && shopifyColour !== decoColour) {
          score -= 0.05;
        }

        // Vendor match
        const shopifyVendor = (item.vendor || '').toLowerCase();
        if (shopifyVendor && decoName.includes(normalize(shopifyVendor))) {
          score += 0.05;
          reasons.push('Vendor');
        }

        // Quantity match bonus
        if (item.quantity === decoItem.quantity) {
          score += 0.05;
          reasons.push('Qty match');
        }

        if (score > 0.3) {
          candidates.push({ decoItem, score: Math.min(1, score), reason: reasons.join(', '), decoId: `${decoId}@@@${idx}`, isEanMatch });
        }
      }

      // Pick best candidate
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0 && candidates[0].score >= 0.4) {
        const best = candidates[0];
        // High-confidence fuzzy match: if score >= 0.85 AND size matches AND qty matches, auto-apply
        const isHighConfidence = best.score >= 0.85 && best.reason.includes('Size match') && best.reason.includes('Qty match');
        results.push({
          orderNumber: order.shopify.orderNumber,
          itemId: item.id,
          itemName: item.name,
          suggestedJobId: order.decoJobId,
          suggestedDecoItemId: best.decoId,
          suggestedDecoItemName: best.decoItem.name,
          confidence: Math.round(best.score * 100),
          reason: best.reason,
          isEanMatch: best.isEanMatch || isHighConfidence,
        });
      }
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
