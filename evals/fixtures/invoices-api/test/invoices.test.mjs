import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/db.mjs';
import { getInvoice } from '../src/billing/invoices.mjs';

test('an invoice is found by id', async () => {
  seed({ invoices: [{ id: 1, customerId: 'c1', number: 'F-1' }] });
  assert.deepEqual(await getInvoice(1), { id: 1, customerId: 'c1', number: 'F-1' });
  assert.equal(await getInvoice(2), null);
});
