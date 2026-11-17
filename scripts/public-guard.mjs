#!/usr/bin/env node
// @ts-check
// Keeps out of the public repository what must never be published: paths from a
// developer's machine, internal folders, a protected image and private terms
// (other projects, a personal e-mail). Private terms cannot be listed here without
// leaking them, so they come from `.git/public-denylist` (never committed) and/or
// the SMUGAN_PUBLIC_DENYLIST variable (a CI secret): one literal term per line, `#`
// starts a comment. Output names only file:line or commit — CI logs of a public
// repository are public too, so neither a term nor the matched text is printed.
//
//   node scripts/public-guard.mjs                     file names and contents in the index
//   node scripts/public-guard.mjs --ident --message F  + identity and commit message (commit-msg hook)
//   node scripts/public-guard.mjs --commits A..B       + every patch, path, blob, author and message in those commits (CI)
//   --ref R                                           + the pushed branch or tag name (pre-push, CI)
//   --require-denylist                                fail when no private term was loaded
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_DIRS = ['docs/plans/', 'video/'];
// By content, so a renamed copy is caught too.
const FORBIDDEN_BLOBS = new Map([['9700c84307866401e503cc3df0fbd30ad1cbc61c', 'copyrighted illustration']]);

// Each is a POSIX ERE for git grep and, unchanged, a JS RegExp (flag i).
/** @type {Array<{ label: string, source: string, literal: boolean }>} */
const MACHINE_PATTERNS = [
  { label: 'Windows user folder', source: '([a-z]:|(^|[^a-z0-9.]|/mnt)/[a-z])[\\\\/]+users[\\\\/]+[a-z0-9._-]+', literal: false },
  { label: 'Unix/macOS home folder', source: '/(home|users)/[a-z0-9._-]+', literal: false },
  { label: 'local checkout on disk', source: '(^|[^a-z0-9.]|/mnt)([a-z]:|/[a-z])[\\\\/]+dev([^a-z0-9._-]|$)', literal: false },
];

/** @param {string[]} args */
function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', '-c', 'log.showRoot=true', ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

/** @param {string[]} args */
function gitOut(args) {
  const r = git(args);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
  return r.stdout;
}

function loadDenylist() {
  const sources = [process.env.SMUGAN_PUBLIC_DENYLIST ?? ''];
  // The common dir, so a linked worktree reads the same list as the main checkout.
  const file = join(gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), 'public-denylist');
  if (existsSync(file)) sources.push(readFileSync(file, 'utf8'));
  const terms = sources.join('\n').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return terms.map((source, i) => ({ label: `private list term #${i + 1}`, source, literal: true }));
}

/** @param {{ source: string, literal: boolean }} p */
const toRegExp = (p) => new RegExp(p.literal ? p.source.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : p.source, 'i');

/** A path that matched a pattern is shown with the match masked. @param {string} path @param {typeof MACHINE_PATTERNS} patterns */
const redact = (path, patterns) => patterns.reduce((acc, p) => acc.replace(new RegExp(toRegExp(p).source, 'gi'), '***'), path);

/** @param {string} path */
const forbiddenDir = (path) => FORBIDDEN_DIRS.some((d) => path.toLowerCase().startsWith(d));

/** @param {typeof MACHINE_PATTERNS} patterns @param {string[]} out */
function scanIndex(patterns, out) {
  for (const line of gitOut(['ls-files', '--cached', '-s']).split('\n').filter(Boolean)) {
    const [meta, path] = line.split('\t');
    const blob = meta.split(' ')[1];
    if (forbiddenDir(path)) out.push(`${redact(path, patterns)} — internal folder must not be versioned`);
    if (FORBIDDEN_BLOBS.has(blob)) out.push(`${redact(path, patterns)} — ${FORBIDDEN_BLOBS.get(blob)}`);
    for (const p of patterns) if (toRegExp(p).test(path)) out.push(`${redact(path, patterns)} (file name) — ${p.label}`);
  }
  for (const p of patterns) {
    // -a: a file marked binary (-diff, NUL byte) can still carry a term.
    const r = git(['grep', '--cached', '-a', '-n', '-i', p.literal ? '-F' : '-E', '-e', p.source]);
    if (r.status === 1) continue;
    // stderr of a failing grep quotes the pattern, which may be a private term.
    if (r.status !== 0) throw new Error(`git grep failed for ${p.label} (${r.status})`);
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const m = /^(.*?):(\d+):/.exec(line);
      out.push(`${m ? `${redact(m[1], patterns)}:${m[2]}` : '?'} — ${p.label}`);
    }
  }
}

/** @param {string} where @param {string} text @param {typeof MACHINE_PATTERNS} patterns @param {string[]} out */
function scanText(where, text, patterns, out) {
  for (const p of patterns) if (toRegExp(p).test(text)) out.push(`${where} — ${p.label}`);
}

/** @param {string} range @param {typeof MACHINE_PATTERNS} patterns @param {string[]} out */
function scanCommits(range, patterns, out) {
  // A pushed annotated tag arrives as the tag object; its message and tagger are public too.
  for (const end of range.split(/\.{2,3}/).filter(Boolean)) {
    if (gitOut(['cat-file', '-t', end]).trim() === 'tag') scanText(`tag ${end.slice(0, 20)}`, gitOut(['cat-file', 'tag', end]), patterns, out);
  }
  // One call per commit for metadata and one for the patch: file bytes (NUL, RS)
  // can never be mistaken for a separator between commits.
  for (const sha of gitOut(['rev-list', range]).split('\n').filter(Boolean)) {
    const where = `commit ${sha.slice(0, 10)}`;
    scanText(where, gitOut(['log', '-1', '--format=%an <%ae>%n%cn <%ce>%n%B', sha]), patterns, out);
    const patch = gitOut(['show', '--format=', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--diff-merges=first-parent', sha]);
    // Added lines: a term added and removed later still lives in history. Only lines
    // after a block's first hunk header are content, so "+++" text is not mistaken
    // for a file header.
    const added = [];
    for (const block of patch.split(/^(?=diff --git )/m)) {
      const lines = block.split('\n');
      const hunk = lines.findIndex((l) => l.startsWith('@@'));
      if (hunk !== -1) added.push(...lines.slice(hunk).filter((l) => l.startsWith('+')));
    }
    scanText(`${where} (diff)`, added.join('\n'), patterns, out);
    // Resulting paths from the NUL-separated name list, never parsed from patch text
    // (quoting, " b/" in names, diff.noprefix). Deletions publish nothing new.
    const names = gitOut(['show', '--format=', '-z', '--name-status', '-M', '--diff-filter=d', '--diff-merges=first-parent', sha]).split('\0');
    for (let i = 0; i < names.length - 1; ) {
      const status = names[i];
      const path = /^[RC]/.test(status) ? names[i + 2] : names[i + 1];
      i += /^[RC]/.test(status) ? 3 : 2;
      scanText(`${where} (file name)`, path, patterns, out);
      if (forbiddenDir(path)) out.push(`${where} — adds ${redact(path, patterns)} (internal folder)`);
    }
  }
  for (const line of gitOut(['rev-list', '--objects', range]).split('\n')) {
    const [hash, path = ''] = line.split(' ');
    if (FORBIDDEN_BLOBS.has(hash)) out.push(`${redact(path, patterns) || hash} in history — ${FORBIDDEN_BLOBS.get(hash)}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (/** @type {string} */ name) => argv.includes(name);
  const value = (/** @type {string} */ name) => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };

  const denylist = loadDenylist();
  if (denylist.length === 0) {
    if (flag('--require-denylist')) throw new Error('no private term loaded (SMUGAN_PUBLIC_DENYLIST or .git/public-denylist)');
    console.error('public-guard: private list empty — only the generic patterns were checked');
  }
  const patterns = [...MACHINE_PATTERNS, ...denylist];
  /** @type {string[]} */
  const problems = [];

  scanIndex(patterns, problems);
  if (flag('--ident')) {
    for (const v of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) scanText(v, gitOut(['var', v]), denylist, problems);
  }
  const message = value('--message');
  if (message) {
    // `git commit -v` appends the diff below the scissors line; a commit that removes a term must pass.
    const text = readFileSync(message, 'utf8').split(/^# -+ >8 -+$/m)[0];
    scanText('commit message', text, patterns, problems);
  }
  const ref = value('--ref');
  if (ref) scanText(`ref name ${redact(ref, patterns)}`, ref, patterns, problems);
  const range = value('--commits');
  if (range) scanCommits(range, patterns, problems);

  if (problems.length === 0) return 0;
  console.error(`public-guard: ${problems.length} problem(s) that must not reach the public repository`);
  for (const p of problems) console.error(`  ${p}`);
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`public-guard: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
