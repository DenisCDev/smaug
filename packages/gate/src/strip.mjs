// @ts-check
// Replaces comments and string contents with spaces, preserving length and
// line structure, so line-based checks never match inside strings or comments.
// Template literal ${...} expressions are preserved — they are code.

const SPACE = ' ';
// Reserved words an operand may follow: after one of them a `/` opens a regex,
// since a division there is a syntax error. A name that is only a keyword
// somewhere else (`from`, `of`) divides like any other.
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
// After these a quote glued to the word opens a string (`from'./x'`); glued to
// any other word it is an apostrophe in JSX text.
const STRING_KEYWORDS = new Set([...REGEX_KEYWORDS, 'import', 'from', 'export', 'default', 'of', 'extends']);

/**
 * @param {string} code
 * @returns {string} same-length string with comments/string contents blanked
 */
export function stripCode(code) {
  const out = code.split('');
  scan(code, out, 0, false);
  return out.join('');
}

/**
 * Blanks comments, string contents, regex bodies and template text from
 * `start` on. As a template expression (`inExpression`), stops at the `}`
 * that closes its `${`: the same reading as the rest of the file, so a quote
 * in a regex or a brace in a comment there cannot run away with the file.
 * @param {string} code @param {string[]} out @param {number} start @param {boolean} inExpression
 * @returns {number} index after the last character read
 */
function scan(code, out, start, inExpression) {
  const n = code.length;
  let i = start;
  let prev = ''; // last significant char, to distinguish regex from division
  let prevAt = -1;
  let depth = 0;

  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = SPACE;
    }
  };

  while (i < n) {
    const c = code[i];
    const next = code[i + 1];

    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let j = code.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    // An apostrophe glued to a word is text (JSX: "You're"), never a string.
    if (c === '"' || (c === "'" && !(isWordChar(code[i - 1]) && !keywordBefore(code, i, STRING_KEYWORDS)))) {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') {
        if (code[j] === '\\') j++;
        j++;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, n);
      prev = c;
      continue;
    }
    if (c === '`') {
      i = stripTemplate(code, out, i);
      prev = '`';
      continue;
    }
    if (c === '/' && regexCanStart(code, i, prev, prevAt)) {
      const end = scanRegex(code, i);
      if (end > i) {
        blank(i + 1, end);
        i = end + 1;
        prev = '/';
        continue;
      }
    }
    if (inExpression) {
      if (c === '{') depth++;
      else if (c === '}' && depth-- === 0) return i + 1;
    }
    if (!isSpace(c)) {
      prev = c;
      prevAt = i;
    }
    i++;
  }
  return n;
}

/** @param {string} c */
function isSpace(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

/** @param {string | undefined} c */
function isWordChar(c) {
  return c !== undefined && /[\w$]/.test(c);
}

/**
 * Whether a word of `keywords` ends right before `i`, spaces aside. A
 * property of that name (`theme.default`) is not the keyword.
 * @param {string} code @param {number} i @param {Set<string>} keywords
 */
function keywordBefore(code, i, keywords) {
  let end = i;
  while (end > 0 && (code[end - 1] === ' ' || code[end - 1] === '\t')) end--;
  let from = end;
  while (from > 0 && isWordChar(code[from - 1])) from--;
  return code[from - 1] !== '.' && keywords.has(code.slice(from, end));
}

/**
 * Whether the `/` at `i` can open a regex: after an operator or an opening
 * bracket, or after a keyword (`return /x/`). Not after `<` or `}`, where a
 * JSX closing tag (`</li>`) or a self-closing one (`size={2} />`) puts it, and
 * not after a postfix operator, which ends an operand: `price! / 100`,
 * `i++ / 2`.
 * @param {string} code @param {number} i @param {string} prev @param {number} prevAt index of `prev`
 */
function regexCanStart(code, i, prev, prevAt) {
  if (prev === '') return true;
  if (prev === '!') {
    const before = code[prevAt - 1];
    return !(before === ')' || before === ']' || (isWordChar(before) && !keywordBefore(code, prevAt, REGEX_KEYWORDS)));
  }
  if ((prev === '+' || prev === '-') && code[prevAt - 1] === prev) return false;
  if ('(,=:[&|?{;+-*%>~^'.includes(prev)) return true;
  return isWordChar(prev) && keywordBefore(code, i, REGEX_KEYWORDS);
}

/**
 * @param {string} code @param {number} start index of the opening `/`
 * @returns {number} index of the closing `/`, or -1 when it reads as division
 */
function scanRegex(code, start) {
  let inClass = false;
  for (let j = start + 1; j < code.length; j++) {
    const c = code[j];
    if (c === '\\') {
      j++;
    } else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j;
    else if (c === '\n') return -1;
  }
  return -1;
}

/**
 * Blanks a template literal starting at `start` (the backtick), preserving
 * any ${...} expression code (recursively). Returns index after the literal.
 * @param {string} code @param {string[]} out @param {number} start
 */
function stripTemplate(code, out, start) {
  const n = code.length;
  let i = start + 1;
  while (i < n) {
    const c = code[i];
    if (c === '\\') {
      if (out[i] !== '\n') out[i] = SPACE;
      if (i + 1 < n && out[i + 1] !== '\n') out[i + 1] = SPACE;
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && code[i + 1] === '{') {
      i = scan(code, out, i + 2, true);
      continue;
    }
    if (c !== '\n' && c !== '\r') out[i] = SPACE;
    i++;
  }
  return n;
}

/**
 * SQL variant: blanks `-- line comments`, `slash-star block comments` and
 * '...' string contents. Dollar-quoted bodies are kept (they contain DDL).
 * @param {string} sql
 */
export function stripSql(sql) {
  const out = sql.split('');
  const n = sql.length;
  let i = 0;
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = SPACE;
    }
  };
  while (i < n) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      let j = i;
      while (j < n && sql[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      let j = sql.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2; // escaped quote
          continue;
        }
        if (sql[j] === "'") break;
        j++;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, n);
      continue;
    }
    i++;
  }
  return out.join('');
}
