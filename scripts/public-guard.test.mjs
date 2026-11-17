// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./public-guard.mjs', import.meta.url));
// Built at runtime so this file never contains what the guard rejects.
const WIN_HOME = ['C:', 'Users', 'alice', 'proj'].join('\\');
const SECRET_TERM = ['acme', 'internal'].join('-');

/** @param {string} dir @param {string[]} args */
const git = (dir, args) => {
  const r = spawnSync('git', ['-c', 'core.hooksPath=.no-hooks', '-c', 'core.protectNTFS=false', '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
};

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'public-guard-'));
  git(dir, ['init', '-q']);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, ['add', '-A']);
  return dir;
}

/** @param {string} dir @param {string[]} args @param {string} [denylist] */
function guard(dir, args = [], denylist = '') {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', timeout: 30_000, env: { ...process.env, SMUGAN_PUBLIC_DENYLIST: denylist } });
  return { code: r.status, err: r.stderr };
}

test('a clean index passes', (t) => {
  const dir = repo({ 'src/a.mjs': 'export const x = 1;\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(guard(dir, [], SECRET_TERM).code, 0);
});

test('machine paths, private terms and internal folders fail with file:line but never the matched text', (t) => {
  const dir = repo({
    'README.md': `ok\nsee ${WIN_HOME}\n`,
    'src/a.mjs': `// from the ${SECRET_TERM} app\n`,
    'docs/plans/x.md': 'plan\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { code, err } = guard(dir, [], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /README\.md:2 — Windows user folder/);
  assert.match(err, /src\/a\.mjs:1 — private list term #1/);
  assert.match(err, /docs\/plans\/x\.md — internal folder/);
  assert.doesNotMatch(err, new RegExp(SECRET_TERM));
  assert.doesNotMatch(err, /alice/);
});

test('commit messages and authors in a range are checked', (t) => {
  const dir = repo({ 'a.txt': 'a\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['commit', '-q', '-m', `fix: port from ${SECRET_TERM}`]);
  const { code, err } = guard(dir, ['--commits', 'HEAD'], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /commit [0-9a-f]{10} — private list term #1/);
});

test('a term added and removed again in the pushed range is still caught in history', (t) => {
  const dir = repo({ 'leak.txt': `from ${SECRET_TERM} app\n` });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['commit', '-q', '-m', 'add']);
  git(dir, ['rm', '-q', 'leak.txt']);
  git(dir, ['commit', '-q', '-m', 'remove']);
  const { code, err } = guard(dir, ['--commits', 'HEAD'], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /commit [0-9a-f]{10} \(diff\) — private list term #1/);
});

test('file names, Git Bash paths, case variants and regex-looking terms are caught literally', (t) => {
  const term = `${SECRET_TERM}(x`;
  const dir = repo({
    [`notes/${SECRET_TERM}.md`]: 'hi\n',
    'p.txt': `cd ${['', 'd', 'dev', 'proj'].join('/')}\ncd ${['', 'home', 'bob'].join('/')}\n${term}\n`,
    'Docs/Plans/a.md': 'x\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { code, err } = guard(dir, [], `${SECRET_TERM}\n${term}`);
  assert.equal(code, 1);
  assert.match(err, /notes\/.*\(file name\) — private list term #1/);
  assert.match(err, /p\.txt:1 — local checkout/);
  assert.match(err, /p\.txt:2 — Unix\/macOS home folder/);
  assert.match(err, /p\.txt:3 — private list term #2/);
  assert.match(err, /Docs\/Plans\/a\.md — internal folder/);
  assert.doesNotMatch(err, new RegExp(SECRET_TERM));
});

test('binary-marked files, merge resolutions, WSL paths and linked worktrees are covered', (t) => {
  const dir = repo({ '.gitattributes': '*.lock -diff\n', 'x.lock': `path ${SECRET_TERM}\n`, 'q.txt': `x ${['', 'mnt', 'd', 'dev', 'p'].join('/')}\ny "D:${'\\'}dev" z\n`, f: 'base\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let r = guard(dir, [], SECRET_TERM);
  assert.match(r.err, /x\.lock:1 — private list term #1/);
  assert.match(r.err, /q\.txt:1 — local checkout/);
  assert.match(r.err, /q\.txt:2 — local checkout/);

  git(dir, ['rm', '-q', '-f', 'x.lock', 'q.txt']);
  git(dir, ['commit', '-q', '-m', 'base']);
  git(dir, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(dir, 'f'), 'side\n');
  git(dir, ['commit', '-q', '-am', 'side']);
  git(dir, ['checkout', '-q', '-']);
  writeFileSync(join(dir, 'f'), 'main\n');
  git(dir, ['commit', '-q', '-am', 'main']);
  spawnSync('git', ['merge', '-q', 'side'], { cwd: dir, timeout: 30_000 });
  writeFileSync(join(dir, 'f'), `${SECRET_TERM}\n`);
  git(dir, ['commit', '-q', '-am', 'merge']);
  writeFileSync(join(dir, 'f'), 'z\n');
  git(dir, ['commit', '-q', '-am', 'clean']);
  r = guard(dir, ['--commits', 'HEAD'], SECRET_TERM);
  assert.equal(r.code, 1);
  assert.match(r.err, /\(diff\) — private list term #1/);

  writeFileSync(join(dir, '.git', 'public-denylist'), `${SECRET_TERM}\n`);
  const wt = `${dir}-wt`;
  t.after(() => rmSync(wt, { recursive: true, force: true }));
  git(dir, ['worktree', 'add', '-q', wt]);
  writeFileSync(join(wt, 'leak.txt'), `${SECRET_TERM}\n`);
  git(wt, ['add', 'leak.txt']);
  r = guard(wt);
  assert.match(r.err, /leak\.txt:1 — private list term #1/);
});

test('NUL and RS bytes in a file cannot hide a term from the history scan', (t) => {
  const dir = repo({ 'zero.bin': `a\0b\nfrom ${SECRET_TERM} app\n`, 'rs.txt': `x\x1efrom ${SECRET_TERM} app\n` });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['commit', '-q', '-m', 'add']);
  git(dir, ['rm', '-q', 'zero.bin', 'rs.txt']);
  git(dir, ['commit', '-q', '-m', 'remove']);
  const { code, err } = guard(dir, ['--commits', 'HEAD'], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /\(diff\) — private list term #1/);
});

test('an annotated tag message is checked when the tag is what gets pushed', (t) => {
  const dir = repo({ 'a.txt': 'a\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['commit', '-q', '-m', 'init']);
  git(dir, ['tag', '-a', 'v1', '-m', `release from ${SECRET_TERM}`]);
  const { code, err } = guard(dir, ['--commits', 'refs/tags/v1'], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /tag refs\/tags\/v1 — private list term #1/);
});

test('a branch or lightweight tag name with a private term is refused, masked', (t) => {
  const dir = repo({ 'a.txt': 'a\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { code, err } = guard(dir, ['--ref', `refs/heads/feature-${SECRET_TERM}`], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /ref name refs\/heads\/feature-\*\*\* — private list term #1/);
  assert.doesNotMatch(err, new RegExp(SECRET_TERM));
});

test('a commit that deletes or moves files out of an internal folder passes, adding one fails', (t) => {
  const dir = repo({ 'docs/plans/old.md': 'x\n', 'docs/plans/keep.md': 'y\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['commit', '-q', '-m', 'base']);
  git(dir, ['rm', '-q', 'docs/plans/old.md']);
  git(dir, ['mv', 'docs/plans/keep.md', 'docs/keep.md']);
  git(dir, ['commit', '-q', '-m', 'cleanup']);
  assert.equal(guard(dir, ['--commits', 'HEAD~1..HEAD'], SECRET_TERM).code, 0);
  const { code, err } = guard(dir, ['--commits', 'HEAD~1'], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /adds docs\/plans\/old\.md \(internal folder\)/);
});

test('quoted names, " b/" names and "++" content added then deleted are still caught', (t) => {
  const dir = repo({ 'a.txt': `++ ${SECRET_TERM}\n` });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Names Windows refuses on disk go straight into the index.
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'hi\n', encoding: 'utf8', timeout: 30_000 }).stdout.trim();
  for (const name of ['docs/plans/a"b.md', 'docs/plans/x b/y.md']) git(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`]);
  git(dir, ['commit', '-q', '-m', 'add']);
  git(dir, ['rm', '-q', '--cached', 'a.txt', 'docs/plans/a"b.md', 'docs/plans/x b/y.md']);
  git(dir, ['commit', '-q', '-m', 'remove']);
  const { code, err } = guard(dir, ['--commits', 'HEAD'], SECRET_TERM);
  assert.equal(code, 1);
  assert.match(err, /adds docs\/plans\/a"b\.md/);
  assert.match(err, /adds docs\/plans\/x b\/y\.md/);
  assert.match(err, /\(diff\) — private list term #1/);
});

test('--require-denylist fails loud when no private term is configured', (t) => {
  const dir = repo({ 'a.txt': 'a\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(guard(dir, ['--require-denylist']).code, 2);
});
