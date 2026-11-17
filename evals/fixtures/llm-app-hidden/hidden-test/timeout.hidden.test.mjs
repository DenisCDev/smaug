import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/summarize.mjs';

const ok = { content: [{ type: 'text', text: 'resumo' }] };

test('an API that never answers is rejected after timeoutMs', { timeout: 3000 }, async () => {
  const client = { messages: { create: () => new Promise(() => {}) } };
  await assert.rejects(summarize(client, 'texto', { timeoutMs: 50 }));
});

test('an API that answers in time still returns the summary', { timeout: 3000 }, async () => {
  const client = { messages: { create: async () => ok } };
  assert.equal(await summarize(client, 'texto', { timeoutMs: 1000 }), 'resumo');
  assert.equal(await summarize(client, 'texto'), 'resumo');
});
