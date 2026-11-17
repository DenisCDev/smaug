// @ts-check
// Three levels, from the path: a trivial turn keeps the gate and the
// typecheck and skips the suite; `smugan risk` forces a level for a while, and
// a level it lowers is always shown to the user.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runHook } from '../src/hook.mjs';
import { checkoutStateFile } from '../src/contract.mjs';
import { fileLevel, riskOverride, riskOverrideDir, runRisk } from '../src/risk.mjs';

const cache = mkdtempSync(join(tmpdir(), 'smugan-risk-cache-'));
const previousCache = process.env.SMUGAN_CACHE_DIR;
process.env.SMUGAN_CACHE_DIR = cache;
let counter = 0;
/** @type {string[]} */
const sessions = [];
/** @type {string[]} */
const dirs = [cache];
after(() => {
  for (const id of sessions) for (const p of ['smugan-turn-', 'smugan-report-', 'smugan-events-', 'smugan-stopdebt-', 'smugan-session-']) rmSync(join(tmpdir(), p + id + '.json'), { force: true });
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (previousCache === undefined) delete process.env.SMUGAN_CACHE_DIR;
  else process.env.SMUGAN_CACHE_DIR = previousCache;
});

function session() {
  const id = `smuganrisktest${process.pid}n${++counter}`;
  sessions.push(id);
  return id;
}

/** A project whose test suite always fails, so a run of it shows up as a hold. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-risk-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "console.error(\'SUITE_RAN\'); process.exit(1)"' } }));
  mkdirSync(join(dir, 'src'));
  return dir;
}

/** @param {string} id @param {string} file @param {string} content */
async function touch(id, file, content) {
  writeFileSync(file, content);
  await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: file } });
}

test('styles, assets, translations, prose and editor files are trivial; code is normal; critical wins', () => {
  for (const rel of ['src/app.css', 'src/theme.module.scss', 'public/logo.svg', 'public/fonts/a.woff2', 'src/locales/pt-BR/common.json', 'messages/en.json', 'locale/pt.po', 'README.md', '.prettierrc', '.gitignore']) {
    assert.equal(fileLevel(rel), 'trivial', rel);
  }
  for (const rel of ['src/app.ts', 'src/messages.ts', 'src/data/pt.json', 'tsconfig.json', 'src/page.mdx']) assert.equal(fileLevel(rel), 'normal', rel);
  for (const rel of ['src/auth/strings.json', 'supabase/migrations/1.sql', 'src/auth/theme.css']) assert.equal(fileLevel(rel), 'critical', rel);
});

test('a trivial turn skips the test suite; a turn with code runs it', async () => {
  const dir = project();
  const css = join(dir, 'src', 'app.css');
  const trivial = session();
  await touch(trivial, css, 'body { color: red; }\n');
  const skipped = await runHook('stop', { session_id: trivial });
  assert.equal(skipped.exitCode, 0, 'the failing suite never ran');
  const mixed = session();
  await touch(mixed, css, 'body { color: blue; }\n');
  await touch(mixed, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  const ran = await runHook('stop', { session_id: mixed });
  assert.equal(ran.exitCode, 2);
  assert.match(ran.stderr, /SUITE_RAN/);
});

test('smugan risk trivial lowers a critical file, and every Stop says so until auto', async () => {
  const dir = project();
  assert.match(runRisk(['trivial', dir]), /level trivial forced on .* until .* UTC/);
  assert.equal(riskOverride(dir)?.level, 'trivial');
  const id = session();
  await touch(id, join(dir, 'src', 'auth.ts'), 'export const a = 1;\n');
  const lowered = await runHook('stop', { session_id: id });
  assert.equal(lowered.exitCode, 0, 'the forced level skipped the suite');
  assert.match(lowered.stdout ?? '', /"systemMessage"/);
  assert.match(lowered.stdout ?? '', /forced with `smugan risk` and downgraded src\/auth\.ts \(critical\)/);
  assert.match(runRisk(['auto', dir]), /is decided by the hook again/);
  assert.equal(riskOverride(dir), null);
  const back = session();
  await touch(back, join(dir, 'src', 'auth.ts'), 'export const a = 2;\n');
  const held = await runHook('stop', { session_id: back });
  assert.equal(held.exitCode, 2);
  assert.match(held.stderr, /attempt 1\/2/, 'critical again: two holds');
});

test('smugan risk critical raises an ordinary file: the reminder and two holds', async () => {
  const dir = project();
  runRisk(['critical', dir]);
  const id = session();
  const file = join(dir, 'src', 'a.ts');
  const pre = await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content: 'export const a = 1;\n' } });
  assert.match(pre.context ?? '', /src\/a\.ts is a critical change \(level forced with smugan risk\)/);
  await touch(id, file, 'export const a = 1;\n');
  const held = await runHook('stop', { session_id: id });
  assert.match(held.stderr, /attempt 1\/2/);
  assert.doesNotMatch(held.stderr, /downgraded/, 'raising a level is not a warning');
  runRisk(['auto', dir]);
});

test('an expired override is ignored, and smugan risk alone shows the state', () => {
  const dir = project();
  assert.match(runRisk([dir]), /no level forced/);
  runRisk(['normal', dir]);
  assert.match(runRisk([dir]), /level normal forced/);
  writeFileSync(checkoutStateFile('risk', dir), JSON.stringify({ level: 'trivial', expiresAt: '2000-01-01T00:00:00.000Z' }));
  assert.equal(riskOverride(dir), null);
  assert.throws(() => runRisk(['nope', 'extra']), /Usage: smugan risk/);
});

test('a mistyped level is an error, and an expired override is deleted', () => {
  const dir = project();
  for (const word of ['crítico', 'critica']) assert.throws(() => runRisk([word]), /unknown level/, word);
  assert.match(runRisk(['Critical', dir]), /level critical forced/, 'case does not matter');
  const file = checkoutStateFile('risk', dir);
  writeFileSync(file, JSON.stringify({ level: 'trivial', expiresAt: '2000-01-01T00:00:00.000Z' }));
  assert.equal(riskOverride(dir), null);
  assert.equal(existsSync(file), false, 'the lapsed override no longer costs a git call per edit');
});

test('the lowering notice reaches the user without turning a green Stop into stderr', async () => {
  const dir = project();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
  runRisk(['trivial', dir]);
  const id = session();
  await touch(id, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  const result = await runHook('stop', { session_id: id });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '', 'adapters read exit-0 stderr as an unfinished turn');
  assert.match(result.stdout ?? '', /downgraded src\/a\.ts \(normal\)/);
  runRisk(['auto', dir]);
});

test('only the user lowers a level: the agent\'s Bash and edits into the override folder are refused', async () => {
  const dir = project();
  const bash = (/** @type {string} */ command, tool = 'Bash') => runHook('bash', { tool_name: tool, session_id: session(), cwd: dir, tool_input: { command } });
  for (const command of ['smugan risk trivial', `cd "${dir}" && smugan risk Normal`, 'node "D:/src/smugan/packages/gate/bin/smugan.mjs" risk trivial .', 'smugan "risk" trivial', 'S=trivial; smugan risk $S', `node -e "import('x/risk.mjs').then(m => m.runRisk(['trivial']))"`,'echo {} > "$LOCALAPPDATA/smugan/risk/x.json"', `rm -rf "${dirname(riskOverrideDir())}"`, `rm -rf ${riskOverrideDir()}`]) {
    const result = await bash(command);
    assert.equal(result.exitCode, 2, command);
    assert.match(result.stderr, /only the user does it\. Ask the user to run it in their own terminal or with `!`/);
  }
  // Ordinary commands that mention a smugan checkout, a cache or Join-Path run.
  for (const command of ['smugan risk critical', 'smugan risk', 'npm test', 'git status', 'cd ~/.local/src/smugan && git status',
    'node /usr/local/lib/node_modules/smugan/bin/smugan.mjs check', "Get-Content (Join-Path 'D:\\src\\smugan' 'README.md')",
    `ls "${dirname(riskOverrideDir())}-other"`, 'curl http://localhost:3000/smugan']) assert.equal((await bash(command)).exitCode, 0, command);
  assert.equal((await bash('smugan risk auto')).exitCode, 2, 'auto can lift a forced critical: the user runs it');
  assert.equal((await bash('smugan risk trivial', 'PowerShell')).exitCode, 2, 'the PowerShell tool is a shell too');
  const write = await runHook('pre', { tool_name: 'Write', session_id: session(), tool_input: { file_path: checkoutStateFile('risk', dir), content: '{"level":"trivial","expiresAt":"2999-01-01T00:00:00Z"}' } });
  assert.equal(write.exitCode, 2);
  assert.equal(riskOverride(dir), null);
});

test('a forced level that vanishes before it lapses is reported; one the user cleared is not', async () => {
  const dir = project();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
  const id = session();
  const file = join(dir, 'src', 'a.ts');
  runRisk(['critical', dir]);
  await touch(id, file, 'export const a = 1;\n');
  await runHook('stop', { session_id: id });
  rmSync(checkoutStateFile('risk', dir), { force: true }); // deleted by any means
  await touch(id, file, 'export const a = 2;\n');
  const vanished = await runHook('stop', { session_id: id });
  assert.equal(vanished.exitCode, 0);
  assert.match(vanished.stdout ?? '', /disappeared before it expired, without `smugan risk auto`/);
  const cleared = session();
  runRisk(['critical', dir]);
  await touch(cleared, file, 'export const a = 3;\n');
  await runHook('stop', { session_id: cleared });
  runRisk(['auto', dir]);
  await touch(cleared, file, 'export const a = 4;\n');
  assert.doesNotMatch((await runHook('stop', { session_id: cleared })).stdout ?? '', /disappeared/);
});

test('a level forced between turns and deleted by the next shell command is reported, also after a held Stop', async () => {
  const dir = project();
  const id = session();
  const file = join(dir, 'src', 'a.ts');
  runRisk(['critical', dir]);
  // The shell command that deletes it is seen by the shell hook before it runs.
  await runHook('bash', { tool_name: 'Bash', session_id: id, cwd: dir, tool_input: { command: 'node cleanup.mjs' } });
  rmSync(checkoutStateFile('risk', dir), { force: true });
  await touch(id, file, 'export const a = 1;\n');
  const held = await runHook('stop', { session_id: id });
  assert.equal(held.exitCode, 2, 'the failing suite holds the turn');
  const released = await runHook('stop', { session_id: id });
  assert.match(released.stdout ?? '', /disappeared before it expired/, 'the notice waits for a Stop the user sees');
});

test('a held lock on the session state never lets a lowering command through', async () => {
  const dir = project();
  const id = session();
  runRisk(['critical', dir]);
  const lock = join(tmpdir(), `smugan-session-${id}.json.lock`);
  mkdirSync(lock);
  try {
    const result = await runHook('bash', { tool_name: 'Bash', session_id: id, cwd: dir, tool_input: { command: 'smugan risk trivial' } });
    assert.equal(result.exitCode, 2, 'refused before any state I/O');
    assert.equal((await runHook('bash', { tool_name: 'Bash', session_id: id, cwd: dir, tool_input: { command: 'git status' } })).exitCode, 0, 'an ordinary command still runs');
    // The Stop keeps its checks too: a stuck lock only costs the vanish notice.
    await touch(id, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    const stop = await runHook('stop', { session_id: id });
    assert.equal(stop.exitCode, 2);
    assert.match(stop.stderr, /SUITE_RAN/);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
});

test('the guard knows the cache folder as Git Bash and the home shell write it', async () => {
  const { lowersRisk } = await import('../src/risk.mjs');
  const base = dirname(riskOverrideDir()).replace(/\\/g, '/');
  const bashForm = base.replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`);
  assert.notEqual(lowersRisk(`rm -rf ${bashForm}`), null, bashForm);
  const home = homedir().replace(/\\/g, '/');
  if (base.toLowerCase().startsWith(home.toLowerCase() + '/')) assert.notEqual(lowersRisk(`rm -rf ~${base.slice(home.length)}`), null);
});

test('a renamed or committed JS/TS change stays normal and runs the suite', async () => {
  const dir = project();
  const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: dir, stdio: 'ignore', timeout: 15_000 });
  const file = join(dir, 'src', 'total.js');
  writeFileSync(file, 'export function total(items) {\n  const sum = items.reduce((s, i) => s + i, 0);\n  return sum;\n}\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const renamed = session();
  await touch(renamed, file, 'export function total(items) {\n  const acc = items.reduce((s, i) => s + i, 0);\n  return acc;\n}\n');
  assert.match((await runHook('stop', { session_id: renamed })).stderr, /SUITE_RAN/, 'a rename is normal');
  const committed = session();
  await touch(committed, file, 'export function total(items) {\n  const acc = items.reduce((s, i) => s - i, 1);\n  return acc;\n}\n');
  git('commit', '-qam', 'change');
  assert.match((await runHook('stop', { session_id: committed })).stderr, /SUITE_RAN/, 'committing inside the turn does not make a change trivial');
});
