#!/usr/bin/env node
// smugan-codex hook entry — thin launcher installed at ~/.codex/hooks/.
// Bridges Codex's hook contract to the smugan gate engine, loaded from the
// smugan repo (path written by the installer into smugan.paths.json next to this
// file). Codex facts that drive the design (read off openai/codex@main):
//   1. File edits arrive as ONE apply_patch call whose tool_input.command is
//      the raw V4A envelope — the engine's parsePatch turns it into per-file
//      judgments (packages/gate/src/patch.mjs). Paths inside the patch are
//      relative to the SESSION's cwd, which the payload carries — they are
//      resolved against input.cwd, never against this process's own cwd.
//   2. Every event answers with stdout JSON. PreToolUse blocks via
//      permissionDecision "deny" and can ALSO inject context without blocking
//      (additionalContext) — which is how the stack rules teach here, with no
//      denied call. PostToolUse and Stop block via {"decision":"block"}.
//   3. Unlike Grok/Antigravity there is no deferred-debt machinery: pre
//      blocks for real and Stop holds the turn for real, same as Claude Code.
//      The engine's per-turn cap (1 hold, 2 when a critical file was touched) is the loop guard on Stop
//      (stop_hook_active needs no extra handling on top of it).
//   4. SessionEnd has a 1-second budget (codex-rs events/session_end.rs), so
//      it only unlinks markers and reads stdin with a short cap.
// Every entry from a patch records a TOUCH at post time even when the parser
// could not reconstruct its content: the project's checks then run against
// the real file on disk and the Stop-hook DoD re-examines it — a parser
// failure degrades to a later check, never to a silent skip.
// Fails open: an internal smugan error must never block the session.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ruleTeach } from './rule-teach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2];
const KIND = ARG === 'pre' || ARG === 'stop' || ARG === 'sessionend' ? ARG : 'post';
const BOM = new RegExp('^' + String.fromCharCode(0xfeff));

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
  // Running straight from the repo (adapters/codex/codex/hooks/), not installed.
  const inRepo = join(HERE, '..', '..', '..', '..', 'packages', 'gate');
  return existsSync(inRepo) ? inRepo : null;
}

function readStdin(capMs) {
  return new Promise((resolvePromise) => {
    let data = '';
    const done = () => resolvePromise(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    // Windows shells can swallow stdin EOF for hook processes — never hang the
    // session. SessionEnd gets a short cap: its whole budget is one second.
    setTimeout(done, capMs).unref();
  });
}

// Coalesce like ??: an explicit null must not shadow a usable candidate.
const pick = (...values) => values.find((v) => v !== undefined && v !== null);

const safeSid = (sessionId) =>
  String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

/**
 * Codex's own state is not project code. Boundary-safe prefixes: ~/.codex must
 * not swallow siblings like ~/.codex-app, and ~/.agents holds skills.
 */
function isAssistantState(file, codexHome) {
  const dirs = [codexHome, join(homedir(), '.agents')];
  const target = fold(file);
  return dirs.some((dir) => target.startsWith(fold(dir) + '/'));
}

function emit(json) {
  process.stdout.write(JSON.stringify(json));
}

function diagnostic(result) {
  if (result.exitCode !== 0) return null;
  if (result.stdout) {
    const output = JSON.parse(result.stdout);
    if (typeof output.systemMessage === 'string') return output.systemMessage;
  }
  return result.stderr || null;
}

try {
  const raw = (await readStdin(KIND === 'sessionend' ? 300 : 2000)).replace(BOM, '').trim();
  const input = raw ? JSON.parse(raw) : {};
  const sessionId = pick(input.session_id, process.env.CODEX_SESSION_ID) ?? '';

  // SessionEnd: the one unconditional cleanup point — turn state and taught
  // rules die with the session. Cross-turn stop debt dies too: a new session
  // deserves the full block budget again.
  if (KIND === 'sessionend') {
    const safe = safeSid(sessionId);
    if (safe) {
      for (const prefix of ['smugan-turn-', 'smugan-stopdebt-', 'smugan-codex-rules-']) {
        try {
          unlinkSync(join(tmpdir(), prefix + safe + '.json'));
        } catch { /* smugan-ignore empty-catch: nothing to clean — best-effort */ }
      }
    }
    process.exit(0);
  }

  const dir = gateDir();
  if (!dir) throw new Error('Gate engine unavailable');
  const { runHook } = await import(pathToFileURL(join(dir, 'src', 'hook.mjs')).href);

  if (KIND === 'stop') {
    const result = await runHook('stop', { session_id: sessionId });
    const { exitCode, stderr } = result;
    if (exitCode === 2 && stderr) emit({ decision: 'block', reason: stderr });
    else if (diagnostic(result)) emit({ systemMessage: diagnostic(result) });
    process.exit(0);
  }

  // pre/post: only apply_patch carries writes on Codex (the hooks.json matcher
  // already restricts to it; the guard here keeps a looser matcher harmless).
  if (input.tool_name !== 'apply_patch') process.exit(0);
  const toolInput = input.tool_input ?? {};
  const patchText = pick(toolInput.command, toolInput.patch, toolInput.patchText, toolInput.input);
  if (typeof patchText !== 'string') process.exit(0);

  const { parsePatch } = await import(pathToFileURL(join(dir, 'src', 'patch.mjs')).href);
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const entries = parsePatch(patchText)
    .map((entry) => ({ ...entry, path: isAbsolute(entry.path) ? entry.path : resolve(cwd, entry.path) }))
    .filter((entry) => !isAssistantState(entry.path, codexHome));
  if (entries.length === 0) process.exit(0);

  if (KIND === 'pre') {
    const failures = [];
    const notes = new Set();
    for (const { path, call } of entries) {
      // Nothing reconstructable to judge is still a file about to change: a
      // Write with no content makes the gate record how the file arrived and
      // return clean. Without it the end of the turn falls back to git HEAD
      // and blames this turn for someone's uncommitted work.
      const result = await runHook('pre', {
        session_id: sessionId,
        tool_name: call ? call.tool_name : 'Write',
        tool_input: { ...call?.tool_input, file_path: path },
      });
      const { exitCode, stderr } = result;
      if (exitCode === 2 && stderr) failures.push(stderr.trim());
      if (diagnostic(result)) notes.add(diagnostic(result));
    }
    // A rule the project turns off ("disable" in its config layers) is not taught.
    const { loadConfig } = await import(pathToFileURL(join(dir, 'src', 'config.mjs')).href);
    const projectOff = loadConfig(cwd).disable;
    const taught = ruleTeach(entries.map((e) => e.path), sessionId, codexHome, (rule) => !projectOff.includes(rule.slice(0, -3)));
    const context = [taught, ...notes].filter(Boolean).join('\n');
    if (failures.length > 0) {
      emit({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'smugan gate: this patch would introduce violations — fix the content and retry:\n\n' +
            failures.join('\n\n'),
          ...(context ? { additionalContext: context } : {}),
        },
      });
    } else if (context) {
      emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } });
    }
    process.exit(0);
  }

  // post: one synthesized Write per touched path — content is read from disk
  // by the engine, so this works for reconstructed and unreconstructable
  // entries alike, records the turn's touches for the Stop-hook DoD, and runs
  // the project's own eslint/tsc on the file's final state.
  const failures = [];
  const notes = new Set();
  for (const { path } of entries) {
    const result = await runHook('post', {
      session_id: sessionId,
      tool_name: 'Write',
      tool_input: { file_path: path },
    });
    const { exitCode, stderr } = result;
    if (exitCode === 2 && stderr) failures.push(stderr.trim());
    if (diagnostic(result)) notes.add(diagnostic(result));
  }
  if (failures.length > 0 || notes.size > 0) emit({
    ...(failures.length > 0 ? { decision: 'block', reason: failures.join('\n\n') } : {}),
    ...(notes.size > 0 ? { systemMessage: [...notes].join('\n') } : {}),
  });
  process.exit(0);
} catch {
  emit({ systemMessage: 'smugan: gate unavailable — the engine could not finish this event. The check did not pass. Check the installation and run the checks again.' });
  process.exit(0);
}
