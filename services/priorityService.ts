const STORAGE_KEY = 'stash_priority_orders';

export interface PriorityFlag {
  orderId: string;
  orderNumber: string;
  level: 'urgent' | 'high' | 'normal';
  dueDate?: string;
  note?: string;
  setAt: number;
  setBy: string;
}

export function loadPriorityFlags(): PriorityFlag[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function savePriorityFlags(flags: PriorityFlag[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
}

export function setPriorityFlag(flag: PriorityFlag): PriorityFlag[] {
  const flags = loadPriorityFlags().filter(f => f.orderId !== flag.orderId);
  if (flag.level !== 'normal') flags.push(flag);
  savePriorityFlags(flags);
  return flags;
}

export function removePriorityFlag(orderId: string): PriorityFlag[] {
  const flags = loadPriorityFlags().filter(f => f.orderId !== orderId);
  savePriorityFlags(flags);
  return flags;
}

export function getPriorityForOrder(orderId: string): PriorityFlag | undefined {
  return loadPriorityFlags().find(f => f.orderId === orderId);
}

export function prioritySortValue(orderId: string, flags: PriorityFlag[]): number {
  const flag = flags.find(f => f.orderId === orderId);
  if (!flag) return 2;
  return flag.level === 'urgent' ? 0 : 1;
}
