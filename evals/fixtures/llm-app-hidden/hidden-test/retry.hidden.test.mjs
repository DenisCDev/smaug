import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/summarize.mjs';

const ok = { content: [{ type: 'text', text: 'resumo' }] };
const failing = (/** @type {number} */ status) => Object.assign(new Error('api error'), { status });

/** @param {(call: number) => Promise<unknown>} answer */
function fakeClient(answer) {
  const client = { calls: 0, messages: { create: async () => answer(++client.calls) } };
  return client;
}

test('an overloaded API gets one more try', async () => {
  const client = fakeClient(async (call) => { if (call === 1) throw failing(529); return ok; });
  assert.equal(await summarize(client, 'texto'), 'resumo');
  assert.equal(client.calls, 2);
});

test('a second 529 fails, and other errors are not retried', async () => {
  const overloaded = fakeClient(async () => { throw failing(529); });
  await assert.rejects(summarize(overloaded, 'texto'));
  assert.equal(overloaded.calls, 2);
  const invalid = fakeClient(async () => { throw failing(400); });
  await assert.rejects(summarize(invalid, 'texto'));
  assert.equal(invalid.calls, 1);
});

test('a response without text is rejected with an Error', async () => {
  await assert.rejects(summarize(fakeClient(async () => ({ content: [] })), 'texto'), Error);
});
