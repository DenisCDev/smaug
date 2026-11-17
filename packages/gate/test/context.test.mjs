// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/smugan.mjs', import.meta.url));

test('prerelease and Cargo range declarations survive cache validation', (t) => {
  const f = fixture(t);
  json(join(f.repo, 'package.json'), { dependencies: { next: '16.0.0-canary.1' } });
  writeFileSync(join(f.repo, 'Cargo.toml'), '[package]\nname = "api"\nversion = "1.0.0"\n[dependencies]\naxum = ">=0.7, <0.9"\n');
  context(f);
  const reused = context(f);
  assert.equal(reused.cache.status, 'reused');
  assert.equal(component(reused, '.', 'next').declared, '16.0.0-canary.1');
  assert.equal(component(reused, '.', 'axum').declared, '>=0.7, <0.9');
});

test('invalid cached version or extra data is rebuilt instead of returned to a new chat', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const first = context(f);
  const file = cachePath(f, first);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  const entry = Object.values(stored.entries)[0];
  /** @type {any} -- deliberately malformed cache is the regression input. */
  const malformed = entry;
  malformed.data.packages[0].components[0].resolved = 'not-a-version';
  malformed.data.privateToken = 'accidental-private-field';
  writeFileSync(file, JSON.stringify(stored));
  const repaired = context(f);
  assert.notEqual(repaired.cache.status, 'reused');
  assert.equal(component(repaired, '.', 'next').resolved, '16.2.1');
  assert.ok(!JSON.stringify(repaired).includes('accidental-private-field'));
});

test('collision at the cache file falls back without deleting the foreign directory', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const file = cachePath(f, context(f));
  rmSync(file);
  mkdirSync(file);
  writeFileSync(join(file, 'keep.txt'), 'preserve');
  const fallback = context(f);
  assert.ok(cachePath(f, fallback).startsWith(f.privateCache));
  assert.equal(readFileSync(join(file, 'keep.txt'), 'utf8'), 'preserve');
});

test('Git metadata junction cannot redirect exclusion writes', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const foreign = join(f.parent, 'foreign metadata');
  mkdirSync(foreign);
  writeFileSync(join(foreign, 'exclude'), 'foreign-owned.txt\n');
  const info = join(f.repo, '.git/info');
  rmSync(info, { recursive: true });
  symlinkSync(foreign, info, process.platform === 'win32' ? 'junction' : 'dir');
  const fallback = context(f);
  assert.ok(cachePath(f, fallback).startsWith(f.privateCache));
  assert.equal(readFileSync(join(foreign, 'exclude'), 'utf8'), 'foreign-owned.txt\n');
});

test('a non-Git workspace target still resolves its shared owner lock', (t) => {
  const f = fixture(t);
  rmSync(join(f.repo, '.git'), { recursive: true });
  json(join(f.repo, 'package.json'), { private: true, workspaces: ['apps/*'] });
  json(join(f.repo, 'apps/web/package.json'), { dependencies: { next: '^16.2.0' } });
  json(join(f.repo, 'package-lock.json'), { lockfileVersion: 3, packages: {
    'apps/web': { dependencies: { next: '^16.2.0' } }, 'node_modules/next': { version: '16.2.1' },
  } });
  const result = context(f, ['apps/web']);
  assert.equal(component(result, 'apps/web', 'next').resolved, '16.2.1');
  assert.ok(cachePath(f, result).startsWith(f.privateCache));
});
/** @typedef {import('../src/context-resolve.mjs').PackageContext} PackageContext */
/** @typedef {{schemaVersion: number, packages: PackageContext[], guides: string[], limitations: string[], runtime: {node: string, scope: string}, environment: string, cache: {status: string, path?: string}}} Context */
/** @typedef {{repo: string, privateCache: string, parent: string}} Fixture */

/** @param {string} file @param {unknown} data */
function json(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  // A loaded Windows runner took over 5 s for a git init; the bound stays, with room.
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

/** @param {import('node:test').TestContext} t @returns {Fixture} */
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'smugan context '));
  const repo = join(parent, 'project with spaces');
  const privateCache = join(parent, 'private cache');
  mkdirSync(repo);
  git(repo, ['init', '--quiet']);
  json(join(repo, 'package.json'), { name: 'fixture', private: true });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { repo, privateCache, parent };
}

/** @param {Fixture} f @param {string[]} [args] @returns {Context} */
function context(f, args = []) {
  const result = spawnSync(process.execPath, [CLI, 'context', '--json', ...args], {
    cwd: f.repo, encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, SMUGAN_CACHE_DIR: f.privateCache },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  return JSON.parse(result.stdout);
}

/** @param {Context} result @param {string} path @param {string} name */
function component(result, path, name) {
  const found = result.packages.filter((pkg) => pkg.path === path).flatMap((pkg) => pkg.components).find((entry) => entry.name === name);
  assert.ok(found, `${path} must identify ${name}`);
  return found;
}

/** @param {Fixture} f @param {string} [version] */
function nextFixture(f, version = '16.2.1') {
  json(join(f.repo, 'package.json'), { name: 'web', dependencies: { next: '^16.2.0' } });
  json(join(f.repo, 'package-lock.json'), { lockfileVersion: 3, packages: { '': { dependencies: { next: '^16.2.0' } }, 'node_modules/next': { version } } });
}

/** @param {Fixture} f @param {Context} result */
function cachePath(f, result) {
  assert.ok(result.cache.path, 'a persisted context reports its cache location');
  return resolve(f.repo, result.cache.path);
}

test('npm workspace edges keep declared, resolved and installed versions separate', (t) => {
  const f = fixture(t);
  json(join(f.repo, 'package.json'), { private: true, workspaces: ['apps/*'] });
  json(join(f.repo, 'apps/web/package.json'), { name: 'web', dependencies: { next: '^15.5.0' } });
  json(join(f.repo, 'apps/site/package.json'), { name: 'site', dependencies: { astro: '^7.2.0' } });
  json(join(f.repo, 'package-lock.json'), { lockfileVersion: 3, packages: {
    'apps/web': { dependencies: { next: '^15.5.0' } },
    'apps/site': { dependencies: { astro: '^7.2.0' } },
    'apps/web/node_modules/next': { version: '15.5.21' },
    'node_modules/next': { version: '16.3.0' },
    'node_modules/astro': { version: '7.2.2' },
  } });
  json(join(f.repo, 'apps/web/node_modules/next/package.json'), { name: 'next', version: '15.5.20' });
  const result = context(f, ['apps/web', '--no-cache']);
  const next = component(result, 'apps/web', 'next');
  assert.equal(next.declared, '^15.5.0');
  assert.equal(next.resolved, '15.5.21');
  assert.equal(next.installed, '15.5.20');
  assert.ok(next.evidence.some((entry) => entry.kind === 'resolved' && entry.path === 'package-lock.json'));
  assert.ok(result.limitations.some((entry) => /diverg/i.test(entry)));
  assert.equal(component(result, 'apps/site', 'astro').resolved, '7.2.2');
  assert.ok(!result.packages.find((pkg) => pkg.path === 'apps/site')?.guides.includes('nextjs'));
});

test('an npm alias cannot impersonate another framework under its dependency key', (t) => {
  const f = fixture(t);
  json(join(f.repo, 'package.json'), { dependencies: { next: 'npm:astro@7.2.2' } });
  json(join(f.repo, 'package-lock.json'), { lockfileVersion: 3, packages: { 'node_modules/next': { name: 'astro', version: '7.2.2' } } });
  json(join(f.repo, 'node_modules/next/package.json'), { name: 'astro', version: '7.2.2' });
  const next = component(context(f, ['--no-cache']), '.', 'next');
  assert.equal(next.resolved, undefined);
  assert.equal(next.installed, undefined);
});

test('pnpm resolves the package importer instead of the first matching version', (t) => {
  const f = fixture(t);
  json(join(f.repo, 'apps/api/package.json'), { name: 'api', dependencies: { hono: '^4.4.0' } });
  writeFileSync(join(f.repo, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      hono:\n        specifier: ^3.0.0\n        version: 3.12.0\n  apps/api:\n    dependencies:\n      hono:\n        specifier: ^4.4.0\n        version: 4.12.27(zod@4.0.0)\n`);
  const result = context(f, ['apps/api', '--no-cache']);
  assert.equal(component(result, 'apps/api', 'hono').resolved, '4.12.27');
  assert.ok(result.packages.find((pkg) => pkg.path === 'apps/api')?.guides.includes('node-api'));
});

test('Bun JSONC comments and trailing commas do not erase a valid resolution', (t) => {
  const f = fixture(t);
  json(join(f.repo, 'package.json'), { dependencies: { astro: '^7.2.0' } });
  writeFileSync(join(f.repo, 'bun.lock'), '{\n// Bun text lock\n"lockfileVersion": 1,\n"workspaces": {"": {"dependencies": {"astro": "^7.2.0"}}},\n"packages": {"astro": ["astro@7.2.2", "", {}, "sha512-example"],},\n}\n');
  assert.equal(component(context(f, ['--no-cache']), '.', 'astro').resolved, '7.2.2');
});

test('ambiguous Bun versions and competing package managers remain unknown', (t) => {
  const f = fixture(t);
  nextFixture(f);
  writeFileSync(join(f.repo, 'bun.lock'), JSON.stringify({ packages: { next: ['next@16.2.1'], 'other/next': ['next@15.5.21'] } }));
  const competing = context(f, ['--no-cache']);
  assert.equal(component(competing, '.', 'next').resolved, undefined);
  assert.ok(competing.limitations.length > 0);
  rmSync(join(f.repo, 'package-lock.json'));
  const ambiguous = context(f, ['--no-cache']);
  assert.equal(component(ambiguous, '.', 'next').resolved, undefined);
  assert.ok(ambiguous.limitations.length > 0);
});

test('Cargo resolves the owning package edge when multiple crate versions coexist', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'Cargo.toml'), '[package]\nname = "api"\nversion = "1.0.0"\n[dependencies]\naxum = "0.8"\n');
  writeFileSync(join(f.repo, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "api"\nversion = "1.0.0"\ndependencies = ["axum 0.8.9"]\n[[package]]\nname = "axum"\nversion = "0.7.9"\n[[package]]\nname = "axum"\nversion = "0.8.9"\n');
  assert.equal(component(context(f, ['--no-cache']), '.', 'axum').resolved, '0.8.9');
});

test('a stale lock cannot turn an incompatible resolved version into current evidence', (t) => {
  const f = fixture(t);
  nextFixture(f);
  json(join(f.repo, 'package-lock.json'), { lockfileVersion: 3, packages: {
    '': { dependencies: { next: '^15.5.0' } },
    'node_modules/next': { version: '15.5.21' },
  } });
  const result = context(f, ['--no-cache']);
  assert.equal(component(result, '.', 'next').declared, '^16.2.0');
  assert.equal(component(result, '.', 'next').resolved, undefined);
  assert.ok(result.limitations.length > 0);
});

test('an invalid nearer lock cannot fall through to an unrelated ancestor resolution', (t) => {
  const f = fixture(t);
  nextFixture(f);
  json(join(f.repo, 'apps/web/package.json'), { dependencies: { next: '^16.2.0' } });
  writeFileSync(join(f.repo, 'apps/web/package-lock.json'), '{"lockfileVersion": 3, broken');
  const result = context(f, ['apps/web', '--no-cache']);
  assert.equal(component(result, 'apps/web', 'next').resolved, undefined);
  assert.ok(result.limitations.length > 0);
});

test('discovery never runs config or scripts and never persists secret values', (t) => {
  const f = fixture(t);
  json(join(f.repo, 'package.json'), { dependencies: { next: '^16.0.0', redis: 'https://name:private-secret-value@example.invalid/redis.tgz' }, scripts: { postinstall: 'node malicious.cjs' } });
  writeFileSync(join(f.repo, '.env'), 'TOKEN=private-secret-value\n');
  writeFileSync(join(f.repo, 'next.config.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('CONFIG_EXECUTED', 'bad'); export default {};\n");
  writeFileSync(join(f.repo, 'malicious.cjs'), "require('node:fs').writeFileSync('SCRIPT_EXECUTED', 'bad');\n");
  const result = context(f);
  assert.ok(!existsSync(join(f.repo, 'CONFIG_EXECUTED')));
  assert.ok(!existsSync(join(f.repo, 'SCRIPT_EXECUTED')));
  assert.ok(!JSON.stringify(result).includes('private-secret-value'));
  assert.ok(!readFileSync(cachePath(f, result), 'utf8').includes('private-secret-value'));
});

test('Docker and local database declarations never become deployed runtime facts', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'Dockerfile'), 'FROM node:22-alpine\n');
  writeFileSync(join(f.repo, 'compose.yaml'), 'services:\n  db:\n    image: postgres:18.4\n  cache:\n    image: redis:7.2\n');
  mkdirSync(join(f.repo, 'supabase'));
  writeFileSync(join(f.repo, 'supabase/config.toml'), '[db]\nmajor_version = 16\n');
  const result = context(f, ['--environment', 'vps-production', '--no-cache']);
  assert.equal(result.environment, 'vps-production');
  assert.equal(result.runtime.node, process.versions.node);
  assert.match(result.runtime.scope, /process/);
  const postgres = result.packages.flatMap((pkg) => pkg.components).filter((entry) => entry.name === 'postgres');
  assert.deepEqual(postgres.map((entry) => entry.declared).sort(), ['16', '18.4']);
  for (const entry of postgres) {
    assert.equal(entry.resolved, undefined);
    assert.equal(entry.installed, undefined);
  }
});

test('a second process reuses persistent context without rewriting its file', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const first = context(f);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.cache.status, 'built');
  const file = cachePath(f, first);
  const before = readFileSync(file, 'utf8');
  const stamp = statSync(file).mtimeMs;
  const second = context(f);
  assert.equal(second.cache.status, 'reused');
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(statSync(file).mtimeMs, stamp);
  assert.equal(git(f.repo, ['check-ignore', '.smugan.local/context.json']), '.smugan.local/context.json');
  assert.ok(!existsSync(join(f.repo, '.gitignore')), 'local state must not edit shared ignore rules');
});

test('same-size lock changes with restored mtime invalidate cached versions', (t) => {
  const f = fixture(t);
  nextFixture(f);
  context(f);
  const lock = join(f.repo, 'package-lock.json');
  const before = statSync(lock);
  writeFileSync(lock, readFileSync(lock, 'utf8').replace('16.2.1', '16.2.2'));
  utimesSync(lock, before.atime, before.mtime);
  assert.equal(statSync(lock).size, before.size);
  const result = context(f);
  assert.notEqual(result.cache.status, 'reused');
  assert.equal(component(result, '.', 'next').resolved, '16.2.2');
});

test('new and removed applications change the inventory across chats', (t) => {
  const f = fixture(t);
  nextFixture(f);
  context(f);
  json(join(f.repo, 'apps/site/package.json'), { dependencies: { astro: '^7.3.0' } });
  const added = context(f);
  assert.notEqual(added.cache.status, 'reused');
  assert.equal(component(added, 'apps/site', 'astro').declared, '^7.3.0');
  rmSync(join(f.repo, 'apps/site/package.json'));
  const removed = context(f);
  assert.ok(!removed.packages.some((pkg) => pkg.path === 'apps/site'));
});

test('installed metadata changes independently of an unchanged lock', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const installed = join(f.repo, 'node_modules/next/package.json');
  json(installed, { name: 'next', version: '16.2.1' });
  context(f);
  json(installed, { name: 'next', version: '16.2.0' });
  const changed = context(f);
  assert.equal(component(changed, '.', 'next').installed, '16.2.0');
  assert.equal(component(changed, '.', 'next').resolved, '16.2.1');
  assert.ok(changed.limitations.some((entry) => /diverg/i.test(entry)));
});

test('--no-cache neither creates cache nor edits local Git exclusion', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const exclude = resolve(f.repo, git(f.repo, ['rev-parse', '--git-path', 'info/exclude']));
  const before = readFileSync(exclude, 'utf8');
  const uncached = context(f, ['--no-cache']);
  assert.equal(uncached.cache.status, 'disabled');
  assert.ok(!existsSync(join(f.repo, '.smugan.local')));
  assert.ok(!existsSync(f.privateCache));
  assert.equal(readFileSync(exclude, 'utf8'), before);
  const persisted = context(f);
  const file = cachePath(f, persisted);
  writeFileSync(file, '{broken cached data');
  const bypassed = context(f, ['--no-cache']);
  assert.equal(readFileSync(file, 'utf8'), '{broken cached data');
  assert.deepEqual(bypassed.limitations, uncached.limitations, 'disabled cache must not trigger corrupt-cache diagnostics');
});

test('--refresh resolves again even when evidence is unchanged', (t) => {
  const f = fixture(t);
  nextFixture(f);
  context(f);
  assert.equal(context(f).cache.status, 'reused');
  const refreshed = context(f, ['--refresh']);
  assert.equal(refreshed.cache.status, 'refreshed');
  assert.equal(component(refreshed, '.', 'next').resolved, '16.2.1');
});

test('malformed owned cache regenerates with a diagnostic instead of trusting partial data', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const first = context(f);
  writeFileSync(cachePath(f, first), '{"packages": [');
  const repaired = context(f);
  assert.notEqual(repaired.cache.status, 'reused');
  assert.equal(component(repaired, '.', 'next').resolved, '16.2.1');
  assert.ok(repaired.limitations.length > first.limitations.length, 'cache corruption is reported');
  assert.doesNotThrow(() => JSON.parse(readFileSync(cachePath(f, repaired), 'utf8')));
});

test('tracked cache collision preserves developer files and uses private fallback', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const collision = join(f.repo, '.smugan.local/context.json');
  json(collision, { ownedBy: 'developer', preserve: true });
  git(f.repo, ['add', '-f', '--', '.smugan.local/context.json']);
  const before = readFileSync(collision, 'utf8');
  const result = context(f);
  assert.equal(readFileSync(collision, 'utf8'), before);
  assert.ok(cachePath(f, result).startsWith(f.privateCache));
  assert.equal(component(result, '.', 'next').resolved, '16.2.1');
});

test('a symlink or Windows junction cannot redirect managed cache writes', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const outside = join(f.parent, 'unrelated files');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'untouched');
  symlinkSync(outside, join(f.repo, '.smugan.local'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = context(f);
  assert.ok(cachePath(f, result).startsWith(f.privateCache));
  assert.ok(!existsSync(join(outside, 'context.json')));
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'untouched');
});

test('concurrent CLI writers preserve contexts for different targets and environments', async (t) => {
  const f = fixture(t);
  nextFixture(f);
  json(join(f.repo, 'apps/api/package.json'), { dependencies: { hono: '^4.0.0' } });
  json(join(f.repo, 'apps/site/package.json'), { dependencies: { astro: '^7.0.0' } });
  const requests = [['apps/api', '--environment', 'development'], ['apps/site', '--environment', 'preview']];
  const results = await Promise.all(requests.map((args) => new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [CLI, 'context', '--json', ...args], {
      cwd: f.repo, timeout: 15_000, windowsHide: true,
      env: { ...process.env, SMUGAN_CACHE_DIR: f.privateCache }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(errors || output || 'context child failed'));
      try { resolveResult(JSON.parse(output)); } catch (error) { reject(error); }
    });
  })));
  assert.equal(results.length, 2);
  for (const args of requests) assert.equal(context(f, args).cache.status, 'reused', args.join(' '));
});

test('an untracked foreign cache directory is preserved without modifying Git excludes', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const collision = join(f.repo, '.smugan.local/context.json');
  json(collision, { owner: 'application', value: 'keep this' });
  const exclude = resolve(f.repo, git(f.repo, ['rev-parse', '--git-path', 'info/exclude']));
  const exclusionBefore = readFileSync(exclude, 'utf8');
  const before = readFileSync(collision, 'utf8');
  const result = context(f);
  assert.equal(readFileSync(collision, 'utf8'), before);
  assert.equal(readFileSync(exclude, 'utf8'), exclusionBefore);
  assert.ok(cachePath(f, result).startsWith(f.privateCache));
});

test('a project without Git reuses a private cache without creating local artifacts', (t) => {
  const f = fixture(t);
  nextFixture(f);
  rmSync(join(f.repo, '.git'), { recursive: true, force: true });
  const first = context(f);
  assert.ok(cachePath(f, first).startsWith(f.privateCache));
  assert.ok(!existsSync(join(f.repo, '.smugan.local')));
  assert.equal(context(f).cache.status, 'reused');
});

test('a stuck cache writer has a deadline and cannot fabricate successful persistence', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const first = context(f);
  const file = cachePath(f, first);
  const before = readFileSync(file, 'utf8');
  mkdirSync(file + '.lock');
  const started = Date.now();
  const result = context(f, ['--refresh']);
  assert.ok(Date.now() - started < 10_000);
  assert.equal(result.cache.status, 'unavailable');
  assert.equal(component(result, '.', 'next').resolved, '16.2.1');
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.ok(result.limitations.length > first.limitations.length);
});

test('the gate skips owned cache artifacts but still inspects adjacent application files', (t) => {
  const f = fixture(t);
  nextFixture(f);
  const check = () => {
    const result = spawnSync(process.execPath, [CLI, 'check', '--json'], { cwd: f.repo, encoding: 'utf8', timeout: 15_000, windowsHide: true });
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return /** @type {{filesChecked: number, violations: {file: string, rule: string}[]}} */ (JSON.parse(result.stdout));
  };
  const initial = check();
  context(f);
  assert.equal(check().filesChecked, initial.filesChecked, 'generated cache must not become project code');
  const file = join(f.repo, '.smugan.local/feature.ts');
  writeFileSync(file, 'export function feature() { try { return 1; } catch {} }');
  const withApplication = check();
  assert.ok(withApplication.violations.some((entry) => entry.file.endsWith('feature.ts') && entry.rule === 'empty-catch'));
  rmSync(join(f.repo, '.smugan.local/.owner'));
  assert.ok(check().filesChecked > withApplication.filesChecked, 'a foreign context.json must not inherit the cache exemption');
});
