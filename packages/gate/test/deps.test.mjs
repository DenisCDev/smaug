// @ts-check
// Under the Claude Code plugin the gate runs from the plugin cache, which has
// no node_modules: the parsers come from the plugin data folder instead.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPluginDeps, loadParsers, pluginDataDir } from '../src/deps.mjs';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'smugan-deps-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** A plugin cache copy of the gate, without node_modules, like Claude Code makes it. @param {string} name */
function cachedGate(name) {
  const plugins = join(tmp, name, 'plugins');
  const gate = join(plugins, 'cache', 'smugan', 'smugan', '0.21.0', 'packages', 'gate');
  cpSync(GATE, gate, { recursive: true, filter: (src) => !src.includes('node_modules') });
  return { gate, data: join(plugins, 'data', 'smugan-smugan') };
}

test('the data folder is derived from the cache layout, and only inside a plugin cache', () => {
  const { gate, data } = cachedGate('layout');
  assert.equal(pluginDataDir(gate), data);
  assert.equal(pluginDataDir(GATE), null);
});

test('smugan context runs from the plugin cache once the parsers are in the data folder', () => {
  const { gate, data } = cachedGate('context');
  const project = join(tmp, 'context-project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), '{"dependencies":{"yaml":"2.9.1"}}');
  const context = () => spawnSync(process.execPath, [join(gate, 'bin', 'smugan.mjs'), 'context', '--json', '--no-cache', project], { encoding: 'utf8', timeout: 20_000 });

  const before = context();
  assert.equal(before.status, 2);
  assert.match(before.stderr, /parsers unavailable/);

  const warning = installPluginDeps(gate, data, (cwd) => {
    cpSync(join(GATE, 'node_modules'), join(cwd, 'node_modules'), { recursive: true });
    return { ok: true, detail: '' };
  });
  assert.equal(warning, null);
  const after = context();
  assert.equal(after.status, 0, after.stderr);
  assert.ok(JSON.parse(after.stdout).packages.length > 0);
  assert.equal(typeof loadParsers(gate).parseToml, 'function');
});

test('a failed install is retried next session; a current one is not repeated', () => {
  const { gate, data } = cachedGate('retry');
  let runs = 0;
  const failed = installPluginDeps(gate, data, () => { runs++; return { ok: false, detail: 'ENOTFOUND registry.npmjs.org' }; });
  assert.match(String(failed), /ENOTFOUND/);
  assert.equal(existsSync(join(data, 'gate', 'package.json')), false);

  /** @param {string} cwd */
  const ok = (cwd) => { runs++; mkdirSync(join(cwd, 'node_modules'), { recursive: true }); return { ok: true, detail: '' }; };
  assert.equal(installPluginDeps(gate, data, ok), null);
  assert.equal(installPluginDeps(gate, data, ok), null);
  assert.equal(runs, 2);

  // A plugin update that pins other versions installs again.
  const lock = join(gate, 'package-lock.json');
  writeFileSync(lock, readFileSync(lock, 'utf8').replace('"lockfileVersion"', '"name2": "x", "lockfileVersion"'));
  installPluginDeps(gate, data, ok);
  assert.equal(runs, 3);
});

test('a checkout with its own node_modules needs nothing; one without is told what to run', () => {
  assert.equal(installPluginDeps(GATE, join(tmp, 'unused'), () => assert.fail('no install expected')), null);
  const bare = join(tmp, 'bare', 'packages', 'gate');
  mkdirSync(bare, { recursive: true });
  assert.match(String(installPluginDeps(bare, join(tmp, 'unused'), () => assert.fail('no install expected'))), /npm ci --ignore-scripts/);
});
