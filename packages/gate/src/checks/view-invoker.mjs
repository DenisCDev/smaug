// @ts-check
// A view reads its tables with its owner's rights unless it is created with
// security_invoker (PostgreSQL 15+), so the RLS of those tables stops applying
// to whoever queries it, and the API exposes a view in public to the anon and
// authenticated roles. Supabase's advisor reports it as an error
// (security_definer_view). A later `alter view … set (security_invoker = true)`
// in the same file fixes it too; a temporary or materialized view is not this.
import { stripSql } from '../strip.mjs';
import { isMigrationPath, normalizeIdent, QUALIFIED_NAME } from '../sql-util.mjs';

const VIEW_RE = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(temp(?:orary)?\s+)?(?:recursive\s+)?view\s+(${QUALIFIED_NAME})([\s\S]*?)\bas\b`, 'gi');
const ALTER_RE = new RegExp(String.raw`\balter\s+view\s+(?:if\s+exists\s+)?(${QUALIFIED_NAME})\s+set\s*\(([^)]*)\)`, 'gi');
// A boolean option given without a value is true.
const INVOKER_RE = /\bsecurity_invoker\b(?!\s*=\s*(?:false|off|0|no)\b)/i;

export default {
  name: 'view-invoker',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const sql = stripSql(content);
    // Only an alter after the create counts: a create or replace redefines the view.
    /** @type {Map<string, number[]>} */
    const fixed = new Map();
    let m;
    while ((m = ALTER_RE.exec(sql)) !== null) {
      if (!INVOKER_RE.test(m[2])) continue;
      const name = normalizeIdent(m[1]).name;
      fixed.set(name, [...(fixed.get(name) ?? []), m.index]);
    }

    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    while ((m = VIEW_RE.exec(sql)) !== null) {
      if (m[1]) continue;
      const { schema, name } = normalizeIdent(m[2]);
      const at = m.index;
      if (schema !== 'public' || INVOKER_RE.test(m[3]) || (fixed.get(name) ?? []).some((p) => p > at)) continue;
      violations.push({
        line: sql.slice(0, m.index).split('\n').length,
        message:
          `view "${name}" reads its tables with its owner's rights, so their RLS does not apply to whoever queries it — ` +
          'create it "with (security_invoker = true)" (PostgreSQL 15+), or keep it out of the schema the API exposes',
      });
    }
    return violations;
  },
};
