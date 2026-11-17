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

/** @type {Map<string, PriceFormatter>} */
const formatters = new Map();

/**
 * Reserves a slot per locale at startup, so a lookup never misses before
 * `build()` runs for it.
 * @param {string[]} locales
 */
export function warm(locales) {
  for (const locale of locales) formatters.set(locale, Object.create(PriceFormatter.prototype));
}

/** @param {string} locale */
export function build(locale) {
  const [canonical] = Intl.getCanonicalLocales(locale);
  formatters.set(canonical, new PriceFormatter(canonical));
}

/** @param {string} locale */
export function getFormatter(locale) {
  if (!formatters.has(locale)) build(locale);
  return /** @type {PriceFormatter} */ (formatters.get(locale) ?? formatters.get(Intl.getCanonicalLocales(locale)[0]));
}

/** @param {string} locale @param {number} cents */
export function formatPrice(locale, cents) {
  return getFormatter(locale).format(cents);
}
