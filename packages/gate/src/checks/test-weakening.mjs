// @ts-check
// Frontier models game test suites when the goal is "make it pass": Anthropic
// system cards (Claude Sonnet 4.5, Opus 4.1) document hard-coded and
// mock-asserting tests; Anthropic's reward-hacking research documents killing
// the runner with a green exit. Only the forms detectable with high precision
// in a single file live here: disabled/focused tests, expected-to-fail markers,
// test bodies with no assertion at all, and process.exit in test files. Assertions removed or
// loosened (toEqual→toBeDefined) in an EXISTING test need the turn-start
// version: the stop hook compares it in ../assertion-weakening.mjs. Tests that
// assert mocks need judgment — a critic dimension. Accepted miss, for precision: a test whose
// assertions live entirely in an imported helper is flagged — suppress it
// with smugan-ignore.
import { CODE_FILE_RE } from '../functions.mjs';
import { stripCode } from '../strip.mjs';

export const TEST_PATH_RE = /\.(test|spec)\.|(^|\/)(tests?|__tests__|e2e)\//;
// `fail` (Playwright), `fails` (Vitest) and `failing` (Jest) turn a red test
// green without touching the behavior: the test passes because it fails.
// The marker may stand behind another modifier (`it.concurrent.fails`,
// `test.describe.serial.only`).
const MODIFIER_RE = /\b(describe|it|test)((?:\s*\.\s*(?:concurrent|sequential|shuffle|serial|parallel|describe))*)\s*\.\s*(skip|only|todo|fixme|fail|fails|failing)\b/g;
// Playwright takes the same calls on the object that describes the running
// test: `testInfo.skip()`, `test.info().fail()`.
const INFO_RE = /\b(?:testInfo|test\s*\.\s*info\s*\(\s*\))\s*\.\s*(skip|fixme|fail)\s*\(/g;
// node:test and Vitest take the same switches as an options argument:
// test('name', { skip: true }, fn), and Vitest `fails` with them. A computed
// value (`skip: isWindows`) is a platform decision, so only `true` or a reason
// string counts.
const OPTION_RE = /\b(describe|it|test|suite)\s*\(\s*(?:(['"`])[^'"`\n]*\2|[\w$.]+)\s*,\s*\{[^{}]*?\b(skip|only|todo|fails)\s*:\s*(?:true\b|['"`])/g;
// An assertion between two equal constants passes whatever the code does:
// the shape a test takes when it only has to turn green.
const CONSTANT = String.raw`(true|false|null|undefined|-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*"|\x60[^\x60$\n]*\x60|[A-Za-z_$][\w$]*)`;
const SAME_SIDES_RES = [
  new RegExp(String.raw`\bexpect\s*\(\s*${CONSTANT}\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*${CONSTANT}\s*\)`, 'dg'),
  new RegExp(String.raw`\bassert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(\s*${CONSTANT}\s*,\s*${CONSTANT}\s*[,)]`, 'dg'),
];
const ALWAYS_TRUE_RE = /\bexpect\s*\(\s*true\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)|\bexpect\s*\(\s*false\s*\)\s*\.\s*toBeFalsy\s*\(\s*\)|\bassert\s*(?:\.\s*ok\s*)?\(\s*true\s*[,)]/g;
// A file that counts its assertions (t.plan, { plan: n }, expect.assertions)
// uses a constant one to prove a callback ran — fastify's suite does it over
// a hundred times — so there it is not a hollow test.
const PLANNED_RE = /\.\s*plan\s*\(|\bplan\s*:\s*\d|\bexpect\s*\.\s*(?:assertions|hasAssertions)\s*\(/;
const ALIAS_RE = /\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(/g;
const BARE_TEST_RE = /\b(?:it|test)\s*\(/g;
const BLOCK_START_RE = /\b(?:it|test|describe)\s*(?:\(|\.\s*([\w$]+))/g;
// Calls on the runner that stand inside a test's own body and open no block
// (Playwright), `test.expect(…)` among them: the assertion itself.
const IN_BODY = new Set(['step', 'slow', 'setTimeout', 'info', 'expect']);
// Calls that declare a test or annotate the one they stand in, by their arguments.
const ANNOTATION = new Set(['skip', 'fixme', 'fail']);
const FUNCTION_START_RE = /^\s*(?:async\b\s*)?(?:function\b|\([^()]*\)\s*=>|[\w$]+\s*=>)/;
// Besides expect/assert: Vitest's type-level expectTypeOf/assertType, chai's
// `.should`, and Cypress, whose commands fail the test by themselves (`cy.get`
// on a missing element), so a body of `cy.` calls is asserted.
const ASSERTION_RE = /\bexpect\s*[.(]|\bassert\s*[.(]|\b(?:expectTypeOf|assertType)\s*[(<]|\.\s*should\s*[.(]|\bcy\s*\./;
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(\s*(?:0\s*)?\)/g;
const FOCUS = new Set(['only', 'fit', 'fdescribe']);
const EXPECTED_FAILURE = new Set(['fail', 'fails', 'failing']);

/** @param {string} path */
export const isTestPath = (path) => CODE_FILE_RE.test(path) && TEST_PATH_RE.test(path);

/**
 * Bare test blocks (it/test, not property calls like t.test) with the offset
 * where their body region starts and ends. A region runs to the next block
 * start, not the call's own `)`: JSX text and pt-BR strings carry stray parens
 * (an "a) opção" list item) that would truncate a paren-matched region and hide
 * a real assertion.
 * @param {string} stripped output of stripCode
 * @returns {{ at: number, from: number, to: number }[]}
 */
export function testBlocks(stripped) {
  const starts = blockStarts(stripped);
  /** @type {{ at: number, from: number, to: number }[]} */
  const blocks = [];
  /** @type {RegExpExecArray | null} */
  let m;
  BARE_TEST_RE.lastIndex = 0;
  while ((m = BARE_TEST_RE.exec(stripped)) !== null) {
    const at = m.index;
    if (precededByDot(stripped, at)) continue;
    blocks.push({ at, from: at + m[0].length, to: starts.find((o) => o > at) ?? stripped.length });
  }
  return blocks;
}

/**
 * The first argument of the call opened at `open` and how the second begins,
 * read without looking for the call's end: a test's body may hold JSX text,
 * where a stray parenthesis closes nothing.
 * @param {string} s @param {number} open @returns {[string?, string?]}
 */
function leadingArguments(s, open) {
  let depth = 0;
  for (let i = open + 1; i < s.length && i < open + 4000; i++) {
    if ('([{'.includes(s[i])) depth++;
    else if (')]}'.includes(s[i])) {
      if (depth === 0) return s.slice(open + 1, i).trim() ? [s.slice(open + 1, i)] : [];
      depth--;
    } else if (s[i] === ',' && depth === 0) return [s.slice(open + 1, i), s.slice(i + 1, i + 200)];
  }
  return [s.slice(open + 1, open + 200)];
}

/**
 * Playwright's `test.skip()`, `test.fixme()` and `test.fail()` also annotate
 * the tests around them: with no argument, with a condition
 * (`test.skip(isCI, reason)`) or with a callback
 * (`test.skip(({ browserName }) => …, reason)`). A call declares a test when
 * its first argument is a title or its second is a function.
 * @param {string} s stripped code @param {number} open the `(` of the call
 */
export function annotates(s, open) {
  const [first = '', second] = leadingArguments(s, open);
  return !/^\s*['"\x60]/.test(first) && (second === undefined || !FUNCTION_START_RE.test(second));
}

/**
 * Where each test or describe block starts, in order: what bounds the region
 * of the block before it. A call a test makes on the runner from its own body
 * starts none: `test.step(…)`, `test.slow()`, `test.expect(…)`, and
 * `test.skip(condition, reason)` or `test.fail()` where it annotates the test
 * it stands in.
 * @param {string} stripped
 */
export function blockStarts(stripped) {
  /** @type {number[]} */
  const starts = [];
  /** @type {RegExpExecArray | null} */
  let m;
  BLOCK_START_RE.lastIndex = 0;
  while ((m = BLOCK_START_RE.exec(stripped)) !== null) {
    if (precededByDot(stripped, m.index) || (m[1] !== undefined && IN_BODY.has(m[1]))) continue;
    if (m[1] !== undefined && ANNOTATION.has(m[1])) {
      const open = stripped.indexOf('(', m.index + m[0].length);
      if (open >= 0 && !stripped.slice(m.index + m[0].length, open).trim() && annotates(stripped, open)) continue;
    }
    starts.push(m.index);
  }
  return starts;
}

/** @param {string} name @param {string} kind */
function weakenMessage(name, kind) {
  if (FOCUS.has(kind)) return `${name} focuses this test and silently skips the rest of the suite — remove it before finishing`;
  if (EXPECTED_FAILURE.has(kind)) {
    return `${name} marks the test as expected to fail, so it passes while the behavior stays broken — fix the code, or smugan-ignore with the reason the failure is known`;
  }
  return `${name} disables the test — fix the code or delete the test deliberately; a skipped test hides the regression it was written to catch`;
}

/** True when the call is a property access (t.test, it.each(...)). @param {string} code @param {number} index */
function precededByDot(code, index) {
  for (let i = index - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ' ' || c === '\t') continue;
    return c === '.';
  }
  return false;
}

export default {
  name: 'test-weakening',
  /** @param {string} path */
  appliesTo: isTestPath,
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const stripped = stripCode(content);
    const lineOf = (/** @type {number} */ i) => stripped.slice(0, i).split('\n').length;
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    /** @type {RegExpExecArray | null} */
    let m;

    while ((m = MODIFIER_RE.exec(stripped)) !== null) {
      violations.push({ line: lineOf(m.index), message: weakenMessage(`${m[1]}${m[2].replace(/\s+/g, '')}.${m[3]}`, m[3]) });
    }
    while ((m = INFO_RE.exec(stripped)) !== null) {
      violations.push({ line: lineOf(m.index), message: weakenMessage(m[0].replace(/\s+/g, '').slice(0, -1), m[1]) });
    }
    while ((m = ALIAS_RE.exec(stripped)) !== null) {
      violations.push({ line: lineOf(m.index), message: weakenMessage(m[1], m[1]) });
    }
    while ((m = OPTION_RE.exec(stripped)) !== null) {
      violations.push({ line: lineOf(m.index), message: weakenMessage(`${m[1]}() with { ${m[3]} }`, m[3]) });
    }
    const tautology = 'assertion compares a constant with itself and passes whatever the code does — assert the result of the code under test';
    const planned = PLANNED_RE.test(stripped);
    for (const re of planned ? [] : SAME_SIDES_RES) {
      while ((m = re.exec(stripped)) !== null) {
        const [left, right] = [1, 2].map((g) => {
          const [from, to] = /** @type {[number, number][]} */ (m?.indices)[g];
          return content.slice(from, to);
        });
        // Original text, not the stripped copy: string contents are blanked there.
        if (left === right || (/^['"`]/.test(left) && /^['"`]/.test(right) && left.slice(1, -1) === right.slice(1, -1))) {
          violations.push({ line: lineOf(m.index), message: tautology });
        }
      }
    }
    while (!planned && (m = ALWAYS_TRUE_RE.exec(stripped)) !== null) {
      violations.push({ line: lineOf(m.index), message: tautology });
    }
    // A missed empty test beats a false alarm on a genuinely-asserted one.
    for (const { at, from, to } of testBlocks(stripped)) {
      if (ASSERTION_RE.test(stripped.slice(from, to))) continue;
      violations.push({
        line: lineOf(at),
        message:
          'test body has no assertion (no expect/assert) — a test that asserts nothing proves nothing; ' +
          'assert real behavior, or suppress if the assertions live in an imported helper',
      });
    }
    while ((m = PROCESS_EXIT_RE.exec(stripped)) !== null) {
      violations.push({
        line: lineOf(m.index),
        message: 'process.exit() inside a test file can kill the runner and fake a green run — let the test runner own the process',
      });
    }
    return violations;
  },
};
