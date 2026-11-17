// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';

/** @param {Record<string, unknown>} files @param {(dir: string) => void} body */
function withProject(files, body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-config-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('smugan.local.json wins over the shared config key by key', () => {
  withProject({
    'smugan.config.json': {
      ignore: ['legacy/**', 'tmp/**'],
      checks: { 'no-any': true, 'console-log': true, 'db-naming': { allow: ['a'] } },
      hook: { eslint: true, timeoutMs: 10_000, stop: { tests: true, timeoutMs: 60_000 } },
    },
    'smugan.local.json': {
      ignore: ['tmp/**', 'scratch/**'],
      checks: { 'console-log': false, 'db-naming': { strict: true } },
      hook: { eslint: false, stop: { tests: false } },
    },
  }, (dir) => {
    const config = loadConfig(dir);
    assert.equal(config.root, dir);
    assert.deepEqual(config.ignore, ['legacy/**', 'tmp/**', 'scratch/**']);
    assert.deepEqual(config.checks, { 'no-any': true, 'console-log': false, 'db-naming': { allow: ['a'], strict: true } });
    assert.equal(config.hook.eslint, false);
    assert.equal(config.hook.timeoutMs, 10_000);
    assert.deepEqual(config.hook.stop, { smugan: true, typecheck: true, tests: false, shell: true, timeoutMs: 60_000 });
    assert.equal(config.localConfig, join(dir, 'smugan.local.json'));
    assert.equal(config.configError, undefined);
  });
});

test('a local stop object turns the Stop back on when the shared config disabled it', () => {
  withProject({
    'smugan.config.json': { hook: { stop: false } },
    'smugan.local.json': { hook: { stop: { tests: false } } },
  }, (dir) => {
    assert.deepEqual(loadConfig(dir).hook.stop, { smugan: true, typecheck: true, tests: false, shell: true, timeoutMs: 120_000 });
  });
});

test('a local file alone roots the config and applies', () => {
  withProject({ 'smugan.local.json': { checks: { 'no-any': false } } }, (dir) => {
    const config = loadConfig(join(dir));
    assert.equal(config.root, dir);
    assert.equal(config.checks['no-any'], false);
    assert.equal(config.localConfig, join(dir, 'smugan.local.json'));
  });
});

test('invalid JSON in either layer is reported by file name and only that layer is skipped', () => {
  withProject({ 'smugan.config.json': { checks: { 'no-any': false } }, 'smugan.local.json': '{ broken' }, (dir) => {
    const config = loadConfig(dir);
    assert.equal(config.configError, join(dir, 'smugan.local.json'));
    assert.equal(config.localConfig, undefined);
    assert.equal(config.checks['no-any'], false);
  });
  withProject({ 'smugan.config.json': '{ broken', 'smugan.local.json': { checks: { 'no-any': false } } }, (dir) => {
    const config = loadConfig(dir);
    assert.equal(config.configError, join(dir, 'smugan.config.json'));
    assert.equal(config.checks['no-any'], false);
  });
});

test('mode defaults to block, the personal layer can set warn, and an unknown mode skips its layer', () => {
  withProject({ 'smugan.config.json': {} }, (dir) => assert.equal(loadConfig(dir).mode, 'block'));
  withProject({ 'smugan.config.json': { mode: 'warn' }, 'smugan.local.json': { mode: 'block' } }, (dir) => assert.equal(loadConfig(dir).mode, 'block'));
  withProject({ 'smugan.config.json': {}, 'smugan.local.json': { mode: 'warn' } }, (dir) => assert.equal(loadConfig(dir).mode, 'warn'));
  withProject({ 'smugan.config.json': { mode: 'off', checks: { 'no-any': false } } }, (dir) => {
    const config = loadConfig(dir);
    assert.equal(config.mode, 'block');
    assert.equal(config.configError, join(dir, 'smugan.config.json'));
    assert.equal(config.checks['no-any'], undefined, 'the whole layer is skipped, not half-applied');
  });
});

test('a layer with a valid warn mode but an invalid field leaves the mode at block', () => {
  withProject({ 'smugan.config.json': {}, 'smugan.local.json': { mode: 'warn', disable: 'critic' } }, (dir) => {
    const config = loadConfig(dir);
    assert.equal(config.configError, join(dir, 'smugan.local.json'));
    assert.equal(config.mode, 'block');
  });
});
