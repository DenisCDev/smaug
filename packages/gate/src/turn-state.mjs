// @ts-check
import { readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hasCode, withFileLock, writeAtomicJson } from './file-state.mjs';

/** @typedef {{ head: string, at: number, reflog: { count: number, line: string } | null, files: Record<string, string>, deleted: string[], unrecorded: string[], skipped: string }} ShellSnapshot
 * What a repository looked like at the turn's first shell command there: the
 * commit HEAD pointed at, when (ms), how many entries HEAD's reflog had and
 * its newest one (null when unknown), the fingerprint of each file already
 * changed, the tracked paths already deleted, the changed code files whose
 * findings did not fit the time budget, and why the snapshot is unusable ('' when it is usable). */
/** @typedef {{ files: string[], blocks: number, baselines: Record<string, [string, number][]>, assertions: Record<string, [string, number][]>,
 *   tests: Record<string, import('./assertion-weakening.mjs').TestCounts>,
 *   created: string[], functions: Record<string, string[]>, drift: Record<string, [string, number][]>,
 *   startedAt: number, shown: string[], listedOnly: boolean, held: string, revision: string, shells: Record<string, ShellSnapshot> }} TurnState
 * `created`: files that did not exist at their first touch. `held`: what the
 * turn's files looked like at its last hold, '' before any. `tests`: how many
 * tests a test file declared at its first touch. `functions` and
 * `drift`: the function names and contract-drift shapes a file had at its
 * first touch. `listedOnly`: the last hold had nothing but once-per-turn
 * findings, every check green. `shown`: the once-per-turn
 * findings (residue, clones, removed tests) already listed in a hold. `shells`: one
 * snapshot per repository. */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @returns {string[]} */
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/** Snapshots of a readable shape; anything else is dropped, never trusted. @param {unknown} value @returns {Record<string, ShellSnapshot>} */
function shellSnapshots(value) {
  /** @type {Record<string, ShellSnapshot>} */
  const snapshots = {};
  if (!isRecord(value)) return snapshots;
  for (const [root, snap] of Object.entries(value)) {
    if (!isRecord(snap) || !isRecord(snap.files)) continue;
    snapshots[root] = {
      head: typeof snap.head === 'string' ? snap.head : '',
      at: Number.isFinite(snap.at) ? snap.at : 0,
      reflog: isRecord(snap.reflog) && Number.isInteger(snap.reflog.count) && typeof snap.reflog.line === 'string'
        ? { count: snap.reflog.count, line: snap.reflog.line }
        : null,
      files: snap.files,
      deleted: strings(snap.deleted),
      unrecorded: strings(snap.unrecorded),
      skipped: typeof snap.skipped === 'string' ? snap.skipped : '',
    };
  }
  return snapshots;
}

/** @param {string} marker @returns {TurnState} */
export function readTurn(marker) {
  try {
    const state = JSON.parse(readFileSync(marker, 'utf8'));
    if (!state || !Array.isArray(state.files) || !state.files.every((/** @type {unknown} */ file) => typeof file === 'string')) {
      throw new Error('Invalid turn state');
    }
    return {
      files: state.files,
      blocks: Number.isInteger(state.blocks) && state.blocks >= 0 ? state.blocks : 0,
      baselines: isRecord(state.baselines) ? state.baselines : {},
      assertions: isRecord(state.assertions) ? state.assertions : {},
      tests: isRecord(state.tests) ? state.tests : {},
      created: strings(state.created),
      functions: isRecord(state.functions) ? state.functions : {},
      drift: isRecord(state.drift) ? state.drift : {},
      startedAt: Number.isFinite(state.startedAt) ? state.startedAt : 0,
      shown: strings(state.shown),
      listedOnly: state.listedOnly === true,
      held: typeof state.held === 'string' ? state.held : '',
      revision: typeof state.revision === 'string' ? state.revision : '',
      shells: shellSnapshots(state.shells),
    };
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
    return { files: [], blocks: 0, baselines: {}, assertions: {}, tests: {}, created: [], functions: {}, drift: {}, startedAt: 0, shown: [], listedOnly: false, held: '', revision: '', shells: {} };
  }
}

/** @param {string} marker @param {(state: TurnState) => void} update @returns {TurnState} */
export function updateTurn(marker, update) {
  return withFileLock(marker, () => {
    const state = readTurn(marker);
    if (!state.startedAt) state.startedAt = Date.now();
    update(state);
    state.revision = randomUUID();
    writeAtomicJson(marker, state);
    return state;
  });
}

/** Retire only the snapshot Stop actually checked. @param {string} marker @param {string} revision */
export function retireTurn(marker, revision) {
  return withFileLock(marker, () => {
    if (readTurn(marker).revision !== revision) return false;
    try {
      unlinkSync(marker);
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    return true;
  });
}
