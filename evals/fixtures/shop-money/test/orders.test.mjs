import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderLine } from '../src/orders.mjs';

test('an order line shows the total in reais', () => {
  assert.equal(orderLine({ id: 7, total: 123456 }), 'Pedido 7: R$ 1.234,56');
});
