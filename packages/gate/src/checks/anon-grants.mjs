// @ts-check
// GRANT to anon/authenticated on a data schema (not public / graphql_public /
// platform) is the class that made a private API schema reachable the day
// PostgREST exposed it. Model A keeps GRANT on `public`; this check does not
// touch that. `smugan-ignore` with a reason if a non-public schema is meant to
// be a public catalog.
import { stripSql } from '../strip.mjs';
import { isMigrationPath, PLATFORM_SCHEMAS } from '../sql-util.mjs';

const ALLOWED = new Set(['public', 'graphql_public', ...PLATFORM_SCHEMAS]);
const ROLE_RE = /\b(?:anon|authenticated)\b/i;
const SCHEMA_LIST_RE = /\b(?:in|on)\s+schema\s+((?:"[^"]+"|[\w]+)(?:\s*,\s*(?:"[^"]+"|[\w]+))*)/gi;
const QUALIFIED_RE = /(?:^|[\s,])(?:"[^"]+"|[\w]+)\.(?:"[^"]+"|[\w]+)/g;

/**
 * Top-level statements ending at `;` (or EOF). Depth tracks parentheses so a
 * GRANT inside a function body is not a statement of its own.
 * @param {string} sql
 * @returns {{ text: string, offset: number }[]}
 */
function statements(sql) {
  /** @type {{ text: string, offset: number }[]} */
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      out.push({ text: sql.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (start < sql.length) out.push({ text: sql.slice(start), offset: start });
  return out;
}

/** @param {string} ident */
function schemaName(ident) {
  return ident.replace(/"/g, '').toLowerCase();
}

/**
 * Drop parentheticals so `FUNCTION public.foo(app_private.bar)` is not a grant target.
 * @param {string} s
 */
function stripParens(s) {
  let out = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(') {
      depth++;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

/** @param {string} stmt @returns {Set<string>} */
function schemasInGrant(stmt) {
  const schemas = new Set();
  const onClause = stripParens(stmt.split(/\bto\b/i)[0]);
  let m;
  SCHEMA_LIST_RE.lastIndex = 0;
  while ((m = SCHEMA_LIST_RE.exec(onClause)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (name) schemas.add(schemaName(name));
    }
  }
  QUALIFIED_RE.lastIndex = 0;
  while ((m = QUALIFIED_RE.exec(onClause)) !== null) {
    const left = m[0].replace(/^[\s,]+/, '').split('.')[0];
    schemas.add(schemaName(left));
  }
  if (schemas.size === 0) schemas.add('public');
  return schemas;
}

export default {
  name: 'anon-grants',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const sql = stripSql(content);
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    for (const { text, offset } of statements(sql)) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const isGrant = /^\s*grant\b/i.test(trimmed);
      const isDefault = /^\s*alter\s+default\s+privileges\b/i.test(trimmed) && /\bgrant\b/i.test(trimmed);
      if (!isGrant && !isDefault) continue;
      const to = /\bto\b([\s\S]*)/i.exec(trimmed);
      if (!to || !ROLE_RE.test(to[1])) continue;
      for (const schema of schemasInGrant(trimmed)) {
        if (ALLOWED.has(schema)) continue;
        violations.push({
          line: sql.slice(0, offset + text.search(/\S/)).split('\n').length,
          message:
            `GRANT to anon/authenticated on schema "${schema}" — these roles must not reach a data schema; ` +
            'revoke it, or smugan-ignore with a reason if this catalog is meant to be public',
        });
      }
    }
    return violations;
  },
};
