import { describe, expect, it } from 'vitest';
import {
  deriveOrderProductionStatus,
  getMappedItemReadiness,
  isItemReadyForDispatch,
} from './orderReadiness';

describe('orderReadiness', () => {
  it('marks stock ordered when PO is raised but stock not checked in', () => {
    const r = getMappedItemReadiness({
      linkedDecoItemId: 'SKU@@@0',
      procurementStatus: 20,
      productionStatus: 80,
      decoProduced: true,
    });
    expect(r).toBe('stock_ordered');
    expect(isItemReadyForDispatch({ linkedDecoItemId: 'SKU@@@0', procurementStatus: 20, decoProduced: true })).toBe(false);
  });

  it('marks awaiting stock when nothing is on order yet', () => {
    const r = getMappedItemReadiness({
      linkedDecoItemId: 'SKU@@@0',
      procurementStatus: 0,
    });
    expect(r).toBe('awaiting_stock');
    expect(isItemReadyForDispatch({ linkedDecoItemId: 'SKU@@@0', procurementStatus: 0 })).toBe(false);
  });

  it('marks produced lines ready when stock is checked in', () => {
    const r = getMappedItemReadiness({
      linkedDecoItemId: 'SKU@@@0',
      procurementStatus: 60,
      productionStatus: 80,
      decoProduced: true,
    });
    expect(r).toBe('ready_to_ship');
  });

  it('does not mark Deco Shipped jobs as ready to ship', () => {
    const summary = deriveOrderProductionStatus('Shipped', [
      { linkedDecoItemId: 'a', procurementStatus: 60, decoProduced: true, productionStatus: 80 },
    ]);
    expect(summary.isReadyToShip).toBe(false);
    expect(summary.label).toBe('Shipped');
  });

  it('marks Deco Completed jobs as ready to ship when items are dispatch-ready', () => {
    const summary = deriveOrderProductionStatus('Completed', [
      { linkedDecoItemId: 'a', procurementStatus: 60, decoProduced: true, productionStatus: 80 },
    ]);
    expect(summary.isReadyToShip).toBe(true);
  });

  it('shows partial order status when some lines await stock', () => {
    const summary = deriveOrderProductionStatus('Awaiting Stock', [
      { linkedDecoItemId: 'a', procurementStatus: 20 },
      { linkedDecoItemId: 'b', procurementStatus: 60, decoProduced: true, productionStatus: 80 },
    ]);
    expect(summary.label).toBe('Partial — 1 awaiting stock');
    expect(summary.awaitingStockCount).toBe(1);
    expect(summary.readyToShipCount).toBe(1);
    expect(summary.isReadyToShip).toBe(false);
  });
});
