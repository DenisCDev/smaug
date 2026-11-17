// @ts-check
// Codex V4A patch envelope → judged calls, one entry per touched file.
// Grammar read off openai/codex@main (codex-rs/apply-patch/src/parser.rs:37-45
// and streaming_parser.rs): Begin/End Patch, Add/Delete/Update File, Move to,
// End of File, an optional "*** Environment ID:" preamble, and hunk lines that
// start with "+", "-", " " — or are entirely empty, which Codex treats as an
// empty CONTEXT line (streaming_parser.rs:307-315). Dropping those empty lines
// was the old parser's widest hole: the reconstructed old_string never matched
// the disk and the judgment silently failed open.
//
// The contract favors the callers' backstop over cleverness:
//   - `path` comes from a marker scan that cannot fail, so a file the parser
//     could not reconstruct is STILL reported (call: null) and the adapters
//     can record the touch — the end-of-turn check then re-examines the real
//     file on disk instead of silently skipping the whole turn.
//   - `call` is the judgeable reconstruction: a Write for Add File, a
//     MultiEdit for Update File, null for Delete File / damaged sections.
//   - A "*** Move to:" section is judged under the OLD path on purpose: the
//     engine reads the pre-edit content from disk, and at judgment time only
//     the old path exists. The new path is emitted as an extra call-less entry
//     so post/stop checks pick up the file at its final location.
// Never throws: a patch this module cannot read is the adapters' cue to fail
// open on judgment while still reporting every path the markers name.

/**
 * @typedef {{ old_string: string, new_string: string }} PatchEdit
 * @typedef {{ tool_name: string, tool_input: { file_path: string, content?: string, edits?: PatchEdit[] } }} PatchCall
 * @typedef {{ path: string, call: PatchCall | null }} PatchEntry
 */

const ADD_RE = /^\*\*\* Add File: (.+)$/;
const UPDATE_RE = /^\*\*\* Update File: (.+)$/;
const DELETE_RE = /^\*\*\* Delete File: (.+)$/;
const MOVE_RE = /^\*\*\* Move to: (.+)$/;
const CONTEXT_RE = /^@@( .*)?$/;

/**
 * Last-resort path extraction: one regex pass over the marker lines, immune to
 * whatever confused the state machine. Guarantees `path` coverage for E1b.
 * @param {string[]} lines @returns {PatchEntry[]}
 */
function markerScan(lines) {
  /** @type {PatchEntry[]} */
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const m = ADD_RE.exec(line) || UPDATE_RE.exec(line) || DELETE_RE.exec(line) || MOVE_RE.exec(line);
    const path = m && m[1].trim();
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push({ path, call: null });
    }
  }
  return out;
}

/**
 * @param {string} patchText
 * @returns {PatchEntry[]}
 */
export function parsePatch(patchText) {
  const lines = String(patchText ?? '').split(/\r?\n/);
  try {
    return parseLines(lines);
  } catch {
    return markerScan(lines);
  }
}

/** @param {string[]} lines @returns {PatchEntry[]} */
function parseLines(lines) {
  /** @type {PatchEntry[]} */
  const out = [];
  /** @type {null | {
   *   type: 'add' | 'update',
   *   path: string,
   *   added: string[],
   *   edits: PatchEdit[],
   *   hunk: { before: string[], after: string[] } | null,
   *   movedTo: string | null,
   *   damaged: boolean,
   * }} */
  let current = null;

  const closeHunk = () => {
    if (!current || current.type !== 'update' || !current.hunk) return;
    const { before, after } = current.hunk;
    current.hunk = null;
    if (before.length === 0 && after.length === 0) return;
    // A hunk with no context at all cannot be located in the file; keeping an
    // empty old_string would abort the whole edit chain and lose the OTHER
    // hunks' judgment. The added lines still reach post/stop via the touch.
    if (before.length === 0) return;
    current.edits.push({ old_string: before.join('\n'), new_string: after.join('\n') });
  };

  const flush = () => {
    if (!current) return;
    const section = current;
    current = null;
    if (section.type === 'add') {
      out.push({
        path: section.path,
        call: section.damaged
          ? null
          : {
              tool_name: 'Write',
              tool_input: { file_path: section.path, content: section.added.join('\n') + '\n' },
            },
      });
      return;
    }
    out.push({
      path: section.path,
      call: section.damaged || section.edits.length === 0
        ? null
        : { tool_name: 'MultiEdit', tool_input: { file_path: section.path, edits: section.edits } },
    });
    if (section.movedTo) out.push({ path: section.movedTo, call: null });
  };

  for (const line of lines) {
    const add = ADD_RE.exec(line);
    const update = UPDATE_RE.exec(line);
    const del = DELETE_RE.exec(line);
    const move = MOVE_RE.exec(line);

    if (add) { closeHunk(); flush(); current = { type: 'add', path: add[1].trim(), added: [], edits: [], hunk: null, movedTo: null, damaged: false }; continue; }
    if (update) { closeHunk(); flush(); current = { type: 'update', path: update[1].trim(), added: [], edits: [], hunk: null, movedTo: null, damaged: false }; continue; }
    if (del) { closeHunk(); flush(); out.push({ path: del[1].trim(), call: null }); continue; }
    if (move && current && current.type === 'update') { current.movedTo = move[1].trim(); continue; }
    if (line.startsWith('*** ')) { closeHunk(); if (/^\*\*\* End Patch/.test(line)) flush(); continue; } // Begin/End Patch, End of File, Environment ID

    if (!current) continue;
    if (current.type === 'add') {
      if (line.startsWith('+')) current.added.push(line.slice(1));
      // Codex rejects anything else inside Add File (streaming_parser.rs:208);
      // if it shows up here the envelope is not what we think it is.
      else if (line !== '') current.damaged = true;
      continue;
    }
    if (CONTEXT_RE.test(line)) { closeHunk(); current.hunk = { before: [], after: [] }; continue; }
    if (!current.hunk) current.hunk = { before: [], after: [] };
    if (line.startsWith('+')) current.hunk.after.push(line.slice(1));
    else if (line.startsWith('-')) current.hunk.before.push(line.slice(1));
    else if (line.startsWith(' ')) { current.hunk.before.push(line.slice(1)); current.hunk.after.push(line.slice(1)); }
    else if (line === '') { current.hunk.before.push(''); current.hunk.after.push(''); }
    else current.damaged = true; // bare line Codex would reject — don't guess
  }
  closeHunk();
  flush();
  return out;
}
