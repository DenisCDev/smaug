// @ts-check
// A server-side `fetch(` with no deadline hangs the process: slow is worse
// than a fast error. Wrappers (`api.get()`, `client.fetch()`) and a `fetch`
// whose timeout lives in a variable are false negatives on purpose —
// precision over recall; the critic checklist owns the rest.
import { CODE_FILE_RE } from '../functions.mjs';
import { stripCode } from '../strip.mjs';

const EXCLUDED_PATH_RE = /(^|\/)(scripts?|tests?|__tests__|e2e|bin)\/|\.(test|spec)\.|\.config\./;
// `globalThis.fetch` is the platform fetch by another name. `self.fetch` is
// left out: `self` is also what code calls an alias of `this`.
const FETCH_RE = /(?<!\.)\b(?:globalThis\s*\.\s*)?fetch\s*\(/g;
const DIRECTIVE_RE = /^['"]use client['"]/;
const MEMBER_START_RE = /(?:^|[{;,])\s*(?:(?:export|default|declare|async|static|public|private|protected|abstract|override|readonly)\s+)*$/;

/**
 * True when the module directive is `"use client"`, ignoring leading comments
 * and blank lines (the Next.js compiler does the same).
 * @param {string} content
 */
export function isClientModule(content) {
  let s = content.replace(/^\uFEFF/, '');
  for (;;) {
    const trimmed = s.replace(/^\s+/, '');
    if (trimmed.startsWith('//')) {
      const nl = trimmed.indexOf('\n');
      s = nl === -1 ? '' : trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const end = trimmed.indexOf('*/');
      s = end === -1 ? '' : trimmed.slice(end + 2);
      continue;
    }
    s = trimmed;
    break;
  }
  return DIRECTIVE_RE.test(s);
}

/**
 * Slice from the opening `(` of `fetch(` to its matching `)`.
 * @param {string} src
 * @param {number} openParen
 */
function callSlice(src, openParen) {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen, Math.min(src.length, openParen + 400));
}

/**
 * `fetch(` that declares instead of calling: `function fetch(`, a method with
 * a body (`fetch(request) {`, the entry point Workers and Bun export) or a
 * signature where a member starts (`fetch(input: string): Promise<Response>`).
 * A call can also be followed by `:`, in a ternary, but there it does not open
 * a member with its type on the same line.
 * @param {string} src stripped code @param {number} at index of `fetch` @param {number} end index after the closing `)`
 */
function declaresFetch(src, at, end) {
  if (/\bfunction\s*\*?\s*$/.test(src.slice(Math.max(0, at - 24), at))) return true;
  const after = src.slice(end, end + 200);
  if (/^\s*\{/.test(after)) return true;
  return /^[ \t]*:[ \t]*\S/.test(after) && MEMBER_START_RE.test(src.slice(src.lastIndexOf('\n', at - 1) + 1, at));
}

/**
 * Property names of the 2nd-arg options object: `{ signal }` and `{ timeout: n }`
 * are read; the `timeout` in `{ body: JSON.stringify({ timeout: 1 }) }` is not.
 * @param {string} call
 * @returns {string[]}
 */
function optionKeys(call) {
  let depth = 0;
  let comma = -1;
  for (let i = 0; i < call.length; i++) {
    const c = call[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 1) {
      comma = i;
      break;
    }
  }
  if (comma < 0) return [];
  const rest = call.slice(comma + 1).trimStart();
  if (!rest.startsWith('{')) return [];
  /** @type {string[]} */
  const keys = [];
  depth = 0;
  let expectKey = true;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '{' || c === '(' || c === '[') {
      depth++;
      if (c !== '{') expectKey = false;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (c === ',' && depth === 1) {
      expectKey = true;
      continue;
    }
    if (!expectKey || depth !== 1 || /\s/.test(c)) continue;
    const ident = /^[A-Za-z_$][\w$]*/.exec(rest.slice(i));
    if (!ident) {
      expectKey = false;
      continue;
    }
    keys.push(ident[0]);
    i += ident[0].length - 1;
    expectKey = false;
  }
  return keys;
}

// `timeout:` belongs to node-fetch 2 and ofetch's `$fetch`; the platform fetch
// (Node, undici, browsers, Next.js) ignores it and the call can still hang.
const FETCH_SOURCE_RES = [
  /\bimport\s+fetch\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\{[^}]*\bfetch\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/g,
  /\bfetch\s*=\s*require\s*\(\s*['"]([^'"]+)['"]/g,
];

/**
 * True when `fetch` is bound to a library whose `timeout` option may be real.
 * The module name is read from the original text; the `fetch` binding must be
 * code in the stripped copy, so a commented-out import, or a `// fetch,` entry
 * inside a live one, binds nothing.
 * @param {string} content @param {string} stripped
 */
function libraryFetch(content, stripped) {
  return FETCH_SOURCE_RES.some((re) => [...content.matchAll(re)].some((m) =>
    m[1] !== 'undici' && stripped[m.index] !== ' ' && /\bfetch\b/.test(stripped.slice(m.index, m.index + m[0].length))));
}

export default {
  name: 'fetch-timeout',
  /** @param {string} path */
  appliesTo(path) {
    return CODE_FILE_RE.test(path) && !EXCLUDED_PATH_RE.test(path);
  },
  /** @param {{ content: string }} ctx */
  run({ content }) {
    if (isClientModule(content)) return [];
    const stripped = stripCode(content);
    const library = libraryFetch(content, stripped);
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    let m;
    FETCH_RE.lastIndex = 0;
    while ((m = FETCH_RE.exec(stripped)) !== null) {
      const open = m.index + m[0].length - 1;
      const call = callSlice(stripped, open);
      if (declaresFetch(stripped, m.index, open + call.length)) continue;
      if (/\bAbortSignal\b|\bAbortController\b/.test(call)) continue;
      const keys = optionKeys(call);
      if (keys.includes('signal')) continue;
      const timeout = keys.includes('timeout');
      if (timeout && (library || stripped[m.index - 1] === '$')) continue;
      violations.push({
        line: stripped.slice(0, m.index).split('\n').length,
        message: timeout
          ? 'fetch() ignores the timeout: option, so this call has no deadline — pass signal: AbortSignal.timeout(...) instead'
          : 'server fetch() has no deadline — pass AbortSignal.timeout(...) or signal: so a hang dies fast; ' +
            'a slow peer is worse than a fast error',
      });
    }
    return violations;
  },
};
