// Integration tests: spawn the launcher exactly as Grok Build would (JSON on
// stdin, exit code + stdout decision out), against the real gate engine from
// the sibling smugan checkout. The installer is spawned the same way.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// PIDs repeat across runs on Windows; leftover per-session files from an
// earlier run must never belong to this one.
const RUN = randomUUID().slice(0, 8);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'grok', 'hooks', 'smugan-hook.mjs');
const INSTALL = join(ROOT, 'tools', 'install.mjs');
const SMUGAN = resolve(ROOT, '..', '..');
const GATE = join(SMUGAN, 'packages', 'gate');
assert.ok(existsSync(join(GATE, 'src', 'hook.mjs')), 'smugan repo must be checked out next to smugan-grok (or set SMUGAN_DIR and adjust)');

const proj = mkdtempSync(join(tmpdir(), 'smugan-grok-test-'));
writeFileSync(join(proj, 'smugan.config.json'), '{}');
after(() => rmSync(proj, { recursive: true, force: true }));

const sid = (suffix) => 'sgk' + RUN + suffix;

function run(kind, payload, env = {}) {
  const result = spawnSync(process.execPath, [LAUNCHER, kind], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, SMUGAN_GATE_DIR: GATE, ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('pre blocks a Grok-native camelCase write that introduces violations', () => {
  const { status, stdout, stderr } = run('pre', {
    hookEventName: 'PreToolUse',
    sessionId: sid('a'),
    cwd: proj,
    workspaceRoot: proj,
    toolName: 'create_file',
    toolInput: {
      filePath: join(proj, 'supabase', 'migrations', '0001_create_clientes.sql'),
      content: 'create table clientes (\n  nome_completo text\n);\n',
    },
  });
  assert.equal(status, 2);
  const decision = JSON.parse(stdout);
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /violation/);
  assert.match(decision.reason, /db-naming|rls/);
  assert.match(stderr, /violation/);
});

test('pre infers Edit from oldString/newString and blocks new violations', () => {
  const file = join(proj, 'src', 'edited.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export function risky() {}\n');
  const { status, stdout } = run('pre', {
    sessionId: sid('b'),
    toolName: 'str_replace',
    toolInput: {
      path: file,
      oldString: 'export function risky() {}',
      newString: 'export function risky() { try { throw new Error("x"); } catch {} }',
    },
  });
  assert.equal(status, 2);
  assert.match(JSON.parse(stdout).reason, /empty-catch/);
});

test('pre judges the Cursor-preset Write, which names the file in path and the text in contents', () => {
  const { status, stdout } = run('pre', {
    sessionId: sid('cursor'),
    toolName: 'Write',
    toolInput: {
      path: join(proj, 'supabase', 'migrations', '0002_create_pedidos.sql'),
      contents: 'create table pedidos (\n  nome_completo text\n);\n',
    },
  });
  assert.equal(status, 2);
  assert.match(JSON.parse(stdout).reason, /db-naming|rls/);
});

test('pre allows a clean Claude-shaped write', () => {
  const { status, stdout } = run('pre', {
    session_id: sid('c'),
    tool_name: 'Write',
    tool_input: { file_path: join(proj, 'src', 'util.ts'), content: 'export const answer = 42;\n' },
  });
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('pre ignores non-edit tools', () => {
  const { status } = run('pre', { toolName: 'Bash', toolInput: { command: 'ls' }, sessionId: sid('d') });
  assert.equal(status, 0);
});

test('pre skips files under the Grok home even when they would violate', () => {
  const grokHome = join(proj, 'fake-grok-home');
  mkdirSync(grokHome, { recursive: true });
  const { status } = run(
    'pre',
    {
      sessionId: sid('e'),
      toolName: 'Write',
      toolInput: {
        filePath: join(grokHome, 'notes.sql'),
        content: 'create table clientes (nome_completo text);\n',
      },
    },
    { GROK_HOME: grokHome },
  );
  assert.equal(status, 0);
});

test('pre still blocks a sibling of the Grok home (boundary-safe prefix)', () => {
  const grokHome = join(proj, 'gh');
  const sibling = join(proj, 'gh-app');
  mkdirSync(grokHome, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  const { status } = run(
    'pre',
    {
      sessionId: sid('e2'),
      toolName: 'Write',
      toolInput: {
        filePath: join(sibling, 'm', '0001_clientes.sql'),
        content: 'create table clientes (nome_completo text);\n',
      },
    },
    { GROK_HOME: grokHome },
  );
  assert.equal(status, 2);
});

test('post records project-check failures, pre delivers them, clean post clears', () => {
  const session = sid('g');
  const marker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  // A fake eslint bin makes the gate's post delegation fail without npm
  // installs. The 0.10.0 gate parses `--format json` STDOUT and treats a
  // crashed eslint as fail-open, so the fake must emit real eslint JSON.
  const proj2 = mkdtempSync(join(tmpdir(), 'smugan-grok-post-'));
  writeFileSync(join(proj2, 'smugan.config.json'), '{}');
  const eslintBin = join(proj2, 'node_modules', 'eslint', 'bin');
  mkdirSync(eslintBin, { recursive: true });
  const failingEslint =
    'console.log(JSON.stringify([{ filePath: "bad.js", messages: [{ ruleId: "fake-rule", message: "fake-eslint: boom", line: 1 }] }])); process.exit(1);';
  writeFileSync(join(eslintBin, 'eslint.js'), failingEslint);
  writeFileSync(join(proj2, '.eslintrc.json'), '{}');
  const file = join(proj2, 'src', 'bad.js');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const bad = 1;\n');
  const postPayload = { sessionId: session, toolName: 'Write', toolInput: { filePath: file, content: '' } };

  const failing = run('post', postPayload);
  assert.equal(failing.status, 0, 'post is passive — always exit 0');
  assert.ok(existsSync(marker), 'post recorded the failure');
  assert.match(Object.values(JSON.parse(readFileSync(marker, 'utf8')))[0], /fake-eslint: boom/);

  writeFileSync(join(eslintBin, 'eslint.js'), 'console.log("[]"); process.exit(0);');
  const passing = run('post', postPayload);
  assert.equal(passing.status, 0);
  assert.ok(!existsSync(marker), 'a clean check removes the entry and the marker');

  writeFileSync(join(eslintBin, 'eslint.js'), failingEslint);
  run('post', postPayload);
  const pre = run('pre', {
    sessionId: session,
    toolName: 'Write',
    toolInput: { filePath: join(proj2, 'src', 'next.js'), content: 'export const ok = 1;\n' },
  });
  assert.equal(pre.status, 2);
  assert.match(JSON.parse(pre.stdout).reason, /fake-eslint: boom/);
  assert.ok(!existsSync(marker), 'delivery clears the marker');

  run('sessionend', { sessionId: session });
  rmSync(proj2, { recursive: true, force: true });
});

test('an explicit null sessionId falls back to GROK_SESSION_ID', () => {
  const session = sid('i');
  const marker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  writeFileSync(marker, JSON.stringify({ [join(proj, 'y.ts')]: 'eslint (y.ts): kaboom\n' }));
  const { status, stdout } = run(
    'pre',
    { sessionId: null, toolName: 'Bash', toolInput: {} },
    { GROK_SESSION_ID: session },
  );
  assert.equal(status, 2);
  assert.match(JSON.parse(stdout).reason, /kaboom/);
  assert.ok(!existsSync(marker));
});

test('stop delegates to the gate; an empty turn cleans its own marker', () => {
  const session = sid('h');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [], blocks: 0, baselines: {} }));
  const { status } = run('stop', { sessionId: session });
  assert.equal(status, 0);
  assert.ok(!existsSync(turnMarker));
});

test('deferred post failures deny exactly once on the next pre', () => {
  const session = sid('f');
  const marker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  writeFileSync(marker, JSON.stringify({ [join(proj, 'x.ts')]: 'eslint (x.ts): boom\n' }));

  const cleanWrite = {
    sessionId: session,
    toolName: 'Write',
    toolInput: { filePath: join(proj, 'src', 'later.ts'), content: 'export const later = true;\n' },
  };
  const first = run('pre', cleanWrite);
  assert.equal(first.status, 2);
  const decision = JSON.parse(first.stdout);
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /failures or warnings pending/);
  assert.match(decision.reason, /boom/);
  assert.ok(!existsSync(marker), 'pending marker is cleared after delivery');

  const second = run('pre', cleanWrite);
  assert.equal(second.status, 0);
});

test('stop runs the gate DoD and defers a red verdict for the next pre', () => {
  const session = sid('j');
  const proj3 = mkdtempSync(join(tmpdir(), 'smugan-grok-stop-'));
  writeFileSync(join(proj3, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(proj3, 'src', 'oops.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export function f() { try { f(); } catch {} }\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));

  const { status } = run('stop', { sessionId: session });
  assert.equal(status, 0, 'stop is passive — always exit 0');
  const pendingMarker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  assert.ok(existsSync(pendingMarker), 'red DoD is parked for the next pre');
  const pending = JSON.parse(readFileSync(pendingMarker, 'utf8'));
  assert.match(pending.stop, /smugan stop/);
  assert.match(pending.stop, /empty-catch/);
  assert.ok(existsSync(turnMarker), 'gate keeps the turn marker while the DoD is red');
  assert.equal(JSON.parse(readFileSync(turnMarker, 'utf8')).blocks, 1);

  run('sessionend', { sessionId: session });
  rmSync(proj3, { recursive: true, force: true });
});

test('a green stop keeps undelivered debt — only the pre delivery clears it', () => {
  const session = sid('k');
  const proj4 = mkdtempSync(join(tmpdir(), 'smugan-grok-clean-'));
  writeFileSync(join(proj4, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(proj4, 'src', 'fine.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const fine = 1;\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 1, baselines: {} }));
  const pendingMarker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  writeFileSync(pendingMarker, JSON.stringify({ stop: 'smugan stop: old failure\n' }));

  const { status } = run('stop', { sessionId: session });
  assert.equal(status, 0);
  assert.ok(!existsSync(turnMarker), 'gate removes the marker on a green DoD');
  assert.ok(existsSync(pendingMarker), 'parked debt survives until a pre delivers it');

  const pre = run('pre', { sessionId: session, toolName: 'Bash', toolInput: { command: 'ls' } });
  assert.equal(pre.status, 2);
  assert.match(JSON.parse(pre.stdout).reason, /old failure/);
  assert.ok(!existsSync(pendingMarker));

  rmSync(proj4, { recursive: true, force: true });
});

test('a turn that wrote nothing is not checked again, and the verdict nobody read survives', () => {
  const session = sid('k2');
  const proj5 = mkdtempSync(join(tmpdir(), 'smugan-grok-cap-'));
  writeFileSync(join(proj5, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(proj5, 'src', 'still-red.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export function f() { try { f(); } catch {} }\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
  const pendingMarker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');

  assert.equal(run('stop', { sessionId: session }).status, 0);
  assert.match(JSON.parse(readFileSync(pendingMarker, 'utf8')).stop, /empty-catch/);
  // A turn with no tool call delivers nothing and writes nothing: its Stop has nothing new to check.
  assert.equal(run('stop', { sessionId: session }).status, 0);
  const pending = JSON.parse(readFileSync(pendingMarker, 'utf8'));
  assert.match(pending.stop, /empty-catch/, 'the verdict nobody read is still parked');
  assert.match(pending['stop-notice'], /1 blocked attempt spent/);
  assert.ok(!existsSync(turnMarker), 'the turn is retired without a second verdict');

  const pre = run('pre', { sessionId: session, toolName: 'Bash', toolInput: { command: 'git commit' } });
  assert.equal(pre.status, 2, 'the next tool call still gets the red DoD once');
  assert.match(JSON.parse(pre.stdout).reason, /empty-catch/);
  const second = run('pre', { sessionId: session, toolName: 'Bash', toolInput: { command: 'git commit' } });
  assert.equal(second.status, 0);

  run('sessionend', { sessionId: session });
  rmSync(proj5, { recursive: true, force: true });
});

test('a red end of turn nobody read is kept when the next one is parked', () => {
  const session = sid('kept');
  const project = mkdtempSync(join(tmpdir(), 'smugan-grok-kept-'));
  writeFileSync(join(project, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  mkdirSync(join(project, 'src'));
  const file = join(project, 'src', 'a.ts');
  const pendingMarker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  try {
    const content = "import { readFileSync } from 'node:fs';\nexport const value = 1;\n";
    writeFileSync(file, content);
    run('post', { sessionId: session, toolName: 'write', toolInput: { file_path: file, content } });
    assert.equal(run('stop', { sessionId: session }).status, 0);
    // The file is saved by hand with the import one line down, and the next turn calls no tool:
    // nothing delivered the first verdict before the second one was parked.
    writeFileSync(file, "export const value = 1;\nimport { readFileSync } from 'node:fs';\n");
    assert.equal(run('stop', { sessionId: session }).status, 0);
    const pending = JSON.parse(readFileSync(pendingMarker, 'utf8'));
    assert.match(pending.stop, /src\/a\.ts:2 {2}\[dead-imports\]/);
    assert.match(pending['stop-earlier'], /src\/a\.ts:1 {2}\[dead-imports\]/);

    const pre = run('pre', { sessionId: session, toolName: 'read_file', toolInput: { target_file: file } });
    assert.equal(pre.status, 2);
    assert.match(JSON.parse(pre.stdout).reason, /src\/a\.ts:2 {2}\[dead-imports\][\s\S]*An earlier end of turn had also reported this, which nobody had read yet:\n[\s\S]*src\/a\.ts:1 {2}\[dead-imports\]/);
    assert.ok(!existsSync(pendingMarker), 'both are delivered once');

    // More of them than fit: the oldest are the ones kept, the newest stays whole under its own key.
    writeFileSync(pendingMarker, JSON.stringify({ stop: 'smugan stop: second\n', 'stop-earlier': 'smugan stop: first\n' + 'x'.repeat(40 * 1024) }));
    writeFileSync(file, "export const value = 1;\n\nimport { readFileSync } from 'node:fs';\n");
    assert.equal(run('stop', { sessionId: session }).status, 0);
    const piled = JSON.parse(readFileSync(pendingMarker, 'utf8'));
    assert.match(piled.stop, /src\/a\.ts:3 {2}\[dead-imports\]/);
    assert.equal(piled['stop-earlier'].length, 32 * 1024);
    assert.ok(piled['stop-earlier'].startsWith('smugan stop: first\n'));

    writeFileSync(pendingMarker, JSON.stringify({ stop: 'smugan stop: second\n', 'stop-earlier': 'smugan stop: first\n' }));
    writeFileSync(file, "export const value = 1;\n\n\nimport { readFileSync } from 'node:fs';\n");
    assert.equal(run('stop', { sessionId: session }).status, 0);
    assert.match(JSON.parse(readFileSync(pendingMarker, 'utf8'))['stop-earlier'], /^smugan stop: first\n\nsmugan stop: second\n$/);
  } finally {
    run('sessionend', { sessionId: session });
    rmSync(project, { recursive: true, force: true });
  }
});

test('the turn after a red end of turn is checked again, and what it broke is delivered', () => {
  const session = sid('turns');
  const project = mkdtempSync(join(tmpdir(), 'smugan-grok-turns-'));
  writeFileSync(join(project, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  mkdirSync(join(project, 'src'));
  // What only the end of the turn catches: an import nothing uses.
  const leave = (name) => {
    const file = join(project, 'src', name);
    const content = "import { readFileSync } from 'node:fs';\nexport const value = 1;\n";
    writeFileSync(file, content);
    run('post', { sessionId: session, toolName: 'write', toolInput: { file_path: file, content } });
  };
  const nextCall = () => run('pre', { sessionId: session, toolName: 'read_file', toolInput: { target_file: join(project, 'src', 'a.ts') } });
  try {
    leave('a.ts');
    assert.equal(run('stop', { sessionId: session }).status, 0);
    const first = nextCall();
    assert.equal(first.status, 2);
    assert.match(JSON.parse(first.stdout).reason, /src\/a\.ts:1 {2}\[dead-imports\]/);

    leave('b.ts');
    assert.equal(run('stop', { sessionId: session }).status, 0);
    const second = nextCall();
    assert.equal(second.status, 2, 'the second turn was checked, not released on the hold of the first');
    assert.match(JSON.parse(second.stdout).reason, /src\/b\.ts:1 {2}\[dead-imports\]/);
  } finally {
    run('sessionend', { sessionId: session });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a Stop the host calls a continuation, and the one that closes the session, are no turn of their own', () => {
  const session = sid('cont');
  const project = mkdtempSync(join(tmpdir(), 'smugan-grok-cont-'));
  writeFileSync(join(project, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(project, 'src', 'red.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export function f() { try { f(); } catch {} }\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  const pendingMarker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  try {
    // The session closing: nothing runs, nothing is parked, the turn's record stays as it was.
    writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
    assert.equal(run('stop', { sessionId: session, reason: 'shutdown' }).status, 0);
    assert.ok(!existsSync(pendingMarker), 'the closing Stop checked nothing');
    assert.equal(JSON.parse(readFileSync(turnMarker, 'utf8')).blocks, 0);

    // A held turn the host is continuing: the hold is spent, and this Stop is not another turn.
    writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 1, baselines: {} }));
    assert.equal(run('stop', { sessionId: session, reason: 'end_turn', stopHookActive: true }).status, 0);
    const pending = JSON.parse(readFileSync(pendingMarker, 'utf8'));
    assert.equal(pending.stop, undefined, 'no second verdict for the same turn');
    assert.match(pending['stop-notice'], /1 blocked attempt spent/);
  } finally {
    run('sessionend', { sessionId: session });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a patch the host cut short is refused: its last files could not be seen', () => {
  const session = sid('cut');
  const patch = ['*** Begin Patch', '*** Add File: src/first.ts', '+export const first = 1;', '*** Add File: src/sec'].join('\n');
  const cut = run('pre', { sessionId: session, cwd: proj, toolName: 'apply_patch', toolInput: { patch }, toolInputTruncated: true });
  assert.equal(cut.status, 2);
  assert.match(JSON.parse(cut.stdout).reason, /several smaller patches/);
  const whole = run('pre', { sessionId: session, cwd: proj, toolName: 'apply_patch', toolInput: { patch: patch.replace('\n*** Add File: src/sec', '\n*** End Patch') }, toolInputTruncated: false });
  assert.equal(whole.status, 0);
});

test('pre judges every file of a Codex-toolset apply_patch, and post records them', () => {
  const session = sid('patch');
  const project = mkdtempSync(join(tmpdir(), 'smugan-grok-patch-'));
  writeFileSync(join(project, 'smugan.config.json'), '{}');
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'src', 'util.ts'), 'export const one = 1;\nexport const two = 2;\n');
  // Paths in a patch are relative to the session's folder, not to the hook's own.
  const patch = (lines) => ({ sessionId: session, cwd: project, workspaceRoot: project, toolName: 'apply_patch', toolInput: { patch: ['*** Begin Patch', ...lines, '*** End Patch'].join('\n') } });
  try {
    const denied = run('pre', patch([
      '*** Add File: src/fine.ts',
      '+export const fine = 1;',
      '*** Update File: src/util.ts',
      '@@',
      ' export const two = 2;',
      '+export function swallow() { try { JSON.parse("x"); } catch {} }',
    ]));
    assert.equal(denied.status, 2);
    assert.match(JSON.parse(denied.stdout).reason, /src\/util\.ts[\s\S]*empty-catch/);

    const clean = patch(['*** Add File: src/added.ts', '+export const added = 1;', '*** Update File: src/util.ts', '@@', ' export const two = 2;', '+export const three = 3;']);
    assert.equal(run('pre', clean).status, 0);
    writeFileSync(join(project, 'src', 'added.ts'), 'export const added = 1;\n');
    writeFileSync(join(project, 'src', 'util.ts'), 'export const one = 1;\nexport const two = 2;\nexport const three = 3;\n');
    assert.equal(run('post', clean).status, 0);
    const turn = JSON.parse(readFileSync(join(tmpdir(), 'smugan-turn-' + session + '.json'), 'utf8'));
    assert.deepEqual(turn.files.map((file) => basename(file)).sort(), ['added.ts', 'util.ts']);
  } finally {
    run('sessionend', { sessionId: session });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a stop timeout is delivered once without overwriting undelivered failures', () => {
  const session = sid('timeout');
  const project = mkdtempSync(join(tmpdir(), 'smugan-grok-timeout-'));
  writeFileSync(join(project, 'smugan.config.json'), JSON.stringify({ hook: { stop: { timeoutMs: 7000, typecheck: false } } }));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setTimeout(() => {}, 30000)"' } }));
  const file = join(project, 'fine.js');
  writeFileSync(file, 'export const fine = 1;\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  const pendingMarker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));
  writeFileSync(pendingMarker, JSON.stringify({ stop: 'smugan stop: old failure\n' }));
  try {
    assert.equal(run('stop', { sessionId: session }).status, 0);
    const pending = JSON.parse(readFileSync(pendingMarker, 'utf8'));
    assert.match(pending.stop, /old failure/);
    assert.match(pending['stop-notice'], /result not verified/);
    const payload = { sessionId: session, toolName: 'Bash', toolInput: { command: 'git status' } };
    const delivered = run('pre', payload);
    assert.equal(delivered.status, 2);
    const reason = JSON.parse(delivered.stdout).reason;
    assert.match(reason, /old failure/);
    assert.match(reason, /result not verified/);
    assert.equal(run('pre', payload).status, 0);
  } finally {
    run('sessionend', { sessionId: session });
    rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('pre delivers post and stop debt together, once', () => {
  const session = sid('l');
  const marker = join(tmpdir(), 'smugan-grok-pending-' + session + '.json');
  writeFileSync(marker, JSON.stringify({
    [join(proj, 'a.ts')]: 'eslint (a.ts): boom\n',
    stop: 'smugan stop: DoD red\n',
  }));
  const cleanWrite = {
    sessionId: session,
    toolName: 'Write',
    toolInput: { filePath: join(proj, 'src', 'both.ts'), content: 'export const both = 1;\n' },
  };
  const first = run('pre', cleanWrite);
  assert.equal(first.status, 2);
  const reason = JSON.parse(first.stdout).reason;
  assert.match(reason, /boom/);
  assert.match(reason, /DoD red/);
  const second = run('pre', cleanWrite);
  assert.equal(second.status, 0);
});

test('sessionend removes turn, held-failure, pending and rules markers', () => {
  const session = sid('m');
  const markers = ['smugan-turn-', 'smugan-stopdebt-', 'smugan-grok-pending-', 'smugan-grok-rules-']
    .map((prefix) => join(tmpdir(), prefix + session + '.json'));
  for (const marker of markers) writeFileSync(marker, '{}');
  const { status } = run('sessionend', { sessionId: session });
  assert.equal(status, 0);
  for (const marker of markers) assert.ok(!existsSync(marker), marker + ' should be gone');
});

// rule-teach needs the edited file OUTSIDE the launcher's tmpdir (scratch does
// not teach), so the child gets a private temp dir and the project stays put.
const teachTmp = mkdtempSync(join(tmpdir(), 'smugan-grok-tmp-'));
const teachHome = mkdtempSync(join(tmpdir(), 'smugan-grok-home-'));
mkdirSync(join(teachHome, 'rules'), { recursive: true });
writeFileSync(
  join(teachHome, 'rules', 'testing.md'),
  '---\npaths:\n  - "**/*.test.*"\n  - "**/tests/**"\n---\n\n# Testing rule\n',
);
const teachEnv = { GROK_HOME: teachHome, TMPDIR: teachTmp, TMP: teachTmp, TEMP: teachTmp };
after(() => {
  rmSync(teachTmp, { recursive: true, force: true });
  rmSync(teachHome, { recursive: true, force: true });
});

test('first edit of a rule-matching file teaches once, then allows', () => {
  const session = sid('n');
  const payload = {
    sessionId: session,
    toolName: 'Write',
    toolInput: { filePath: join(proj, 'src', 'foo.test.ts'), content: 'export const t = 1;\n' },
  };
  const first = run('pre', payload, teachEnv);
  assert.equal(first.status, 2);
  const reason = JSON.parse(first.stdout).reason;
  assert.match(reason, /smugan rules/);
  assert.match(reason, /testing\.md/);
  const rulesMarker = join(teachTmp, 'smugan-grok-rules-' + session + '.json');
  assert.deepEqual(JSON.parse(readFileSync(rulesMarker, 'utf8')).surfaced, ['testing']);

  const second = run('pre', payload, teachEnv);
  assert.equal(second.status, 0, 'the rule was surfaced — same edit now passes');

  const other = run('pre', {
    sessionId: session,
    toolName: 'Write',
    toolInput: { filePath: join(proj, 'src', 'plain.ts'), content: 'export const p = 1;\n' },
  }, teachEnv);
  assert.equal(other.status, 0, 'files matching no rule never teach');
});

test('rule-teach skips scratch files under the temp dir and honors SMUGAN_TEACH=0', () => {
  const scratch = run('pre', {
    sessionId: sid('o'),
    toolName: 'Write',
    toolInput: { filePath: join(teachTmp, 'scratch.test.ts'), content: 'export const s = 1;\n' },
  }, teachEnv);
  assert.equal(scratch.status, 0);

  const disabled = run('pre', {
    sessionId: sid('p'),
    toolName: 'Write',
    toolInput: { filePath: join(proj, 'src', 'off.test.ts'), content: 'export const o = 1;\n' },
  }, { ...teachEnv, SMUGAN_TEACH: '0' });
  assert.equal(disabled.status, 0);
});

function runInstall(home, smuganPath, env = {}) {
  return spawnSync(process.execPath, [INSTALL, ROOT, smuganPath], {
    encoding: 'utf8',
    env: { ...process.env, GROK_HOME: home, SMUGAN_GROK_FALLBACK_SKILLS: '', SMUGAN_UI_LANG: '', SMUGAN_REPLY_LANG: '', ...env },
  });
}

test('install generates AGENTS.md from smugan CLAUDE.md and installs subagents', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-grok-install-'));
  const res = runInstall(home, SMUGAN);
  assert.equal(res.status, 0, res.stderr);

  const agentsMd = readFileSync(join(home, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /## Grok Build adaptations/);
  assert.match(agentsMd, /## Definition of done/);
  assert.ok(agentsMd.includes('~/.grok/rules/'));
  assert.ok(!agentsMd.includes('~/.claude/'), 'every Claude path is rewritten');
  // Claims rides in from claude/CLAUDE.md, Answers from this adapter's tail.
  // Twice would mean a rule that already propagates was re-added by hand.
  assert.equal((agentsMd.match(/^## Claims$/gm) ?? []).length, 1, 'the Claims rules reach the steering, once');
  assert.equal((agentsMd.match(/^## Answers$/gm) ?? []).length, 1, 'the answer-shape rules reach the steering, once');
  // Heading counts do NOT catch a rule re-added as a BULLET inside a section
  // that already exists — how the unfinished-work rule shipped twice in 0.15.0.
  assert.equal((agentsMd.match(/NOT DONE/g) ?? []).length, 1, 'the unfinished-work rule arrives once — it propagates from CLAUDE.md, do not repeat it in the tail');

  const critic = readFileSync(join(home, 'agents', 'critic.md'), 'utf8');
  assert.match(critic, /name: critic/);
  assert.ok(!/^tools:/m.test(critic), 'Claude tool names are dropped from the frontmatter');
  assert.ok(existsSync(join(home, 'agents', 'flow-critic.md')));
  assert.ok(!existsSync(join(home, 'skills', 'critic')), 'no skill competing with the agent');

  const skill = readFileSync(join(home, 'skills', 'smugan', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('~/.grok/hooks/smugan.paths.json'));
  assert.match(skill, /flows/);

  const cfg = JSON.parse(readFileSync(join(home, 'hooks', 'smugan.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionEnd', 'Stop']);
  assert.ok(existsSync(join(home, 'hooks', 'rule-teach.mjs')));

  const again = runInstall(home, SMUGAN);
  assert.equal(again.status, 0, again.stderr);
  const twice = readFileSync(join(home, 'AGENTS.md'), 'utf8');
  assert.equal(twice.split('smugan:start').length - 1, 1, 'reinstall replaces the managed block, never stacks it');

  rmSync(home, { recursive: true, force: true });
});

test('install fallback mode swaps subagents for skills', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-grok-fallback-'));
  assert.equal(runInstall(home, SMUGAN).status, 0);
  const res = runInstall(home, SMUGAN, { SMUGAN_GROK_FALLBACK_SKILLS: '1' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(join(home, 'skills', 'critic', 'SKILL.md')));
  assert.ok(existsSync(join(home, 'skills', 'flow-critic', 'SKILL.md')));
  assert.ok(!existsSync(join(home, 'agents', 'critic.md')), 'agents removed in fallback mode');
  assert.match(readFileSync(join(home, 'AGENTS.md'), 'utf8'), /run the `\/critic` or `\/flow-critic` skill instead/);
  rmSync(home, { recursive: true, force: true });
});

test('install fails loud when the CLAUDE.md anchor is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-grok-doctored-home-'));
  const fake = mkdtempSync(join(tmpdir(), 'smugan-grok-doctored-'));
  mkdirSync(join(fake, 'packages', 'gate', 'src'), { recursive: true });
  writeFileSync(join(fake, 'packages', 'gate', 'src', 'hook.mjs'), '');
  for (const file of ['language.cjs', 'profile.cjs', 'parts.cjs']) copyFileSync(join(SMUGAN, 'packages', 'gate', 'src', file), join(fake, 'packages', 'gate', 'src', file));
  mkdirSync(join(fake, 'claude'), { recursive: true });
  writeFileSync(join(fake, 'claude', 'CLAUDE.md'), '# Rules\n\n## Definition of done\n\n- checks.\n');
  const res = runInstall(home, fake);
  assert.notEqual(res.status, 0, 'a missing anchor must abort the install');
  assert.match(res.stderr, /Stack rules/);
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('the install-time language choice reaches every installed file', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-grok-lang-'));
  const pt = { SMUGAN_UI_LANG: 'pt-BR', SMUGAN_REPLY_LANG: 'pt-BR' };
  const rule = join(home, 'rules', 'ui-ptbr.md');
  const paths = () => JSON.parse(readFileSync(join(home, 'hooks', 'smugan.paths.json'), 'utf8'));
  // No {{TOKEN}} may reach the host, in any markdown the installer wrote.
  const leftovers = () => [home].flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .filter((file) => /\{\{[A-Z_]+\}\}/.test(readFileSync(file, 'utf8'))));

  let res = runInstall(home, SMUGAN);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'a pt-BR UI rule is not installed while the UI language is off');
  assert.ok(!readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('NÃO FEITO'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], [null, null]);
  assert.match(res.stdout, /= UI language: off · reply language: off/);

  res = runInstall(home, SMUGAN, pt);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'pt-BR as UI language installs its rule');
  assert.equal((readFileSync(join(home, 'AGENTS.md'), 'utf8').match(/NÃO FEITO/g) ?? []).length, 1);
  assert.ok(!readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('NOT DONE'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], ['pt-BR', 'pt-BR']);
  assert.match(res.stdout, /= UI language: pt-BR · reply language: pt-BR/);

  res = runInstall(home, SMUGAN);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'a plain reinstall keeps the previous choice');

  res = runInstall(home, SMUGAN, { SMUGAN_UI_LANG: 'off' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'turning the UI language off removes the rule it installed');

  const clean = mkdtempSync(join(tmpdir(), 'smugan-grok-lang-'));
  res = runInstall(clean, SMUGAN, { SMUGAN_UI_LANG: 'not a tag' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /SMUGAN_UI_LANG/);
  assert.deepEqual(readdirSync(clean), [], 'an invalid language aborts before any write');
  rmSync(home, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
});

test('SMUGAN_DISABLE in fallback mode ships only the reviewer left, as a skill', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-grok-disable-'));
  try {
    const res = runInstall(home, SMUGAN, { SMUGAN_GROK_FALLBACK_SKILLS: '1', SMUGAN_DISABLE: 'flow-critic,smugan-build' });
    assert.equal(res.status, 0, res.stderr);
    const agentsMd = readFileSync(join(home, 'AGENTS.md'), 'utf8');
    assert.match(agentsMd, /launch the `critic` subagent, run the `\/critic` skill instead/);
    assert.doesNotMatch(agentsMd, /flow-critic|smugan-build/);
    assert.ok(existsSync(join(home, 'skills', 'critic', 'SKILL.md')));
    assert.ok(!existsSync(join(home, 'skills', 'flow-critic')));
    assert.ok(!existsSync(join(home, 'skills', 'smugan-build', 'SKILL.md')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
