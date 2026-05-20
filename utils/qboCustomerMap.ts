/** Map QuickBooks Customer entities → directory / statement fields */

export interface QboCustomerRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  addressLines: string[];
  balance: number;
}

function coerceAddrPart(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  return '';
}

function qboAddrLines(addr: Record<string, unknown> | undefined): string[] {
  if (!addr) return [];
  const lines: string[] = [];
  const push = (v: unknown) => {
    const t = coerceAddrPart(v);
    if (t) lines.push(t);
  };
  push(addr.Line1);
  push(addr.Line2);
  push(addr.Line3);
  push(addr.Line4);
  push(addr.Line5);
  const city = coerceAddrPart(addr.City);
  const county = coerceAddrPart(addr.CountrySubDivisionCode) || coerceAddrPart(addr.County);
  const postal = coerceAddrPart(addr.PostalCode);
  const country = coerceAddrPart(addr.Country);
  if (city) lines.push(city);
  if (postal && !lines.some(l => l.includes(postal))) lines.push(postal);
  if (county && !lines.some(l => normAddrKey(l) === normAddrKey(county))) lines.push(county);
  if (country && country !== 'UK' && country !== 'GB' && !lines.some(l => l.includes(country))) {
    lines.push(country);
  }
  return lines;
}

function normAddrKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mergeAddrLines(...groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const l of group) {
      const t = l.trim();
      const key = normAddrKey(t);
      if (t && !seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

export function customerAddrLinesFromQbo(c: Record<string, unknown>): string[] {
  const bill = qboAddrLines(c.BillAddr as Record<string, unknown> | undefined);
  const ship = qboAddrLines(c.ShipAddr as Record<string, unknown> | undefined);
  const merged = mergeAddrLines(bill, ship);
  if (merged.length > 0) return merged;
  const company = typeof c.CompanyName === 'string' ? c.CompanyName.trim() : '';
  return company ? [company] : [];
}

/** Billing address from an open invoice when the Customer record has none in the API. */
export function invoiceAddrLinesFromQbo(inv: Record<string, unknown>): string[] {
  const bill = qboAddrLines(inv.BillAddr as Record<string, unknown> | undefined);
  const ship = qboAddrLines(inv.ShipAddr as Record<string, unknown> | undefined);
  return mergeAddrLines(bill, ship);
}

export function mapQboCustomer(c: Record<string, unknown>): QboCustomerRecord {
  const emailObj = c.PrimaryEmailAddr as { Address?: string } | undefined;
  const email = typeof emailObj?.Address === 'string' ? emailObj.Address.trim() : '';
  const phoneObj = c.PrimaryPhone as { FreeFormNumber?: string } | undefined;
  const phone = typeof phoneObj?.FreeFormNumber === 'string' ? phoneObj.FreeFormNumber.trim() : '';
  const name = typeof c.DisplayName === 'string' ? c.DisplayName : '';
  const addressLines = customerAddrLinesFromQbo(c);
  return {
    id: String(c.Id ?? ''),
    name,
    email: email || null,
    phone: phone || null,
    addressLines: addressLines.length > 0 ? addressLines : (name ? [name] : []),
    balance: typeof c.Balance === 'number' ? c.Balance : Number(c.Balance) || 0,
  };
}
