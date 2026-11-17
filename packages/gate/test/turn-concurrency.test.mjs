// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runHook } from '../src/hook.mjs';
import { randomUUID } from 'node:crypto';

// PIDs repeat across runs on Windows; leftover per-session files from an
// earlier run must never belong to this one.
const RUN = randomUUID().slice(0, 8);

/** The Stop report, event log and hold debt a session leaves beside its marker. @param {string} marker */
const sessionLogs = (marker) => ['smugan-report-', 'smugan-events-', 'smugan-stopdebt-'].map((prefix) => marker.replace('smugan-turn-', prefix));

/**
 * A script a Stop child started can hold its cwd for a moment on Windows;
 * retries back off linearly, about 11 s in all, so a folder still held for a
 * moment does not turn into an EPERM that replaces the test's own result.
 * @param {string} dir
 */
const removeProject = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

test('parallel hook processes preserve every touch and first baseline for Stop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-concurrent-'));
  const session = 'parallel' + RUN;
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ hook: { stop: { typecheck: false, tests: false } } }));
  mkdirSync(join(dir, 'src'));
  const hookUrl = new URL('../src/hook.mjs', import.meta.url).href;
  const source = `
    import { runHook } from ${JSON.stringify(hookUrl)};
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const [dir, session, worker] = process.argv.slice(1);
    for (let i = 0; i < 30; i++) {
      const file = join(dir, 'src', worker + '-' + i + '.ts');
      writeFileSync(file, 'export const value = 1;');
      const pre = await runHook('pre', { session_id: session, tool_name: 'Write', tool_input: { file_path: file, content: 'export const value = 2;' } });
      if (pre.stdout || pre.exitCode !== 0) throw new Error('pre: ' + JSON.stringify(pre));
      writeFileSync(file, 'console.log(1);');
      const post = await runHook('post', { session_id: session, tool_name: 'Write', tool_input: { file_path: file } });
      if (post.stdout || post.exitCode !== 0) throw new Error('post: ' + JSON.stringify(post));
    }
  `;
  try {
    await Promise.all(Array.from({ length: 4 }, (_, worker) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, dir, session, String(worker)], {
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, windowsHide: true,
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve(undefined) : reject(new Error(stderr || 'hook child failed')));
    })));
    const state = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(new Set(state.files).size, 120, 'every modified file must reach Stop');
    assert.equal(Object.keys(state.baselines).length, 120, 'no parallel capture may drop an earlier baseline');
    const stopped = await runHook('stop', { session_id: session });
    assert.equal(stopped.exitCode, 2);
    assert.match(stopped.stderr, /120 issues/);
  } finally {
    for (const file of [marker, ...sessionLogs(marker)]) rmSync(file, { force: true });
    removeProject(dir);
  }
});

test('a concurrent touch during Stop survives and requires another check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-stop-overlap-'));
  const session = 'overlap' + RUN;
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node check.cjs' } }));
  writeFileSync(join(dir, 'check.cjs'), `
    const { existsSync, writeFileSync } = require('node:fs');
    writeFileSync('check-started', 'ready');
    const deadline = Date.now() + 30000;
    while (!existsSync('touch-finished')) {
      if (Date.now() >= deadline) process.exit(1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  `);
  const first = join(dir, 'src', 'first.ts');
  writeFileSync(first, 'export const value = 1;');
  await runHook('post', { session_id: session, tool_name: 'Write', tool_input: { file_path: first } });
  const hookUrl = new URL('../src/hook.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { runHook } from ${JSON.stringify(hookUrl)};
    process.stdout.write(JSON.stringify(await runHook('stop', { session_id: ${JSON.stringify(session)} })));
  `], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(undefined) : reject(new Error('Stop child failed')));
  });
  try {
    // A loaded machine took over 10 s to reach the project check (full suite, Windows).
    const deadline = Date.now() + 30_000;
    while (!existsSync(join(dir, 'check-started')) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(join(dir, 'check-started')), 'Stop started its real project check');
    const later = join(dir, 'src', 'later.ts');
    writeFileSync(later, 'console.log(1);');
    await runHook('post', { session_id: session, tool_name: 'Write', tool_input: { file_path: later } });
    writeFileSync(join(dir, 'touch-finished'), 'done');
    await completed;
    const result = JSON.parse(output);
    // The same Stop checks the newer state right away: the hold comes from
    // the failure in the later edit, not from the change itself.
    assert.equal(result.exitCode, 2, 'the older passing snapshot cannot approve newer edits');
    assert.match(result.stderr, /later\.ts.*console-log/);
    assert.doesNotMatch(result.stderr, /changed during the checks/);
    assert.ok(JSON.parse(readFileSync(marker, 'utf8')).files.includes(later));
  } finally {
    // Releases the check script the Stop child started, which otherwise keeps
    // the folder open until its own deadline and turns the cleanup into EPERM.
    writeFileSync(join(dir, 'touch-finished'), 'done');
    child.kill();
    await completed.catch(() => undefined);
    for (const file of [marker, ...sessionLogs(marker)]) rmSync(file, { force: true });
    removeProject(dir);
  }
});

test('files that keep changing through both passes end the turn with a note, never a hold', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-stop-churn-'));
  const session = 'churn' + RUN;
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  const hookUrl = new URL('../src/hook.mjs', import.meta.url).href;
  mkdirSync(join(dir, 'src'));
  // Every test run records one more clean edit in the turn, as a background
  // writer would, so each pass sees a newer state than it checked.
  writeFileSync(join(dir, 'churn.mjs'), `
    import { writeFileSync } from 'node:fs';
    import { runHook } from ${JSON.stringify(hookUrl)};
    const file = ${JSON.stringify(join(dir, 'src'))} + '/gen-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ts';
    writeFileSync(file, 'export const v = 1;');
    await runHook('post', { session_id: ${JSON.stringify(session)}, tool_name: 'Write', tool_input: { file_path: file } });
  `);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node churn.mjs' } }));
  const first = join(dir, 'src', 'first.ts');
  writeFileSync(first, 'export const value = 1;');
  await runHook('post', { session_id: session, tool_name: 'Write', tool_input: { file_path: first } });
  try {
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'a change is not a failed check');
    assert.match(result.stderr, /changed during the checks twice in a row/);
    assert.match(result.stdout ?? '', /"systemMessage"/);
  } finally {
    for (const file of [marker, ...sessionLogs(marker)]) rmSync(file, { force: true });
    removeProject(dir);
  }
});

test('a second pass that would not fit the Stop deadline is skipped, with a note', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-stop-deadline-'));
  const session = 'deadline' + RUN;
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  const hookUrl = new URL('../src/hook.mjs', import.meta.url).href;
  mkdirSync(join(dir, 'src'));
  // Each run takes 1.5 s, logs itself and records one more edit in the turn.
  writeFileSync(join(dir, 'slow.mjs'), `
    import { appendFileSync, writeFileSync } from 'node:fs';
    import { runHook } from ${JSON.stringify(hookUrl)};
    appendFileSync('runs.log', 'run\\n');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const file = ${JSON.stringify(join(dir, 'src'))} + '/gen-' + Date.now() + '.ts';
    writeFileSync(file, 'export const v = 1;');
    await runHook('post', { session_id: ${JSON.stringify(session)}, tool_name: 'Write', tool_input: { file_path: file } });
  `);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node slow.mjs' } }));
  const first = join(dir, 'src', 'first.ts');
  writeFileSync(first, 'export const value = 1;');
  await runHook('post', { session_id: session, tool_name: 'Write', tool_input: { file_path: first } });
  process.env.SMUGAN_STOP_DEADLINE_MS = '2000';
  try {
    const result = await runHook('stop', { session_id: session });
    assert.equal(result.exitCode, 0, 'no time left is not a failed check');
    assert.match(result.stderr, /would not fit in the hook deadline/);
    assert.equal(readFileSync(join(dir, 'runs.log'), 'utf8').trim().split('\n').length, 1, 'the checks ran once');
  } finally {
    delete process.env.SMUGAN_STOP_DEADLINE_MS;
    for (const file of [marker, ...sessionLogs(marker)]) rmSync(file, { force: true });
    removeProject(dir);
  }
});

test('a busy session lock has a deadline and reports unavailable instead of approval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-busy-lock-'));
  const session = 'busy' + RUN;
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  writeFileSync(join(dir, 'package.json'), '{}');
  const file = join(dir, 'index.ts');
  writeFileSync(file, 'export const value = 1;');
  mkdirSync(marker + '.lock');
  try {
    const started = Date.now();
    const result = await runHook('post', { session_id: session, tool_name: 'Write', tool_input: { file_path: file } });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout ?? '', /gate unavailable/);
    assert.ok(Date.now() - started < 5000, 'a stalled state writer must not hang the session');
    assert.ok(!existsSync(marker), 'failed writes must not fabricate an empty approval snapshot');
  } finally {
    rmSync(marker + '.lock', { recursive: true, force: true });
    for (const file of sessionLogs(marker)) rmSync(file, { force: true });
    removeProject(dir);
  }
});
