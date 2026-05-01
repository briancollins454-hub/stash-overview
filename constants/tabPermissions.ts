/**
 * Permission tabs for custom users — must match `validTabs` / navigation in App.tsx
 * (excluding `guide` and `widget`, which are not grantable). `settings` controls the
 * settings modal + shortcut; it is not a ?tab= route.
 *
 * Server-side copy for sanitisation lives inline in `api/users.ts` (Vercel bundling).
 * When you change this file, update that array there too.
 *
 * When adding a new page: add it here, wire `validTabs` + nav in App.tsx, update api/users.ts, deploy.
 */

export const APP_TAB_DEFINITIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'daily-tasks', label: 'Daily tasks' },
  { id: 'summary', label: 'Mobile summary' },
  { id: 'command', label: 'Live command' },
  { id: 'priority', label: 'Priority board' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'operations', label: 'Ops centre' },
  { id: 'fulfill', label: 'Fulfillment' },
  { id: 'autolink', label: 'Auto linker' },
  { id: 'production', label: 'Production' },
  { id: 'shop-floor', label: 'Shop floor' },
  { id: 'deco', label: 'Deco network' },
  { id: 'mto', label: 'Made to order' },
  { id: 'stock', label: 'Stock manager' },
  { id: 'inventory', label: 'Shopify inventory' },
  { id: 'wholesale', label: 'Wholesale lookup' },
  { id: 'issues', label: 'Issue log' },
  { id: 'intelligence', label: 'Intel' },
  { id: 'reports', label: 'Reports' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'analyst', label: 'Process analyst' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'sales', label: 'Sales analytics' },
  { id: 'finance', label: 'Finance hub' },
  { id: 'shipped-not-invoiced', label: 'Shipped not invoiced' },
  { id: 'credit-block', label: 'Credit block' },
  { id: 'unpaid-orders', label: 'Unpaid orders' },
  { id: 'digest', label: 'Email digest' },
  { id: 'users', label: 'User management' },
  { id: 'cloud-health', label: 'Cloud health' },
  { id: 'manual', label: 'Manual' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'settings', label: 'Settings' },
];

export const APP_TAB_IDS: string[] = APP_TAB_DEFINITIONS.map(t => t.id);

const MANAGER_TAB_IDS: string[] = [
  'dashboard',
  'briefing',
  'command',
  'daily-tasks',
  'summary',
  'priority',
  'kanban',
  'operations',
  'production',
  'shop-floor',
  'deco',
  'mto',
  'stock',
  'inventory',
  'wholesale',
  'issues',
  'fulfill',
  'autolink',
  'manual',
  'alerts',
];

const VIEWER_TAB_IDS: string[] = ['dashboard', 'briefing', 'summary', 'reports', 'revenue', 'sales'];

/** Default tab sets when creating a user or resetting role — copy returned fresh. */
export function getDefaultTabsForRole(role: string): string[] {
  switch (role) {
    case 'superuser':
      return [...APP_TAB_IDS];
    case 'admin':
      return APP_TAB_IDS.filter(id => id !== 'settings');
    case 'manager':
      return [...MANAGER_TAB_IDS];
    case 'viewer':
      return [...VIEWER_TAB_IDS];
    default:
      return [...VIEWER_TAB_IDS];
  }
}
