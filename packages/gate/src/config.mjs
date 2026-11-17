// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isContextArtifact } from './context-paths.mjs';
import { isPortuguese } from './language.cjs';
import { isSupabaseAt, isSupabaseProject } from './stack.mjs';

/** Checks that run by default only where the project uses Supabase. */
export const SUPABASE_CHECKS = new Set(['rls', 'rls-tests', 'security-notes', 'anon-grants', 'view-invoker', 'search-path', 'rls-policy']);

const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

// smaug.config.json is the project's former name: existing projects keep their settings.
export const CONFIG_FILES = ['smugan.config.json', 'smaug.config.json'];
/** Personal layer beside the shared config, kept out of git; its keys win. */
export const LOCAL_CONFIG_FILE = 'smugan.local.json';

/** Paths never checked, regardless of project config. */
export const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.vercel/**',
  '**/.turbo/**',
  '**/.expo/**',
  // Third-party code of the other stacks whose files the secrets rule reads.
  '**/.venv/**',
  '**/venv/**',
  '**/site-packages/**',
  '**/__pycache__/**',
  '**/.terraform/**',
  '**/*.min.*',
  '**/*.gen.*',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/database.types.ts',
  '**/.env',
  '**/.env.local',
  '**/.env.*.local',
];

/**
 * @typedef {{ smugan: boolean, typecheck: boolean, tests: boolean, shell?: boolean, timeoutMs: number }} StopConfig
 * `shell`: false leaves out the files shell commands change, when people edit
 * the repository while the agent works and their changes would count as the turn's.
 * @typedef {'block' | 'warn'} GateMode
 * @typedef {{ root: string, ignore: string[], checks: Record<string, unknown>, mode: GateMode, disable: string[],
 *   hook: { eslint: boolean, typecheck: boolean, timeoutMs: number, stop: StopConfig | false },
 *   configError?: string, localConfig?: string }} SmuganConfig
 */

/** @param {string} root @returns {SmuganConfig} */
function baseConfig(root) {
  return {
    root,
    ignore: [],
    checks: {},
    mode: 'block',
    disable: [],
    hook: {
      eslint: true,
      typecheck: true,
      timeoutMs: 30_000,
      stop: { smugan: true, typecheck: true, tests: true, shell: true, timeoutMs: 120_000 },
    },
  };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Applies one config file over `config`; later layers win key by key. @param {SmuganConfig} config @param {any} user */
function applyLayer(config, user) {
  // Every field is validated before any is applied: a layer reported as
  // ignored must not have switched the mode (or anything else) on the way out.
  if (user.mode !== undefined && user.mode !== 'block' && user.mode !== 'warn') {
    throw new Error(`"mode" must be "block" or "warn", got ${JSON.stringify(user.mode)}`);
  }
  // Parts (a reviewer, a skill, a stack rule) this project turns off; the
  // hooks silence their mentions where a hook can reach them.
  if (user.disable !== undefined && !(Array.isArray(user.disable) && user.disable.every((/** @type {unknown} */ n) => typeof n === 'string'))) {
    throw new Error('"disable" must be a list of names');
  }
  if (user.mode) config.mode = user.mode;
  if (user.disable) config.disable = [...new Set([...config.disable, ...user.disable])];
  if (Array.isArray(user.ignore)) config.ignore = [...new Set([...config.ignore, ...user.ignore])];
  if (isObject(user.checks)) {
    for (const [name, value] of Object.entries(user.checks)) {
      const current = config.checks[name];
      config.checks[name] = isObject(current) && isObject(value) ? { ...current, ...value } : value;
    }
  }
  if (isObject(user.hook)) {
    const { stop, ...rest } = user.hook;
    config.hook = { ...config.hook, ...rest, stop: config.hook.stop };
    if (stop === false) config.hook.stop = false;
    else if (stop && typeof stop === 'object') {
      config.hook.stop = { ...(config.hook.stop || baseConfig(config.root).hook.stop), ...stop };
    }
  }
}

/**
 * Finds smugan.config.json (and the personal smugan.local.json beside it)
 * walking up from startDir. Absent files = defaults,
 * rooted at the nearest .git or package.json directory so relative paths
 * (migrations/, scripts/...) stay meaningful.
 * @param {string} startDir
 * @returns {SmuganConfig}
 */
export function loadConfig(startDir) {
  let dir = resolve(startDir);
  /** @type {string | null} */
  let gitRoot = null;
  /** @type {string | null} */
  let pkgRoot = null;
  for (;;) {
    const shared = CONFIG_FILES.map((name) => join(dir, name)).find((f) => existsSync(f));
    const local = join(dir, LOCAL_CONFIG_FILE);
    const hasLocal = existsSync(local);
    if (shared || hasLocal) {
      const config = baseConfig(dir);
      for (const file of [shared, hasLocal ? local : undefined]) {
        if (!file) continue;
        try {
          applyLayer(config, JSON.parse(readFileSync(file, 'utf8').replace(BOM_RE, '')));
        } catch {
          // A broken layer is skipped, not fatal: the CLI warns with the file name.
          config.configError ??= file;
          continue;
        }
        if (file === local) config.localConfig = local;
      }
      return config;
    }
    if (!gitRoot && existsSync(join(dir, '.git'))) gitRoot = dir;
    if (!pkgRoot && existsSync(join(dir, 'package.json'))) pkgRoot = dir;
    const parent = dirname(dir);
    if (parent === dir) {
      return baseConfig(gitRoot ?? pkgRoot ?? resolve(startDir));
    }
    dir = parent;
  }
}

/** @param {SmuganConfig} config @param {string} name @param {string} [path] the checked file, relative to the root */
export function checkEnabled(config, name, path) {
  // ui-strings knows only pt-BR: it runs where the install chose a pt UI
  // language (the launcher exports it) or where the project turns it on.
  if (name === 'ui-strings' && config.checks[name] === undefined) return isPortuguese(process.env.SMUGAN_UI_LANG);
  // RLS, pgTAP and the anon/authenticated roles are Supabase's model: a plain
  // Postgres project (Prisma, Drizzle, Flyway) gets them only by opting in.
  if (SUPABASE_CHECKS.has(name) && config.checks[name] === undefined) return path === undefined ? isSupabaseProject(config.root) : isSupabaseAt(config.root, path);
  return config.checks[name] !== false;
}

/** @param {SmuganConfig} config @param {string} name @returns {Record<string, any>} */
export function checkOptions(config, name) {
  const value = config.checks[name];
  return value && typeof value === 'object' ? /** @type {any} */ (value) : {};
}

/** @type {Map<string, RegExp>} */
const globCache = new Map();

/** @param {string} glob */
export function globToRegExp(glob) {
  const cached = globCache.get(glob);
  if (cached) return cached;
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  const compiled = new RegExp('^' + re + '$');
  globCache.set(glob, compiled);
  return compiled;
}

/**
 * @param {string} relPath forward-slash relative path
 * @param {SmuganConfig} config
 */
export function isIgnored(relPath, config) {
  const path = relPath.replace(/^\.\//, '');
  if (isContextArtifact(config.root, path)) return true;
  for (const pattern of [...DEFAULT_IGNORE, ...config.ignore]) {
    if (globToRegExp(pattern).test(path)) return true;
  }
  return inVendoredTree(config.root, path);
}

// What a package manager leaves in the `vendor` folder it fills: Composer's
// autoloader, Go's module list, Bundler's gem tree, which it names after the
// Ruby engine (bundle/ alone could be a route of the project).
const VENDOR_MARKERS = ['autoload.php', 'modules.txt', 'bundle/ruby', 'bundle/jruby', 'bundle/truffleruby'];

/**
 * Whether `path` sits in a `vendor` folder a package manager made. A folder of
 * that name with none of its markers is the project's own code: "vendor" is
 * also a business word (`src/modules/vendor/`), so the name alone ignores nothing.
 * @param {string} root @param {string} path forward-slash, relative to root
 */
function inVendoredTree(root, path) {
  const parts = path.split('/');
  for (let i = parts.indexOf('vendor'); i >= 0 && i < parts.length - 1; i = parts.indexOf('vendor', i + 1)) {
    const dir = join(root, ...parts.slice(0, i + 1));
    if (VENDOR_MARKERS.some((marker) => existsSync(join(dir, marker)))) return true;
  }
  return false;
}
