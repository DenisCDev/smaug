// @ts-check
// The Stop report and the session log behind `smugan why`: every outcome is
// recorded with the reason, and the log never changes a hook's decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/hook.mjs';
import { hasCode } from '../src/file-state.mjs';
import { eventsPath, readJsonFile, reportPath } from '../src/session-log.mjs';
import { runWhy } from '../src/why.mjs';

let counter = 0;
const session = () => `smuganwhytest${process.pid}n${++counter}`;

/** @param {string} id @param {(dir: string) => Promise<void>} body */
async function withProject(id, body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-why-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
  mkdirSync(join(dir, 'src'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    for (const prefix of ['smugan-turn-', 'smugan-stopdebt-', 'smugan-report-', 'smugan-events-']) {
      try {
        unlinkSync(join(tmpdir(), prefix + id + '.json'));
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
    }
  }
}

/** @param {string} id @param {string} file */
const touch = (id, file) => runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: file } });
/** @param {string} id */
const report = (id) => readJsonFile(/** @type {string} */ (reportPath(id)));

test('a blocked Stop and the fixed one after it are both reported with what was checked', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    // A critical file, so the Stop after the fix runs the checks again.
    const file = join(dir, 'src', 'auth.ts');
    writeFileSync(file, 'console.log("left behind");\nexport const x = 1;\n');
    await touch(id, file);
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 2);
    const blocked = report(id);
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(blocked.attempt, 1);
    assert.deepEqual(blocked.files.map((/** @type {any} */ f) => [f.status, f.violations]), [['checked', 1]]);
    assert.match(blocked.failures[0], /\[console-log\]/);

    writeFileSync(file, 'export const x = 1;\n');
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
    assert.equal(report(id).outcome, 'passed');
  });
});

test('scripts that ran and projects that did not are reported with the reason', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(id, file);
    const prose = mkdtempSync(join(tmpdir(), 'smugan-why-prose-'));
    try {
      writeFileSync(join(prose, 'package.json'), JSON.stringify({ name: 'docs', private: true, scripts: { test: 'node -e "process.exit(1)"' } }));
      writeFileSync(join(prose, 'README.md'), '# Notas\n');
      await touch(id, join(prose, 'README.md'));
      assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
    } finally {
      rmSync(prose, { recursive: true, force: true });
    }
    const r = report(id);
    assert.deepEqual(r.scripts, [{ label: 'tests (npm test)', status: 'passed' }]);
    assert.deepEqual(r.skipped.map((/** @type {any} */ s) => s.reason), ['prose-only']);
  });
});

test('a touched file deleted before the Stop is reported as missing', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'gone.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(id, file);
    rmSync(file);
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
    assert.deepEqual(report(id).files.map((/** @type {any} */ f) => f.status), ['missing']);
  });
});

test('a pre block is logged for the session with the rules that fired', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const result = await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: join(dir, 'src', 'b.ts'), content: 'console.log(1);\n' } });
    assert.equal(result.exitCode, 2);
    const events = readJsonFile(/** @type {string} */ (eventsPath(id)));
    assert.equal(events.length, 1);
    assert.equal(events[0].hook, 'pre');
    assert.deepEqual(events[0].rules, ['console-log']);
    assert.equal(events[0].file, 'src/b.ts');
  });
});

test('smugan why explains the session in plain text and as JSON', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content: 'console.log(1);\n' } });
    writeFileSync(file, 'console.log(1);\n');
    await touch(id, file);
    await runHook('stop', { session_id: id });
    const human = runWhy(['--session', id]);
    assert.equal(human.exitCode, 0);
    assert.match(human.output, /turn held: the Definition of Done failed \(attempt 1 of 1\)/);
    assert.match(human.output, /✗ .*src\/a\.ts — 1 new violation/);
    assert.match(human.output, /pre blocked the write of src\/a\.ts: console-log/);
    const json = JSON.parse(runWhy(['--session', id, '--json']).output);
    assert.equal(json.report.outcome, 'blocked');
    assert.deepEqual(json.events.map((/** @type {any} */ e) => e.hook), ['pre', 'stop'], 'the pre block, then the Stop that held the turn');
  });
});

test('a turn without edits keeps the last verified report and only notes when it happened', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(id, file);
    await runHook('stop', { session_id: id, cwd: dir });
    await runHook('stop', { session_id: id, cwd: dir });
    const r = report(id);
    assert.equal(r.outcome, 'passed');
    assert.equal(r.files.length, 1, 'the checked file is still listed');
    assert.equal(typeof r.quietAt, 'string');
    const out = runWhy(['--session', id]).output;
    assert.match(out, /Last end of turn that checked files: turn passed: no new violations in the analyzed files; no project script ran/);
    assert.match(out, /The turns after it edited no files/);
  });
});

test('a Stop that fails internally is reported as an error, not as the previous verdict', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(id, file);
    await runHook('stop', { session_id: id });
    assert.equal(report(id).outcome, 'passed');
    writeFileSync(file, 'console.log(1);\n');
    await touch(id, file);
    writeFileSync(join(tmpdir(), `smugan-turn-${id}.json`), '{broken');
    const result = await runHook('stop', { session_id: id });
    assert.equal(result.exitCode, 0, 'the hook still fails open');
    assert.equal(report(id).outcome, 'error');
    assert.match(runWhy(['--session', id]).output, /failed with an internal error and verified nothing/);
  });
});

test('with the re-check off, files are labeled so and scripts still run', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: { smugan: false } } }));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(id, file);
    await runHook('stop', { session_id: id });
    const r = report(id);
    assert.deepEqual(r.files.map((/** @type {any} */ f) => f.status), ['recheck-off']);
    assert.deepEqual(r.scripts, [{ label: 'tests (npm test)', status: 'passed' }]);
    const out = runWhy(['--session', id]).output;
    assert.match(out, /re-check off in this project/);
    assert.match(out, /turn passed by the scripts; no file went through the Smugan re-check/);
    assert.doesNotMatch(out, /re-check and scripts green/);
  });
});

test('a turn released with nothing checked and nothing run never reads as approved', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: false } }));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(id, file);
    await runHook('stop', { session_id: id });
    const out = runWhy(['--session', id]).output;
    assert.match(out, /turn released unverified: no file was analyzed and no script ran/);
    assert.doesNotMatch(out, /turn passed/);
  });
});

test('releasing at the block cap keeps what was still red, and each Stop block is an event', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(id, file);
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 2, 'an ordinary turn holds once');
    assert.equal((await runHook('stop', { session_id: id })).exitCode, 0);
    const r = report(id);
    assert.equal(r.outcome, 'released-after-cap');
    assert.match(r.failures[0], /\[console-log\]/);
    assert.equal(typeof r.checkedAt, 'string');
    const out = runWhy(['--session', id]).output;
    assert.match(out, /Failures from the last check \(\d+ min ago\):\n {2}src\/a\.ts:1 {2}\[console-log\]/);
    assert.equal((out.match(/stop held the turn/g) ?? []).length, 1);
  });
});

test('without --session, why picks the newest session of the current folder', async () => {
  const mine = session();
  const other = session();
  await withProject(mine, async (dir) => {
    await withProject(other, async (elsewhere) => {
      await touch(mine, join(dir, 'src', 'a.ts'));
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const x = 1;\n');
      await runHook('stop', { session_id: mine, cwd: dir });
      writeFileSync(join(elsewhere, 'src', 'b.ts'), 'export const y = 1;\n');
      await touch(other, join(elsewhere, 'src', 'b.ts'));
      await runHook('stop', { session_id: other, cwd: elsewhere });
      assert.match(runWhy([], dir).output, new RegExp(`^smugan why — session ${mine} `));
      assert.match(runWhy([], join(dir, 'src')).output, new RegExp(`session ${mine} `), 'a subfolder of the project counts');
      const nowhereDir = mkdtempSync(join(tmpdir(), 'smugan-why-nowhere-'));
      try {
        assert.match(runWhy([], nowhereDir).output, /No session recorded in this folder/);
      } finally {
        rmSync(nowhereDir, { recursive: true, force: true });
      }
    });
  });
});

test('a session opened in a parent folder matches the project it edited, and only that one', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(id, file);
    await runHook('stop', { session_id: id, cwd: tmpdir() });
    assert.match(runWhy([], dir).output, new RegExp(`^smugan why — session ${id} `));
    const sibling = mkdtempSync(join(tmpdir(), 'smugan-why-sibling-'));
    try {
      assert.match(runWhy([], sibling).output, /No session recorded in this folder/, 'starting in the parent does not claim every folder below it');
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});

test('a held Stop of a session opened in a parent folder does not claim the folders below it', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log("left behind");\nexport const x = 1;\n');
    await touch(id, file);
    assert.equal((await runHook('stop', { session_id: id, cwd: tmpdir() })).exitCode, 2);
    assert.match(runWhy([], dir).output, new RegExp(`^smugan why — session ${id} `));
    const sibling = mkdtempSync(join(tmpdir(), 'smugan-why-sibling-'));
    try {
      assert.match(runWhy([], sibling).output, /No session recorded in this folder/);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});

test('smugan why says so when a session has no record', () => {
  const result = runWhy(['--session', 'smugan-why-nothing-here']);
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /no record for session/);
  assert.equal(runWhy(['--session']).exitCode, 2);
  assert.equal(runWhy(['--session', '!!!']).exitCode, 1, 'an id with nothing valid in it is just an unknown session');
  assert.equal(runWhy(['--bogus']).exitCode, 2);
});

test('smugan why says warn mode is active and tells warnings from blocks', async () => {
  const id = session();
  await withProject(id, async (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), '{"mode":"warn"}');
    const file = join(dir, 'src', 'a.ts');
    await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content: 'console.log(1);\n' } });
    writeFileSync(file, 'console.log(1);\n');
    await touch(id, file);
    await runHook('stop', { session_id: id });
    const { output } = runWhy(['--session', id], dir);
    assert.match(output, /Warn mode active in .*: the hooks show violations without blocking/);
    assert.match(output, /turn released in warn mode/);
    assert.match(output, /pre warned without blocking src\/a\.ts \(warn mode\): console-log/);
    assert.match(output, /stop warned without holding the turn \(warn mode\): 1 failure/);
  });
});
