// @ts-check
// Debug console output left in source is debug residue — log, debug, info,
// table, dir and trace all count. warn/error stay allowed.
import { CODE_FILE_RE } from '../functions.mjs';
import { stripCode } from '../strip.mjs';

const LOG_RE = /\bconsole\.(log|debug|info|table|dir|trace)\s*\(/;
const EXCLUDED_PATH_RE = /(^|\/)(scripts?|tests?|__tests__|e2e|bin|tools?)\/|\.(test|spec)\.|\.config\./;

export default {
  name: 'console-log',
  /** @param {string} path */
  appliesTo(path) {
    return CODE_FILE_RE.test(path) && !EXCLUDED_PATH_RE.test(path);
  },
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const stripped = stripCode(content).split('\n');
    const violations = [];
    for (let i = 0; i < stripped.length; i++) {
      const m = LOG_RE.exec(stripped[i]);
      if (m) {
        // Never suggest warn/error as the fix: that invites renaming info logs
        // to warnings just to pass, which downgrades log semantics.
        violations.push({
          line: i + 1,
          message: `console.${m[1]} left behind — delete debug output, or route intentional logging through the project logger`,
        });
      }
    }
    return violations;
  },
};
