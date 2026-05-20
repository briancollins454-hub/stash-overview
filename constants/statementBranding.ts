// ─── Marx Corporate — open-item statement PDF branding ───────────────────
// Matches QuickBooks “account print” / MCB statement layout used in finance.

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

export const STATEMENT_PAYMENT = {
  cardIntro: 'You can pay via card on the relevant link below:',
  stripeGbp: 'GBP £ - https://buy.stripe.com/6oE8z2gXr56h7Hq3cc',
  stripeEuro: 'EURO € - https://buy.stripe.com/00gg1u0YtdCN1j23ce',
  bankIntro: 'Pay Via Bank Transfer using details below:',
  accountName: 'R E M SMALL T/A MARX',
  sortCode: '93-80-17',
  accountNo: '71131074',
} as const;
