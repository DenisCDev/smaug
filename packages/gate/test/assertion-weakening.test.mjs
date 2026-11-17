// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertionProfile, removedTests, testCounts, testInventory, weakenedTests } from '../src/assertion-weakening.mjs';

const BEFORE = `
import { expect, it } from 'vitest';
it('soma itens do carrinho', () => {
  expect(total([1, 2])).toBe(3);
  expect(total([])).toBe(0);
});
it("rejeita quantidade negativa", () => {
  expect(() => total([-1])).toThrow('quantidade inválida');
});
`;

/** What the turn's test files gained and no file claimed yet. @param {[string, number][]} [titles] @param {number} [unnamed] */
const landed = (titles = [], unnamed = 0) => ({ titles: new Map(titles), unnamed });

test('profile counts strong assertions per literal title', () => {
  assert.deepEqual(assertionProfile(BEFORE), [
    ['soma itens do carrinho', 2],
    ['rejeita quantidade negativa', 1],
  ]);
});

test('a deleted assertion in an existing test is reported at its line', () => {
  const after = BEFORE.replace('  expect(total([])).toBe(0);\n', '');
  const found = weakenedTests(assertionProfile(BEFORE), after);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 3);
  assert.match(found[0].message, /"soma itens do carrinho" lost 1 strong assertion\(s\) this turn \(2 → 1\)/);
});

test('loosening to an existence matcher counts as weakening', () => {
  for (const weak of ['toBeDefined()', 'toBeTruthy()', 'not.toBeNull()', 'not.toBeUndefined()']) {
    const after = BEFORE.replace('expect(total([])).toBe(0)', `expect(total([])).${weak}`);
    assert.equal(weakenedTests(assertionProfile(BEFORE), after).length, 1, weak);
  }
});

test('node:assert — assert.ok and bare assert are weak, equality is strong', () => {
  const before = "test('lista', () => {\n  assert.deepEqual(list(), [1]);\n  assert.strict.equal(size(), 1);\n});\n";
  assert.deepEqual(assertionProfile(before), [['lista', 2]]);
  const loosened = before.replace('assert.deepEqual(list(), [1])', 'assert.ok(list())');
  assert.equal(weakenedTests(assertionProfile(before), loosened).length, 1);
  const bare = before.replace('assert.strict.equal(size(), 1)', 'assert(size())');
  assert.equal(weakenedTests(assertionProfile(before), bare).length, 1);
});

test('expect.soft and expect.poll are expectations like any other', () => {
  const before = "test('mostra o total', async ({ page }) => {\n  await expect.soft(page.getByText('3')).toBeVisible();\n  await expect.poll(() => page.title()).toBe('Carrinho');\n});\ntest('abre o carrinho', async ({ page }) => {\n  await expect.soft(page.getByRole('dialog')).toBeVisible();\n});\n";
  assert.deepEqual(assertionProfile(before), [['mostra o total', 2], ['abre o carrinho', 1]]);
  const dropped = before.replace("  await expect.poll(() => page.title()).toBe('Carrinho');\n", '');
  assert.equal(weakenedTests(assertionProfile(before), dropped).length, 1);
  const deleted = before.slice(0, before.indexOf("test('abre"));
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), deleted), { lost: 1, titles: ['abre o carrinho'] }, 'a test holding only a soft expectation asserted something');
});

test('changed expected values, added assertions and new tests are not weakening', () => {
  const changedValue = BEFORE.replace('toBe(3)', 'toBe(4)');
  const added = BEFORE.replace('expect(total([])).toBe(0);', 'expect(total([])).toBe(0);\n  expect(total([5])).toBe(5);');
  const extraTest = BEFORE + "it('novo', () => { expect(1).toBe(1); });\n";
  for (const after of [changedValue, added, extraTest]) {
    assert.deepEqual(weakenedTests(assertionProfile(BEFORE), after), []);
  }
});

test('weakenedTests leaves deleted and renamed tests alone', () => {
  const deleted = BEFORE.replace(/it\("rejeita[\s\S]*?\n\}\);\n/, '');
  const renamed = BEFORE.replace('soma itens do carrinho', 'soma o carrinho').replace('  expect(total([])).toBe(0);\n', '');
  assert.deepEqual(weakenedTests(assertionProfile(BEFORE), deleted), []);
  assert.deepEqual(weakenedTests(assertionProfile(BEFORE), renamed), []);
});

const REJECTS_BLOCK = /it\("rejeita[\s\S]*?\n\}\);\n/;

test('a test gone from a file that now declares fewer tests is a removed test', () => {
  const profile = assertionProfile(BEFORE);
  const counts = testCounts(BEFORE);
  const deleted = BEFORE.replace(REJECTS_BLOCK, '');
  assert.deepEqual(removedTests(profile, counts, deleted), { lost: 1, titles: ['rejeita quantidade negativa'] });
  const commentedOut = BEFORE.replace(REJECTS_BLOCK, (block) => block.split('\n').map((line) => (line ? `// ${line}` : line)).join('\n'));
  assert.deepEqual(removedTests(profile, counts, commentedOut), { lost: 1, titles: ['rejeita quantidade negativa'] });
  assert.deepEqual(removedTests(profile, counts, null), { lost: 2, titles: ['soma itens do carrinho', 'rejeita quantidade negativa'] }, 'the whole file deleted');
});

test('a rename, a skip, a table, a moved test and an assertion-less test are not removals', () => {
  const profile = assertionProfile(BEFORE);
  const counts = testCounts(BEFORE);
  const none = { lost: 0, titles: [] };
  const renamed = BEFORE.replace('soma itens do carrinho', 'soma o carrinho');
  assert.deepEqual(removedTests(profile, counts, renamed), none, 'same number of tests');
  const skipped = BEFORE.replace("it('soma", "it.skip('soma");
  assert.deepEqual(removedTests(profile, counts, skipped), none, 'still declared: test-weakening reports the skip');
  const table = "import { expect, it } from 'vitest';\nit.each([[[1, 2], 3], [[], 0]])('soma %j', (items, sum) => {\n  expect(total(items)).toBe(sum);\n});\n";
  assert.deepEqual(removedTests(profile, counts, table), none, 'folded into a table: a rewrite');
  const loop = "import { expect, it } from 'vitest';\nfor (const [items, sum] of CASES) {\n  it(`soma ${items}`, () => {\n    expect(total(items)).toBe(sum);\n  });\n}\n";
  assert.deepEqual(removedTests(profile, counts, loop), none, 'folded into a loop with a computed title: a rewrite');
  const deleted = BEFORE.replace(REJECTS_BLOCK, '');
  assert.deepEqual(removedTests(profile, counts, deleted, landed([['rejeita quantidade negativa', 1]])), none, 'moved to another test file of the turn');
  const movedAndRenamed = deleted.replace('soma itens do carrinho', 'soma o carrinho');
  assert.deepEqual(removedTests(profile, counts, movedAndRenamed, landed([['rejeita quantidade negativa', 1]])), none, 'one moved, the other renamed: none removed');
  const hollow = BEFORE + "it('ainda sem asserção', () => { load(); });\n";
  assert.deepEqual(removedTests(assertionProfile(hollow), testCounts(hollow), BEFORE), none, 'a test with no strong assertion guarded nothing');
  const merged = "import { expect, it } from 'vitest';\nit('soma e rejeita', () => {\n  expect(total([1, 2])).toBe(3);\n  expect(total([])).toBe(0);\n  expect(() => total([-1])).toThrow('quantidade inválida');\n});\n";
  assert.deepEqual(removedTests(profile, counts, merged), none, 'two tests merged into one keep every assertion');
});

test('with one test renamed and one removed, every missing title is listed and one is counted', () => {
  const after = BEFORE.replace('soma itens do carrinho', 'soma o carrinho').replace(REJECTS_BLOCK, '');
  assert.deepEqual(removedTests(assertionProfile(BEFORE), testCounts(BEFORE), after), { lost: 1, titles: ['soma itens do carrinho', 'rejeita quantidade negativa'] });
});

test('testInventory counts modifiers and tables as declarations, and Playwright helpers as none', () => {
  const content = [
    "test.describe('checkout', () => {",
    "  test.beforeEach(async ({ page }) => { await page.goto('/'); });",
    "  test('pays', async ({ page }) => { await expect(page).toHaveURL(/paid/); });",
    "  test.skip('refunds', async () => {});",
    "  test.each([1, 2])('adds %i', (n) => { expect(n).toBeGreaterThan(0); });",
    "  await test.step('open', async () => {});",
    '});',
  ].join('\n');
  const { declared, untitled, titles } = testInventory(content);
  assert.deepEqual({ declared, untitled, titles: [...titles.keys()] }, { declared: 3, untitled: 1, titles: ['pays', 'refunds'] });
});

test('computed titles are skipped; pt-BR parens in strings do not shift counts', () => {
  const content = [
    'for (const c of cases) it(`caso ${c}`, () => { expect(f(c)).toBe(1); });',
    "it('mostra a) opção', () => {",
    "  expect(render('a) b')).toEqual('a) b');",
    "  expect(screen.getByText('(x')).toBeTruthy();",
    '});',
  ].join('\n');
  assert.deepEqual(assertionProfile(content), [['mostra a) opção', 1]]);
});

test('CRLF content profiles the same as LF', () => {
  assert.deepEqual(assertionProfile(BEFORE.replace(/\n/g, '\r\n')), assertionProfile(BEFORE));
});

test('chai chains resolve to their matcher', () => {
  const before = "it('chai', () => {\n  expect(a).to.deep.equal(b);\n  expect(c).to.be.true;\n});\n";
  assert.deepEqual(assertionProfile(before), [['chai', 2]]);
  const loosened = before.replace('to.deep.equal(b)', 'to.exist');
  assert.equal(weakenedTests(assertionProfile(before), loosened).length, 1);
});

test('a title repeated across describes is ambiguous and skipped', () => {
  const before = [
    "describe('pt', () => { it('formata', () => { expect(f('pt')).toBe('1,0'); }); });",
    "describe('en', () => { it('formata', () => { expect(f('en')).toBe('1.0'); }); });",
  ].join('\n');
  const deletedOne = before.split('\n')[0];
  assert.deepEqual(assertionProfile(before), []);
  assert.deepEqual(weakenedTests(assertionProfile(before), deletedOne), []);
});

test('a tagged-template table is a table: tests folded into one are a rewrite', () => {
  const tagged = "import { expect, it } from 'vitest';\nit.each`\n  items     | sum\n  ${[1, 2]} | ${3}\n  ${[]}     | ${0}\n`('soma $items', ({ items, sum }) => {\n  expect(total(items)).toBe(sum);\n});\n";
  const { declared, untitled } = testInventory(tagged);
  assert.deepEqual({ declared, untitled }, { declared: 1, untitled: 1 });
  assert.deepEqual(removedTests(assertionProfile(BEFORE), testCounts(BEFORE), tagged), { lost: 0, titles: [] });
});

test('a typed table, a describe table and a loop around one test are tables too', () => {
  const profile = assertionProfile(BEFORE);
  const counts = testCounts(BEFORE);
  const none = { lost: 0, titles: [] };
  const table = (/** @type {string} */ type) => `import { expect, it } from 'vitest';\nit.each<${type}>(CASES)('soma %j', (items, sum) => {\n  expect(total(items)).toBe(sum);\n});\n`;
  const described = "import { describe, expect, it } from 'vitest';\ndescribe.each([[[1, 2], 3], [[], 0]])('carrinho %j', (items, sum) => {\n  it('soma', () => {\n    expect(total(items)).toBe(sum);\n  });\n});\n";
  const looped = "import { expect, it } from 'vitest';\nfor (const [items, sum] of CASES) {\n  it('soma', () => {\n    expect(total(items)).toBe(sum);\n  });\n}\n";
  const mapped = "import { expect, it } from 'vitest';\nCASES.map(([items, sum]) => it('soma', () => {\n  expect(total(items)).toBe(sum);\n}));\n";
  const oneStatement = "import { expect, it } from 'vitest';\nfor (const [items, sum] of CASES)\n  it('soma', () => {\n    expect(total(items)).toBe(sum);\n  });\n";
  for (const [name, after] of Object.entries({
    typed: table('[number[], number]'),
    'a function type in the table type': table('[number[], (n: number) => number]'),
    'three levels of type arguments': table('[number[], Record<string, Array<number>>]'),
    described,
    looped,
    'a loop with no block': oneStatement,
    'a loop with no block, on one line': oneStatement.replace('CASES)\n  it(', 'CASES) it('),
    'a for await loop': looped.replace('for (', 'for await ('),
    'a while loop': looped.replace('for (const [items, sum] of CASES) {', 'while (CASES.length) {\n  const [items, sum] = CASES.pop();'),
    mapped,
    'a flatMap callback': mapped.replace('CASES.map(', 'CASES.flatMap('),
  })) {
    assert.deepEqual(removedTests(profile, counts, after), none, name);
  }
});

test('a loop that holds no test is no table: a test deleted beside it is still a removal', () => {
  const profile = assertionProfile(BEFORE);
  const counts = testCounts(BEFORE);
  const deleted = BEFORE.replace(REJECTS_BLOCK, '');
  const removed = { lost: 1, titles: ['rejeita quantidade negativa'] };
  for (const [name, after] of Object.entries({
    'in the body of the test that stays': deleted.replace('  expect(total([])).toBe(0);\n', '  [1, 2].forEach((n) => { total([n]); });\n'),
    'in a helper': deleted + 'function seed() {\n  for (let i = 0; i < 3; i++) rows.push(i);\n}\n',
    'in a hook': deleted + 'afterEach(() => { mocks.forEach((m) => m.mockReset()); });\n',
    'a describe table with no test in it': deleted + "describe.each(['pt', 'en'])('locale %s', () => {});\n",
    // The statement a loop repeats ends with its line; the test below is not in it.
    'a loop with no block, written without semicolons above the test that stays': deleted.replace("it('soma", "for (const n of [1, 2]) seed(n)\nit('soma"),
    'the tail of a do…while above the test that stays': deleted.replace("it('soma", "let n = 0\ndo { n++ } while (n < 3)\nit('soma"),
  })) {
    assert.deepEqual(removedTests(profile, counts, after), removed, name);
  }
});

test('a condition before the title leaves the test its title: one deleted beside it is still a removal', () => {
  const { declared, untitled, titles } = testInventory("it.skipIf(process.platform === 'win32')('soma', () => {});\ntest.runIf(HAS_DB)('grava', () => {});\n");
  assert.deepEqual({ declared, untitled, titles: [...titles.keys()] }, { declared: 2, untitled: 0, titles: ['soma', 'grava'] });
  const deleted = BEFORE.replace(REJECTS_BLOCK, '');
  for (const condition of ["it.skipIf(process.platform === 'win32')(", 'it.runIf(HAS_DB)(']) {
    const after = deleted.replace('it(', condition);
    assert.deepEqual(removedTests(assertionProfile(BEFORE), testCounts(BEFORE), after), { lost: 1, titles: ['rejeita quantidade negativa'] }, condition);
  }
});

test('a test is counted whatever declares it: a title two describes share, a modifier, a condition', () => {
  const suite = [
    "describe('GET /users', () => {",
    "  it('returns 401 without a token', async () => { expect((await get('/users')).status).toBe(401); });",
    "  it('lists users', async () => { expect((await get('/users', token)).body).toHaveLength(2); });",
    '});',
    "describe('POST /users', () => {",
    "  it('returns 401 without a token', async () => { expect((await post('/users')).status).toBe(401); });",
    "  it.concurrent('answers within the budget', async () => { expect(await timed(post)).toBeLessThan(200); });",
    "  it.runIf(HAS_DB)('persists the user', async () => { expect(await count()).toBe(1); });",
    '});',
    '',
  ].join('\n');
  const profile = assertionProfile(suite);
  const counts = testCounts(suite);
  const without = (/** @type {string} */ fragment) => suite.split('\n').filter((line) => !line.includes(fragment)).join('\n');
  assert.deepEqual(removedTests(profile, counts, without("post('/users')).status")), { lost: 1, titles: ['returns 401 without a token'] }, 'one of the two tests that share a title');
  assert.deepEqual(removedTests(profile, counts, without('it.concurrent(')), { lost: 1, titles: ['answers within the budget'] });
  assert.deepEqual(removedTests(profile, counts, without('it.runIf(')), { lost: 1, titles: ['persists the user'] });
  assert.deepEqual(removedTests(profile, counts, null), { lost: 5, titles: ['returns 401 without a token', 'lists users', 'answers within the budget', 'persists the user'] }, 'the whole file deleted');
  assert.deepEqual(removedTests(profile, counts, suite), { lost: 0, titles: [] }, 'nothing removed');
  const hollow = suite + "it.concurrent('boots', async () => { await boot(); });\n";
  assert.deepEqual(removedTests(assertionProfile(hollow), testCounts(hollow), without('it.runIf(')), { lost: 1, titles: ['persists the user'] }, 'the one gone with it asserted nothing');
});

test('one test moved to another file takes one test gone, not every test of that title', () => {
  const suite = [
    "describe('GET /users', () => { it('returns 401 without a token', async () => { expect((await get('/users')).status).toBe(401); }); });",
    "describe('POST /users', () => { it('returns 401 without a token', async () => { expect((await post('/users')).status).toBe(401); }); });",
    "it('lists users', async () => { expect(await list()).toHaveLength(2); });",
    '',
  ].join('\n');
  const onlyTheList = suite.split('\n').slice(2).join('\n');
  assert.deepEqual(removedTests(assertionProfile(suite), testCounts(suite), onlyTheList, landed([['returns 401 without a token', 1]])), { lost: 1, titles: ['returns 401 without a token'] }, 'the copy that moved nowhere');
  assert.deepEqual(removedTests(assertionProfile(suite), testCounts(suite), onlyTheList, landed([['returns 401 without a token', 2]])), { lost: 0, titles: [] }, 'both moved');
});

test('a test gained by one file takes one test gone, whichever file lost it', () => {
  const head = "import { expect, it } from 'vitest';\n";
  const kept = "it('lists users', async () => { expect(await list()).toHaveLength(2); });\n";
  const guarded = "it('returns 401 without a token', async () => { expect((await get('/users')).status).toBe(401); });\n";
  const table = "it.each([[1, 1], [2, 2]])('keeps %i', (n, want) => { expect(keep(n)).toBe(want); });\n";
  const removed = { lost: 1, titles: ['returns 401 without a token'] };
  const none = { lost: 0, titles: [] };
  // Two files lose the test and one file gains it once: the second loss is a removal.
  const before = head + kept + guarded;
  const one = landed([['returns 401 without a token', 1]]);
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + kept, one), none, 'the first file: its test moved');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + kept, one), removed, 'the second file: nothing is left for its test to have moved to');
  // The same by count, for tests with no title of their own.
  const tables = head + kept + table;
  const oneTable = landed([], 1);
  assert.deepEqual(removedTests(assertionProfile(tables), testCounts(tables), head + kept, oneTable), none, 'the first table moved');
  assert.deepEqual(removedTests(assertionProfile(tables), testCounts(tables), head + kept, oneTable), { lost: 1, titles: [], untitled: 1 }, 'the second table is gone');
  // A file that renamed its test declares as many as before: it takes nothing, so the test that left another file still moved.
  const renamedHere = landed([['returns 401 without a token', 1]]);
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + kept + guarded.replace('returns 401', 'answers 401'), renamedHere), none, 'renamed in place');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + kept, renamedHere), none, 'moved out of the other file');
  // One test fewer takes one test at most: of two titles gone here, one was renamed.
  const two = head + guarded + guarded.replace('returns 401 without a token', 'returns 403 for a guest');
  const both = landed([['returns 401 without a token', 1], ['returns 403 for a guest', 1]]);
  assert.deepEqual(removedTests(assertionProfile(two), testCounts(two), head + guarded.replace('returns 401 without a token', 'answers 401'), both), none, 'one moved, one renamed');
  assert.equal(both.titles.get('returns 403 for a guest'), 1, 'the test a second file gained is still there for the file that lost it');
  // The same cap for a table: the file has one test fewer, and the titled test already took its place.
  const mixed = head + guarded + table;
  const titledAndTable = landed([['returns 401 without a token', 1]], 1);
  assert.deepEqual(removedTests(assertionProfile(mixed), testCounts(mixed), head + "it('answers', () => { expect(answer()).toBe(1); });\n", titledAndTable), none, 'the titled test moved, the table became a test');
  assert.equal(titledAndTable.unnamed, 1, 'the table another file gained is still there');
  // A file that declares more tests than before lost none, whatever it rewrote: it takes nothing.
  const wide = head + "it.each([[1, 1], [2, 2]])('keeps %i', (n, want) => { expect(keep(n)).toBe(want); expect(keep(-n)).toBe(-want); });\n";
  const grown = landed([], 1);
  assert.deepEqual(removedTests(assertionProfile(wide), testCounts(wide), head + kept + "it('boots', () => { boot(); });\n", grown), none, 'a table rewritten as two tests');
  assert.equal(grown.unnamed, 1);
});

test('a table or a test with a computed title that is gone is counted, with no name to give', () => {
  const head = "import { expect, it } from 'vitest';\n";
  const titled = "it('soma itens', () => { expect(total([1, 2])).toBe(3); });\n";
  const table = "it.each([[[1, 2], 3], [[], 0]])('soma %j', (items, sum) => { expect(total(items)).toBe(sum); });\n";
  const tagged = "it.each`\n  items | sum\n  ${[1]} | ${1}\n`('soma $items', ({ items, sum }) => { expect(total(items)).toBe(sum); });\n";
  const computed = 'it(CASE_NAME, () => { expect(total([5])).toBe(5); });\n';
  for (const [name, unnamed] of Object.entries({ 'a table': table, 'a tagged table': tagged, 'a computed title': computed })) {
    const before = head + titled + unnamed;
    assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + titled), { lost: 1, titles: [], untitled: 1 }, name);
    assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), null), { lost: 2, titles: ['soma itens'], untitled: 1 }, `${name}, in a file deleted whole`);
    assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), before), { lost: 0, titles: [] }, `${name}, kept`);
  }
  // A table rewritten as tests with titles of their own is a rewrite, and one that asserted nothing guarded nothing.
  const unfolded = head + titled + "it('soma vazio', () => { expect(total([])).toBe(0); });\nit('soma um', () => { expect(total([1])).toBe(1); });\n";
  assert.deepEqual(removedTests(assertionProfile(head + titled + table), testCounts(head + titled + table), unfolded), { lost: 0, titles: [] });
  const hollow = head + titled + "it.each(CASES)('carrega %j', (c) => { load(c); });\n";
  assert.deepEqual(removedTests(assertionProfile(hollow), testCounts(hollow), head + titled), { lost: 0, titles: [] });
  const hollowOnly = head + "it.each(CASES)('carrega %j', (c) => { load(c); });\n";
  assert.deepEqual(removedTests(assertionProfile(hollowOnly), testCounts(hollowOnly), null), { lost: 0, titles: [] }, 'a deleted file whose tables asserted nothing');
  // Two tables gone and one test written in their place: one test fewer, so one is counted.
  const both = head + titled + table + tagged;
  const replaced = head + titled + "it('soma vazio', () => { expect(total([])).toBe(0); });\n";
  assert.deepEqual(removedTests(assertionProfile(both), testCounts(both), replaced), { lost: 1, titles: [], untitled: 1 });
});

test('a table or a test with a computed title moved to another test file of the turn is no removal', () => {
  const head = "import { expect, it } from 'vitest';\n";
  const titled = "it('soma itens', () => { expect(total([1, 2])).toBe(3); });\n";
  const table = "it.each([[[1, 2], 3], [[], 0]])('soma %j', (items, sum) => { expect(total(items)).toBe(sum); });\n";
  const computed = 'it(CASE_NAME, () => { expect(total([5])).toBe(5); });\n';
  const none = { lost: 0, titles: [] };
  const before = head + titled + table;
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + titled, landed([], 1)), none, 'the table landed in another file');
  const renamed = head + titled.replace('soma itens', 'soma os itens');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), renamed, landed([], 1)), none, 'and the test left behind was renamed');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), null, landed([['soma itens', 1]], 1)), none, 'the file renamed whole');
  const both = head + titled + table + computed;
  assert.deepEqual(removedTests(assertionProfile(both), testCounts(both), head + titled, landed([], 1)), { lost: 1, titles: [], untitled: 1 }, 'two gone, one landed: the other is a removal');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head, landed([], 1)), { lost: 1, titles: ['soma itens'] }, 'the table moved, the titled test deleted');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + table, landed([], 1)), { lost: 1, titles: ['soma itens'] }, 'a table gained elsewhere takes no titled test');
});

test('a Playwright test that calls the runner from its own body keeps its assertions, so its deletion is listed', () => {
  const head = "import { expect, test } from '@playwright/test';\n";
  const kept = "test('opens the page', async ({ page }) => {\n  await expect(page).toHaveURL(/pay/);\n});\n";
  const asserted = "await expect(page.getByText('Paid')).toBeVisible();";
  for (const body of [
    `test.skip(isMobile, 'no wallet on mobile');\n  ${asserted}`,
    `test.slow();\n  ${asserted}`,
    `test.setTimeout(60_000);\n  ${asserted}`,
    `test.info().annotations.push({ type: 'issue' });\n  ${asserted}`,
    `await test.step('pay', async () => {\n    ${asserted}\n  });`,
    `test.fixme(isMobile, 'broken on mobile');\n  ${asserted}`,
    `test.fail();\n  ${asserted}`,
    `test.fail(browserName === 'webkit', 'the sheet crashes');\n  ${asserted}`,
    "await test.expect(page).toHaveURL('/pay');",
  ]) {
    const before = `${head}${kept}test('charges the card once', async ({ page }) => {\n  ${body}\n});\n`;
    assert.deepEqual(assertionProfile(before), [['opens the page', 1], ['charges the card once', 1]], body);
    assert.equal(testInventory(before).declared, 2, body);
    assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), head + kept), { lost: 1, titles: ['charges the card once'] }, body);
  }
  // With a title, test.fail declares a test that is expected to fail: one more test, and a removal when it goes.
  const expected = `${head}${kept}test.fail('crashes on the old sheet', async ({ page }) => {\n  ${asserted}\n});\n`;
  assert.equal(testInventory(expected).declared, 2);
  assert.deepEqual(removedTests(assertionProfile(expected), testCounts(expected), head + kept), { lost: 1, titles: ['crashes on the old sheet'] });
});

test('text inside JSX does not end a test early: a stray parenthesis or a URL there closes nothing', () => {
  const test = (/** @type {string} */ title, /** @type {string} */ text) => `it('${title}', () => {\n  render(<p>${text}</p>);\n  expect(screen.getByRole('note')).toBeVisible();\n});\n`;
  for (const text of ['a) primeira', 'Feito :)', 'Falhou :(', 'veja https://example.com/ajuda']) {
    const before = test('shows the note', text) + test('shows the total', 'Total');
    assert.equal(testInventory(before).declared, 2, text);
    assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), test('shows the total', 'Total')), { lost: 1, titles: ['shows the note'] }, `${text}: deleted`);
    const reworded = test('shows the note', 'Pronto') + test('shows the total', 'Total');
    assert.deepEqual(removedTests(assertionProfile(reworded), testCounts(reworded), before), { lost: 0, titles: [] }, `${text}: nothing deleted`);
  }
});

test('a snapshot taken before titles were stored still lists what its profile held', () => {
  const deleted = BEFORE.replace(REJECTS_BLOCK, '');
  assert.deepEqual(removedTests(assertionProfile(BEFORE), { declared: 2, untitled: 0 }, deleted), { lost: 1, titles: ['rejeita quantidade negativa'] });
});

test('a Playwright annotation and a conditional alias declare no test, so they hide no removal', () => {
  const deleted = BEFORE.replace(REJECTS_BLOCK, '');
  for (const line of [
    "test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only');",
    "test.fixme(isMobile, 'Settings page does not work on mobile yet');",
    'test.skip();',
    'test.skip(Boolean(process.env.CI));',
    // The reason may be anything but a function: a constant, a property, a call.
    'test.skip(isWebkit, REASON);',
    'test.skip(isWebkit, reasons.webkit);',
    "test.fixme(isMobile, t('settings.mobile'));",
    'const dbTest = test.runIf(HAS_DB);',
    'const cases = it.each(ROWS);',
  ]) {
    assert.equal(testInventory(line).declared, 0, line);
    assert.deepEqual(removedTests(assertionProfile(BEFORE), testCounts(BEFORE), `${deleted}${line}\n`), { lost: 1, titles: ['rejeita quantidade negativa'] }, line);
  }
  const chained = testInventory("it.skipIf(IS_WINDOWS).concurrent('soma', () => { expect(1).toBe(1); });\n");
  assert.deepEqual({ declared: chained.declared, untitled: chained.untitled, titles: [...chained.titles.keys()] }, { declared: 1, untitled: 0, titles: ['soma'] });
  const skipped = testInventory("test.skip('refunds', async ({ page }) => { await expect(page).toHaveURL(/refunded/); });\n");
  assert.deepEqual({ declared: skipped.declared, titles: [...skipped.titles.keys()] }, { declared: 1, titles: ['refunds'] }, 'a skipped test is still a test');
  assert.equal(testInventory("it.skip('ainda por escrever');\n").declared, 1, 'a title with no body yet is a test too');
  assert.equal(testInventory('test.skip(titleFor(feature), async ({ page }) => { await expect(page).toHaveURL(/refunded/); });\n').declared, 1, 'a computed title with a body after it');
});

test('tests folded into a table that replaces a loop inside a test body are a rewrite', () => {
  const loopTest = "it('trata todos os casos', () => {\n  for (const c of CASES) expect(total(c.items)).toBe(c.sum);\n});\n";
  const before = BEFORE + loopTest;
  const table = "import { expect, it } from 'vitest';\nit.each(CASES)('caso %j', ({ items, sum }) => {\n  expect(total(items)).toBe(sum);\n});\n";
  assert.deepEqual(testInventory(before).untitled, 0, 'the loop is inside a test, around none');
  assert.deepEqual(removedTests(assertionProfile(before), testCounts(before), table), { lost: 0, titles: [] });
});
