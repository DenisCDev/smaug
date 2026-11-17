// @ts-check
// RLS enabled is not RLS that restricts. A permissive policy whose USING is
// always true lets its roles update or delete every row, and one that reads
// user_metadata lets users grant themselves the access: that is the part of
// their own record they edit through auth.updateUser(). Supabase's advisor
// reports them as permissive_rls_policy and rls_references_user_metadata.
// Left out on purpose: a read or an insert open to everyone (a public
// catalog and a contact form are product decisions, pinned by the table's
// pgTAP test) and a policy without USING, which PostgreSQL treats as showing
// no row (rowsecurity.c, add_security_quals).
import { matching } from '../functions.mjs';
import { stripSql } from '../strip.mjs';
import { isMigrationPath, normalizeIdent, QUALIFIED_NAME } from '../sql-util.mjs';

const POLICY_RE = new RegExp(String.raw`\bcreate\s+policy\s+("[^"]+"|[\w$]+)\s+on\s+(${QUALIFIED_NAME})`, 'gi');
// Roles that bypass RLS or never come from a browser.
const SERVER_ROLES = new Set(['service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user']);
const ALWAYS_TRUE_RE = /^(?:true|1=1)$/;
const WRITES = /** @type {Record<string, string>} */ ({ all: 'update and delete', update: 'update', delete: 'delete' });
const USER_METADATA_RE = /\buser_metadata\b|\braw_user_meta_data\b/i;

/** Index of the `;` that ends the statement starting at `start`, outside parentheses. @param {string} sql @param {number} start */
function statementEnd(sql, start) {
  let depth = 0;
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
    else if (sql[i] === ';' && depth <= 0) return i;
  }
  return sql.length;
}

/** `text` with what sits inside parentheses blanked, so a clause keyword is found at the statement's own level. @param {string} text */
function outerLevel(text) {
  let depth = 0;
  let out = '';
  for (const c of text) {
    if (c === ')') depth--;
    out += depth > 0 ? ' ' : c;
    if (c === '(') depth++;
  }
  return out;
}

/** An expression without spaces or the parentheses that wrap all of it. @param {string} expression */
function bare(expression) {
  let e = expression.replace(/\s+/g, '').toLowerCase();
  while (e.startsWith('(') && matching(e, 0) === e.length) e = e.slice(1, -1);
  return e;
}

export default {
  name: 'rls-policy',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const sql = stripSql(content);
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    for (const m of sql.matchAll(POLICY_RE)) {
      const end = statementEnd(sql, m.index);
      const statement = sql.slice(m.index, end);
      const outer = outerLevel(statement);
      const using = /\busing\s*\(/i.exec(outer);
      const check = /\bwith\s+check\s*\(/i.exec(outer);
      // What comes between the table and the first expression: AS, FOR and TO.
      const head = outer.slice(m[0].length, Math.min(using?.index ?? outer.length, check?.index ?? outer.length));
      const line = sql.slice(0, m.index).split('\n').length;
      const policy = m[1].replace(/"/g, '');
      const table = normalizeIdent(m[2]).name;

      // What the policy reads is in its two expressions, not in its name or
      // its table's. The string 'user_metadata' is blanked in the stripped
      // copy: read the original at the same offsets, without its comments.
      const written = [using, check].map((clause) => {
        const open = clause ? clause.index + clause[0].length - 1 : -1;
        const close = open < 0 ? -1 : matching(statement, open);
        return close < 0 ? '' : content.slice(m.index + open, m.index + close);
      }).join('\n').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
      if (USER_METADATA_RE.test(written)) {
        violations.push({
          line,
          message:
            `policy "${policy}" decides access from user_metadata, which the user can change through auth.updateUser() — ` +
            'read the claim from app_metadata, or from a table the user cannot write',
        });
        continue;
      }

      const command = (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(head)?.[1] ?? 'all').toLowerCase();
      if (!(command in WRITES) || /\bas\s+restrictive\b/i.test(head) || !using) continue;
      const roles = (/\bto\s+([\s\S]+)$/i.exec(head)?.[1] ?? '').split(',').map((role) => role.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);
      if (roles.length > 0 && roles.every((role) => SERVER_ROLES.has(role))) continue;
      const open = using.index + using[0].length - 1;
      const close = matching(statement, open);
      if (close < 0 || !ALWAYS_TRUE_RE.test(bare(statement.slice(open + 1, close - 1)))) continue;
      violations.push({
        line,
        message:
          `policy "${policy}" lets ${roles.length > 0 ? roles.join(', ') : 'every role'} ${WRITES[command]} every row of "${table}" (using (true)) — ` +
          'scope it to the rows the user owns, for example "using ((select auth.uid()) = user_id)"; ' +
          'smugan-ignore with the reason if every such user may write every row',
      });
    }
    return violations;
  },
};
