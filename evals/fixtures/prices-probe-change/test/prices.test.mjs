import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../src/boot.mjs';
import { PriceFormatter, formatPrice, getFormatter } from '../src/prices.mjs';

boot();

test('formats cents as reais in the locale', () => {
  assert.match(formatPrice('pt-BR', 123456), /1\.234,56/);
});

test('reuses one formatter per supported locale', () => {
  const first = getFormatter('pt-br');
  assert.ok(first instanceof PriceFormatter);
  assert.equal(getFormatter('pt-br'), first);
});
