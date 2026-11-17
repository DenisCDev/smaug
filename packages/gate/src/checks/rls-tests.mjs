// @ts-check
// RLS present is not RLS correct. Every table created in a migration needs a
// pgTAP test in supabase/tests/ proving the three scenarios: anon denied,
// owner sees own rows, another user sees zero. This check only proves the
// test EXISTS — `supabase test db` proves it passes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripSql } from '../strip.mjs';
import { isMigrationPath, userTables } from '../sql-util.mjs';

/** @param {string} dir @returns {string} concatenated content of all .sql files under dir */
function sqlCorpus(dir) {
  let corpus = '';
  /** @param {string} d */
  const walk = (d) => {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.sql')) {
        try {
          corpus += readFileSync(p, 'utf8') + '\n';
        } catch { /* smugan-ignore empty-catch: unreadable test file — treat as absent */ }
      }
    }
  };
  walk(dir);
  return corpus;
}

/** @param {string} name */
function escapeRe(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  name: 'rls-tests',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string, config: import('../config.mjs').SmuganConfig, options: Record<string, any> }} ctx */
  run({ content, config, options }) {
    const tables = userTables(stripSql(content));
    if (tables.length === 0) return [];
    const exempt = new Set(
      (Array.isArray(options.exempt) ? options.exempt : []).map((/** @type {string} */ t) => t.toLowerCase()),
    );
    const dir = typeof options.dir === 'string' ? options.dir : 'supabase/tests';
    const corpus = sqlCorpus(join(config.root, dir));

    const violations = [];
    for (const table of tables) {
      if (exempt.has(table.name)) continue;
      if (new RegExp('\\b' + escapeRe(table.name) + '\\b').test(corpus)) continue;
      violations.push({
        line: table.line,
        message:
          `table "${table.name}" has no pgTAP RLS test in ${dir}/ — instantiate table-rls.test.sql.template ` +
          '(anon denied, owner sees own rows, other user sees zero) and run "supabase test db"',
      });
    }
    return violations;
  },
};
