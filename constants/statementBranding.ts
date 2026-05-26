// ─── Marx Corporate — open-item statement PDF branding ───────────────────

export const STATEMENT_COLORS = {
  green: [156, 198, 84] as const,
  greenDark: [106, 158, 50] as const,
  greenText: [90, 140, 40] as const,
  headerText: [255, 255, 255] as const,
  overdueRed: [192, 40, 40] as const,
  /** Saturated red used for the aging-summary past-due column fills. */
  overdueRedDeep: [176, 18, 18] as const,
  /** Soft red row fill — used to make every overdue invoice line scream "PAST DUE". */
  overdueRowFill: [253, 226, 226] as const,
  /** Stronger red for top "PAST DUE" banner background. */
  overdueBannerFill: [220, 38, 38] as const,
} as const;

/** Shopify brand trio — use this URL in the statement PDF header (top right). */
export const BRAND_TRIO_SHOPIFY_URL =
  'https://cdn.shopify.com/s/files/1/1075/6304/files/brand_trio_image.png?v=1779267381';

/** Trimmed brand stack from Shopify (regenerate: node scripts/crop-statement-logo.mjs) */
export const STATEMENT_LOGO_SIZE = { width: 779, height: 955 } as const;

export const STATEMENT_LOGO_URL = '/statement-brand-trio.png';

export const BRAND_TRIO_LOGO_URL = STATEMENT_LOGO_URL;
export const BRAND_TRIO_LOGO_SIZE = STATEMENT_LOGO_SIZE;

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

export interface StripePayLink {
  label: string;
  currency: string;
  url: string;
}

export const STATEMENT_PAYMENT = {
  cardIntro: 'Choose your currency and click Pay Now:',
  stripeLinks: [
    {
      label: 'Pay Now',
      currency: 'GBP £',
      url: 'https://buy.stripe.com/6oE8z2gXr56h7Hq3cc',
    },
    {
      label: 'Pay Now',
      currency: 'EUR €',
      url: 'https://buy.stripe.com/00gg1u0YtdCN1j23ce',
    },
  ] as StripePayLink[],
  bankIntro: 'Or pay by bank transfer:',
  accountName: 'R E M SMALL T/A MARX',
  sortCode: '93-80-17',
  accountNo: '71131074',
} as const;

export function formatPaymentInstructions(
  payment: typeof STATEMENT_PAYMENT = STATEMENT_PAYMENT,
): string {
  const cardLines = payment.stripeLinks.flatMap(link => [
    `${link.label} (${link.currency}): ${link.url}`,
  ]);
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
