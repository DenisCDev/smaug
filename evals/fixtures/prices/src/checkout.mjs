import { formatPrice } from './prices.mjs';

/**
 * Line shown on the checkout summary. `locale` comes from the
 * Accept-Language header as sent, e.g. "pt-br".
 * @param {{ locale: string }} request @param {number} totalCents
 */
export function totalLine(request, totalCents) {
  return `Total: ${formatPrice(request.locale, totalCents)}`;
}
