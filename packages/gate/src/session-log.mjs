// @ts-check
// What the hooks decided, kept for `smugan why`: the last Stop report of each
// session, plus its recent blocks and fail-open errors. Letting an edit through
// is the silent default, so only those two cost a write on an ordinary edit.
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCode, withFileLock, writeAtomicJson } from './file-state.mjs';

const KEEP_MS = 7 * 24 * 60 * 60_000;
const MAX_EVENTS = 50;
const NAME_RE = /^smugan-(report|events)-([A-Za-z0-9-]{1,64})\.json$/;

/** @param {unknown} id */
const safeId = (id) => String(id ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
/** @param {unknown} id */
export const reportPath = (id) => (safeId(id) ? join(tmpdir(), `smugan-report-${safeId(id)}.json`) : null);
/** @param {unknown} id */
export const eventsPath = (id) => (safeId(id) ? join(tmpdir(), `smugan-events-${safeId(id)}.json`) : null);

/** @param {string} text @param {number} max */
export const clip = (text, max = 300) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

/** @param {string} file @returns {any} */
export function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (hasCode(error, 'ENOENT') || error instanceof SyntaxError) return null;
    throw error;
  }
}

function sweep() {
  for (const name of readdirSync(tmpdir())) {
    if (!NAME_RE.test(name)) continue;
    const file = join(tmpdir(), name);
    try {
      if (Date.now() - statSync(file).mtimeMs > KEEP_MS) unlinkSync(file);
    } catch { /* smugan-ignore empty-catch: another session may have swept it first */ }
  }
}

/**
 * A turn that edited nothing keeps the report of the last turn that did, with
 * the time of the quiet turn added: replacing it would answer "did the check
 * run?" with "nothing to check" right after a turn that was checked.
 * @param {unknown} sessionId @param {Record<string, any>} report
 */
export function writeReport(sessionId, report) {
  const file = reportPath(sessionId);
  if (!file) return;
  sweep();
  const now = new Date().toISOString();
  withFileLock(file, () => {
    if (report.outcome === 'nothing-touched' && !report.files?.length) {
      const previous = readJsonFile(file);
      if (previous && previous.outcome !== 'nothing-touched') {
        writeAtomicJson(file, { ...previous, quietAt: now });
        return;
      }
    }
    // Releasing at the block cap re-checks nothing: what was still red is the
    // last attempt's report, kept with the time it was checked.
    if (report.outcome === 'released-after-cap') {
      const previous = readJsonFile(file);
      if (previous && previous.outcome === 'blocked') {
        writeAtomicJson(file, { ...previous, outcome: report.outcome, exitCode: report.exitCode, at: now, checkedAt: previous.at });
        return;
      }
    }
    writeAtomicJson(file, { version: 1, session: safeId(sessionId), at: now, ...report });
  });
}

/** @param {unknown} sessionId @param {Record<string, unknown>} event */
export function logEvent(sessionId, event) {
  const file = eventsPath(sessionId);
  if (!file) return;
  withFileLock(file, () => {
    const current = readJsonFile(file);
    const events = Array.isArray(current) ? current : [];
    events.push({ at: new Date().toISOString(), ...event });
    writeAtomicJson(file, events.slice(-MAX_EVENTS));
  });
}

/** Sessions with a Stop report or an event log, newest first. */
export function listSessions() {
  /** @type {Map<string, number>} */
  const latest = new Map();
  for (const name of readdirSync(tmpdir())) {
    const match = NAME_RE.exec(name);
    if (!match) continue;
    try {
      const mtime = statSync(join(tmpdir(), name)).mtimeMs;
      latest.set(match[2], Math.max(latest.get(match[2]) ?? 0, mtime));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
  return [...latest].map(([id, mtimeMs]) => ({ id, mtimeMs })).sort((a, b) => b.mtimeMs - a.mtimeMs);
}
