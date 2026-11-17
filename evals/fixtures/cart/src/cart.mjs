/**
 * Order total in cents.
 * @param {{ price: number, qty: number }[]} items
 * @param {{ percent: number } | null} [coupon]
 */
export function total(items, coupon = null) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (!coupon) return subtotal;
  return subtotal - coupon.percent;
}
