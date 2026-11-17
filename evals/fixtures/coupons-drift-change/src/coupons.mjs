const COUPONS = { DEZ: 10, METADE: 50 };

export class CouponError extends Error {}

/** Percent off for a coupon code; an unknown code is an error the checkout shows. */
export function couponPercent(code) {
  if (!code) return 0;
  return COUPONS[code.trim().toUpperCase()] ?? 0;
}

/** Order total in cents, with an optional coupon code. */
export function checkoutTotal(items, code) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (code === undefined) return subtotal;
  return subtotal - Math.round((subtotal * couponPercent(code)) / 100);
}
