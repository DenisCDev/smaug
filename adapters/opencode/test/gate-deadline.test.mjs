// The engine's Stop plans its second check against a deadline; the plugin
// kills the child at its own timeout, so the Stop child must get that one.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGate } from '../opencode/smugan/gate.mjs';

const fake = mkdtempSync(join(tmpdir(), 'smugan-oc-fake-gate-'));
mkdirSync(join(fake, 'src'));
writeFileSync(join(fake, 'src', 'hook.mjs'), "export async function runHook() { return { exitCode: 2, stderr: process.env.SMUGAN_STOP_DEADLINE_MS ?? 'unset' }; }\n");
const previous = process.env.SMUGAN_GATE_DIR;
process.env.SMUGAN_GATE_DIR = fake;
after(() => {
  rmSync(fake, { recursive: true, force: true });
  if (previous === undefined) delete process.env.SMUGAN_GATE_DIR;
  else process.env.SMUGAN_GATE_DIR = previous;
});

test('the Stop child gets the plugin timeout as its deadline; other kinds do not', async () => {
  assert.deepEqual(await runGate('stop', { session_id: 'deadline' }, { timeoutMs: 60_000 }), { exitCode: 2, stderr: '50000' });
  assert.deepEqual(await runGate('pre', { session_id: 'deadline' }, { timeoutMs: 60_000 }), { exitCode: 2, stderr: 'unset' });
});
