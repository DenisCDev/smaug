// @ts-check
// One awaited database call per item of a loop: the N+1 that a fixture of
// three rows hides and production volume exposes. Agents stop at the first
// shallow gain and miss bottlenecks behind layers (PerfAgent, arXiv
// 2607.19653), and no study measures this guard with agents, so it stays
// narrow: an `await` of a known database client inside a walk over a
// collection (for…of, for…in, an index up to `.length`, a forEach/map
// callback), and an awaited `fetch` in a forEach callback, which the loop
// never waits for. A `fetch` in a for loop was left out: across three
// projects here, every one was a deliberate sequential download, retry or
// poll. The hook runs this only in critical turns.
import { matching } from '../functions.mjs';
import { stripCode } from '../strip.mjs';

const EXCLUDED_PATH_RE = /(^|\/)(scripts?|tests?|__tests__|e2e|bin|seeds?|migrations?)\/|\.(test|spec)\.|\.config\./;
const CODE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// `client`, `pool` and `conn` also name SDK clients (Anthropic, OpenAI, AWS):
// they count only when the call is a query.
const DB_CLIENT = String.raw`(?:(?:supabase|db|prisma|knex|sql|tx|trx|drizzle|pg|database|repo|repository)(?:\s*\.\s*[\w$]+)*\s*[(.\x60]|(?:client|pool|conn|connection)\s*\.\s*(?:query|execute)\s*\()`;
const DB_AWAIT_RE = new RegExp(String.raw`(?<![\w$.])await\s+(?:this\s*\.\s*)?${DB_CLIENT}`);
const FETCH_AWAIT_RE = /(?<![\w$.])await\s+fetch\s*\(/;

/**
 * Bodies of loops and of forEach/map callbacks in stripped code.
 * @param {string} s @returns {{ start: number, end: number, kind: 'loop' | 'forEach' | 'map' }[]}
 */
function loopBodies(s) {
  /** @type {{ start: number, end: number, kind: 'loop' | 'forEach' | 'map' }[]} */
  const bodies = [];
  for (const m of s.matchAll(/(?<![\w$.])for\s*(?:await\s*)?\(/g)) {
    // `for await (... of stream)` reads a stream; each item is not a query.
    if (/await/.test(m[0])) continue;
    const close = matching(s, m.index + m[0].length - 1);
    if (close < 0) continue;
    // Only a walk over a collection: `of`, `in`, or an index up to a
    // `.length`. A retry, polling or pagination loop (`while`, `for (;;)`,
    // `attempt < 3`) repeats one call by design.
    const header = s.slice(m.index + m[0].length, close - 1);
    if (!/^\s*(?:const|let|var)?\s*[\w${}[\],\s]+\s+(?:of|in)\s/.test(header) && !/<=?\s*[\w$.]+\.length\b/.test(header)) continue;
    const brace = /^\s*\{/.exec(s.slice(close));
    if (!brace) {
      // A one-statement body runs to its `;` or the end of the line.
      const statement = /^[^;\n]*/.exec(s.slice(close));
      bodies.push({ start: close, end: close + (statement ? statement[0].length : 0), kind: 'loop' });
      continue;
    }
    const open = close + brace[0].length - 1;
    const end = matching(s, open);
    if (end > 0) bodies.push({ start: open, end, kind: 'loop' });
  }
  for (const m of s.matchAll(/\.\s*(forEach|map|flatMap)\s*\(\s*async\b/g)) {
    const paren = s.indexOf('(', m.index);
    const end = matching(s, paren);
    if (end > 0) bodies.push({ start: paren, end, kind: m[1] === 'forEach' ? 'forEach' : 'map' });
  }
  return bodies;
}

export default {
  name: 'await-in-loop',
  /** @param {string} path */
  appliesTo(path) {
    return CODE_RE.test(path) && !EXCLUDED_PATH_RE.test(path);
  },
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const s = stripCode(content.replace(/\r\n/g, '\n'));
    /** @type {{ line: number, message: string }[]} */
    const found = [];
    const seen = new Set();
    for (const body of loopBodies(s)) {
      const text = s.slice(body.start, body.end);
      for (const m of text.matchAll(/(?<![\w$.])await\s+[^;\n]*/g)) {
        // Storage uploads and downloads move one file each: that is per item by nature.
        const db = DB_AWAIT_RE.test(m[0]) && !/\.\s*storage\b/.test(m[0]);
        const fetch = body.kind === 'forEach' && FETCH_AWAIT_RE.test(m[0]);
        const at = body.start + m.index;
        if ((!db && !fetch) || seen.has(at)) continue;
        seen.add(at);
        found.push({
          line: s.slice(0, at).split('\n').length,
          message: db
            ? 'awaited database call inside a loop runs one query per item (N+1) — fetch them in one query (an IN/ANY list, a join) or say why the list stays small'
            : 'awaited fetch inside a forEach callback: forEach never waits for it, so failures go unhandled and nothing finishes in order — use for…of, or Promise.all with a concurrency cap',
        });
      }
    }
    return found.sort((a, b) => a.line - b.line);
  },
};
