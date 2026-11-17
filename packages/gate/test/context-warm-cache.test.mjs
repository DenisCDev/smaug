// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a warm CLI process reuses evidence without calling the version resolver', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'smugan warm cache '));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const repo = join(parent, 'application');
  const copiedGate = join(parent, 'disposable gate');
  const originalGate = fileURLToPath(new URL('..', import.meta.url));
  mkdirSync(repo);
  mkdirSync(copiedGate);
  const initialized = spawnSync('git', ['-C', repo, 'init', '--quiet'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(initialized.status, 0, initialized.error?.message ?? initialized.stderr);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '^16.2.0' } }));
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { next: '^16.2.0' } }, 'node_modules/next': { version: '16.2.1' },
  } }));
  for (const entry of ['bin', 'src', 'package.json']) cpSync(join(originalGate, entry), join(copiedGate, entry), { recursive: true });
  // Reuse installed parser dependencies without installing anything or changing
  // production modules. Only the disposable copy is instrumented below.
  symlinkSync(join(originalGate, 'node_modules'), join(copiedGate, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const cli = join(copiedGate, 'bin/smugan.mjs');
  /** @param {string[]} [args] */
  const run = (args = []) => spawnSync(process.execPath, [cli, 'context', '--json', ...args], {
    cwd: repo, encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, SMUGAN_CACHE_DIR: join(parent, 'private cache') },
  });
  const cold = run();
  assert.equal(cold.status, 0, cold.stderr);
  const initial = JSON.parse(cold.stdout);
  assert.equal(initial.cache.status, 'built');
  const cacheFile = initial.cache.path;
  const contents = readFileSync(cacheFile, 'utf8');
  const modified = statSync(cacheFile).mtimeMs;

  const resolver = join(copiedGate, 'src/context-resolve.mjs');
  const source = readFileSync(resolver, 'utf8');
  const entry = 'export function resolveContext(snapshot, environment) {';
  assert.ok(source.includes(entry), 'instrumentation must intercept the real resolver entry point');
  const sentinel = 'WARM_CACHE_RESOLVER_WAS_CALLED';
  writeFileSync(resolver, source.replace(entry, entry + `\n  throw new Error('${sentinel}');`));

  const warm = run();
  assert.equal(warm.status, 0, warm.stderr);
  const reused = JSON.parse(warm.stdout);
  assert.equal(reused.cache.status, 'reused');
  assert.equal(reused.packages[0].components.find((/** @type {{name: string}} */ component) => component.name === 'next').resolved, '16.2.1');
  assert.equal(readFileSync(cacheFile, 'utf8'), contents);
  assert.equal(statSync(cacheFile).mtimeMs, modified);

  // A refresh must cross the poisoned entry point. This control proves the
  // successful warm run was not accidentally invoking an unmodified package.
  const refresh = run(['--refresh']);
  assert.equal(refresh.status, 2);
  assert.ok(refresh.stderr.includes(sentinel), refresh.stderr);
  assert.equal(readFileSync(cacheFile, 'utf8'), contents, 'failed refresh cannot overwrite valid cached evidence');
});
