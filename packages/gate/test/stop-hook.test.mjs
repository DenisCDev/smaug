// @ts-check
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/hook.mjs';
import { hasCode } from '../src/file-state.mjs';

let sessionCounter = 0;
/** @type {string[]} */
const sessions = [];
function freshSession() {
  sessionCounter += 1;
  const id = `smuganstoptest${process.pid}n${sessionCounter}`;
  sessions.push(id);
  return id;
}
// Some tests drive Stop without a project helper; none may leave state behind.
after(() => {
  for (const id of sessions) for (const file of sessionFiles(id)) rmSync(file, { force: true });
});

/** @param {string} sessionId */
function markerFor(sessionId) {
  return join(tmpdir(), 'smugan-turn-' + sessionId + '.json');
}

/** @param {string} sessionId */
function debtFor(sessionId) {
  return join(tmpdir(), 'smugan-stopdebt-' + sessionId + '.json');
}

/** Everything a session leaves in the temp dir, for cleanup. @param {string} sessionId */
function sessionFiles(sessionId) {
  return ['smugan-turn-', 'smugan-stopdebt-', 'smugan-report-', 'smugan-events-'].map((p) => join(tmpdir(), p + sessionId + '.json'));
}

/** @param {(dir: string) => Promise<void>} body @param {string} sessionId */
async function withProject(sessionId, body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-stop-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
  try {
    await body(dir);
  } finally {
    // A tree taskkill ended a moment ago can still hold its cwd on Windows;
    // retries back off linearly, up to about 11 s in all.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    for (const file of sessionFiles(sessionId)) {
      try {
        unlinkSync(file);
      } catch {
        // already gone
      }
    }
  }
}

/** @param {string} sessionId @param {string} file */
async function touch(sessionId, file) {
  return runHook('post', { tool_name: 'Write', session_id: sessionId, tool_input: { file_path: file } });
}

test('stop passes silently when the turn touched nothing', async () => {
  const result = await runHook('stop', { session_id: freshSession() });
  assert.deepEqual(result, { exitCode: 0, stderr: '' });
});

test('a turn that touched a critical file is re-checked after the fix', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'auth.ts');
    writeFileSync(file, 'console.log("left behind");\nexport const x = 1;\n');
    await touch(session, file);

    const blocked = await runHook('stop', { session_id: session });
    assert.equal(blocked.exitCode, 2);
    assert.match(blocked.stderr, /console-log/);
    assert.match(blocked.stderr, /attempt 1\/2/);

    writeFileSync(file, 'export const x = 1;\n');
    const passed = await runHook('stop', { session_id: session });
    assert.equal(passed.exitCode, 0);
    assert.equal(passed.stdout, undefined, 'a real green run, not a release');
    assert.equal(existsSync(markerFor(session)), false); // marker cleared
  });
});

test('a critical turn gives up after 2 blocked attempts (no infinite loop)', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    const file = join(dir, 'supabase', 'migrations', '0001_init.sql');
    writeFileSync(file, 'create table clientes (\n  nome_completo text\n);\n');
    await touch(session, file);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await runHook('stop', { session_id: session });
      assert.equal(result.exitCode, 2, `attempt ${attempt} blocks`);
    }
    const released = await runHook('stop', { session_id: session });
    assert.equal(released.exitCode, 0);
    // Exit-0 stderr reaches nobody in Claude Code — the give-up note must ride
    // stdout JSON systemMessage so the USER at least sees it.
    assert.match(released.stderr, /2 blocked attempts spent/);
    assert.match(released.stdout ?? '', /2 holds used/);
    assert.match(released.stdout ?? '', /"systemMessage"/);
    assert.equal(existsSync(markerFor(session)), false);
  });
});

test('an ordinary turn is held once, then ends without the hook re-running the checks', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(session, file);
    const held = await runHook('stop', { session_id: session });
    assert.equal(held.exitCode, 2);
    assert.match(held.stderr, /last hold \(1\/1\).*run the failing check yourself and show its result/);
    const released = await runHook('stop', { session_id: session });
    assert.equal(released.exitCode, 0, 'the second Stop of the turn never holds');
    assert.match(released.stderr, /1 blocked attempt spent — letting the turn end without re-running the checks/);
    assert.match(released.stdout ?? '', /1 hold used — the turn ends without the hook re-running the checks/);
    assert.equal(existsSync(markerFor(session)), false);
  });
});

test('a hold the turn never answered does not let the next turn end unchecked', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const first = join(dir, 'src', 'a.ts');
    writeFileSync(first, 'console.log(1);\n');
    await touch(session, first);
    const held = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(held.exitCode, 2);
    assert.match(held.stderr, /last hold \(1\/1\)/);

    // The next turn: the host says this Stop continues nothing, and another file is broken.
    const second = join(dir, 'src', 'b.ts');
    writeFileSync(second, 'console.log(2);\n');
    await touch(session, second);
    const again = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(again.exitCode, 2, 'the new turn is checked, not released on the earlier hold');
    assert.match(again.stderr, /src\/b\.ts:1 {2}\[console-log\]/);
    assert.match(again.stderr, /last hold \(1\/1\)/, 'with a budget of its own');

    // A third turn that fixes b.ts and leaves a.ts: what the holds listed does not hold again.
    writeFileSync(second, 'export const b = 2;\n');
    await touch(session, second);
    const known = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(known.exitCode, 0);
    assert.match(known.stderr, /already used up an earlier turn's holds — not re-blocking/);
    assert.equal(existsSync(markerFor(session)), false);
  });
});

test('a turn that wrote nothing since the hold is released, not checked again', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    // Each run logs itself and fails with another text, as a runner that prints the time does:
    // the failures already held never match, so only the hold budget ends the cycle.
    writeFileSync(join(dir, 'fail.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync('runs.log', 'run\\n');\nconsole.error('1 failed, started at ' + process.hrtime.bigint());\nprocess.exit(1);\n");
    setTestScript(dir, 'node fail.mjs');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const runs = () => readFileSync(join(dir, 'runs.log'), 'utf8').trim().split('\n').length;
    assert.equal((await runHook('stop', { session_id: session, stop_hook_active: false })).exitCode, 2);
    const released = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(released.exitCode, 0, 'no hold without something new to check');
    assert.match(released.stderr, /1 blocked attempt spent — letting the turn end without re-running the checks/);
    assert.equal(runs(), 1, 'the suite did not run a second time');
    assert.equal(existsSync(markerFor(session)), false);
  });
});

test('a check that rewrites a file of the turn is no write of the next turn', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    // The suite copies a file the turn touched over itself on every run, as a codegen step does, and fails with another text each time.
    writeFileSync(join(dir, 'fail.mjs'), "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';\nappendFileSync('runs.log', 'run\\n');\nwriteFileSync('src/a.ts', readFileSync('src/a.ts'));\nconsole.error('1 failed, started at ' + process.hrtime.bigint());\nprocess.exit(1);\n");
    setTestScript(dir, 'node fail.mjs');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const runs = () => readFileSync(join(dir, 'runs.log'), 'utf8').trim().split('\n').length;
    assert.equal((await runHook('stop', { session_id: session, stop_hook_active: false })).exitCode, 2);
    const released = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(released.exitCode, 0, 'what the checks wrote is not something new to check');
    assert.equal(runs(), 1, 'the suite did not run a second time');
  });
});

test('a file the checks leave behind is no write of the next turn', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    // The suite writes a report git sees as untracked, and fails with another text each time.
    writeFileSync(join(dir, 'fail.mjs'), "import { appendFileSync, writeFileSync } from 'node:fs';\nappendFileSync('runs.log', 'run\\n');\nwriteFileSync('junit.xml', '<testsuite time=\"' + Date.now() + '\"/>');\nconsole.error('1 failed, started at ' + process.hrtime.bigint());\nprocess.exit(1);\n");
    setTestScript(dir, 'node fail.mjs');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    writeFileSync(join(dir, '.gitignore'), 'runs.log\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'base'], { cwd: dir });
    // A shell command in the turn makes the end of the turn list what changed in the repository.
    await runHook('bash', { session_id: session, tool_name: 'Bash', cwd: dir, tool_input: { command: 'git status' } });
    writeFileSync(file, 'export const x = 2;\n');
    await touch(session, file);
    const runs = () => readFileSync(join(dir, 'runs.log'), 'utf8').trim().split('\n').length;
    assert.equal((await runHook('stop', { session_id: session, stop_hook_active: false })).exitCode, 2);
    const released = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(released.exitCode, 0, released.stderr);
    assert.equal(runs(), 1, 'the suite did not run a second time');
  });
});

test('a file rewritten since the hold with as many bytes as it had is a write: the turn is checked again', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\nexport const n = 1;\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session, stop_hook_active: false })).exitCode, 2);
    // Written by something no hook saw: the same bytes in another order, a few seconds later.
    writeFileSync(file, 'export const n = 1;\nconsole.log(1);\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const again = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(again.exitCode, 2, 'checked and held, not released on the earlier hold');
    assert.match(again.stderr, /src\/a\.ts:2 {2}\[console-log\]/);
  });
});

test('a Stop that continues a held turn still ends it without re-running the checks', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session, stop_hook_active: false })).exitCode, 2);
    // The answer to the hold leaves the file red, and the Stop after it continues the same turn.
    writeFileSync(file, 'console.log(2);\n');
    await touch(session, file);
    const released = await runHook('stop', { session_id: session, stop_hook_active: true });
    assert.equal(released.exitCode, 0);
    assert.match(released.stderr, /1 blocked attempt spent — letting the turn end without re-running the checks/);
  });
  // A host that does not say which Stop it is keeps the one hold per turn it always had.
  const silent = freshSession();
  await withProject(silent, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(silent, file);
    assert.equal((await runHook('stop', { session_id: silent })).exitCode, 2);
    writeFileSync(file, 'console.log(2);\n');
    await touch(silent, file);
    assert.equal((await runHook('stop', { session_id: silent })).exitCode, 0);
  });
});

test('stop is diff-aware: a legacy .skip the turn did not introduce does not block', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'checkout.test.ts');
    const legacy = "it.skip('legacy flaky', () => { expect(1).toBe(1); });\n";
    writeFileSync(file, legacy);
    // pre sees the file at turn start and captures the baseline (includes the .skip)
    const edited = legacy + 'export const helper = 1;\n';
    const blocked = await runHook('pre', {
      tool_name: 'Edit',
      session_id: session,
      tool_input: { file_path: file, old_string: legacy, new_string: edited },
    });
    assert.equal(blocked.exitCode, 0, 'pre allows: the .skip is not new');
    writeFileSync(file, edited);
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'stop does not punish the untouched legacy .skip');
  });
});

test('stop blocks a violation introduced after a clean baseline', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'checkout.test.ts');
    const clean = "it('adds', () => { expect(add(1, 2)).toBe(3); });\n";
    writeFileSync(file, clean);
    await runHook('pre', { tool_name: 'Write', session_id: session, tool_input: { file_path: file, content: clean } });
    // the file later gains a .skip that slipped past pre (or an external change)
    writeFileSync(file, "it.skip('adds', () => { expect(add(1, 2)).toBe(3); });\n");
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /test-weakening/);
  });
});

test('without a captured baseline, stop falls back to a full check', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'checkout.test.ts');
    writeFileSync(file, "it.skip('legacy', () => { expect(1).toBe(1); });\n");
    await touch(session, file); // post only, no pre → no baseline recorded
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, 'no baseline → conservative full check flags the .skip');
    assert.match(result.stderr, /test-weakening/);
  });
});

test('files deleted after being touched do not block', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'gone.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(session, file);
    unlinkSync(file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0);
  });
});

test('hook.stop = false disables the stop gate for the project', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: false } }));
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log(1);\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0);
  });
});

test('missing session_id fails open', async () => {
  const result = await runHook('stop', {});
  assert.equal(result.exitCode, 0);
});

test('build script is NOT run by default (opt-in only)', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node -e "process.exit(1)"' } }),
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0);
  });
});

test('an old "stop": {"build": true} no longer runs a build at the end of the turn', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: { build: true, typecheck: false, tests: false } } }));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node -e "console.error(\'boom\'); process.exit(1)"' } }),
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'the failing build never ran');
    assert.doesNotMatch(`${result.stderr}${result.stdout ?? ''}`, /build/);
  });
});

test("npm's placeholder test script means no tests, not failing tests", async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0);
  });
});

test('files inside the Claude config dir never count toward the DoD', async () => {
  const session = freshSession();
  const fakeClaudeDir = mkdtempSync(join(tmpdir(), 'smugan-claude-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = fakeClaudeDir;
  try {
    mkdirSync(join(fakeClaudeDir, 'projects', 'x', 'memory'), { recursive: true });
    const memoryFile = join(fakeClaudeDir, 'projects', 'x', 'memory', 'note.ts');
    writeFileSync(memoryFile, 'console.log("assistant state, not project code");\n');
    await touch(session, memoryFile);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    rmSync(fakeClaudeDir, { recursive: true, force: true });
    try {
      unlinkSync(markerFor(session));
    } catch {
      // already gone
    }
  }
});

/** @param {string} dir @param {string[]} args */
function git(dir, args) {
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@test', '-c', 'user.name=t', ...args], { stdio: 'ignore' });
}

/** @param {string} dir @param {string} file @param {string} content */
function seedCommitted(dir, file, content) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(file, content);
  git(dir, ['init', '-q']);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'seed']);
}

// Regressions (watson jul/13, watsonAI jul/24): without an in-turn baseline the
// stop hook ran a FULL check on touched files, so committed legacy debt — and
// even files reverted to HEAD — blocked the turn to the 3-attempt cap.

test('no in-turn baseline: committed legacy debt does not block (HEAD is the baseline)', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    seedCommitted(dir, file, 'console.log("legacy");\nexport const x = 1;\n');
    await touch(session, file); // post only — no pre, no in-turn baseline
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'legacy debt already in HEAD never blocks');
  });
});

test('no in-turn baseline: a NEW violation on top of HEAD still blocks', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    seedCommitted(dir, file, 'console.log("legacy");\nexport const x = 1;\n');
    appendFileSync(file, 'console.log("new this turn");\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, 'the turn-introduced violation blocks');
    assert.match(result.stderr, /console-log/);
  });
});

test('a file reverted to its committed content does not block', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    const committed = 'console.log("legacy");\nexport const x = 1;\n';
    seedCommitted(dir, file, committed);
    writeFileSync(file, committed + 'console.log("experiment");\n');
    await touch(session, file);
    writeFileSync(file, committed); // turn reverts its own edit
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'reverted file is byte-identical to HEAD');
  });
});

test('a HEAD baseline cached under other check settings is not reused', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const file = join(dir, 'src', 'a.ts');
    seedCommitted(dir, file, 'try { load(); } catch {}\nconsole.log("legacy");\nexport const x = 1;\n');
    const settings = join(dir, 'smugan.config.json');
    writeFileSync(settings, JSON.stringify({ checks: { 'console-log': false } }));
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 0, 'HEAD baseline cached with console-log off');
    writeFileSync(settings, '{}');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'with console-log back on, the committed console.log is still legacy, not new');
  });
});

test('a HEAD baseline cached before the project used Supabase is not reused', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const file = join(dir, 'db', 'migrations', '0001_init.sql');
    mkdirSync(join(dir, 'db', 'migrations'), { recursive: true });
    seedCommitted(dir, file, 'create table orders (id uuid primary key, price real);\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 0, 'HEAD baseline cached without the Supabase checks');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dependencies: { '@supabase/supabase-js': '2.45.0' } }));
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'the committed migration is legacy for the Supabase checks too');
  });
});

test('a failed Edit still anchors the baseline: legacy debt does not block at stop', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log("legacy");\nexport const x = 1;\n');
    // old_string does not match: the tool will fail, but this failed attempt is
    // the turn's first touch — pre must capture the baseline anyway.
    const pre = await runHook('pre', {
      tool_name: 'Edit',
      session_id: session,
      tool_input: { file_path: file, old_string: 'does-not-exist', new_string: 'x' },
    });
    assert.equal(pre.exitCode, 0);
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'baseline from the failed edit spares legacy debt');
  });
});

// Regression (production app, jul/27-28 2026): a persistently red monorepo suite
// re-blocked EVERY turn to the 3-attempt cap — 3 full cycles in one session,
// re-running the whole suite each time. Two causes, two fixes: the block
// budget forgot the failure between turns (debt fingerprint), and the root
// test script fanned out to every workspace package regardless of what the
// turn touched (package scoping).

/** @param {string} dir @param {string} script */
function setTestScript(dir, script) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: { test: script } }),
  );
}

test('failures that already spent the block budget do not re-block the next turn', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(dir, 'node -e "console.error(\'boom\'); process.exit(1)"');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 2, 'the one hold of an ordinary turn');
    const released = await runHook('stop', { session_id: session });
    assert.equal(released.exitCode, 0);
    // next turn, same red suite: the debt binds instead of a fresh hold
    await touch(session, file);
    const skipped = await runHook('stop', { session_id: session });
    assert.equal(skipped.exitCode, 0, 'known debt does not restart the block cycle');
    assert.match(skipped.stdout ?? '', /not re-blocking/);
    assert.equal(existsSync(markerFor(session)), false);
  });
});

test('debt binds even when the runner output carries varying timings', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    // a REAL node --test run: the per-test "duration_ms: n" YAML line and the
    // space-form "# duration_ms n" summary token both vary on every run
    setTestScript(dir, 'node --test');
    writeFileSync(
      join(dir, 'fail.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('boom', () => { assert.fail('boom'); });\n",
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 2);
    await runHook('stop', { session_id: session }); // released; debt recorded
    await touch(session, file);
    const skipped = await runHook('stop', { session_id: session });
    assert.equal(skipped.exitCode, 0, 'timings are masked — the same failure is recognized as debt');
    assert.match(skipped.stdout ?? '', /not re-blocking/);
  });
});

// Regression (production app, jul/2026, CC 2.1.220): Claude Code demotes a Stop
// exit-2 to non-blocking "hook script appears to be missing" when stdout is
// empty and stderr matches /no such file|can't open/i — raw ENOENT output in
// a relayed test failure killed the DoD hold silently, session after session.

test('a stop block ships a stdout marker and a stderr free of the sniffed phrases', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(
      dir,
      'node -e "console.error(\'Error: ENOENT: no such file or directory, open foo.json\'); console.error(\'also: can\\u0027t open bar.txt\'); process.exit(1)"',
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout && result.stdout.trim().length > 0, 'non-empty stdout defuses the empty-stdout half of the heuristic');
    assert.doesNotMatch(result.stderr, /no such file|can't open/i, 'the sniffed phrases never reach the harness');
    assert.match(result.stderr, /file or directory does not exist/, 'the meaning survives the rewording');
    assert.match(result.stderr, /cannot open/, 'same for the second phrase');
  });
});

// Regression (medição ago/2026): head-only truncation spent its 40 lines on
// "running test … ok" noise and dropped the FAIL lines and the summary, which
// test runners print LAST. The block must keep both ends of the output.

test('long runner output is truncated keeping the tail, where failures live', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const runner = [
      ...Array.from({ length: 48 }, (_, i) => `console.error('[suite] running test file ${i} ... ok');`),
      "console.error('FAIL src/tar-path.test.ts > extrai binario do tar');",
      "console.error('Summary: 851 pass, 1 fail');",
      'process.exit(1);',
    ].join('\n');
    writeFileSync(join(dir, 'runner.cjs'), runner);
    setTestScript(dir, 'node runner.cjs');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /FAIL src\/tar-path\.test\.ts/, 'the failure NAME survives truncation');
    assert.match(result.stderr, /851 pass, 1 fail/, 'the summary survives truncation');
    assert.match(result.stderr, /lines omitted/, 'the middle noise is what gets dropped');
  });
});

// Regression (critic 0.14.0): the vitest path called the async runNode without
// await — the TypeError rejected stopHook and the shims' fail-open catch turned
// the WHOLE Definition of Done into exit 0 on every vitest project.
test('a red vitest run still blocks the turn (async runNode is awaited)', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    mkdirSync(join(dir, 'node_modules', 'vitest'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'vitest', 'vitest.mjs'),
      "console.error('FAIL src/a.test.ts > broken'); process.exit(1);\n",
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, 'red vitest must block, not fail open');
    assert.match(result.stderr, /tests \(vitest related\)/);
    assert.match(result.stderr, /FAIL src\/a\.test\.ts/);
  });
});

test('vitest related also runs for a turn that only touched an .mts, .cts or .cjs module', async () => {
  for (const name of ['a.mts', 'a.cts', 'a.cjs']) {
    const session = freshSession();
    await withProject(session, async (dir) => {
      mkdirSync(join(dir, 'node_modules', 'vitest'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'vitest', 'vitest.mjs'), "console.error('FAIL related: ' + process.argv.slice(2).join(' ')); process.exit(1);\n");
      mkdirSync(join(dir, 'src'));
      const file = join(dir, 'src', name);
      writeFileSync(file, name.endsWith('.cjs') ? 'module.exports = { x: 1 };\n' : 'export const x = 1;\n');
      await touch(session, file);
      const result = await runHook('stop', { session_id: session });
      assert.equal(result.exitCode, 2, name);
      assert.ok(result.stderr.includes('FAIL related: related --run --passWithNoTests src/' + name), result.stderr);
    });
  }
});

test('truncation is bounded: a 2000-line red run ships ~31 lines, not the run', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const runner = [
      'for (let i = 0; i < 1998; i++) console.error(`[suite] line ${i}`);',
      "console.error('FAIL src/last.test.ts > the real failure');",
      "console.error('Summary: 1 fail');",
      // Let the pipe flush before exit; immediate process.exit truncates the
      // fixture's output on Linux before the hook can apply its own bound.
      'process.exitCode = 1;',
    ].join('\n');
    writeFileSync(join(dir, 'runner.cjs'), runner);
    setTestScript(dir, 'node runner.cjs');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2);
    const lineCount = result.stderr.split('\n').length;
    assert.ok(lineCount < 45, `stop stderr must stay bounded, got ${lineCount} lines`);
    assert.match(result.stderr, /\(19\d\d lines omitted\)/, 'the marker reports what was DROPPED (~1970, npm preamble shifts it slightly)');
    assert.match(result.stderr, /FAIL src\/last\.test\.ts/, 'the tail keeps the failure');
  });
});

for (const stream of ['stdout', 'stderr']) {
  for (const exitCode of [0, 1]) {
    test(`stop preserves exit ${exitCode} after more than 1 MiB of ${stream}`, async () => {
      const session = freshSession();
      await withProject(session, async (dir) => {
        writeFileSync(join(dir, 'runner.cjs'), [
          `process.${stream}.write(('x'.repeat(255) + '\\n').repeat(8192));`,
          `process.${stream}.write('CHECK_FINISHED\\n');`,
          `process.exitCode = ${exitCode};`,
        ].join('\n'));
        setTestScript(dir, 'node runner.cjs');
        mkdirSync(join(dir, 'src'));
        const file = join(dir, 'src', 'a.ts');
        writeFileSync(file, 'export const x = 1;\n');
        await touch(session, file);

        const result = await runHook('stop', { session_id: session });
        assert.equal(result.exitCode, exitCode === 0 ? 0 : 2);
        if (exitCode === 1) {
          assert.match(result.stderr, /CHECK_FINISHED/, 'the real failure tail survives');
          assert.ok(result.stderr.length < 16 * 1024, 'the relayed report stays bounded');
        }
      });
    });
  }

  test(`stop keeps the real failure after more than 16 MiB of ${stream}`, async () => {
    const session = freshSession();
    await withProject(session, async (dir) => {
      writeFileSync(join(dir, 'runner.cjs'), [
        `process.${stream}.write(('x'.repeat(255) + '\\n').repeat(69632));`,
        `process.${stream}.write('CHECK_FINISHED\\n');`,
        'process.exitCode = 1;',
      ].join('\n'));
      setTestScript(dir, 'node runner.cjs');
      mkdirSync(join(dir, 'src'));
      const file = join(dir, 'src', 'a.ts');
      writeFileSync(file, 'export const x = 1;\n');
      await touch(session, file);

      const result = await runHook('stop', { session_id: session });
      assert.equal(result.exitCode, 2, 'the output limit must not hide a failed check');
      assert.match(result.stderr, /CHECK_FINISHED/);
      assert.match(result.stderr, /earlier output omitted/);
      assert.ok(result.stderr.length < 16 * 1024, 'the relayed report stays bounded');
    });
  });
}

test('a stop deadline terminates the shell descendants without changing timeout policy', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(join(dir, 'runner.cjs'), [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' });",
      "require('node:fs').writeFileSync('pids.json', JSON.stringify([process.pid, child.pid]));",
      'setTimeout(() => {}, 30000);',
    ].join('\n'));
    setTestScript(dir, 'node runner.cjs');
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: { timeoutMs: 7000 } } }));
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);

    /** @type {number[]} */
    let pids = [];
    try {
      const result = await runHook('stop', { session_id: session });
      assert.equal(result.exitCode, 0, 'a real timeout keeps the documented fail-open policy');
      assert.match(result.stderr, /tests \(npm test\).*7000 ms.*result not verified/);
      assert.match(JSON.parse(result.stdout ?? '{}').systemMessage, /incomplete checks/);
      pids = JSON.parse(readFileSync(join(dir, 'pids.json'), 'utf8'));
      assert.equal(pids.length, 2, 'the command and its grandchild actually started');
      for (const pid of pids) {
        const deadline = Date.now() + 5000;
        for (;;) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            if (hasCode(error, 'ESRCH')) break;
            throw error;
          }
          assert.ok(Date.now() < deadline, 'no descendant survives the deadline');
          await new Promise((done) => setTimeout(done, 25));
        }
      }
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (!hasCode(error, 'ESRCH')) throw error;
        }
      }
    }
  });
});

test('an incomplete test run remains visible alongside a failing typecheck', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: {
      typecheck: 'node -e "console.error(\'TYPECHECK_FAILED\'); process.exit(1)"',
      test: 'node -e "setTimeout(() => {}, 30000)"',
    } }));
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: { timeoutMs: 7000 } } }));
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, 'a timeout never hides another failed check');
    assert.match(result.stderr, /TYPECHECK_FAILED/);
    assert.match(result.stderr, /tests \(npm test\).*result not verified/);
  });
});

test('script failures do not advertise smugan-ignore; gate lines still do', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(dir, 'node -e "console.error(\'boom\'); process.exit(1)"');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const scriptBlock = await runHook('stop', { session_id: session });
    assert.equal(scriptBlock.exitCode, 2);
    assert.doesNotMatch(scriptBlock.stderr, /smugan-ignore/, 'there is no suppression path for script failures — do not suggest one');
    await runHook('stop', { session_id: session }); // the ordinary turn's one hold is spent

    setTestScript(dir, 'node -e "process.exit(0)"');
    writeFileSync(file, 'console.log("debug");\nexport const x = 1;\n');
    await touch(session, file);
    const gateBlock = await runHook('stop', { session_id: session });
    assert.equal(gateBlock.exitCode, 2);
    assert.match(gateBlock.stderr, /smugan-ignore/, 'gate [rule] lines keep the valve');
  });
});

// Regression (production app, jul/2026): pnpm -r bails at the FIRST red package, so a
// whack-a-mole session (fix voice-agent → manifest-schema shows up → fix it →
// voice-agent flakes back) reshuffled the failure list every round and the
// whole-list fingerprint never matched — 0 dedups in ~50 blocks. Debt must
// bind per failure, and runner noise (ISO timestamps) must be masked.

test('debt binds per failure: a known failure stays quiet after other failures came and went', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(dir, 'node -e "console.error(\'red: voice-agent suite\'); process.exit(1)"');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 2);
    await runHook('stop', { session_id: session }); // released; debt = voice-agent

    // a DIFFERENT failure surfaces (the next onion layer): new info, blocks again
    setTestScript(dir, 'node -e "console.error(\'red: manifest-schema suite\'); process.exit(1)"');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 2, 'a new failure gets its own budget');
    await runHook('stop', { session_id: session }); // released; debt = both

    // the FIRST failure returns alone: pure known debt, no fourth cycle
    setTestScript(dir, 'node -e "console.error(\'red: voice-agent suite\'); process.exit(1)"');
    await touch(session, file);
    const skipped = await runHook('stop', { session_id: session });
    assert.equal(skipped.exitCode, 0, 'a failure that already spent a budget never buys another cycle');
    assert.match(skipped.stdout ?? '', /not re-blocking/);
  });
});

test('debt binds even when the runner output carries ISO timestamps', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(
      dir,
      'node -e "console.error(\'[\'+new Date().toISOString()+\'] FAIL voice-agent\'); process.exit(1)"',
    );
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 2);
    await runHook('stop', { session_id: session }); // released; debt recorded
    await touch(session, file);
    const skipped = await runHook('stop', { session_id: session });
    assert.equal(skipped.exitCode, 0, 'the timestamp is masked — same failure, same debt');
    assert.match(skipped.stdout ?? '', /not re-blocking/);
  });
});

test('a changed failure blocks again, and a green run clears the debt', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(dir, 'node -e "console.error(\'boom\'); process.exit(1)"');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    assert.equal((await runHook('stop', { session_id: session })).exitCode, 2);
    await runHook('stop', { session_id: session }); // released; debt = boom

    // a DIFFERENT failure is progress-or-regression, never known debt
    setTestScript(dir, 'node -e "console.error(\'other\'); process.exit(1)"');
    await touch(session, file);
    const changed = await runHook('stop', { session_id: session });
    assert.equal(changed.exitCode, 2, 'a different failure gets a fresh budget');
    await runHook('stop', { session_id: session }); // released; debt = boom + other

    // green clears the debt…
    setTestScript(dir, 'node -e "process.exit(0)"');
    await touch(session, file);
    const green = await runHook('stop', { session_id: session });
    assert.equal(green.exitCode, 0);
    assert.equal(existsSync(debtFor(session)), false, 'debt file cleared on green');

    // …so the ORIGINAL failure regressing blocks again instead of hiding as debt
    setTestScript(dir, 'node -e "console.error(\'boom\'); process.exit(1)"');
    await touch(session, file);
    const regressed = await runHook('stop', { session_id: session });
    assert.equal(regressed.exitCode, 2, 'a regression after green is a new complaint');
  });
});

test('workspace: tests scope to the touched package, not the whole root suite', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture', private: true, workspaces: ['packages/*'],
        scripts: { test: 'node -e "console.error(\'root suite must not run\'); process.exit(1)"' },
      }),
    );
    git(dir, ['init', '-q']); // anchors config.root at the monorepo root, like a real checkout
    const pkg = join(dir, 'packages', 'a');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'a', private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
    const file = join(pkg, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'touched package is green; unrelated root suite never ran');
  });
});

test('workspace: a failing test in the touched package blocks, named by package', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'], scripts: { test: 'node -e "process.exit(0)"' } }),
    );
    git(dir, ['init', '-q']);
    const pkg = join(dir, 'packages', 'a');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'a', private: true, scripts: { test: 'node -e "console.error(\'pkg red\'); process.exit(1)"' } }));
    const file = join(pkg, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /tests \(packages\/a /);
  });
});

test('workspace: a root-level change still runs the full root suite', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture', private: true, workspaces: ['packages/*'],
        scripts: { test: 'node -e "console.error(\'root red\'); process.exit(1)"' },
      }),
    );
    git(dir, ['init', '-q']);
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'root-owned.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, 'root-owned file → the root suite is the honest check');
    assert.match(result.stderr, /tests \(npm test\)/);
  });
});

test('workspace: touching more than 3 packages falls back to the root suite', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture', private: true, workspaces: ['packages/*'],
        scripts: { test: 'node -e "console.error(\'root red\'); process.exit(1)"' },
      }),
    );
    git(dir, ['init', '-q']);
    for (const name of ['a', 'b', 'c', 'd']) {
      const pkg = join(dir, 'packages', name);
      mkdirSync(join(pkg, 'src'), { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
      const file = join(pkg, 'src', 'x.ts');
      writeFileSync(file, 'export const x = 1;\n');
      await touch(session, file);
    }
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, '4 packages is root-scale — the full suite runs, nothing is silently skipped');
    assert.match(result.stderr, /tests \(npm test\)/);
  });
});

test('workspace: a touched package without a test script runs nothing', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture', private: true, workspaces: ['packages/*'],
        scripts: { test: 'node -e "console.error(\'root suite must not run\'); process.exit(1)"' },
      }),
    );
    git(dir, ['init', '-q']);
    const pkg = join(dir, 'packages', 'b');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'b', private: true }));
    const file = join(pkg, 'src', 'b.ts');
    writeFileSync(file, 'export const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'no test script in the touched package, nothing to run');
  });
});

// Regression (production app, jul/29 2026): a turn that only edited markdown (an ops
// runbook) still ran the monorepo's whole `pnpm test`, blocked on a pre-existing
// red package, and announced "this turn modified code" — about a turn that
// modified none. Prose can't move a script's answer; paying the suite to
// re-learn that is the bug.

test('a prose-only turn never runs the project scripts', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture', private: true,
        scripts: {
          test: 'node -e "console.error(\'suite must not run for a docs edit\'); process.exit(1)"',
          typecheck: 'node -e "console.error(\'typecheck must not run either\'); process.exit(1)"',
        },
      }),
    );
    const file = join(dir, 'README.md');
    writeFileSync(file, '# Docs\n\nProse only.\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'no script ran, so the red ones never blocked');
  });
});

test('one code file alongside the prose brings the project scripts back', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(dir, 'node -e "console.error(\'red\'); process.exit(1)"');
    mkdirSync(join(dir, 'src'));
    const doc = join(dir, 'README.md');
    writeFileSync(doc, '# Docs\n');
    await touch(session, doc);
    const code = join(dir, 'src', 'a.ts');
    writeFileSync(code, 'export const x = 1;\n');
    await touch(session, code);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2, 'the turn shipped code — the suite is the honest check');
    assert.match(result.stderr, /tests \(npm test\)/);
  });
});

test('.mdx counts as code: it compiles, so the scripts still run', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    setTestScript(dir, 'node -e "console.error(\'red\'); process.exit(1)"');
    const file = join(dir, 'page.mdx');
    writeFileSync(file, '# Page\n\n<Component />\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 2);
  });
});

// Regression (5 sessions, jul/2026): probe/extractor scripts in the Claude
// scratchpad were gated and rewritten in contortions — printing IS their job.
test('the Claude scratchpad is assistant tooling, never gated', async () => {
  const scratchRoot = join(tmpdir(), 'claude', `smugan-test-${process.pid}`);
  const dir = join(scratchRoot, 'sess', 'scratchpad');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'probe.mjs');
  const session = freshSession();
  try {
    const pre = await runHook('pre', {
      tool_name: 'Write',
      session_id: session,
      tool_input: { file_path: file, content: 'console.log("output IS the point");\n' },
    });
    assert.equal(pre.exitCode, 0, 'pre never gates the scratchpad');
    writeFileSync(file, 'console.log("output");\n');
    await touch(session, file);
    const stop = await runHook('stop', { session_id: session });
    assert.equal(stop.exitCode, 0, 'scratchpad files never count toward the DoD');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    try {
      unlinkSync(markerFor(session));
    } catch {
      // already gone
    }
  }
});

// Assertions removed or loosened in an EXISTING test while the same turn changed
// production code: the shape of a test bent to agree with the code.

const CART_TEST = "it('soma itens', () => {\n  expect(total([1, 2])).toBe(3);\n  expect(total([])).toBe(0);\n});\n";

/**
 * Seeds src/cart.ts + src/cart.test.ts, then runs one turn: pre on the test (the
 * turn-start snapshot), the test edit, and optionally a production edit.
 * @param {string} session @param {string} dir @param {string} edited
 * @param {{ production?: boolean, pre?: boolean, committed?: boolean }} [opts]
 */
async function cartTurn(session, dir, edited, opts = {}) {
  const { production = true, pre = true, committed = false } = opts;
  const testFile = join(dir, 'src', 'cart.test.ts');
  const prodFile = join(dir, 'src', 'cart.ts');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(prodFile, 'export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n');
  if (committed) seedCommitted(dir, testFile, CART_TEST);
  else writeFileSync(testFile, CART_TEST);
  if (pre) {
    const result = await runHook('pre', {
      tool_name: 'Write', session_id: session, tool_input: { file_path: testFile, content: edited },
    });
    assert.equal(result.exitCode, 0, 'pre never judges assertion strength');
  }
  writeFileSync(testFile, edited);
  await touch(session, testFile);
  if (production) {
    writeFileSync(prodFile, 'export const total = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b) : 1;\n');
    await touch(session, prodFile);
  }
  return runHook('stop', { session_id: session });
}

test('stop blocks an assertion removed from an existing test while production changed', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const result = await cartTurn(session, dir, CART_TEST.replace('  expect(total([])).toBe(0);\n', ''));
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /src\/cart\.test\.ts:1 {2}\[assertion-weakening\] {2}test "soma itens" lost 1 strong assertion/);
    assert.match(result.stderr, /smugan-ignore/);
  });
});

test('stop blocks a matcher loosened to an existence check', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const result = await cartTurn(session, dir, CART_TEST.replace('toBe(0)', 'toBeDefined()'));
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /\[assertion-weakening\]/);
  });
});

test('a turn that edits only tests may restructure assertions', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const result = await cartTurn(session, dir, CART_TEST.replace('  expect(total([])).toBe(0);\n', ''), { production: false });
    assert.equal(result.exitCode, 0);
  });
});

test('a reasoned smugan-ignore above the test accepts a requested behavior change', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const edited = '// smugan-ignore assertion-weakening: carrinho vazio deixou de ter total definido\n' +
      CART_TEST.replace('  expect(total([])).toBe(0);\n', '');
    const result = await cartTurn(session, dir, edited);
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('without a turn-start snapshot, the committed test is the baseline', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const result = await cartTurn(session, dir, CART_TEST.replace('toBe(3)', 'toBeTruthy()'), { pre: false, committed: true });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /\[assertion-weakening\]/);
  });
});

test('a changed expected value is left to review, not blocked', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const result = await cartTurn(session, dir, CART_TEST.replace('toBe(0)', 'toBe(1)'));
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('checks["assertion-weakening"] = false disables the comparison', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ checks: { 'assertion-weakening': false } }));
    const result = await cartTurn(session, dir, CART_TEST.replace('  expect(total([])).toBe(0);\n', ''));
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

/**
 * Projects whose test script leaves a `ran` file behind, each with one touched
 * file. `stopOff` opts out of the Stop scripts, `noScripts` has a package.json
 * without scripts, `prose` touches only a README.
 * @param {string} sessionId @param {{ stopOff?: boolean, noScripts?: boolean, prose?: boolean }[]} specs
 * @param {(dirs: string[]) => Promise<void>} body
 */
async function withProjects(sessionId, specs, body) {
  const dirs = specs.map(() => mkdtempSync(join(tmpdir(), 'smugan-roots-')));
  try {
    for (const [index, dir] of dirs.entries()) {
      const spec = specs[index];
      if (spec.noScripts) writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
      else setTestScript(dir, 'node -e "require(\'fs\').writeFileSync(\'ran\', \'\')"');
      if (spec.stopOff) writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: false } }));
      mkdirSync(join(dir, 'src'));
      const file = join(dir, spec.prose ? 'README.md' : join('src', 'a.ts'));
      writeFileSync(file, spec.prose ? '# Notas\n' : 'export const x = 1;\n');
      await touch(sessionId, file);
    }
    await body(dirs);
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    for (const file of sessionFiles(sessionId)) {
      if (existsSync(file)) unlinkSync(file);
    }
  }
}

test('a project past the script cap is reported as unverified, not passed in silence', async () => {
  const session = freshSession();
  await withProjects(session, [{}, {}, {}], async ([first, second, third]) => {
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(existsSync(join(first, 'ran')) && existsSync(join(second, 'ran')), 'the first two projects ran their tests');
    assert.equal(existsSync(join(third, 'ran')), false, 'the third project stayed past the cap');
    const note = JSON.parse(result.stdout ?? '{}').systemMessage;
    assert.match(note, /incomplete checks/);
    assert.ok(note.includes(third.split(/[\\/]/).pop() + ': project scripts not run'), note);
  });
});

test('projects with nothing to run do not take a slot of the cap', async () => {
  const session = freshSession();
  const specs = [{ stopOff: true }, { noScripts: true }, { prose: true }, {}, {}];
  await withProjects(session, specs, async ([optedOut, scriptless, proseOnly, fourth, fifth]) => {
    const result = await runHook('stop', { session_id: session });
    assert.deepEqual(result, { exitCode: 0, stderr: '' }, 'nothing was left unverified');
    assert.equal(existsSync(join(optedOut, 'ran')), false);
    assert.equal(existsSync(join(scriptless, 'ran')), false);
    assert.equal(existsSync(join(proseOnly, 'ran')), false, 'a README edit cannot change what the tests say');
    assert.ok(existsSync(join(fourth, 'ran')) && existsSync(join(fifth, 'ran')), 'both projects with code and tests ran them');
  });
});

test('touching many projects without scripts reports nothing unverified', async () => {
  const session = freshSession();
  await withProjects(session, [{ noScripts: true }, { noScripts: true }, { noScripts: true }], async () => {
    const result = await runHook('stop', { session_id: session });
    assert.deepEqual(result, { exitCode: 0, stderr: '' });
  });
});

test('warn mode: stop reports the failing Definition of Done without holding the turn', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), '{"mode":"warn"}');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'auth.ts');
    writeFileSync(file, 'console.log("left behind");\nexport const x = 1;\n');
    await touch(session, file);
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '', 'exit-0 stderr holds the turn in Antigravity and OpenCode');
    assert.match(JSON.parse(result.stdout ?? '{}').systemMessage, /warn mode, nothing blocked[\s\S]*console-log/);
    assert.equal(existsSync(markerFor(session)), false, 'the turn is over, not parked for a retry');
    assert.equal(existsSync(debtFor(session)), false);
  });
});

test('a turn that also touched a block-mode project still holds', async () => {
  const session = freshSession();
  await withProject(session, async (strict) => {
    const lenient = mkdtempSync(join(tmpdir(), 'smugan-stop-warn-'));
    try {
      writeFileSync(join(lenient, 'package.json'), '{"name":"lenient","private":true}');
      writeFileSync(join(lenient, 'smugan.config.json'), '{"mode":"warn"}');
      for (const root of [strict, lenient]) {
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'src', 'a.ts'), 'console.log(1);\n');
        await touch(session, join(root, 'src', 'a.ts'));
      }
      const result = await runHook('stop', { session_id: session });
      assert.equal(result.exitCode, 2);
    } finally {
      rmSync(lenient, { recursive: true, force: true });
    }
  });
});

// --- tests removed while production changed ---

const CART_TESTS = "it('adds items', () => { expect(total([1, 2])).toBe(3); });\nit('rejects a negative quantity', () => { expect(() => total([-1])).toThrow(); });\n";
const CART_SOURCE = 'export const total = (items: number[]) => items.reduce((sum, n) => sum + n, 0);\n';

/**
 * A turn that edits src/cart.test.ts from `before` (CART_TESTS unless given) to `after`, as pre and post see it.
 * @param {string} session @param {string} dir @param {string} after @param {string} [before] @returns {Promise<string>} the test file
 */
async function editCartTests(session, dir, after, before = CART_TESTS) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  const testFile = join(dir, 'src', 'cart.test.ts');
  writeFileSync(testFile, before);
  await runHook('pre', { tool_name: 'Write', session_id: session, tool_input: { file_path: testFile, content: after } });
  writeFileSync(testFile, after);
  await touch(session, testFile);
  return testFile;
}

/** @param {string} session @param {string} dir */
async function editCartSource(session, dir) {
  const file = join(dir, 'src', 'cart.ts');
  writeFileSync(file, CART_SOURCE);
  await touch(session, file);
}

test('a test removed from an existing file while production changed is listed, once', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    await editCartTests(session, dir, CART_TESTS.split('\n')[0] + '\n');
    await editCartSource(session, dir);
    const held = await runHook('stop', { session_id: session });
    assert.equal(held.exitCode, 2);
    assert.match(held.stderr, /src\/cart\.test\.ts {2}\[assertion-weakening\] {2}1 test removed this turn while production code changed; no longer in the file: "rejects a negative quantity"/);
    assert.match(held.stderr, /removed-test lines are listed once/);
    const released = await runHook('stop', { session_id: session });
    assert.equal(released.exitCode, 0, 'listed once: the agent answers, the hook does not insist');
    assert.match(released.stderr, /only listed items for you to review/);
    assert.match(released.stdout ?? '', /clones or removed tests\), with every check green/, 'the note the person reads names what was listed');
  });
});

test('a test commented out counts as removed', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const [kept, dropped] = CART_TESTS.trim().split('\n');
    await editCartTests(session, dir, `${kept}\n// ${dropped}\n`);
    await editCartSource(session, dir);
    const held = await runHook('stop', { session_id: session });
    assert.equal(held.exitCode, 2);
    assert.match(held.stderr, /1 test removed this turn/);
  });
});

test('removing a test in a turn that changed no production code is not reported', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    await editCartTests(session, dir, CART_TESTS.split('\n')[0] + '\n');
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('a renamed test, and a test moved to another test file of the turn, are not removals', async () => {
  const renamedSession = freshSession();
  await withProject(renamedSession, async (dir) => {
    await editCartTests(renamedSession, dir, CART_TESTS.replace('rejects a negative quantity', 'refuses a negative quantity'));
    await editCartSource(renamedSession, dir);
    const result = await runHook('stop', { session_id: renamedSession });
    assert.equal(result.exitCode, 0, result.stderr);
  });
  const movedSession = freshSession();
  await withProject(movedSession, async (dir) => {
    const [kept, moved] = CART_TESTS.trim().split('\n');
    await editCartTests(movedSession, dir, kept + '\n');
    const other = join(dir, 'src', 'cart-errors.test.ts');
    writeFileSync(other, moved + '\n');
    await touch(movedSession, other);
    await editCartSource(movedSession, dir);
    const result = await runHook('stop', { session_id: movedSession });
    assert.equal(result.exitCode, 0, result.stderr);
  });
  // Moved into a file that already had a test of that title: it has one more now.
  const joinedSession = freshSession();
  await withProject(joinedSession, async (dir) => {
    const [kept, moved] = CART_TESTS.trim().split('\n');
    mkdirSync(join(dir, 'src'), { recursive: true });
    const other = join(dir, 'src', 'orders.test.ts');
    const had = `describe('orders', () => { ${moved} });\n`;
    const joined = `${had}describe('cart', () => { ${moved} });\n`;
    writeFileSync(other, had);
    await runHook('pre', { tool_name: 'Write', session_id: joinedSession, tool_input: { file_path: other, content: joined } });
    writeFileSync(other, joined);
    await touch(joinedSession, other);
    await editCartTests(joinedSession, dir, kept + '\n');
    await editCartSource(joinedSession, dir);
    const result = await runHook('stop', { session_id: joinedSession });
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('a title another test file always had is no move, however that file declares it', async () => {
  const [kept, dropped] = CART_TESTS.trim().split('\n');
  // The other file already had a test of that title: twice under two describes, or once with a modifier.
  for (const other of [
    `describe('a', () => { ${dropped} });\ndescribe('b', () => { ${dropped} });\n`,
    dropped.replace('it(', 'it.concurrent(') + '\n',
  ]) {
    const session = freshSession();
    await withProject(session, async (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const otherFile = join(dir, 'src', 'orders.test.ts');
      writeFileSync(otherFile, other);
      await runHook('pre', { tool_name: 'Write', session_id: session, tool_input: { file_path: otherFile, content: other + '// reviewed\n' } });
      writeFileSync(otherFile, other + '// reviewed\n');
      await touch(session, otherFile);
      await editCartTests(session, dir, kept + '\n');
      await editCartSource(session, dir);
      const held = await runHook('stop', { session_id: session });
      assert.equal(held.exitCode, 2, other);
      assert.match(held.stderr, /src\/cart\.test\.ts {2}\[assertion-weakening\] {2}1 test removed this turn/, other);
    });
  }
});

test('a table removed while production changed is counted, with no title to quote', async () => {
  const table = "it.each([[1, 1], [2, 2]])('keeps %i', (n, want) => { expect(total([n])).toBe(want); });\n";
  const [kept] = CART_TESTS.split('\n');
  for (const [after, listed] of /** @type {[string, RegExp][]} */ ([
    [CART_TESTS, /1 test removed this turn while production code changed; no longer in the file: 1 with no title of its own \(a table or a computed title\) —/],
    [kept + '\n', /2 tests removed this turn while production code changed; no longer in the file: "rejects a negative quantity", and 1 with no title of its own \(a table or a computed title\) —/],
  ])) {
    const session = freshSession();
    await withProject(session, async (dir) => {
      await editCartTests(session, dir, after, CART_TESTS + table);
      await editCartSource(session, dir);
      const held = await runHook('stop', { session_id: session });
      assert.equal(held.exitCode, 2, after);
      assert.match(held.stderr, listed);
    });
  }
  // One more of them gone after the listing, by a Stop that continues no hold: a new removal, listed with both.
  const session = freshSession();
  await withProject(session, async (dir) => {
    const second = table.replace('keeps %i', 'holds %i');
    const testFile = await editCartTests(session, dir, CART_TESTS + second, CART_TESTS + table + second);
    await editCartSource(session, dir);
    const first = await runHook('stop', { session_id: session });
    assert.match(first.stderr, /no longer in the file: 1 with no title of its own/);
    await runHook('pre', { tool_name: 'Write', session_id: session, tool_input: { file_path: testFile, content: CART_TESTS } });
    writeFileSync(testFile, CART_TESTS);
    await touch(session, testFile);
    const again = await runHook('stop', { session_id: session, stop_hook_active: false });
    assert.equal(again.exitCode, 2, again.stderr);
    assert.match(again.stderr, /2 tests removed this turn while production code changed; no longer in the file: 2 with no title of its own/);
  });
});

test('a table moved to another test file, or renamed with its file, is no removal', async () => {
  const table = "it.each([[1, 1], [2, 2]])('keeps %i', (n, want) => { expect(total([n])).toBe(want); });\n";
  // Moved: the table leaves the file and lands in a new one.
  const movedSession = freshSession();
  await withProject(movedSession, async (dir) => {
    await editCartTests(movedSession, dir, CART_TESTS, CART_TESTS + table);
    const other = join(dir, 'src', 'cart-table.test.ts');
    writeFileSync(other, table);
    await touch(movedSession, other);
    await editCartSource(movedSession, dir);
    const result = await runHook('stop', { session_id: movedSession });
    assert.equal(result.exitCode, 0, result.stderr);
  });
  // A table another test file always had is no move: the one deleted here is listed.
  const hadSession = freshSession();
  await withProject(hadSession, async (dir) => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    const other = join(dir, 'src', 'orders.test.ts');
    writeFileSync(other, table);
    await runHook('pre', { tool_name: 'Write', session_id: hadSession, tool_input: { file_path: other, content: table + '// reviewed\n' } });
    writeFileSync(other, table + '// reviewed\n');
    await touch(hadSession, other);
    await editCartTests(hadSession, dir, CART_TESTS, CART_TESTS + table);
    await editCartSource(hadSession, dir);
    const held = await runHook('stop', { session_id: hadSession });
    assert.equal(held.exitCode, 2, held.stderr);
    assert.match(held.stderr, /src\/cart\.test\.ts {2}\[assertion-weakening\] {2}1 test removed this turn while production code changed; no longer in the file: 1 with no title of its own/);
  });
  // Renamed: the file is gone and another test file holds what it held.
  const renamedSession = freshSession();
  await withProject(renamedSession, async (dir) => {
    const testFile = await editCartTests(renamedSession, dir, CART_TESTS + table, CART_TESTS + table);
    unlinkSync(testFile);
    const other = join(dir, 'src', 'cart-total.test.ts');
    writeFileSync(other, CART_TESTS + table);
    await touch(renamedSession, other);
    await editCartSource(renamedSession, dir);
    const result = await runHook('stop', { session_id: renamedSession });
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('a table one test file gained offsets one table gone, not one in each file that lost one', async () => {
  const table = "it.each([[1, 1], [2, 2]])('keeps %i', (n, want) => { expect(total([n])).toBe(want); });\n";
  const session = freshSession();
  await withProject(session, async (dir) => {
    // The orders' table is deleted for good.
    mkdirSync(join(dir, 'src'), { recursive: true });
    const orders = join(dir, 'src', 'orders.test.ts');
    const kept = "it('lists orders', () => { expect(total([4])).toBe(4); });\n";
    writeFileSync(orders, kept + "it.each([[3, 3]])('sums %i', (n, want) => { expect(total([n])).toBe(want); });\n");
    await runHook('pre', { tool_name: 'Write', session_id: session, tool_input: { file_path: orders, content: kept } });
    writeFileSync(orders, kept);
    await touch(session, orders);
    // The cart's table moves to a new file.
    await editCartTests(session, dir, CART_TESTS, CART_TESTS + table);
    const moved = join(dir, 'src', 'cart-table.test.ts');
    writeFileSync(moved, table);
    await touch(session, moved);
    await editCartSource(session, dir);
    const held = await runHook('stop', { session_id: session });
    assert.equal(held.exitCode, 2, held.stderr);
    assert.equal(held.stderr.match(/1 test removed this turn while production code changed; no longer in the file: 1 with no title of its own/g)?.length, 1, held.stderr);
  });
});

test('of two tests that shared a title, the one moved to another file is no removal and the one deleted is', async () => {
  const [kept, shared] = CART_TESTS.trim().split('\n');
  const twice = `${kept}\ndescribe('cart', () => { ${shared} });\ndescribe('order', () => { ${shared} });\n`;
  for (const [landed, exitCode] of /** @type {[string, number][]} */ ([
    [`describe('order', () => { ${shared} });\n`, 2],
    [`describe('cart', () => { ${shared} });\ndescribe('order', () => { ${shared} });\n`, 0],
  ])) {
    const session = freshSession();
    await withProject(session, async (dir) => {
      await editCartTests(session, dir, kept + '\n', twice);
      const other = join(dir, 'src', 'orders.test.ts');
      writeFileSync(other, landed);
      await touch(session, other);
      await editCartSource(session, dir);
      const result = await runHook('stop', { session_id: session });
      assert.equal(result.exitCode, exitCode, result.stderr);
      if (exitCode === 2) assert.match(result.stderr, /src\/cart\.test\.ts {2}\[assertion-weakening\] {2}1 test removed this turn while production code changed; no longer in the file: "rejects a negative quantity" —/);
    });
  }
});

test('a test file edited and then deleted while production changed is listed', async () => {
  const session = freshSession();
  await withProject(session, async (dir) => {
    const testFile = await editCartTests(session, dir, CART_TESTS);
    await editCartSource(session, dir);
    unlinkSync(testFile);
    const held = await runHook('stop', { session_id: session });
    assert.equal(held.exitCode, 2);
    assert.match(held.stderr, /src\/cart\.test\.ts {2}\[assertion-weakening\] {2}test file deleted this turn while production code changed, with 2 tests that asserted behavior: "adds items", "rejects a negative quantity"/);
  });
});
