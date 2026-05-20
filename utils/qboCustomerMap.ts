/** Map QuickBooks Customer entities → directory / statement fields */

export interface QboCustomerRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  addressLines: string[];
  balance: number;
}

function qboAddrLines(addr: Record<string, unknown> | undefined): string[] {
  if (!addr) return [];
  const lines: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) lines.push(v.trim());
  };
  push(addr.Line1);
  push(addr.Line2);
  push(addr.Line3);
  push(addr.Line4);
  push(addr.Line5);
  const city = typeof addr.City === 'string' ? addr.City.trim() : '';
  const county = typeof addr.CountrySubDivisionCode === 'string'
    ? addr.CountrySubDivisionCode.trim()
    : '';
  const postal = typeof addr.PostalCode === 'string' ? addr.PostalCode.trim() : '';
  const country = typeof addr.Country === 'string' ? addr.Country.trim() : '';
  if (city && postal) lines.push(`${city}, ${postal}`);
  else if (city) lines.push(city);
  else if (postal) lines.push(postal);
  if (county && !lines.some(l => l.includes(county))) lines.push(county);
  if (country && country !== 'UK' && country !== 'GB') lines.push(country);
  return lines;
}

export function customerAddrLinesFromQbo(c: Record<string, unknown>): string[] {
  const bill = qboAddrLines(c.BillAddr as Record<string, unknown> | undefined);
  if (bill.length > 0) return bill;
  const ship = qboAddrLines(c.ShipAddr as Record<string, unknown> | undefined);
  if (ship.length > 0) return ship;
  const company = typeof c.CompanyName === 'string' ? c.CompanyName.trim() : '';
  return company ? [company] : [];
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
