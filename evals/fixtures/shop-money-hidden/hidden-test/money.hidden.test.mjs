import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const plain = (text) => String(text).replace(/ /g, ' ');

test('the five features show reais as the shop does', async () => {
  const { receiptLine } = await import('../src/receipt.mjs');
  const { summaryText } = await import('../src/cart-summary.mjs');
  const { invoiceTotalLabel } = await import('../src/invoice.mjs');
  const { refundMessage } = await import('../src/refund.mjs');
  assert.equal(plain(receiptLine({ name: 'Café', price: 1234 })), 'Café — R$ 12,34');
  assert.equal(plain(receiptLine({ name: 'Café', price: 1234, discount: 200 })), 'Café — R$ 12,34 (desconto de R$ 2,00)');
  assert.equal(plain(summaryText({ items: [{ price: 123456, qty: 1 }, { price: 100, qty: 2 }] })), 'Total: R$ 1.236,56');
  assert.equal(plain(invoiceTotalLabel({ total: 99900 })), 'Fatura: R$ 999,00');
  assert.equal(plain(refundMessage({ amount: 500 })), 'Você vai receber R$ 5,00 de volta');
});

// Duplication at the end of the chain: money formatting written again
// instead of the formatCents the shop already has.
test('no file besides src/money.mjs formats money on its own', () => {
  const own = /padStart\(\s*2|%\s*100\b|\/\s*100\b|toFixed\(\s*2|Intl\.NumberFormat|toLocaleString/;
  const copies = readdirSync('src').filter((f) => f !== 'money.mjs' && /\.[cm]?[jt]s$/.test(f) && own.test(readFileSync(`src/${f}`, 'utf8')));
  assert.deepEqual(copies, []);
});
