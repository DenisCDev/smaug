#!/usr/bin/env node
// smugan hook entry for Google Antigravity — installed at <gemini>/smugan/hooks/.
// One launcher, three events, chosen by argv because the payload does not carry
// the event name (verified by Google DevRel's own hook write-up).
//
// Three platform facts drive every line below (antigravity.google/docs/hooks):
//   1. PreToolUse is a real veto: {"decision":"deny","reason"} stops the write.
//      `decision` is mandatory — a bare {} is NOT allow (cmux#5358).
//   2. A non-zero exit is FAIL-CLOSED: a hook that crashes has been observed
//      denying every tool call in the session (cmux#4768). So this process
//      exits 0 on every path, always, and speaks only through stdout JSON.
//      stderr stays empty: on a fail-closed host, noise is risk without upside.
//   3. Stop can HOLD the turn with {"decision":"continue","reason"} — the one
//      thing Grok Build and OpenCode cannot do. That makes the mechanical
//      Definition of Done as binding here as it is in Claude Code.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalize, pathsOf, sessionId } from './normalize.mjs';
import { ruleTeach } from './rule-teach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2];
const KIND = ARG === 'pre' || ARG === 'stop' ? ARG : 'post';
const BOM = /^\uFEFF/;

// The launcher's own ceiling, on top of the gate's cap (1 hold, 2 when a
// critical file was touched). It exists because
// the gate re-arms its counter whenever a new turn marker appears, so an agent
// that keeps writing files could otherwise be held forever — and on a free tier
// metered by "work done", forever is the expensive kind of bug. It is scoped to
// the TURN, not the conversation: it dies with the gate's turn marker, so one
// stubborn turn can never switch the Definition of Done off for the rest of the
// session.
const MAX_CONTINUES = 4;
const STATE_TTL_MS = 12 * 60 * 60 * 1000; // no SessionEnd event here: expire by age
// Deliberately narrow. This decides whether the DoD runs at all, and the
// terminationReason enum is undocumented, so it matches only words that mean
// "this turn was killed" — never a bare `user` or `error`, which would also
// match perfectly normal endings like "awaiting_user_input" or "no_errors" and
// silently disable the whole feature.
// Word boundaries are useless here because `_` counts as a word character, so
// \bcancel would miss "user_cancelled" — the most likely spelling of all.
const ABORTED = /(?:^|[^a-z])(?:abort(?:ed)?|cancel(?:l?ed)?|interrupt(?:ed)?|kill(?:ed)?|timed?[_-]?out|quota|rate[_-]?limit(?:ed)?|denied|refused)(?:[^a-z]|$)/i;

// --- output: exactly one write, then exit 0 -------------------------------

// The gate does not cap its violation list, and a single write can produce a
// megabyte of reasons. That helps nobody: the model acts on the first few, and
// an oversized payload risks the host's own read buffer. Keep it useful and say
// what was left out.
const MAX_REASON_CHARS = 24000;

// Clamping cuts the tail, so every message that carries an instruction puts it
// FIRST — a truncated message must never lose the part that says what to do.
function clamp(reason) {
  const text = String(reason ?? '');
  if (text.length <= MAX_REASON_CHARS) return text;
  const lines = text.slice(MAX_REASON_CHARS).split('\n').length;
  return text.slice(0, MAX_REASON_CHARS) + '\n\n… (' + lines + ' more lines omitted — fix what is listed above.)';
}

function out(payload) {
  // writeSync, not process.stdout.write: a pipe write can be asynchronous, and
  // process.exit would truncate it — malformed JSON on a host that has been seen
  // denying every tool call over exactly that. Deny reasons get large (the gate
  // does not cap its violation list), so this is reachable, not theoretical.
  // Being synchronous also keeps `out()` a hard stop, so no caller can fall
  // through and emit a second object.
  try {
    writeSync(1, JSON.stringify(payload));
  } catch { /* smugan-ignore empty-catch: stdout is gone — nothing left to say */ }
  process.exit(0);
}

// Both schemas in one object: the current docs use decision/reason, a June 2026
// guide documents allow_tool/deny_reason. The engine is Go and ignores unknown
// keys, so ~40 bytes remove an entire class of version risk.
const emitAllow = () => out({ decision: 'allow', allow_tool: true });
const emitDeny = (raw) => {
  const reason = clamp(raw);
  out({ decision: 'deny', reason, allow_tool: false, deny_reason: reason });
};
const emitNoop = () => out({});
const emitHold = (reason) => out({ decision: 'continue', reason: clamp(reason) });

/** The safe answer for this event when something went wrong internally. */
const emitSafe = () => (KIND === 'pre' ? emitAllow() : emitNoop());

// --- plumbing -------------------------------------------------------------

function paths() {
  try {
    return JSON.parse(readFileSync(join(HERE, 'smugan.paths.json'), 'utf8').replace(BOM, ''));
  } catch {
    return {};
  }
}

function gateDir() {
  if (process.env.SMUGAN_GATE_DIR) return process.env.SMUGAN_GATE_DIR;
  const installed = paths();
  // The install's UI language decides which language-specific checks run.
  if (process.env.SMUGAN_UI_LANG === undefined && typeof installed.uiLanguage === 'string') process.env.SMUGAN_UI_LANG = installed.uiLanguage;
  // The install's SMUGAN_DISABLE list keeps the gate's reminders off disabled reviewers.
  if (process.env.SMUGAN_DISABLE === undefined && Array.isArray(installed.disable)) process.env.SMUGAN_DISABLE = installed.disable.join(',');
  const dir = installed.gateDir;
  return dir && existsSync(dir) ? dir : null;
}

function rulesDir() {
  if (process.env.SMUGAN_RULES_DIR) return process.env.SMUGAN_RULES_DIR;
  const dir = paths().rulesDir;
  return dir && existsSync(dir) ? dir : null;
}

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = '';
    const done = () => resolvePromise(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    // Windows shells can swallow stdin EOF for hook subprocesses — never hang.
    setTimeout(done, 2000).unref();
  });
}

const safeSid = (sid) => String(sid ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);

const pendingPath = (sid) => (safeSid(sid) ? join(tmpdir(), 'smugan-agy-pending-' + safeSid(sid) + '.json') : null);
const statePath = (sid) => (safeSid(sid) ? join(tmpdir(), 'smugan-agy-' + safeSid(sid) + '.json') : null);
// The gate's own per-turn marker — the launcher only ever reads its existence.
const turnMarkerPath = (sid) => join(tmpdir(), 'smugan-turn-' + safeSid(sid) + '.json');

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function tryUnlink(file) {
  try {
    unlinkSync(file);
  } catch { /* smugan-ignore empty-catch: cleanup is best-effort by definition */ }
}

/** Deferred failures from the passive event, keyed by resolved file path. */
function setPending(marker, key, text) {
  if (!marker) return;
  const pending = existsSync(marker) ? readJson(marker) : {};
  if (text) pending[key] = text;
  else delete pending[key];
  if (Object.keys(pending).length > 0) writeFileSync(marker, JSON.stringify(pending));
  else if (existsSync(marker)) tryUnlink(marker);
}

/** Takes every parked failure and clears the marker, so each is delivered once. */
function drainPending(marker) {
  if (!marker || !existsSync(marker)) return '';
  const texts = Object.values(readJson(marker)).filter((v) => typeof v === 'string' && v.trim());
  tryUnlink(marker);
  return texts.join('\n');
}

function readState(file) {
  if (!file || !existsSync(file)) return { continues: 0 };
  const state = readJson(file);
  const age = Date.now() - (Number(state.updatedAt) || 0);
  if (age > STATE_TTL_MS) return { continues: 0 };
  return { continues: Number(state.continues) || 0 };
}

function bumpState(file, continues) {
  if (!file) return;
  try {
    writeFileSync(file, JSON.stringify({ continues, updatedAt: Date.now() }));
  } catch { /* smugan-ignore empty-catch: losing the counter is survivable, crashing is not */ }
}

/** Raw payload dump — the one debug affordance, for whoever has the product. */
function dump(kind, raw) {
  const dir = process.env.SMUGAN_AGY_DUMP;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, kind + '-' + Date.now() + '.json'), raw);
  } catch { /* smugan-ignore empty-catch: diagnostics must never break the hook */ }
}

// --- main -----------------------------------------------------------------

try {
  const raw = (await readStdin()).replace(BOM, '').trim();
  dump(KIND, raw);
  const payload = raw ? JSON.parse(raw) : {};
  const sid = sessionId(payload);
  const pending = pendingPath(sid);

  const dir = gateDir();
  if (!dir) emitSafe();
  const { runHook } = await import(pathToFileURL(join(dir, 'src', 'hook.mjs')).href);

  if (KIND === 'stop') {
    // Stop fires at loop stopping conditions, not only at a real end of turn.
    // Running typecheck + tests on each one would burn quota for nothing.
    if (payload.fullyIdle === false) emitNoop();
    // Never resurrect a turn the user killed, or one that died on its own.
    if (payload.error || ABORTED.test(String(payload.terminationReason ?? ''))) emitNoop();

    const stateFile = statePath(sid);
    const marker = turnMarkerPath(sid);
    // Nothing was touched: nothing to check, and no budget to carry.
    if (!existsSync(marker)) {
      tryUnlink(stateFile);
      emitNoop();
    }

    const { continues } = readState(stateFile);
    // Ceiling reached. Reset BOTH sides before releasing: leaving either the
    // counter or the gate's marker behind makes this an absorbing state, where
    // one hard turn silently switches the Definition of Done off for every turn
    // that follows. The gate does the same thing when it gives up.
    if (continues >= MAX_CONTINUES) {
      tryUnlink(stateFile);
      tryUnlink(marker);
      emitNoop();
    }

    // Every hold goes through here, so the budget can never be bypassed —
    // an unbounded hold on a host metered by "work done" is the expensive bug.
    const hold = (reason) => {
      bumpState(stateFile, continues + 1);
      emitHold(reason + '\n\n(smugan is holding this turn open, attempt ' +
        (continues + 1) + '/' + MAX_CONTINUES + '.)');
    };

    const { exitCode, stderr } = await runHook('stop', { session_id: sid });

    if (exitCode === 2 && stderr) hold(stderr.trim() + '\n\nFix the above, then finish.');
    if (stderr && stderr.trim()) {
      // exit 0 WITH stderr is the gate's own cap: it gave up and already removed
      // the turn marker. Its message literally says "tell the user what is still
      // broken" — dropping it would produce exactly the silent "done" this whole
      // system exists to prevent.
      hold(stderr.trim() + '\n\nsmugan is about to stop holding this turn. Do NOT attempt more fixes: ' +
        'end by telling the user plainly what is still broken and what you tried.');
    }

    // Green from the gate — but a check failure parked earlier still has to be
    // said, or a turn that ended with read-only tools would swallow it.
    const debt = drainPending(pending);
    if (debt) {
      hold('smugan: the project\'s own checks failed on an earlier write in this turn:\n\n' + debt);
    }
    tryUnlink(stateFile);
    emitNoop();
  }

  const calls = normalize(payload);

  if (KIND === 'pre') {
    // Broken code first, new rules second — and never two denials for one edit.
    const debt = drainPending(pending);
    if (debt) {
      // Instruction first: this text can be clamped, and losing "retry the same
      // call" would leave the agent stuck on a block it does not understand.
      emitDeny('smugan: fix the problems below, then retry this exact call — this message blocks once.\n' +
        'They come from the project\'s own checks, which run after a write and cannot speak there.\n\n' + debt);
    }
    // Driven by paths, like post — a shape we cannot model is still a file being
    // written, and it must reach the gate here even though there is no verdict
    // to give. `preHook` anchors the turn's baseline before it decides anything,
    // so skipping it would leave the end-of-turn check with no record of how the
    // file arrived: it would fall back to git HEAD and blame this turn for
    // someone else's uncommitted debt. It also owes the file its stack rules.
    const paths = pathsOf(payload);
    if (paths.length === 0) emitAllow();

    // Teach for the first path that any rule actually governs, not simply the
    // first path: in a mixed batch the ungoverned file would otherwise consume
    // the one teach this call gets and the governed one would be skipped.
    const rules = rulesDir();
    let teach = null;
    for (const file of paths) {
      teach = ruleTeach(file, sid, rules);
      if (teach) break;
    }
    if (teach) emitDeny(teach);

    const modelled = new Map(calls.map((call) => [call.tool_input.file_path, call]));
    const reasons = [];
    for (const file of paths) {
      // No modelled edit → a Write with no content: the gate records the
      // baseline and returns clean, because there is nothing to judge.
      const call = modelled.get(file) ?? { tool_name: 'Write', tool_input: { file_path: file } };
      const { exitCode, stderr } = await runHook('pre', { ...call, session_id: sid });
      if (exitCode === 2 && stderr) reasons.push(stderr.trim());
    }
    if (reasons.length > 0) emitDeny(reasons.join('\n\n'));
    emitAllow();
  }

  // post: passive. It cannot speak, but it is what records the touched file —
  // without it the end-of-turn Definition of Done has nothing to check. It is
  // driven by paths, not by parsed edits: a shape we could not model is still a
  // file that was written, and skipping it here would silently cost the whole
  // end-of-turn check for that turn.
  for (const file of pathsOf(payload)) {
    const { exitCode, stderr } = await runHook('post', {
      tool_name: 'Write',
      tool_input: { file_path: file },
      session_id: sid,
    });
    setPending(pending, resolve(file), exitCode === 2 && stderr ? stderr.trim() : null);
  }
  emitNoop();
} catch {
  emitSafe();
}
