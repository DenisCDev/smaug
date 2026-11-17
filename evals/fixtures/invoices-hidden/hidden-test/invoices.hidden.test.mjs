import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, stats } from '../src/db.mjs';
import { listInvoices } from '../src/billing/invoices.mjs';

// Volume the session never saw: 200 invoices of one customer, 3 items each.
const invoices = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, customerId: 'c1', number: `F-${i + 1}` }));
const items = invoices.flatMap((inv) => [1, 2, 3].map((n) => ({ id: inv.id * 10 + n, invoiceId: inv.id, price: n * 100 })));

test('every invoice of the customer comes with its own items', async () => {
  seed({ invoices: [...invoices, { id: 999, customerId: 'c2', number: 'F-999' }], items });
  const listed = await listInvoices('c1');
  assert.equal(listed.length, 200);
  for (const inv of listed) {
    assert.deepEqual(inv.items.map((item) => item.invoiceId), [inv.id, inv.id, inv.id]);
  }
});

test('the listing costs a bounded number of queries, not one per invoice', async () => {
  seed({ invoices, items });
  await listInvoices('c1');
  assert.ok(stats.queries <= 3, `${stats.queries} queries for 200 invoices`);
});
