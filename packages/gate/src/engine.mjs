// @ts-check
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CHECKS } from './checks/index.mjs';
import { checkEnabled, checkOptions, CONFIG_FILES, isIgnored, loadConfig, LOCAL_CONFIG_FILE } from './config.mjs';
import { isContextArtifact } from './context-paths.mjs';

const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  '.vercel', '.turbo', '.expo', '.claude',
  '.venv', 'venv', 'site-packages', '__pycache__', '.terraform',
]);

/** @typedef {{ file: string, line: number, rule: string, severity: string, message: string }} Violation */

/** @param {string} p */
export const norm = (p) => p.replace(/\\/g, '/');

// `smaug-ignore` is the project's former name: suppressions already written
// with it in existing codebases keep working after the rename.
const SUPPRESS_RE = /(?:smugan|smaug)-ignore(-file)?\s+([a-z0-9*,-]+)\s*:\s*(.*)/;

/**
 * Runs every applicable check on one file's content, then applies
 * `smugan-ignore` suppressions found in the content.
 * @param {string} relPath
 * @param {string} content
 * @param {import('./config.mjs').SmuganConfig} config
 * @returns {Violation[]}
 */
export function analyzeContent(relPath, content, config) {
  const path = norm(relPath);
  if (isContextArtifact(config.root, path)) return [];
  // CRLF-normalized: on autocrlf checkouts the disk content carries \r\n while
  // git-HEAD baselines and patch-derived content carry \n — without this, the
  // same violation gets two different messages (a captured lump keeps the \r)
  // and the before/after diff stops cancelling legacy debt.
  const body = content.replace(BOM_RE, '').replace(/\r\n/g, '\n');
  const lines = body.split('\n');

  /** @type {Violation[]} */
  let violations = [];
  for (const check of CHECKS) {
    if (!check.appliesTo(path)) continue;
    if (!checkEnabled(config, check.name, path)) continue;
    const found = check.run({
      path,
      content: body,
      lines,
      config,
      options: checkOptions(config, check.name),
    });
    for (const f of found) {
      violations.push({ file: path, rule: check.name, severity: 'error', ...f });
    }
  }

  const { invalidLines, suppressed } = parseSuppressions(lines);
  for (const line of invalidLines) {
    violations.push({
      file: path,
      rule: 'smugan-ignore',
      severity: 'error',
      line,
      message: 'suppression without a real reason — use "smugan-ignore <rule>: <reason with 6+ chars>"',
    });
  }
  return violations.filter((v) => v.rule === 'smugan-ignore' || !suppressed(v.rule, v.line));
}

/**
 * Suppressions: `smugan-ignore <rule>[,rule]: <reason>` (same or previous
 * line) and `smugan-ignore-file <rule>: <reason>` (whole file). A reason of
 * fewer than 6 chars suppresses nothing and is reported as its own violation —
 * governed exceptions only.
 * @param {string[]} lines
 * @returns {{ invalidLines: number[], suppressed: (rule: string, line: number) => boolean }}
 */
export function parseSuppressions(lines) {
  const fileRules = new Set();
  /** @type {Map<number, Set<string>>} */
  const lineRules = new Map();
  /** @type {number[]} */
  const invalidLines = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SUPPRESS_RE);
    if (!m) continue;
    const rules = m[2].split(',').map((r) => r.trim()).filter(Boolean);
    const reason = m[3].replace(/\*\/.*$/, '').replace(/-->.*$/, '').trim();
    if (reason.length < 6) {
      invalidLines.push(i + 1);
      continue;
    }
    const target = m[1] ? fileRules : (lineRules.get(i + 1) ?? new Set());
    for (const r of rules) target.add(r);
    if (!m[1]) lineRules.set(i + 1, target);
  }
  const suppressed = (/** @type {string} */ rule, /** @type {number} */ line) => {
    if (fileRules.has(rule) || fileRules.has('*')) return true;
    for (const at of [line, line - 1]) {
      const set = lineRules.get(at);
      if (set && (set.has(rule) || set.has('*'))) return true;
    }
    return false;
  };
  return { invalidLines, suppressed };
}

// What makes a folder resolve its own config and root instead of its parent's.
const ROOT_MARKERS = [...CONFIG_FILES, LOCAL_CONFIG_FILE, '.git', 'package.json'];

/**
 * Runs the checks on every checkable file under `targets`, files or folders.
 * Each file is judged with the config found walking up from its own folder,
 * as the hooks do: that config's folder is the root its ignore globs, and the
 * path the rules see, are relative to, whatever folder the command runs from
 * and whatever path it is given. Violations name the file relative to `cwd`
 * when it sits under it, and by its full path otherwise (another drive has no
 * relative form).
 * @param {string[]} targets absolute paths that exist
 * @param {string} cwd
 * @returns {{ filesChecked: number, violations: Violation[], configErrors: string[] }}
 */
export function checkPaths(targets, cwd) {
  /** @type {Violation[]} */
  const violations = [];
  /** @type {Set<string>} */
  const configErrors = new Set();
  let filesChecked = 0;
  const shown = (/** @type {string} */ abs) => {
    const rel = relative(cwd, abs);
    return norm(rel === '' || rel.startsWith('..') || isAbsolute(rel) ? abs : rel);
  };
  const visitFile = (/** @type {string} */ abs, /** @type {import('./config.mjs').SmuganConfig} */ config) => {
    const rel = norm(relative(config.root, abs));
    if (isIgnored(rel, config) || !CHECKS.some((check) => check.appliesTo(rel))) return;
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      return;
    }
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return;
    filesChecked++;
    if (config.configError) configErrors.add(config.configError);
    for (const v of analyzeContent(rel, readFileSync(abs, 'utf8'), config)) violations.push({ ...v, file: shown(abs) });
  };
  // With no config, .git or package.json anywhere up the tree, loadConfig
  // roots at the folder it is given. A folder named on the command line would
  // then lose its place in the paths the rules read (supabase/migrations/…,
  // scripts/…), so the folder the command runs from is the root, when it holds it.
  const rooted = (/** @type {string} */ dir) => {
    const config = loadConfig(dir);
    if (config.root !== resolve(dir) || ROOT_MARKERS.some((name) => existsSync(join(dir, name)))) return config;
    const fromCwd = relative(cwd, dir);
    return fromCwd.startsWith('..') || isAbsolute(fromCwd) ? config : loadConfig(cwd);
  };
  const visitDir = (/** @type {string} */ dir, /** @type {import('./config.mjs').SmuganConfig | null} */ inherited) => {
    // A folder with no config, .git or package.json of its own resolves like its parent.
    const config = inherited && !ROOT_MARKERS.some((name) => existsSync(join(dir, name))) ? inherited : rooted(dir);
    const rel = norm(relative(config.root, dir));
    if (rel !== '' && isIgnored(rel + '/x', config)) return;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visitDir(join(dir, entry.name), config);
      } else if (entry.isFile()) visitFile(join(dir, entry.name), config);
    }
  };
  for (const target of targets) {
    const abs = resolve(target);
    if (statSync(abs).isDirectory()) visitDir(abs, null);
    else visitFile(abs, rooted(dirname(abs)));
  }
  return { filesChecked, violations, configErrors: [...configErrors] };
}
