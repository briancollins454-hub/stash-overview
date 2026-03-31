const STORAGE_KEY = 'stash_artwork_approvals';

export interface ArtworkApproval {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  itemName: string;
  status: 'pending' | 'sent' | 'approved' | 'revision_needed' | 'final_approved';
  sentAt?: number;
  respondedAt?: number;
  notes?: string;
  revisionCount: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export const ARTWORK_STATUS_LABELS: Record<ArtworkApproval['status'], string> = {
  pending: 'Awaiting Send',
  sent: 'Sent to Customer',
  approved: 'Approved',
  revision_needed: 'Revision Needed',
  final_approved: 'Final Approved',
};

export function loadArtworkApprovals(): ArtworkApproval[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function saveArtworkApprovals(approvals: ArtworkApproval[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(approvals));
}

export function addArtworkApproval(approval: Omit<ArtworkApproval, 'id' | 'createdAt' | 'updatedAt' | 'revisionCount'>): ArtworkApproval[] {
  const approvals = loadArtworkApprovals();
  approvals.unshift({
    ...approval,
    id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    revisionCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  saveArtworkApprovals(approvals);
  return approvals;
}

export function updateArtworkApproval(id: string, updates: Partial<ArtworkApproval>): ArtworkApproval[] {
  const approvals = loadArtworkApprovals();
  const idx = approvals.findIndex(a => a.id === id);
  if (idx >= 0) {
    approvals[idx] = { ...approvals[idx], ...updates, updatedAt: Date.now() };
    saveArtworkApprovals(approvals);
  }
  return approvals;
}

export function deleteArtworkApproval(id: string): ArtworkApproval[] {
  const approvals = loadArtworkApprovals().filter(a => a.id !== id);
  saveArtworkApprovals(approvals);
  return approvals;
}

export function getApprovalCountsByStatus(): Record<string, number> {
  const approvals = loadArtworkApprovals();
  const counts: Record<string, number> = {};
  approvals.forEach(a => {
    counts[a.status] = (counts[a.status] || 0) + 1;
  });
  return counts;
}
