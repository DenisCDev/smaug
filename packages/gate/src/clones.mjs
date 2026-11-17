// @ts-check
// A function the turn wrote that repeats one the repository already has, up
// to names and literals (clone types 1 and 2). Across 3,000 turns, agents
// explored less of the relevant code as a task went on and left duplicated
// logic in 50.8% of the chains by turn 5, while the pass rate barely moved
// (RepoReuse, arXiv 2609.35357). Only exact and renamed clones: a semantic
// clone needs a model, and a guess here would hold turns for nothing.
//
// The comparison is over tokens: keywords and punctuation kept, identifiers
// renamed in order of first appearance, strings and numbers reduced to their
// kind. Per file, the index keeps the hashes keyed by size and mtime, so a
// warm Stop reads only the files that changed; the reading stops at its time
// budget and finishes on a later Stop.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CODE_FILE_RE, functionSpans } from './functions.mjs';
import { stripCode } from './strip.mjs';
import { writeAtomicJson } from './file-state.mjs';

export const MIN_TOKENS = 60;
const BUDGET_MS = 500;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 512 * 1024;
// Raised whenever the function finder reads code differently: an index built
// by an older finder would keep its list for every file that did not change.
const INDEX_VERSION = 2;
const SKIP_PATH_RE = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next)\/|\.d\.ts$|\.min\.|\.gen\.|(^|\/)(tests?|__tests__|e2e|fixtures?)\/|\.(test|spec)\./;

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set null undefined true false').split(' '));
const TOKEN_RE = /[A-Za-z_$][\w$]*|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?|'[^'\n]*'|"[^"\n]*"|`[^`]*`|=>|\.\.\.|\?\?=?|\?\.|[=!]==?|[<>]=?|&&=?|\|\|=?|[-+*/%&|^]=|\+\+|--|\S/g;

/** @typedef {{ name: string, line: number, hash: string, tokens: number }} IndexedFunction */

/**
 * The normalized token sequence of a body taken from stripped code.
 * @param {string} body @returns {string[]}
 */
export function normalizedTokens(body) {
  /** @type {Map<string, string>} */
  const names = new Map();
  return [...body.matchAll(TOKEN_RE)].map(([t]) => {
    if (/^[A-Za-z_$]/.test(t)) {
      if (KEYWORDS.has(t)) return t;
      if (!names.has(t)) names.set(t, `$${names.size}`);
      return /** @type {string} */ (names.get(t));
    }
    if (/^\d/.test(t)) return 'N';
    if (/^['"`]/.test(t)) return 'S';
    return t;
  });
}

/** Functions of `code` with at least `minTokens` body tokens, hashed. @param {string} code @param {number} minTokens @returns {IndexedFunction[]} */
export function hashedFunctions(code, minTokens = MIN_TOKENS) {
  const text = code.replace(/\r\n/g, '\n');
  const s = stripCode(text);
  return functionSpans(text).flatMap((f) => {
    const tokens = normalizedTokens(s.slice(f.bodyStart, f.end));
    if (tokens.length < minTokens) return [];
    return [{ name: f.name, line: f.line, tokens: tokens.length, hash: createHash('sha256').update(tokens.join(' ')).digest('hex').slice(0, 20) }];
  });
}

/** @param {string} root */
const indexFile = (root) => join(tmpdir(), `smugan-clones-${createHash('sha256').update(root.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 24)}.json`);

/** @param {string} file @returns {Record<string, { key: string, fns: IndexedFunction[] }>} */
function readIndex(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data?.version === INDEX_VERSION && data.files && typeof data.files === 'object' ? data.files : {};
  } catch {
    return {}; // a missing or torn index is rebuilt
  }
}

/**
 * The repository's indexed functions, refreshed within the time budget.
 * @param {string} root @param {number} minTokens @param {number} [budgetMs]
 * @returns {{ entries: { rel: string, fn: IndexedFunction }[], complete: boolean }}
 */
export function repositoryIndex(root, minTokens = MIN_TOKENS, budgetMs = BUDGET_MS) {
  // The gate's shared git helper caps output at 256 KB; a large checkout's
  // file list (20k files in mastra) is several MB, so this call sets its own.
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', timeout: 2000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (listed.status !== 0) return { entries: [], complete: false };
  const rels = listed.stdout.split('\n').map((l) => l.trim()).filter((rel) => rel && CODE_FILE_RE.test(rel) && !SKIP_PATH_RE.test(rel)).slice(0, MAX_FILES);
  const file = indexFile(root);
  const cached = readIndex(file);
  /** @type {Record<string, { key: string, fns: IndexedFunction[] }>} */
  const files = {};
  let complete = rels.length < MAX_FILES;
  let changed = false;
  // The budget is for reading files: the listing has its own deadline, and one
  // that outlasts the budget would leave every run with no time to read any.
  // A run reads one file whatever the clock says, so the index always advances.
  const started = Date.now();
  for (const rel of rels) {
    let stats;
    try {
      stats = statSync(join(root, rel));
    } catch {
      continue; // listed but deleted since
    }
    const key = `${stats.size}:${stats.mtimeMs}:${minTokens}`;
    if (cached[rel]?.key === key) { files[rel] = cached[rel]; continue; }
    if (changed && Date.now() - started >= budgetMs) { complete = false; continue; }
    const fns = stats.size > MAX_FILE_BYTES ? [] : hashedFunctions(readFileSync(join(root, rel), 'utf8'), minTokens);
    files[rel] = { key, fns };
    changed = true;
  }
  if (changed || Object.keys(cached).length !== Object.keys(files).length) writeAtomicJson(file, { version: INDEX_VERSION, files });
  return { entries: Object.entries(files).flatMap(([rel, entry]) => entry.fns.map((fn) => ({ rel, fn }))), complete };
}

/**
 * New functions of the turn that repeat another function of the repository.
 * @param {string} root
 * @param {{ rel: string, content: string, existed: string[] | null }[]} touched
 *   `existed`: function names at the turn's first touch, [] for a new file
 * @param {number} [minTokens]
 * @returns {{ clones: { rel: string, line: number, name: string, other: { rel: string, name: string, line: number } }[], complete: boolean }}
 */
export function newClones(root, touched, minTokens = MIN_TOKENS) {
  const candidates = touched.filter((t) => t.existed !== null && CODE_FILE_RE.test(t.rel) && !SKIP_PATH_RE.test(t.rel));
  if (candidates.length === 0) return { clones: [], complete: true };
  const fresh = candidates.flatMap((t) => hashedFunctions(t.content, minTokens)
    .filter((fn) => !(t.existed ?? []).includes(fn.name))
    .map((fn) => ({ rel: t.rel, fn })));
  if (fresh.length === 0) return { clones: [], complete: true };
  const index = repositoryIndex(root, minTokens);
  // The touched files as they are now, whatever the index read.
  const current = new Set(candidates.map((t) => t.rel));
  const all = [...index.entries.filter((e) => !current.has(e.rel)), ...candidates.flatMap((t) => hashedFunctions(t.content, minTokens).map((fn) => ({ rel: t.rel, fn })))];
  const clones = [];
  /** @type {Set<string>} two new copies of each other are one finding */
  const reported = new Set();
  for (const { rel, fn } of fresh) {
    const other = all.find((e) => e.fn.hash === fn.hash && !(e.rel === rel && e.fn.line === fn.line));
    if (!other || reported.has(`${other.rel}:${other.fn.line}`)) continue;
    reported.add(`${rel}:${fn.line}`);
    clones.push({ rel, line: fn.line, name: fn.name, other: { rel: other.rel, name: other.fn.name, line: other.fn.line } });
  }
  return { clones, complete: index.complete };
}
