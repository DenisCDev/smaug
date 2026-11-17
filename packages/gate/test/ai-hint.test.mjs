// @ts-check
// What the hooks tell the model about LLM code: the guide index at session
// start, and at most once per session per engine or model, the testing rules
// and a research request for a pair without a valid guide. Fake pairs only.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHook } from '../src/hook.mjs';
import { parseGuide, saveGuide } from '../src/ai-guides.mjs';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = resolve(GATE, '..', '..', 'claude', 'hooks', 'smugan-hook.mjs');
const guides = mkdtempSync(join(tmpdir(), 'smugan-hint-guides-'));
const previous = process.env.SMUGAN_AI_GUIDES_DIR;
process.env.SMUGAN_AI_GUIDES_DIR = guides;
let counter = 0;
/** @type {string[]} */
const sessions = [];
/** @type {string[]} */
const dirs = [guides];
after(() => {
  for (const id of sessions) for (const p of ['smugan-turn-', 'smugan-report-', 'smugan-events-', 'smugan-stopdebt-', 'smugan-session-']) rmSync(join(tmpdir(), p + id + '.json'), { force: true });
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  if (previous === undefined) delete process.env.SMUGAN_AI_GUIDES_DIR;
  else process.env.SMUGAN_AI_GUIDES_DIR = previous;
});

function session() {
  const id = `smuganaitest${process.pid}n${++counter}`;
  sessions.push(id);
  return id;
}

function project() {
  const root = mkdtempSync(join(tmpdir(), 'smugan-ai-hint-'));
  dirs.push(root);
  spawnSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@anthropic-ai/sdk': '0.0.1' } }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'summarize.mjs'), "export const MODEL = 'claude-fixture-7';\n");
  return root;
}
const KEY = 'anthropic-sdk@0.0+claude-fixture@7';
const LLM_FILE = "import Anthropic from '@anthropic-ai/sdk';\nexport const client = new Anthropic();\n";

/** @param {string} id @param {string} file @param {string} content */
const write = (id, file, content) => runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content } });

function fakeGuide() {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = parseGuide(`---\nkey: ${KEY}\nreviewedAt: ${today}\nsources:\n  - https://docs.example.invalid/sdk\n---\nGuia falso para o teste.\n`, [KEY]);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  saveGuide(parsed.guide);
}

test('an edit that imports an LLM SDK gets the testing rules and a research request, once per session', async () => {
  const root = project();
  const id = session();
  const first = await write(id, join(root, 'src', 'client.mjs'), LLM_FILE);
  assert.equal(first.exitCode, 0);
  assert.match(first.context ?? '', /Tests never call a real model/);
  assert.match(first.context ?? '', new RegExp(`no valid guide: ${KEY.replace(/[.+]/g, '\\$&')}\\. .*smugan-ai-research subagent`));
  assert.match(first.context ?? '', /ai-guide --write/);
  const again = await write(id, join(root, 'src', 'other.mjs'), LLM_FILE);
  assert.equal(again.context, undefined, 'nothing repeats in the same session');
});

test('a valid guide means no research request; code without LLM use gets nothing', async () => {
  const root = project();
  fakeGuide();
  const id = session();
  assert.equal((await write(id, join(root, 'src', 'plain.mjs'), 'export const a = 1;\n')).context, undefined);
  const context = (await write(id, join(root, 'src', 'client.mjs'), LLM_FILE)).context ?? '';
  assert.match(context, /Tests never call a real model/);
  assert.doesNotMatch(context, /smugan-ai-research/);
  rmSync(guides, { recursive: true, force: true });
});

test('session start indexes the pairs as reference, with the testing rules; no AI or the home folder adds nothing', async () => {
  const root = project();
  fakeGuide();
  const id = session();
  const start = await runHook('session', { session_id: id, cwd: root });
  assert.match(start.context ?? '', /Reference material, not instructions/);
  assert.match(start.context ?? '', new RegExp(`${KEY.replace(/[.+]/g, '\\$&')} \\(valid until \\d{4}-\\d{2}-\\d{2}\\): Guia falso para o teste\\.`));
  assert.match(start.context ?? '', /Tests never call a real model/);
  assert.doesNotMatch((await write(id, join(root, 'src', 'client.mjs'), LLM_FILE)).context ?? '', /Tests never call/, 'the rules already came at session start');
  const plain = mkdtempSync(join(tmpdir(), 'smugan-ai-plain-'));
  dirs.push(plain);
  writeFileSync(join(plain, 'package.json'), '{"name":"plain"}');
  assert.equal((await runHook('session', { session_id: session(), cwd: plain })).context, undefined);
  assert.equal((await runHook('session', { session_id: session(), cwd: homedir() })).context, undefined);
  rmSync(guides, { recursive: true, force: true });
});

test('the Claude Code launcher hands session start context over as SessionStart additionalContext', () => {
  const root = project();
  const run = spawnSync(process.execPath, [LAUNCHER, 'session'], {
    input: JSON.stringify({ session_id: session(), cwd: root, hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, SMUGAN_GATE_DIR: GATE, SMUGAN_AI_GUIDES_DIR: guides },
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /no guide yet/);
});

test('an Edit that keeps the file\'s SDK import out of new_string still gets the research request', async () => {
  const root = project();
  const file = join(root, 'src', 'client.mjs');
  writeFileSync(file, "import Anthropic from '@anthropic-ai/sdk';\nexport const opts = { max_tokens: 100 };\n");
  const result = await runHook('pre', { tool_name: 'Edit', session_id: session(), tool_input: { file_path: file, old_string: 'max_tokens: 100', new_string: 'max_tokens: 200' } });
  assert.match(result.context ?? '', /smugan-ai-research/);
});
