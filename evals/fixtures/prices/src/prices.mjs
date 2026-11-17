export class PriceFormatter {
  /** @param {string} locale */
  constructor(locale) {
    this.intl = new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' });
  }

  /** @param {number} cents */
  format(cents) {
    return this.intl.format(cents / 100);
  }
}

/** @param {string} locale @param {number} cents */
export function formatPrice(locale, cents) {
  return new PriceFormatter(locale).format(cents);
}
