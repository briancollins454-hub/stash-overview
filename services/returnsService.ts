const STORAGE_KEY = 'stash_returns';

export interface ReturnRecord {
  id: string;
  originalOrderNumber: string;
  originalOrderId: string;
  customerName: string;
  itemName: string;
  sku: string;
  size: string;
  quantity: number;
  reason: 'wrong_size' | 'print_defect' | 'wrong_item' | 'damage' | 'customer_change' | 'other';
  reasonDetail?: string;
  status: 'received' | 'inspected' | 'remake_ordered' | 'remake_shipped' | 'resolved';
  remakeJobId?: string;
  remakeOrderNumber?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export const REASON_LABELS: Record<ReturnRecord['reason'], string> = {
  wrong_size: 'Wrong Size',
  print_defect: 'Print Defect',
  wrong_item: 'Wrong Item Sent',
  damage: 'Damaged in Transit',
  customer_change: 'Customer Changed Mind',
  other: 'Other',
};

export const STATUS_LABELS: Record<ReturnRecord['status'], string> = {
  received: 'Received',
  inspected: 'Inspected',
  remake_ordered: 'Remake Ordered',
  remake_shipped: 'Remake Shipped',
  resolved: 'Resolved',
};

export function loadReturns(): ReturnRecord[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function saveReturns(records: ReturnRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function addReturn(record: Omit<ReturnRecord, 'id' | 'createdAt' | 'updatedAt'>): ReturnRecord[] {
  const returns = loadReturns();
  const newRecord: ReturnRecord = {
    ...record,
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  returns.unshift(newRecord);
  saveReturns(returns);
  return returns;
}

export function updateReturn(id: string, updates: Partial<ReturnRecord>): ReturnRecord[] {
  const returns = loadReturns();
  const idx = returns.findIndex(r => r.id === id);
  if (idx >= 0) {
    returns[idx] = { ...returns[idx], ...updates, updatedAt: Date.now() };
    saveReturns(returns);
  }
  return returns;
}

export function deleteReturn(id: string): ReturnRecord[] {
  const returns = loadReturns().filter(r => r.id !== id);
  saveReturns(returns);
  return returns;
}
