// @ts-check
// Typecheck runs at the end of the turn, not on every edit: the post hook only
// lints, and the Stop runs tsc once per tsconfig over the files the turn
// touched, diff-aware against git HEAD, when the project has no typecheck
// script of its own. A stand-in tsc prints errors in tsc's format and logs
// every call, so the tests see where and how often it ran.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/hook.mjs';

const FAKE_TSC = `
const { appendFileSync, readFileSync } = require('node:fs');
const { relative } = require('node:path');
const config = JSON.parse(readFileSync(process.argv[process.argv.indexOf('-p') + 1], 'utf8'));
appendFileSync('tsc-calls.log', JSON.stringify(config.files.map((f) => relative(process.cwd(), f).replace(/\\\\/g, '/'))) + '\\n');
let failed = false;
for (const file of config.files) {
  readFileSync(file, 'utf8').split('\\n').forEach((line, i) => {
    if (!line.includes('BAD_TYPE')) return;
    failed = true;
    console.log(relative(process.cwd(), file) + '(' + (i + 1) + ',1): error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.');
  });
}
process.exit(failed ? 2 : 0);
`;

let counter = 0;
/** @type {string[]} */
const sessions = [];
/** @type {string[]} */
const dirs = [];
after(() => {
  for (const id of sessions) for (const p of ['smugan-turn-', 'smugan-report-', 'smugan-events-', 'smugan-stopdebt-', 'smugan-session-']) rmSync(join(tmpdir(), p + id + '.json'), { force: true });
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function session() {
  const id = `smugantsctest${process.pid}n${++counter}`;
  sessions.push(id);
  return id;
}

/** A git project with a tsconfig and the stand-in tsc. @param {Record<string, unknown>} [pkg] @param {unknown} [smuganConfig] */
function project(pkg = {}, smuganConfig) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-tsc-stop-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, ...pkg }));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
  mkdirSync(join(dir, 'node_modules', 'typescript', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript"}');
  writeFileSync(join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), FAKE_TSC);
  writeFileSync(join(dir, '.gitignore'), 'node_modules\ntsc-calls.log\n');
  if (smuganConfig !== undefined) writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify(smuganConfig));
  mkdirSync(join(dir, 'src'));
  return dir;
}

/** @param {string} dir */
function commitAll(dir) {
  const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: dir, stdio: 'ignore', timeout: 15_000 });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
}

/** @param {string} dir @returns {string[][]} */
function tscCalls(dir) {
  const log = join(dir, 'tsc-calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

/** @param {string} id @param {string} file @param {string} content */
async function edit(id, file, content) {
  writeFileSync(file, content);
  return runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: file } });
}

test('an edit no longer runs tsc; the Stop checks every touched file in one program and holds on a new error', async () => {
  const dir = project();
  const id = session();
  const a = join(dir, 'src', 'a.ts');
  const b = join(dir, 'src', 'b.ts');
  assert.equal((await edit(id, a, 'export const a: number = BAD_TYPE;\n')).exitCode, 0, 'the post hook does not typecheck');
  assert.equal((await edit(id, b, 'export const b = 1;\n')).exitCode, 0);
  assert.deepEqual(tscCalls(dir), [], 'no tsc during the edits');

  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 2);
  assert.match(stop.stderr, /typecheck \(src\/a\.ts\) — 1 new:\n\s+line 1 {2}\[TS2322\]/);
  assert.doesNotMatch(stop.stderr, /src\/b\.ts/);
  assert.deepEqual(tscCalls(dir), [['src/a.ts', 'src/b.ts']], 'one tsc program for both files');
});

test('an error the committed file already had does not hold the turn', async () => {
  const dir = project();
  const file = join(dir, 'src', 'legacy.ts');
  writeFileSync(file, 'export const old: number = BAD_TYPE;\n');
  commitAll(dir);
  const id = session();
  await edit(id, file, 'export const old: number = BAD_TYPE;\nexport const added = 2;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 0, stop.stderr);
  assert.equal(tscCalls(dir).length, 2, 'the turn file, then its HEAD baseline');
});

test('a project typecheck script replaces the per-file tsc', async () => {
  const dir = project({ scripts: { typecheck: 'node -e "process.exit(0)"' } });
  const id = session();
  await edit(id, join(dir, 'src', 'a.ts'), 'export const a: number = BAD_TYPE;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 0, 'the project script passed, and it is the source of truth');
  assert.deepEqual(tscCalls(dir), []);
});

test('with the Stop switched off, the edit itself is type-checked', async () => {
  const dir = project({}, { hook: { stop: false } });
  const id = session();
  const result = await edit(id, join(dir, 'src', 'a.ts'), 'export const a: number = BAD_TYPE;\n');
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /typecheck \(src\/a\.ts\) — 1 new/);
  assert.equal(tscCalls(dir).length, 1);
});

test('tsc exiting non-zero without a type error holds the turn instead of passing', async () => {
  const dir = project();
  writeFileSync(join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), "console.error('FATAL ERROR: heap out of memory'); process.exit(134);\n");
  const id = session();
  await edit(id, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 2);
  assert.match(stop.stderr, /typecheck \(tsc\) failed without reporting a type error:[\s\S]*heap out of memory/);
});

test('the committed versions of several files with errors are checked in one program', async () => {
  const dir = project();
  const files = ['a', 'b', 'c'].map((n) => join(dir, 'src', `${n}.ts`));
  for (const file of files) writeFileSync(file, 'export const old: number = BAD_TYPE;\n');
  commitAll(dir);
  const id = session();
  for (const file of files) await edit(id, file, 'export const old: number = BAD_TYPE;\nexport const added = 2;\n');
  assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
  assert.equal(tscCalls(dir).length, 2, 'the touched files, then all three baselines together');
});

test('a global tsc diagnostic from the committed config is unverified, not a failure of the turn', async () => {
  const dir = project();
  writeFileSync(join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), "console.log(\"error TS2688: Cannot find type definition file for 'missing-types'.\"); process.exit(2);\n");
  const id = session();
  await edit(id, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 0);
  assert.match(stop.stderr, /global error; result not verified/);
});

test('a global tsc error from a tsconfig the turn changed holds the turn', async () => {
  const dir = project();
  writeFileSync(join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), "const t = require('node:fs').readFileSync('tsconfig.json', 'utf8');\nif (t.includes('missing-types')) { console.log(\"error TS2688: Cannot find type definition file for 'missing-types'.\"); process.exit(2); }\n");
  commitAll(dir);
  const id = session();
  await edit(id, join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, types: ['missing-types'] } }));
  await edit(id, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 2);
  assert.match(stop.stderr, /tsconfig\.json changed this turn and tsc rejects it:[\s\S]*TS2688/);
});

test('a global tsc error from a tsconfig the turn created holds the turn', async () => {
  const dir = project();
  writeFileSync(join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), "const t = require('node:fs').readFileSync('tsconfig.json', 'utf8');\nif (t.includes('missing-types')) { console.log(\"error TS2688: Cannot find type definition file for 'missing-types'.\"); process.exit(2); }\n");
  rmSync(join(dir, 'tsconfig.json'));
  commitAll(dir);
  const id = session();
  await edit(id, join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: ['missing-types'] } }));
  await edit(id, join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 2);
  assert.match(stop.stderr, /changed this turn and tsc rejects it/);
});

test('.mts and .cts modules are type-checked at the Stop like .ts; their declaration files are not', async () => {
  const dir = project();
  const id = session();
  await edit(id, join(dir, 'src', 'a.mts'), 'export const a: number = BAD_TYPE;\n');
  await edit(id, join(dir, 'src', 'b.cts'), 'export const b = 1;\n');
  await edit(id, join(dir, 'src', 'types.d.mts'), 'export declare const c: number;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 2);
  assert.match(stop.stderr, /typecheck \(src\/a\.mts\) — 1 new:\n\s+line 1 {2}\[TS2322\]/);
  assert.deepEqual(tscCalls(dir), [['src/a.mts', 'src/b.cts']]);
});

test('an .mts file the project tsconfig does not include is left to the tool that owns it', async () => {
  const dir = project();
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'commonjs' }, include: ['src'] }));
  const id = session();
  // A config file is ESM whatever the project compiles to; tsc on it alone would reject import.meta.
  await edit(id, join(dir, 'vitest.config.mts'), 'export default { root: import.meta.dirname, flag: BAD_TYPE };\n');
  await edit(id, join(dir, 'src', 'a.mts'), 'export const a = 1;\n');
  const stop = await runHook('stop', { session_id: id });
  assert.equal(stop.exitCode, 0, stop.stderr);
  assert.deepEqual(tscCalls(dir), [['src/a.mts']]);
});
