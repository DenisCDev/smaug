// @ts-check
// Shared SQL DDL parsing for checks that reason about created tables.

/** @typedef {{ schema: string, name: string, line: number, temp: boolean }} CreatedTable */

// Each part bare or double-quoted: `supabase db diff` writes "public"."notes",
// and a quoted schema read alone turned "public" into the table's name.
export const QUALIFIED_NAME = String.raw`(?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?`;

const CREATE_RE = new RegExp(String.raw`\bcreate\s+(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED_NAME})`, 'gi');

// Schemas managed by the platform — RLS handled elsewhere (or not applicable).
export const PLATFORM_SCHEMAS = new Set(['auth', 'storage', 'extensions', 'realtime', 'vault', 'pg_catalog']);

/** @param {string} ident */
export function normalizeIdent(ident) {
  const parts = ident.replace(/"/g, '').toLowerCase().split('.');
  return { schema: parts.length > 1 ? parts[0] : 'public', name: parts[parts.length - 1] };
}

/** @param {string} strippedSql @returns {CreatedTable[]} */
export function createdTables(strippedSql) {
  /** @type {CreatedTable[]} */
  const tables = [];
  let m;
  while ((m = CREATE_RE.exec(strippedSql)) !== null) {
    const { schema, name } = normalizeIdent(m[1]);
    tables.push({
      schema,
      name,
      line: strippedSql.slice(0, m.index).split('\n').length,
      temp: /\b(temp|temporary)\s+table/i.test(m[0]),
    });
  }
  return tables;
}

/** Tables the project owns: public schema, not temporary. @param {string} strippedSql */
export function userTables(strippedSql) {
  return createdTables(strippedSql).filter((t) => !t.temp && !PLATFORM_SCHEMAS.has(t.schema));
}

/** @param {string} path */
export function isMigrationPath(path) {
  return path.endsWith('.sql') && /(^|\/)migrations?\//.test(path);
}

const DOLLAR_QUOTE_RE = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;

/**
 * The header of the statement starting at `start`: its text up to the `;`
 * that ends it, without the dollar-quoted bodies, whose own `;` and words are
 * the function's code rather than its clauses.
 * @param {string} strippedSql @param {number} start
 */
export function statementHeader(strippedSql, start) {
  let header = '';
  let i = start;
  while (i < strippedSql.length) {
    DOLLAR_QUOTE_RE.lastIndex = i;
    const open = DOLLAR_QUOTE_RE.exec(strippedSql);
    const semicolon = strippedSql.indexOf(';', i);
    if (semicolon >= 0 && (!open || semicolon < open.index)) return header + strippedSql.slice(i, semicolon);
    if (!open) return header + strippedSql.slice(i);
    header += strippedSql.slice(i, open.index) + ' ';
    const close = strippedSql.indexOf(open[0], open.index + open[0].length);
    i = close < 0 ? strippedSql.length : close + open[0].length;
  }
  return header;
}
