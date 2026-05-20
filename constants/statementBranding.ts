// ─── Marx Corporate — open-item statement PDF branding ───────────────────

export const STATEMENT_COLORS = {
  green: [156, 198, 84] as const,
  greenDark: [106, 158, 50] as const,
  greenText: [90, 140, 40] as const,
  headerText: [255, 255, 255] as const,
  overdueRed: [192, 40, 40] as const,
} as const;

/** Same-origin asset (reliable in PDF) — see public/statement-brand-trio.png */
export const BRAND_TRIO_LOGO_PATH = '/statement-brand-trio.png?v=3';

/** Shopify CDN fallback if the bundled file is missing */
export const BRAND_TRIO_LOGO_CDN =
  'https://cdn.shopify.com/s/files/1/1075/6304/files/brand_trio_image.png?v=1779267381';

export const BRAND_TRIO_LOGO_URL = BRAND_TRIO_LOGO_PATH;

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
