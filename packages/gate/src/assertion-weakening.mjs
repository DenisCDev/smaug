// @ts-check
// Coding agents that cannot make a test pass tend to edit the test instead:
// in ImpossibleBench (Zhong, Raghunathan & Carlini, arXiv 2510.20270) over 79%
// of Claude-model cheating was test modification, and LLM monitors caught only
// 42–65% of it on SWE-bench-style tasks. The per-file `test-weakening` check
// sees one version of a file, so it cannot tell a removed assertion from one
// that never existed. This module compares an EXISTING test against its
// turn-start version: for every test title present in both, a drop in strong
// assertions (deleted, or loosened to toBeDefined/toBeTruthy/assert.ok) is a
// finding. The stop hook only asks when the same turn also changed production
// code — editing tests alone is a legitimate task of its own.
// A test that is gone lost every assertion it had: when the file also declares
// fewer tests than at the turn's start, the missing titles are listed too
// (removedTests), once, because a requested removal looks the same.
// Accepted misses, for precision: renamed tests, it.each tables, changed
// expected VALUES (a legitimate behavior change looks identical — critic
// territory), and assertions living in helpers.
import { matching, matchingAngle } from './functions.mjs';
import { stripCode } from './strip.mjs';
import { annotates, blockStarts, testBlocks } from './checks/test-weakening.mjs';

const MAX_TITLE = 200;
// Playwright and Vitest also write it as expect.soft(…), which lets the test
// run on after a failure, and expect.poll(…), which retries: the same expectation.
const EXPECT_RE = /\bexpect(?:\s*\.\s*(?:soft|poll))?\s*\(/g;
const ASSERT_RE = /\bassert((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
// Chain words that carry no expectation by themselves (jest/vitest/chai).
const CHAIN = new Set([
  'not', 'resolves', 'rejects', 'to', 'be', 'been', 'is', 'that', 'which', 'and',
  'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'deep',
  'nested', 'own', 'ordered', 'any', 'all', 'soft',
]);
// Matchers that pass for almost any value: they prove existence, not behavior.
const WEAK = new Set(['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'ok', 'exist']);
const WEAK_WHEN_NEGATED = new Set(['toBeNull', 'toBeUndefined', 'null', 'undefined']);
const WEAK_ASSERT = new Set(['', 'ok', 'strict']);

/** Offset just past the `)` closing the paren opened at `open`, bounded. @param {string} s @param {number} open @param {number} end */
function closeParen(s, open, end) {
  let depth = 0;
  for (let i = open; i < end; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Identifiers of the `.a.b.c` chain starting at `i`. @param {string} s @param {number} i @param {number} end */
function chainAfter(s, i, end) {
  /** @type {string[]} */
  const words = [];
  const re = /\s*\.\s*([A-Za-z_$][\w$]*)/y;
  re.lastIndex = i;
  /** @type {RegExpExecArray | null} */
  let m;
  while (re.lastIndex < end && (m = re.exec(s)) !== null) words.push(m[1]);
  return words;
}

/** Strong assertions in one test body region of stripped code. @param {string} s @param {number} from @param {number} to */
function strongAssertions(s, from, to) {
  const region = s.slice(0, to);
  let strong = 0;
  /** @type {RegExpExecArray | null} */
  let m;
  EXPECT_RE.lastIndex = from;
  while ((m = EXPECT_RE.exec(region)) !== null) {
    const after = closeParen(region, m.index + m[0].length - 1, to);
    if (after < 0) continue;
    const words = chainAfter(region, after, to);
    const matcher = words.find((w) => !CHAIN.has(w));
    const negated = words.includes('not');
    if (!matcher || WEAK.has(matcher) || (negated && WEAK_WHEN_NEGATED.has(matcher))) continue;
    strong++;
  }
  ASSERT_RE.lastIndex = from;
  while ((m = ASSERT_RE.exec(region)) !== null) {
    const method = m[1].split('.').map((w) => w.trim()).filter(Boolean).pop() ?? '';
    if (!WEAK_ASSERT.has(method)) strong++;
  }
  return strong;
}

/**
 * The literal title of a test call, or null when it is computed (variable,
 * template with ${…}) — a title that cannot be read cannot be matched safely.
 * @param {string} content @param {string} stripped @param {number} from
 */
function titleAt(content, stripped, from) {
  let i = from;
  while (i < stripped.length && /\s/.test(stripped[i])) i++;
  const quote = content[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  const close = stripped.indexOf(quote, i + 1);
  if (close < 0) return null;
  const title = content.slice(i + 1, close);
  if (quote === '`' && title.includes('${')) return null;
  return title.slice(0, MAX_TITLE);
}

/**
 * Strong-assertion count per literal test title, with the line of its
 * declaration. A title declared more than once (the same `it('renders')` under
 * several describes) is dropped: summing them made deleting one whole test
 * read as an assertion lost by the survivor.
 * @param {string} content
 * @returns {Map<string, { strong: number, line: number }>}
 */
function profileWithLines(content) {
  const body = content.replace(/\r\n/g, '\n');
  const stripped = stripCode(body);
  /** @type {Map<string, { strong: number, line: number }>} */
  const profile = new Map();
  /** @type {Set<string>} */
  const repeated = new Set();
  for (const { at, from, to } of testBlocks(stripped)) {
    const title = titleAt(body, stripped, from);
    if (title === null) continue;
    if (profile.has(title)) repeated.add(title);
    else profile.set(title, { strong: strongAssertions(stripped, from, to), line: stripped.slice(0, at).split('\n').length });
  }
  for (const title of repeated) profile.delete(title);
  return profile;
}

/**
 * Compact turn-start snapshot: [title, strong assertions][].
 * @param {string} content @returns {[string, number][]}
 */
export function assertionProfile(content) {
  return [...profileWithLines(content)].map(([title, { strong }]) => [title, strong]);
}

// A test declaration whatever modifier it carries: it('x'), it.skip('x'),
// it.each(table)('x'), test.concurrent.only('x'), Playwright's
// test.fail('x'). Its test.describe, test.step and test.use declare no test.
const DECLARED_RE = /(?<![.\w$])(?:it|test)(?:\s*\.\s*(?:skip|only|todo|fixme|fail|fails|failing|concurrent|sequential|each|for|skipIf|runIf))*(?=\s*[(<\x60])/g;
// What makes a declaration inside it stand for many tests: a describe table,
// the body of a `for` or `while` loop, a `forEach` or `map` callback.
const REPEATER_RE = /(?<![.\w$])(describe)(?:\s*\.\s*[\w$]+)*\s*\.\s*(?:each|for)\b|(?<![.\w$])(for|while)\s*(?:await\s*)?\(|\.\s*(?:forEach|map|flatMap)\s*\(/g;

/** @param {string} s @param {number} i */
function skipSpace(s, i) {
  while (i >= 0 && i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/**
 * The `(` that opens the arguments following at `i`, past type arguments
 * (`it.each<[string, () => void]>(…)`) and a table written as a tagged
 * template, whose text is blank in the stripped copy.
 * @param {string} s @param {number} i
 * @returns {{ open: number, tagged: boolean } | null}
 */
function argumentsAfter(s, i) {
  i = skipSpace(s, i);
  if (s[i] === '<') i = skipSpace(s, matchingAngle(s, i));
  const tagged = s[i] === '\x60';
  if (tagged) {
    const close = s.indexOf('\x60', i + 1);
    if (close < 0) return null;
    i = skipSpace(s, close + 1);
  }
  return s[i] === '(' ? { open: i, tagged } : null;
}

/** Where the statement starting at `i` ends: its `;` or its line end, past the brackets it opens. @param {string} s @param {number} i */
function statementEnd(s, i) {
  while (i < s.length && s[i] !== ';' && s[i] !== '\n') {
    const past = '([{'.includes(s[i]) ? matching(s, i) : i + 1;
    if (past < 0) break; // a bracket that never closes repeats nothing past it
    i = past;
  }
  return i;
}

/**
 * Where a describe table, the body of a `for` loop or a `forEach`/`map`
 * callback runs. Only a declaration in there is repeated: a loop in a test
 * body, a helper or a hook holds none, and must not make the file look like a
 * table, or a test deleted beside it would pass for a rewrite. A helper that
 * declares the test and is called from a loop is not followed: tests folded
 * that way are listed once.
 * @param {string} s stripped code @returns {[number, number][]}
 */
function repeatedSpans(s) {
  /** @type {[number, number][]} */
  const spans = [];
  for (const m of s.matchAll(REPEATER_RE)) {
    let open = m.index + m[0].length - 1;
    if (m[1]) {
      // describe.each(table)('name', fn), or the table as a tagged template.
      const table = argumentsAfter(s, m.index + m[0].length);
      if (!table) continue;
      open = table.tagged ? table.open : skipSpace(s, matching(s, table.open));
      if (s[open] !== '(') continue;
    } else if (m[2]) {
      // The loop's block, or the one statement a `for` repeats. A `while`
      // with no block is the tail of a do…while, which repeats nothing after it.
      const body = skipSpace(s, matching(s, open));
      if (s[body] !== '{') {
        if (m[2] === 'for' && body > 0) spans.push([body - 1, statementEnd(s, body)]);
        continue;
      }
      open = body;
    }
    const end = matching(s, open);
    if (end > 0) spans.push([open, end]);
  }
  return spans;
}

/**
 * @typedef {{ declared: number, untitled: number, unnamed?: number, assertions?: number, titles?: [string, number, number][] }} TestCounts
 * How many tests a file declares; how many of them stand for more than one or
 * for none by name (`untitled`: a table, a computed title, a loop around the
 * test) and how many of those have no literal title at all (`unnamed`); the
 * strong assertions they hold in all; and each literal title with how many
 * tests carry it and how many of those assert something. A snapshot an older
 * version took has only the first two.
 */

/**
 * Index of the `(` of the call that follows the one closing at `i`, past any
 * `.modifier` between the two; -1 when none follows.
 * @param {string} s @param {number} i
 */
function nextCall(s, i) {
  const m = i < 0 ? null : /^\s*(?:\.\s*[\w$]+\s*)*(?=\()/.exec(s.slice(i, i + 200));
  return m ? i + m[0].length : -1;
}

/**
 * The tests a file declares, whatever form declares them: how many, how many
 * without a title of their own (an `each`/`for` table, a computed title, a
 * describe table or a loop around them), the strong assertions in all of
 * them, and every literal title with how many tests carry it and how many of
 * those assert something. A test runs to where the next test or describe
 * starts, as `testBlocks` reads it, not to the `)` of its own call.
 * @param {string} content
 * @returns {{ declared: number, untitled: number, unnamed: number, assertions: number, titles: Map<string, { count: number, strong: number }> }}
 */
export function testInventory(content) {
  const body = content.replace(/\r\n/g, '\n');
  const stripped = stripCode(body);
  const repeated = repeatedSpans(stripped);
  const starts = blockStarts(stripped);
  /** @type {Map<string, { count: number, strong: number }>} */
  const titles = new Map();
  let declared = 0;
  let untitled = 0;
  let unnamed = 0;
  let assertions = 0;
  for (const m of stripped.matchAll(DECLARED_RE)) {
    const args = argumentsAfter(stripped, m.index + m[0].length);
    if (!args) continue;
    // A table or a condition comes first and the test in the call after it:
    // it.each(rows)('title', fn), it.skipIf(c)('title', fn), it.skipIf(c).concurrent('title', fn).
    // With no call after it, `const dbTest = test.runIf(c)` only names a conditional test.
    const table = args.tagged || /(?:each|for)$/.test(m[0]);
    const call = !args.tagged && /(?:each|for|skipIf|runIf)$/.test(m[0]) ? nextCall(stripped, matching(stripped, args.open)) : args.open;
    if (call < 0 || (/(?:skip|fixme|fail)$/.test(m[0]) && annotates(stripped, call))) continue;
    declared++;
    const strong = strongAssertions(stripped, call + 1, starts.find((start) => start > m.index) ?? stripped.length);
    assertions += strong;
    // The literal after a table is a pattern for many titles.
    const title = table ? null : titleAt(body, stripped, call + 1);
    if (title === null) unnamed++;
    else {
      const entry = titles.get(title) ?? { count: 0, strong: 0 };
      titles.set(title, { count: entry.count + 1, strong: entry.strong + (strong > 0 ? 1 : 0) });
    }
    if (title === null || repeated.some(([from, to]) => m.index > from && m.index < to)) untitled++;
  }
  return { declared, untitled, unnamed, assertions, titles };
}

/** The turn-start snapshot of a test file. @param {string} content @returns {TestCounts} */
export function testCounts(content) {
  const { declared, untitled, unnamed, assertions, titles } = testInventory(content);
  return { declared, untitled, unnamed, assertions, titles: [...titles].map(([title, { count, strong }]) => [title, count, strong]) };
}

/**
 * Pre-existing tests with strong assertions that are gone, when the file also
 * declares fewer tests than before. A rename keeps the count, tests folded
 * into a table or a loop are a rewrite, tests merged into one keep their
 * assertions, and a test another test file gained in the turn (`landed`) was
 * moved: none of those is a removal. Every declaration counts: a title two
 * describes share, a test declared with a modifier, and a test with no title
 * of its own (a table, a computed title), which is counted and not named.
 * @param {[string, number][]} before the turn-start profile, read when the snapshot carries no titles
 * @param {TestCounts} was the turn-start counts
 * @param {string | null} content the file now; null when it was deleted
 * @param {{ titles: Map<string, number>, unnamed: number }} [landed] the tests the turn's test files gained and no
 *   file has claimed yet: how many of each literal title, and how many with no title of their own, which move by
 *   count. The ones this file's tests moved to are taken out of it, so the next file does not count them again.
 * @returns {{ lost: number, titles: string[], untitled?: number }} `titles`: every strong title gone;
 *   `untitled`: how many tests without a title of their own are gone; `lost`: how many tests were removed in all
 */
export function removedTests(before, was, content, landed = { titles: new Map(), unnamed: 0 }) {
  const none = { lost: 0, titles: [] };
  const now = content === null ? null : testInventory(content);
  const fewer = was.declared - (now?.declared ?? 0);
  if (fewer <= 0 || (now && now.untitled > was.untitled)) return none;
  if (now && content !== null) {
    const total = (/** @type {[string, number][]} */ profile) => profile.reduce((sum, [, n]) => sum + n, 0);
    if (was.assertions === undefined ? total(assertionProfile(content)) >= total(before) : now.assertions >= was.assertions) return none;
  }
  const had = Array.isArray(was.titles) ? was.titles : before.filter(([, strong]) => strong > 0).map(([title]) => /** @type {[string, number, number]} */ ([title, 1, 1]));
  // One entry per test gone: a title that asserted something and is declared fewer times now.
  const gone = had.flatMap(([title, count, strong]) => Array(Math.max(0, Math.min(strong, count - (now?.titles.get(title)?.count ?? 0)))).fill(title));
  // Each test another file gained under the same title takes one of them:
  // that one moved. No more of them than the file has fewer tests, or a test
  // renamed here would take the place of one that moved out of another file.
  let moved = 0;
  const kept = gone.filter((title) => {
    const left = landed.titles.get(title) ?? 0;
    if (left <= 0 || moved >= fewer) return true;
    landed.titles.set(title, left - 1);
    moved++;
    return false;
  });
  // A table or a computed title has no name to compare: fewer of them, in a
  // file that lost assertions, is a removal too, unless as many landed in
  // another test file of the turn.
  const unnamedGone = Math.max(0, (was.unnamed ?? 0) - (now?.unnamed ?? 0));
  const unnamedMoved = Math.min(unnamedGone, landed.unnamed, fewer - moved);
  landed.unnamed -= unnamedMoved;
  const unnamed = was.assertions === 0 ? 0 : unnamedGone - unnamedMoved;
  const lost = Math.min(fewer - moved - unnamedMoved, kept.length + unnamed);
  if (lost <= 0) return none;
  return { lost, titles: [...new Set(kept)], ...(unnamed > 0 ? { untitled: Math.min(unnamed, lost) } : {}) };
}

/**
 * Tests present before and now whose strong assertions dropped.
 * @param {[string, number][]} before @param {string} content
 * @returns {{ line: number, message: string }[]}
 */
export function weakenedTests(before, content) {
  const now = profileWithLines(content);
  /** @type {{ line: number, message: string }[]} */
  const found = [];
  for (const [title, was] of before) {
    const current = now.get(title);
    if (!current || current.strong >= was) continue;
    found.push({
      line: current.line,
      message:
        `test "${title}" lost ${was - current.strong} strong assertion(s) this turn (${was} → ${current.strong}) ` +
        'while production code changed — a test edited to agree with new code no longer guards the old behavior. ' +
        'Restore the assertion; if the requested behavior really changed, record why above the test: ' +
        '// smugan-ignore assertion-weakening: <reason>',
    });
  }
  return found;
}
