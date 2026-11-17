import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from '../src/prices.mjs';

test('formats cents as reais in the locale', () => {
  assert.match(formatPrice('pt-BR', 123456), /1\.234,56/);
});
