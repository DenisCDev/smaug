// @ts-check
// PostgreSQL docs §8.1: "If you require exact storage and calculations (such
// as for monetary amounts), use the numeric type instead"; §8.2 discourages
// the money type outright. A float column holding money silently loses cents.
import { stripSql } from '../strip.mjs';
import { isMigrationPath, QUALIFIED_NAME } from '../sql-util.mjs';

// Per word of the name, so `feedback_score` and `coffee_count` carry no fee;
// a word may end in the money word (`subtotal`, `unitprice`), except `fee`.
const MONEY_WORD_RE = /(?:price|amount|total|cost|value|balance|payment|revenue)s?$|^fees?$|salar(?:y|ies)$/i;

/** @param {string} name */
function isMoneyName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').split(/[^A-Za-z]+/).some((word) => MONEY_WORD_RE.test(word));
}
const FLOAT_TYPE_RE = /^(?:real|float4|float8|money|double\s+precision|float(?:\s*\(\s*\d+\s*\))?)\b/i;
const CREATE_RE = new RegExp(String.raw`\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED_NAME}\s*\(`, 'gi');
const ADD_RE = /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?!constraint\b)("[^"]+"|[\w$]+)\s+/gi;
// Converting an existing column loses the cents just the same.
const ALTER_TYPE_RE = /\balter\s+(?:column\s+)?("[^"]+"|[\w$]+)\s+(?:set\s+data\s+)?type\s+/gi;
const SEGMENT_SKIP = new Set(['constraint', 'primary', 'foreign', 'unique', 'check', 'exclude', 'like']);

/**
 * Top-level comma segments of the parenthesized column list opening at openParen.
 * @param {string} sql @param {number} openParen
 * @returns {{ start: number, end: number }[]}
 */
function columnSegments(sql, openParen) {
  /** @type {{ start: number, end: number }[]} */
  const segments = [];
  let depth = 0;
  let start = openParen + 1;
  for (let i = openParen; i < sql.length; i++) {
    const c = sql[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        segments.push({ start, end: i });
        break;
      }
    } else if (c === ',' && depth === 1) {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  return segments;
}

export default {
  name: 'money-float',
  /** @param {string} path */
  appliesTo: isMigrationPath,
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const sql = stripSql(content);
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    const report = (/** @type {string} */ ident, /** @type {string} */ type, /** @type {number} */ offset) => {
      const name = ident.replace(/^"|"$/g, '');
      if (!isMoneyName(name)) return;
      violations.push({
        line: sql.slice(0, offset).split('\n').length,
        message:
          `column "${name}" stores a money-like value as "${type.replace(/\s+/g, ' ').toLowerCase()}" — ` +
          'use numeric(12,2) or integer cents instead (PostgreSQL docs §8.1)',
      });
    };

    let m;
    while ((m = CREATE_RE.exec(sql)) !== null) {
      for (const { start, end } of columnSegments(sql, m.index + m[0].length - 1)) {
        const seg = /^(\s*)("[^"]+"|[\w$]+)\s+([\s\S]*)$/.exec(sql.slice(start, end));
        if (!seg || SEGMENT_SKIP.has(seg[2].toLowerCase())) continue;
        const type = FLOAT_TYPE_RE.exec(seg[3]);
        if (type) report(seg[2], type[0], start + seg[1].length);
      }
    }
    for (const re of [ADD_RE, ALTER_TYPE_RE]) {
      while ((m = re.exec(sql)) !== null) {
        const type = FLOAT_TYPE_RE.exec(sql.slice(m.index + m[0].length));
        if (type) report(m[1], type[0], m.index);
      }
    }
    return violations;
  },
};
