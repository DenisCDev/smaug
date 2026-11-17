// @ts-check
// A file a shell command writes never passes through Write/Edit, so the hooks
// only see it through the repository: what git reports as changed or
// untracked, and the commit HEAD points at, at the turn's first shell command,
// against the same at the end of the turn. A fingerprint is the file's size
// and modification time, so taking one reads no file content. Every git call
// passes --no-optional-locks: a status run in the background must not
// refresh the index under a commit the person or the agent is making.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** More changed files than this and the repository is mid-generation or mid-checkout: no snapshot. */
export const MAX_DIRTY_FILES = 2000;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
}

/** git ran and answered no (exit status), as opposed to not running. @param {unknown} error */
const answeredNo = (error) => typeof (/** @type {{ status?: unknown }} */ (error))?.status === 'number';

/**
 * The repository's top level, or null when `dir` is not inside one or git is
 * not installed: without a repository there is nothing to compare. A timeout
 * is thrown, for the caller to record.
 * @param {string} dir
 */
export function gitRoot(dir) {
  try {
    return git(dir, ['rev-parse', '--show-toplevel']).trim() || null;
  } catch (error) {
    if (answeredNo(error) || /** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT') return null;
    throw error;
  }
}

/** The commit HEAD points at, or '' before the first commit. @param {string} root */
export function headCommit(root) {
  try {
    return git(root, ['rev-parse', '--verify', '-q', 'HEAD']).trim();
  } catch (error) {
    if (answeredNo(error)) return '';
    throw error;
  }
}

/** Reflog subjects of a commit made in this checkout: a new one, an amend, the first. */
const OWN_COMMIT_RE = /^commit(?: \((?:amend|initial)\))?: /;

/**
 * HEAD's reflog, newest first, one line per move of HEAD: the commit it moved
 * to, the selector with the move's unix time, and what moved it. Empty when
 * HEAD has no reflog yet.
 * @param {string} root @returns {string[]}
 */
export function headReflog(root) {
  try {
    return git(root, ['reflog', 'show', '--date=unix', '--format=%H%x09%gd%x09%gs', 'HEAD', '--']).split('\n').filter(Boolean);
  } catch (error) {
    if (answeredNo(error)) return [];
    throw error;
  }
}

/** @param {string} line */
const reflogEntry = (line) => {
  const [sha, selector = '', subject = ''] = line.split('\t');
  return { sha, at: Number(/\{(\d+)\}/.exec(selector)?.[1] ?? 0), subject };
};

/**
 * The turn's own commits, oldest first, each with the commit HEAD moved from
 * and the files that move changed: the `commit` entries of HEAD's reflog after
 * the snapshot's newest one. A pull, merge, checkout, reset, rebase or
 * cherry-pick records another kind of entry, so what it brings is not the
 * turn's, whoever wrote it and whenever; an amend counts for what it changed on
 * the commit it replaced. A reflog trimmed during the turn is searched for the
 * snapshot's entry, and without it, for the moves since the snapshot's second.
 * @param {string} root @param {{ reflog: { count: number, line: string } | null, at: number }} start
 * @returns {{ from: string, to: string, files: string[] }[]}
 */
export function turnCommits(root, start) {
  const lines = headReflog(root);
  let boundary = start.reflog ? lines.length - start.reflog.count : -1;
  if (start.reflog && start.reflog.count === 0) boundary = lines.length;
  else if (!start.reflog || lines[boundary] !== start.reflog.line) {
    boundary = start.reflog?.line ? lines.indexOf(start.reflog.line) : -1;
    if (boundary < 0) {
      const seconds = Math.floor(start.at / 1000);
      boundary = lines.findIndex((line) => reflogEntry(line).at < seconds);
      if (boundary < 0) boundary = lines.length;
    }
  }
  /** @type {{ from: string, to: string, files: string[] }[]} */
  const commits = [];
  for (let i = 0; i < boundary; i++) {
    const entry = reflogEntry(lines[i]);
    if (!OWN_COMMIT_RE.test(entry.subject)) continue;
    const from = i + 1 < lines.length ? reflogEntry(lines[i + 1]).sha : '';
    const listed = from
      ? git(root, ['diff', '--name-only', '-z', '--no-renames', from, entry.sha])
      : git(root, ['diff-tree', '--no-commit-id', '--root', '-r', '--name-only', '-z', '--no-renames', entry.sha]);
    commits.push({ from, to: entry.sha, files: listed.split('\0').filter(Boolean) });
  }
  return commits.reverse();
}

/** A file as a commit holds it, or null when the commit does not have it. @param {string} root @param {string} rev @param {string} rel */
export function contentAt(root, rev, rel) {
  try {
    return git(root, ['show', `${rev}:${rel}`]);
  } catch (error) {
    if (answeredNo(error)) return null;
    throw error;
  }
}

/** @param {string} abs @returns {string | null} */
function fingerprint(abs) {
  try {
    const stats = statSync(abs);
    return stats.isFile() ? `${stats.size}:${stats.mtimeMs}` : null;
  } catch (error) {
    // Deleted between git's listing and this stat: nothing left to check.
    if (/** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Every file git lists as changed or untracked under `root`, with its
 * fingerprint and whether it is untracked, and apart from them the tracked
 * paths that are gone.
 * @param {string} root
 * @returns {{ files: Record<string, { print: string, untracked: boolean }>, deleted: string[] } | null} null past MAX_DIRTY_FILES
 */
export function dirtyFiles(root) {
  const entries = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  /** @type {Record<string, { print: string, untracked: boolean }>} */
  const files = {};
  /** @type {string[]} */
  const deleted = [];
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    // A rename or copy is followed by its original path, which no longer holds
    // this content; after a rename that path is gone.
    if (code[0] === 'R') deleted.push(entries[i + 1]);
    if (code[0] === 'R' || code[0] === 'C') i++;
    if (code.includes('D')) {
      deleted.push(entry.slice(3));
      continue;
    }
    if (++count > MAX_DIRTY_FILES) return null;
    const rel = entry.slice(3);
    const print = fingerprint(join(root, rel));
    if (print) files[rel] = { print, untracked: code === '??' };
  }
  return { files, deleted };
}
