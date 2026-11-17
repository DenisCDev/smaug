// @ts-check
// The manifest parsers `smugan context` needs. A checkout or npm install has
// them in the package's own node_modules. The Claude Code plugin cache has
// none, so the plugin's SessionStart hook installs them into the plugin's data
// folder, which the agent's shell never learns about: the folder is derived
// from the cache path, both laid out by Claude Code
// (plugins/cache/<marketplace>/<plugin>/<version>, plugins/data/<plugin>-<marketplace>).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

/** Files that pin the parsers; a change in either means a new install. */
const MANIFESTS = ['package.json', 'package-lock.json'];

/**
 * The plugin data folder for a gate dir inside the plugin cache, or null when
 * the gate dir is not in one (a checkout, an npm install).
 * @param {string} gateDir
 */
export function pluginDataDir(gateDir) {
  const root = resolve(gateDir, '..', '..');
  const plugin = dirname(root);
  const marketplace = dirname(plugin);
  const cache = dirname(marketplace);
  if (basename(cache) !== 'cache' || basename(dirname(cache)) !== 'plugins') return null;
  const id = `${basename(plugin)}@${basename(marketplace)}`.replace(/[^A-Za-z0-9_-]/g, '-');
  return join(dirname(cache), 'data', id);
}

/** Where the plugin installs the gate's dependencies inside its data folder. @param {string} dataDir */
export const depsDir = (dataDir) => join(dataDir, 'gate');

/**
 * @param {string} gateDir
 * @returns {{ parseDocument: typeof import('yaml').parseDocument, parseToml: typeof import('smol-toml').parse, parseJsonc: typeof import('jsonc-parser').parse }}
 */
export function loadParsers(gateDir) {
  const data = pluginDataDir(gateDir);
  const bases = [gateDir, ...(data ? [depsDir(data)] : [])];
  /** @type {unknown} */
  let missing;
  for (const base of bases) {
    const require = createRequire(join(base, 'package.json'));
    try {
      return {
        parseDocument: require('yaml').parseDocument,
        parseToml: require('smol-toml').parse,
        parseJsonc: require('jsonc-parser').parse,
      };
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'MODULE_NOT_FOUND') throw error;
      missing = error;
    }
  }
  throw missing;
}

/** @param {string} path */
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/**
 * @typedef {(cwd: string) => { ok: boolean, detail: string }} Installer
 * @type {Installer}
 */
function npmCi(cwd) {
  // npm is a .cmd on Windows, which spawn runs only through a shell; every
  // argument is a constant.
  const result = spawnSync('npm', ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd, encoding: 'utf8', timeout: 100_000, shell: process.platform === 'win32', windowsHide: true,
  });
  const detail = result.error?.message ?? (result.stderr || result.stdout || '').trim().split('\n').pop() ?? '';
  return { ok: result.status === 0, detail: result.signal ? `interrupted after 100 s (${result.signal})` : detail };
}

/**
 * Installs the gate's dependencies into the plugin data folder when the gate
 * dir has none and the installed copy is missing or pinned differently.
 * @param {string} gateDir @param {string | undefined} dataDir CLAUDE_PLUGIN_DATA
 * @param {Installer} [install]
 * @returns {string | null} a warning for the user, or null
 */
export function installPluginDeps(gateDir, dataDir, install = npmCi) {
  if (!dataDir || existsSync(join(gateDir, 'node_modules', 'yaml', 'package.json'))) return null;
  const derived = pluginDataDir(gateDir);
  // A plugin loaded from a checkout (--plugin-dir): the CLI only looks beside itself.
  if (!derived) return `smugan context needs the gate package's dependencies: run npm ci --ignore-scripts in ${gateDir}.`;
  const target = depsDir(dataDir);
  const current = MANIFESTS.every((name) => read(join(target, name)) === read(join(gateDir, name)));
  if (!current || !existsSync(join(target, 'node_modules'))) {
    mkdirSync(target, { recursive: true });
    for (const name of MANIFESTS) writeFileSync(join(target, name), readFileSync(join(gateDir, name)));
    const { ok, detail } = install(target);
    if (!ok) {
      // Without the copy the next session tries again instead of trusting a half install.
      rmSync(join(target, 'package.json'), { force: true });
      return `could not install smugan context's dependencies in ${target} (npm ci: ${detail || 'no detail'}); the command stays unavailable until a new session installs them.`;
    }
  }
  if (resolve(derived) !== resolve(dataDir)) {
    return `smugan context's dependencies were installed in ${dataDir}, but the command looks for them in ${derived}; it stays unavailable in this plugin.`;
  }
  return null;
}
