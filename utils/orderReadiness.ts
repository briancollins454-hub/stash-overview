import type { ItemReadiness } from '../types';

export type { ItemReadiness };

export type MappedItemLike = {
  linkedDecoItemId?: string;
  itemStatus?: string;
  decoProduced?: boolean;
  decoShipped?: boolean;
  decoReceived?: boolean;
  procurementStatus?: number;
  productionStatus?: number;
};

export function getMappedItemReadiness(item: MappedItemLike): ItemReadiness {
  if (item.itemStatus === 'fulfilled') return 'fulfilled';
  if (!item.linkedDecoItemId) return 'unmapped';
  if (item.linkedDecoItemId === '__NO_MAP__') return 'no_map';
  if (item.decoShipped) return 'shipped';

  const proc = item.procurementStatus ?? (item.decoReceived ? 60 : 0);
  // Deco procurement: 20 = PO raised with supplier (goods on the way), 60+ = checked in.
  if (proc < 60) return proc >= 20 ? 'stock_ordered' : 'awaiting_stock';

  const prod = item.productionStatus ?? 0;
  if (item.decoProduced || prod >= 80) return 'ready_to_ship';
  if (proc >= 60) return 'in_production';
  return 'awaiting_stock';
}

export function isItemReadyForDispatch(item: MappedItemLike): boolean {
  const r = getMappedItemReadiness(item);
  return r === 'ready_to_ship' || r === 'shipped' || r === 'fulfilled' || r === 'no_map';
}

export const ITEM_READINESS_LABEL: Record<ItemReadiness, string> = {
  unmapped: 'Unmapped',
  no_map: 'No map required',
  awaiting_stock: 'Awaiting Stock',
  stock_ordered: 'Stock Ordered',
  in_production: 'In Production',
  ready_to_ship: 'Ready to Ship',
  shipped: 'Shipped',
  fulfilled: 'Fulfilled',
};

/** Deco statuses where production is done and the job is waiting to leave — not Shipped yet. */
export const DECO_READY_TO_DISPATCH = new Set(['Ready for Shipping', 'Completed']);

export type OrderReadinessSummary = {
  label: string;
  awaitingStockCount: number;
  inProductionCount: number;
  readyToShipCount: number;
  trackedCount: number;
  isReadyToShip: boolean;
};

/** Smarter order badge: split awaiting-stock lines from ready-to-ship lines. */
export function deriveOrderProductionStatus(
  decoJobStatus: string,
  eligibleItems: MappedItemLike[],
): OrderReadinessSummary {
  const tracked = eligibleItems.filter((i) => {
    const r = getMappedItemReadiness(i);
    return r !== 'unmapped' && r !== 'no_map';
  });

  // Stock Ordered (PO raised, goods inbound) still blocks dispatch — count it with awaiting stock.
  const awaitingStockCount = tracked.filter((i) => {
    const r = getMappedItemReadiness(i);
    return r === 'awaiting_stock' || r === 'stock_ordered';
  }).length;
  const inProductionCount = tracked.filter((i) => getMappedItemReadiness(i) === 'in_production').length;
  const readyToShipCount = tracked.filter((i) => {
    const r = getMappedItemReadiness(i);
    return r === 'ready_to_ship' || r === 'shipped';
  }).length;
  const trackedCount = tracked.length;

  const allDispatchReady = trackedCount > 0 && tracked.every((i) => isItemReadyForDispatch(i));
  const isReadyToShip =
    allDispatchReady &&
    awaitingStockCount === 0 &&
    DECO_READY_TO_DISPATCH.has(decoJobStatus);

  if (trackedCount === 0) {
    return {
      label: decoJobStatus,
      awaitingStockCount: 0,
      inProductionCount: 0,
      readyToShipCount: 0,
      trackedCount: 0,
      isReadyToShip: DECO_READY_TO_DISPATCH.has(decoJobStatus),
    };
  }

  if (awaitingStockCount > 0 && readyToShipCount > 0) {
    return {
      label: `Partial — ${awaitingStockCount} awaiting stock`,
      awaitingStockCount,
      inProductionCount,
      readyToShipCount,
      trackedCount,
      isReadyToShip: false,
    };
  }

  if (awaitingStockCount > 0) {
    return {
      label: awaitingStockCount === trackedCount ? 'Awaiting Stock' : `Partial — ${awaitingStockCount} awaiting stock`,
      awaitingStockCount,
      inProductionCount,
      readyToShipCount,
      trackedCount,
      isReadyToShip: false,
    };
  }

  if (allDispatchReady && awaitingStockCount === 0) {
    if (decoJobStatus === 'Awaiting Stock') {
      return {
        label: 'Ready — pending Deco check-in',
        awaitingStockCount,
        inProductionCount,
        readyToShipCount,
        trackedCount,
        isReadyToShip: false,
      };
    }
    return {
      label: isReadyToShip ? 'Ready for Shipping' : decoJobStatus,
      awaitingStockCount,
      inProductionCount,
      readyToShipCount,
      trackedCount,
      isReadyToShip,
    };
  }

  if (inProductionCount > 0 && readyToShipCount > 0) {
    return {
      label: `In Production — ${readyToShipCount}/${trackedCount} ready`,
      awaitingStockCount,
      inProductionCount,
      readyToShipCount,
      trackedCount,
      isReadyToShip: false,
    };
  }

  if (inProductionCount > 0) {
    return {
      label: 'In Production',
      awaitingStockCount,
      inProductionCount,
      readyToShipCount,
      trackedCount,
      isReadyToShip: false,
    };
  }

  return {
    label: decoJobStatus,
    awaitingStockCount,
    inProductionCount,
    readyToShipCount,
    trackedCount,
    isReadyToShip: DECO_READY_TO_DISPATCH.has(decoJobStatus),
  };
}

export function getItemReadinessBadgeClass(readiness: ItemReadiness): string {
  switch (readiness) {
    case 'awaiting_stock':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'stock_ordered':
      return 'bg-sky-100 text-sky-800 border-sky-200';
    case 'in_production':
      return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'ready_to_ship':
    case 'shipped':
    case 'fulfilled':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'no_map':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}
