// @ts-check
// Every table created in a migration must enable Row Level Security in the
// same migration file. Deny-by-default from the very first migration. A later
// migration that turns it off is the same exposure, so it is flagged too.
import { stripSql } from '../strip.mjs';
import { isMigrationPath, normalizeIdent, PLATFORM_SCHEMAS, QUALIFIED_NAME, userTables } from '../sql-util.mjs';

const ALTER_TABLE = String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED_NAME})\s+`;
const ENABLE_RE = new RegExp(ALTER_TABLE + String.raw`(?:force\s+)?enable\s+row\s+level\s+security`, 'gi');
const DISABLE_RE = new RegExp(ALTER_TABLE + String.raw`disable\s+row\s+level\s+security`, 'gi');
// Turning it off is no exposure when the file turns it back on later (a
// backfill), drops the table, or is a down migration: a *.down.sql file,
// Diesel's <migration>/down.sql, or the down section that goose, dbmate and
// sql-migrate keep in the same file after a marker comment.
const DROP_RE = new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?((?:${QUALIFIED_NAME})(?:\s*,\s*(?:${QUALIFIED_NAME}))*)`, 'gi');
const DOWN_MIGRATION_RE = /(?:^|[/.])down\.sql$/i;
const SECTION_RE = /^[ \t]*--[ \t]*(?:\+goose[ \t]+(up|down)|migrate:(up|down)|\+migrate[ \t]+(up|down))\b/gim;

/**
 * Offset ranges of the down sections, read from the original text: the
 * markers are comments, which the stripped copy blanks at the same offsets.
 * @param {string} content @returns {[number, number][]}
 */
function downSections(content) {
  /** @type {[number, number][]} */
  const ranges = [];
  let start = -1;
  for (const m of content.matchAll(SECTION_RE)) {
    const down = (m[1] ?? m[2] ?? m[3]).toLowerCase() === 'down';
    if (down && start < 0) start = m.index;
    else if (!down && start >= 0) {
      ranges.push([start, m.index]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, content.length]);
  return ranges;
}

export default {
  name: 'rls',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ path: string, content: string, options: Record<string, any> }} ctx */
  run({ path, content, options }) {
    const sql = stripSql(content);
    const exempt = new Set(
      (Array.isArray(options.exempt) ? options.exempt : []).map((/** @type {string} */ t) => t.toLowerCase()),
    );

    /** @type {Map<string, number[]>} where each table is enabled */
    const enabled = new Map();
    let m;
    while ((m = ENABLE_RE.exec(sql)) !== null) {
      const name = normalizeIdent(m[1]).name;
      enabled.set(name, [...(enabled.get(name) ?? []), m.index]);
    }

    const violations = [];
    for (const table of userTables(sql)) {
      if (exempt.has(table.name) || enabled.has(table.name)) continue;
      violations.push({
        line: table.line,
        message:
          `table "${table.name}" created without RLS — add "alter table ${table.name} enable row level security;" ` +
          'plus per-operation policies in this migration',
      });
    }
    const downs = DOWN_MIGRATION_RE.test(path) ? [[0, sql.length]] : downSections(content);
    const inDown = (/** @type {number} */ at) => downs.some(([from, to]) => at >= from && at < to);
    // A drop in the rollback runs only when the migration is undone, like an enable there.
    const dropped = new Set();
    while ((m = DROP_RE.exec(sql)) !== null) {
      if (inDown(m.index)) continue;
      for (const part of m[1].split(',')) dropped.add(normalizeIdent(part.trim()).name);
    }
    while ((m = DISABLE_RE.exec(sql)) !== null) {
      const { schema, name } = normalizeIdent(m[1]);
      const at = m.index;
      // An enable in the rollback runs only when the migration is undone.
      const restored = (enabled.get(name) ?? []).some((p) => p > at && !inDown(p));
      if (exempt.has(name) || PLATFORM_SCHEMAS.has(schema) || restored || dropped.has(name) || inDown(at)) continue;
      violations.push({
        line: sql.slice(0, m.index).split('\n').length,
        message:
          `RLS disabled on table "${name}" — with it off, the anon and authenticated roles reach every row; ` +
          'keep it enabled and write the policy the access needs (smugan-ignore with a reason if the table is meant to be public)',
      });
    }
    return violations;
  },
};
