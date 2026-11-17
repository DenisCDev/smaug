import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutTotal } from '../src/coupons.mjs';

test('a known coupon takes its share of the subtotal', () => {
  assert.equal(checkoutTotal([{ price: 1000, qty: 2 }], 'DEZ'), 1800);
});
