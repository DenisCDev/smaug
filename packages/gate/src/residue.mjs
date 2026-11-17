// @ts-check
// What an agent's search leaves in the delivery. Minimizing patches on
// SWE-bench Verified (TRIM, arXiv 2607.18161), every file removed was a repro
// script (49.6% of the lines removed) or a build/config change (35.8%), and
// the hidden suites still passed in 327 of 330 cases. Both are visible without
// a model: a new file nothing imports, tests or configures, and a config the
// request never asked to change. Listed once per turn; nothing is deleted.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { git } from './context-io.mjs';

const SCRIPT_RE = /\.(?:[cm]?[jt]s|tsx|jsx|py|sh|ps1|rb)$/i;
const RESIDUE_NAME_RE = /^(?:repro(?:duce)?|scratch|debug|tmp|temp|try|playground|poc)(?=[-_.\d]|$)/i;
const CONFIG_NAME_RE = /(?:^|[.-])config\.|^\.[\w-]+rc(?:\.|$)|^(?:eslint|prettier)\./i;
// Files a framework loads by name, which nothing imports.
const CONVENTION_NAME_RE = /^(?:middleware|proxy|instrumentation(?:-client)?|mdx-components|sentry\.[\w.]+|[\w-]+-env\.d|global\.d|env\.d)\.[cm]?[jt]sx?$/i;
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const DEPENDENCY_WORDS = /depend|pacote|package|bibliotec|librar|(?<![a-z])libs?(?![a-z])|instal|script|npm|pnpm|yarn|(?<![a-z])bun(?![a-z])|vers[aã]o|version|upgrade|atualiz|bump|lockfile/i;
/** @type {{ re: RegExp, cites: RegExp }[]} */
const CONFIG_KINDS = [
  { re: /(?:^|\/)package\.json$/, cites: DEPENDENCY_WORDS },
  { re: new RegExp(`(?:^|/)(?:${LOCKFILES.map((l) => l.replace(/\./g, '\\.')).join('|')})$`), cites: DEPENDENCY_WORDS },
  { re: /(?:^|\/)[jt]sconfig[^/]*\.json$/, cites: /tsconfig|jsconfig|typescript|compil|strict|alias/i },
  {
    re: /(?:^|\/)(?:vite|vitest|webpack|rollup|next|nuxt|astro|svelte|tsup|esbuild|babel|jest|playwright|tailwind|postcss|eslint|prettier|rspack)\.config\.[cm]?[jt]s$|(?:^|\/)(?:\.babelrc|\.swcrc|turbo\.json|\.eslintrc(?:\.\w+)?)$/,
    cites: /build|bundl|config|vite|webpack|rollup|eslint|lint|prettier|babel|jest|vitest|playwright|tailwind|postcss|turbo|swc|esbuild|tsup|rspack/i,
  },
];
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

const fwd = (/** @type {string} */ p) => p.replace(/\\/g, '/');

/**
 * The last few things the user typed in a Claude Code transcript (JSONL),
 * newest first, joined; null when there are none. A follow-up ("pode seguir")
 * carries no scope of its own, so the requests before it count too. Tool
 * results also arrive as user entries and are skipped.
 * @param {unknown} transcriptPath
 */
export function recentUserPrompts(transcriptPath, count = 3) {
  if (typeof transcriptPath !== 'string' || !existsSync(transcriptPath)) return null;
  const fd = openSync(transcriptPath, 'r');
  let text;
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    text = buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
  const lines = text.split('\n');
  /** @type {string[]} */
  const prompts = [];
  for (let i = lines.length - 1; i >= 0 && prompts.length < count; i--) {
    if (!lines[i].includes('"user"')) continue;
    /** @type {any} JSONL written by the host; each field checked below */
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue; // the first line of the tail is usually cut mid-entry
    }
    const content = entry?.type === 'user' ? entry.message?.content : undefined;
    const typed = typeof content === 'string' ? content
      : Array.isArray(content) ? content.filter((/** @type {any} */ c) => c?.type === 'text' && typeof c.text === 'string').map((/** @type {any} */ c) => c.text).join('\n') : '';
    if (typed.trim()) prompts.push(typed);
  }
  return prompts.length ? prompts.join('\n') : null;
}

// What reading the files that share a piece of the name may cost in all: far
// more than a large checkout brings (hundreds of files, a few MiB), so that
// only a pathological one reaches it. Past either limit the answer is yes: a
// file the gate cannot clear is not held.
const MAX_REFERRERS = 2000;
const MAX_REFERRER_BYTES = 32 * 1024 * 1024;

/**
 * A candidate's text and size; null when it is gone, unreadable or larger than
 * what is left to read, which counts as a reference.
 * @param {string} abs @param {number} left bytes
 */
function readWithin(abs, left) {
  try {
    const { size } = statSync(abs);
    return size > left ? null : { size, text: readFileSync(abs, 'utf8') };
  } catch {
    return null; // gone or unreadable since the listing
  }
}

// How far back from its last slash a path is read. A longer one is judged by
// that much of it.
const MAX_PATH_PREFIX = 200;

/**
 * Whether `text` holds a path that ends in `stem` as an import or a config
 * writes one: `./tmp`, `../lib/tmp.js`, `@/tmp`, `src/lib/tmp`,
 * `<rootDir>/tmp`, `${dir}/tmp`. What only ends in the same word names no
 * file of the project: an absolute path ('/tmp', '/private/tmp'), a slash
 * right after a separator (`--dir=/tmp`), a URL, and a package
 * ('@types/tmp', 'node_modules/tmp').
 * @param {string} text @param {string} stem
 */
function namedByPath(text, stem) {
  const needle = `/${stem}`;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    // The path ends here when a quote, the extension or the end of the line follows.
    const after = text[at + needle.length];
    if (after !== undefined && !'\'"\x60.\r\n'.includes(after)) continue;
    let from = at;
    while (from > 0 && at - from < MAX_PATH_PREFIX && !/[\s'"\x60]/.test(text[from - 1])) from--;
    const before = text.slice(from, at);
    if (/[^(\[{,;=:+|&!?</]$/.test(before) && !/^[/\\]|:\/\/|(?:^|\/)(?:node_modules|@types)$/.test(before)) return true;
  }
  return false;
}

/**
 * Whether another file in the checkout names `rel`: an import of it, a
 * package.json script, a config or a test. Without git, or when git fails,
 * the answer is yes: a file the gate cannot clear is not held.
 * @param {string} root @param {string} rel
 */
function referenced(root, rel) {
  const name = basename(rel);
  const stem = name.replace(/\.[^.]+$/, '');
  // Fixed strings find the candidates within git's deadline, in a large
  // checkout too. `/stem.` also covers `./stem.js` importing `stem.ts` under NodeNext.
  // `-z` keeps a name with an accent as it is: quoted and escaped, it would not be found on disk.
  const result = git(root, ['grep', '-l', '-z', '-F', '--untracked', '-e', name, '-e', `/${stem}'`, '-e', `/${stem}"`, '-e', `/${stem}\``, '-e', `/${stem}.`, '--', '.']);
  if (result.status === 1) return false;
  if (result.status !== 0) return true;
  // A lockfile names packages (`node_modules/debug`), never a script of the project.
  const candidates = result.stdout.split('\0').map(fwd).filter((file) => file && file !== rel && !LOCKFILES.includes(basename(file)));
  if (candidates.length > MAX_REFERRERS) return true;
  // Each candidate is then read for the whole name or a path that ends in it:
  // `retry.mjs` does not name `try.mjs`, and neither the string '/tmp' nor a
  // '/debug' route names a file.
  const wholeName = new RegExp(String.raw`(?:^|[^\w$.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w$-])`, 'm');
  let left = MAX_REFERRER_BYTES;
  return candidates.some((file) => {
    const read = readWithin(join(root, file), left);
    if (read === null) return true;
    left -= read.size;
    return wholeName.test(read.text) || namedByPath(read.text, stem);
  });
}

/**
 * Dependency names a package.json gained or changed against HEAD: a request
 * that names the library ("use o zod") asks for it without saying "dependency".
 * @param {string} root @param {string} rel
 * @returns {string[]}
 */
function changedDependencies(root, rel) {
  if (!/(?:^|\/)package\.json$/.test(rel)) return [];
  /** @param {string} text @returns {Record<string, unknown>} */
  const deps = (text) => {
    try {
      const pkg = JSON.parse(text);
      return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
    } catch {
      return {}; // an unparsable manifest names no dependency
    }
  };
  const head = git(root, ['show', `HEAD:${rel}`]);
  const before = head.status === 0 ? deps(head.stdout) : {};
  const now = deps(readFileSync(join(root, rel), 'utf8'));
  return Object.keys(now).filter((name) => before[name] !== now[name]);
}

/**
 * @param {{ root: string, created: string[], touched: string[], startedAt: number,
 *   scope: string | null, isTest: (rel: string) => boolean }} turn
 *   `scope`: what the turn was asked to do (the active contract and the user's
 *   last request), null when neither is known.
 * @returns {{ file: string, message: string }[]}
 */
export function explorationResidue({ root, created, touched, startedAt, scope, isTest }) {
  /** @type {{ file: string, message: string }[]} */
  const found = [];
  const inRoot = (/** @type {string} */ abs) => {
    const rel = fwd(relative(root, abs));
    return rel && !rel.startsWith('..') ? rel : null;
  };
  const named = (/** @type {string} */ rel) => scope !== null && (scope.includes(basename(rel)) || scope.includes(rel));
  for (const abs of created) {
    const rel = inRoot(abs);
    if (!rel || !existsSync(abs) || !SCRIPT_RE.test(rel) || isTest(rel) || CONFIG_NAME_RE.test(basename(rel)) || CONVENTION_NAME_RE.test(basename(rel))) continue;
    const residueName = RESIDUE_NAME_RE.test(basename(rel));
    // A loose script at the root is held only when the request is known to
    // leave it out; a repro/scratch/debug name is held either way.
    if (!residueName && (rel.includes('/') || scope === null)) continue;
    if (named(rel) || referenced(root, rel)) continue;
    found.push({ file: rel, message: 'new file that no import, test, script or config references — delete it if the task does not need it, or say why it stays' });
  }
  if (scope === null) return found;
  /** @type {Set<string>} */
  const configs = new Set();
  for (const abs of touched) {
    const rel = inRoot(abs);
    if (rel && existsSync(abs) && CONFIG_KINDS.some((k) => k.re.test(rel))) configs.add(rel);
  }
  // Lockfiles change through the package manager, not an edit: count one the
  // turn wrote, as its mtime and git status show.
  for (const lock of LOCKFILES) {
    const abs = join(root, lock);
    if (!startedAt || !existsSync(abs) || statSync(abs).mtimeMs < startedAt) continue;
    const status = git(root, ['status', '--porcelain', '--', lock]);
    if (status.status === 0 && status.stdout.trim()) configs.add(lock);
  }
  const manifests = [...configs].filter((rel) => /(?:^|\/)package\.json$/.test(rel));
  for (const rel of configs) {
    const kind = CONFIG_KINDS.find((k) => k.re.test(rel));
    // A lockfile changes for its manifests: the one beside it and, in a
    // workspace, the package's own, which the turn touched.
    const sources = LOCKFILES.includes(basename(rel))
      ? [...new Set([rel.replace(/[^/]+$/, 'package.json'), ...manifests])].filter((manifest) => existsSync(join(root, manifest)))
      : [rel];
    if (!kind || named(rel) || kind.cites.test(scope) || sources.some((source) => changedDependencies(root, source).some((dep) => scope.includes(dep)))) continue;
    found.push({ file: rel, message: 'changed, but neither the acceptance contract nor the request asks for it — revert it if the task does not need it, or say why it changed' });
  }
  return found;
}
