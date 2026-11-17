#!/usr/bin/env node
// smugan-grok hook entry — thin launcher installed at ~/.grok/hooks/.
// Bridges Grok Build's hook contract to the smugan gate engine, loaded from the
// smugan repo (path written by install.sh into smugan.paths.json next to this
// file). Two Grok Build facts drive the design (docs.x.ai/build/features/hooks):
//   1. stdin arrives camelCase (toolName/toolInput) and tool names may be
//      Grok-native — the payload is normalized into the Claude shape the gate
//      expects, inferring the edit kind from the payload when the name is unknown.
//   2. PreToolUse is the ONLY blocking event and passive-hook output is ignored,
//      so failures from the passive events — `post` (project eslint/tsc) and
//      `stop` (the gate's mechanical Definition of Done: gate re-check,
//      typecheck, tests) — are stored per-session and delivered as a one-shot
//      deny on the next PreToolUse. A block is voiced as
//      {"decision":"deny","reason"} + exit 2.
// `pre` also teaches the stack rules (rule-teach.mjs): Grok Build has no
// path-scoped rule loading, so the first session edit of a matching file is
// denied once with the rule paths to read.
// SessionEnd is the only unconditional cleanup: the turn marker deliberately
// survives turns while the DoD is red (Stop cannot hold the turn here), but
// nothing survives the session.
// Fails open: an internal smugan error must never block the session.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ruleTeach } from './rule-teach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2];
const KIND = ARG === 'pre' || ARG === 'stop' || ARG === 'sessionend' ? ARG : 'post';
const BOM = /^\uFEFF/;

function gateDir() {
  if (process.env.SMUGAN_GATE_DIR) return process.env.SMUGAN_GATE_DIR;
  try {
    const paths = JSON.parse(
      readFileSync(join(HERE, 'smugan.paths.json'), 'utf8').replace(BOM, ''),
    );
    // The install's UI language decides which language-specific checks run.
    if (process.env.SMUGAN_UI_LANG === undefined && typeof paths.uiLanguage === 'string') process.env.SMUGAN_UI_LANG = paths.uiLanguage;
    // The install's SMUGAN_DISABLE list keeps the gate's reminders off disabled reviewers.
    if (process.env.SMUGAN_DISABLE === undefined && Array.isArray(paths.disable)) process.env.SMUGAN_DISABLE = paths.disable.join(',');
    if (paths.gateDir && existsSync(paths.gateDir)) return paths.gateDir;
  } catch { /* smugan-ignore empty-catch: no paths file — fall back to the in-repo layout */ }
  // Running straight from the repo (adapters/grok/grok/hooks/), not installed.
  const inRepo = join(HERE, '..', '..', '..', '..', 'packages', 'gate');
  return existsSync(inRepo) ? inRepo : null;
}

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = '';
    const done = () => resolvePromise(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    // Windows shells can swallow stdin EOF for hook processes — never hang the session.
    setTimeout(done, 2000).unref();
  });
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// Coalesce like ??: an explicit null (e.g. "sessionId": null) must not shadow
// a usable candidate later in the chain, such as the GROK_SESSION_ID env.
const pick = (...values) => values.find((v) => v !== undefined && v !== null);

function normalizeEdit(edit) {
  return {
    old_string: pick(edit.old_string, edit.oldString, edit.old_str, edit.oldText),
    new_string: pick(edit.new_string, edit.newString, edit.new_str, edit.newText),
    replace_all: pick(edit.replace_all, edit.replaceAll),
  };
}

// Grok sends camelCase; Claude-compat payloads send snake_case. Accept both,
// and when the tool name is not a Claude one, infer the edit kind from shape.
function normalize(raw) {
  const t = pick(raw.tool_input, raw.toolInput) ?? {};
  const input = {
    session_id: pick(raw.session_id, raw.sessionId, process.env.GROK_SESSION_ID) ?? '',
    // True only on a Stop the host says continues a held turn. Any other Stop
    // ends a turn of its own, and the gate checks it whatever an earlier one spent.
    stop_hook_active: pick(raw.stop_hook_active, raw.stopHookActive) === true,
    tool_name: pick(raw.tool_name, raw.toolName) ?? '',
    tool_input: {
      file_path: pick(t.file_path, t.filePath, t.path),
      // `contents` is the Cursor preset's Write (Grok Build hooks guide: "`Write` holds the text in `contents`").
      content: pick(t.content, t.contents, t.file_text, t.fileText, t.text),
      old_string: pick(t.old_string, t.oldString, t.old_str, t.oldText),
      new_string: pick(t.new_string, t.newString, t.new_str, t.newText),
      replace_all: pick(t.replace_all, t.replaceAll),
      edits: Array.isArray(t.edits) ? t.edits.map(normalizeEdit) : undefined,
    },
  };
  if (!EDIT_TOOLS.has(input.tool_name) && typeof input.tool_input.file_path === 'string') {
    if (Array.isArray(input.tool_input.edits)) input.tool_name = 'MultiEdit';
    else if (typeof input.tool_input.old_string === 'string') input.tool_name = 'Edit';
    else if (typeof input.tool_input.content === 'string') input.tool_name = 'Write';
  }
  return input;
}

/**
 * The files of a Codex-toolset apply_patch, one gate call each. The tool takes
 * the whole envelope in `patch` (the Grok Build 1.0.77 binary describes its
 * ApplyPatchInput as "The patch text in codex patch format"), with paths
 * relative to the session's folder, which the event carries in `cwd`. A file
 * the parser cannot rebuild becomes a Write with no content: nothing is
 * judged, but the gate records the touch and the end of the turn reads it.
 */
async function patchCalls(raw, dir) {
  const t = pick(raw.tool_input, raw.toolInput) ?? {};
  const text = pick(t.patch, t.patchText);
  if (typeof text !== 'string') return [];
  const { parsePatch } = await import(pathToFileURL(join(dir, 'src', 'patch.mjs')).href);
  const base = typeof raw.cwd === 'string' && raw.cwd ? raw.cwd : process.cwd();
  return parsePatch(text).map(({ path, call }) => ({
    tool_name: call ? call.tool_name : 'Write',
    tool_input: { ...call?.tool_input, file_path: resolve(base, path) },
  }));
}

// --- deferred failures: written by the passive events, delivered once by `pre` ---

// How much of the end-of-turn verdicts nobody read yet is kept beside the newest one.
const EARLIER_VERDICT_CHARS = 32 * 1024;

const safeSid = (sessionId) =>
  String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);

function pendingPath(sessionId) {
  const safe = safeSid(sessionId);
  return safe ? join(tmpdir(), 'smugan-grok-pending-' + safe + '.json') : null;
}

function readPending(marker) {
  try {
    const state = JSON.parse(readFileSync(marker, 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

// Read-modify-write without a lock: concurrent passive events can drop an
// entry (last write wins) — acceptable for an advisory channel; the check
// re-fails on the next touch of that file (or the next Stop).
function setPending(marker, key, text) {
  const pending = existsSync(marker) ? readPending(marker) : {};
  if (text) pending[key] = text;
  else delete pending[key];
  if (Object.keys(pending).length > 0) writeFileSync(marker, JSON.stringify(pending));
  else if (existsSync(marker)) unlinkSync(marker);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
  process.stderr.write(reason);
  process.exit(2);
}

try {
  const text = (await readStdin()).replace(BOM, '').trim();
  const raw = text ? JSON.parse(text) : {};
  const input = normalize(raw);
  const marker = pendingPath(input.session_id);

  // SessionEnd: the one unconditional cleanup point — turn state and the
  // failures already held (both owned by the gate), deferred failures and
  // surfaced rules all die with the session.
  if (KIND === 'sessionend') {
    const safe = safeSid(input.session_id);
    if (safe) {
      for (const prefix of ['smugan-turn-', 'smugan-stopdebt-', 'smugan-grok-pending-', 'smugan-grok-rules-']) {
        try {
          unlinkSync(join(tmpdir(), prefix + safe + '.json'));
        } catch { /* smugan-ignore empty-catch: nothing to clean — best-effort */ }
      }
    }
    process.exit(0);
  }

  // Grok Build fires one more Stop when the session closes (`reason` is then
  // "shutdown" or "channel_closed"), with 1.5 s and no turn left to tell
  // anything to: the checks would be started and cut. Only a turn's end is checked.
  if (KIND === 'stop' && typeof raw.reason === 'string' && raw.reason !== 'end_turn') process.exit(0);

  const dir = gateDir();
  if (!dir) process.exit(0);
  const { runHook } = await import(pathToFileURL(join(dir, 'src', 'hook.mjs')).href);

  // Grok's own state (memory, AGENTS.md, installed rules) is not project code.
  // Boundary-safe prefix: ~/.grok must not swallow siblings like ~/.grok-app,
  // and case folds only where the filesystem does (win32).
  const fold = (p) => {
    const normed = resolve(p).replace(/\\/g, '/');
    return process.platform === 'win32' ? normed.toLowerCase() : normed;
  };
  const grokHome = process.env.GROK_HOME || join(homedir(), '.grok');
  const grokDir = fold(grokHome) + '/';
  const file = input.tool_input.file_path;
  // What this call writes: the one file of an edit tool, or every file of a patch.
  const patched = typeof file === 'string' || KIND === 'stop' ? [] : await patchCalls(raw, dir);
  const writes = typeof file === 'string' ? [{ tool_name: input.tool_name, tool_input: input.tool_input }] : patched;
  const calls = writes.filter((call) => !fold(call.tool_input.file_path).startsWith(grokDir));
  if (writes.length > 0 && calls.length === 0) {
    process.exit(0);
  }
  // A call that writes nothing still reaches the gate once, as it arrived.
  const judged = calls.length > 0 ? calls.map((call) => ({ session_id: input.session_id, ...call })) : [input];

  if (KIND === 'pre' && marker && existsSync(marker)) {
    const pending = readPending(marker);
    const texts = Object.entries(pending)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([key, v]) => (key === 'stop-earlier' ? 'An earlier end of turn had also reported this, which nobody had read yet:\n' + v : v));
    try {
      unlinkSync(marker);
    } catch { /* smugan-ignore empty-catch: marker cleanup is best-effort */ }
    if (texts.length > 0) {
      deny(
        'smugan: the checks after earlier edits or at the end of the turn left failures or warnings pending. Review them before continuing:\n\n' +
        texts.join('\n') +
        '\nThis notice blocks once; repeat the same call to continue.\n',
      );
    }
  }

  // Stack-rule teaching comes after the debt above (broken code first) and
  // before the gate check (one deny per edit, not two).
  if (KIND === 'pre') {
    // The host cuts a tool input over 128 KiB and says so. The files past the
    // cut of a patch can be neither judged nor recorded for the end of the turn.
    // A patch opens with its first file, so a cut one still names at least that.
    if (patched.length > 0 && raw.toolInputTruncated === true) {
      deny('smugan: this patch is larger than what Grok Build hands to a hook, so the files past the cut cannot be checked now or recorded for the end of the turn. Apply it as several smaller patches.\n');
    }
    for (const call of calls) {
      const reason = EDIT_TOOLS.has(call.tool_name) ? ruleTeach(call.tool_input.file_path, input.session_id, grokHome) : null;
      if (reason) deny(reason);
    }
    const failures = [];
    for (const call of judged) {
      const { exitCode, stderr } = await runHook('pre', call);
      if (exitCode === 2) failures.push(stderr);
    }
    if (failures.length > 0) deny(failures.join('\n'));
    process.exit(0);
  }
  if (KIND === 'stop') {
    const { exitCode, stderr } = await runHook('stop', input);
    // Stop is passive here: the gate's DoD verdict cannot hold the turn. A red
    // DoD parks under the reserved 'stop' key (post entries are resolve()d
    // absolute paths — never the bare string 'stop') for the next pre. Parked
    // debt is ONLY removed by delivery (pre) or SessionEnd — never here: a
    // tool-free turn has no pre, so exit 0 can mean incomplete checks, the
    // block cap, or nothing left to check. Keep advisory output separately so
    // it reaches the next pre without overwriting an undelivered red verdict.
    if (marker && exitCode === 2 && stderr) {
      // A verdict nobody read yet is the only place that says what the gate
      // lists once per turn (a removed test, residue, drift, a clone), so the
      // new one is parked beside it, not over it. The oldest come first: they
      // are the ones kept when more than EARLIER_VERDICT_CHARS pile up.
      const unread = readPending(marker);
      const earlier = [unread['stop-earlier'], unread.stop].filter((v) => typeof v === 'string' && v.trim()).join('\n').slice(0, EARLIER_VERDICT_CHARS);
      setPending(marker, 'stop', stderr);
      setPending(marker, 'stop-earlier', earlier);
    }
    if (marker && exitCode === 0 && stderr) setPending(marker, 'stop-notice', stderr);
    process.exit(0);
  }
  // post: passive in Grok Build — record failures for the next pre, exit 0.
  // A patch's files are read from disk, as the host left them.
  for (const call of judged) {
    const path = call.tool_input.file_path;
    const { exitCode, stderr } = await runHook('post', patched.length > 0 ? { session_id: input.session_id, tool_name: 'Write', tool_input: { file_path: path } } : call);
    if (marker && typeof path === 'string') setPending(marker, resolve(path), exitCode === 2 && stderr ? stderr : null);
  }
  process.exit(0);
} catch {
  process.exit(0);
}
