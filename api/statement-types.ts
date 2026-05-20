/** Types for statement email/PDF — kept under /api for Vercel bundling. */

export interface StatementCustomerInfo {
  accountId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  addressLines: string[];
}

export interface OpenItemLine {
  invoiceId: string;
  docNumber: string;
  txnDateShort: string;
  dueDateShort: string;
  isOverdue: boolean;
  daysPastDue: number;
  amountDue: number;
}

export interface AgingSummary {
  current: number;
  pastDue1_30: number;
  pastDue31_60: number;
  pastDue61_90: number;
  pastDue90Plus: number;
  total: number;
}

export interface OpenItemStatement {
  customerName: string;
  customerId: string;
  customer: StatementCustomerInfo;
  asAtDate: string;
  asAtDateShort: string;
  statementNumber: string;
  customerAddressLines: string[];
  lines: OpenItemLine[];
  totalOutstanding: number;
  aging: AgingSummary;
}
