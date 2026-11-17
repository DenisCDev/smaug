// @ts-check
// A function that already existed and starts answering bad input or a failure
// with a quiet default. Building on agent-written code cut the next task's
// resolution by up to 13.1 points in CodeThread (arXiv 2606.21804), and the
// predictor was this drift of the input/error contract (silent fallback,
// invented input gating, changed error handling; OR 1.83), which survived the
// next change in 85.9% of cases. Cyclomatic and cognitive complexity,
// Halstead and LLOC predicted nothing (p > 0.27). Only functions that existed
// when the turn first touched the file count: a new function defines its
// contract, an old one changing it is the drift.
import { functionSpans, matching } from './functions.mjs';
import { stripCode } from './strip.mjs';

const EXCLUDED_PATH_RE = /(^|\/)(scripts?|tests?|__tests__|e2e|bin)\/|\.(test|spec)\.|\.config\.|\.d\.ts$/;
// UI components render defaults on purpose and are skipped whole.
const UI_PATH_RE = /\.[jt]sx$|(^|\/)(components?|ui)\//;
const LITERAL = String.raw`(?:-?\d[\d_.]*|'[^'\n]*'|"[^"\n]*"|\x60[^\x60\n]*\x60|\[\s*\]|\{\s*\}|null|undefined|true|false)`;
const RESPONSE_NAMES = 'res|resp|response|data|json|body|payload|result';
const LOG_RE = /^(?:console|logger|log|this\.logger|this\.log|Sentry)\s*\.\s*[\w$]+\s*\([\s\S]*\)$|^(?:captureException|reportError)\s*\([\s\S]*\)$/;
const EMPTY_VALUE_RE = /^return(?:\s+(?:null|undefined|\[\s*\]))?$/;

/** @typedef {{ fn: string, line: number, key: string, message: string }} Drift */

/** Statements of a block body, split at top-level `;` and line ends. @param {string} body */
function statements(body) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let current = '';
  for (const c of body) {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (depth === 0 && (c === ';' || c === '\n')) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Every drift-shaped construct in every function of `code`, keyed without
 * line numbers so the turn-start copy cancels the ones that were already there.
 * @param {string} rel @param {string} code @returns {Drift[]}
 */
export function driftFindings(rel, code) {
  // A component renders a default for absent props and returns null to
  // render nothing: in UI files none of the three shapes is drift.
  // smugan-ignore contract-drift: UI files are out of scope by design, not a quiet default
  if (EXCLUDED_PATH_RE.test(rel) || UI_PATH_RE.test(rel)) return [];
  const text = code.replace(/\r\n/g, '\n');
  const s = stripCode(text);
  const lineOf = (/** @type {number} */ i) => s.slice(0, i).split('\n').length;
  /** @type {Drift[]} */
  const found = [];
  const spans = functionSpans(text);
  for (const f of spans) {
    // Constructs inside a nested function, named or a callback, belong to it.
    /** @type {[number, number][]} */
    const inner = spans.filter((g) => g !== f && g.start > f.bodyStart && g.end <= f.end).map((g) => [g.bodyStart, g.end]);
    for (const m of s.slice(f.bodyStart + 1, f.end - 1).matchAll(/=>\s*\{|(?<![\w$])function\s*\*?\s*[\w$]*\s*\([^)]*\)\s*\{/g)) {
      const open = f.bodyStart + 1 + m.index + m[0].length - 1;
      const close = matching(s, open);
      if (close > 0) inner.push([open, close]);
    }
    const own = (/** @type {number} */ at) => !inner.some(([from, to]) => at > from && at < to);
    const body = s.slice(f.bodyStart, f.end);
    const at = (/** @type {number} */ i) => f.bodyStart + i;
    const snippet = (/** @type {number} */ from, /** @type {number} */ to) => text.slice(from, to).replace(/\s+/g, ' ').trim().slice(0, 80);
    const push = (/** @type {number} */ index, /** @type {string} */ kind, /** @type {string} */ shape, /** @type {string} */ message) => {
      found.push({ fn: f.name, line: lineOf(index), key: `${kind}|${f.name}|${shape}`, message: `${f.name}(): ${message}` });
    };

    {
      const uses = (/** @type {string | undefined} */ error, /** @type {string} */ part) => Boolean(error) && new RegExp(`(?<![\\w$.])${error?.replace(/\$/g, '\\$')}(?![\\w$])`).test(part);
      /**
       * What the block of a catch, or of a .catch callback, does with the
       * failure when it only logs, continues or returns without the error:
       * the `return` it answers with, '' when it has none; null when the
       * failure is handled.
       * @param {number} open @param {number} close @param {string | undefined} error
       */
      const swallows = (open, close, error) => {
        const parts = statements(s.slice(open + 1, close - 1));
        const quiet = parts.length > 0 && parts.every((p) => LOG_RE.test(p) || p === 'continue' || (/^return\b/.test(p) && !uses(error, p)));
        if (!quiet || /\bthrow\b/.test(s.slice(open, close))) return null;
        return parts.some((p) => /^return\b/.test(p)) ? snippet(open + 1 + s.slice(open + 1, close).indexOf('return'), close - 1) : '';
      };
      for (const m of body.matchAll(/(?<![.\w$])catch\s*(?:\(\s*([\w$]*)[^)]*\)\s*)?\{/g)) {
        const open = at(m.index + m[0].length - 1);
        if (!own(open)) continue;
        const close = matching(s, open);
        const answer = close < 0 ? null : swallows(open, close, m[1]);
        if (answer === null) continue;
        push(at(m.index), 'catch', snippet(open, close), answer
          ? `new catch answers the failure with \`${answer}\` — callers that saw the error now get a normal-looking value`
          : 'new catch only logs and carries on — callers that saw the error now see success');
      }
      for (const m of body.matchAll(/\.catch\s*\(\s*(?:async\s*)?(?:\(\s*([\w$]*)[^)]*\)|([\w$]+))\s*=>\s*/g)) {
        const after = at(m.index + m[0].length);
        if (!own(after)) continue;
        const error = m[1] || m[2];
        if (s[after] === '{') {
          // A callback with a block is read like the block of a catch; an empty one hides the failure whole.
          const close = matching(s, after);
          if (close < 0) continue;
          const empty = !s.slice(after + 1, close - 1).trim();
          const answer = empty ? '' : swallows(after, close, error);
          if (answer === null) continue;
          push(at(m.index), 'catch', snippet(at(m.index), close), answer
            ? `new .catch answers the rejection with \`${answer}\` — callers that saw the error now get a normal-looking value`
            : `new .catch ${empty ? 'ignores the rejection' : 'only logs and carries on'} — callers that saw the error now see success`);
          continue;
        }
        // The value an expression body hands back, an object in its parentheses included: `() => ({})`.
        const value = new RegExp(`^(?:\\(\\s*${LITERAL}\\s*\\)|${LITERAL})\\s*\\)`).exec(s.slice(after));
        if (!value || uses(error, value[0])) continue;
        push(at(m.index), 'catch', snippet(at(m.index), after + value[0].length), `new .catch answers the rejection with \`${snippet(after, after + value[0].length - 1)}\` — callers that saw the error now get a normal-looking value`);
      }
    }

    const params = f.params.map((p) => p.replace(/\$/g, '\\$')).join('|') || '(?!)';
    const fallback = new RegExp(String.raw`(?<![\w$.])((?:${params})(?:\??\.[\w$]+|\[[^\]\n]*\])*|(?:${RESPONSE_NAMES})(?:\??\.[\w$]+)+)\s*(\?\?|\|\|)\s*(${LITERAL})`, 'g');
    for (const m of body.matchAll(fallback)) {
      if (!own(at(m.index))) continue;
      // An optional list walked as empty (`for (x of opts.items ?? [])`,
      // `(opts.items ?? []).map`) or an optional object spread as empty keeps
      // "absent" meaning "none": that is the contract, not a quiet default.
      const before = body.slice(Math.max(0, m.index - 12), m.index);
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 30);
      const empty = /^\[\s*\]$/.test(m[3]) ? 'list' : /^\{\s*\}$/.test(m[3]) ? 'object' : null;
      const spread = /\.\.\.\s*\(?\s*$/.test(before);
      if (empty === 'list' && (spread || /(?<![\w$])of\s*\(?\s*$/.test(before) || /^\s*\)\s*\??\.\s*(?:map|filter|flatMap|some|every|forEach|reduce|find|findIndex|includes|join|length|slice|entries)\b/.test(after))) continue;
      if (empty === 'object' && spread) continue;
      const shape = snippet(at(m.index), at(m.index + m[0].length));
      push(at(m.index), 'fallback', shape, `new fallback \`${shape}\` — input that used to fail or arrive as it was now silently becomes a default`);
    }

    // A callback's `return x` says nothing about what this function returns.
    const returnsValue = [...body.matchAll(/(?<![\w$])return[ \t]+[^;\s}]/g)].some((r) => own(at(r.index)));
    for (const m of body.matchAll(/(?<![\w$])if\s*\(/g)) {
      const paren = at(m.index + m[0].length - 1);
      if (!own(paren)) continue;
      const close = matching(s, paren);
      if (close < 0) continue;
      const rest = s.slice(close);
      // The statement must end there: `return cache.get(key)` hands back a value, it is no empty answer.
      // A cast to the return type (`return [] as Item[]`, `return null!`) leaves the answer empty.
      const single = /^\s*(return(?:[ \t]+(?:null|undefined|\[\s*\]))?)(?:!|[ \t]+as[ \t]+[^;\n}]+)?[ \t]*(?:;|(?=\r?\n|\}|$))/.exec(rest);
      const block = /^\s*\{\s*(return(?:\s+(?:null|undefined|\[\s*\]))?)(?:!|\s+as\s+[^;\n}]+)?\s*;?\s*\}/.exec(rest);
      const hit = single ?? block;
      if (!hit || !EMPTY_VALUE_RE.test(hit[1].replace(/\s+/g, ' '))) continue;
      // A bare `return` only counts in a function that otherwise returns a value.
      if (hit[1] === 'return' && !returnsValue) continue;
      const value = hit[1].replace(/^return\s*/, '') || 'undefined';
      push(at(m.index), 'guard', snippet(at(m.index), close + hit[0].length), `new guard \`${snippet(at(m.index), close + hit[0].length)}\` — input the function used to reject or process now quietly yields ${value}`);
    }
  }
  return found;
}

/** Multiset of drift keys. @param {Drift[]} list @returns {[string, number][]} */
export function driftCounts(list) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const d of list) map.set(d.key, (map.get(d.key) ?? 0) + 1);
  return [...map];
}

/**
 * The drift a turn introduced into functions that existed at its start.
 * @param {string} rel @param {string} code the file now
 * @param {string[]} existed function names at the turn's first touch
 * @param {[string, number][]} baseline driftCounts at the turn's first touch
 */
export function introducedDrift(rel, code, existed, baseline) {
  const budget = new Map(baseline);
  const names = new Set(existed);
  return driftFindings(rel, code).filter((d) => {
    if (!names.has(d.fn)) return false;
    const left = budget.get(d.key) ?? 0;
    if (left > 0) {
      budget.set(d.key, left - 1);
      return false;
    }
    return true;
  });
}
