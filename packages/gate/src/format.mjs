// @ts-check
/** @typedef {import('./engine.mjs').Violation} Violation */

/** @param {Violation[]} violations */
function sorted(violations) {
  return [...violations].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

/** @param {{ filesChecked: number, violations: Violation[] }} result */
export function formatHuman(result) {
  const { filesChecked, violations } = result;
  if (violations.length === 0) {
    return `smugan: clean (${filesChecked} file${filesChecked === 1 ? '' : 's'} checked)\n`;
  }
  let out = '';
  for (const v of sorted(violations)) {
    out += `${v.file}:${v.line}  [${v.rule}]  ${v.message}\n`;
  }
  out += `\nsmugan: ${violations.length} violation${violations.length === 1 ? '' : 's'} in ${filesChecked} file${filesChecked === 1 ? '' : 's'} checked.\n`;
  out += 'False positive? Suppress with: // smugan-ignore <rule>: <reason (6+ chars)>\n';
  return out;
}

/** @param {{ filesChecked: number, violations: Violation[] }} result */
export function formatJson(result) {
  return JSON.stringify(
    {
      ok: result.violations.length === 0,
      filesChecked: result.filesChecked,
      violations: sorted(result.violations),
    },
    null,
    2,
  ) + '\n';
}
