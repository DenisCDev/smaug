// @ts-check
// Functions of a JS/TS file found by text: declarations, function and arrow
// expressions assigned to a name, a property or a class field, the anonymous
// default export, and methods. Strings and comments are blanked first
// (stripCode keeps offsets), so a brace inside either never moves a body's
// end. Expression-bodied arrows have no block and are left out.
import { stripCode } from './strip.mjs';

export const CODE_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/** @typedef {{ name: string, params: string[], line: number, start: number, bodyStart: number, end: number }} FunctionSpan */

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try', 'new', 'typeof', 'await', 'yield', 'constructor']);

/** Index just past the bracket that closes the one at `open`, or -1. @param {string} s @param {number} open */
export function matching(s, open) {
  const pairs = /** @type {Record<string, string>} */ ({ '(': ')', '{': '}', '[': ']' });
  const close = pairs[s[open]];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * A parameter list without its decorators. A decorator is a call in front of
 * the parameter, and its arguments may nest calls of their own:
 * `@UploadedFile(new ParseFilePipe({ validators: [new MaxSize({ max: 1 })] })) file`.
 * @param {string} list
 */
function withoutDecorators(list) {
  let out = '';
  for (let i = 0; i < list.length;) {
    const decorator = list[i] === '@' ? /^@[\w$.]+\s*/.exec(list.slice(i, i + 200)) : null;
    if (!decorator) {
      out += list[i++];
      continue;
    }
    i += decorator[0].length;
    if (list[i] === '(') {
      const end = matching(list, i);
      i = end < 0 ? list.length : end;
    }
  }
  return out;
}

/** Parameter names, without types, defaults or destructuring. @param {string} list */
function paramNames(list) {
  let bare = withoutDecorators(list);
  // Type annotations name fields, not parameters: `post: { id: string }`, `items: { price: number }[]`.
  for (let before = ''; before !== bare;) { before = bare; bare = bare.replace(/:\s*\{[^{}]*\}(?:\s*\[\s*\])*/g, '').replace(/<[^<>]*>/g, ''); }
  bare = bare.replace(/:\s*[^,=)]+/g, '');
  // The first name may open a line of its own, as a wrapped list has it.
  return [...bare.matchAll(/(?:^\s*|[,({[]\s*)(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?=[,:=)}?\]]|$)/g)].map((m) => m[1]).filter((n) => !KEYWORDS.has(n));
}

/**
 * The body `{` after a parameter list ending at `from`. A declaration or a
 * method goes on with `{` or a return type, an arrow with `=>` or a return
 * type. Anything else (`||`, `.trim()`, a line end) makes it a call, so the
 * search never wanders into the next statement and takes its block.
 * @param {string} s @param {number} from @param {boolean} arrow
 */
function bodyAfter(s, from, arrow) {
  let i = from;
  while (s[i] === ' ' || s[i] === '\t') i++;
  if (s[i] === ':') {
    i = returnTypeEnd(s, i + 1, arrow);
    if (i < 0) return -1;
  }
  if (!arrow) return s[i] === '{' ? i : -1;
  return s[i] === '=' && s[i + 1] === '>' ? blockAfter(s, i + 2) : -1;
}

/** The `{` that opens an arrow's block after its `=>` ending at `i`; -1 for an expression body. @param {string} s @param {number} i */
function blockAfter(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return s[i] === '{' ? i : -1;
}

/** Index after the `>` that closes the `<` at `open`, or -1; the `>` of `=>` closes nothing. @param {string} s @param {number} open */
export function matchingAngle(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '<') depth++;
    else if (c === '>' && s[i - 1] !== '=' && --depth === 0) return i + 1;
    else if (c === '(' || c === '[' || c === '{') {
      const end = matching(s, i);
      if (end < 0) return -1;
      i = end - 1;
    } else if (c === ';') return -1;
  }
  return -1;
}

/**
 * Where the return type starting at `i` ends: the index of the body `{` of a
 * declaration, or of the `=>` of an arrow; -1 when neither follows. A `{`
 * where a type is still expected (after `:`, `|`, `&`, `=>`) is an object
 * type; one after a complete type is the body.
 * @param {string} s @param {number} i @param {boolean} arrow
 */
function returnTypeEnd(s, i, arrow) {
  let expecting = true;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r') continue;
    if (c === '\n') {
      if (expecting) continue;
      // A complete type at a line end: only a type going on (a union, the
      // branches of a conditional type) or the body may follow.
      const next = i + 1 + (/^\s*/.exec(s.slice(i + 1, i + 200))?.[0].length ?? 0);
      if (next < s.length && '|&?:'.includes(s[next])) { i = next - 1; continue; }
      if (arrow) return s[next] === '=' && s[next + 1] === '>' ? next : -1;
      return s[next] === '{' ? next : -1;
    }
    if (c === '=' && s[i + 1] === '>') {
      if (arrow && !expecting) return i;
      i++; // the arrow of a function type
      expecting = true;
    } else if (c === '{' && !expecting) return arrow ? -1 : i;
    else if (c === '(' || c === '[' || c === '{' || c === '<') {
      const end = c === '<' ? matchingAngle(s, i) : matching(s, i);
      if (end < 0) return -1;
      i = end - 1;
      expecting = false;
    } else if (c === ';' || c === ',' || c === ')' || c === ']' || c === '}' || c === '=') return -1;
    else if (c === '|' || c === '&' || c === '?' || c === ':' || c === '.') expecting = true;
    else if (/[A-Za-z_$]/.test(c)) {
      const word = /^[\w$]+/.exec(s.slice(i, i + 80))?.[0] ?? c;
      i += word.length - 1;
      expecting = TYPE_OPERATORS.has(word);
    } else expecting = false;
  }
  return -1;
}

// Words of a type that another type must follow.
const TYPE_OPERATORS = new Set(['keyof', 'typeof', 'readonly', 'unique', 'infer', 'asserts', 'is', 'extends', 'new', 'abstract']);

// Type parameters, one level of nesting included: `<T extends Record<string, unknown>>`.
const GENERICS = String.raw`(?:<(?:[^<>()]|<[^<>()]*>)*>)?`;
const DECLARATION_RE = new RegExp(String.raw`\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*${GENERICS}\s*\(`, 'g');
// The function a name receives, from the `=` on: a function expression (first
// group) or an arrow, whose parameters are a list or one bare name (second group).
const VALUE = String.raw`=\s*(?:async\b\s*)?(?:(function\b\s*\*?\s*[\w$]*\s*)?${GENERICS}\s*\(|([A-Za-z_$][\w$]*)\s*=>)`;
// A type annotation may wrap over lines, but never into the next statement:
// `let cached: Cache | null` with no semicolon is not the name of the function
// below it. A statement opens with a keyword and a name, or assigns to a name
// or a property; a member called `type:` and an `import('…')` type do neither.
// A line that assigns is still the annotation when the line above ends in a
// sign another type must follow: `Middleware<Ctx> &\n  Configurable = (ctx) => {`.
// Only the indentation is skipped after the line break: with `\s*` there, every
// blank line of a long comment was matched against all the blank lines below it.
const STATEMENT = String.raw`(?:export|const|let|var|function|class|import|type|interface|declare|async|return)[ \t]+[\w$*{'"\x60]`;
const ASSIGNMENT = String.raw`[\w$.#]+[ \t]*=(?![=>])`;
const ANNOTATION = String.raw`(?::(?:(?!\n[ \t]*(?:${STATEMENT})|(?<![&|:?][ \t]*)\n[ \t]*${ASSIGNMENT})[^=;])+)?`;
const ASSIGNED_RE = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*${ANNOTATION}${VALUE}`, 'g');
// A class field or a property assigned at the start of a line:
// `private save = async (x) => {`, `exports.handler = async (event) => {`.
const MEMBER_RE = new RegExp(String.raw`^[ \t]*(?:(?:public|private|protected|static|readonly|override|declare|accessor)\s+)*((?:[A-Za-z_$][\w$]*\.)*#?[A-Za-z_$][\w$]*)[?!]?[ \t]*(?::[^=;\n]+)?${VALUE}`, 'gm');
// `export default async function (req, res) {` and `export default (props) => {` have no name of their own.
const DEFAULT_RE = new RegExp(String.raw`\bexport\s+default\s+(?:async\b\s*)?(?:(function\b\s*\*?\s*)?${GENERICS}\s*\(|([A-Za-z_$][\w$]*)\s*=>)`, 'g');
// The name stays on the line of the `*`: with `\s*` there, every blank line of
// a long template literal was matched against all the blank lines below it.
const METHOD_RE = new RegExp(String.raw`^[ \t]*(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*\*?[ \t]*(#?[A-Za-z_$][\w$]*)\s*${GENERICS}\s*\(`, 'gm');

/** @param {string} code @returns {FunctionSpan[]} */
export function functionSpans(code) {
  const s = stripCode(code.replace(/\r\n/g, '\n'));
  const lineOf = (/** @type {number} */ i) => s.slice(0, i).split('\n').length;
  /** @type {FunctionSpan[]} */
  const spans = [];
  /** @param {string} name @param {number} start @param {string[]} params @param {number} bodyStart */
  const push = (name, start, params, bodyStart) => {
    const end = bodyStart < 0 ? -1 : matching(s, bodyStart);
    if (end >= 0) spans.push({ name, params, line: lineOf(start), start, bodyStart, end });
  };
  /** @param {string} name @param {number} start @param {number} paren @param {boolean} arrow */
  const add = (name, start, paren, arrow) => {
    const closeParen = matching(s, paren);
    if (closeParen >= 0) push(name, start, paramNames(s.slice(paren + 1, closeParen - 1)), bodyAfter(s, closeParen, arrow));
  };
  /** A match of VALUE: `keyword` is its function expression, `bare` the one parameter of an arrow without a list. @param {string} name @param {number} start @param {RegExpExecArray} m @param {string | undefined} keyword @param {string | undefined} bare */
  const assigned = (name, start, m, keyword, bare) => {
    const end = m.index + m[0].length;
    if (bare) push(name, start, [bare], blockAfter(s, end));
    else add(name, start, end - 1, !keyword);
  };
  /** Past the indentation a line-anchored match starts with. @param {RegExpExecArray} m */
  const lineStart = (m) => m.index + m[0].length - m[0].trimStart().length;
  /** Inside another function's parameter list: a default value, not a function of its own. @param {number} start */
  const inHeader = (start) => spans.some((f) => f.start <= start && start < f.bodyStart);
  for (const m of s.matchAll(DECLARATION_RE)) {
    add(m[1], m.index, m.index + m[0].length - 1, false);
  }
  for (const m of s.matchAll(ASSIGNED_RE)) assigned(m[1], m.index, m, m[2], m[3]);
  for (const m of s.matchAll(DEFAULT_RE)) assigned('default', m.index, m, m[1], m[2]);
  for (const m of s.matchAll(METHOD_RE)) {
    if (KEYWORDS.has(m[1])) continue;
    const start = lineStart(m);
    if (inHeader(start)) continue;
    add(m[1], start, m.index + m[0].length - 1, false);
  }
  for (const m of s.matchAll(MEMBER_RE)) {
    const start = lineStart(m);
    // `module.exports = function plugin() {` keeps the name the function gives itself.
    if (inHeader(start) || (m[2] && /function\b\s*\*?\s*[\w$]/.test(m[2]))) continue;
    assigned(m[1].slice(m[1].lastIndexOf('.') + 1), start, m, m[2], m[3]);
  }
  // A method match inside a call (`foo(bar) {` never closes a body) is
  // filtered by bodyAfter; the same span found twice is kept once.
  const seen = new Set();
  return spans.sort((a, b) => a.start - b.start).filter((f) => {
    const key = `${f.bodyStart}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Function names in `code`, for the turn-start snapshot. @param {string} code */
export function functionNames(code) {
  return [...new Set(functionSpans(code).map((f) => f.name))];
}
