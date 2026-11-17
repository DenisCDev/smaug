// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitHead, ownFileErrors, parseEslintMessages, parseTscMessages } from '../src/hook.mjs';

// --- parseEslintMessages -----------------------------------------------------

test('parseEslintMessages: flattens messages with rule + message identity', () => {
  const json = JSON.stringify([
    {
      filePath: '/x/a.ts',
      messages: [
        { ruleId: 'no-unused-vars', message: "'x' is defined but never used.", line: 3, severity: 2 },
        { ruleId: 'import/order', message: 'wrong order', line: 1, severity: 2 },
      ],
    },
  ]);
  const out = parseEslintMessages(json);
  assert.equal(out?.length, 2);
  assert.equal(out?.[0].rule, 'no-unused-vars');
  assert.match(out?.[0].message ?? '', /never used/);
  assert.equal(out?.[1].rule, 'import/order');
});

test('parseEslintMessages: clean file and empty output yield no messages', () => {
  assert.deepEqual(parseEslintMessages('[{"messages":[]}]'), []);
  assert.deepEqual(parseEslintMessages(''), []);
});

test('parseEslintMessages: syntax errors get a stable rule; noise before JSON is tolerated', () => {
  const noisy = 'ESLintIgnoreWarning: whatever\n[{"messages":[{"message":"Parsing error","line":1}]}]';
  const out = parseEslintMessages(noisy);
  assert.equal(out?.length, 1);
  assert.equal(out?.[0].rule, 'syntax');
});

test('parseEslintMessages: unparseable output returns null (caller fails open)', () => {
  assert.equal(parseEslintMessages('command failed: eslint crashed'), null);
});

test('parseEslintMessages: warnings never gate — only errors and fatal parses', () => {
  const json = JSON.stringify([
    {
      filePath: '/x/a.ts',
      messages: [
        { ruleId: 'no-unused-vars', message: 'unused', line: 3, severity: 1 },
        { ruleId: 'no-undef', message: "'y' is not defined.", line: 4, severity: 2 },
        { message: 'Parsing error: unexpected token', line: 1 }, // fatal: no severity
      ],
    },
  ]);
  const out = parseEslintMessages(json);
  assert.equal(out?.length, 2, 'the severity-1 warning is dropped');
  assert.equal(out?.[0].rule, 'no-undef');
  assert.equal(out?.[1].rule, 'syntax');
});

// --- parseTscMessages --------------------------------------------------------

test('parseTscMessages: extracts TS code + message, position kept only for display', () => {
  const out = parseTscMessages(
    "src/a.ts(5,3): error TS6133: 'x' is declared but its value is never read.\n" +
      'src/a.ts(9,1): error TS2345: Argument of type A is not assignable to B.\n' +
      'Found 2 errors.\n',
  );
  assert.equal(out?.length, 2);
  assert.equal(out?.[0].rule, 'TS6133');
  assert.equal(out?.[1].rule, 'TS2345');
});

test('parseTscMessages: keeps the reported path so closure errors can be dropped', () => {
  // Regression (production app, ago/2026): errors from an imported file were relayed
  // under the edited file's name at impossible line numbers ("line 616" in a
  // 50-line test) because the path was thrown away at parse time.
  const out = parseTscMessages(
    'src/components/file-content-renderer.tsx(616,5): error TS7016: Could not find a declaration file.\n' +
      "src/edited.test.ts(12,1): error TS2304: Cannot find name 'x'.\n",
  );
  assert.equal(out?.length, 2);
  assert.equal(out?.[0].file, 'src/components/file-content-renderer.tsx');
  assert.equal(out?.[1].file, 'src/edited.test.ts');
});

test('parseTscMessages: errors that name the temp tsconfig fail open (null)', () => {
  assert.equal(
    parseTscMessages(".smugan-tsc-1234-0.json(1,1): error TS5083: Cannot read file."),
    null,
  );
});

test('parseTscMessages: no errors yields an empty list', () => {
  assert.deepEqual(parseTscMessages(''), []);
  assert.deepEqual(parseTscMessages('Found 0 errors.'), []);
});

// --- ownFileErrors (closure-error attribution) -------------------------------

const V = (/** @type {string} */ file) => ({ file, severity: 'error', rule: 'TS7016', message: 'm', line: 616 });
const TSC_ROOT = join(tmpdir(), 'smugan-tsc-project');
const TSC_TARGET = join(TSC_ROOT, 'src', 'edited.test.ts');

test('ownFileErrors: drops errors reported in OTHER files of the compile closure', () => {
  const out = ownFileErrors(
    [V('src/components/renderer.tsx'), V('src/edited.test.ts')],
    TSC_ROOT,
    TSC_TARGET,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].file, '', 'file is blanked — diff identity stays rule+message');
});

test('ownFileErrors: path comparison survives separator drift and Windows case drift', () => {
  const reported = process.platform === 'win32' ? 'SRC\\Edited.test.ts' : 'src\\edited.test.ts';
  const base = process.platform === 'win32' ? TSC_ROOT.toUpperCase() : TSC_ROOT;
  const out = ownFileErrors([V(reported)], base, TSC_TARGET);
  assert.equal(out.length, 1, 'case-insensitive, backslash-normalized match');
});

test('ownFileErrors: an absolute reported path still matches the target', () => {
  const out = ownFileErrors([V(TSC_TARGET)], TSC_ROOT, TSC_TARGET);
  assert.equal(out.length, 1);
});

test('ownFileErrors: entries without a path are kept (defensive)', () => {
  const out = ownFileErrors([V('')], TSC_ROOT, TSC_TARGET);
  assert.equal(out.length, 1);
});

// --- gitHead (the baseline source) ------------------------------------------

/** @returns {{ dir: string, git: (args: string[]) => void }} */
function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-git-'));
  const git = (/** @type {string[]} */ args) =>
    void execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 'Test']);
  return { dir, git };
}

test('gitHead: returns the COMMITTED content, not the dirty working tree', () => {
  const { dir, git } = makeGitRepo();
  try {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    git(['add', 'a.ts']);
    git(['commit', '-q', '-m', 'init']);
    // Dirty the working tree — baseline must still reflect HEAD.
    writeFileSync(file, 'export const x = 1;\nexport const y = 2;\n');
    const head = gitHead(file);
    assert.ok(head, 'expected a HEAD baseline');
    assert.equal(head?.content, 'export const x = 1;\n');
    assert.match(head?.sha ?? '', /^[0-9a-f]{7,64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitHead: untracked file has no baseline (null → full check for new code)', () => {
  const { dir } = makeGitRepo();
  try {
    const file = join(dir, 'fresh.ts');
    writeFileSync(file, 'export const z = 3;\n');
    assert.equal(gitHead(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
