// @ts-check
// Which tsconfig the post hook type-checks an edited file against.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { tsconfigCovers, typecheckConfig } from '../src/hook.mjs';

/** @type {string[]} */
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** @param {Record<string, unknown>} files path → JSON value or raw text */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'smugan-tsconfig-'));
  roots.push(root);
  mkdirSync(join(root, '.git'));
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}

/** Nest's layout: the package configs leave tests out, the root spec config adds the runner globals. */
const NEST = {
  'tsconfig.json': { compilerOptions: { types: ['node'] }, include: ['packages/**/*', 'integration/**/*'], exclude: ['node_modules', '**/*.spec.ts'] },
  'tsconfig.spec.json': '{\n  // test globals live here only\n  "extends": "./tsconfig.json",\n  "compilerOptions": { "types": ["vitest/globals"], },\n  "include": ["integration/**/*", "packages/**/*.spec.ts"],\n  "exclude": ["node_modules", "dist"],\n}\n',
  'packages/tsconfig.json': { files: [] },
  'packages/tsconfig.build.json': { compilerOptions: { types: ['node'] } },
  'packages/core/tsconfig.json': { extends: '../tsconfig.build.json', files: [], include: [] },
  'packages/core/tsconfig.build.json': { extends: '../tsconfig.build.json', exclude: ['node_modules', 'dist', 'test/**/*', '*.spec.ts'] },
};

test('a Nest test is checked against the root tsconfig.spec.json, comments and trailing commas included', async () => {
  const root = tree(NEST);
  const rel = 'packages/core/test/router.spec.ts';
  assert.deepEqual(await typecheckConfig(join(root, rel), rel), { dir: root, name: 'tsconfig.spec.json' });
});

test('production code keeps the nearest tsconfig.json', async () => {
  const root = tree(NEST);
  const rel = 'packages/core/router/node-router.ts';
  assert.deepEqual(await typecheckConfig(join(root, rel), rel), { dir: join(root, 'packages', 'core'), name: 'tsconfig.json' });
});

test('a nearer tsconfig.json that includes the test beats a test config further up', async () => {
  const root = tree({
    'tsconfig.spec.json': { include: ['**/*.spec.ts'] },
    'pkg/tsconfig.json': { compilerOptions: { lib: ['es2022', 'dom'] }, include: ['src'] },
    'integration/cors/tsconfig.json': { include: ['src/**/*', 'e2e/**/*'] },
  });
  for (const [rel, dir] of [['pkg/src/title.spec.ts', 'pkg'], ['integration/cors/e2e/cors.spec.ts', 'integration/cors']]) {
    assert.deepEqual(await typecheckConfig(join(root, rel), rel), { dir: join(root, ...dir.split('/')), name: 'tsconfig.json' }, rel);
  }
});

test('a base tsconfig.json further up never takes a test the package config leaves out', async () => {
  const root = tree({
    'tsconfig.json': { compilerOptions: { strict: true } },
    'pkg/tsconfig.json': { extends: '../tsconfig.json', compilerOptions: { paths: { '@/*': ['src/*'] } }, include: ['src'] },
  });
  const rel = 'pkg/test/util.test.ts';
  assert.deepEqual(await typecheckConfig(join(root, rel), rel), { dir: join(root, 'pkg'), name: 'tsconfig.json' });
});

test('a test no test config includes falls back to the nearest tsconfig.json', async () => {
  const root = tree({ ...NEST, 'tsconfig.spec.json': { include: ['integration/**/*.spec.ts'] } });
  const rel = 'packages/core/test/router.spec.ts';
  assert.deepEqual(await typecheckConfig(join(root, rel), rel), { dir: join(root, 'packages', 'core'), name: 'tsconfig.json' });
});

test('the nearest test config wins, and the search stops at the repository root', async () => {
  const root = tree({
    'tsconfig.json': {},
    'app/tsconfig.json': {},
    'app/tsconfig.vitest.json': { include: ['src/**/__tests__/*'] },
  });
  const rel = 'app/src/__tests__/a.test.ts';
  assert.deepEqual(await typecheckConfig(join(root, rel), rel), { dir: join(root, 'app'), name: 'tsconfig.vitest.json' });
  const outer = tree({ 'tsconfig.spec.json': {} });
  const inner = join(outer, 'repo');
  mkdirSync(join(inner, '.git'), { recursive: true });
  writeFileSync(join(inner, 'tsconfig.json'), '{}');
  assert.deepEqual(await typecheckConfig(join(inner, 'a.spec.ts'), 'a.spec.ts'), { dir: inner, name: 'tsconfig.json' }, 'a config above the repository is not this project');
});

test('tsconfigCovers follows tsc: files, inherited include and exclude, folder patterns, defaults', async () => {
  const root = tree({
    'base.json': { include: ['src'], exclude: ['src/legacy'] },
    'child.json': { extends: './base' },
    'listed.json': { files: ['src/legacy/kept.ts'], include: [] },
    'empty.json': {},
    'broken.json': '{ "include": [',
  });
  const at = (/** @type {string} */ p) => join(root, ...p.split('/'));
  assert.equal(await tsconfigCovers(at('child.json'), at('src/a/b.spec.ts')), true, 'include inherited, relative to the base');
  assert.equal(await tsconfigCovers(at('child.json'), at('src/legacy/old.spec.ts')), false, 'exclude inherited');
  assert.equal(await tsconfigCovers(at('child.json'), at('test/a.spec.ts')), false);
  assert.equal(await tsconfigCovers(at('listed.json'), at('src/legacy/kept.ts')), true, 'files is exact');
  assert.equal(await tsconfigCovers(at('listed.json'), at('src/other.ts')), false);
  assert.equal(await tsconfigCovers(at('empty.json'), at('deep/a/b.ts')), true, 'no files and no include means everything');
  assert.equal(await tsconfigCovers(at('broken.json'), at('src/a.ts')), false);
  assert.equal(await tsconfigCovers(at('missing.json'), at('src/a.ts')), false);
});
