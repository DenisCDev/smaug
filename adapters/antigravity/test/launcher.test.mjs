// Integration tests: spawn the launcher exactly as Antigravity would (camelCase
// JSON on stdin, JSON decision on stdout) against the real gate engine from
// this checkout. The product itself is not needed — the contract is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// PIDs repeat across runs on Windows; leftover per-session files from an
// earlier run must never belong to this one.
const RUN = randomUUID().slice(0, 8);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'antigravity', 'hooks', 'smugan-hook.mjs');
const SMUGAN = resolve(ROOT, '..', '..');
const GATE = join(SMUGAN, 'packages', 'gate');
const RULES = join(SMUGAN, 'claude', 'rules');
assert.ok(existsSync(join(GATE, 'src', 'hook.mjs')), 'the gate must be in this checkout');

const proj = mkdtempSync(join(tmpdir(), 'smugan-agy-proj-'));
writeFileSync(join(proj, 'smugan.config.json'), '{}');
mkdirSync(join(proj, 'src'), { recursive: true });
after(() => rmSync(proj, { recursive: true, force: true }));

let n = 0;
const nextSid = () => 'agy' + RUN + n++;

function run(kind, payload, env = {}) {
  const result = spawnSync(process.execPath, [LAUNCHER, kind], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, SMUGAN_GATE_DIR: GATE, SMUGAN_RULES_DIR: RULES, SMUGAN_TEACH: '0', ...env },
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch { /* left null so the assertion reports the raw output */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

const write = (file, content, sid, extra = {}) => ({
  toolCall: { name: 'write_to_file', args: { TargetFile: file, CodeContent: content } },
  conversationId: sid,
  workspacePaths: [proj],
  ...extra,
});

const turnMarker = (sid) => join(tmpdir(), 'smugan-turn-' + sid + '.json');
const pendingMarker = (sid) => join(tmpdir(), 'smugan-agy-pending-' + sid + '.json');
const stateFile = (sid) => join(tmpdir(), 'smugan-agy-' + sid + '.json');

// --- PreToolUse ------------------------------------------------------------

test('a migration without RLS is denied, in both schemas at once', () => {
  const sid = nextSid();
  const res = run('pre', write(
    join(proj, 'supabase', 'migrations', '0001_create_clientes.sql'),
    'create table clientes (\n  nome_completo text\n);\n',
    sid,
  ));
  assert.equal(res.status, 0, 'a non-zero exit is fail-closed on this host');
  assert.equal(res.json.decision, 'deny');
  assert.equal(res.json.allow_tool, false, 'the older schema travels in the same object');
  assert.equal(res.json.deny_reason, res.json.reason);
  assert.match(res.json.reason, /db-naming|rls/);
});

test('a clean write emits an explicit allow, never a bare {}', () => {
  const sid = nextSid();
  const res = run('pre', write(join(proj, 'src', 'util.ts'), 'export const answer = 42;\n', sid));
  assert.equal(res.status, 0);
  assert.equal(res.json.decision, 'allow', 'a bare {} is not a valid allow (cmux#5358)');
  assert.equal(res.json.allow_tool, true);
});

test('the Cascade chunk shape is understood', () => {
  const sid = nextSid();
  const file = join(proj, 'src', 'risky.ts');
  writeFileSync(file, 'export function risky() {}\n');
  const res = run('pre', {
    toolCall: {
      name: 'replace_file_content',
      args: {
        TargetFile: file,
        ReplacementChunks: [{
          TargetContent: 'export function risky() {}',
          ReplacementContent: 'export function risky() { try { risky(); } catch {} }',
        }],
      },
    },
    conversationId: sid,
    workspacePaths: [proj],
  });
  assert.equal(res.json.decision, 'deny');
  assert.match(res.json.reason, /empty-catch/);
});

test('tools that are not writes are allowed untouched', () => {
  const res = run('pre', { toolCall: { name: 'run_command', args: { Command: 'ls' } }, conversationId: nextSid() });
  assert.equal(res.json.decision, 'allow');
});

// --- fail-open discipline (the most expensive failure mode on this host) ---

test('every malformed input still exits 0 with a valid decision', () => {
  const sid = nextSid();
  const cases = [
    ['pre', 'not json at all'],
    ['pre', ''],
    ['post', 'not json at all'],
    ['stop', 'not json at all'],
  ];
  for (const [kind, input] of cases) {
    const result = spawnSync(process.execPath, [LAUNCHER, kind], {
      input,
      encoding: 'utf8',
      env: { ...process.env, SMUGAN_GATE_DIR: GATE },
    });
    assert.equal(result.status, 0, kind + ' must exit 0 on garbage input');
    const json = JSON.parse(result.stdout);
    if (kind === 'pre') assert.equal(json.decision, 'allow');
    else assert.deepEqual(json, {});
  }

  // A missing engine must not block the session either.
  const noGate = run('pre', write(join(proj, 'x.sql'), 'create table clientes (nome_completo text);', sid), {
    SMUGAN_GATE_DIR: join(proj, 'nope'),
  });
  assert.equal(noGate.status, 0);
  assert.equal(noGate.json.decision, 'allow');
});

test('a huge deny stays parseable and bounded', () => {
  // A truncated object is malformed JSON, which on this host has been seen
  // denying every tool call; an unbounded one risks the host's read buffer and
  // helps nobody. So: whole, valid, and capped.
  const sid = nextSid();
  const many = Array.from({ length: 4000 }, (_, i) => 'create table clientes_' + i + ' (nome_completo text);').join('\n');
  const res = run('pre', write(join(proj, 'supabase', 'migrations', '0009_many.sql'), many, sid));
  assert.equal(res.status, 0);
  assert.equal(res.json.decision, 'deny', 'it parsed, so nothing was truncated mid-object');
  assert.ok(res.json.reason.length < 30000, 'and it is bounded: ' + res.json.reason.length);
  assert.match(res.json.reason, /more lines omitted/);
});

test('an unknown event argument is treated as the passive one', () => {
  const res = run('bogus', write(join(proj, 'src', 'a.ts'), 'export const a = 1;\n', nextSid()));
  assert.equal(res.status, 0);
  assert.deepEqual(res.json, {});
});

// --- PostToolUse -----------------------------------------------------------

test('post records the touched file, which is what the end-of-turn check reads', () => {
  const sid = nextSid();
  rmSync(turnMarker(sid), { force: true });
  const file = join(proj, 'src', 'touched.ts');
  writeFileSync(file, 'export const touched = 1;\n');

  const res = run('post', write(file, 'export const touched = 1;\n', sid));
  assert.equal(res.status, 0);
  assert.deepEqual(res.json, {}, 'post cannot speak on this platform');
  assert.ok(existsSync(turnMarker(sid)), 'without this the Definition of Done has nothing to check');
  assert.ok(JSON.parse(readFileSync(turnMarker(sid), 'utf8')).files.some((f) => f.endsWith('touched.ts')));
  rmSync(turnMarker(sid), { force: true });
});

test('post tolerates the documented null toolCall', () => {
  const res = run('post', { toolCall: null, conversationId: nextSid() });
  assert.equal(res.status, 0);
  assert.deepEqual(res.json, {});
});

test('a project check failure is parked by post and delivered once by pre', () => {
  const sid = nextSid();
  const proj2 = mkdtempSync(join(tmpdir(), 'smugan-agy-post-'));
  writeFileSync(join(proj2, 'smugan.config.json'), '{}');
  const eslintBin = join(proj2, 'node_modules', 'eslint', 'bin');
  mkdirSync(eslintBin, { recursive: true });
  writeFileSync(
    join(eslintBin, 'eslint.js'),
    'console.log(JSON.stringify([{ filePath: "bad.js", messages: [{ ruleId: "fake-rule", message: "fake-eslint: boom", line: 1 }] }])); process.exit(1);',
  );
  writeFileSync(join(proj2, '.eslintrc.json'), '{}');
  const file = join(proj2, 'src', 'bad.js');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const bad = 1;\n');

  const post = run('post', { ...write(file, '', sid), workspacePaths: [proj2] });
  assert.equal(post.status, 0);
  assert.ok(existsSync(pendingMarker(sid)), 'the failure is parked for the next write');

  const first = run('pre', { ...write(join(proj2, 'src', 'next.js'), 'export const ok = 1;\n', sid), workspacePaths: [proj2] });
  assert.equal(first.json.decision, 'deny');
  assert.match(first.json.reason, /fake-eslint: boom/);
  assert.ok(!existsSync(pendingMarker(sid)), 'delivered exactly once');

  const second = run('pre', { ...write(join(proj2, 'src', 'next.js'), 'export const ok = 1;\n', sid), workspacePaths: [proj2] });
  assert.equal(second.json.decision, 'allow');
  rmSync(proj2, { recursive: true, force: true });
});

// --- Stop: the part that can hold the turn ---------------------------------

function seedTurn(sid, { dirty }) {
  const file = join(proj, 'src', 'stop' + sid + '.ts');
  writeFileSync(file, dirty ? 'export function f() { try { f(); } catch {} }\n' : 'export const ok = 1;\n');
  writeFileSync(turnMarker(sid), JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
  return file;
}

const stopPayload = (sid, extra = {}) => ({ conversationId: sid, fullyIdle: true, ...extra });

test('a red Definition of Done holds the turn open', () => {
  const sid = nextSid();
  writeFileSync(join(proj, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  seedTurn(sid, { dirty: true });

  const res = run('stop', stopPayload(sid));
  assert.equal(res.status, 0);
  assert.equal(res.json.decision, 'continue', 'this is the parity with the Claude Code stop hook');
  assert.match(res.json.reason, /smugan stop/);
  assert.match(res.json.reason, /empty-catch/);
  assert.equal(JSON.parse(readFileSync(stateFile(sid), 'utf8')).continues, 1);
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
});

test('a green turn is released and the counter is cleared', () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: false });
  writeFileSync(stateFile(sid), JSON.stringify({ continues: 2, updatedAt: Date.now() }));

  const res = run('stop', stopPayload(sid));
  assert.deepEqual(res.json, {});
  assert.ok(!existsSync(stateFile(sid)), 'a green turn resets the budget');
  assert.ok(!existsSync(turnMarker(sid)), 'the gate cleans its own marker');
});

test('the gate giving up is turned into an honest ending, not silence', () => {
  const sid = nextSid();
  const file = seedTurn(sid, { dirty: true });
  // blocks: 3 is past the gate's cap (1 for this ordinary file, 2 for a
  // critical one) — it returns exit 0 WITH stderr and drops the marker.
  writeFileSync(turnMarker(sid), JSON.stringify({ files: [file], blocks: 3, baselines: {} }));

  const res = run('stop', stopPayload(sid));
  assert.equal(res.json.decision, 'continue');
  // The reason is two halves. This one is the GATE's give-up notice, worded in
  // packages/gate/src/hook.mjs and pinned to the same phrase by
  // packages/gate/test/stop-hook.test.mjs — reword it there and both suites
  // fail together. The old expectation ("still failing after 3") was the 0.12.x
  // wording and sat red here from 0.13.0 to 0.15.0, because this copy was the
  // only thing asserting it.
  assert.match(res.json.reason, /1 blocked attempt spent/);
  // ...and this half is the launcher's own, added at hooks/smugan-hook.mjs:245.
  assert.match(res.json.reason, /Do NOT attempt more fixes/);
  assert.ok(!existsSync(turnMarker(sid)), 'the gate removed its marker at the cap');

  const next = run('stop', stopPayload(sid));
  assert.deepEqual(next.json, {}, 'and the turn ends on the next stop');
  rmSync(stateFile(sid), { force: true });
});

test('the launcher cap releases the turn even if the gate re-arms', () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  writeFileSync(stateFile(sid), JSON.stringify({ continues: 4, updatedAt: Date.now() }));

  const res = run('stop', stopPayload(sid));
  assert.deepEqual(res.json, {}, 'four holds is the hard ceiling for one turn');
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
});

test('the ceiling resets both sides, so a later turn is still checked', () => {
  // The counter and the gate's marker must be cleared together. Leaving either
  // behind makes this an absorbing state: one hard turn switches the Definition
  // of Done off for every turn after it.
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  writeFileSync(stateFile(sid), JSON.stringify({ continues: 4, updatedAt: Date.now() }));

  const capped = run('stop', stopPayload(sid));
  assert.deepEqual(capped.json, {});
  assert.ok(!existsSync(stateFile(sid)), 'the counter is cleared');
  assert.ok(!existsSync(turnMarker(sid)), 'and so is the gate marker it was paired with');

  // Now a new turn writes a violating file: the check must run again.
  seedTurn(sid, { dirty: true });
  const next = run('stop', stopPayload(sid));
  assert.equal(next.json.decision, 'continue');
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
});

test('a hold for a parked check failure counts against the budget too', () => {
  // A failure the model cannot fix (a plugin-level lint error, say) would
  // otherwise hold forever on a metered host. The marker is re-seeded each round
  // because that is what the agent writing a file does — and that is precisely
  // the path where the gate's own counter resets and only ours can stop it.
  const sid = nextSid();
  const holds = [];
  for (let i = 0; i < 8; i++) {
    seedTurn(sid, { dirty: false });
    writeFileSync(pendingMarker(sid), JSON.stringify({ [join(proj, 'a.ts')]: 'eslint: unfixable' }));
    holds.push(run('stop', stopPayload(sid)).json.decision ?? 'release');
  }
  assert.equal(holds[0], 'continue', 'the parked failure is delivered');
  const consecutive = holds.findIndex((d) => d !== 'continue');
  assert.ok(consecutive > 0 && consecutive <= 4, 'and it stops holding: ' + holds.join(', '));
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
  rmSync(pendingMarker(sid), { force: true });
});

test('the give-up hold counts against the budget too', () => {
  // exit 0 + stderr goes through the same door as every other hold.
  const sid = nextSid();
  const holds = [];
  for (let i = 0; i < 8; i++) {
    const file = seedTurn(sid, { dirty: true });
    writeFileSync(turnMarker(sid), JSON.stringify({ files: [file], blocks: 3, baselines: {} }));
    holds.push(run('stop', stopPayload(sid)).json.decision ?? 'release');
  }
  assert.equal(holds[0], 'continue');
  const consecutive = holds.findIndex((d) => d !== 'continue');
  assert.ok(consecutive > 0 && consecutive <= 4, 'the give-up message cannot loop: ' + holds.join(', '));
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
});

test('a write we cannot model still anchors the turn baseline', () => {
  // Without the baseline the end-of-turn check falls back to git HEAD and blames
  // this turn for debt that was already sitting in the working tree.
  const sid = nextSid();
  rmSync(turnMarker(sid), { force: true });
  const file = join(proj, 'src', 'legacy-debt.ts');
  writeFileSync(file, 'export function old() { try { old(); } catch {} }\n');

  const pre = run('pre', {
    toolCall: { name: 'write_to_file', args: { TargetFile: file, SomeFutureField: 'unknown shape' } },
    conversationId: sid,
    workspacePaths: [proj],
  });
  assert.equal(pre.json.decision, 'allow', 'an unmodellable shape is never judged');
  assert.ok(existsSync(turnMarker(sid)), 'but it does reach the gate');
  const baselines = JSON.parse(readFileSync(turnMarker(sid), 'utf8')).baselines;
  assert.ok(Object.keys(baselines).some((f) => f.endsWith('legacy-debt.ts')), 'and the baseline is anchored');

  // The turn appends a clean line: pre-existing debt must NOT hold the turn.
  writeFileSync(file, 'export function old() { try { old(); } catch {} }\nexport const added = 1;\n');
  run('post', {
    toolCall: { name: 'write_to_file', args: { TargetFile: file, SomeFutureField: 'unknown shape' } },
    conversationId: sid,
    workspacePaths: [proj],
  });
  const stop = run('stop', stopPayload(sid));
  assert.deepEqual(stop.json, {}, 'the turn is not blamed for debt it did not write');
  rmSync(turnMarker(sid), { force: true });
  rmSync(stateFile(sid), { force: true });
});

test('in a mixed batch the governed file still gets its rule', () => {
  // An ungoverned file listed first must not consume the one teach per call.
  const sid = nextSid();
  const rulesMarker = join(tmpdir(), 'smugan-agy-rules-' + sid + '.json');
  rmSync(rulesMarker, { force: true });
  const res = run('pre', {
    toolCall: {
      name: 'multi_replace_file_content',
      args: {
        Edits: [
          { TargetFile: join(proj, 'src', 'plain-first.ts'), Mystery: 'unmodellable' },
          { TargetFile: join(proj, 'src', 'governed.test.ts'), CodeContent: 'export const t = 1;\n' },
        ],
      },
    },
    conversationId: sid,
    workspacePaths: [proj],
  }, { SMUGAN_TEACH: '1' });
  assert.equal(res.json.decision, 'deny');
  assert.match(res.json.reason, /--- rule: testing ---/);
  rmSync(rulesMarker, { force: true });
});

test('a stack rule is delivered even for a shape we cannot model', () => {
  const sid = nextSid();
  const rulesMarker = join(tmpdir(), 'smugan-agy-rules-' + sid + '.json');
  rmSync(rulesMarker, { force: true });
  const res = run('pre', {
    toolCall: { name: 'write_to_file', args: { TargetFile: join(proj, 'src', 'odd.test.ts'), Mystery: 'x' } },
    conversationId: sid,
    workspacePaths: [proj],
  }, { SMUGAN_TEACH: '1' });
  assert.equal(res.json.decision, 'deny');
  assert.match(res.json.reason, /--- rule: testing ---/);
  rmSync(rulesMarker, { force: true });
});

test('a write we cannot model is still recorded for the end-of-turn check', () => {
  // Dropping an unmodellable shape is right for the gate verdict and wrong for
  // the turn marker: without the file recorded, typecheck and tests never run.
  const sid = nextSid();
  rmSync(turnMarker(sid), { force: true });
  const file = join(proj, 'src', 'odd-shape.ts');
  writeFileSync(file, 'export const odd = 1;\n');

  const res = run('post', {
    toolCall: { name: 'write_to_file', args: { TargetFile: file, SomeFutureField: 'who knows' } },
    conversationId: sid,
    workspacePaths: [proj],
  });
  assert.equal(res.status, 0);
  assert.ok(existsSync(turnMarker(sid)), 'the Definition of Done must still have something to check');
  assert.ok(JSON.parse(readFileSync(turnMarker(sid), 'utf8')).files.some((f) => f.endsWith('odd-shape.ts')));
  rmSync(turnMarker(sid), { force: true });
});

test('the deferred-debt block keeps its instruction even when clamped', () => {
  const sid = nextSid();
  const huge = Array.from({ length: 900 }, (_, i) => 'eslint (file' + i + '.ts): a very long complaint line to push this past the clamp').join('\n');
  writeFileSync(pendingMarker(sid), JSON.stringify({ [join(proj, 'a.ts')]: huge }));

  const res = run('pre', write(join(proj, 'src', 'after-debt.ts'), 'export const a = 1;\n', sid));
  assert.equal(res.json.decision, 'deny');
  assert.ok(res.json.reason.length < 30000, 'it is clamped: ' + res.json.reason.length);
  assert.match(res.json.reason, /retry this exact call/, 'and the instruction survived the cut');
  rmSync(pendingMarker(sid), { force: true });
});

test('a spent ceiling does not disable the check for the rest of the session', () => {
  const sid = nextSid();
  // A previous turn burned the budget and ended — the gate removed its marker.
  writeFileSync(stateFile(sid), JSON.stringify({ continues: 4, updatedAt: Date.now() }));
  rmSync(turnMarker(sid), { force: true });

  const idle = run('stop', stopPayload(sid));
  assert.deepEqual(idle.json, {}, 'nothing was touched, so nothing to check');

  // A brand new turn writes a violating file: the check must run again.
  seedTurn(sid, { dirty: true });
  const next = run('stop', stopPayload(sid));
  assert.equal(next.json.decision, 'continue', 'the budget is per turn, not per conversation');
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
});

test('only real cancellations release the turn — normal endings still get checked', () => {
  // The terminationReason enum is undocumented, so an over-broad match here
  // would silently switch the whole Definition of Done off.
  const held = ['end_turn', 'completed', 'agent_finished', 'stop', 'max_iterations',
    'awaiting_user_input', 'waiting_for_user', 'user_turn_ended', 'no_errors'];
  for (const reason of held) {
    const sid = nextSid();
    seedTurn(sid, { dirty: true });
    const res = run('stop', stopPayload(sid, { terminationReason: reason }));
    assert.equal(res.json.decision, 'continue', reason + ' is a normal ending — it must still be checked');
    rmSync(stateFile(sid), { force: true });
    rmSync(turnMarker(sid), { force: true });
  }

  const released = ['user_cancelled', 'aborted', 'interrupted', 'timed_out', 'quota_exceeded', 'rate_limited'];
  for (const reason of released) {
    const sid = nextSid();
    seedTurn(sid, { dirty: true });
    const res = run('stop', stopPayload(sid, { terminationReason: reason }));
    assert.deepEqual(res.json, {}, reason + ' means the turn died — never hold it');
    rmSync(turnMarker(sid), { force: true });
  }
});

test('a stale counter expires instead of blocking forever', () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });
  writeFileSync(stateFile(sid), JSON.stringify({ continues: 9, updatedAt: Date.now() - 13 * 60 * 60 * 1000 }));

  const res = run('stop', stopPayload(sid));
  assert.equal(res.json.decision, 'continue', 'a 13h-old counter is not this turn');
  rmSync(stateFile(sid), { force: true });
  rmSync(turnMarker(sid), { force: true });
});

test('a turn that is not fully idle is released without running the checks', () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: true });

  const res = run('stop', stopPayload(sid, { fullyIdle: false }));
  assert.deepEqual(res.json, {});
  const marker = JSON.parse(readFileSync(turnMarker(sid), 'utf8'));
  assert.equal(marker.blocks, 0, 'the gate never ran — no quota, no latency');
  rmSync(turnMarker(sid), { force: true });
});

test('a turn the user killed is never held open', () => {
  for (const extra of [{ terminationReason: 'user_cancelled' }, { error: 'boom' }, { terminationReason: 'quota_exceeded' }]) {
    const sid = nextSid();
    seedTurn(sid, { dirty: true });
    const res = run('stop', stopPayload(sid, extra));
    assert.deepEqual(res.json, {}, JSON.stringify(extra) + ' must release the turn');
    assert.equal(JSON.parse(readFileSync(turnMarker(sid), 'utf8')).blocks, 0);
    rmSync(turnMarker(sid), { force: true });
  }
});

test('a check failure parked late still reaches the model at turn end', () => {
  const sid = nextSid();
  seedTurn(sid, { dirty: false });
  writeFileSync(pendingMarker(sid), JSON.stringify({ [join(proj, 'a.ts')]: 'eslint (a.ts): boom' }));

  const res = run('stop', stopPayload(sid));
  assert.equal(res.json.decision, 'continue', 'a read-only tail of the turn would otherwise swallow it');
  assert.match(res.json.reason, /boom/);
  assert.ok(!existsSync(pendingMarker(sid)));
  rmSync(stateFile(sid), { force: true });
});

// --- rule-teach ------------------------------------------------------------

test('the first edit of a governed file is denied once, with the rule inline', () => {
  const sid = nextSid();
  const rulesMarker = join(tmpdir(), 'smugan-agy-rules-' + sid + '.json');
  rmSync(rulesMarker, { force: true });
  const payload = write(join(proj, 'src', 'thing.test.ts'), 'export const t = 1;\n', sid);

  const first = run('pre', payload, { SMUGAN_TEACH: '1' });
  assert.equal(first.json.decision, 'deny');
  assert.match(first.json.reason, /smugan rules/);
  assert.match(first.json.reason, /--- rule: testing ---/);
  assert.match(first.json.reason, /paths:/, 'the whole rule travels, not a path to go fetch');
  assert.deepEqual(JSON.parse(readFileSync(rulesMarker, 'utf8')).surfaced, ['testing']);

  const second = run('pre', payload, { SMUGAN_TEACH: '1' });
  assert.equal(second.json.decision, 'allow', 'one block per rule per session');
  rmSync(rulesMarker, { force: true });
});

test('a file no rule governs is never taught, and SMUGAN_TEACH=0 disables it', () => {
  const sid = nextSid();
  const plain = run('pre', write(join(proj, 'src', 'plain.ts'), 'export const p = 1;\n', sid), { SMUGAN_TEACH: '1' });
  assert.equal(plain.json.decision, 'allow');

  const off = run('pre', write(join(proj, 'src', 'other.test.ts'), 'export const o = 1;\n', nextSid()), { SMUGAN_TEACH: '0' });
  assert.equal(off.json.decision, 'allow');
});
