// @ts-check
// `smugan why`: what the hooks did in a session — what was checked, what ran,
// what was skipped and why, what blocked — read from the Stop report and the
// session's event log. Answers "did the check run?" without opening a transcript.
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { eventsPath, listSessions, readJsonFile, reportPath } from './session-log.mjs';

/** @type {Record<string, string>} */
const OUTCOME = {
  'nothing-touched': 'no project files to analyze; there was nothing to verify',
  passed: 'turn passed: re-check and scripts green',
  'passed-no-scripts': 'turn passed: no new violations in the analyzed files; no project script ran',
  'passed-scripts-only': 'turn passed by the scripts; no file went through the Smugan re-check',
  'passed-nothing-ran': 'turn released unverified: no file was analyzed and no script ran',
  error: 'the end of turn failed with an internal error and verified nothing; the turn ended unverified',
  blocked: 'turn held: the Definition of Done failed',
  warned: 'turn released in warn mode: the Definition of Done failed without holding the turn',
  incomplete: 'turn released with incomplete checks',
  'known-failures': 'turn released: only failures that had already used up the 3 holds remained',
  'released-after-cap': 'turn released after 3 holds; the last check was still red',
  'changed-during-stop': 'files changed while the checks ran; the latest edit was not verified',
};
/** @type {Record<string, string>} */
const FILE = {
  ignored: 'ignored by the configuration',
  'too-large': 'larger than 1 MiB, not read',
  'stop-off': 'end-of-turn check off in this project ("stop": false)',
  'recheck-off': 're-check off in this project ("stop": {"smugan": false}); the scripts still run',
  missing: 'deleted before the end of turn',
};
/** @type {Record<string, string>} */
const SKIP = {
  'stop-off': '"stop": false in this project',
  'prose-only': 'the turn only touched prose here',
  home: 'the home folder does not count as a project',
  'no-scripts': 'no typecheck, test or build script to run',
  cap: 'limit of 2 projects with scripts per turn',
  'clone-index-partial': 'the clone index did not finish within 500 ms; the next end of turn picks up where it stopped',
};
/** @type {Record<string, string>} */
const SCRIPT = { passed: '✓', failed: '✗', timeout: '⏱', skipped: '·', unverified: '?' };
const LEVEL = { trivial: 'trivial', normal: 'normal', critical: 'critical' };

/** @param {number} ms */
function ago(ms) {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** @param {string} iso */
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** @param {Record<string, any>} event */
function describeEvent(event) {
  const when = typeof event.at === 'string' ? clock(event.at) : '--:--';
  if (event.outcome === 'warned') {
    if (event.hook === 'stop') return `${when}  stop warned without holding the turn (warn mode): ${event.failures ?? 0} failure(s)`;
    const rules = Array.isArray(event.rules) ? event.rules.join(', ') : Array.isArray(event.tools) ? event.tools.join(', ') : '';
    return `${when}  ${event.hook} warned without blocking ${event.file} (warn mode)${rules ? `: ${rules}` : ''}`;
  }
  if (event.hook === 'stop') {
    return `${when}  stop held the turn (attempt ${event.attempt ?? '?'}): ${event.failures ?? 0} failure(s)`;
  }
  if (event.outcome === 'gate-unavailable') {
    return `${when}  gate unavailable in ${event.hook}${event.code ? ` (${event.code})` : ''}: ${event.detail ?? 'no detail'}`;
  }
  const what = event.hook === 'pre' ? `blocked the write of ${event.file}` : `blocked ${event.file} after the write`;
  const why = Array.isArray(event.rules) ? event.rules.join(', ') : Array.isArray(event.tools) ? event.tools.join(', ') : '';
  return `${when}  ${event.hook} ${what}${why ? `: ${why}` : ''}`;
}

/** @param {string} a @param {string} b */
function nested(a, b) {
  const rel = relative(resolve(a), resolve(b));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * One read per session: a session can vanish between two reads (doctor's own
 * probe session, the 7-day sweep), so choosing and printing use the same copy.
 * @typedef {{ id: string, mtimeMs: number, report: any, events: any[] }} SessionRecord
 * @param {string} id @param {number} mtimeMs @returns {SessionRecord | null}
 */
function loadRecord(id, mtimeMs) {
  const reportFile = reportPath(id);
  const eventsFile = eventsPath(id);
  if (!reportFile || !eventsFile) return null; // nothing survives the id's sanitizing
  const report = readJsonFile(reportFile);
  const events = readJsonFile(eventsFile);
  if (report === null && !Array.isArray(events)) return null;
  return { id, mtimeMs, report, events: Array.isArray(events) ? events : [] };
}

/** @param {SessionRecord} record */
function sessionPaths({ report, events }) {
  /** @param {unknown} list @param {string} key @returns {string[]} */
  const pick = (list, key) => (Array.isArray(list) ? list.map((x) => x?.[key]).filter((p) => typeof p === 'string') : []);
  return {
    cwd: typeof report?.cwd === 'string' ? report.cwd : null,
    files: pick(report?.files, 'path'),
    // A held Stop logs the folder the session started in as its root; for a
    // session opened in the home folder that is a parent of every project.
    roots: [...pick(report?.skipped, 'root'), ...pick(events.filter((e) => e?.hook !== 'stop'), 'root')],
  };
}

/**
 * Whether a session worked in this folder: it edited files inside it, ran
 * from it, or checked a project that contains it. A session started in the
 * home folder does not match every folder below home.
 * @param {SessionRecord} record @param {string} cwd
 */
function workedIn(record, cwd) {
  const { cwd: started, files, roots } = sessionPaths(record);
  return [...files, ...(started ? [started] : [])].some((p) => nested(cwd, p)) || roots.some((r) => nested(cwd, r) || nested(r, cwd));
}

/** @param {SessionRecord} record @returns {string | null} */
function sessionFolder(record) {
  const { cwd, roots } = sessionPaths(record);
  return roots[roots.length - 1] ?? cwd;
}

/** @param {string[]} args @param {string} [cwd] @returns {{ exitCode: number, output: string }} */
export function runWhy(args, cwd = process.cwd()) {
  const json = args.includes('--json');
  const at = args.indexOf('--session');
  if (at >= 0 && !args[at + 1]) return { exitCode: 2, output: 'smugan why: --session needs the session id.\n' };
  const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--json' && a !== '--session' && args[i - 1] !== '--session');
  if (unknown.length) return { exitCode: 2, output: `smugan why: unknown option ${unknown[0]}. Usage: smugan why [--session <id>] [--json]\n` };
  const sessions = /** @type {SessionRecord[]} */ (listSessions().map((s) => loadRecord(s.id, s.mtimeMs)).filter(Boolean));
  // Without --session, the newest session that worked in this folder: a test
  // run or another project's session is newer more often than not.
  const here = at < 0 ? sessions.find((s) => workedIn(s, cwd)) : undefined;
  const chosen = at >= 0 ? (sessions.find((s) => s.id === args[at + 1]) ?? loadRecord(args[at + 1], 0)) : (here ?? sessions[0] ?? null);
  const fallback = at < 0 && !here && chosen !== null;
  if (!chosen) {
    if (at >= 0) return { exitCode: 1, output: `smugan why: no record for session ${args[at + 1]}.\n` };
    return { exitCode: 1, output: `smugan why: no session record in ${tmpdir()}. A record is created when a Smugan hook blocks or when a turn ends with it installed.\n` };
  }
  const { id, report, events } = chosen;
  if (json) return { exitCode: 0, output: JSON.stringify({ session: id, report, events }, null, 2) + '\n' };

  const lines = [];
  const others = sessions.filter((s) => s.id !== id).slice(0, 4);
  const stamp = report?.at ? ago(Date.parse(report.at)) : 'no end of turn recorded';
  const folder = sessionFolder(chosen);
  lines.push(`smugan why — session ${id} (${stamp})${folder ? `, in ${folder}` : ''}`);
  if (fallback) lines.push('No session recorded in this folder; this is the most recent one from any folder.');
  const config = loadConfig(cwd);
  if (config.mode === 'warn') lines.push(`Warn mode active in ${config.root}: the hooks show violations without blocking or holding the end of turn.`);
  if (report) {
    const attempt = report.outcome === 'blocked' ? ` (attempt ${report.attempt} of ${report.maxAttempts})` : '';
    // "Approved" has to say what approved it: the recorded outcome alone was
    // "passed" even when the re-check was off or every file was ignored.
    const checked = (report.files ?? []).filter((/** @type {any} */ f) => f.status === 'checked').length;
    const ran = report.scripts?.length ?? 0;
    const outcome = report.outcome !== 'passed' ? report.outcome
      : checked && ran ? 'passed' : checked ? 'passed-no-scripts' : ran ? 'passed-scripts-only' : 'passed-nothing-ran';
    const label = typeof report.quietAt === 'string' ? 'Last end of turn that checked files' : 'Last end of turn';
    lines.push('', `${label}: ${OUTCOME[outcome] ?? outcome}${attempt}.`);
    if (typeof report.quietAt === 'string') lines.push(`The turns after it edited no files; the most recent was ${ago(Date.parse(report.quietAt))}.`);
    if (typeof report.level === 'string') lines.push(`Turn level: ${LEVEL[/** @type {keyof typeof LEVEL} */ (report.level)] ?? report.level}${report.lowered?.length ? `, forced with smugan risk (downgraded ${report.lowered.join(', ')})` : ''}.`);
    if (report.files?.length) {
      lines.push('', 'Files:');
      for (const f of report.files) {
        if (f.status === 'checked') lines.push(`  ${f.violations ? '✗' : '✓'} ${f.path}${f.violations ? ` — ${f.violations} new violation(s)` : ''}`);
        else lines.push(`  · ${f.path} — ${FILE[f.status] ?? f.status}`);
      }
    }
    if (report.scripts?.length) {
      lines.push('', 'Project scripts:');
      for (const s of report.scripts) lines.push(`  ${SCRIPT[s.status] ?? '?'} ${s.label}${s.status === 'timeout' ? ' — deadline exceeded, result not verified' : ''}`);
    }
    if (report.skipped?.length) {
      lines.push('', 'Projects where the scripts did not run:');
      for (const s of report.skipped) lines.push(`  · ${s.root} — ${SKIP[s.reason] ?? s.reason}`);
    }
    if (report.failures?.length) {
      lines.push('', typeof report.checkedAt === 'string' ? `Failures from the last check (${ago(Date.parse(report.checkedAt))}):` : 'Failures:');
      for (const f of report.failures) lines.push('  ' + String(f).split('\n')[0]);
    }
    if (report.incomplete?.length) {
      lines.push('', 'Incomplete checks:');
      for (const f of report.incomplete) lines.push('  ' + f);
    }
  } else {
    lines.push('', 'No end of turn recorded for this session.');
  }
  if (events.length) {
    lines.push('', 'Recent blocks, warnings and internal failures:');
    for (const e of events.slice(-10)) lines.push('  ' + describeEvent(e));
  }
  if (others.length) lines.push('', 'Other recent sessions: ' + others.map((s) => `${s.id} (${ago(s.mtimeMs)})`).join(', '), 'Use --session <id> to see one of them.');
  return { exitCode: 0, output: lines.join('\n') + '\n' };
}
