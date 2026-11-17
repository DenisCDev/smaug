// @ts-check
// The session's first edit of a critical file in a project without a contract
// to work against carries a reminder for the model; it never blocks, never
// repeats in the session, and ordinary edits never get it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHook } from '../src/hook.mjs';
import { contractRoot, markCriterion, saveContract, validateContract } from '../src/contract.mjs';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = resolve(GATE, '..', '..', 'claude', 'hooks', 'smugan-hook.mjs');
const cache = mkdtempSync(join(tmpdir(), 'smugan-hint-cache-'));
const previousCache = process.env.SMUGAN_CACHE_DIR;
process.env.SMUGAN_CACHE_DIR = cache;

let counter = 0;
/** @type {string[]} */
const sessions = [];
function session() {
  const id = `smuganhinttest${process.pid}n${++counter}`;
  sessions.push(id);
  return id;
}
/** @type {string[]} */
const dirs = [];
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-hint-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  return dir;
}
after(() => {
  for (const id of sessions) for (const p of ['smugan-turn-', 'smugan-report-', 'smugan-events-', 'smugan-stopdebt-', 'smugan-session-']) rmSync(join(tmpdir(), p + id + '.json'), { force: true });
  for (const dir of [...dirs, cache]) rmSync(dir, { recursive: true, force: true });
  if (previousCache === undefined) delete process.env.SMUGAN_CACHE_DIR;
  else process.env.SMUGAN_CACHE_DIR = previousCache;
});

/** @param {string} sessionId @param {string} file @param {string} [content] */
const write = (sessionId, file, content = 'export const a = 1;\n') =>
  runHook('pre', { tool_name: 'Write', session_id: sessionId, tool_input: { file_path: file, content } });

/** @param {string} dir */
const critical = (dir) => join(dir, 'src', 'auth', 'session.ts');

const validated = validateContract({
  request: 'deixa o usuário abrir uma das próprias notas pelo id',
  criteria: [
    { behavior: 'o dono vê a nota', verify: 'npm test -- notes' },
    { behavior: 'outro usuário recebe 404', verify: 'npm test -- notes' },
    { behavior: 'id inexistente recebe 404', verify: 'npm test -- notes' },
  ],
});
if (!validated.ok) throw new Error(validated.errors.join('\n'));
const CONTRACT = validated.value;

test('the first edit of a critical file without a contract gets the reminder, once, without a block', async () => {
  const dir = project();
  const id = session();
  const first = await write(id, critical(dir));
  assert.equal(first.exitCode, 0);
  assert.match(first.context ?? '', /src\/auth\/session\.ts is a critical change \(auth or permissions\)/);
  assert.match(first.context ?? '', /no acceptance contract for .*smugan-hint-/i);
  assert.match(first.context ?? '', /bin\/smugan\.mjs" contract --set <file\.json>/);
  assert.match(first.context ?? '', /launch the critic \(and the flow-critic if users see the change\)/);
  const second = await write(id, join(dir, 'src', 'auth', 'login.ts'));
  assert.equal(second.exitCode, 0);
  assert.equal(second.context, undefined, 'one reminder per session');
});

test('under the minimo profile the reminder names only the critic', async () => {
  const previous = process.env.SMUGAN_PROFILE;
  process.env.SMUGAN_PROFILE = 'minimo';
  try {
    const context = (await write(session(), critical(project()))).context ?? '';
    assert.match(context, /launch the critic, as the Definition of done says/);
    assert.doesNotMatch(context, /flow-critic/);
  } finally {
    if (previous === undefined) delete process.env.SMUGAN_PROFILE;
    else process.env.SMUGAN_PROFILE = previous;
  }
});

test('a reviewer or skill disabled by the install or the project leaves the reminder', async () => {
  const previous = process.env.SMUGAN_DISABLE;
  process.env.SMUGAN_DISABLE = 'flow-critic';
  try {
    const dir = project();
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ disable: ['critic', 'smugan-build'] }));
    const context = (await write(session(), critical(dir))).context ?? '';
    assert.match(context, /is a critical change/);
    assert.doesNotMatch(context, /critic|flow-critic|smugan-build/);
    assert.match(context, /write it now, before more edits: /);
    process.env.SMUGAN_DISABLE = 'critic';
    assert.match((await write(session(), critical(project()))).context ?? '', /launch the flow-critic if users see the change, as the Definition/);
  } finally {
    if (previous === undefined) delete process.env.SMUGAN_DISABLE;
    else process.env.SMUGAN_DISABLE = previous;
  }
});

test('ordinary code, prose and edits without a session never get the reminder, nor spend it', async () => {
  const dir = project();
  const id = session();
  assert.equal((await write(id, join(dir, 'src', 'a.ts'))).context, undefined, 'ordinary code');
  assert.equal((await write(id, join(dir, 'docs', 'auth.md'), '# login\n')).context, undefined, 'prose about a critical topic');
  assert.equal((await runHook('pre', { tool_name: 'Write', tool_input: { file_path: critical(dir), content: 'export const a = 1;\n' } })).context, undefined, 'no session');
  assert.match((await write(id, critical(dir))).context ?? '', /No acceptance contract/, 'none of those spent the reminder');
});

test('an unsafe block in Rust is critical by its content', async () => {
  const dir = project();
  const id = session();
  assert.equal((await write(id, join(dir, 'src', 'lib.rs'), 'pub fn add(a: u8, b: u8) -> u8 { a + b }\n')).context, undefined);
  const result = await write(id, join(dir, 'src', 'ffi.rs'), 'pub fn pid() -> i32 { unsafe { libc::getpid() } }\n');
  assert.match(result.context ?? '', /src\/ffi\.rs is a critical change \(Rust unsafe\)/);
});

test('an open contract keeps only the review reminder; an all-done contract asks to check, then replace', async () => {
  const dir = project();
  const root = contractRoot(dir);
  saveContract(root, CONTRACT);
  const open = (await write(session(), critical(dir))).context ?? '';
  assert.match(open, /is a critical change/);
  assert.doesNotMatch(open, /contract --set/, 'pending work already has its contract');
  for (const n of [1, 2]) markCriterion(root, n, 'done', 'npm test -- notes → 3 passed');
  markCriterion(root, 3, 'blocked', 'falta a tabela de notas');
  assert.doesNotMatch((await write(session(), critical(dir))).context ?? '', /contract --set/, 'blocked work may be another session waiting');
  markCriterion(root, 3, 'done', 'npm test -- notes → 3 passed');
  const finished = await write(session(), critical(dir));
  assert.match(finished.context ?? '', /has every criterion done\. .*first check with .*contract that it is finished work and not another session's/);
  assert.match(finished.context ?? '', /contract --set <file\.json> --replace/);
});

test('an unreadable contract becomes a reminder, not a gate failure', async () => {
  const dir = project();
  const id = session();
  const { file } = saveContract(contractRoot(dir), CONTRACT);
  writeFileSync(file, '{ not json');
  const result = await write(id, critical(dir));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, undefined, 'no "gate unavailable" note');
  assert.match(result.context ?? '', /is unreadable .*--replace, or remove it with .*contract --clear/);
});

test('a blocked edit does not spend the reminder', async () => {
  const dir = project();
  const id = session();
  mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
  const blocked = await write(id, join(dir, 'supabase', 'migrations', '0001_init.sql'), 'create table clientes (\n  nome_completo text\n);\n');
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.context, undefined);
  assert.match((await write(id, critical(dir))).context ?? '', /No acceptance contract/);
});

test('later turns of the same session stay quiet; a new session reminds again', async () => {
  const dir = project();
  const id = session();
  const file = critical(dir);
  assert.match((await write(id, file)).context ?? '', /No acceptance contract/);
  writeFileSync(file, 'export const a = 1;\n');
  await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: file } });
  assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
  assert.equal((await write(id, file)).context, undefined, 'the next turn of the same session');
  assert.match((await write(session(), file)).context ?? '', /No acceptance contract/, 'another session');
});

test('the Claude Code launcher hands the reminder over as PreToolUse additionalContext', () => {
  const dir = project();
  const id = session();
  const run = spawnSync(process.execPath, [LAUNCHER, 'pre'], {
    input: JSON.stringify({ tool_name: 'Write', session_id: id, tool_input: { file_path: critical(dir), content: 'export const a = 1;\n' } }),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, SMUGAN_GATE_DIR: GATE, SMUGAN_CACHE_DIR: cache },
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /No acceptance contract/);
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined, 'the reminder never decides the permission');
});
