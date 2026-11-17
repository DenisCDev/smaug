// @ts-check
// Files a shell command writes reach the end of the turn through the
// repository: the turn's first shell command records what git listed as
// changed, and Stop checks what changed since.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runHook } from '../src/hook.mjs';

const RUN = randomUUID().slice(0, 8);
/** @type {string[]} */
const sessions = [];
let counter = 0;
const session = () => {
  const id = `shellwrites${RUN}n${++counter}`;
  sessions.push(id);
  return id;
};
after(() => {
  for (const id of sessions) {
    for (const prefix of ['smugan-turn-', 'smugan-stopdebt-', 'smugan-report-', 'smugan-events-', 'smugan-session-']) {
      rmSync(join(tmpdir(), prefix + id + '.json'), { force: true });
    }
  }
});

/** @param {string} dir @param {string[]} args @param {string} [date] author and commit date, for a commit made before the turn */
const git = (dir, args, date) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@test', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], {
  stdio: 'ignore', timeout: 30_000, env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
});

/** A committed project with the given files. @param {Record<string, string>} files @param {(dir: string) => Promise<void>} body */
async function withRepo(files, body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-shell-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
    mkdirSync(join(dir, 'src'));
    for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
    git(dir, ['init', '-q']);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'seed']);
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/** @param {string} id @param {string} dir */
const shellCommand = (id, dir) => runHook('bash', { tool_name: 'Bash', session_id: id, cwd: dir, tool_input: { command: 'node scripts/generate.mjs' } });

test('a file a shell command writes is checked at the end of the turn', async () => {
  await withRepo({ 'src/ok.ts': 'export const ok = 1;\n' }, async (dir) => {
    const id = session();
    assert.equal((await shellCommand(id, dir)).exitCode, 0);
    writeFileSync(join(dir, 'src', 'generated.ts'), 'console.log("written by the shell");\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /src\/generated\.ts:1 +\[console-log\].*changed outside Write\/Edit during this turn/);
  });
});

test('a file a shell command writes and the turn then commits is still checked', async () => {
  await withRepo({ 'src/ok.ts': 'export const ok = 1;\n' }, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    writeFileSync(join(dir, 'src', 'generated.ts'), 'console.log("written by the shell");\nexport const g = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'wip']);
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /src\/generated\.ts:1 +\[console-log\]/);
  });
});

test('a merge or checkout during the turn does not check what other commits brought', async () => {
  for (const move of [['merge', '-q', '--ff-only', 'other'], ['checkout', '-q', 'other']]) {
    await withRepo({ 'src/x.ts': 'export const x = 1;\n' }, async (dir) => {
      // A teammate's commit on another branch, there before the turn.
      git(dir, ['checkout', '-q', '-b', 'other']);
      appendFileSync(join(dir, 'src', 'x.ts'), 'console.log("teammate");\n');
      git(dir, ['commit', '-q', '-am', 'teammate change']);
      git(dir, ['checkout', '-q', '-']);
      const id = session();
      await shellCommand(id, dir);
      git(dir, move);
      assert.equal((await runHook('stop', { session_id: id })).exitCode, 0, move.join(' '));
    });
  }
});

test('a pull from a remote does not check the commits it brings, from before the turn or during it', async () => {
  await withRepo({ 'src/x.ts': 'export const x = 1;\n', 'src/y.ts': 'export const y = 1;\n' }, async (origin) => {
    const clone = mkdtempSync(join(tmpdir(), 'smugan-shell-clone-'));
    try {
      git(clone, ['clone', '-q', origin, '.']);
      appendFileSync(join(origin, 'src', 'x.ts'), 'console.log("teammate, before the turn");\n');
      git(origin, ['commit', '-q', '-am', 'teammate change'], '2020-01-01T00:00:00Z');
      const id = session();
      await shellCommand(id, clone);
      // Pushed while the agent works, then pulled.
      appendFileSync(join(origin, 'src', 'y.ts'), 'console.log("teammate, during the turn");\n');
      git(origin, ['commit', '-q', '-am', 'teammate change during the turn']);
      git(clone, ['pull', '-q', '--ff-only']);
      assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
    } finally {
      rmSync(clone, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});

test("what a pull --rebase brings to a file the turn committed is not the turn's", async () => {
  await withRepo({ 'src/x.ts': 'export const x = 1;\n' }, async (origin) => {
    const clone = mkdtempSync(join(tmpdir(), 'smugan-shell-clone-'));
    try {
      git(clone, ['clone', '-q', origin, '.']);
      const id = session();
      await shellCommand(id, clone);
      writeFileSync(join(clone, 'src', 'x.ts'), 'export const fromTheTurn = 1;\nexport const x = 1;\n');
      git(clone, ['commit', '-q', '-am', 'turn change']);
      // The push is rejected: a teammate changed the same file meanwhile.
      appendFileSync(join(origin, 'src', 'x.ts'), 'console.log("teammate");\n');
      git(origin, ['commit', '-q', '-am', 'teammate change']);
      git(clone, ['pull', '-q', '--rebase']);
      assert.match(readFileSync(join(clone, 'src', 'x.ts'), 'utf8'), /teammate/);
      assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
    } finally {
      rmSync(clone, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});

test('an amend made in the turn counts for what it adds, not for the commit it replaces', async () => {
  await withRepo({}, async (dir) => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'console.log("committed before the turn");\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'work in progress']);
    const id = session();
    await shellCommand(id, dir);
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--amend', '--no-edit']);
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0, 'a.ts came with the replaced commit');

    const next = session();
    await shellCommand(next, dir);
    appendFileSync(join(dir, 'src', 'b.ts'), 'console.log("amended in this turn");\n');
    git(dir, ['commit', '-q', '-a', '--amend', '--no-edit']);
    const result = await runHook('stop', { session_id: next });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /src\/b\.ts:2 +\[console-log\]/);
    assert.doesNotMatch(result.stderr, /a\.ts/);
  });
});

test('too many changed files: the skip is recorded once and the end of the turn says so', async () => {
  await withRepo({}, async (dir) => {
    mkdirSync(join(dir, 'gen'));
    for (let i = 0; i <= 2000; i++) writeFileSync(join(dir, 'gen', `f${i}.txt`), '');
    const id = session();
    await shellCommand(id, dir);
    const marker = join(tmpdir(), 'smugan-turn-' + id + '.json');
    const [snapshot] = Object.values(JSON.parse(readFileSync(marker, 'utf8')).shells);
    assert.match(snapshot.skipped, /more than 2000 files/);
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /what shell commands changed was not checked/);
  });
});

test('debt a file carried before the turn is not blamed on the shell command, and an unchanged dirty file is not checked', async () => {
  await withRepo({ 'src/legacy.ts': 'export const a = 1;\n', 'src/other.ts': 'export const o = 1;\n' }, async (dir) => {
    // Uncommitted work from before the turn, each with a console.log.
    appendFileSync(join(dir, 'src', 'legacy.ts'), 'console.log("before the turn");\n');
    appendFileSync(join(dir, 'src', 'other.ts'), 'console.log("before the turn");\n');
    const id = session();
    await shellCommand(id, dir);
    appendFileSync(join(dir, 'src', 'legacy.ts'), 'export const b = 2;\n');
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0, 'the console.log was there before the turn');

    const next = session();
    await shellCommand(next, dir);
    appendFileSync(join(dir, 'src', 'legacy.ts'), 'console.log("this turn");\n');
    const result = await runHook('stop', { session_id: next });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /src\/legacy\.ts:4 +\[console-log\]/);
    assert.doesNotMatch(result.stderr, /other\.ts/);
  });
});

test('a file that still matched HEAD when the shell ran keeps HEAD as its baseline after an edit', async () => {
  await withRepo({ 'src/c.ts': 'export const c = 1;\n' }, async (dir) => {
    const id = session();
    const file = join(dir, 'src', 'c.ts');
    await shellCommand(id, dir);
    writeFileSync(file, 'console.log("from the shell");\nexport const c = 1;\n');
    // The edit's first touch happens after the shell write and records it as the start.
    await runHook('pre', { tool_name: 'Edit', session_id: id, tool_input: { file_path: file, old_string: 'export const c = 1;', new_string: 'export const c = 2;' } });
    writeFileSync(file, 'console.log("from the shell");\nexport const c = 2;\n');
    await runHook('post', { tool_name: 'Edit', session_id: id, tool_input: { file_path: file } });
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /src\/c\.ts:1 +\[console-log\]/);
  });
});

test('a test weakened before the turn is not blamed when a shell command touches it', async () => {
  const strong = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('adds', () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(add(2, 2), 4);\n});\n";
  await withRepo({ 'src/add.test.mjs': strong, 'src/add.mjs': 'export const add = (a, b) => a + b;\n' }, async (dir) => {
    const testFile = join(dir, 'src', 'add.test.mjs');
    // Uncommitted before the turn: one assertion already gone.
    writeFileSync(testFile, strong.replace('  assert.equal(add(2, 2), 4);\n', ''));
    const id = session();
    await shellCommand(id, dir);
    appendFileSync(testFile, '// reformatted\n');
    appendFileSync(join(dir, 'src', 'add.mjs'), 'export const sub = (a, b) => a - b;\n');
    const result = await runHook('stop', { session_id: id });
    assert.doesNotMatch(result.stderr, /assertion-weakening/);
    assert.equal(result.exitCode, 0);
  });
});

test('hook.stop.shell false leaves the files shell commands change out', async () => {
  await withRepo({ 'smugan.config.json': JSON.stringify({ hook: { stop: { shell: false } } }) }, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    writeFileSync(join(dir, 'src', 'generated.ts'), 'console.log("written by the shell");\n');
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
  });
});

const CART_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('adds items', () => {\n  assert.equal(total([1, 2]), 3);\n});\n";
const CART_FILES = { 'src/cart.mjs': 'export const total = (items) => items.length;\n', 'src/cart.test.mjs': CART_TEST };
const DELETED_RE = /src\/cart\.test\.mjs {2}\[assertion-weakening\] {2}test file deleted this turn while production code changed, with 1 test that asserted behavior: "adds items"/;

test('a test file a shell command deletes while production changes is listed at the end of the turn', async () => {
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    rmSync(join(dir, 'src', 'cart.test.mjs'));
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, DELETED_RE);
  });
});

test('a test file the turn removes in a commit of its own is listed too', async () => {
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    git(dir, ['rm', '-q', 'src/cart.test.mjs']);
    git(dir, ['commit', '-q', '-am', 'drop the cart test']);
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, DELETED_RE);
  });
});

test('a test file deleted before the turn, moved by the turn, or deleted in a tests-only turn is not listed', async () => {
  await withRepo(CART_FILES, async (dir) => {
    rmSync(join(dir, 'src', 'cart.test.mjs'));
    const id = session();
    await shellCommand(id, dir);
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 0, `deleted before the turn: ${result.stderr}`);
  });
  for (const move of ['git', 'plain']) {
    await withRepo(CART_FILES, async (dir) => {
      const id = session();
      await shellCommand(id, dir);
      if (move === 'git') git(dir, ['mv', 'src/cart.test.mjs', 'src/basket.test.mjs']);
      else {
        writeFileSync(join(dir, 'src', 'basket.test.mjs'), CART_TEST);
        rmSync(join(dir, 'src', 'cart.test.mjs'));
      }
      appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
      const result = await runHook('stop', { session_id: id });
      assert.equal(result.exitCode, 0, `${move} move: ${result.stderr}`);
    });
  }
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    rmSync(join(dir, 'src', 'cart.test.mjs'));
    writeFileSync(join(dir, 'src', 'other.test.mjs'), CART_TEST.replace('adds items', 'adds other items'));
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 0, `tests-only turn: ${result.stderr}`);
  });
});

test('a test file deleted with its module, in a turn that rewrote the importer, is listed once: the agent says the feature went', async () => {
  await withRepo({ ...CART_FILES, 'src/app.mjs': "import { total } from './cart.mjs';\nexport const run = () => total([]);\n" }, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    rmSync(join(dir, 'src', 'cart.test.mjs'));
    rmSync(join(dir, 'src', 'cart.mjs'));
    writeFileSync(join(dir, 'src', 'app.mjs'), 'export const run = () => 0;\n');
    const held = await runHook('stop', { session_id: id });
    assert.equal(held.exitCode, 2);
    assert.match(held.stderr, DELETED_RE);
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0, 'listed once, never insisted on');
  });
});

test('a test deleted or renamed before the turn is not the turn\'s, also when the turn commits it', async () => {
  for (const before of ['rm', 'git mv']) {
    await withRepo(CART_FILES, async (dir) => {
      if (before === 'rm') rmSync(join(dir, 'src', 'cart.test.mjs'));
      else git(dir, ['mv', 'src/cart.test.mjs', 'src/cart.test.mjs.bak']);
      appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
      const id = session();
      await shellCommand(id, dir);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'drop the cart test']);
      const result = await runHook('stop', { session_id: id });
      assert.equal(result.exitCode, 0, `${before}: ${result.stderr}`);
    });
  }
});

test('a test file only untracked by the turn, still on disk, is not a deleted test', async () => {
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    git(dir, ['rm', '-q', '--cached', 'src/cart.test.mjs']);
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.doesNotMatch(result.stderr, /test file deleted/);
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('a test the turn itself wrote is not pre-existing because a later command saw it', async () => {
  // Written, run and deleted: a scratch test of the turn.
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    const scratch = join(dir, 'src', 'repro.test.mjs');
    await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: scratch, content: CART_TEST } });
    writeFileSync(scratch, CART_TEST);
    await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: scratch } });
    await shellCommand(id, dir);
    rmSync(scratch);
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 0, result.stderr);
  });
  // Written with two tests, run, then trimmed to one by the same turn.
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    const fresh = join(dir, 'src', 'count.test.mjs');
    const two = CART_TEST + "test('counts items', () => {\n  assert.equal(count([1, 2]), 2);\n});\n";
    await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: fresh, content: two } });
    writeFileSync(fresh, two);
    await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: fresh } });
    await shellCommand(id, dir);
    writeFileSync(fresh, CART_TEST.replace('adds items', 'counts every item'));
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.doesNotMatch(result.stderr, /assertion-weakening/, result.stderr);
  });
});

test('a test renamed out of the suite is a removed test, and one renamed to another test file is not', async () => {
  await withRepo(CART_FILES, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    git(dir, ['mv', 'src/cart.test.mjs', 'src/cart.test.mjs.bak']);
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, DELETED_RE);
  });
});

test('a title another touched test file always had does not hide a removal, nor does an unrelated deleted module', async () => {
  const other = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('adds items', () => {\n  assert.equal(sum([1, 2]), 3);\n});\n";
  await withRepo({ ...CART_FILES, 'src/order.test.mjs': other }, async (dir) => {
    const id = session();
    await shellCommand(id, dir);
    rmSync(join(dir, 'src', 'cart.test.mjs'));
    appendFileSync(join(dir, 'src', 'order.test.mjs'), '// reformatted\n');
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2, 'order.test.mjs had its own "adds items" before the turn');
    assert.match(result.stderr, DELETED_RE);
  });
  await withRepo(CART_FILES, async (dir) => {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'cart.mjs'), 'export const unrelated = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'lib']);
    const id = session();
    await shellCommand(id, dir);
    rmSync(join(dir, 'src', 'cart.test.mjs'));
    rmSync(join(dir, 'lib', 'cart.mjs'));
    appendFileSync(join(dir, 'src', 'cart.mjs'), 'export const count = (items) => items.length;\n');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 2, 'src/cart.mjs, the module the test names, is still there');
    assert.match(result.stderr, DELETED_RE);
  });
});

test('a deleted test is listed whatever became of the module it names', async () => {
  for (const scenario of ['git mv', 'mv', 'moved', 'committed']) {
    await withRepo({ ...CART_FILES, 'src/app.mjs': 'export const run = () => 1;\n' }, async (dir) => {
      const id = session();
      await shellCommand(id, dir);
      if (scenario === 'git mv') git(dir, ['mv', 'src/cart.mjs', 'src/basket.mjs']);
      else if (scenario === 'mv') {
        writeFileSync(join(dir, 'src', 'basket.mjs'), CART_FILES['src/cart.mjs']);
        rmSync(join(dir, 'src', 'cart.mjs'));
      } else if (scenario === 'moved') {
        mkdirSync(join(dir, 'src', 'checkout'));
        writeFileSync(join(dir, 'src', 'checkout', 'cart.mjs'), CART_FILES['src/cart.mjs']);
        rmSync(join(dir, 'src', 'cart.mjs'));
      }
      appendFileSync(join(dir, 'src', 'app.mjs'), 'export const stop = () => 0;\n');
      if (scenario === 'committed') {
        git(dir, ['mv', 'src/cart.mjs', 'src/basket.mjs']);
        git(dir, ['rm', '-q', 'src/cart.test.mjs']);
        git(dir, ['commit', '-q', '-am', 'rename the cart module']);
      } else rmSync(join(dir, 'src', 'cart.test.mjs'));
      const result = await runHook('stop', { session_id: id });
      assert.equal(result.exitCode, 2, scenario);
      assert.match(result.stderr, DELETED_RE, scenario);
    });
  }
});
