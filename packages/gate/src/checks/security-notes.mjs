// @ts-check
// Access rules must be legible to the human owner. Every table created in a
// migration needs one plain-language line in the project's SECURITY_NOTES.md
// saying who can read it and who can write it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripSql } from '../strip.mjs';
import { isMigrationPath, userTables } from '../sql-util.mjs';

/** @param {string} name */
function escapeRe(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  name: 'security-notes',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string, config: import('../config.mjs').SmuganConfig, options: Record<string, any> }} ctx */
  run({ content, config, options }) {
    const tables = userTables(stripSql(content));
    if (tables.length === 0) return [];
    const exempt = new Set(
      (Array.isArray(options.exempt) ? options.exempt : []).map((/** @type {string} */ t) => t.toLowerCase()),
    );
    const file = typeof options.file === 'string' ? options.file : 'SECURITY_NOTES.md';
    const notesPath = join(config.root, file);
    const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : null;

    const violations = [];
    for (const table of tables) {
      if (exempt.has(table.name)) continue;
      if (notes === null) {
        violations.push({
          line: table.line,
          message:
            `project has no ${file} — create it and describe table "${table.name}" in one plain-language line: ` +
            'who can read, who can write (template: smugan init)',
        });
        continue;
      }
      if (!new RegExp('\\b' + escapeRe(table.name) + '\\b').test(notes)) {
        violations.push({
          line: table.line,
          message:
            `table "${table.name}" is not described in ${file} — add one plain-language line: ` +
            'who can read, who can write',
        });
      }
    }
    return violations;
  },
};
