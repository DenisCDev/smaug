// Integration tests: spawn the launcher exactly as Codex would (JSON on stdin,
// stdout JSON decision out, always exit 0), against the real gate engine from
// the sibling checkout. Payload shapes mirror openai/codex's hook schemas
// (codex-rs/hooks/schema/generated/*.json): snake_case fields, the V4A patch
// riding in tool_input.command, paths relative to the session's cwd.
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
const LAUNCHER = join(ROOT, 'codex', 'hooks', 'smugan-hook.mjs');
const SMUGAN = resolve(ROOT, '..', '..');
const GATE = join(SMUGAN, 'packages', 'gate');
assert.ok(existsSync(join(GATE, 'src', 'hook.mjs')), 'smugan repo must contain packages/gate');

const proj = mkdtempSync(join(tmpdir(), 'smugan-cdx-proj-'));
writeFileSync(join(proj, 'smugan.config.json'), '{}');
mkdirSync(join(proj, 'src'), { recursive: true });
const codexHome = mkdtempSync(join(tmpdir(), 'smugan-cdx-home-'));
after(() => {
  rmSync(proj, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

const sid = (suffix) => 'cdx' + RUN + suffix;
const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');

function run(kind, payload, env = {}) {
  const result = spawnSync(process.execPath, [LAUNCHER, kind], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, SMUGAN_GATE_DIR: GATE, CODEX_HOME: codexHome, ...env },
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const applyPatch = (sessionId, patchText, extra = {}) => ({
  session_id: sessionId,
  cwd: proj,
  hook_event_name: 'PreToolUse',
  tool_name: 'apply_patch',
  tool_input: { command: patchText },
  tool_use_id: 'call-1',
  ...extra,
});

test('pre denies an Add File that introduces violations, via the JSON decision', () => {
  const { status, stdout } = run('pre', applyPatch(sid('a'), patch(
    '*** Add File: supabase/migrations/0001_create_clientes.sql',
    '+create table clientes (',
    '+  nome_completo text',
    '+);',
  )));
  assert.equal(status, 0, 'blocking is voiced in JSON, never in the exit code');
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /db-naming|rls/);
});

test('relative patch paths resolve against the payload cwd, not the process cwd', () => {
  // The launcher runs from an unrelated directory; only input.cwd names proj.
  const { stdout } = run('pre', applyPatch(sid('b'), patch(
    '*** Add File: supabase/migrations/0002_more.sql',
    '+create table pedidos (valor_total numeric);',
  )));
  const reason = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /0002_more\.sql/);
});

test('a clean patch passes with no output', () => {
  const { status, stdout } = run('pre', applyPatch(sid('c'), patch(
    '*** Add File: src/util.ts',
    '+export const answer = 42;',
  )));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('one violating file denies the whole multi-file patch', () => {
  const { stdout } = run('pre', applyPatch(sid('d'), patch(
    '*** Add File: src/fine.ts',
    '+export const fine = 1;',
    '*** Add File: src/bad.ts',
    '+export function f() { try { f(); } catch {} }',
  )));
  const reason = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /empty-catch/);
  assert.match(reason, /bad\.ts/);
});

test('an Update File judged against the CRLF file on disk still denies', () => {
  const file = join(proj, 'src', 'crlf.ts');
  writeFileSync(file, 'export function risky() {}\r\nexport const x = 1;\r\n');
  const { stdout } = run('pre', applyPatch(sid('e'), patch(
    '*** Update File: src/crlf.ts',
    '@@',
    '-export function risky() {}',
    '+export function risky() { try { throw new Error("x"); } catch {} }',
  )));
  assert.match(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason, /empty-catch/);
});

test('tools other than apply_patch are ignored', () => {
  const { status, stdout } = run('pre', {
    session_id: sid('f'),
    cwd: proj,
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
  });
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('files under the Codex home are assistant state, never judged', () => {
  const { status, stdout } = run('pre', applyPatch(sid('g'), patch(
    '*** Add File: ' + join(codexHome, 'notes', '0001_clientes.sql'),
    '+create table clientes (nome_completo text);',
  )));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('garbage stdin and garbage patches fail open', () => {
  const rawGarbage = spawnSync(process.execPath, [LAUNCHER, 'pre'], {
    input: 'not json at all',
    encoding: 'utf8',
    env: { ...process.env, SMUGAN_GATE_DIR: GATE },
  });
  assert.equal(rawGarbage.status, 0);
  const patchGarbage = run('pre', applyPatch(sid('h'), 'this is not V4A'));
  assert.equal(patchGarbage.status, 0);
  assert.equal(patchGarbage.stdout, '');
});

test('Add+Update of the SAME file in one envelope: pre fails open by contract', () => {
  // The Update half judges against the disk, where the file does not exist yet
  // at pre time — reconstruction fails and the gate opens. Deliberate: the
  // baseline recorded at pre plus the post touch make the Stop-hook DoD the
  // backstop, and Codex does not emit this shape in practice. This test pins
  // the choice so a future change is conscious, not accidental.
  const { status, stdout } = run('pre', applyPatch(sid('i0'), patch(
    '*** Add File: src/dup.ts',
    '+export const dup = 1;',
    '*** Update File: src/dup.ts',
    '@@',
    '-export const dup = 1;',
    '+export function f() { try { f(); } catch {} }',
  )));
  assert.equal(status, 0);
  assert.equal(stdout, '', 'no deny — the stop-hook DoD is the backstop for this shape');
});

test('post records the touch for every patched file — reconstructable or not', () => {
  const session = sid('i');
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  rmSync(marker, { force: true });
  const fine = join(proj, 'src', 'landed.ts');
  writeFileSync(fine, 'export const landed = 1;\n');
  // A damaged section: the parser keeps the path but cannot rebuild the call.
  const { status } = run('post', applyPatch(session, patch(
    '*** Add File: src/landed.ts',
    '+export const landed = 1;',
    'bare line that damages this section',
  )));
  assert.equal(status, 0);
  assert.ok(existsSync(marker), 'the touch marker exists');
  const files = JSON.parse(readFileSync(marker, 'utf8')).files;
  assert.ok(files.some((f) => f.endsWith('landed.ts')), 'damaged sections still record their path');
  rmSync(marker, { force: true });
});

test('post relays the project checks as a block decision', () => {
  const proj2 = mkdtempSync(join(tmpdir(), 'smugan-cdx-post-'));
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

  const { status, stdout } = run('post', {
    session_id: sid('j'),
    cwd: proj2,
    tool_name: 'apply_patch',
    tool_input: { command: patch('*** Update File: src/bad.js', '@@', '-x', '+y') },
  });
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /fake-eslint: boom/);
  rmSync(proj2, { recursive: true, force: true });
});

test('stop holds a red Definition of Done via the block decision', () => {
  const session = sid('k');
  const proj3 = mkdtempSync(join(tmpdir(), 'smugan-cdx-stop-'));
  writeFileSync(join(proj3, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(proj3, 'src', 'oops.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export function f() { try { f(); } catch {} }\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));

  const { status, stdout } = run('stop', { session_id: session, cwd: proj3, stop_hook_active: false });
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /empty-catch/);
  assert.equal(JSON.parse(readFileSync(turnMarker, 'utf8')).blocks, 1, 'the engine cap advances');

  rmSync(turnMarker, { force: true });
  rmSync(proj3, { recursive: true, force: true });
});

test('a green stop stays silent and cleans the turn marker', () => {
  const session = sid('l');
  const proj4 = mkdtempSync(join(tmpdir(), 'smugan-cdx-green-'));
  writeFileSync(join(proj4, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(proj4, 'src', 'fine.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const fine = 1;\n');
  const turnMarker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(turnMarker, JSON.stringify({ files: [file], blocks: 0, baselines: {} }));

  const { status, stdout } = run('stop', { session_id: session, cwd: proj4, stop_hook_active: false });
  assert.equal(status, 0);
  assert.equal(stdout, '');
  assert.ok(!existsSync(turnMarker));
  rmSync(proj4, { recursive: true, force: true });
});

test('stop cap releases the turn with a visible unverified warning', () => {
  const session = sid('cap');
  const file = join(proj, 'src', 'cap.ts');
  writeFileSync(file, 'export const value = 1;');
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(marker, JSON.stringify({ files: [file], blocks: 3, baselines: {} }));
  try {
    const result = run('stop', { session_id: session });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, undefined, 'the cap must not hold forever');
    assert.match(output.systemMessage, /Its last check was red/);
  } finally {
    rmSync(marker, { force: true });
  }
});

test('missing gate engine reports unavailable without exposing its configured path', () => {
  const secretPath = join(proj, 'private-token-missing-engine');
  const result = run('pre', applyPatch(sid('unavailable'), patch('*** Add File: src/a.ts', '+export const value = 1;')), { SMUGAN_GATE_DIR: secretPath });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /gate unavailable/i);
  assert.equal(output.decision, undefined);
  assert.ok(!result.stdout.includes(secretPath));
});

test('Claude launcher also reports a missing gate engine on the visible channel', () => {
  const result = spawnSync(process.execPath, [join(SMUGAN, 'claude', 'hooks', 'smugan-hook.mjs'), 'pre'], {
    input: '{}', encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, SMUGAN_GATE_DIR: join(proj, 'missing-engine') },
  });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).systemMessage, /gate unavailable/i);
});

test('sessionend removes turn, stop-debt and rules markers within its 1s budget', () => {
  const session = sid('m');
  const markers = ['smugan-turn-', 'smugan-stopdebt-', 'smugan-codex-rules-']
    .map((prefix) => join(tmpdir(), prefix + session + '.json'));
  for (const marker of markers) writeFileSync(marker, '{}');
  const started = Date.now();
  const { status } = run('sessionend', { session_id: session });
  assert.equal(status, 0);
  assert.ok(Date.now() - started < 1000, 'sessionend must fit the 1-second budget');
  for (const marker of markers) assert.ok(!existsSync(marker), marker + ' should be gone');
});

// rule-teach: the taught file must live OUTSIDE the child's temp dir (scratch
// does not teach), so the child gets a private temp dir and the project stays.
const teachTmp = mkdtempSync(join(tmpdir(), 'smugan-cdx-tmp-'));
mkdirSync(join(codexHome, 'rules'), { recursive: true });
writeFileSync(
  join(codexHome, 'rules', 'testing.md'),
  '---\npaths:\n  - "**/*.test.*"\n---\n\n# Testing rule\n',
);
const teachEnv = { TMPDIR: teachTmp, TMP: teachTmp, TEMP: teachTmp };
after(() => rmSync(teachTmp, { recursive: true, force: true }));

test('a rule-matching patch injects context WITHOUT denying, once per session', () => {
  const session = sid('n');
  const payload = applyPatch(session, patch(
    '*** Add File: src/foo.test.ts',
    '+export const t = 1;',
  ));
  const first = run('pre', payload, teachEnv);
  assert.equal(first.status, 0);
  const out = JSON.parse(first.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'teaching never denies on Codex');
  assert.match(out.hookSpecificOutput.additionalContext, /testing\.md/);

  const second = run('pre', payload, teachEnv);
  assert.equal(second.stdout, '', 'a surfaced rule is not taught twice');
});

test('a denial carries the rule context alongside, in the same answer', () => {
  writeFileSync(
    join(codexHome, 'rules', 'supabase.md'),
    '---\npaths:\n  - "**/supabase/**"\n---\n\n# Supabase rule\n',
  );
  const session = sid('o');
  const { stdout } = run('pre', applyPatch(session, patch(
    '*** Add File: supabase/migrations/0003_clientes.sql',
    '+create table clientes (nome_completo text);',
  )), teachEnv);
  const out = JSON.parse(stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /db-naming|rls/);
  assert.match(out.additionalContext, /supabase\.md/);
});

test('framework teaching follows nearest package dependencies, including Hono index.ts', () => {
  const session = sid('frameworks');
  for (const rule of ['nextjs', 'astro', 'hono']) {
    writeFileSync(join(codexHome, 'rules', rule + '.md'), '---\npaths:\n  - "**/*.tsx"\n  - "**/routes/**/*.ts"\n---\n');
  }
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ dependencies: { next: '^16' } }));
  for (const [name, dependencies, file, expected] of [
    ['site', { astro: '^7' }, 'Card.tsx', 'astro'],
    ['api', { hono: '^4' }, 'index.ts', 'hono'],
    ['web', { next: '^15' }, 'Card.tsx', 'nextjs'],
    ['react-only', { react: '^19' }, 'Card.tsx', null],
  ]) {
    const dir = join(proj, String(name));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies }));
    const result = run('pre', applyPatch(session, patch(`*** Add File: ${name}/src/${file}`, '+export const value = 1;')), teachEnv);
    const context = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
    if (expected) assert.match(context, new RegExp(expected + '\\.md'), String(name));
    for (const other of ['nextjs', 'astro', 'hono'].filter((rule) => rule !== expected)) {
      assert.ok(!context.includes(other + '.md'), `${name} must not inherit ${other} from a parent or TSX glob`);
    }
  }
});

test('a patch section the gate cannot rebuild still anchors how the file arrived', () => {
  const session = sid('anchor');
  const repo = mkdtempSync(join(tmpdir(), 'smugan-cdx-anchor-'));
  writeFileSync(join(repo, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  const file = join(repo, 'src', 'util.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const one = 1;\n');
  const git = (...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  // The person's own uncommitted work, there before the turn.
  const debt = 'export const one = 1;\nexport function load() { try { read(); } catch {} }\n';
  writeFileSync(file, debt);

  // An addition with no context line: nothing to rebuild, so nothing to judge.
  const payload = applyPatch(session, patch('*** Update File: src/util.ts', '@@', '+export const two = 2;'), { cwd: repo });
  assert.equal(run('pre', payload).stdout, '');
  writeFileSync(file, debt + 'export const two = 2;\n');
  run('post', { ...payload, hook_event_name: 'PostToolUse' });
  const stop = run('stop', { session_id: session, cwd: repo, stop_hook_active: false });
  assert.equal(stop.stdout, '', 'the empty catch was in the file before the turn');

  for (const prefix of ['smugan-turn-', 'smugan-stopdebt-', 'smugan-report-', 'smugan-events-']) rmSync(join(tmpdir(), prefix + session + '.json'), { force: true });
  rmSync(repo, { recursive: true, force: true });
});
