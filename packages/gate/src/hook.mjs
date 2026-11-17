// @ts-check
// Claude Code hook enforcement.
//   pre  (PreToolUse, exit 2 blocks the tool call): runs the smugan checks on
//         the content a Write/Edit is about to produce; only NEW violations
//         block, so touching a legacy file doesn't punish unrelated lines.
//   post (PostToolUse, exit 2 feeds stderr back to Claude): runs the project's
//         own eslint on the touched file, time-boxed, and reports only
//         problems NEW vs the committed (git HEAD) version — pre-existing debt
//         in a file you merely edited never blocks (measured once per blob sha,
//         cached). Also records the touched file so the stop hook knows what
//         this turn did.
//   stop (Stop, exit 2 keeps the turn alive): mechanical Definition of Done —
//         re-runs the gate on files touched this turn plus the project's
//         typecheck/tests scripts; with no typecheck script, tsc on the
//         touched files, diff-aware like post. Never a build. One block per
//         turn, two when the turn touched a critical file.
// Internal smugan failures always fail open — never block the session.
// "mode": "warn" (config.mjs) runs the same checks and reports the same
// findings, but every event exits 0: nothing blocks and no Stop holds.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeContent, norm, parseSuppressions } from './engine.mjs';
import { checkEnabled, checkOptions, globToRegExp, isIgnored, loadConfig } from './config.mjs';
import { assertionProfile, removedTests, testCounts, testInventory, weakenedTests } from './assertion-weakening.mjs';
import { isTestPath, TEST_PATH_RE } from './checks/test-weakening.mjs';
import { clip, logEvent, writeReport } from './session-log.mjs';
import { reviewers as reviewersOn } from './profile.cjs';
import { readTurn, retireTurn, updateTurn } from './turn-state.mjs';
import { hasCode, withFileLock, writeAtomicJson } from './file-state.mjs';
import { contractRoot, readContract } from './contract.mjs';
import { criticalReason, fileLevel, higher, LEVELS, lowersRisk, riskCleared, riskOverride, riskOverrideDir } from './risk.mjs';
import { detectAi, importedEngines, modelKey, modelLiterals } from './ai-detect.mjs';
import { guideIndex, guideState } from './ai-guides.mjs';
import { docsIndex, matchesStackRule } from './docs-index.mjs';
import { CODE_FILE_RE, functionNames } from './functions.mjs';
import { explorationResidue, recentUserPrompts } from './residue.mjs';
import { driftCounts, driftFindings, introducedDrift } from './contract-drift.mjs';
import { MIN_TOKENS, newClones } from './clones.mjs';
import awaitInLoop from './checks/await-in-loop.mjs';
import { CHECKS } from './checks/index.mjs';
import { contentAt, dirtyFiles, gitRoot, headCommit, headReflog, MAX_DIRTY_FILES, turnCommits } from './shell-writes.mjs';

const OK = { exitCode: 0, stderr: '' };
const BLOCK = 2;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const MAX_FILE_BYTES = 1024 * 1024;

/** A module tsc type-checks; a declaration file only describes others. @param {string} path */
const isTypeScriptSource = (path) => /\.(?:tsx?|mts|cts)$/.test(path) && !/\.d\.(?:ts|mts|cts)$/.test(path);

/**
 * @param {'pre' | 'post' | 'stop' | 'session' | 'bash'} kind
 * @param {any} input parsed hook JSON from stdin
 * @returns {Promise<{ exitCode: number, stderr: string, stdout?: string, context?: string, warned?: boolean }>}
 *   `context` is text for the model; only the Claude Code launcher delivers
 *   it (PreToolUse and SessionStart additionalContext), except that `warned`
 *   marks warn-mode findings, which every adapter with a non-blocking channel
 *   delivers (PostToolUse included).
 */
export async function runHook(kind, input) {
  try {
    // `await` keeps the fail-open catch in force for async rejections too —
    // without it a rejected promise escapes runHook and the contract lies.
    if (kind === 'stop') return await stopHook(input);
    if (kind === 'session') return sessionHook(input);
    if (kind === 'bash') return bashHook(input);

    const toolInput = input?.tool_input ?? {};
    const filePath = toolInput.file_path;
    if (!EDIT_TOOLS.has(input?.tool_name) || typeof filePath !== 'string') return OK;

    const abs = resolve(filePath);
    if (kind === 'pre' && norm(abs).toLowerCase().startsWith(norm(riskOverrideDir()).toLowerCase() + '/')) {
      return lowerRefused(input?.session_id, 'it writes where forced levels are kept');
    }
    if (isScratchpad(abs)) return OK;
    const config = loadConfig(dirname(abs));
    const rel = norm(relative(config.root, abs));
    if (rel.startsWith('..') || isIgnored(rel, config)) return OK;

    if (kind === 'pre') {
      const result = preHook(abs, rel, input.tool_name, toolInput, config, input?.session_id);
      if (result.exitCode !== 0) return result;
      // What the file holds plus what the edit writes: an Edit's new_string
      // rarely repeats the import or the model id the file already has.
      const text = [readIfSmall(abs), writtenText(toolInput)].filter((t) => typeof t === 'string').join('\n');
      const context = [result.context, contractHint(abs, rel, text, config, input?.session_id), aiHint(abs, rel, text, config, input?.session_id), docsHint(abs, rel, text, config, input?.session_id)].filter(Boolean).join('\n\n');
      return context ? { ...result, context } : result;
    }
    recordTouch(input?.session_id, abs);
    return await postHook(abs, rel, config, input?.session_id);
  } catch (error) {
    const code = ['EEXIST', 'EPERM', 'EACCES', 'ENOENT', 'EBUSY'].find((value) => hasCode(error, value));
    const message = 'smugan: gate unavailable — an internal check or state update failed' + (code ? ` (${code})` : '') + '. This event was not verified; check the installation or the session state and run the checks again.';
    note(input?.session_id, { hook: kind, outcome: 'gate-unavailable', code: code ?? null, detail: clip(error instanceof Error ? error.message : String(error)) });
    return { exitCode: 0, stderr: message + '\n', stdout: userNote(message) };
  }
}

/**
 * Records a block or a fail-open for `smugan why`. Never changes the decision
 * being explained: a failed write is dropped.
 * @param {unknown} sessionId @param {Record<string, unknown>} event
 */
function note(sessionId, event) {
  try {
    logEvent(sessionId, event);
  } catch { /* smugan-ignore empty-catch: the log only explains a decision already taken */ }
}

// --- turn state: which files did this turn modify (written by post, read by stop) ---

/** @param {unknown} sessionId */
function turnMarkerPath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe ? join(tmpdir(), 'smugan-turn-' + safe + '.json') : null;
}

/**
 * Files inside the Claude config dir (memory, settings, installed rules) are
 * assistant state, not project code — they never count toward the turn's DoD.
 * @param {string} abs
 */
function isAssistantState(abs) {
  const claudeDir = norm(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  return norm(abs).toLowerCase().startsWith(claudeDir.toLowerCase() + '/');
}

/**
 * The Claude scratchpad (<tmpdir>/claude/**) holds throwaway session tooling —
 * probe scripts, extractors, one-off fixtures. Printing IS their purpose and
 * they never ship, so gating them only forces contortions of disposable code.
 * @param {string} abs
 */
function isScratchpad(abs) {
  const root = norm(join(tmpdir(), 'claude'));
  return norm(abs).toLowerCase().startsWith(root.toLowerCase() + '/');
}

/** @param {unknown} sessionId @param {string} abs */
function recordTouch(sessionId, abs) {
  const marker = turnMarkerPath(sessionId);
  if (!marker || isAssistantState(abs)) return;
  updateTurn(marker, (state) => {
    if (!state.files.includes(abs)) state.files.push(abs);
  });
}

const CLI = `node "${norm(join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'smugan.mjs'))}"`;

/**
 * Lowering the risk level skips tests and reviews, so it is the user's call:
 * the agent's Bash and edit tools are refused, and the user runs the command
 * in a terminal or with `!` in Claude Code, which no hook sees.
 * @param {unknown} sessionId @param {string} why
 */
function lowerRefused(sessionId, why) {
  note(sessionId, { hook: 'pre', outcome: 'blocked', rules: ['risk-override'], detail: why });
  return { exitCode: BLOCK, stderr: `smugan gate: blocked — ${why}. Lowering the risk level skips tests and reviews, so only the user does it. Ask the user to run it in their own terminal or with \`!\` in Claude Code; raising it (\`smugan risk critical\`) and reading it (\`smugan risk\`) stay open to you.\n` };
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * PreToolUse for the shell tools: refuses commands that may lower the risk
 * level, and before the turn's first command in a repository records what
 * was already changed there.
 * @param {any} input
 */
function bashHook(input) {
  const command = input?.tool_input?.command;
  if (!SHELL_TOOLS.has(input?.tool_name) || typeof command !== 'string') return OK;
  // The refusal is pure text, decided before any I/O: nothing the remembering
  // below can fail on may let a lowering command through.
  const why = lowersRisk(command);
  if (why) return lowerRefused(input?.session_id, why);
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  // Seen before every shell command, the one that deletes it included.
  rememberOverride(input?.session_id, () => riskOverride(cwd));
  sessionSafely(input?.session_id, 'shell-snapshot', undefined, () => snapshotShell(input?.session_id, cwd));
  return OK;
}

/** Files shell commands changed that one end of turn checks, at most; the rest is reported unchecked. */
const SHELL_FILE_CAP = 100;
/** Time the snapshot spends on findings, well inside the 10 s the host gives a shell hook. */
const SHELL_SNAPSHOT_BUDGET_MS = 3000;

/** @param {unknown} error */
const reason = (error) => clip(error instanceof Error ? error.message : String(error));

/**
 * The turn's first shell command in a repository records the commit HEAD
 * points at, what git already lists as changed, and each such code file's
 * findings as its baseline, so the end of the turn checks what a command
 * writes without blaming what the file carried before the turn. The record is
 * kept even when unusable, so the turn's next commands do not pay for it again.
 * @param {unknown} sessionId @param {string} cwd
 */
function snapshotShell(sessionId, cwd) {
  const marker = turnMarkerPath(sessionId);
  if (!marker) return;
  const inside = (/** @type {string} */ root) => rootKey(cwd + '/').startsWith(rootKey(root + '/'));
  if (Object.keys(readTurn(marker).shells).some(inside)) return;
  const root = gitRoot(cwd);
  if (!root) return;
  const stop = loadConfig(root).hook.stop;
  if (stop === false || stop.shell === false) return;
  /** @type {import('./turn-state.mjs').ShellSnapshot} */
  const snapshot = { head: '', at: Date.now(), reflog: null, files: {}, deleted: [], unrecorded: [], skipped: '' };
  /** @type {ReturnType<typeof dirtyFiles>} */
  let dirty = null;
  try {
    snapshot.head = headCommit(root);
    const moves = headReflog(root);
    snapshot.reflog = { count: moves.length, line: moves[0] ?? '' };
    dirty = dirtyFiles(root);
    if (dirty) snapshot.deleted = dirty.deleted;
    else snapshot.skipped = `more than ${MAX_DIRTY_FILES} files were already changed`;
  } catch (error) {
    snapshot.skipped = `git status did not answer (${reason(error)})`;
  }
  /** @type {Record<string, [string, number][]>} */
  const baselines = {};
  /** A test's assertions as they were, so an older weakening is not this turn's. @type {Record<string, [string, number][]>} */
  const assertions = {};
  /** @type {Record<string, import('./assertion-weakening.mjs').TestCounts>} */
  const tests = {};
  const deadline = Date.now() + SHELL_SNAPSHOT_BUDGET_MS;
  /** @type {Map<string, import('./config.mjs').SmuganConfig>} */
  const configs = new Map();
  for (const [rel, entry] of Object.entries(dirty?.files ?? {})) {
    snapshot.files[rel] = entry.print;
    const abs = join(root, rel);
    const config = configs.get(dirname(abs)) ?? loadConfig(dirname(abs));
    configs.set(dirname(abs), config);
    const own = norm(relative(config.root, abs));
    if (own.startsWith('..') || isIgnored(own, config) || !CHECKS.some((check) => check.appliesTo(own))) continue;
    // Past the budget the file is known as changed, but not what it carried.
    if (Date.now() > deadline) {
      snapshot.unrecorded.push(rel);
      continue;
    }
    const content = readIfSmall(abs);
    if (content === null) continue;
    baselines[abs] = [...countViolations(analyzeContent(own, content, config))];
    if (isTestPath(own)) {
      assertions[abs] = assertionProfile(content);
      tests[abs] = testCounts(content);
    }
  }
  if (snapshot.skipped) note(sessionId, { hook: 'bash', outcome: 'shell-snapshot-skipped', root: norm(root), detail: snapshot.skipped });
  updateTurn(marker, (state) => {
    if (norm(root) in state.shells) return;
    state.shells[norm(root)] = snapshot;
    for (const [abs, profile] of Object.entries(assertions)) {
      // A file the turn already wrote has its start recorded by that write:
      // profiled here, a test the turn itself created would count as one that
      // existed before it.
      if (abs in state.assertions || baselineOf(state, abs)) continue;
      state.assertions[abs] = profile;
      state.tests[abs] = tests[abs];
    }
    for (const [abs, counts] of Object.entries(baselines)) if (!(abs in state.baselines)) state.baselines[abs] = counts;
  });
}

/**
 * What shell commands changed since each repository's snapshot: files with
 * another fingerprint, files git did not list then, and files the turn's own
 * commits changed. A file git did not list then is judged by what the turn
 * brought to it (its own commits, then what is uncommitted over HEAD), even
 * if an edit recorded a baseline after the command.
 * @param {import('./turn-state.mjs').TurnState} state
 */
function shellChanges(state) {
  /** @type {string[]} */
  const files = [];
  /** @type {Map<string, { root: string, rel: string, head: string, commits: { from: string, to: string }[] }>} */
  const atCommit = new Map();
  /** @type {string[]} */
  const created = [];
  /** Tracked files gone since the snapshot, each with the commit that still had it. @type {{ abs: string, root: string, rel: string, rev: string }[]} */
  const deleted = [];
  /** @type {string[]} */
  const notes = [];
  for (const [root, snapshot] of Object.entries(state.shells)) {
    if (snapshot.skipped) {
      notes.push(`${root}: what shell commands changed was not checked; at the turn's first shell command, ${snapshot.skipped}.`);
      continue;
    }
    let now;
    let head;
    try {
      now = dirtyFiles(root);
      head = headCommit(root);
    } catch (error) {
      notes.push(`${root}: the files shell commands changed were not read (${reason(error)}).`);
      continue;
    }
    if (!now) {
      notes.push(`${root}: more than ${MAX_DIRTY_FILES} changed files; what shell commands changed was not checked.`);
      continue;
    }
    const current = now.files;
    const changed = new Set(Object.keys(current).filter((rel) => current[rel].print !== snapshot.files[rel]));
    // A commit the turn makes leaves its files clean; they changed all the same.
    // What a pull, merge or checkout brings is someone else's and stays out.
    /** @type {Map<string, { from: string, to: string }[]>} */
    const committedBy = new Map();
    if (snapshot.head && snapshot.at && head && head !== snapshot.head) {
      try {
        for (const commit of turnCommits(root, snapshot)) {
          for (const rel of commit.files) {
            committedBy.set(rel, [...(committedBy.get(rel) ?? []), { from: commit.from, to: commit.to }]);
            if (existsSync(join(root, rel))) changed.add(rel);
          }
        }
      } catch (error) {
        notes.push(`${root}: the files the turn's commits changed were not read (${reason(error)}).`);
      }
    }
    // Gone by a command, or by a commit of the turn. The file as it was comes
    // from before the turn's first commit to it, or from the snapshot's HEAD.
    // A path only untracked (`git rm --cached`) is listed as deleted and is still there.
    // A path already gone at the snapshot was deleted before the turn, also
    // when the turn is the one that commits the deletion.
    const gone = new Set([...now.deleted, ...committedBy.keys()].filter((rel) => !snapshot.deleted.includes(rel) && !existsSync(join(root, rel))));
    for (const rel of gone) {
      const rev = committedBy.get(rel)?.[0].from ?? snapshot.head;
      if (rev) deleted.push({ abs: join(root, rel), root, rel, rev });
    }
    const unrecorded = new Set(snapshot.unrecorded);
    const listed = [...changed];
    let unknown = 0;
    for (const rel of listed.slice(0, SHELL_FILE_CAP)) {
      if (unrecorded.has(rel)) {
        unknown++;
        continue;
      }
      const abs = join(root, rel);
      files.push(abs);
      if (rel in snapshot.files) continue;
      atCommit.set(rootKey(abs), { root, rel, head, commits: committedBy.get(rel) ?? [] });
      if (current[rel]?.untracked) created.push(abs);
    }
    if (unknown > 0) notes.push(`${root}: ${unknown} files were already changed before the turn's first shell command and did not fit its time budget; what the turn changed in them was not checked.`);
    if (listed.length > SHELL_FILE_CAP) notes.push(`${root}: ${listed.length - SHELL_FILE_CAP} more files changed outside Write/Edit were not checked.`);
  }
  return { files, atCommit, created, deleted, notes };
}

/**
 * Test files that existed when the turn started and are gone: the ones an
 * edit or the shell snapshot profiled at their first touch, and the ones a
 * command deleted or a commit of the turn removed.
 * @param {import('./turn-state.mjs').TurnState} state @param {ReturnType<typeof shellChanges>} shell
 * @returns {{ abs: string, before: [string, number][], was: import('./assertion-weakening.mjs').TestCounts }[]}
 */
function deletedTestFiles(state, shell) {
  /** @type {ReturnType<typeof deletedTestFiles>} */
  const found = [];
  const seen = new Set();
  // A feature removed together with its tests looks the same from here, and
  // telling the two apart by file names missed real deletions: the removal is
  // listed once either way, and the agent says which one it was.
  for (const [abs, before] of Object.entries(state.assertions)) {
    const was = state.tests[abs];
    if (!was || existsSync(abs)) continue;
    seen.add(rootKey(abs));
    found.push({ abs, before, was });
  }
  for (const gone of shell.deleted.filter((d) => isTestPath(norm(d.rel))).slice(0, SHELL_FILE_CAP)) {
    if (seen.has(rootKey(gone.abs))) continue;
    seen.add(rootKey(gone.abs));
    try {
      const text = contentAt(gone.root, gone.rev, gone.rel);
      if (text !== null) found.push({ abs: gone.abs, before: assertionProfile(text), was: testCounts(text) });
    } catch (error) {
      shell.notes.push(`${norm(gone.rel)}: deleted this turn, and its tests before the turn were not read (${reason(error)}).`);
    }
  }
  return found;
}

/**
 * The turn-start baseline of a file, also when the edit and the shell
 * snapshot spelled its path in different cases (Windows).
 * @param {import('./turn-state.mjs').TurnState} state @param {string} abs
 */
function baselineOf(state, abs) {
  return state.baselines[abs] ?? Object.entries(state.baselines).find(([path]) => rootKey(path) === rootKey(abs))?.[1];
}

/** Time one end of turn spends reading the turn's commits; past it, files compare with HEAD. */
const SHELL_HISTORY_BUDGET_MS = 30_000;

/**
 * The findings a file holds now that the turn brought to it: what each run of
 * its own commits added over the move before the run, plus what is uncommitted
 * over HEAD, at most what the file holds now. Commits in a row with nothing
 * else between them are one run, so committing after every step costs one
 * comparison; a pull or rebase between runs adds what someone else wrote,
 * which is in neither side, so it stays out. Each version is read and checked
 * once per end of turn.
 * @param {{ root: string, rel: string, head: string, commits: { from: string, to: string }[] }} revision
 * @param {string} rel @param {import('./config.mjs').SmuganConfig} config
 * @param {import('./engine.mjs').Violation[]} violations the file's findings now
 * @param {Map<string, { text: string | null, counts: Map<string, number> }>} versions per end of turn
 */
function turnFindings(revision, rel, config, violations, versions) {
  const version = (/** @type {string} */ rev) => {
    const key = `${revision.root}\0${rev}\0${revision.rel}`;
    let entry = versions.get(key);
    if (!entry) {
      const text = rev ? contentAt(revision.root, rev, revision.rel) : null;
      entry = { text, counts: countViolations(text === null ? [] : analyzeContent(rel, text, config)) };
      versions.set(key, entry);
    }
    return entry;
  };
  /** @type {Map<string, number>} */
  const brought = new Map();
  const add = (/** @type {Map<string, number>} */ after, /** @type {Map<string, number>} */ before) => {
    for (const [key, n] of after) {
      const more = n - (before.get(key) ?? 0);
      if (more > 0) brought.set(key, (brought.get(key) ?? 0) + more);
    }
  };
  /** @type {{ from: string, to: string }[]} */
  const runs = [];
  for (const commit of revision.commits) {
    const last = runs[runs.length - 1];
    if (last && last.to === commit.from) last.to = commit.to;
    else runs.push({ ...commit });
  }
  for (const { from, to } of runs) add(version(to).counts, version(from).counts);
  const now = countViolations(violations);
  add(now, version(revision.head).counts);
  /** @type {Map<string, number>} */
  const legacy = new Map();
  for (const [key, n] of now) legacy.set(key, n - Math.min(n, brought.get(key) ?? 0));
  return { fresh: freshAgainst(legacy, violations), before: runs.length ? version(runs[0].from).text : version(revision.head).text };
}

/** What a Write/Edit/MultiEdit puts in the file, for content-based risk. @param {any} toolInput */
function writtenText(toolInput) {
  if (typeof toolInput.content === 'string') return toolInput.content;
  if (typeof toolInput.new_string === 'string') return toolInput.new_string;
  if (Array.isArray(toolInput.edits)) return toolInput.edits.map((/** @type {any} */ e) => String(e?.new_string ?? '')).join('\n');
  return null;
}

/** Session-scoped state that outlives each turn's marker. @param {unknown} sessionId */
function sessionStatePath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe ? join(tmpdir(), 'smugan-session-' + safe + '.json') : null;
}

/**
 * True exactly once per session and key; later calls, and concurrent ones
 * that lose the lock race, get false.
 * @param {string} file @param {string} key
 */
function firstInSession(file, key) {
  return updateSession(file, (data) => {
    const hinted = Array.isArray(data.hinted) ? data.hinted.filter((/** @type {unknown} */ k) => typeof k === 'string') : [];
    if (hinted.includes(key)) return false;
    data.hinted = [...hinted, key];
    return true;
  });
}

/**
 * Read-modify-write of the session state file under its lock.
 * @template T @param {string} file @param {(data: Record<string, any>) => T} change
 * @returns {T}
 */
function updateSession(file, change) {
  return withFileLock(file, () => {
    /** @type {Record<string, any>} JSON this module wrote; each field is checked where it is read */
    let data = {};
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch (error) {
      if (!hasCode(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error;
    }
    const result = change(data);
    writeAtomicJson(file, data);
    return result;
  });
}

/**
 * Remembers a forced level this session saw, so a later Stop notices it
 * vanishing. Called wherever the hooks read one: session start, every edit
 * and every Stop.
 * @param {unknown} sessionId @param {ReturnType<typeof riskOverride> | (() => ReturnType<typeof riskOverride>)} read
 */
function rememberOverride(sessionId, read) {
  sessionSafely(sessionId, 'remember', undefined, () => {
    const override = typeof read === 'function' ? read() : read;
    const file = sessionStatePath(sessionId);
    if (!file || !override) return;
    updateSession(file, (data) => {
      data.overrides = { ...(data.overrides && typeof data.overrides === 'object' ? data.overrides : {}), [rootKey(override.root)]: override.expiresAt };
    });
  });
}

/**
 * The vanish notice is a convenience: a failure in its state (a held lock,
 * an unreadable file) is logged and never stops a hook from deciding.
 * @template T @param {unknown} sessionId @param {string} step @param {T} fallback @param {() => T} run
 * @returns {T}
 */
function sessionSafely(sessionId, step, fallback, run) {
  try {
    return run();
  } catch (error) {
    note(sessionId, { hook: 'session-state', outcome: `${step}-failed`, detail: clip(error instanceof Error ? error.message : String(error)) });
    return fallback;
  }
}

/** One key per checkout, whatever the case the host spelled it in on Windows. @param {string} root */
const rootKey = (root) => (process.platform === 'win32' ? norm(root).toLowerCase() : norm(root));

/**
 * Compares the forced levels this session saw with what is on disk now. A
 * level gone before it lapsed, without `smugan risk auto`, was deleted, which
 * no command check catches in every form; its root waits in `pending` until
 * a Stop that the user sees reports it.
 * @param {unknown} sessionId @param {Map<string, ReturnType<typeof riskOverride>>} forced
 */
function trackOverrides(sessionId, forced) {
  sessionSafely(sessionId, 'track', undefined, () => trackOverridesUnsafe(sessionId, forced));
}

/** @param {unknown} sessionId @param {Map<string, ReturnType<typeof riskOverride>>} forced */
function trackOverridesUnsafe(sessionId, forced) {
  const file = sessionStatePath(sessionId);
  // Nothing forced now and nothing remembered: no state to touch, no git call.
  if (!file || ([...forced.values()].every((o) => !o) && !existsSync(file))) return;
  updateSession(file, (data) => {
    /** @type {Record<string, string>} */
    const seen = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
    const pending = new Set(Array.isArray(data.pendingVanished) ? data.pendingVanished : []);
    for (const [dir, override] of forced) {
      if (!override && Object.keys(seen).length === 0) continue;
      const key = rootKey(override?.root ?? contractRoot(dir));
      if (override) seen[key] = override.expiresAt;
      else if (typeof seen[key] === 'string') {
        if (Date.parse(seen[key]) > Date.now() && !riskCleared(key)) pending.add(key);
        delete seen[key];
      }
    }
    data.overrides = seen;
    data.pendingVanished = [...pending];
  });
}

/** The vanished levels not yet shown to the user, cleared as they are taken. @param {unknown} sessionId @returns {string[]} */
function takeVanished(sessionId) {
  const file = sessionStatePath(sessionId);
  if (!file || !existsSync(file)) return [];
  return sessionSafely(sessionId, 'take', [], () => updateSession(file, (data) => {
    const pending = Array.isArray(data.pendingVanished) ? data.pendingVanished.filter((/** @type {unknown} */ k) => typeof k === 'string') : [];
    data.pendingVanished = [];
    return pending;
  }));
}

/**
 * Reminder for the session's first edit of a critical file in a project
 * without an acceptance contract to work against. Ordinary edits never get
 * it: on a reversible change the contract and the reviewers cost more than
 * the defects they catch, and a reminder on every turn only interrupts.
 * Never a block: a clear request needs no contract, and the gate cannot tell
 * the two apart. A contract with every criterion done is likely finished
 * work, so it counts as none.
 * @param {string} abs @param {string} rel @param {string | null} content
 * @param {import('./config.mjs').SmuganConfig} config @param {unknown} sessionId
 * @returns {string | null}
 */
function contractHint(abs, rel, content, config, sessionId) {
  const file = sessionStatePath(sessionId);
  if (!file || isAssistantState(abs) || PROSE_ONLY_RE.test(rel)) return null;
  // `smugan risk` decides the level for the whole checkout while it lasts.
  const forced = riskOverride(config.root);
  rememberOverride(sessionId, forced);
  const reason = forced ? (forced.level === 'critical' ? 'level forced with smugan risk' : null) : criticalReason(rel, content);
  if (!reason || !firstInSession(file, norm(config.root))) return null;
  const root = norm(contractRoot(config.root));
  const critical = `smugan: ${rel} is a critical change (${reason}).`;
  // The launcher sets SMUGAN_PROFILE and SMUGAN_DISABLE from the install; the
  // project's "disable" list silences a reviewer here too.
  const disabled = [...(process.env.SMUGAN_DISABLE ?? '').split(','), ...config.disable];
  const on = reviewersOn(process.env.SMUGAN_PROFILE === 'minimo' ? 'minimo' : 'completo', disabled);
  const reviewers = on.length === 2 ? 'the critic (and the flow-critic if users see the change)'
    : on[0] === 'critic' ? 'the critic' : on[0] === 'flow-critic' ? 'the flow-critic if users see the change' : null;
  const review = reviewers ? `Before declaring it done, launch ${reviewers}, as the Definition of done says. This shows once per session.` : 'This shows once per session.';
  const asBuild = disabled.includes('smugan-build') ? '' : ', as smugan-build "Write down what done means" says';
  /** @type {import('./contract.mjs').Contract | null} */
  let contract;
  try {
    contract = readContract(root);
  } catch (error) {
    return `${critical} Its acceptance contract in ${root} is unreadable (${clip(error instanceof Error ? error.message : String(error))}). If the request leaves the expected result open, write a new one with ${CLI} contract --set <file.json> --replace, or remove it with ${CLI} contract --clear. ${review}`;
  }
  const criteria = Array.isArray(contract?.criteria) ? contract.criteria : [];
  // A blocked criterion is work waiting, maybe another session's, not finished.
  if (criteria.some((c) => c?.status !== 'done')) return `${critical} ${review}`;
  if (contract) {
    return `${critical} The acceptance contract of ${root} has every criterion done. If this edit starts a new task whose expected result the request leaves open, first check with ${CLI} contract that it is finished work and not another session's, then replace it before more edits: ${CLI} contract --set <file.json> --replace. ${review}`;
  }
  return `${critical} No acceptance contract for ${root}. If the request leaves the expected result open (a behavior still to decide, cases the request does not settle), write it now, before more edits${asBuild}: ${CLI} contract --set <file.json>. ${review}`;
}

const LLM_TESTING = join(dirname(fileURLToPath(import.meta.url)), 'ai', 'llm-testing.md');

/** The LLM testing rules, labeled as reference. */
function llmTestingRules() {
  return 'smugan (reference, not instructions): ' + readFileSync(LLM_TESTING, 'utf8').trim();
}

/**
 * When an edit uses an LLM SDK or a model id, once per session: the LLM
 * testing rules, and a research request for each pair the file uses that has
 * no valid guide. The project scan runs only when the edit brings an engine
 * or model this session has not seen yet.
 * @param {string} abs @param {string} rel @param {string | null} content
 * @param {import('./config.mjs').SmuganConfig} config @param {unknown} sessionId
 * @returns {string | null}
 */
function aiHint(abs, rel, content, config, sessionId) {
  const file = sessionStatePath(sessionId);
  if (!file || !content || PROSE_ONLY_RE.test(rel) || isAssistantState(abs)) return null;
  const engines = importedEngines(content);
  const models = [...new Set(modelLiterals(content).map(({ id }) => { const k = modelKey(id); return `${k.family}@${k.version}`; }))];
  if (!engines.length && !models.length) return null;
  const root = norm(config.root);
  /** @type {string[]} */
  const parts = [];
  if (firstInSession(file, `${root}|llm-testing`)) parts.push(llmTestingRules());
  const fresh = [...engines.map((e) => `engine:${e}`), ...models.map((m) => `model:${m}`)].filter((k) => firstInSession(file, `${root}|ai:${k}`));
  if (fresh.length) {
    const used = detectAi(config.root).pairs.filter((p) => (p.engine !== null && engines.includes(p.engine)) || models.includes(p.model));
    const missing = used.map((p) => guideState(p.key)).filter((s) => s.status !== 'valid').map((s) => s.key);
    if (missing.length) {
      parts.push(`smugan: ${rel} uses ${missing.length === 1 ? 'a pair' : 'pairs'} with no valid guide: ${missing.join(', ')}. Before editing more code that depends on ${missing.length === 1 ? 'it' : 'them'}, delegate to the smugan-ai-research subagent with each key and the project path ${root}. It confirms the model string and the installed version in the repository, reads only official docs and releases, and saves the guide with ${CLI} ai-guide --write. This shows once per session.`);
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

// The rules this checkout installs; a gate installed without them reads the
// ones in the Claude config folder.
const CHECKOUT_RULES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'claude', 'rules');

/**
 * The first edit, per session and per package, of a file a stack rule covers
 * gets the index of the docs the installed versions ship and the signatures
 * of what the file imports. The rule loads with the file; a skill with the
 * same content went unused in most runs, so the index rides the edit.
 * @param {string} abs @param {string} rel @param {string | null} content
 * @param {import('./config.mjs').SmuganConfig} config @param {unknown} sessionId
 * @returns {string | null}
 */
function docsHint(abs, rel, content, config, sessionId) {
  const file = sessionStatePath(sessionId);
  if (!file || PROSE_ONLY_RE.test(rel) || isAssistantState(abs)) return null;
  const rules = existsSync(CHECKOUT_RULES) ? CHECKOUT_RULES : join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'rules');
  if (!matchesStackRule(rules, rel)) return null;
  const pkgDir = findUp(dirname(abs), (d) => existsSync(join(d, 'package.json')) || norm(d) === norm(config.root)) ?? config.root;
  const index = docsIndex(pkgDir, config.root, content, dirname(abs));
  if (!index || !firstInSession(file, `${norm(pkgDir)}|docs-index`)) return null;
  return index.text;
}

/**
 * SessionStart: the index of the project's AI guides and the LLM testing
 * rules, when the project uses an LLM. The home folder is not a project.
 * @param {any} input
 * @returns {{ exitCode: number, stderr: string, context?: string }}
 */
function sessionHook(input) {
  const cwd = typeof input?.cwd === 'string' ? input.cwd : null;
  if (!cwd) return OK;
  const config = loadConfig(cwd);
  if (norm(config.root).toLowerCase() === norm(homedir()).toLowerCase()) return OK;
  rememberOverride(input?.session_id, () => riskOverride(config.root));
  const usage = detectAi(config.root);
  if (!usage.pairs.length) return OK;
  const file = sessionStatePath(input?.session_id);
  if (file) firstInSession(file, `${norm(config.root)}|llm-testing`);
  const shown = usage.pairs.slice(0, MAX_INDEXED_PAIRS);
  const more = usage.pairs.length > shown.length ? `\n(${usage.pairs.length - shown.length} more pairs; \`smugan ai-guide\` lists them all.)` : '';
  return { ...OK, context: guideIndex(shown.map((p) => guideState(p.key))) + more + '\n\n' + llmTestingRules() };
}

// Each indexed pair costs up to ~120 words of the session's context.
const MAX_INDEXED_PAIRS = 6;

/**
 * Snapshots a file's violation counts the first time this turn touches it —
 * the turn-start state that pre already computed as `before`. First touch
 * wins: later edits never overwrite it, so the baseline stays anchored to how
 * the file arrived. The stop hook subtracts this, blocking only what the turn
 * introduced, never legacy violations in a file the turn merely edited. A test
 * file that already existed also keeps its per-test assertion profile, so stop
 * can tell an assertion this turn removed from one that never existed.
 * @param {unknown} sessionId @param {string} abs @param {string} rel @param {Map<string, number>} counts
 * @param {[string, number][] | null} assertions
 * @param {string | null} before the file at this first touch; null when absent or too large
 */
function recordBaseline(sessionId, abs, rel, counts, assertions, before) {
  const marker = turnMarkerPath(sessionId);
  if (!marker || isAssistantState(abs)) return;
  const tests = assertions && before !== null ? testCounts(before) : null;
  updateTurn(marker, (state) => {
    if (abs in state.baselines) return; // first touch wins
    state.baselines[abs] = [...counts];
    if (assertions) state.assertions[abs] = assertions;
    if (tests) state.tests[abs] = tests;
    if (!existsSync(abs)) state.created.push(abs);
    else if (before !== null && CODE_FILE_RE.test(abs)) {
      state.functions[abs] = functionNames(before);
      state.drift[abs] = driftCounts(driftFindings(rel, before));
    }
  });
}

/**
 * Removes leftover smugan temp files (.smugan-tsc-*.json / .smugan-tscbase-*)
 * older than 10 minutes. The finally-cleanup in runTsc never runs when the
 * harness kills the whole hook process at its timeout, and the orphans then
 * pollute the project's git status (seen twice in production sessions).
 * @param {string} dir @param {RegExp} nameRe
 */
function sweepStaleTemp(dir, nameRe) {
  try {
    for (const name of readdirSync(dir)) {
      if (!nameRe.test(name)) continue;
      const abs = join(dir, name);
      try {
        if (Date.now() - statSync(abs).mtimeMs > 10 * 60_000) unlinkSync(abs);
      } catch { /* smugan-ignore empty-catch: another process may have removed it first */ }
    }
  } catch { /* smugan-ignore empty-catch: sweep is best-effort housekeeping */ }
}

/** @param {string} abs */
function readIfSmall(abs) {
  try {
    const stats = statSync(abs);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string | null} content
 * @param {{ old_string?: string, new_string?: string, replace_all?: boolean }[]} edits
 */
function applyEdits(content, edits) {
  // EOL-normalized on both sides: patch-derived edits arrive LF while autocrlf
  // checkouts keep CRLF on disk — a raw includes() then never matches, the
  // judgment silently failed open, and the gate was OFF for every Update File
  // on a CRLF working tree. The result only feeds analyzeContent (which
  // normalizes anyway), never the disk, so this costs nothing.
  let result = content === null ? null : content.replace(/\r\n/g, '\n');
  for (const edit of edits) {
    const oldStr = (edit.old_string ?? '').replace(/\r\n/g, '\n');
    const newStr = (edit.new_string ?? '').replace(/\r\n/g, '\n');
    if (result === null || oldStr === '' || !result.includes(oldStr)) return null;
    // A function, never the string: as a replacement string, `$'`, `$&`, `$$`
    // and "$`" in the new text are patterns, and 'R$' or a plpgsql `$$` body
    // judged a text the tool never writes.
    result = edit.replace_all ? result.split(oldStr).join(newStr) : result.replace(oldStr, () => newStr);
  }
  return result;
}

/**
 * Multiset of violations keyed by rule+message.
 * @param {import('./engine.mjs').Violation[]} list @returns {Map<string, number>}
 */
function countViolations(list) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const v of list) {
    const key = v.rule + '|' + v.message;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/**
 * Violations present beyond a baseline multiset — the ones actually
 * introduced. Legacy violations already in `baseline` are spent against it
 * and never reported, so touching a file never punishes lines it didn't add.
 * @param {Map<string, number>} baseline
 * @param {import('./engine.mjs').Violation[]} violations
 * @returns {import('./engine.mjs').Violation[]}
 */
function freshAgainst(baseline, violations) {
  const budget = new Map(baseline);
  return violations.filter((v) => {
    const key = v.rule + '|' + v.message;
    const left = budget.get(key) ?? 0;
    if (left > 0) {
      budget.set(key, left - 1);
      return false;
    }
    return true;
  });
}

/**
 * @param {string} abs @param {string} rel @param {string} tool
 * @param {any} toolInput @param {import('./config.mjs').SmuganConfig} config
 * @param {unknown} sessionId
 * @returns {{ exitCode: number, stderr: string, stdout?: string, context?: string, warned?: boolean }}
 */
function preHook(abs, rel, tool, toolInput, config, sessionId) {
  const before = readIfSmall(abs);
  /** @type {string | null} */
  let after = null;
  if (tool === 'Write') {
    after = typeof toolInput.content === 'string' ? toolInput.content : null;
  } else if (tool === 'Edit') {
    after = applyEdits(before, [toolInput]);
  } else if (tool === 'MultiEdit' && Array.isArray(toolInput.edits)) {
    after = applyEdits(before, toolInput.edits);
  }
  const beforeCounts = countViolations(before === null ? [] : analyzeContent(rel, before, config));
  // Anchor the stop hook's diff to how this file arrived at the turn's start —
  // even when the edit itself fails (old_string mismatch): a failed attempt is
  // often the turn's FIRST touch, and skipping it left stop without a baseline,
  // punishing legacy debt with a full check.
  recordBaseline(sessionId, abs, rel, beforeCounts, before !== null && isTestPath(rel) ? assertionProfile(before) : null, before);
  if (after === null) return OK; // nothing to judge — the tool will error or it's not ours

  // dead-imports never blocks an Edit: a multi-step change legitimately passes
  // through import-without-usage (or usage-without-import), and gating either
  // ordering only trained workarounds — in production (jul/2026, 15+
  // blocks) every single pre-block was such an intermediate state, while the
  // one real orphaned import was caught by the stop hook, which stays the
  // backstop for the turn's FINAL state. A Write hands over the whole file —
  // that IS a final state, so there the check still applies.
  const judged = freshAgainst(beforeCounts, analyzeContent(rel, after, config)).filter(
    (v) => tool === 'Write' || v.rule !== 'dead-imports',
  );
  // Performance is checked only in a critical turn: an ordinary edit pays
  // nothing for it, and only the loops this edit adds count.
  if (checkEnabled(config, 'await-in-loop') && awaitInLoop.appliesTo(rel) && turnIsCritical(sessionId, config, rel, after)) {
    const loops = (/** @type {string} */ code) => awaitInLoop.run({ content: code }).map((f) => ({ file: rel, rule: awaitInLoop.name, severity: 'error', ...f }));
    const { suppressed } = parseSuppressions(after.replace(/\r\n/g, '\n').split('\n'));
    judged.push(...freshAgainst(countViolations(before === null ? [] : loops(before)), loops(after)).filter((v) => !suppressed(v.rule, v.line)));
  }
  if (judged.length === 0) return OK;

  const warn = config.mode === 'warn';
  const count = `${judged.length} violation${judged.length === 1 ? '' : 's'} in ${rel}`;
  let stderr = warn
    ? `smugan gate (warn mode, nothing blocked): this ${tool} introduces ${count}:\n`
    : `smugan gate: blocked — this ${tool} would introduce ${count}:\n`;
  for (const v of judged) stderr += `  line ${v.line}  [${v.rule}]  ${v.message}\n`;
  stderr += (warn ? 'Fix them in this change when you can.' : 'Fix the content and retry.') + ' False positive? Add: // smugan-ignore <rule>: <reason (6+ chars)>\n';
  note(sessionId, { hook: 'pre', outcome: warn ? 'warned' : 'blocked', root: norm(config.root), file: rel, rules: [...new Set(judged.map((v) => v.rule))] });
  return warn ? warned(stderr) : { exitCode: BLOCK, stderr };
}

/**
 * A finding under "mode": "warn": exit 0 with an empty stderr, because the
 * adapters read exit-0 stderr as a hold (Antigravity, OpenCode) or as debt
 * that denies the next call (Grok). The findings ride the channels that do
 * not block: `context` for the model, the systemMessage for the user.
 * @param {string} text
 */
function warned(text) {
  return { exitCode: 0, stderr: '', stdout: userNote(text.trimEnd()), context: text.trimEnd(), warned: true };
}

/**
 * Whether the turn is critical so far: a forced level, this file, or a file
 * the turn already touched, as the Stop will judge it.
 * @param {unknown} sessionId @param {import('./config.mjs').SmuganConfig} config @param {string} rel @param {string} content
 */
function turnIsCritical(sessionId, config, rel, content) {
  const forced = riskOverride(config.root);
  if (forced) return forced.level === 'critical';
  if (criticalReason(rel, content)) return true;
  const marker = turnMarkerPath(sessionId);
  if (!marker || !existsSync(marker)) return false;
  return readTurn(marker).files.some((f) => {
    const other = norm(relative(config.root, f));
    return !other.startsWith('..') && criticalReason(other) !== null;
  });
}

/**
 * @param {string} startDir @param {(dir: string) => boolean} predicate
 * @returns {string | null}
 */
function findUp(startDir, predicate) {
  let dir = startDir;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Truncates runner output keeping BOTH ends: the head carries the command
 * echo/context, the tail carries what actually matters — test runners print
 * the failure names and the summary LAST. The old head-only cut spent its 40
 * lines on "running test … ok" noise and dropped the FAIL lines entirely
 * (measured on a realistic 55-line run: zero failure names survived).
 * @param {string} out @param {number} max
 */
function tail(out, max = 30) {
  const lines = out.trim().split('\n');
  if (lines.length <= max) return out.trim();
  const head = 8;
  // keeps head + last (max - head); with lines.length > max the two slices
  // can never overlap, and the marker reports exactly what was dropped.
  return [
    ...lines.slice(0, head),
    `… (${lines.length - max} lines omitted) …`,
    ...lines.slice(head - max),
  ].join('\n');
}

/**
 * Non-blocking node run: eslint and tsc are independent single-file checks,
 * and running them concurrently turns the post-hook's wall-clock from their
 * SUM into their MAX (production measured ~16s tsc + eslint per edit,
 * "dezenas de vezes por hora" — production app, ago/2026).
 * @param {string[]} args @param {string} cwd @param {number} timeoutMs @param {string} [input]
 * @returns {Promise<{ status: number, output: string, stdout: string, stderr: string, timedOut: boolean }>}
 */
function runNode(args, cwd, timeoutMs, input) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ status: 1, output: '', stdout: '', stderr: '', timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch { /* smugan-ignore empty-catch: already-dead child */ }
    }, timeoutMs);
    // setEncoding: without it a multi-byte UTF-8 char split across chunks
    // decodes as U+FFFD, and a pt-BR eslint message would differ between the
    // current and baseline runs — corrupting the rule+message diff identity.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    const MAX_CAPTURE = 16 * 1024 * 1024; // parity with the old execFileSync maxBuffer
    child.stdout?.on('data', (d) => { if (stdout.length < MAX_CAPTURE) stdout += d; });
    child.stderr?.on('data', (d) => { if (stderr.length < MAX_CAPTURE) stderr += d; });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ status: 1, output: stdout + stderr, stdout, stderr, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: typeof code === 'number' ? code : 1, output: stdout + stderr, stdout, stderr, timedOut });
    });
    child.stdin?.on('error', () => { /* smugan-ignore empty-catch: EPIPE when the child exits before reading stdin */ });
    if (input !== undefined) child.stdin?.write(input);
    child.stdin?.end();
  });
}

// --- diff-aware external checks: only NEW eslint/tsc problems block ---
//
// The categorical smugan checks already spare legacy lines (freshAgainst). The
// project's own eslint/tsc did not: touching a file that carried pre-existing
// debt blocked on ALL of it, every session from scratch. These helpers give
// those tools the same treatment — diff the current file's messages against the
// committed (git HEAD) version and surface only what this change introduced.
// The HEAD baseline is linted once per blob sha and cached, so an unchanged
// legacy file is never re-measured across sessions. No git / untracked file →
// full check (new code meets the full bar); a baseline that won't compute →
// fail open, never punishing debt smugan couldn't measure.

const BASELINE_CACHE_DIR = join(tmpdir(), 'smugan-baseline');
const TSBUILD_DIR = join(tmpdir(), 'smugan-tsbuild');

/** Stable per-file .tsbuildinfo path so incremental tsc survives across edits. */
/** @param {string} abs */
function buildInfoFile(abs) {
  try {
    mkdirSync(TSBUILD_DIR, { recursive: true });
  } catch { /* smugan-ignore empty-catch: cache dir is best-effort; tsc just runs cold */ }
  return norm(join(TSBUILD_DIR, createHash('sha256').update(norm(abs)).digest('hex').slice(0, 40) + '.tsbuildinfo'));
}

/**
 * Committed content + blob sha of a file, or null when it isn't tracked / no git.
 * @param {string} abs @returns {{ sha: string, content: string } | null}
 */
export function gitHead(abs) {
  const dir = dirname(abs);
  const run = (/** @type {string[]} */ args) => {
    try {
      return execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: MAX_FILE_BYTES,
      });
    } catch {
      return null;
    }
  };
  const root = run(['rev-parse', '--show-toplevel']);
  if (!root) return null;
  let rel;
  try {
    // Git can expand a Windows 8.3 temp path while Node preserves its alias.
    // Compare canonical filesystem paths before deriving the Git object path.
    rel = norm(relative(realpathSync.native(root.trim()), realpathSync.native(abs)));
  } catch { return null; } // A vanished/unreadable file has no usable baseline.
  const sha = run(['rev-parse', `HEAD:${rel}`]);
  if (!sha || !/^[0-9a-f]{7,64}$/.test(sha.trim())) return null;
  const content = run(['show', `HEAD:${rel}`]);
  return content === null ? null : { sha: sha.trim(), content };
}

/** @param {string} abs @param {string} kind @param {string} sha @returns {string} */
function baselineCacheFile(abs, kind, sha) {
  const hash = createHash('sha256').update(`${norm(abs)}\0${kind}\0${sha}`).digest('hex').slice(0, 40);
  return join(BASELINE_CACHE_DIR, `${hash}.json`);
}

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
/** @type {string | null} */
let engineStamp = null;

/**
 * Cache kind for a HEAD baseline of smugan's own findings, which depend on the
 * engine's sources, the check options and which checks run on the file (the
 * config, the UI language, Supabase detection): a baseline left by other rules
 * (an update, a check turned on, a project that became Supabase) would make
 * legacy code look newly introduced and hold the turn.
 * @param {import('./config.mjs').SmuganConfig} config @param {string} rel
 */
function findingsKind(config, rel) {
  engineStamp ??= createHash('sha256')
    .update(readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\0'))
    .digest('hex')
    .slice(0, 16);
  const running = CHECKS.map((check) => (checkEnabled(config, check.name, rel) ? 1 : 0)).join('');
  return `smugan:${engineStamp}:${running}:${JSON.stringify(config.checks)}`;
}

/** @param {string} file @returns {[string, number][] | null} */
function readBaselineCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data.entries) ? data.entries : null;
  } catch {
    return null;
  }
}

/** @param {string} file @param {[string, number][]} entries */
function writeBaselineCache(file, entries) {
  try {
    mkdirSync(BASELINE_CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify({ v: 1, entries }));
  } catch { /* smugan-ignore empty-catch: baseline cache is best-effort; a miss just recomputes */ }
}

/**
 * `eslint --format json` stdout → violations (rule|message is the identity;
 * line is kept only for display). Empty output → no messages; unparseable →
 * null so the caller fails open instead of blocking on garbage.
 * @param {string} stdout @returns {import('./engine.mjs').Violation[] | null}
 */
export function parseEslintMessages(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return [];
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    const at = text.indexOf('[');
    if (at >= 0) {
      try { data = JSON.parse(text.slice(at)); } catch { return null; }
    }
  }
  if (!Array.isArray(data)) return null;
  /** @type {import('./engine.mjs').Violation[]} */
  const out = [];
  for (const file of data) {
    const messages = file && Array.isArray(file.messages) ? file.messages : [];
    for (const m of messages) {
      // A warning is advice the project chose NOT to make blocking; only
      // errors (and fatal parses, which come without a severity) gate here.
      if (m && m.severity === 1) continue;
      out.push({
        file: '', severity: 'error',
        rule: m && m.ruleId ? String(m.ruleId) : 'syntax',
        message: String((m && m.message) ?? '').replace(/\s+/g, ' ').trim(),
        line: Number(m && m.line) || 0,
      });
    }
  }
  return out;
}

/**
 * tsc output → violations. Identity for the diff is code+message (positions
 * shift as lines move), but the reported path is KEPT so the caller can drop
 * errors tsc surfaced in OTHER files of the compile closure — an edited file
 * cannot break the files it imports, yet their pre-existing errors used to be
 * relayed under the edited file's name at impossible line numbers (production app:
 * a 50-line test "at line 616"). Errors that name the temp tsconfig mean the
 * single-file trick didn't fit the project → null (caller fails open).
 * @param {string} output @returns {import('./engine.mjs').Violation[] | null}
 */
export function parseTscMessages(output) {
  const text = String(output ?? '');
  if (/\.smugan-tsc-[\w-]*\.json/.test(text)) return null;
  /** @type {import('./engine.mjs').Violation[]} */
  const out = [];
  const re = /(?:^|\n)(.*?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*([^\n]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      file: norm(m[1].trim()), severity: 'error',
      rule: m[3], message: m[4].replace(/\s+/g, ' ').trim(), line: Number(m[2]) || 0,
    });
  }
  return out;
}

/**
 * Current messages minus the git-HEAD baseline (cached per blob sha), leaving
 * only what this change introduced. No git baseline → all current (full check);
 * a baseline that won't lint → [] (fail open, legacy debt never blocks).
 * @param {string} abs @param {string} kind
 * @param {import('./engine.mjs').Violation[]} current
 * @param {(content: string) => import('./engine.mjs').Violation[] | null | Promise<import('./engine.mjs').Violation[] | null>} lintBaseline
 * @returns {Promise<import('./engine.mjs').Violation[]>}
 */
async function freshVsHead(abs, kind, current, lintBaseline) {
  if (current.length === 0) return [];
  const head = gitHead(abs);
  if (!head) return current;
  const cacheFile = baselineCacheFile(abs, kind, head.sha);
  let entries = readBaselineCache(cacheFile);
  if (!entries) {
    const baseline = await lintBaseline(head.content);
    if (baseline === null) return [];
    entries = [...countViolations(baseline)];
    writeBaselineCache(cacheFile, entries);
  }
  return freshAgainst(new Map(entries), current);
}

/**
 * Keeps only the errors tsc reported IN the checked file itself — errors in
 * the rest of the compile closure are those files' pre-existing debt, and
 * relaying them under the edited file's name produced impossible reports
 * ("line 616" of a 50-line file). tsc prints paths relative to its cwd
 * (baseDir); comparison is normalized and case-insensitive for Windows.
 * File is blanked afterwards: the diff identity is rule+message.
 * @param {import('./engine.mjs').Violation[]} parsed
 * @param {string} baseDir @param {string} target
 * @returns {import('./engine.mjs').Violation[]}
 */
export function ownFileErrors(parsed, baseDir, target) {
  const want = norm(target).toLowerCase();
  return parsed
    .filter((v) => !v.file || norm(resolve(baseDir, v.file)).toLowerCase() === want)
    .map((v) => ({ ...v, file: '' }));
}

const TEST_TSCONFIGS = ['tsconfig.spec.json', 'tsconfig.test.json', 'tsconfig.vitest.json'];

/**
 * The tsconfig an edited file is type-checked against: the nearest
 * tsconfig.json, except for a test that a test config includes. Projects
 * often keep the test runner's globals out of tsconfig.json: Nest's package
 * tsconfig.json lists no files, and only the root tsconfig.spec.json adds
 * vitest/globals. Checked against the nearest one, every it/vi/expect of a
 * new test came back as an unknown name. Going up to the repository root,
 * a test config that covers the test wins at any level, and so does the
 * nearest tsconfig.json when it covers it; otherwise the nearest
 * tsconfig.json, as for production code.
 * @param {string} abs @param {string} rel path relative to the project root
 * @returns {Promise<{ dir: string, name: string } | null>}
 */
export async function typecheckConfig(abs, rel) {
  const fileDir = dirname(abs);
  if (isTestPath(rel)) {
    let nearest = true;
    for (let dir = fileDir; ; dir = dirname(dir)) {
      for (const name of TEST_TSCONFIGS) {
        if (existsSync(join(dir, name)) && await tsconfigCovers(join(dir, name), abs)) return { dir, name };
      }
      // Only the nearest tsconfig.json: one further up is usually a base that
      // packages extend, without their paths, jsx or types.
      if (nearest && existsSync(join(dir, 'tsconfig.json'))) {
        if (await tsconfigCovers(join(dir, 'tsconfig.json'), abs)) return { dir, name: 'tsconfig.json' };
        nearest = false;
      }
      if (existsSync(join(dir, '.git')) || dirname(dir) === dir) break;
    }
  }
  const dir = findUp(fileDir, (d) => existsSync(join(d, 'tsconfig.json')));
  return dir ? { dir, name: 'tsconfig.json' } : null;
}

/**
 * Whether a tsconfig's own files/include take in `target`, the way tsc reads
 * them: each of files, include and exclude comes from the nearest config in
 * the relative `extends` chain that sets it, relative to that config; no
 * files and no include means everything under the config. A config that
 * cannot be read covers nothing.
 * @param {string} configPath @param {string} target
 */
export async function tsconfigCovers(configPath, target) {
  /** @type {Partial<Record<'files' | 'include' | 'exclude', { dir: string, list: string[] }>>} */
  const found = {};
  /** @type {string | null} */
  let current = configPath;
  for (let depth = 0; current && depth < 5; depth++) {
    const json = await readTsconfig(current);
    if (!json) return false;
    for (const key of /** @type {const} */ (['files', 'include', 'exclude'])) {
      if (!found[key] && Array.isArray(json[key])) found[key] = { dir: dirname(current), list: json[key].filter((/** @type {unknown} */ p) => typeof p === 'string') };
    }
    const base = Array.isArray(json.extends) ? json.extends[json.extends.length - 1] : json.extends;
    current = typeof base === 'string' && base.startsWith('.') ? resolve(dirname(current), base.endsWith('.json') ? base : base + '.json') : null;
  }
  const fold = (/** @type {string} */ p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const want = norm(target);
  const { files, exclude } = found;
  if (files && files.list.some((f) => fold(norm(resolve(files.dir, f))) === fold(want))) return true;
  const include = found.include ?? (files ? null : { dir: dirname(configPath), list: ['**/*'] });
  if (!include || !include.list.some((p) => tsconfigGlob(include.dir, p).test(want))) return false;
  return !exclude || !exclude.list.some((p) => tsconfigGlob(exclude.dir, p).test(want));
}

/**
 * A tsconfig include/exclude pattern as a regex over normalized absolute
 * paths: `*` and `?` stay inside one segment, `**` spans folders, and a last
 * segment with no wildcard and no extension names a folder.
 * @param {string} dir @param {string} pattern
 */
function tsconfigGlob(dir, pattern) {
  let full = norm(resolve(dir, pattern));
  const last = full.slice(full.lastIndexOf('/') + 1);
  if (!/[*?]/.test(last) && !/\.[^./]+$/.test(last)) full += '/**/*';
  const segments = full.split('/');
  const source = segments.map((segment, i) => {
    const end = i === segments.length - 1;
    if (segment === '**') return end ? '.*' : '(?:[^/]+/)*';
    const body = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    return end ? body : body + '/';
  }).join('');
  return new RegExp('^' + source + '$', process.platform === 'win32' ? 'i' : '');
}

/** @type {typeof import('jsonc-parser').parse | null | undefined} */
let parseJsonc;

/**
 * tsconfig files are JSONC. The parser is one of the gate's dependencies; a
 * gate installed without them still reads comment-free configs.
 * @param {string} file @returns {Promise<Record<string, any> | null>}
 */
async function readTsconfig(file) {
  if (parseJsonc === undefined) {
    try {
      parseJsonc = (await import('jsonc-parser')).parse;
    } catch (error) {
      if (!hasCode(error, 'ERR_MODULE_NOT_FOUND')) throw error;
      parseJsonc = null;
    }
  }
  const raw = readIfSmall(file);
  if (raw === null) return null;
  const text = raw.replace(/^﻿/, '');
  try {
    const json = parseJsonc ? parseJsonc(text, [], { allowTrailingComma: true }) : JSON.parse(text);
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null; // an unparseable config is one tsc rejects as well
  }
}

/** @param {import('./engine.mjs').Violation[]} fresh @returns {string} */
function formatFresh(fresh) {
  return fresh.slice(0, 25).map((v) => `  line ${v.line}  [${v.rule}]  ${v.message}`).join('\n');
}

/** @typedef {{ dir: string, name: string, bin: string }} TscProgram */

/**
 * The tsconfig and the project's own tsc an edited file is checked with, or
 * null when the project has either missing or the file is not one it checks.
 * @param {string} abs @param {string} rel @returns {Promise<TscProgram | null>}
 */
async function tscProgram(abs, rel) {
  if (!isTypeScriptSource(abs)) return null;
  const tsconfig = await typecheckConfig(abs, rel);
  // An .mts or .cts file is often there because the project compiles to the
  // other module system (vitest.config.mts beside "module": "commonjs"):
  // checked alone against a tsconfig that does not include it, valid code fails.
  if (tsconfig && /\.[mc]ts$/.test(abs) && !(await tsconfigCovers(join(tsconfig.dir, tsconfig.name), abs))) return null;
  const tsRoot = tsconfig && findUp(tsconfig.dir, (d) => existsSync(join(d, 'node_modules', 'typescript', 'bin', 'tsc')));
  return tsconfig && tsRoot ? { ...tsconfig, bin: join(tsRoot, 'node_modules', 'typescript', 'bin', 'tsc') } : null;
}

let tscSeq = 0;

/**
 * One tsc program over `targets` through a temp tsconfig that extends the
 * project's, so paths, jsx and types still apply.
 * @param {TscProgram} program @param {string[]} targets
 * @param {string | null} buildInfo .tsbuildinfo for an incremental program, or null for a one-off
 * @param {number} timeoutMs
 * @returns {Promise<{ errors: import('./engine.mjs').Violation[] | null, timedOut: boolean, crash: string | null, global: string | null }>}
 *   `errors` null: timed out, the project's config does not fit a per-file
 *   check, or one of the two below. `crash`: tsc exited non-zero with no
 *   diagnostic at all. `global`: only diagnostics without a file, which come
 *   from the config.
 */
async function runTsc(program, targets, buildInfo, timeoutMs) {
  const tempConfig = join(program.dir, `.smugan-tsc-${process.pid}-${tscSeq++}.json`);
  try {
    writeFileSync(tempConfig, JSON.stringify({
      extends: `./${program.name}`,
      // Ambient declarations (declare module ...) live in .d.ts files the
      // project pulls in via its own include; dropping them made tsc
      // re-report every ambient-typed import as TS7016 (production app, sql.js FP).
      include: ['**/*.d.ts'],
      files: targets.map(norm),
      // A reused .tsbuildinfo keeps unchanged dependencies from being
      // re-checked every run (production paid a cold ~16s tsc per save).
      // Baseline runs check a temp sibling, a different program, and stay
      // non-incremental.
      compilerOptions: { noEmit: true, composite: false, incremental: buildInfo !== null, ...(buildInfo ? { tsBuildInfoFile: buildInfo } : {}) },
    }));
    const result = await runNode([program.bin, '-p', tempConfig], program.dir, timeoutMs);
    if (result.timedOut) return { errors: null, timedOut: true, crash: null, global: null };
    const errors = parseTscMessages(result.output);
    // Non-zero with no file error: either a global diagnostic (a missing
    // `types` entry, a bad option) or, with no diagnostic at all, tsc itself
    // failing (out of memory, broken install). Neither is a pass.
    if (errors && errors.length === 0 && result.status !== 0) {
      const output = tail(result.output, 12) || `exit ${result.status}`;
      return /\berror TS\d+:/.test(result.output)
        ? { errors: null, timedOut: false, crash: null, global: output }
        : { errors: null, timedOut: false, crash: output, global: null };
    }
    return { errors, timedOut: false, crash: null, global: null };
  } finally {
    try { unlinkSync(tempConfig); } catch { /* smugan-ignore empty-catch: temp tsconfig cleanup is best-effort */ }
  }
}

/**
 * Diff-aware typecheck of files that share one tsconfig: a single tsc program
 * for all of them, then each file's own errors minus those its committed
 * version already had. Errors elsewhere in the compile closure are those
 * files' debt and never reported here. At most two tsc programs: the touched
 * files, then the committed versions of those with errors whose baseline is
 * not cached yet, all in one.
 * @param {TscProgram} program @param {{ abs: string, rel: string }[]} files @param {number} timeoutMs
 * @returns {Promise<{ failures: string[], unverified: 'timeout' | 'config' | 'baseline' | null }>}
 */
async function typecheckFiles(program, files, timeoutMs, configTouched = false) {
  sweepStaleTemp(program.dir, /^\.smugan-tsc-[\w.-]+\.json$/);
  const key = files.length === 1 ? files[0].abs : join(program.dir, program.name);
  const current = await runTsc(program, files.map((f) => f.abs), buildInfoFile(key), timeoutMs);
  if (current.crash) return { failures: [`typecheck (tsc) failed without reporting a type error:\n${current.crash}`], unverified: null };
  if (current.global) {
    // A global diagnostic is the config's: the turn's when it changed the
    // tsconfig against git HEAD, debt when the committed one already has it.
    const configPath = join(program.dir, program.name);
    const head = gitHead(configPath);
    const changed = configTouched || head !== null && head.content.replace(/\r\n/g, '\n') !== (readIfSmall(configPath) ?? '').replace(/\r\n/g, '\n');
    return changed
      ? { failures: [`typecheck (tsc) — ${program.name} changed this turn and tsc rejects it:\n${current.global}`], unverified: null }
      : { failures: [], unverified: 'config' };
  }
  const currentErrors = current.errors;
  if (!currentErrors) return { failures: [], unverified: current.timedOut ? 'timeout' : 'config' };
  const withErrors = files.map((f) => ({ ...f, own: ownFileErrors(currentErrors, program.dir, f.abs) })).filter((f) => f.own.length > 0);
  // 'tsc2': the severity/attribution semantics changed in 0.13; a baseline
  // measured under the old rules must not be subtracted here.
  /** @type {Map<string, Map<string, number>>} committed error counts; empty for a file outside git (full check) */
  const baselines = new Map();
  /** @type {{ abs: string, content: string, cacheFile: string }[]} */
  const misses = [];
  for (const f of withErrors) {
    const head = gitHead(f.abs);
    if (!head) { baselines.set(f.abs, new Map()); continue; }
    const cacheFile = baselineCacheFile(f.abs, 'tsc2', head.sha);
    const cached = readBaselineCache(cacheFile);
    if (cached) baselines.set(f.abs, new Map(cached));
    else misses.push({ abs: f.abs, content: head.content, cacheFile });
  }
  /** @type {'timeout' | 'baseline' | null} */
  let unverified = null;
  if (misses.length > 0) {
    // Temp siblings, so the committed content's relative imports resolve.
    const temps = misses.map((m) => {
      sweepStaleTemp(dirname(m.abs), /^\.smugan-tscbase-/);
      return join(dirname(m.abs), `.smugan-tscbase-${process.pid}-${tscSeq++}${extname(m.abs)}`);
    });
    try {
      misses.forEach((m, i) => writeFileSync(temps[i], m.content));
      const base = await runTsc(program, temps, null, timeoutMs);
      const baseErrors = base.errors;
      if (!baseErrors) unverified = base.timedOut ? 'timeout' : 'baseline';
      else {
        misses.forEach((m, i) => {
          const entries = [...countViolations(ownFileErrors(baseErrors, program.dir, temps[i]))];
          writeBaselineCache(m.cacheFile, entries);
          baselines.set(m.abs, new Map(entries));
        });
      }
    } finally {
      for (const temp of temps) {
        try { unlinkSync(temp); } catch { /* smugan-ignore empty-catch: temp baseline cleanup is best-effort */ }
      }
    }
  }
  /** @type {string[]} */
  const failures = [];
  for (const f of withErrors) {
    // No baseline measured: legacy debt smugan could not separate never blocks.
    const baseline = baselines.get(f.abs);
    const fresh = baseline ? freshAgainst(baseline, f.own) : [];
    if (fresh.length > 0) failures.push(`typecheck (${f.rel}) — ${fresh.length} new:\n${formatFresh(fresh)}`);
  }
  return { failures, unverified };
}

/**
 * @param {string} abs @param {string} rel
 * @param {import('./config.mjs').SmuganConfig} config @param {unknown} sessionId
 */
async function postHook(abs, rel, config, sessionId) {
  if (!existsSync(abs)) return OK;
  if (!CODE_FILE_RE.test(abs)) return OK;

  const { timeoutMs } = config.hook;
  const fileDir = dirname(abs);
  /** @type {(() => Promise<string | null>)[]} */
  const checks = [];

  if (config.hook.eslint) {
    const eslintRoot = findUp(fileDir, (d) => existsSync(join(d, 'node_modules', 'eslint', 'bin', 'eslint.js')));
    const configRoot = findUp(fileDir, (d) =>
      ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'].some((f) => existsSync(join(d, f))),
    );
    if (eslintRoot && configRoot) {
      const bin = join(eslintRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
      // content === null → lint the file on disk (current); else lint that
      // content as if it were this file (--stdin-filename keeps config resolution).
      /** @param {string | null} content @returns {Promise<import('./engine.mjs').Violation[] | null>} */
      const runEslint = async (content) => {
        const head = [bin, '--format', 'json', '--no-warn-ignored'];
        const target = content === null ? [abs] : ['--stdin', '--stdin-filename', abs];
        let result = await runNode([...head, ...target], configRoot, timeoutMs, content ?? undefined);
        if (result.status !== 0 && /unrecognized option|unknown option/i.test(result.output)) {
          result = await runNode([bin, '--format', 'json', ...target], configRoot, timeoutMs, content ?? undefined);
        }
        return result.timedOut ? null : parseEslintMessages(result.stdout);
      };
      checks.push(async () => {
        const current = await runEslint(null);
        if (!current || current.length === 0) return null;
        const fresh = await freshVsHead(abs, 'eslint2', current, (content) => runEslint(content));
        return fresh.length > 0 ? `eslint (${rel}) — ${fresh.length} new:\n${formatFresh(fresh)}` : null;
      });
    }
  }

  // Typecheck waits for the Stop, which sees the turn's final state: mid-way
  // through a multi-file change, a file often fails to type-check against
  // callers not yet updated, and each of those blocks was an interruption the
  // next edit would have fixed anyway (the dead-imports lesson in preHook).
  // With the Stop switched off there is no later moment, so it runs here.
  const program = config.hook.typecheck && config.hook.stop === false ? await tscProgram(abs, rel) : null;
  if (program) {
    checks.push(async () => {
      const { failures } = await typecheckFiles(program, [{ abs, rel }], timeoutMs);
      return failures.length > 0 ? failures.join('\n') : null;
    });
  }

  // Independent single-file checks: concurrency turns eslint+tsc latency
  // from their sum into their max.
  const failures = (await Promise.all(checks.map((run) => run()))).filter(
    (/** @type {string | null} */ f) => f !== null,
  );

  if (failures.length === 0) return OK;
  const warn = config.mode === 'warn';
  const stderr =
    `smugan hook${warn ? ' (warn mode, nothing blocked)' : ''}: ${rel} introduces problems the project's own checks reject — ${warn ? 'fix them in this change when you can' : 'fix before continuing'}:\n\n` +
    failures.join('\n\n') +
    `\nOnly NEW problems are shown; pre-existing debt is spared. Suppress a false positive with the tool's own directive (eslint-disable / @ts-expect-error).\n`;
  note(sessionId, { hook: 'post', outcome: warn ? 'warned' : 'blocked', root: norm(config.root), file: rel, tools: failures.map((f) => f.split(' ')[0]) });
  return warn ? warned(stderr) : { exitCode: BLOCK, stderr };
}

// --- stop hook: mechanical Definition of Done for the whole turn ---

// A hold re-runs every check and costs the session a round trip. A turn that
// touched a critical file keeps two tries; any other turn gets one: the
// model sees the failures once and shows its own passing run, instead of the
// hook re-proving each fix.
const MAX_STOP_BLOCKS = 2;
const ROUTINE_STOP_BLOCKS = 1;
// Every project root can spend typecheck + tests inside one shared Stop
// deadline, so a turn spanning many projects only scripts the first few.
const MAX_SCRIPT_ROOTS = 2;

/**
 * Prose. Editing it cannot change what typecheck, tests or a build produce, so
 * running the project's scripts for a docs-only turn pays full price (in a
 * monorepo, the whole suite) for a guaranteed-unchanged answer — and then
 * reports "this turn modified code" about a turn that modified none.
 * `runTests`'s vitest path already worked this way (no code file → nothing
 * related to run); the plain-script path did not.
 *
 * Deliberately narrow — everything not listed here still counts as code: .mdx
 * compiles in MDX-aware frameworks, and JSON/YAML/SQL feed builds, fixtures
 * and migrations. Only files nothing can execute belong here.
 */
const PROSE_ONLY_RE = /\.(?:md|markdown|txt|rst|adoc)$/i;

/** @param {string} marker */
function tryUnlink(marker) {
  try {
    unlinkSync(marker);
  } catch { /* smugan-ignore empty-catch: marker cleanup is best-effort */ }
}

// --- cross-turn debt: failures that already spent a turn's block budget ---
//
// The per-turn cap stops infinite loops inside ONE turn, but the counter died
// with the turn marker: a persistently red suite (usually debt the turn never
// caused) re-blocked EVERY turn 3×, re-running the whole suite each time.
// The debt file remembers the fingerprint of what was still failing when a
// turn spent its budget; a later turn failing with the SAME fingerprint ends
// quietly. Any change in the failure set — progress or a new break — blocks
// again with a fresh budget, and a green run deletes the debt so a future
// regression gets the full treatment.

/** @param {unknown} sessionId */
function stopDebtPath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe ? join(tmpdir(), 'smugan-stopdebt-' + safe + '.json') : null;
}

/**
 * Identity of ONE failure — a gate line, or one check/package's script run.
 * Runner output is full of run-to-run noise that made identical failures look
 * new every round: the 0.12.1 dedup never fired once in production because the
 * fingerprint kept ISO log-prefix timestamps and tail-truncation counts
 * (production app, jul/2026). Masks are deliberately NARROW — durations, BRACKETED
 * log-prefix timestamps, and smugan's own truncation counter — so two failures
 * differing in an asserted VALUE (a bare date in an expect diff) stay
 * distinct: when masking errs, it must err toward re-blocking, never toward
 * absorbing a new regression as known debt.
 * @param {string} failure
 */
function failureUnit(failure) {
  return failure
    .replace(/duration_ms[:=\s]\s*[\d.]+/gi, 'duration_ms #')
    .replace(/\bduration\s+[\d.]+\s*m?s\b/gi, 'duration #')
    .replace(/\b\d+(?:\.\d+)?\s*m?s\b/gi, '# ms')
    .replace(/\[\d{4}-\d{2}-\d{2}T[^\]\n]*\]/g, '[#ts]')
    .replace(/\(\d+ (?:more lines|lines omitted)\)/g, '(# lines)')
    .trim();
}

/** @param {string | null} debtFile @returns {Set<string>} */
function readDebt(debtFile) {
  if (!debtFile) return new Set();
  try {
    const data = JSON.parse(readFileSync(debtFile, 'utf8'));
    if (Array.isArray(data.prints)) {
      return new Set(data.prints.filter((/** @type {unknown} */ p) => typeof p === 'string'));
    }
    // pre-0.13 debt files carried one concatenated print
    return new Set(typeof data.print === 'string' ? [data.print] : []);
  } catch {
    return new Set();
  }
}

/**
 * Claude Code (observed in the 2.1.220 binary, still present in 2.1.299) DEMOTES a Stop hook's exit 2 to
 * a non-blocking "hook script appears to be missing" when stdout is empty AND
 * stderr matches /no such file|can't open/i — which raw runner output
 * ("ENOENT: no such file or directory") matches all the time. In production
 * that silently killed the DoD hold: the model was never re-invoked. Rewording
 * keeps the meaning; the non-empty stdout retires the heuristic's other half.
 * Accepted cost: the rewrite also touches SNIFFED PHRASES QUOTED INSIDE test
 * output (an assertion on an ENOENT message reads "file does not exist" in the
 * relay) — a wrong literal in a diff beats a hold that silently dies.
 * @param {string} text
 */
function defuseHarnessSniff(text) {
  return text
    .replace(/no such file or directory/gi, 'file or directory does not exist')
    .replace(/no such file/gi, 'file does not exist')
    .replace(/can't open/gi, 'cannot open');
}

const STOP_BLOCK_STDOUT = 'smugan stop: turn held — Definition of Done report on stderr.\n';

/** @param {string} root @returns {Record<string, string>} */
function readScripts(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  } catch {
    return {};
  }
}

/** @param {string} root */
function packageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Runs a shell command (project scripts only), time-boxed, CI env.
 * @param {string} command @param {string} cwd @param {number} timeoutMs
 * @returns {Promise<{ status: number, output: string, timedOut: boolean, cleanupFailed: boolean }>}
 */
function runShell(command, cwd, timeoutMs) {
  // A DoD child suite must run as if invoked fresh: when the hook itself runs
  // under node:test (the gate's and the adapters' own suites do), an inherited
  // NODE_TEST_CONTEXT makes a `node --test` project skip every file and exit 0
  // — a false green.
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, CI: '1' };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let cleanupFailed = false;
    const captureLimit = 64 * 1024;
    // Keep draining the pipes: a capture limit must not terminate the check.
    const child = spawn(command, {
      cwd, env, shell: true, windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @param {number | null} code */
    const finish = (code) => {
      clearTimeout(timer);
      const note = truncated ? '\nsmugan: earlier output omitted by the capture limit.\n' : '';
      resolveResult({ status: code ?? 1, output: stdout + stderr + note, timedOut, cleanupFailed });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            timeout: 15000, windowsHide: true, stdio: 'ignore',
          });
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch (error) {
        if (!hasCode(error, 'ESRCH')) {
          cleanupFailed = true;
          const code = ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM'].find((value) => hasCode(error, value));
          stderr += '\nsmugan: could not terminate the check\'s process tree' + (code ? ` (${code})` : '') + '; result not verified.\n';
          try {
            child.kill('SIGKILL');
          } catch (fallbackError) {
            if (!hasCode(fallbackError, 'ESRCH')) {
              stderr += '\nsmugan: the main process could not be terminated either; result not verified.\n';
            }
          }
        }
      } finally {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(1);
      }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > captureLimit) {
        truncated = true;
        stdout = stdout.slice(-captureLimit);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > captureLimit) {
        truncated = true;
        stderr = stderr.slice(-captureLimit);
      }
    });
    child.on('error', (error) => {
      stderr += '\n' + error.message;
    });
    child.on('close', finish);
  });
}

/**
 * @param {string} label
 * @param {{ status: number, output: string, timedOut: boolean, cleanupFailed?: boolean }} result
 * @param {number} timeoutMs
 * @param {string[]} failures
 * @param {string[]} incomplete
 * @param {{ label: string, status: string }[]} ran
 */
function recordScriptResult(label, result, timeoutMs, failures, incomplete, ran) {
  if (result.cleanupFailed || (result.status !== 0 && !result.timedOut)) {
    failures.push(label + ':\n' + tail(result.output));
    ran.push({ label, status: 'failed' });
  } else if (result.timedOut) {
    incomplete.push(`${label}: ${timeoutMs} ms deadline exceeded; result not verified.`);
    ran.push({ label, status: 'timeout' });
  } else {
    ran.push({ label, status: 'passed' });
  }
}

/**
 * Workspace root marker: pnpm-workspace.yaml or a "workspaces" field.
 * @param {string} root
 */
function isWorkspaceRoot(root) {
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return Boolean(pkg.workspaces);
  } catch {
    return false;
  }
}

/**
 * Nearest enclosing package dir for each touched file, or null when any file
 * belongs to the root package itself — a root-level change is honestly
 * checked by the root suite.
 * @param {string} root @param {string[]} touched @returns {string[] | null}
 */
function touchedPackageDirs(root, touched) {
  const dirs = new Set();
  for (const file of touched) {
    if (!norm(file).startsWith(norm(root) + '/')) continue;
    const pkgDir = findUp(dirname(file), (d) => existsSync(join(d, 'package.json')));
    if (!pkgDir) continue;
    if (norm(pkgDir) === norm(root)) return null;
    dirs.add(pkgDir);
  }
  return [...dirs];
}

/** A real, runnable test script — not npm's "no test specified" scaffold. */
/** @param {Record<string, string>} scripts */
function hasTestScript(scripts) {
  return typeof scripts.test === 'string' && scripts.test.trim() !== '' && !/no test specified/i.test(scripts.test);
}

/** @param {string} root */
const vitestBin = (root) => join(root, 'node_modules', 'vitest', 'vitest.mjs');

/** Touched JS/TS files under root, as vitest `related` arguments. @param {string} root @param {string[]} touched */
function vitestRelated(root, touched) {
  return touched
    .filter((f) => CODE_FILE_RE.test(f) && norm(f).startsWith(norm(root) + '/'))
    .map((f) => norm(relative(root, f)));
}

/**
 * What the Stop would run in one root, decided before anything runs so that a
 * root with nothing to verify never takes a slot of MAX_SCRIPT_ROOTS.
 * @param {string} root @param {import('./config.mjs').StopConfig} stopCfg @param {string[]} touched
 */
function scriptPlan(root, stopCfg, touched) {
  const scripts = readScripts(root);
  const typecheck = stopCfg.typecheck === false ? undefined : ['typecheck', 'type-check'].find((s) => typeof scripts[s] === 'string');
  const tests = stopCfg.tests !== false && (existsSync(vitestBin(root)) ? vitestRelated(root, touched).length > 0 : hasTestScript(scripts));
  // No build here, even when asked for: a build shares the Stop's deadline
  // with typecheck and tests, and past that deadline the hook fails open, so
  // the turn waited and still nothing was verified. Builds belong to CI.
  return { scripts, typecheck, tests };
}

/**
 * Affected tests when vitest is available; the plain test script otherwise.
 * @param {string} root @param {Record<string, string>} scripts
 * @param {string[]} touched @param {number} timeoutMs @param {string[]} failures
 * @param {string[]} incomplete @param {{ label: string, status: string }[]} ran
 */
async function runTests(root, scripts, touched, timeoutMs, failures, incomplete, ran) {
  const vitest = vitestBin(root);
  if (existsSync(vitest)) {
    const related = vitestRelated(root, touched);
    if (related.length === 0) return;
    const result = await runNode([vitest, 'related', '--run', '--passWithNoTests', ...related], root, timeoutMs);
    recordScriptResult('tests (vitest related)', result, timeoutMs, failures, incomplete, ran);
    return;
  }
  if (!hasTestScript(scripts)) return;
  const pm = packageManager(root);
  // In a workspace monorepo the root test script fans out to EVERY package —
  // and pnpm -r bails at the first failure, hiding the rest — so a turn that
  // touched one package paid the whole suite and any unrelated red package
  // blocked it. Scope to the packages the turn actually touched; a root-level
  // change still runs the full root suite.
  // A turn spanning more than 3 packages is a root-scale change: fall back to
  // the full root suite instead of silently skipping the overflow — a dropped
  // red package would read as a false green.
  const pkgs = isWorkspaceRoot(root) ? touchedPackageDirs(root, touched) : null;
  if (pkgs && pkgs.length <= 3) {
    for (const dir of pkgs) {
      const pkgScripts = readScripts(dir);
      if (!hasTestScript(pkgScripts)) continue;
      const result = await runShell(pm + ' test', dir, timeoutMs);
      recordScriptResult(`tests (${norm(relative(root, dir))} ${pm} test)`, result, timeoutMs, failures, incomplete, ran);
    }
    return;
  }
  const result = await runShell(pm + ' test', root, timeoutMs);
  recordScriptResult('tests (' + pm + ' test)', result, timeoutMs, failures, incomplete, ran);
}

/** @typedef {{ program: TscProgram, files: { abs: string, rel: string }[] }} TscGroup */

const UNVERIFIED_TSC = {
  timeout: '# ms deadline exceeded',
  config: 'the project tsconfig does not allow per-file checking or has a global error',
  baseline: 'the committed version of the failing files could not be checked, so old errors were not separated from new ones',
};

/**
 * Touched TypeScript files grouped by the tsc program that checks them; files
 * whose project has no tsconfig or no installed typescript drop out.
 * @param {{ abs: string, rel: string }[]} touched @returns {Promise<TscGroup[]>}
 */
async function tscGroups(touched) {
  /** @type {Map<string, TscGroup>} */
  const groups = new Map();
  for (const file of touched) {
    const program = await tscProgram(file.abs, file.rel);
    if (!program) continue;
    const key = join(program.dir, program.name);
    groups.set(key, { program, files: [...(groups.get(key)?.files ?? []), file] });
  }
  return [...groups.values()];
}

/**
 * @param {TscGroup[]} groups @param {number} timeoutMs @param {string[]} failures
 * @param {string[]} incomplete @param {{ label: string, status: string }[]} ran
 * @param {boolean} configTouched the turn created or edited a tsconfig
 */
async function typecheckTouched(groups, timeoutMs, failures, incomplete, ran, configTouched) {
  for (const { program, files } of groups) {
    const label = `typecheck (tsc, ${files.length} file${files.length === 1 ? '' : 's'})`;
    const result = await typecheckFiles(program, files, timeoutMs, configTouched);
    failures.push(...result.failures);
    if (result.failures.length > 0) ran.push({ label, status: 'failed' });
    else if (result.unverified) {
      incomplete.push(`${label}: ${UNVERIFIED_TSC[result.unverified].replace('#', String(timeoutMs))}; result not verified.`);
      ran.push({ label, status: result.unverified === 'timeout' ? 'timeout' : 'unverified' });
    } else ran.push({ label, status: 'passed' });
  }
}

/**
 * A user-facing note on the exit-0 paths: Claude Code delivers exit-0 stderr
 * to NOBODY (verified in production — give-up messages were dead text the
 * model never saw and the user never read). The documented channel that still
 * works on exit 0 is stdout JSON `systemMessage`, which surfaces in the UI at
 * zero model-token cost.
 * @param {string} text
 */
function userNote(text) {
  return JSON.stringify({ systemMessage: text }) + '\n';
}

/**
 * checkTurn's answer when files changed while it checked them: what it saw is
 * already stale, so Stop checks the newer state right away instead of
 * holding the turn. Only a failed check holds a turn.
 */
const STALE = Object.freeze({ exitCode: 0, stderr: '' });
// The Stop hook's timeout in settings-fragment.json, less a margin; a host
// configured with another timeout sets SMUGAN_STOP_DEADLINE_MS to match it.
const STOP_DEADLINE_MS = 270_000;

/** The newest edits stayed unchecked: files kept changing, or no time was left. @param {boolean} rechecked */
function stillChanging(rechecked) {
  const message = rechecked
    ? 'smugan stop: files changed during the checks twice in a row; the latest edits were not verified. Run the checks again before declaring the work done.'
    : 'smugan stop: files changed during the checks, and re-checking would not fit in the hook deadline; the latest edits were not verified. Run the checks again before declaring the work done.';
  return { exitCode: 0, stderr: message + '\n', stdout: userNote(message) };
}

/**
 * What one Stop decided and why, for `smugan why`: filled while the checks run,
 * written whatever the outcome.
 * @typedef {{ outcome: string, attempt: number, maxAttempts: number, cwd: string | null,
 *   files: { path: string, status: string, violations?: number }[],
 *   scripts: { label: string, status: string }[], skipped: { root: string, reason: string }[],
 *   failures: string[], incomplete: string[], level?: string, lowered?: string[], vanished?: string[] }} StopReport
 */

/**
 * The turn's level, the highest of its files, and each project's own. While
 * `smugan risk` forces a level on a checkout, its files take it; the files it
 * lowered are listed, because the user must see what skipped the stricter
 * path even when the agent ran the command.
 * @param {string[]} files @param {unknown} sessionId
 */
function turnLevels(files, sessionId) {
  /** @type {Map<string, ReturnType<typeof riskOverride>>} */
  const forced = new Map();
  /** @type {Map<string, import('./risk.mjs').Level>} */
  const byRoot = new Map();
  /** @type {string[]} */
  const lowered = [];
  /** @type {import('./risk.mjs').Level} */
  let level = 'trivial';
  for (const file of files) {
    const { root } = loadConfig(dirname(file));
    if (!forced.has(root)) forced.set(root, riskOverride(root));
    const rel = norm(relative(root, file));
    const own = fileLevel(rel, file.endsWith('.rs') ? readIfSmall(file) : null);
    const override = forced.get(root);
    const effective = override ? override.level : own;
    if (override && LEVELS.indexOf(override.level) < LEVELS.indexOf(own)) lowered.push(`${rel} (${own})`);
    byRoot.set(root, higher(byRoot.get(root) ?? 'trivial', effective));
    level = higher(level, effective);
  }
  trackOverrides(sessionId, forced);
  return { level, byRoot, lowered };
}

/**
 * Adds a line for the user to a Stop result. On exit 0 it rides only the
 * systemMessage: adapters read exit-0 stderr as an unfinished turn and would
 * hold a green one.
 * @param {{ exitCode: number, stderr: string, stdout?: string }} result @param {string} text
 */
function withUserLine(result, text) {
  if (result.exitCode === BLOCK) return { ...result, stderr: result.stderr + text + '\n' };
  const previous = result.stdout ? JSON.parse(result.stdout).systemMessage : null;
  return { ...result, stdout: userNote(typeof previous === 'string' ? `${previous}\n${text}` : text) };
}

/** @param {any} input @returns {Promise<{ exitCode: number, stderr: string, stdout?: string }>} */
async function stopHook(input) {
  /** @type {StopReport} */
  const report = { outcome: 'nothing-touched', attempt: 0, maxAttempts: MAX_STOP_BLOCKS, cwd: typeof input?.cwd === 'string' ? norm(input.cwd) : null, files: [], scripts: [], skipped: [], failures: [], incomplete: [] };
  /** @param {number} exitCode */
  const save = (exitCode) => {
    try {
      writeReport(input?.session_id, { ...report, exitCode });
    } catch { /* smugan-ignore empty-catch: the report only explains a decision already taken; it never changes it */ }
  };
  try {
    const started = Date.now();
    const deadline = Number(process.env.SMUGAN_STOP_DEADLINE_MS) || STOP_DEADLINE_MS;
    let result = await checkTurn(input, report);
    // A second pass takes about as long as the first: run it only when both
    // fit the Stop's deadline, or the host kills the hook mid-check.
    let rechecked = false;
    if (result === STALE && (Date.now() - started) * 2 < deadline) {
      Object.assign(report, { files: [], scripts: [], skipped: [], failures: [], incomplete: [], lowered: [] });
      result = await checkTurn(input, report);
      rechecked = true;
    }
    if (result === STALE) {
      report.outcome = 'changed-during-stop';
      result = stillChanging(rechecked);
    }
    // Only a Stop that lets the turn end shows the user a line; a held one
    // leaves the notice pending for the next.
    if (result.exitCode !== BLOCK) report.vanished = takeVanished(input?.session_id);
    for (const root of report.vanished ?? []) {
      result = withUserLine(result, `smugan: the level forced on ${root} disappeared before it expired, without \`smugan risk auto\`: its file was deleted. Check with \`smugan risk\` and force it again if it still applies.`);
    }
    if (report.lowered?.length) {
      const shown = report.lowered.slice(0, 5).join(', ') + (report.lowered.length > 5 ? ` and ${report.lowered.length - 5} more` : '');
      result = withUserLine(result, `smugan: level ${report.level} was forced with \`smugan risk\` and downgraded ${shown}; this end of turn followed the forced level. Return to automatic with \`smugan risk auto\`.`);
    }
    save(result.exitCode);
    if (result.exitCode === BLOCK) note(input?.session_id, { hook: 'stop', outcome: 'blocked', root: report.cwd, attempt: report.attempt, failures: report.failures.length });
    return result;
  } catch (error) {
    // runHook fails open on this; the report must not keep the previous verdict.
    report.outcome = 'error';
    report.incomplete.push(clip(error instanceof Error ? error.message : String(error)));
    save(0);
    throw error;
  }
}

/**
 * What the turn was asked to do: the active acceptance contract and the
 * user's recent requests. Null when neither is readable, and then the checks
 * that compare against it stay quiet.
 * @param {string} root @param {unknown} transcriptPath @param {unknown} sessionId
 * @returns {string | null}
 */
function turnScope(root, transcriptPath, sessionId) {
  /** @type {string[]} */
  const parts = [];
  try {
    const contract = readContract(contractRoot(root));
    // A contract with every criterion done is finished work, not this turn's scope.
    if (contract && contract.criteria.some((c) => c.status !== 'done')) {
      parts.push(contract.request, ...contract.criteria.map((c) => `${c.behavior} ${c.verify}`), ...contract.decisions.map((d) => `${d.decision} ${d.reason}`));
    }
  } catch (error) {
    note(sessionId, { hook: 'stop', outcome: 'scope-contract-unreadable', detail: clip(error instanceof Error ? error.message : String(error)) });
  }
  try {
    const prompts = recentUserPrompts(transcriptPath);
    if (prompts) parts.push(prompts);
  } catch (error) {
    note(sessionId, { hook: 'stop', outcome: 'scope-transcript-unreadable', detail: clip(error instanceof Error ? error.message : String(error)) });
  }
  return parts.length ? parts.join('\n') : null;
}

/**
 * What the files a Stop checks look like: each path with its size and the
 * time it was written. The next Stop compares it with what it finds, to know
 * whether anything was written since.
 * @param {string[]} files
 */
function filesPrint(files) {
  const lines = files.map((file) => {
    try {
      const stats = statSync(file);
      return `${rootKey(file)}\0${stats.size}\0${stats.mtimeMs}`;
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
      return `${rootKey(file)}\0gone`; // deleted between the listing and here
    }
  });
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex').slice(0, 32);
}

/** @param {any} input @param {StopReport} report @returns {Promise<{ exitCode: number, stderr: string, stdout?: string }>} */
async function checkTurn(input, report) {
  const marker = turnMarkerPath(input?.session_id);
  if (!marker || !existsSync(marker)) return OK;
  const state = readTurn(marker);
  report.attempt = state.blocks;
  for (const f of new Set(state.files)) if (!existsSync(f)) report.files.push({ path: norm(f), status: 'missing' });
  const shell = shellChanges(state);
  const edited = new Set(state.files.map(rootKey));
  /** The turn's files that exist, each once: Windows may spell one path in two cases. @param {string[]} fromShell */
  const listed = (fromShell) => {
    const seen = new Set();
    return [...state.files, ...fromShell].filter((f) => {
      const key = rootKey(f);
      if (seen.has(key)) return false;
      seen.add(key);
      return existsSync(f) && !isAssistantState(f);
    });
  };
  const files = listed(shell.files);
  const created = [...state.created, ...shell.created];
  /** Each version a file had in the turn's commits, read and checked once. @type {Map<string, { text: string | null, counts: Map<string, number> }>} */
  const versions = new Map();
  const historyDeadline = Date.now() + SHELL_HISTORY_BUDGET_MS;
  let historyLate = 0;
  if (files.length === 0) {
    if (!retireTurn(marker, state.revision)) return STALE;
    if (shell.notes.length === 0) return OK;
    // Nothing to check is not the same as nothing checked: say what was not read.
    const text = 'smugan stop: incomplete checks:\n' + shell.notes.join('\n') + '\n';
    report.outcome = 'incomplete';
    report.incomplete = shell.notes.map((n) => clip(n));
    return { exitCode: 0, stderr: text, stdout: userNote(text) };
  }
  const levels = turnLevels(files, input?.session_id);
  const cap = levels.level === 'critical' ? MAX_STOP_BLOCKS : ROUTINE_STOP_BLOCKS;
  report.maxAttempts = cap;
  report.level = levels.level;
  report.lowered = levels.lowered;
  // A hold counts against the turn it held. A Stop the host does not call a
  // continuation ends another turn: the held one never reached its second
  // Stop, because it was interrupted or because the host cannot hold a turn
  // and delivers the verdict later. When that turn wrote something, releasing
  // it here would end it with nothing checked, so its budget starts over;
  // what the spent hold listed is debt by now, and only a failure it did not
  // list holds again. With nothing written since the hold there is nothing
  // new to check and the turn is released: a red suite whose output differs
  // on every run would otherwise hold every later turn.
  const print = filesPrint(files);
  const renewed = state.blocks >= cap && input?.stop_hook_active === false && state.held !== print;
  if (renewed) report.attempt = state.blocks = 0;
  if (state.blocks >= cap) {
    report.outcome = 'released-after-cap';
    retireTurn(marker, state.revision);
    // No re-check ran here, so don't assert the state as fact — the model may
    // have fixed things after the last blocked attempt (seen in production).
    // stderr stays for the adapters (antigravity/opencode DO deliver exit-0
    // stderr and hold their caps on it); stdout systemMessage is the channel
    // Claude Code shows the user. Claude Code drops exit-0 stderr, so keeping
    // both costs nothing there.
    const spent = `${cap} blocked attempt${cap === 1 ? '' : 's'} spent`;
    // A hold that only listed residue, drift or clones had every check green.
    if (state.listedOnly) {
      return {
        exitCode: 0,
        stderr: `smugan stop: ${spent} — the last hold only listed items for you to review, with every check green; letting the turn end. Tell the user what you kept and why.
`,
        stdout: userNote('smugan: the last hold only listed items for the agent to review (residue, contract drift, clones or removed tests), with every check green; the turn ends without re-running them.'),
      };
    }
    return {
      exitCode: 0,
      stderr: `smugan stop: ${spent} — letting the turn end without re-running the checks. The LAST check was still red; if you fixed it since, show the passing run, otherwise tell the user exactly what remains broken.\n`,
      stdout: userNote(`smugan: ${cap === 1 ? '1 hold used' : `${cap} holds used`} — the turn ends without the hook re-running the checks. Its last check was red; trust "done" only with a green run the agent showed.`),
    };
  }

  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, import('./config.mjs').SmuganConfig>} */
  const roots = new Map();
  /** Roots where the turn touched something a script can react to. @type {Set<string>} */
  const codeRoots = new Set();
  /** @type {{ abs: string, rel: string, content: string }[]} */
  const touchedTests = [];
  /** TypeScript files per root, for the per-file typecheck. @type {Map<string, { abs: string, rel: string }[]>} */
  const touchedTs = new Map();
  let productionTouched = false;
  // Once-per-turn findings (contract drift, residue): each is listed in one
  // hold and never again, since the agent may keep it for a reason the gate
  // cannot see.
  /** @type {string[]} */
  const shownNow = [];
  /** Code files per root whose new functions the clone check compares. @type {Map<string, { abs: string, rel: string, content: string, existed: string[] }[]>} */
  const codeByRoot = new Map();

  for (const abs of files) {
    const config = loadConfig(dirname(abs));
    if (!roots.has(config.root)) roots.set(config.root, config);
    if (!PROSE_ONLY_RE.test(abs)) codeRoots.add(config.root);
    const rel = norm(relative(config.root, abs));
    const ignored = rel.startsWith('..') || isIgnored(rel, config);
    if (!ignored && config.hook.typecheck && isTypeScriptSource(abs)) {
      touchedTs.set(config.root, [...(touchedTs.get(config.root) ?? []), { abs, rel }]);
    }
    if (config.hook.stop === false || config.hook.stop.smugan === false) {
      report.files.push({ path: norm(abs), status: config.hook.stop === false ? 'stop-off' : 'recheck-off' });
      continue;
    }
    if (ignored) {
      report.files.push({ path: norm(abs), status: 'ignored' });
      continue;
    }
    if (!PROSE_ONLY_RE.test(rel) && !TEST_PATH_RE.test(rel)) productionTouched = true;
    const content = readIfSmall(abs);
    if (content === null) {
      report.files.push({ path: norm(abs), status: 'too-large' });
      continue;
    }
    if (isTestPath(rel) && checkEnabled(config, 'assertion-weakening')) touchedTests.push({ abs, rel, content });
    // Diff-aware: block only what this turn introduced, using the baseline pre
    // captured at first touch. No in-turn baseline (pre failed open, or the
    // file arrived another way) → the committed (git HEAD) version becomes the
    // baseline, the same treatment eslint/tsc already get: legacy debt in a
    // merely-touched file never blocks, and a file reverted to HEAD zeroes out.
    // Untracked / no git keeps the full check — new code meets the full bar.
    // A file a shell command changed while it still matched the snapshot's
    // commit takes that version as its baseline, whatever a later edit
    // recorded; one that commit did not have is new this turn.
    const violations = analyzeContent(rel, content, config);
    const revision = shell.atCommit.get(rootKey(abs));
    /** @type {import('./engine.mjs').Violation[] | null} */
    let fromShell = null;
    if (revision && Date.now() > historyDeadline) {
      historyLate++;
    } else if (revision) {
      try {
        const { fresh: brought, before } = turnFindings(revision, rel, config, violations, versions);
        // Absent before the turn's first commit to it, or from HEAD: new this turn.
        if (before === null) created.push(abs);
        fromShell = brought;
      } catch (error) {
        shell.notes.push(`${rel}: its versions in the turn's commits were not read (${reason(error)}); compared with HEAD instead.`);
      }
    }
    const baseline = revision ? undefined : baselineOf(state, abs);
    const fresh = fromShell
      ?? (baseline
        ? freshAgainst(new Map(baseline), violations)
        : await freshVsHead(abs, findingsKind(config, rel), violations, (headContent) => analyzeContent(rel, headContent, config)));
    report.files.push({ path: norm(abs), status: 'checked', violations: fresh.length });
    // Named, so the agent can tell a change of its own commands from someone else's.
    const origin = edited.has(rootKey(abs)) ? '' : '  (changed outside Write/Edit during this turn)';
    for (const v of fresh.slice(0, 20)) {
      failures.push(`${rel}:${v.line}  [${v.rule}]  ${v.message}${origin}`);
    }
    // Only functions the file had when this turn first touched it, and only
    // shapes that were not there then.
    if (abs in state.functions && abs in state.drift && checkEnabled(config, 'contract-drift')) {
      const { suppressed } = parseSuppressions(content.replace(/\r\n/g, '\n').split('\n'));
      for (const d of introducedDrift(rel, content, state.functions[abs], state.drift[abs]).slice(0, 10)) {
        const key = `drift:${norm(abs)}|${d.key}`;
        if (state.shown.includes(key) || suppressed('contract-drift', d.line)) continue;
        shownNow.push(key);
        failures.push(`${rel}:${d.line}  [contract-drift]  ${d.message}`);
      }
    }
    // Which of its functions are this turn's: all of a new file's, and the
    // names a file did not have at its first touch. No snapshot, no judgment.
    const existed = abs in state.functions ? state.functions[abs] : created.includes(abs) ? [] : null;
    if (existed && CODE_FILE_RE.test(rel) && checkEnabled(config, 'clone')) {
      codeByRoot.set(config.root, [...(codeByRoot.get(config.root) ?? []), { abs, rel, content, existed }]);
    }
  }
  for (const [root, touchedCode] of codeByRoot) {
    const config = /** @type {import('./config.mjs').SmuganConfig} */ (roots.get(root));
    const minTokens = Number(checkOptions(config, 'clone').minTokens) || MIN_TOKENS;
    const { clones, complete } = newClones(root, touchedCode, minTokens);
    if (!complete) report.skipped.push({ root: norm(root), reason: 'clone-index-partial' });
    for (const c of clones) {
      const file = /** @type {{ abs: string, content: string }} */ (touchedCode.find((t) => t.rel === c.rel));
      const key = `clone:${norm(file.abs)}|${c.name}|${c.other.rel}|${c.other.name}`;
      const { suppressed } = parseSuppressions(file.content.replace(/\r\n/g, '\n').split('\n'));
      if (state.shown.includes(key) || suppressed('clone', c.line)) continue;
      shownNow.push(key);
      failures.push(`${c.rel}:${c.line}  [clone]  \`${c.name}\` repeats \`${c.other.name}\` up to names and literals — reuse \`${c.other.name}\` at ${c.other.rel}:${c.other.line}, or extract what differs into a parameter`);
    }
  }
  // Editing only tests is a task of its own; a test that loses assertions in
  // the same turn that changed production code is the shape of a test bent to
  // agree with the code. Turn-start profile first; HEAD when pre never saw it.
  const listedBeforeTests = shownNow.length;
  if (productionTouched) {
    // Each touched test with how it stood when the turn started. Same rule as
    // the findings: a test the shell changed while it matched HEAD starts from
    // before the turn's first commit to it, or from HEAD.
    const tests = touchedTests.map(({ abs, rel, content }) => {
      const revision = shell.atCommit.get(rootKey(abs));
      const known = abs in state.assertions && !revision;
      /** @type {string | null} */
      let previous = null;
      if (revision) {
        try {
          const start = revision.commits.length ? revision.commits[0].from : 'HEAD';
          previous = start ? contentAt(revision.root, start, revision.rel) : null;
        } catch (error) {
          shell.notes.push(`${rel}: its tests at the turn's first shell command were not read (${reason(error)}).`);
        }
      } else if (!known) {
        previous = gitHead(abs)?.content ?? null;
      }
      const before = known ? state.assertions[abs] : previous !== null ? assertionProfile(previous) : null;
      const was = known ? state.tests[abs] : previous !== null ? testCounts(previous) : undefined;
      // The tests this file gained in the turn, by title: where a test gone
      // from another file may have moved to. A title it always had, as many
      // times as it has it now, is no move.
      /** @type {Map<string, number>} */
      const had = new Map(Array.isArray(was?.titles) ? was.titles.map(([title, count]) => [title, count]) : (before ?? []).map(([title]) => [title, 1]));
      const inventory = testInventory(content);
      const gained = [...inventory.titles].map(([title, { count }]) => /** @type {[string, number]} */ ([title, count - (had.get(title) ?? 0)])).filter(([, more]) => more > 0);
      // A table or a test with a computed title has no title to match: those move by count.
      return { abs, rel, content, before, was, gained, unnamedGained: Math.max(0, inventory.unnamed - (was?.unnamed ?? 0)) };
    });
    // One test moved in takes one test gone, whichever file lost it, so a
    // second copy deleted for good is still listed. No file loses and gains
    // the same title, or tests with none: its own gains never offset its losses.
    const landed = { titles: /** @type {Map<string, number>} */ (new Map()), unnamed: 0 };
    for (const test of tests) {
      for (const [title, more] of test.gained) landed.titles.set(title, (landed.titles.get(title) ?? 0) + more);
      landed.unnamed += test.unnamedGained;
    }
    // Listed once, like drift and clones: the request may have retired the
    // behavior, and a test that is gone has no line left to carry a reason.
    const listRemoved = (/** @type {string} */ abs, /** @type {string} */ rel, /** @type {{ lost: number, titles: string[], untitled?: number }} */ gone, /** @type {boolean} */ fileDeleted) => {
      const key = `removed:${norm(abs)}|${gone.titles.join('|')}${gone.untitled ? `|+${gone.untitled}` : ''}`;
      if (gone.lost === 0 || state.shown.includes(key)) return;
      shownNow.push(key);
      const named = gone.titles.slice(0, 5).map((title) => `"${title}"`).join(', ') + (gone.titles.length > 5 ? ` and ${gone.titles.length - 5} more` : '');
      // A table and a test with a computed title have no name to quote.
      const names = [named, gone.untitled ? `${gone.untitled} with no title of its own (a table or a computed title)` : ''].filter(Boolean).join(', and ');
      const tests = `${gone.lost} test${gone.lost === 1 ? '' : 's'}`;
      failures.push(`${rel}  [assertion-weakening]  ` + (fileDeleted
        ? `test file deleted this turn while production code changed, with ${tests} that asserted behavior: ${names}`
        : `${tests} removed this turn while production code changed; no longer in the file: ${names}`)
        + ' — a removed test stops guarding what it pinned. Restore it, or tell the user why it had to go');
    };
    for (const { abs, rel, content, before, was } of tests) {
      if (!before) continue;
      const { suppressed } = parseSuppressions(content.replace(/\r\n/g, '\n').split('\n'));
      for (const v of weakenedTests(before, content).filter((w) => !suppressed('assertion-weakening', w.line)).slice(0, 20)) {
        failures.push(`${rel}:${v.line}  [assertion-weakening]  ${v.message}`);
      }
      if (was && !suppressed('assertion-weakening', 1)) listRemoved(abs, rel, removedTests(before, was, content, landed), false);
    }
    for (const { abs, before, was } of deletedTestFiles(state, shell)) {
      const config = loadConfig(dirname(abs));
      const rel = norm(relative(config.root, abs));
      const stop = config.hook.stop;
      if (stop === false || stop.smugan === false || rel.startsWith('..') || isIgnored(rel, config) || !isTestPath(rel) || !checkEnabled(config, 'assertion-weakening')) continue;
      listRemoved(abs, rel, removedTests(before, was, null, landed), true);
    }
  }
  const removedTestCount = shownNow.length - listedBeforeTests;
  // No line can carry a smugan-ignore for a test that is gone.
  const gateFailureCount = failures.length - removedTestCount;
  const residueStart = shownNow.length;
  for (const [root, config] of roots) {
    if (config.hook.stop === false || config.hook.stop.smugan === false || !checkEnabled(config, 'exploration-residue')) continue;
    const createdHere = created.filter((f) => files.includes(f));
    const scope = turnScope(root, input?.transcript_path, input?.session_id);
    for (const r of explorationResidue({ root, created: createdHere, touched: files, startedAt: state.startedAt, scope, isTest: isTestPath })) {
      const key = `residue:${norm(join(root, r.file))}`;
      // The project's own ignore list counts; the gate's defaults skip lockfiles, which this check reads.
      if (state.shown.includes(key) || config.ignore.some((g) => globToRegExp(g).test(r.file))) continue;
      shownNow.push(key);
      failures.push(`${r.file}  [exploration-residue]  ${r.message}`);
    }
  }
  const residueCount = shownNow.length - residueStart;
  /** @type {string[]} */
  const incomplete = [...shell.notes];
  if (historyLate > 0) incomplete.push(`${historyLate} files the turn changed outside Write/Edit were compared with HEAD only: reading their versions in the turn's commits ran past ${SHELL_HISTORY_BUDGET_MS / 1000} s.`);

  // Per-file checks above still ran on every touched file, whatever its
  // extension. The project's SCRIPTS only run when the turn touched something
  // that can actually change their outcome — see PROSE_ONLY_RE — and only in
  // roots that have a script to run. A root past the cap is reported as
  // unverified, never passed in silence.
  const plans = [];
  const skip = (/** @type {string} */ root, /** @type {string} */ reason) => report.skipped.push({ root: norm(root), reason });
  for (const [root, config] of roots) {
    const stopCfg = config.hook.stop;
    if (stopCfg === false) { skip(root, 'stop-off'); continue; }
    if (!codeRoots.has(root)) { skip(root, 'prose-only'); continue; }
    // A stray package.json in the home directory does not make $HOME a project.
    if (norm(root).toLowerCase() === norm(homedir()).toLowerCase()) { skip(root, 'home'); continue; }
    const plan = scriptPlan(root, stopCfg, files);
    // Styles, assets and translations cannot change what a test sees: a
    // trivial project keeps the gate and the typecheck, not the suite.
    if (plan.tests && levels.byRoot.get(root) === 'trivial') {
      plan.tests = false;
      report.scripts.push({ label: `tests (${norm(root)}: trivial level)`, status: 'skipped' });
    }
    // The project's own typecheck covers every file; without one, tsc checks
    // the files this turn touched, as the post hook did on each edit before.
    const tsGroups = plan.typecheck ? [] : await tscGroups(touchedTs.get(root) ?? []);
    if (plan.typecheck || plan.tests || tsGroups.length > 0) plans.push({ root, stopCfg, tsGroups, ...plan });
    else skip(root, 'no-scripts');
  }
  const ran = report.scripts;
  for (const { root } of plans.slice(MAX_SCRIPT_ROOTS)) {
    skip(root, 'cap');
    incomplete.push(`${norm(root)}: project scripts not run; the turn touched more than ${MAX_SCRIPT_ROOTS} projects with scripts.`);
  }
  for (const { root, stopCfg, scripts, typecheck, tests, tsGroups } of plans.slice(0, MAX_SCRIPT_ROOTS)) {
    if (typecheck) {
      const result = await runShell(`${packageManager(root)} run ${typecheck}`, root, stopCfg.timeoutMs);
      recordScriptResult(`typecheck (${typecheck})`, result, stopCfg.timeoutMs, failures, incomplete, ran);
    }
    // A tsconfig the turn created or edited, the extended base included, makes a global diagnostic the turn's.
    if (tsGroups.length > 0) await typecheckTouched(tsGroups, stopCfg.timeoutMs, failures, incomplete, ran, files.some((f) => /(?:^|[\\/])tsconfig[^\\/]*\.json$/i.test(f)));
    if (tests) await runTests(root, scripts, files, stopCfg.timeoutMs, failures, incomplete, ran);
  }

  const debtFile = stopDebtPath(input?.session_id);
  const incompleteNote = incomplete.length > 0
    ? 'smugan stop: incomplete checks:\n' + incomplete.join('\n') + '\nRun the checks again before declaring the work done.\n'
    : '';
  report.failures = failures.slice(0, 20).map((f) => clip(f));
  report.incomplete = incomplete.map((f) => clip(f));
  if (failures.length === 0) {
    if (!retireTurn(marker, state.revision)) {
      return STALE;
    }
    if (incompleteNote) {
      report.outcome = 'incomplete';
      return { exitCode: 0, stderr: incompleteNote, stdout: userNote(incompleteNote) };
    }
    report.outcome = 'passed';
    if (debtFile) tryUnlink(debtFile); // green clears the debt — a future regression blocks again
    return OK;
  }
  const units = failures.map(failureUnit).filter(Boolean);
  const debt = readDebt(debtFile);
  // Debt binds per FAILURE, not per whole list: a bail-early runner (pnpm -r
  // stops at the first red package) reshuffles the list every round, so the
  // old all-or-nothing comparison never matched in production. A single NEW
  // failure among known debt still blocks with a fresh budget.
  if (units.length > 0 && units.every((u) => debt.has(u))) {
    if (!retireTurn(marker, state.revision)) {
      return STALE;
    }
    report.outcome = 'known-failures';
    return {
      exitCode: 0,
      stderr: `smugan stop: Definition of Done still red only with failures that already used up an earlier turn's holds — not re-blocking.\n` + incompleteNote,
      stdout: userNote(`smugan: Definition of Done still red only with failures that already used up an earlier turn's holds — not re-blocking.\n` + incompleteNote),
    };
  }
  // A turn holds when any project it touched blocks: one warn-mode checkout
  // must not switch the Definition of Done off for the others.
  if ([...roots.values()].every((c) => c.mode === 'warn')) {
    if (!retireTurn(marker, state.revision)) return STALE;
    report.outcome = 'warned';
    note(input?.session_id, { hook: 'stop', outcome: 'warned', root: report.cwd, failures: failures.length });
    return warned(
      `smugan stop (warn mode, nothing blocked): the Definition of Done fails (${failures.length} issue${failures.length === 1 ? '' : 's'}):\n\n` +
      failures.map((f) => '  ' + f).join('\n') + '\n\n' + incompleteNote +
      'The turn ended without a hold.\n',
    );
  }
  // Taken again, after the checks and over what the next Stop will list: one
  // that rewrites a file of the turn (a test script with a codegen or copy
  // step) or leaves a file behind (a report git sees as untracked) wrote
  // nothing the next turn has to answer for. A write that lands while the
  // checks run is taken for theirs.
  const checked = filesPrint(listed(shellChanges(state).files));
  state.blocks = updateTurn(marker, (current) => {
    current.blocks = (renewed ? 0 : current.blocks) + 1;
    current.held = checked;
    current.shown.push(...shownNow);
    current.listedOnly = shownNow.length === failures.length;
  }).blocks;
  report.outcome = 'blocked';
  report.attempt = state.blocks;
  if (debtFile && state.blocks >= cap) {
    try {
      writeFileSync(debtFile, JSON.stringify({ prints: [...new Set([...debt, ...units])] }));
    } catch { /* smugan-ignore empty-catch: debt memory is best-effort; worst case the old re-block behavior returns */ }
  }
  // A connection-refused test failure is usually missing infrastructure, not
  // broken code — still a real DoD gap, but the fix lives elsewhere: say so.
  const infraNote = failures.some((f) => f.includes('ECONNREFUSED'))
    ? 'note: a connection-refused failure usually means a required local service is down — start it, or guard the suite with a runner-native conditional (e.g. vitest describe.skipIf(!serviceUp)) for when the service is absent. Do not reach for a bare .skip — that weakens the test permanently.\n'
    : '';
  // The smugan-ignore valve only exists for [rule] gate lines; suggesting it
  // for script failures (tests/typecheck) sent models writing directives the
  // hook can't honor — dead comments got committed (production app, jul/2026).
  const hint = (gateFailureCount > 0
    ? 'False positive in a [rule] line? // smugan-ignore <rule>: <reason (6+ chars)>. '
    : residueCount + removedTestCount === failures.length ? ''
      : 'Pre-existing or environmental failure? Once this exact failure set has spent the block budget it stops re-blocking on its own. ')
    + (listedBeforeTests > 0 ? 'The [contract-drift] and [clone] lines are listed once: for drift, if the request asked for the new behavior, tell the user the contract changed, otherwise keep the old one; for a clone, reuse the existing function. ' : '')
    + (removedTestCount > 0 ? 'The removed-test lines are listed once and nothing was restored: bring the test back, or tell the user which behavior it pinned and why it went. ' : '')
    + (residueCount > 0 ? 'The [exploration-residue] lines are listed once and nothing was deleted: remove what the task does not need, or tell the user why it stays. ' : '');
  const stderr =
    `smugan stop: this turn modified code but the Definition of Done fails (${failures.length} issue${failures.length === 1 ? '' : 's'}):\n\n` +
    failures.map((f) => '  ' + f).join('\n') +
    `\n\n` + infraNote + incompleteNote +
    (state.blocks >= cap
      ? `Fix these before finishing. This is the turn's last hold (${state.blocks}/${cap}): after the fix, run the failing check yourself and show its result — the hook will not run it again. `
      : `Fix these before finishing (attempt ${state.blocks}/${cap}). `) + hint + '\n';
  return { exitCode: BLOCK, stderr: defuseHarnessSniff(stderr), stdout: STOP_BLOCK_STDOUT };
}
