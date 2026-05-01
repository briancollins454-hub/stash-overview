/**
 * Human-readable staff name from Deco `salesPerson` (string or nested API object).
 */
export function displayStaffName(sp: unknown): string | undefined {
  if (sp == null) return undefined;
  if (typeof sp === 'string') {
    const t = sp.trim();
    return t || undefined;
  }
  if (typeof sp === 'object') {
    const o = sp as Record<string, unknown>;
    if (o.firstname || o.lastname) {
      const s = `${String(o.firstname || '')} ${String(o.lastname || '')}`.trim();
      if (s) return s;
    }
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
    if (typeof o.full_name === 'string' && o.full_name.trim()) return o.full_name.trim();
    if (typeof o.login === 'string' && o.login.trim()) return o.login.trim();
    const strVal = Object.values(o).find((v): v is string => typeof v === 'string' && v.length > 1);
    if (strVal) return strVal;
    if (o.id != null) return String(o.id);
  }
  const s = String(sp).trim();
  return s || undefined;
}
