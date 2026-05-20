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

export const STATEMENT_PAYMENT = {
  cardIntro: 'You can pay via card on the relevant link below:',
  stripeGbp: 'GBP £ - https://buy.stripe.com/6oE8z2gXr56h7Hq3cc',
  stripeEuro: 'EURO € - https://buy.stripe.com/00gg1u0YtdCN1j23ce',
  bankIntro: 'Pay Via Bank Transfer using details below:',
  accountName: 'R E M SMALL T/A MARX',
  sortCode: '93-80-17',
  accountNo: '71131074',
} as const;

/** Plain-text payment block for emails and copy-paste. */
export function formatPaymentInstructions(
  payment: typeof STATEMENT_PAYMENT = STATEMENT_PAYMENT,
): string {
  return [
    'HOW TO PAY',
    '',
    payment.cardIntro,
    payment.stripeGbp,
    payment.stripeEuro,
    '',
    payment.bankIntro,
    `Account Name: ${payment.accountName}`,
    `Sort Code: ${payment.sortCode}`,
    `Account No: ${payment.accountNo}`,
  ].join('\n');
}
