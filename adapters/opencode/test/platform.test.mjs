// Contracts with the OpenCode runtime itself. These assert the shapes the
// runtime really produces and consumes — a test that asserts our own
// convention would let a no-op hook ship green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE, PLUGIN, fakeClient } from './helpers.mjs';

process.env.SMUGAN_GATE_DIR = GATE;
const mod = await import(PLUGIN);

test('the plugin file exports exactly one value, and it is a function', () => {
  // OpenCode's loader iterates every export and throws TypeError on anything
  // that is not a function — which takes down every installed plugin, not
  // just this one. Helper modules therefore live outside plugins/.
  const values = Object.values(mod);
  assert.equal(values.length, 1);
  assert.equal(typeof values[0], 'function');
});

// Provider.models is Record<string, Model>; the runtime spreads the value we
// return and then reads .id / .providerID / .api (including .api.npm) on it.
const providerWith = (id, models) => ({
  id,
  name: id,
  models: Object.fromEntries(models.map((m) => [m, {
    id: m,
    providerID: id,
    name: m,
    api: { id: m, url: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible' },
  }])),
});

test('the title-agent diversion hands over a real model record', async () => {
  const hooks = await mod.smugan({ client: fakeClient() });
  const divert = hooks['experimental.provider.small_model'];

  const output = { model: undefined };
  await divert({ provider: providerWith('opencode', ['big-pickle', 'deepseek-v4-flash-free']) }, output);
  assert.equal(typeof output.model, 'object', 'a bare string would break the runtime spread');
  assert.equal(output.model.id, 'big-pickle');
  assert.equal(output.model.providerID, 'opencode');
  assert.ok(output.model.api?.npm, 'the runtime reads .api.npm on the model it gets');
});

test('the diversion stays silent for other providers and unknown models', async () => {
  const hooks = await mod.smugan({ client: fakeClient() });
  const divert = hooks['experimental.provider.small_model'];

  const other = { model: undefined };
  await divert({ provider: providerWith('anthropic', ['claude-haiku-4-5']) }, other);
  assert.equal(other.model, undefined);

  // A model this provider does not offer must leave OpenCode's own fallback
  // alone — an invented object would be truthy and silently replace it.
  const missing = { model: undefined };
  await divert({ provider: providerWith('opencode', ['deepseek-v4-flash-free']) }, missing);
  assert.equal(missing.model, undefined);
});

test('only the hooks the runtime actually honours are registered', async () => {
  const hooks = await mod.smugan({ client: fakeClient() });
  // The steering cannot arrive twice: OpenCode stops at the first instruction
  // file that exists (config/AGENTS.md, which the installer always writes), so
  // ~/.claude/CLAUDE.md is never read and a dedupe hook would be dead code.
  assert.ok(!('experimental.chat.system.transform' in hooks));
  assert.deepEqual(Object.keys(hooks).sort(), [
    'chat.message',
    'event',
    'experimental.provider.small_model',
    'tool.execute.after',
    'tool.execute.before',
  ]);
});
