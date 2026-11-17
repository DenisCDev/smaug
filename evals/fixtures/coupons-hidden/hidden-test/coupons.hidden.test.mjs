import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CouponError, checkoutTotal, checkoutSummary } from '../src/coupons.mjs';

const items = [{ price: 1000, qty: 2 }];

test('PR1: a blank coupon field means no coupon', () => {
  assert.equal(checkoutTotal(items, ''), 2000);
  assert.equal(checkoutTotal(items, '   '), 2000);
  assert.equal(checkoutTotal(items), 2000);
});

test('PR1 keeps the contract: an unknown code is still a CouponError', () => {
  assert.throws(() => checkoutTotal(items, 'XYZ'), CouponError);
});

test('PR2: the summary applies a known coupon, normalized', () => {
  assert.deepEqual(checkoutSummary(items, ' dez '), { subtotal: 2000, discount: 200, total: 1800, coupon: 'DEZ' });
});

test('PR2: the summary without a coupon has no discount and a null coupon', () => {
  assert.deepEqual(checkoutSummary(items, ''), { subtotal: 2000, discount: 0, total: 2000, coupon: null });
  assert.deepEqual(checkoutSummary(items), { subtotal: 2000, discount: 0, total: 2000, coupon: null });
});

test('PR2: an unknown code in the summary is a CouponError, as in the total', () => {
  assert.throws(() => checkoutSummary(items, 'XYZ'), CouponError);
});
