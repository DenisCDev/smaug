import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

test('a percentage coupon takes that share of the subtotal', () => {
  assert.equal(total([{ price: 1000, qty: 2 }], { percent: 10 }), 1800);
  assert.equal(total([{ price: 500, qty: 4 }, { price: 1000, qty: 1 }], { percent: 50 }), 1500);
});

test('no coupon and an empty cart keep working', () => {
  assert.equal(total([{ price: 1000, qty: 2 }]), 2000);
  assert.equal(total([], { percent: 10 }), 0);
});
