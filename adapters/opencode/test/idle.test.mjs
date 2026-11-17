// The end-of-turn decision table. This is where the "it just stops" fix lives,
// so the cases that must NEVER resume (ESC, retry backoff, child sessions) are
// as important as the ones that must.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GATE, PLUGIN, assistantMessage, fakeClient, idle, makeProject } from './helpers.mjs';
import { clearAll, forSession } from '../opencode/smugan/state.mjs';
import { onIdle } from '../opencode/smugan/idle.mjs';
import { loadConfig } from '../opencode/smugan/config.mjs';
import { makeLog } from '../opencode/smugan/log.mjs';
import { randomUUID } from 'node:crypto';

// PIDs repeat across runs on Windows; leftover per-session files from an
// earlier run must never belong to this one.
const RUN = randomUUID().slice(0, 8);

process.env.SMUGAN_GATE_DIR = GATE;
const { smugan } = await import(PLUGIN);

// typecheck/tests off keeps the DoD fast; the gate re-check is what we assert.
const proj = makeProject(JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
after(() => rmSync(proj, { recursive: true, force: true }));

let counter = 0;
const nextSid = () => 'ses' + RUN + 'idle' + counter++;

/** Seeds the gate's turn marker so the DoD has something to judge. */
function seedTurn(sessionID, { dirty = false } = {}) {
  const file = join(proj, 'src', 'file' + counter + (dirty ? '-dirty' : '-clean') + '.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, dirty ? 'export function f() { try { f(); } catch {} }\n' : 'export const ok = 1;\n');
  const marker = join(tmpdir(), 'smugan-turn-' + sessionID + '.json');
  writeFileSync(marker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
  return marker;
}

async function setup({ session = { id: 'ses_x' } } = {}) {
  clearAll();
  const client = fakeClient({ session });
  const hooks = await smugan({ client });
  return { client, hooks };
}

test('a red Definition of Done resumes the session once, carrying the failures', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid, { dirty: true });
  const { client, hooks } = await setup();
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });

  assert.equal(client.calls.prompts.length, 1);
  const body = client.calls.prompts[0].body;
  assert.match(body.parts[0].text, /smugan — Definition of Done/);
  assert.match(body.parts[0].text, /empty-catch/);
  assert.deepEqual(body.model, { providerID: 'opencode', modelID: 'deepseek-v4-flash-free' });
  assert.equal(body.agent, 'build');
  rmSync(marker, { force: true });
});

test('a green turn that finished normally is left alone', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid);
  const { client, hooks } = await setup();
  await hooks.event({ event: assistantMessage(sid, { finish: 'stop' }) });
  await hooks.event({ event: { type: 'message.part.updated', properties: { part: { sessionID: sid, type: 'text' } } } });
  await hooks.event({ event: idle(sid) });

  assert.equal(client.calls.prompts.length, 0);
  assert.ok(!existsSync(marker), 'a green DoD clears the turn marker');
});

test('a stop timeout warns about incomplete checks without consuming resume attempts', async () => {
  const sessionID = nextSid();
  const project = makeProject(JSON.stringify({ hook: { stop: { timeoutMs: 7000, typecheck: false } } }));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setTimeout(() => {}, 30000)"' } }));
  const file = join(project, 'src', 'fine.js');
  writeFileSync(file, 'export const fine = 1;\n');
  const marker = join(tmpdir(), 'smugan-turn-' + sessionID + '.json');
  writeFileSync(marker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
  try {
    clearAll();
    const client = fakeClient();
    const state = forSession(sessionID);
    state.assistant = { id: 'msg_timeout', finish: 'stop' };
    const result = await onIdle({ sessionID, client, cfg: loadConfig(), state, log: makeLog(client) });
    assert.equal(result, 'unverified');
    assert.ok(client.calls.toasts.some((toast) => /result not verified/.test(toast.body.message)));
    assert.ok(client.calls.toasts.every((toast) => !/attempt limit/.test(toast.body.message)));
    assert.equal(client.calls.prompts.length, 0);
    assert.equal(state.resumes, 0);
  } finally {
    rmSync(marker, { force: true });
    rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('an end-of-turn check cut at the plugin deadline is reported as not verified, never as clean', async () => {
  const sessionID = nextSid();
  // A gate that answers long after the deadline, as slow project scripts make it.
  const slow = mkdtempSync(join(tmpdir(), 'smugan-oc-slow-gate-'));
  mkdirSync(join(slow, 'src'));
  writeFileSync(join(slow, 'src', 'hook.mjs'), "export async function runHook() {\n  await new Promise((resolve) => setTimeout(resolve, 60000));\n  return { exitCode: 2, stderr: 'late' };\n}\n");
  process.env.SMUGAN_GATE_DIR = slow;
  try {
    clearAll();
    const client = fakeClient();
    const state = forSession(sessionID);
    state.assistant = { id: 'msg_slow', finish: 'stop' };
    const cfg = { ...loadConfig(), dod: { enabled: true, timeoutMs: 1000 } };
    const result = await onIdle({ sessionID, client, cfg, state, log: makeLog(client) });
    assert.equal(result, 'timed out');
    assert.ok(client.calls.toasts.some((toast) => /did not finish in 1 s, so this turn was not verified/.test(toast.body.message)));
    assert.equal(client.calls.prompts.length, 0);
    assert.equal(state.resumes, 0);
  } finally {
    process.env.SMUGAN_GATE_DIR = GATE;
    rmSync(slow, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a turn cut off at the output limit resumes (layer B)', async () => {
  const sid = nextSid();
  seedTurn(sid);
  const { client, hooks } = await setup();
  await hooks.event({ event: assistantMessage(sid, { finish: 'length' }) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 1);
  assert.match(client.calls.prompts[0].body.parts[0].text, /cut off at the model output limit/);
});

test('a turn that ended right after a tool resumes (the broken agent loop)', async () => {
  const sid = nextSid();
  seedTurn(sid);
  const { client, hooks } = await setup();
  await hooks.event({ event: assistantMessage(sid, { finish: 'stop' }) });
  await hooks.event({ event: { type: 'message.part.updated', properties: { part: { sessionID: sid, type: 'tool', tool: 'edit' } } } });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 1);
  assert.match(client.calls.prompts[0].body.parts[0].text, /right after `edit` ran/);
});

test('open todos after real work resume the turn', async () => {
  const sid = nextSid();
  seedTurn(sid);
  const { client, hooks } = await setup();
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: sid, args: {} }, { output: '' });
  await hooks.event({ event: { type: 'todo.updated', properties: { sessionID: sid, todos: [{ content: 'ship it', status: 'pending' }] } } });
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 1);
  assert.match(client.calls.prompts[0].body.parts[0].text, /ship it/);
});

test('a hard, non-retryable API error is not treated as an unfinished turn', async () => {
  const sid = nextSid();
  seedTurn(sid);
  const { client, hooks } = await setup();
  await hooks.event({
    event: assistantMessage(sid, { finish: 'length', error: { name: 'APIError', data: { statusCode: 401, isRetryable: false } } }),
  });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 0);
});

test('ESC is never resurrected, not even by a red DoD', async () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  const { client, hooks } = await setup();
  await hooks.event({ event: { type: 'session.error', properties: { sessionID: sid, error: { name: 'MessageAbortedError', data: {} } } } });
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 0);

  // sticky: a later idle in the same session stays silent too
  await hooks.event({ event: assistantMessage(sid, { id: 'msg_2' }) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 0);
});

test('a real user message clears the abort, our own resume does not', async () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  const { client, hooks } = await setup();
  await hooks.event({ event: { type: 'session.error', properties: { sessionID: sid, error: { name: 'MessageAbortedError', data: {} } } } });

  await hooks['chat.message']({ sessionID: sid }, { parts: [{ type: 'text', text: '<!-- smugan-auto -->\nsmugan — Definition of Done' }] });
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 0, 'our own message must not clear an abort');

  await hooks['chat.message']({ sessionID: sid }, { parts: [{ type: 'text', text: 'go on' }] });
  await hooks.event({ event: assistantMessage(sid, { id: 'msg_3' }) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 1);
});

test('a session in provider retry backoff is left to the runtime', async () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  const { client, hooks } = await setup();
  await hooks.event({ event: { type: 'session.status', properties: { sessionID: sid, status: { type: 'retry', attempt: 2, message: 'rate limit' } } } });
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 0);

  await hooks.event({ event: { type: 'session.status', properties: { sessionID: sid, status: { type: 'idle' } } } });
  await hooks.event({ event: assistantMessage(sid, { id: 'msg_4' }) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 1);
});

test('an idle from a child session is ignored entirely', async () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  const { client, hooks } = await setup({ session: { id: sid, parentID: 'ses_parent' } });
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 0);
});

test('idle firing twice for the same turn resumes only once', async () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  const { client, hooks } = await setup();
  await hooks.event({ event: assistantMessage(sid) });
  await hooks.event({ event: idle(sid) });
  await hooks.event({ event: idle(sid) });
  assert.equal(client.calls.prompts.length, 1);
});

// These drive onIdle directly: the 5s throttle is real and deliberate, so the
// clock has to move for a multi-turn scenario to be about the caps rather than
// about the throttle. Nothing here rewrites the gate's own turn marker — the
// gate stamps its attempt counter into the failure text, and a test that
// normalised that away would be testing a message production never emits.
async function idleRounds(sid, { rounds = 10, mutate } = {}) {
  clearAll();
  const client = fakeClient();
  const cfg = loadConfig();
  const log = makeLog(client);
  const state = forSession(sid);
  let now = Date.now();
  for (let i = 0; i < rounds; i++) {
    now += cfg.continue.throttleMs + 1000;
    state.assistant = { id: 'msg_' + i, finish: 'stop', providerID: 'opencode', modelID: 'm', mode: 'build' };
    state.evaluated = '';
    state.toolsSince += 1; // every resumed turn does something — that is not progress
    if (mutate) mutate(state, i);
    await onIdle({ sessionID: sid, client, cfg, state, log, now });
  }
  return { calls: client.calls, cfg };
}

test('a red Definition of Done stops after the gate gives up, without our help', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid, { dirty: true });
  // No marker surgery: the gate counts its own attempts and, at its cap,
  // returns exit 0 with an advisory, which must NOT be resumed.
  const { calls } = await idleRounds(sid, { rounds: 6 });
  assert.equal(calls.prompts.length, 1, 'the engine holds an ordinary turn once, and we stop with it');
  assert.ok(calls.toasts.some((t) => /Definition of Done/.test(t.body.message)), 'the user is told it gave up');
  rmSync(marker, { force: true });
});

test('a repeated layer-B complaint stops at the same-reason cap', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid); // clean DoD: only layer B can fire
  const { calls, cfg } = await idleRounds(sid, {
    mutate: (state) => { state.lastPart = { type: 'tool', tool: 'edit' }; },
  });
  rmSync(marker, { force: true });
  assert.equal(calls.prompts.length, cfg.continue.maxSameReason, 'the same complaint never repeats past the cap');
  assert.ok(calls.toasts.some((t) => /same pending item/.test(t.body.message)));
});

test('an always-changing reason terminates at the per-session cap', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid);
  // A genuinely different complaint every round defeats the same-reason cap by
  // design (numbered variants of one complaint do not — they share a
  // fingerprint). This is the path that used to resume forever.
  const words = ['migrar auth', 'revisar rls', 'ajustar layout', 'trocar copy', 'subir deploy', 'limpar cache', 'medir tempo', 'somar total'];
  const { calls, cfg } = await idleRounds(sid, {
    rounds: 8,
    mutate: (state, i) => {
      state.todos = [{ content: words[i % words.length], status: 'pending' }];
      state.toolsSince = 1;
    },
  });
  rmSync(marker, { force: true });
  assert.equal(calls.prompts.length, cfg.continue.maxPerSession, 'the session budget is terminal, not a rate');
  assert.ok(calls.toasts.some((t) => /send me a message/.test(t.body.message)), 'and it says how to continue');
});

test('a rerun of the same failing tests is not progress either', async () => {
  const { fingerprint } = await import('../opencode/smugan/state.mjs');
  // The DoD tail carries the runner's own timings, which move on every run.
  const runA = 'smugan stop: 1 issue:\n  tests (vitest related):\n  FAIL src/a.test.ts\n  duration_ms: 157.808\nFix these before finishing (attempt 1/3).';
  const runB = runA.replace('157.808', '2044.11').replace('attempt 1/3', 'attempt 2/3');
  assert.equal(fingerprint(runA), fingerprint(runB), 'the same failing test rerun is the same complaint');
});

test('two violations of one rule at different lines are two complaints', async () => {
  const { fingerprint } = await import('../opencode/smugan/state.mjs');
  const atLine4 = 'smugan stop: 1 issue:\n  src/x.ts:4  [empty-catch]  empty catch\nFix these before finishing (attempt 1/3).';
  const atLine31 = 'smugan stop: 1 issue:\n  src/x.ts:31  [empty-catch]  empty catch\nFix these before finishing (attempt 2/3).';
  assert.notEqual(fingerprint(atLine4), fingerprint(atLine31), 'fixing one and finding another is progress, not repetition');
});

// This is the invariant that makes the budget terminal: the runtime echoes our
// own resume back as a user message, and if that re-armed the counters the
// unbounded loop would be back. Feed the plugin its OWN produced body.
test('the plugin echoing its own resume back never re-arms the budget', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid);
  clearAll();
  const client = fakeClient();
  const hooks = await smugan({ client });
  const cfg = loadConfig();
  const state = forSession(sid);
  let now = Date.now();

  for (let i = 0; i < 20; i++) {
    now += cfg.continue.throttleMs + 1000;
    state.assistant = { id: 'e' + i, finish: 'length', providerID: 'opencode', modelID: 'm', mode: 'build' };
    state.evaluated = '';
    await onIdle({ sessionID: sid, client, cfg, state, log: makeLog(client), now });
    // exactly what OpenCode does with the prompt we just sent
    const last = client.calls.prompts.at(-1);
    if (last) await hooks['chat.message']({ sessionID: sid }, { parts: last.body.parts });
  }

  rmSync(marker, { force: true });
  assert.equal(
    client.calls.prompts.length,
    cfg.continue.maxSameReason,
    'our own message must not clear resumes/sameReason — it would restore the unbounded loop',
  );
  assert.ok(state.resumes > 0, 'the session budget really was consumed');
});

test('the gate attempt counter alone does not look like progress', async () => {
  const { fingerprint } = await import('../opencode/smugan/state.mjs');
  const first = 'smugan stop: 2 issues:\n  src/a.ts:12  [empty-catch]  ...\nFix these before finishing (attempt 1/3).';
  const second = first.replace('attempt 1/3', 'attempt 2/3');
  assert.equal(fingerprint(first), fingerprint(second), 'the same failure with a bumped counter is the same failure');
});

test('a message from the user re-arms the resume budget', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid);
  clearAll();
  const client = fakeClient();
  const hooks = await smugan({ client });
  const cfg = loadConfig();
  const state = forSession(sid);
  state.resumes = cfg.continue.maxPerSession;
  state.assistant = { id: 'x1', finish: 'length', providerID: 'opencode', modelID: 'm', mode: 'build' };
  await onIdle({ sessionID: sid, client, cfg, state, log: makeLog(client) });
  assert.equal(client.calls.prompts.length, 0, 'spent budget stays spent');

  await hooks['chat.message']({ sessionID: sid }, { parts: [{ type: 'text', text: 'continua aí' }] });
  state.assistant = { id: 'x2', finish: 'length', providerID: 'opencode', modelID: 'm', mode: 'build' };
  state.evaluated = '';
  await onIdle({ sessionID: sid, client, cfg, state, log: makeLog(client), now: Date.now() + 10000 });
  assert.equal(client.calls.prompts.length, 1);
  rmSync(marker, { force: true });
});

test('ESC during the Definition of Done check still cancels the resume', async () => {
  const sid = nextSid();
  const marker = seedTurn(sid, { dirty: true });
  clearAll();
  const client = fakeClient();
  const state = forSession(sid);
  state.assistant = { id: 'm1', finish: 'stop', providerID: 'opencode', modelID: 'm', mode: 'build' };
  // The gate legitimately runs for a long time; the user can abort meanwhile.
  const pending = onIdle({ sessionID: sid, client, cfg: loadConfig(), state, log: makeLog(client) });
  setTimeout(() => { state.aborted = true; }, 20);
  const outcome = await pending;
  assert.equal(outcome, 'aborted');
  assert.equal(client.calls.prompts.length, 0, 'a session killed mid-check is never resurrected');
  rmSync(marker, { force: true });
});

test('a client that throws never escapes the event hook', async () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  clearAll();
  const logs = [];
  const client = {
    session: {
      get: async () => { throw new Error('boom'); },
      promptAsync: async () => { throw new Error('boom'); },
    },
    app: { log: async (r) => { logs.push(r); } },
    tui: { showToast: async () => { throw new Error('boom'); } },
  };
  const hooks = await smugan({ client });
  await hooks.event({ event: assistantMessage(sid) });
  await assert.doesNotReject(() => hooks.event({ event: idle(sid) }));
  assert.ok(logs.some((l) => l.body.level === 'error'), 'the failure is logged, not swallowed silently');
});

test('warn mode: a red Definition of Done is shown as a toast and never resumes the turn', async () => {
  const sessionID = nextSid();
  const project = makeProject(JSON.stringify({ mode: 'warn', hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(project, 'src', 'left.js');
  writeFileSync(file, 'console.log("left behind");\n');
  const marker = join(tmpdir(), 'smugan-turn-' + sessionID + '.json');
  writeFileSync(marker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
  try {
    clearAll();
    const client = fakeClient();
    const state = forSession(sessionID);
    state.assistant = { id: 'msg_warn', finish: 'stop' };
    const result = await onIdle({ sessionID, client, cfg: loadConfig(), state, log: makeLog(client) });
    assert.equal(result, 'clean');
    assert.ok(client.calls.toasts.some((toast) => /warn mode, nothing blocked[\s\S]*console-log/.test(toast.body.message)));
    assert.equal(client.calls.prompts.length, 0);
    assert.ok(!existsSync(marker), 'the turn ended');
  } finally {
    rmSync(marker, { force: true });
    rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
