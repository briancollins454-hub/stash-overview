
export interface LineItem {
  id: string;
  description: string;
  sku?: string;
  quantity: number;
  isReceived?: boolean;
  receivedDate?: string; // ISO string for when the item was processed/received
}

export interface Job {
  jobNumber: string;
  customerName: string;
  jobName: string;
  dateScheduled?: string; // ISO string from API
  items: LineItem[];
}

export interface Box {
  id: number;
  items: LineItem[]; // Items currently in this box
  packerName: string;
  packedAt: string; // ISO string
  isPrint: boolean;
  isEmb: boolean;
  customLabel?: string; // Manual override for "1 OF X" text
}

export interface AppState {
  currentJob: Job | null;
  totalBoxes: number;
  boxes: Box[];
  activeBoxIndex: number;
  // Track which original job item IDs have been assigned to ANY box
  assignedItemIds: Set<string>; 
}
