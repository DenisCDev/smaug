// Bridges OpenCode tool calls to the smugan gate engine.
// OpenCode's write/edit args were read off the shipped binary's schemas:
//   write       { filePath, content }
//   edit        { filePath, oldString, newString, replaceAll? }
//   apply_patch { patchText }            (Codex V4A envelope)
// There is no multiedit. The alias handling below is still deliberate: the TUI
// itself reads `filePath || filepath`, MCP servers and third-party plugins
// invent their own names, and a wrong guess must degrade to "not ours", never
// to a wrong verdict.
// The V4A parser is loaded from the gate checkout (same smugan.paths.json that
// names the node binary), so a parser fix in the smugan repo reaches this
// adapter without a reinstall — the same live-engine contract the runner has.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.mjs';

const RUNNER = join(ROOT, 'bin', 'gate-runner.mjs');
const BOM = /^\uFEFF/;

// Coalesce like ??: an explicit null must not shadow a later candidate.
const pick = (...values) => values.find((v) => v !== undefined && v !== null);

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

function nodeBin() {
  try {
    const paths = JSON.parse(
      readFileSync(join(ROOT, 'hooks', 'smugan.paths.json'), 'utf8').replace(BOM, ''),
    );
    if (paths.nodeBin && existsSync(paths.nodeBin)) return paths.nodeBin;
  } catch { /* smugan-ignore empty-catch: no paths file — fall back to whatever node is on PATH */ }
  return 'node';
}

function gateDir() {
  if (process.env.SMUGAN_GATE_DIR) return process.env.SMUGAN_GATE_DIR;
  try {
    const paths = JSON.parse(
      readFileSync(join(ROOT, 'hooks', 'smugan.paths.json'), 'utf8').replace(BOM, ''),
    );
    if (paths.gateDir && existsSync(paths.gateDir)) return paths.gateDir;
  } catch { /* smugan-ignore empty-catch: no paths file — fall back to the in-repo layout */ }
  // Running straight from the repo (adapters/opencode/opencode/), not installed.
  const inRepo = join(ROOT, '..', '..', '..', 'packages', 'gate');
  return existsSync(inRepo) ? inRepo : null;
}

/** @type {Map<string, Promise<any>>} keyed by dir so a test swapping SMUGAN_GATE_DIR is honored */
const patchModules = new Map();

/** The engine's parsePatch, or null when the gate is missing — callers fail open. */
async function loadPatchModule() {
  const dir = gateDir();
  if (!dir) return null;
  let loading = patchModules.get(dir);
  if (!loading) {
    loading = import(pathToFileURL(join(dir, 'src', 'patch.mjs')).href).catch(() => null);
    patchModules.set(dir, loading);
  }
  return loading;
}

/**
 * Assistant state — the OpenCode config dir and the Claude one — is not project
 * code. Boundary-safe: ~/.config/opencode must not swallow ~/.config/opencode-dev.
 */
export function isAssistantState(file) {
  const dirs = [
    process.env.OPENCODE_CONFIG_DIR,
    join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode'),
    process.env.CLAUDE_CONFIG_DIR,
    join(homedir(), '.claude'),
  ].filter(Boolean);
  const target = fold(file);
  return dirs.some((dir) => target.startsWith(fold(dir) + '/'));
}

/**
 * Codex V4A patch → one gate call per file it touches. The parsing itself lives
 * in the engine (packages/gate/src/patch.mjs) — single source of truth shared
 * with the Codex adapter. An entry the parser could not reconstruct (a hunk
 * that only adds lines, a delete, a move target, a damaged section) becomes a
 * Write with no content: nothing is judged, but the gate records how the file
 * arrived and that the turn touched it, so the end-of-turn DoD reads it.
 * Dropped, such a file was seen by nothing at all.
 * A missing gate fails open, like everywhere else in this adapter.
 * @param {string} patchText @param {string} [directory] the session's folder
 * @returns {Promise<{tool_name: string, tool_input: any}[]>}
 */
export async function parsePatch(patchText, directory) {
  const mod = await loadPatchModule();
  if (!mod) return [];
  return mod.parsePatch(patchText).map((entry) => {
    const call = entry.call ?? { tool_name: 'Write', tool_input: { file_path: entry.path } };
    return { ...call, tool_input: { ...call.tool_input, file_path: inSession(entry.path, directory) } };
  });
}

/**
 * OpenCode reads a relative path from the session's folder, which a plugin
 * receives as `directory`. The gate runs in this process's own folder, another
 * one when the server was started elsewhere: left relative, the file would be
 * judged, and recorded for the end of the turn, where it does not exist.
 */
function inSession(file, directory) {
  return typeof directory === 'string' && directory && !isAbsolute(file) ? resolve(directory, file) : file;
}

/**
 * OpenCode tool call → the snake_case shape runHook expects.
 * @param {string} tool @param {any} args @param {string} [directory] the session's folder
 * @returns {Promise<{tool_name: string, tool_input: object}[]>} empty when it isn't a write we can judge
 */
export async function normalize(tool, args, directory) {
  const a = args ?? {};
  if (tool === 'apply_patch' || (typeof a.patchText === 'string' && !a.filePath)) {
    return (await parsePatch(a.patchText, directory)).filter((call) => !isAssistantState(call.tool_input.file_path));
  }

  let file = pick(a.filePath, a.file_path, a.filepath, a.path);
  if (typeof file !== 'string' || !file) return [];
  file = inSession(file, directory);
  const tool_input = {
    file_path: file,
    content: pick(a.content, a.file_text, a.fileText, a.text),
    old_string: pick(a.oldString, a.old_string, a.old_str, a.oldText),
    new_string: pick(a.newString, a.new_string, a.new_str, a.newText),
    replace_all: pick(a.replaceAll, a.replace_all),
    edits: Array.isArray(a.edits)
      ? a.edits.map((e) => ({
          old_string: pick(e.oldString, e.old_string, e.old_str),
          new_string: pick(e.newString, e.new_string, e.new_str),
          replace_all: pick(e.replaceAll, e.replace_all),
        }))
      : undefined,
  };

  // Known tools first; then infer from payload shape, so a third-party or MCP
  // tool that writes files with the usual fields is still gated.
  let tool_name = tool === 'write' ? 'Write' : tool === 'edit' ? 'Edit' : '';
  if (!tool_name) {
    if (Array.isArray(tool_input.edits)) tool_name = 'MultiEdit';
    else if (typeof tool_input.old_string === 'string') tool_name = 'Edit';
    else if (typeof tool_input.content === 'string') tool_name = 'Write';
    else return [];
  }
  if (isAssistantState(file)) return [];
  return [{ tool_name, tool_input }];
}

/**
 * Runs one gate pass in a child node process. Never throws and never blocks
 * longer than timeoutMs: a crash or garbage on stdout is a clean pass, because
 * a broken smugan must not break the session. A pass cut at timeoutMs blocks
 * nothing either, but says so (`timedOut`): what never finished verified nothing.
 * `context` is present only in warn mode: findings that did not block.
 * @returns {Promise<{exitCode: number, stderr: string, context?: string, timedOut?: boolean}>}
 */
export function runGate(kind, input, { timeoutMs = 30000 } = {}) {
  return new Promise((resolvePromise) => {
    const done = (result) => resolvePromise(result ?? { exitCode: 0, stderr: '' });
    let child;
    try {
      // The engine's Stop plans a second check only when both fit its
      // deadline; ours kills the child at timeoutMs, so it gets ours.
      const env = kind === 'stop' ? { ...process.env, SMUGAN_STOP_DEADLINE_MS: String(Math.max(1000, timeoutMs - 10_000)) } : process.env;
      child = spawn(nodeBin(), [RUNNER], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env });
    } catch {
      return done();
    }
    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* smugan-ignore empty-catch: the child may already be gone */ }
      finish({ exitCode: 0, stderr: '', timedOut: true });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => finish());
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out.trim());
        finish({ exitCode: Number(parsed.exitCode) || 0, stderr: String(parsed.stderr ?? ''), ...(parsed.context ? { context: String(parsed.context) } : {}) });
      } catch {
        finish();
      }
    });
    try {
      child.stdin.on('error', () => finish());
      child.stdin.end(JSON.stringify({ kind, input }));
    } catch {
      finish();
    }
  });
}
