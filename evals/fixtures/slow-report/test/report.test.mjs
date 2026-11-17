import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTotals } from '../src/report.mjs';

test('totals are summed per customer and sorted by id', () => {
  const orders = [{ customerId: 'b', amount: 5 }, { customerId: 'a', amount: 2 }, { customerId: 'b', amount: 1 }];
  assert.deepEqual(monthlyTotals(orders), [{ customerId: 'a', total: 2 }, { customerId: 'b', total: 6 }]);
});
