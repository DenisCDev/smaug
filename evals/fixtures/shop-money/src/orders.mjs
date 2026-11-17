import { formatCents } from './money.mjs';

/** One line of the order history. */
export function orderLine(order) {
  return `Pedido ${order.id}: ${formatCents(order.total)}`;
}
