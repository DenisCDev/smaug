// @ts-check
// `smugan check [paths]` judges every file with the config found walking up
// from the file's own folder, as the hooks do, wherever the command runs from.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'smugan.mjs');
const LOG = 'export function f() {\n  console.log("left behind");\n  return 1;\n}\n';
/** @type {string[]} */
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A project with the given files. @param {Record<string, string>} files */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-check-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries({ 'package.json': '{"name":"fixture","private":true}', ...files })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

/** @param {string} cwd @param {string[]} args */
function check(cwd, ...args) {
  const run = spawnSync(process.execPath, [CLI, 'check', ...args, '--json'], { cwd, encoding: 'utf8', timeout: 30_000 });
  /** @type {{ ok: boolean, filesChecked: number, violations: { file: string, rule: string }[] }} */
  const report = JSON.parse(run.stdout);
  return { status: run.status, files: report.violations.map((v) => v.file), filesChecked: report.filesChecked };
}

test('each file is judged with the config of its own package', () => {
  const dir = project({
    'packages/a/smugan.config.json': '{ "checks": { "console-log": false } }',
    'packages/a/src/x.ts': LOG,
    'packages/b/src/y.ts': LOG,
  });
  assert.deepEqual(check(dir).files, ['packages/b/src/y.ts']);
  assert.deepEqual(check(join(dir, 'packages', 'a')).files, []);
  assert.deepEqual(check(dir, 'packages/a', 'packages/b').files, ['packages/b/src/y.ts']);
});

test('ignore globs are read from the project root, whatever path is passed', () => {
  const dir = project({
    'smugan.config.json': '{ "ignore": ["apps/web/generated/**", "generated/**"] }',
    'apps/web/generated/g.ts': LOG,
    'apps/web/src/page.ts': LOG,
    'src/generated/h.ts': LOG,
  });
  assert.deepEqual(check(dir).files, ['apps/web/src/page.ts', 'src/generated/h.ts']);
  assert.deepEqual(check(dir, 'apps/web').files, ['apps/web/src/page.ts'], 'the ignored folder stays ignored');
  assert.deepEqual(check(dir, 'src').files, ['src/generated/h.ts'], '"generated/**" is anchored at the root, not at the path passed');
  assert.deepEqual(check(dir, 'apps/web/generated/g.ts').files, [], 'an ignored file named on its own is still ignored');
});

test('folders never analyzed stay out when named, and a named file is checked from anywhere', () => {
  const dir = project({ 'dist/out.js': LOG, 'src/a.ts': LOG });
  const dist = check(dir, 'dist');
  assert.deepEqual([dist.status, dist.filesChecked], [0, 0]);
  const elsewhere = mkdtempSync(join(tmpdir(), 'smugan-check-cwd-'));
  dirs.push(elsewhere);
  const named = check(elsewhere, join(dir, 'src', 'a.ts'));
  assert.equal(named.status, 1);
  assert.equal(named.filesChecked, 1);
  assert.match(named.files[0], /src\/a\.ts$/);
});

// On Windows a path on another drive has no relative form, and it was silently skipped as clean.
const otherDrive = process.platform === 'win32' && parse(tmpdir()).root.toLowerCase() !== parse(CLI).root.toLowerCase();
test('a path on another drive is checked, not skipped as clean', { skip: !otherDrive && 'needs two drives' }, () => {
  const dir = project({ 'src/a.ts': LOG });
  const result = check(dirname(CLI), join(dir, 'src', 'a.ts'));
  assert.equal(result.status, 1);
  assert.equal(result.filesChecked, 1);
});

test('with no config, .git or package.json anywhere, the folder the command runs from is the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-check-bare-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(join(dir, 'supabase', 'migrations', '0001_init.sql'), 'create table orders (\n  id uuid primary key\n);\n');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'seed.ts'), LOG);
  const whole = check(dir);
  const part = check(dir, 'supabase');
  assert.equal(whole.status, 1);
  assert.deepEqual(part.files, whole.files, 'the same findings whether the folder is named or not');
  assert.deepEqual(check(dir, 'scripts/seed.ts').files, [], 'scripts/ keeps its place in the path the rules read');
});

test('dependency folders of other stacks are never analyzed', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const dir = project({
    '.venv/Lib/site-packages/pkg/fixture.py': `KEY = "${key}"\n`,
    // What Composer installs, with the autoloader that marks the folder as its own.
    'vendor/autoload.php': '<?php\n',
    'vendor/aws/sdk/Example.php': `<?php\n$key = "${key}";\n`,
    'services/api/vendor/modules.txt': '# example.com/pkg v1.0.0\n',
    'services/api/vendor/example.com/pkg/fixture.go': `const key = "${key}"\n`,
    '.terraform/modules/vpc/examples/main.tf': `access_key = "${key}"\n`,
    'app/settings.py': `KEY = "${key}"\n`,
  });
  assert.deepEqual(check(dir).files, ['app/settings.py']);
});

test('a folder named vendor that no package manager made is the project\'s own code', () => {
  const dir = project({ 'src/modules/vendor/vendor.service.ts': LOG, 'app/api/vendor/route.ts': LOG });
  assert.deepEqual(check(dir).files, ['app/api/vendor/route.ts', 'src/modules/vendor/vendor.service.ts']);
  assert.deepEqual(check(dir, 'src/modules/vendor').files, ['src/modules/vendor/vendor.service.ts']);
});

test('a vendor folder with a child named bundle is still the project\'s own code', () => {
  const dir = project({ 'app/vendor/page.tsx': LOG, 'app/vendor/bundle/page.tsx': LOG });
  assert.deepEqual(check(dir).files, ['app/vendor/bundle/page.tsx', 'app/vendor/page.tsx']);
  const gems = project({ 'vendor/bundle/ruby/3.3.0/gems/aws/fixture.rb': 'KEY = "AKIA' + 'ABCDEFGHIJKLMNOP"\n', 'app/models/user.rb': '# ok\n' });
  assert.deepEqual(check(gems).files, []);
});
