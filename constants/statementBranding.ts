// ─── Marx Corporate — open-item statement PDF branding ───────────────────
// Visual match for QuickBooks account print / MCB customer statements.

export const STATEMENT_COLORS = {
  /** Lime green — “Statement” title & table header */
  green: [156, 198, 84] as const,
  greenText: [90, 140, 40] as const,
  headerText: [255, 255, 255] as const,
} as const;

export const STATEMENT_COMPANY = {
  name: 'Marx Corporate',
  addressLines: [
    '20 Church Street, Ballymena',
    'Antrim',
    'BT43 6DE',
  ],
  email: 'accounts@marxcorporate.com',
  website: 'www.stashshop.co.uk',
} as const;

/** Stash wordmark (SVG on CDN — fetched when building PDF) */
export const STASH_LOGO_URL =
  'https://stashshop.co.uk/cdn/shop/files/stash_shop_text_only_2025_outline_1.svg?v=1753488880';

export interface StripePayLink {
  label: string;
  url: string;
}

export const STATEMENT_PAYMENT = {
  cardIntro: 'You can pay by card using one of the links below:',
  stripeLinks: [
    { label: 'Pay in GBP (£)', url: 'https://buy.stripe.com/6oE8z2gXr56h7Hq3cc' },
    { label: 'Pay in EUR (€)', url: 'https://buy.stripe.com/00gg1u0YtdCN1j23ce' },
  ] as StripePayLink[],
  bankIntro: 'Or pay by bank transfer:',
  accountName: 'R E M SMALL T/A MARX',
  sortCode: '93-80-17',
  accountNo: '71131074',
} as const;

/** Plain-text payment block for emails (URLs on their own lines — clients auto-link). */
export function formatPaymentInstructions(
  payment: typeof STATEMENT_PAYMENT = STATEMENT_PAYMENT,
): string {
  const cardLines = payment.stripeLinks.flatMap(link => [link.label, link.url]);
  return [
    'HOW TO PAY',
    '',
    payment.cardIntro,
    ...cardLines,
    '',
    payment.bankIntro,
    `Account Name: ${payment.accountName}`,
    `Sort Code: ${payment.sortCode}`,
    `Account No: ${payment.accountNo}`,
  ].join('\n');
}
