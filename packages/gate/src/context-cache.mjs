// @ts-check
import { accessSync, appendFileSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DETECTOR_VERSION, git, hash, plainPath } from './context-io.mjs';
import { ownedDirectory, OWNER } from './context-paths.mjs';
import { withFileLock, writeAtomicJson } from './file-state.mjs';
import { validDecision } from './context-decisions.mjs';
import { fields, validData } from './context-schema.mjs';

/** @typedef {import('./context-resolve.mjs').ResolvedContext} Data */
/** @typedef {{fingerprint: string, observedAt: string, data: Data, inputs?: {path: string, hash: string}[], decisions?: import('./context-decisions.mjs').Decision[]}} Entry */
/** @typedef {{schemaVersion: number, detectorVersion: number, rootId: string, entries: Record<string, Entry>}} Cache */
const LIMIT = 4 * 1024 * 1024;

/** Worktree metadata may legitimately live outside the checkout, but a link
 * in that path must never redirect an exclusion write into an unrelated file.
 * @param {string} destination */
function plainAbsolute(destination) {
  let boundary = destination;
  while (dirname(boundary) !== boundary) boundary = dirname(boundary);
  return plainPath(boundary, destination);
}

/** Claim a fresh directory atomically; never adopt an existing foreign directory.
 * @param {string} root @param {string} directory */
function claim(root, directory) {
  if (!plainPath(root, directory)) throw new Error('Unsafe cache path');
  if (existsSync(directory)) {
    if (!ownedDirectory(directory)) throw new Error('Foreign cache directory');
    return;
  }
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, '.owner'), OWNER, { flag: 'wx', mode: 0o600 });
}

/** @param {string} directory */
function usableDestination(directory) {
  accessSync(directory, constants.W_OK);
  const file = join(directory, 'context.json');
  if (!plainPath(directory, file)) throw new Error('Unsafe cache destination');
  if (existsSync(file)) {
    if (!lstatSync(file).isFile()) throw new Error('Foreign cache destination');
    accessSync(file, constants.W_OK);
  }
  return file;
}

/** Git worktrees may share info/exclude. The lock belongs beside that actual file.
 * @param {string} root */
function excludeLocal(root) {
  const tracked = git(root, ['ls-files', '--', '.smugan.local']);
  if (tracked.status !== 0 || tracked.stdout.trim()) throw new Error('Tracked cache collision');
  const result = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('No Git exclude');
  const file = resolve(root, result.stdout.trim());
  if (!plainAbsolute(file)) throw new Error('Unsafe Git metadata path');
  mkdirSync(dirname(file), { recursive: true });
  withFileLock(file + '.smugan', () => {
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || statSync(file).size > LIMIT)) throw new Error('Unsafe exclude file');
    const previous = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (previous.length > LIMIT) throw new Error('Oversized exclude');
    // Only owned file names are hidden. A developer's other files remain visible.
    const lines = ['/.smugan.local/.owner', '/.smugan.local/context.json', '/.smugan.local/context.json.lock/', '/.smugan.local/context.json.*.tmp'];
    const missing = lines.filter((line) => !previous.split(/\r?\n/).includes(line));
    if (missing.length) appendFileSync(file, (previous && !previous.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  });
  if (git(root, ['check-ignore', '--quiet', '--', '.smugan.local/context.json']).status !== 0) throw new Error('Cache is not ignored');
}

/** @param {string} root @param {string[]} limitations @returns {string | undefined} */
export function cacheLocation(root, limitations) {
  const local = join(root, '.smugan.local');
  try {
    if (!plainPath(root, local) || (existsSync(local) && !ownedDirectory(local))) throw new Error('Local collision');
    // Serialize first-use initialization too, without placing an unignored file in the checkout.
    const metadata = git(root, ['rev-parse', '--git-path', 'info/exclude']);
    if (metadata.status !== 0 || !metadata.stdout.trim()) throw new Error('Not Git');
    const exclude = resolve(root, metadata.stdout.trim());
    if (!plainAbsolute(exclude)) throw new Error('Unsafe Git metadata path');
    mkdirSync(dirname(exclude), { recursive: true });
    withFileLock(exclude + '.smugan-init', () => { excludeLocal(root); claim(root, local); });
    return usableDestination(local);
  } catch { limitations.push('Local cache unavailable or blocked by existing files; using external private storage.'); }
  try {
    const base = resolve(process.env.SMUGAN_CACHE_DIR || join(process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'smugan', 'context'));
    // Do not follow a pre-existing symlink anywhere below the filesystem root.
    let boundary = base;
    while (dirname(boundary) !== boundary) boundary = dirname(boundary);
    if (!plainPath(boundary, base)) throw new Error('Unsafe private cache path');
    mkdirSync(base, { recursive: true, mode: 0o700 });
    const directory = join(base, hash(root));
    withFileLock(directory, () => claim(base, directory));
    return usableDestination(directory);
  } catch { limitations.push('Private storage unavailable; the run continues without persistence.'); return undefined; }
}

/** @param {string} root @returns {Cache} */
export function emptyCache(root) { return { schemaVersion: 1, detectorVersion: DETECTOR_VERSION, rootId: hash(root), entries: {} }; }

/** @param {string} file @param {string} root @param {string[]} limitations @returns {Cache} */
export function readCache(file, root, limitations) {
  try {
    if (!existsSync(file)) return emptyCache(root);
    if (!plainPath(dirname(file), file) || statSync(file).size > LIMIT) throw new Error('Invalid cache file');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!fields(value, ['schemaVersion', 'detectorVersion', 'rootId', 'entries']) || value.schemaVersion !== 1 || value.detectorVersion !== DETECTOR_VERSION || value.rootId !== hash(root)
      || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('Invalid cache envelope');
    const entries = Object.entries(value.entries);
    if (entries.length > 64 || !entries.every(([key, entry]) => {
      const item = /** @type {Entry} */ (entry);
      return fields(item, ['fingerprint', 'observedAt', 'data', 'inputs', 'decisions'], ['fingerprint', 'observedAt', 'data'])
        && /^[a-f\d]{64}$/.test(key) && /^[a-f\d]{64}$/.test(item?.fingerprint)
        && typeof item?.observedAt === 'string' && validData(item.data)
        && (item.inputs === undefined || Array.isArray(item.inputs) && item.inputs.length <= 1024 && item.inputs.every((input) =>
          fields(input, ['path', 'hash']) && typeof input.path === 'string' && /^[a-f\d]{64}$/.test(input.hash)))
        && (item.decisions === undefined || Array.isArray(item.decisions) && item.decisions.length <= 32 && item.decisions.every(validDecision));
    })) throw new Error('Invalid cached context');
    return value;
  } catch { limitations.push('Invalid or incompatible cache was discarded; context rebuilt from the files.'); return emptyCache(root); }
}

/** @param {string} file @param {Cache} cache */
export function publishCache(file, cache) {
  if (!plainPath(dirname(file), file) || !ownedDirectory(dirname(file))) throw new Error('Cache ownership changed');
  if (Buffer.byteLength(JSON.stringify(cache)) > LIMIT) throw new Error('Cache size limit');
  writeAtomicJson(file, cache);
}
