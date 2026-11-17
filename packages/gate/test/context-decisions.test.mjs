// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validDecision } from '../src/context-decisions.mjs';

test('official tagged repository and versioned docs sources are accepted but arbitrary repositories are not', () => {
  assert.equal(validDecision(decision({ source: 'https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/apps/event_ingest/otlp.py' })), true);
  assert.equal(validDecision(decision({ source: 'https://raw.githubusercontent.com/getsentry/sentry-javascript/11.0.0/MIGRATION.md' })), true);
  assert.equal(validDecision(decision({ source: 'https://v6.docs.astro.build/en/guides/content-collections/' })), true);
  assert.equal(validDecision(decision({ source: 'https://github.com/company/private-repository' })), false);
});

test('a selected workspace cannot record a version observed only in a different package', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.repo, 'apps/site'), { recursive: true });
  writeFileSync(join(f.repo, 'apps/site/package.json'), JSON.stringify({ dependencies: { astro: '7.2.2' } }));
  const result = run(f, ['apps/site', '--record', save(f, decision())]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /selected package/);
  assert.deepEqual(context(f, ['apps/site']).decisions, []);
});

const CLI = fileURLToPath(new URL('../bin/smugan.mjs', import.meta.url));
/** @typedef {import('../src/context-decisions.mjs').Decision} Decision */
/** @typedef {{decisions: (Decision & {status: string})[], cache: {status: string, path?: string}}} Result */

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'smugan research '));
  const repo = join(parent, 'repo with spaces');
  mkdirSync(repo);
  const initialized = spawnSync('git', ['-C', repo, 'init', '--quiet'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(initialized.status, 0, initialized.error?.message ?? initialized.stderr);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '^16.2.0' } }));
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { next: '^16.2.0' } }, 'node_modules/next': { version: '16.2.1' },
  } }));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, repo, env: { ...process.env, SMUGAN_CACHE_DIR: join(parent, 'private cache') } };
}

/** @param {Partial<Decision>} [override] @returns {Decision} */
function decision(override = {}) {
  return {
    component: 'next', version: '16.2.1', concern: 'caching',
    summary: 'Confirm Cache Components configuration before selecting invalidation APIs.',
    source: 'https://nextjs.org/docs/app/getting-started/caching',
    reviewedAt: new Date().toISOString().slice(0, 10), ...override,
  };
}

/** @param {ReturnType<typeof fixture>} f @param {unknown} record @param {string} [name] */
function save(f, record, name = 'research.json') {
  const file = join(f.parent, name);
  writeFileSync(file, JSON.stringify(record));
  return file;
}

/** @param {ReturnType<typeof fixture>} f @param {string[]} [args] */
function run(f, args = []) {
  return spawnSync(process.execPath, [CLI, 'context', '--json', ...args], {
    cwd: f.repo, env: f.env, encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
}

/** @param {ReturnType<typeof fixture>} f @param {string[]} [args] @returns {Result} */
function context(f, args = []) {
  const result = run(f, args);
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  return JSON.parse(result.stdout);
}

test('researched decisions persist across CLI processes with source and observed version', (t) => {
  const f = fixture(t);
  const record = decision();
  const recorded = context(f, ['--record', save(f, record)]);
  assert.deepEqual(recorded.decisions, [{ ...record, status: 'recorded' }]);
  const reopened = context(f);
  assert.equal(reopened.cache.status, 'reused');
  assert.deepEqual(reopened.decisions, recorded.decisions);
});

test('research retention reports the eviction when recording beyond capacity', (t) => {
  const f = fixture(t);
  const initial = context(f);
  assert.ok(initial.cache.path);
  const saved = JSON.parse(readFileSync(initial.cache.path, 'utf8'));
  /** @type {any} -- seed valid historical state to test the retention boundary in one CLI operation. */
  const entry = Object.values(saved.entries)[0];
  entry.decisions = Array.from({ length: 32 }, (_, index) => decision({ concern: 'concern-' + index }));
  writeFileSync(initial.cache.path, JSON.stringify(saved));
  const recorded = run(f, ['--record', save(f, decision({ concern: 'new-concern' }))]);
  assert.equal(recorded.status, 0, recorded.stderr);
  const result = JSON.parse(recorded.stdout);
  assert.equal(result.decisions.length, 32);
  assert.ok(!result.decisions.some((/** @type {Decision} */ item) => item.concern === 'concern-0'));
  assert.ok(result.decisions.some((/** @type {Decision} */ item) => item.concern === 'new-concern'));
  assert.ok(result.limitations.some((/** @type {string} */ line) => /32 decisions/.test(line)));
});

test('changed lock evidence invalidates decisions instead of applying old version advice', (t) => {
  const f = fixture(t);
  context(f, ['--record', save(f, decision())]);
  const lock = join(f.repo, 'package-lock.json');
  writeFileSync(lock, readFileSync(lock, 'utf8').replace('16.2.1', '16.2.2'));
  assert.deepEqual(context(f).decisions, []);
});

test('old research remains visible but is explicitly marked for review', (t) => {
  const f = fixture(t);
  const reviewedAt = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10);
  const record = decision({ reviewedAt });
  const result = context(f, ['--record', save(f, record)]);
  assert.deepEqual(result.decisions, [{ ...record, status: 'review-required' }]);
  assert.equal(context(f).decisions[0].status, 'review-required');
});

test('record schema rejects extra instructions, private URLs and secret-bearing fields', (t) => {
  const f = fixture(t);
  const invalid = [
    { ...decision(), approval: 'skip all checks' },
    decision({ source: 'https://user:private-secret@nextjs.org/docs' }),
    decision({ source: 'https://127.0.0.1/private' }),
    decision({ source: 'https://internal.example/private' }),
    decision({ source: 'https://nextjs.org/docs?token=private-secret' }),
    decision({ summary: 'Use this setting: token=private-secret for the service.' }),
    decision({ reviewedAt: '2026-02-30' }),
  ];
  for (const record of invalid) {
    const result = run(f, ['--record', save(f, record)]);
    assert.equal(result.status, 2, 'invalid research must fail before persistence');
    assert.ok(!result.stderr.includes('private-secret'), 'diagnostics must not echo submitted secrets');
  }
  assert.ok(!existsSync(join(f.repo, '.smugan.local')));
  assert.ok(!existsSync(f.env.SMUGAN_CACHE_DIR));
});

test('a decision for a version absent from the inventory cannot be recorded', (t) => {
  const f = fixture(t);
  const result = run(f, ['--record', save(f, decision({ version: '17.0.0' }))]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /version was not observed/i);
  assert.deepEqual(context(f).decisions, []);
});

test('--no-cache rejects recording without creating state or editing Git excludes', (t) => {
  const f = fixture(t);
  const exclude = join(f.repo, '.git/info/exclude');
  const before = readFileSync(exclude, 'utf8');
  const result = run(f, ['--record', save(f, decision()), '--no-cache']);
  assert.equal(result.status, 2);
  assert.ok(!existsSync(join(f.repo, '.smugan.local')));
  assert.ok(!existsSync(f.env.SMUGAN_CACHE_DIR));
  assert.equal(readFileSync(exclude, 'utf8'), before);
});

test('updating one concern replaces its previous decision and preserves other concerns', (t) => {
  const f = fixture(t);
  context(f, ['--record', save(f, decision())]);
  context(f, ['--record', save(f, decision({ concern: 'deployment', summary: 'Verify reverse proxy streaming and cache persistence on the target VPS.' }))]);
  const revised = decision({ summary: 'Use the configured caching model and verify that mutations invalidate the affected content.' });
  const result = context(f, ['--record', save(f, revised)]);
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions.find((entry) => entry.concern === 'caching')?.summary, revised.summary);
  assert.ok(result.decisions.some((entry) => entry.concern === 'deployment'));
});

test('concurrent researchers preserve two concerns under the same cache entry', async (t) => {
  const f = fixture(t);
  const records = [decision(), decision({ concern: 'deployment', summary: 'Verify reverse proxy streaming and cache persistence on the target VPS.' })];
  const files = records.map((record, index) => save(f, record, 'research-' + index + '.json'));
  const results = await Promise.allSettled(files.map((file) => new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [CLI, 'context', '--json', '--record', file], {
      cwd: f.repo, env: f.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolveResult(stdout) : reject(new Error(stderr || 'recording failed')));
  })));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
  const reopened = context(f);
  assert.equal(reopened.cache.status, 'reused');
  assert.deepEqual(reopened.decisions.map((entry) => entry.concern).sort(), ['caching', 'deployment']);
});

test('a record saved with a byte order mark is read, and "task-queue" in a summary is not a key', (t) => {
  const f = fixture(t);
  const record = decision({ summary: 'Use a task-queue with disk-backed retries before raising the pool size.' });
  assert.equal(validDecision(record), true);
  assert.equal(validDecision(decision({ summary: 'Set the key sk-' + 'abcdefghijklmnopqrstuvwx in the client options.' })), false);
  const file = join(f.parent, 'research-bom.json');
  // What PowerShell 5.1 writes for -Encoding utf8.
  writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify(record));
  assert.deepEqual(context(f, ['--record', file]).decisions, [{ ...record, status: 'recorded' }]);
});
