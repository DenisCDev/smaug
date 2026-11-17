// @ts-check
// A security definer function runs with its owner's rights. Without a fixed
// search_path, a caller who can create objects in a schema on the path can
// shadow what the function calls and run code as the owner (PostgreSQL docs,
// "Writing SECURITY DEFINER Functions Safely"); Supabase's advisor reports it
// as function_search_path_mutable. The fix lives in the function's clauses
// (`set search_path = ''`), or in a later `alter function … set search_path`.
import { stripSql } from '../strip.mjs';
import { isMigrationPath, normalizeIdent, PLATFORM_SCHEMAS, QUALIFIED_NAME, statementHeader } from '../sql-util.mjs';

const ROUTINE_RE = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(${QUALIFIED_NAME})\s*\(`, 'gi');
const ALTER_RE = new RegExp(String.raw`\balter\s+(?:function|procedure)\s+(${QUALIFIED_NAME})\s*(?:\([^)]*\))?\s+set\s+search_path\b`, 'gi');

export default {
  name: 'search-path',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const sql = stripSql(content);
    // Where each function gets its search_path pinned: a create or replace
    // after the alter redefines the function without it, so only a later one counts.
    /** @type {Map<string, number[]>} */
    const pinned = new Map();
    let m;
    while ((m = ALTER_RE.exec(sql)) !== null) {
      const name = normalizeIdent(m[1]).name;
      pinned.set(name, [...(pinned.get(name) ?? []), m.index]);
    }

    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    while ((m = ROUTINE_RE.exec(sql)) !== null) {
      const { schema, name } = normalizeIdent(m[1]);
      const at = m.index;
      if (PLATFORM_SCHEMAS.has(schema) || (pinned.get(name) ?? []).some((p) => p > at)) continue;
      const header = statementHeader(sql, m.index);
      if (!/\bsecurity\s+definer\b/i.test(header) || /\bset\s+search_path\b/i.test(header)) continue;
      violations.push({
        line: sql.slice(0, m.index).split('\n').length,
        message:
          `security definer function "${name}" has no fixed search_path — a caller can shadow what it uses and run code with its owner's rights; ` +
          `add "set search_path = ''" and schema-qualify the names it uses`,
      });
    }
    return violations;
  },
};
