// @ts-check
// GitClear's "Maintainability Gap" (2026, 623M changes) measured error-masking
// constructs growing +47% in AI-assisted code. CLAUDE.md already forbids
// swallowed errors; this makes the unambiguous case mechanical: a catch whose
// body is empty or only comments (stripCode blanks them), and empty .catch()
// handlers. A catch that has real statements but never uses the error
// variable requires judgment and is deliberately NOT flagged (precision >
// recall) — that is critic territory.
import { CODE_FILE_RE } from '../functions.mjs';
import { stripCode } from '../strip.mjs';

const EXCLUDED_PATH_RE = /(^|\/)(scripts?|tests?|__tests__|e2e|bin)\/|\.(test|spec)\.|\.config\./;
// (?<!\.) keeps try/catch distinct from .catch(...) handler calls.
const EMPTY_CATCH_RE = /(?<!\.)\bcatch\s*(?:\(\s*[^)]*\)\s*)?\{\s*\}/g;
const EMPTY_HANDLER_RE = /\.catch\s*\(\s*(?:async\s+)?(?:function\s*[\w$]*\s*\(\s*[^)]*\)\s*|(?:\(\s*[^)]*\)|[\w$]+)\s*=>\s*)\{\s*\}\s*\)/g;

export default {
  name: 'empty-catch',
  /** @param {string} path */
  appliesTo(path) {
    return CODE_FILE_RE.test(path) && !EXCLUDED_PATH_RE.test(path);
  },
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const stripped = stripCode(content);
    const lineOf = (/** @type {number} */ i) => stripped.slice(0, i).split('\n').length;
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    let m;
    while ((m = EMPTY_CATCH_RE.exec(stripped)) !== null) {
      violations.push({
        line: lineOf(m.index),
        message: 'empty catch swallows the error — handle it, rethrow, or log with context; never fail silently',
      });
    }
    while ((m = EMPTY_HANDLER_RE.exec(stripped)) !== null) {
      violations.push({
        line: lineOf(m.index),
        message: 'empty .catch() swallows the rejection — handle it, rethrow, or log with context; never fail silently',
      });
    }
    return violations;
  },
};
