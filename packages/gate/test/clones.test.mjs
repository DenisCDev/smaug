// @ts-check
// Exact and renamed clones of an existing function, found at the end of the
// turn over normalized tokens, listed once, never for small or new-only code.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashedFunctions, MIN_TOKENS, repositoryIndex } from '../src/clones.mjs';
import { runHook } from '../src/hook.mjs';

const FORMAT = `export function formatCents(cents, currency) {
  const sign = cents < 0 ? '-' : '';
  const value = Math.abs(cents);
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
  return \`\${sign}\${currency} \${grouped},\${fraction}\`;
}
`;
const RENAMED = `export function moneyLabel(amount, symbol) {
  const minus = amount < 0 ? '−' : '';
  const n = Math.abs(amount);
  const units = Math.floor(n / 100);
  const rest = String(n % 100).padStart(2, '0');
  const withDots = String(units).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return \`\${minus}\${symbol} \${withDots}.\${rest}\`;
}
`;

test('a copy with other names and literals hashes the same; a different body does not', () => {
  const [a] = hashedFunctions(FORMAT);
  const [b] = hashedFunctions(RENAMED);
  assert.ok(a && b, `the fixture is at least ${MIN_TOKENS} tokens`);
  assert.equal(a.hash, b.hash);
  const [c] = hashedFunctions(RENAMED.replace('Math.floor(n / 100)', 'Math.round(n / 100)'));
  assert.equal(c.hash, b.hash, 'a renamed call is still type 2');
  const [d] = hashedFunctions(RENAMED.replace('const rest = String(n % 100)', 'const rest = String((n % 100) + 1)'));
  assert.notEqual(d.hash, b.hash);
});

/** @type {string[]} */
const cleanup = [];
after(() => { for (const p of cleanup) rmSync(p, { recursive: true, force: true }); });

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-clones-'));
  cleanup.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"name":"shop","private":true,"type":"module"}');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'money.mjs'), FORMAT);
  const git = (/** @type {string[]} */ args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: dir });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
  return dir;
}

let counter = 0;
function session() {
  const id = `smuganclonetest${process.pid}n${++counter}`;
  cleanup.push(...['smugan-turn-', 'smugan-session-', 'smugan-events-', 'smugan-report-', 'smugan-stopdebt-'].map((p) => join(tmpdir(), p + id + '.json')));
  return id;
}

/** @param {string} id @param {string} file @param {string} content */
async function write(id, file, content) {
  const pre = await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content } });
  assert.equal(pre.exitCode, 0, pre.stderr);
  writeFileSync(file, content);
  await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: file } });
}

test('a new function that renames an existing one is held once with where to reuse it', async () => {
  const dir = project();
  const id = session();
  await write(id, join(dir, 'src', 'report.mjs'), RENAMED + 'export const header = () => moneyLabel(0, "R$");\n');
  const held = await runHook('stop', { session_id: id });
  assert.equal(held.exitCode, 2);
  assert.match(held.stderr, /src\/report\.mjs:1 {2}\[clone\] {2}`moneyLabel` repeats `formatCents` up to names and literals — reuse `formatCents` at src\/money\.mjs:1/);
  const next = await runHook('stop', { session_id: id });
  assert.equal(next.exitCode, 0, 'listed once');
});

test('a function that only shares its shape in a few tokens, or that differs, is not held', async () => {
  const dir = project();
  const id = session();
  await write(id, join(dir, 'src', 'small.mjs'), 'export function sign(cents) {\n  return cents < 0 ? "-" : "";\n}\n'
    + RENAMED.replace('moneyLabel', 'other').replace('const rest = String(n % 100)', 'const rest = String((n % 100) + 1)'));
  const result = await runHook('stop', { session_id: id });
  assert.doesNotMatch(result.stderr, /\[clone\]/);
});

test('the index stops at its time budget and finishes from the cache on a later run', () => {
  const dir = project();
  for (let i = 0; i < 30; i++) writeFileSync(join(dir, 'src', `copy${i}.mjs`), FORMAT.replace('formatCents', `f${i}`));
  const cold = repositoryIndex(dir, MIN_TOKENS, 0);
  assert.equal(cold.complete, false, 'a zero budget indexes at most one file');
  const warm = repositoryIndex(dir, MIN_TOKENS, 60_000);
  assert.equal(warm.complete, true);
  assert.equal(warm.entries.length, 31);
});

// The listing of a large or cold checkout can outlast the whole budget, and
// then no run had time to read a file: the index stayed empty for good.
test('a run with no time left still reads one file, so the index always finishes', () => {
  const dir = project();
  for (let i = 0; i < 4; i++) writeFileSync(join(dir, 'src', `copy${i}.mjs`), FORMAT.replace('formatCents', `f${i}`));
  let index = repositoryIndex(dir, MIN_TOKENS, 0);
  assert.equal(index.entries.length, 1);
  assert.equal(index.complete, false);
  for (let run = 2; run <= 5; run++) index = repositoryIndex(dir, MIN_TOKENS, 0);
  assert.equal(index.complete, true, 'five files, five runs');
  assert.equal(index.entries.length, 5);
});

test('an index built by an older reader of functions is read again, not trusted', () => {
  const dir = project();
  assert.equal(repositoryIndex(dir).entries.length, 1);
  const file = join(tmpdir(), `smugan-clones-${createHash('sha256').update(dir.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 24)}.json`);
  cleanup.push(file);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  // What a version 1 index kept for a file whose functions that reader could not see.
  for (const rel of Object.keys(stored.files)) stored.files[rel].fns = [];
  writeFileSync(file, JSON.stringify({ version: 1, files: stored.files }));
  assert.equal(repositoryIndex(dir).entries.length, 1, 'the file was read again');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, stored.version);
});

test('a checkout whose file list passes 256 KB is still indexed', () => {
  const dir = project();
  const deep = join(dir, 'src', 'a-folder-name-long-enough-to-make-the-listing-large');
  mkdirSync(deep);
  for (let i = 0; i < 4200; i++) writeFileSync(join(deep, `generated-module-with-a-long-name-${String(i).padStart(5, '0')}.mjs`), '');
  writeFileSync(join(dir, 'src', 'copy.mjs'), FORMAT.replace('formatCents', 'copy'));
  const index = repositoryIndex(dir, MIN_TOKENS, 60_000);
  assert.ok(index.entries.some((e) => e.rel === 'src/copy.mjs'), `entries: ${index.entries.length}`);
});
