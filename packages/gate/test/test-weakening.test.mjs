// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'test-weakening';

test('it.skip / test.skip / describe.skip are flagged as disabled', () => {
  for (const code of [
    "it.skip('adds', () => { expect(add(1, 2)).toBe(3); });",
    "test.skip('adds', () => { expect(add(1, 2)).toBe(3); });",
    "describe.skip('math', () => {});",
  ]) {
    const v = ofRule(run('src/math.test.ts', code), R);
    assert.equal(v.length, 1, code);
    assert.match(v[0].message, /disables the test/);
  }
});

test('it.only / fit / fdescribe are flagged as focused', () => {
  for (const code of [
    "it.only('adds', () => { expect(add(1, 2)).toBe(3); });",
    "fit('adds', () => { expect(add(1, 2)).toBe(3); });",
    "fdescribe('math', () => {});",
  ]) {
    const v = ofRule(run('src/math.test.ts', code), R);
    assert.equal(v.length, 1, code);
    assert.match(v[0].message, /skips the rest of the suite/);
  }
});

test('test.todo, xit and xdescribe are flagged', () => {
  const code = "test.todo('later');\nxit('a', () => {});\nxdescribe('b', () => {});";
  assert.equal(ofRule(run('tests/todo.spec.ts', code), R).length, 3);
});

test('Playwright test.describe.skip is caught via describe.skip', () => {
  const v = ofRule(run('e2e/flow.ts', "test.describe.skip('checkout', () => {});"), R);
  assert.equal(v.length, 1);
});

test('Playwright test.fixme is flagged as disabled', () => {
  const v = ofRule(run('e2e/flow.spec.ts', "test.fixme('checkout', async ({ page }) => { await expect(page).toHaveTitle(/Shop/); });"), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /disables the test/);
});

test('a test marked as expected to fail is flagged, whichever runner marks it: it passes because it fails', () => {
  for (const [code, name] of [
    ["test.fail('charges the card once', async ({ page }) => { await expect(page.getByText('Paid')).toBeVisible(); });", 'test.fail'],
    ["it.fails('adds', () => { expect(add(1, 2)).toBe(3); });", 'it.fails'],
    ["test.failing('adds', () => { expect(add(1, 2)).toBe(3); });", 'test.failing'],
    ["test('adds', { fails: true }, () => { expect(add(1, 2)).toBe(3); });", 'test() with { fails }'],
  ]) {
    const v = ofRule(run('src/math.test.ts', code), R);
    assert.equal(v.length, 1, code);
    assert.ok(v[0].message.startsWith(`${name} marks the test as expected to fail, so it passes while the behavior stays broken`), v[0].message);
  }
  // A known failure someone wrote down stays: the reason is on the line above.
  const known = "// smugan-ignore test-weakening: upstream bug 123, red until the driver is bumped\nit.fails('adds', () => { expect(add(1, 2)).toBe(3); });";
  assert.deepEqual(ofRule(run('src/math.test.ts', known), R), []);
  // A title, a property or another object's method that only holds the word marks nothing.
  for (const code of [
    "it('fails on a negative amount', () => { expect(() => pay(-1)).toThrow(); });",
    "test('counts', () => { expect(report.failing).toBe(0); });",
    "test('rejects', (t) => { if (!ok()) t.fail('unreachable'); assert.ok(ok()); });",
    "test('adds', { fails: isLegacy }, () => { expect(add(1, 2)).toBe(3); });",
  ]) {
    assert.deepEqual(ofRule(run('src/math.test.ts', code), R), [], code);
  }
});

test('a marker behind another modifier, or set on the info of the running test, is flagged under its own name', () => {
  const asserted = "expect(add(1, 2)).toBe(3);";
  for (const [code, message] of [
    [`it.concurrent.fails('adds', () => { ${asserted} });`, 'it.concurrent.fails marks the test as expected to fail'],
    [`it.sequential.skip('adds', () => { ${asserted} });`, 'it.sequential.skip disables the test'],
    [`describe.concurrent.skip('math', () => {});`, 'describe.concurrent.skip disables the test'],
    [`describe.shuffle.only('math', () => {});`, 'describe.shuffle.only focuses this test'],
    [`test.describe.serial.only('checkout', () => {});`, 'test.describe.serial.only focuses this test'],
    [`test.describe.parallel.only('checkout', () => {});`, 'test.describe.parallel.only focuses this test'],
    [`test('pays', async ({ page }, testInfo) => {\n  testInfo.fail();\n  ${asserted}\n});`, 'testInfo.fail marks the test as expected to fail'],
    [`test('pays', async ({ page }, testInfo) => {\n  testInfo.skip(isMobile, 'no wallet');\n  ${asserted}\n});`, 'testInfo.skip disables the test'],
    [`test('pays', async ({ page }) => {\n  test.info().fixme();\n  ${asserted}\n});`, 'test.info().fixme disables the test'],
    [`test('pays', async ({ page }) => {\n  test.info().fail(isWebkit, 'known');\n  ${asserted}\n});`, 'test.info().fail marks the test as expected to fail'],
  ]) {
    const v = ofRule(run('e2e/pay.spec.ts', code), R);
    assert.equal(v.length, 1, code);
    assert.ok(v[0].message.startsWith(message), `${code}: ${v[0].message}`);
  }
  // What the info object also offers and no test loses by.
  for (const call of ['testInfo.slow();', 'testInfo.setTimeout(60_000);', "test.info().annotations.push({ type: 'issue' });", "expect(testInfo.status).toBe('passed');", 'report.testInfo.failures.push(1);']) {
    const code = `test('pays', async ({ page }, testInfo) => {\n  ${call}\n  ${asserted}\n});`;
    assert.deepEqual(ofRule(run('e2e/pay.spec.ts', code), R), [], call);
  }
});

test('skip, todo and only passed as test options are flagged like the modifiers', () => {
  const disabled = [
    "test('adds', { skip: true }, () => { assert.equal(add(1, 2), 3); });",
    "it(name, { todo: 'after the refactor' }, () => { expect(add(1, 2)).toBe(3); });",
    "describe('math', { timeout: 500, skip: \"flaky\" }, () => {});",
  ];
  for (const code of disabled) {
    const v = ofRule(run('test/math.test.mjs', code), R);
    assert.equal(v.length, 1, code);
    assert.match(v[0].message, /disables the test/);
  }
  const focused = ofRule(run('test/math.test.mjs', "test('adds', { only: true }, () => { assert.equal(add(1, 2), 3); });"), R);
  assert.equal(focused.length, 1);
  assert.match(focused[0].message, /skips the rest of the suite/);
});

test('a computed or false skip option is a decision, not a disabled test', () => {
  const code = "test('symlinks', { skip: process.platform === 'win32' }, () => { assert.ok(link()); });\ntest('b', { skip: false }, () => { assert.ok(b()); });";
  assert.equal(ofRule(run('test/fs.test.mjs', code), R).length, 0);
});

test('an assertion between equal constants is flagged', () => {
  for (const code of [
    "it('works', () => { expect(true).toBe(true); });",
    "it('works', () => { expect('ok').toEqual(\"ok\"); });",
    "it('works', () => { const result = sum(); expect(result).toStrictEqual(result); });",
    "test('works', () => { assert.equal(1, 1); });",
    "test('works', () => { assert.ok(true, 'reached'); });",
    "test('works', () => { assert(true); });",
    "it('works', () => { expect(true).toBeTruthy(); });",
    "it('works', () => { expect(false).toBeFalsy(); });",
  ]) {
    const v = ofRule(run('src/a.test.ts', code), R);
    assert.equal(v.length, 1, code);
    assert.match(v[0].message, /compares a constant with itself/);
  }
});

test('in a file that counts its assertions, a constant one marks a reached callback and passes', () => {
  const planned = "test('runs the hook', (t) => {\n  t.plan(2);\n  app.addHook('onSend', () => { t.assert.ok(true, 'onSend called'); });\n  t.assert.equal(app.inject().statusCode, 200);\n});";
  const counted = "it('rejects', async () => {\n  expect.assertions(1);\n  try { await load(); } catch { expect(true).toBe(true); }\n});";
  assert.equal(ofRule(run('test/hooks.test.js', planned), R).length, 0);
  assert.equal(ofRule(run('src/load.test.ts', counted), R).length, 0);
});

test('assertions with a computed side or different constants pass', () => {
  const code = "it('a', () => { expect(sum(1, 2)).toBe(3); });\nit('b', () => { expect('a').not.toBe(other); assert.equal(total, 1); assert.ok(isReady); });";
  assert.equal(ofRule(run('src/a.test.ts', code), R).length, 0);
});

test('a healthy test with expect passes', () => {
  const code = "test('adds', () => { expect(add(1, 2)).toBe(3); });";
  assert.equal(ofRule(run('src/math.test.ts', code), R).length, 0);
});

test('a healthy test with node assert passes', () => {
  const code = "test('adds', () => { assert.equal(add(1, 2), 3); });\ntest('throws', () => { assert(ok); });";
  assert.equal(ofRule(run('test/math.test.mjs', code), R).length, 0);
});

test('a test body with no assertion is flagged', () => {
  const code = "test('adds', async () => {\n  const result = await add(1, 2);\n  console.log(result);\n});";
  const v = ofRule(run('src/math.test.ts', code), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
  assert.match(v[0].message, /no assertion/);
});

test('a pending test with no callback is flagged', () => {
  assert.equal(ofRule(run('src/math.test.ts', "it('handles negative numbers');"), R).length, 1);
});

test('unbalanced parens in JSX/pt-BR text do not fake a "no assertion" finding', () => {
  const code = "test('mostra as opções', () => {\n  render(<ul><li>a) primeira opção</li></ul>);\n  expect(screen.getByText(/opção/)).toBeVisible();\n});";
  assert.equal(ofRule(run('src/Faq.test.tsx', code), R).length, 0);
});

test('a call a Playwright test makes on the runner from its own body does not end it', () => {
  const head = "import { expect, test } from '@playwright/test';\n";
  const asserted = "await expect(page.getByText('Paid')).toBeVisible();";
  for (const first of ['test.slow();', 'test.setTimeout(60_000);', "test.info().annotations.push({ type: 'issue', description: 'PAY-1' });"]) {
    const code = `${head}test('charges the card once', async ({ page }) => {\n  ${first}\n  ${asserted}\n});\n`;
    assert.deepEqual(ofRule(run('e2e/pay.spec.ts', code), R), [], first);
  }
  const stepped = `${head}test('charges the card once', async ({ page }) => {\n  await test.step('pay', async () => {\n    ${asserted}\n  });\n});\n`;
  assert.deepEqual(ofRule(run('e2e/pay.spec.ts', stepped), R), []);
  // The assertion written through the runner is one.
  const throughTheRunner = `${head}test('charges the card once', async ({ page }) => {\n  await page.goto('/pay');\n  await test.expect(page).toHaveURL('/pay');\n});\n`;
  assert.deepEqual(ofRule(run('e2e/pay.spec.ts', throughTheRunner), R), []);
  // With a title, test.fail declares a test of its own: the one before it ends there.
  const declared = `${head}test('opens the page', async ({ page }) => {\n  await page.goto('/pay');\n});\ntest.fail('crashes on the old sheet', async ({ page }) => {\n  ${asserted}\n});\n`;
  const found = ofRule(run('e2e/pay.spec.ts', declared), R);
  assert.deepEqual(found.filter((v) => /no assertion/.test(v.message)).map((v) => v.line), [2]);
  assert.deepEqual(found.filter((v) => /expected to fail/.test(v.message)).map((v) => v.line), [5]);
  // A call that skips the test it stands in, or marks it as expected to fail, is reported as that and as nothing
  // else: its body still asserts.
  for (const [first, reported] of /** @type {[string, RegExp][]} */ ([
    ["test.skip(isMobile, 'no wallet on mobile');", /^test\.skip disables the test/],
    ['test.fail();', /^test\.fail marks the test as expected to fail/],
    ["test.fail(browserName === 'webkit', 'the sheet crashes');", /^test\.fail marks the test as expected to fail/],
  ])) {
    const annotated = `${head}test('charges the card once', async ({ page }) => {\n  ${first}\n  ${asserted}\n});\n`;
    const reports = ofRule(run('e2e/pay.spec.ts', annotated), R);
    assert.equal(reports.length, 1, first);
    assert.equal(reports[0].line, 3, first);
    assert.match(reports[0].message, reported);
  }
  // Nothing asserted is still nothing asserted, and the next test still ends the one before it.
  const hollow = `${head}test('opens the page', async ({ page }) => {\n  test.slow();\n  await page.goto('/pay');\n});\ntest('charges the card once', async ({ page }) => {\n  ${asserted}\n});\n`;
  const v = ofRule(run('e2e/pay.spec.ts', hollow), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
  assert.match(v[0].message, /no assertion/);
});

test('an empty test before a real one is flagged exactly once, on the empty one', () => {
  const code = "test('todo later', () => {});\ntest('adds', () => { expect(add(1, 2)).toBe(3); });";
  const v = ofRule(run('src/math.test.ts', code), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
});

test('test.skip is one finding, not also an assertion-less finding', () => {
  const v = ofRule(run('src/a.test.ts', "test.skip('x', () => {});"), R);
  assert.equal(v.length, 1);
});

test('assertions hidden in a local helper are flagged — accepted miss, use smugan-ignore', () => {
  const code = "test('adds', () => { expectValidSum(add(1, 2)); });";
  assert.equal(ofRule(run('src/math.test.ts', code), R).length, 1);
});

test('expect.soft and t.assert count as assertions', () => {
  const soft = "test('adds', () => { expect.soft(v).toBe(3); });";
  const sub = "test('adds', (t) => { t.assert.equal(v, 3); });";
  assert.equal(ofRule(run('src/a.test.ts', soft), R).length, 0);
  assert.equal(ofRule(run('src/a.test.ts', sub), R).length, 0);
});

test('Cypress commands, chai should and type-level assertions count as assertions', () => {
  for (const [path, code] of [
    ['cypress/e2e/login.cy.ts', "it('logs in', () => {\n  cy.visit('/');\n  cy.get('h1').should('contain', 'Hi');\n});"],
    ['cypress/e2e/nav.cy.ts', "it('opens the menu', () => {\n  cy.visit('/');\n  cy.contains('Menu').click();\n});"],
    ['test/sum.test.js', "it('adds', () => { sum(1, 2).should.equal(3); });"],
    ['src/types.test.ts', "test('types', () => { expectTypeOf(parse).toBeFunction(); });"],
    ['src/types.test.ts', "test('types', () => { assertType<string>(parse('a')); });"],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('property calls like t.test() are not scanned for assertions', () => {
  const code = "test('outer', async (t) => {\n  assert.ok(setup());\n  await t.test('inner', () => { assert.equal(v, 1); });\n});";
  assert.equal(ofRule(run('test/a.test.mjs', code), R).length, 0);
});

test('process.exit(0) and bare process.exit() in a test file are flagged', () => {
  const code = "test('a', () => { assert.ok(1); process.exit(0); });\nprocess.exit();";
  assert.equal(ofRule(run('tests/setup.ts', code), R).length, 2);
});

test('process.exit(1) is not flagged', () => {
  const code = "test('a', () => { assert.ok(1); });\nif (failed) process.exit(1);";
  assert.equal(ofRule(run('tests/runner-shim.ts', code), R).length, 0);
});

test('skip/only inside strings and comments are ignored', () => {
  const code = "// it.skip('a', () => {})\nconst s = 'test.only(x)';\ntest('real', () => { expect(s).toBeDefined(); });";
  assert.equal(ofRule(run('src/a.test.ts', code), R).length, 0);
});

test('non-test files are not checked', () => {
  const code = "it.skip('a', () => {});\ntest('b', () => {});";
  assert.equal(ofRule(run('src/app/page.tsx', code), R).length, 0);
  assert.equal(ofRule(run('src/lib/utils.ts', code), R).length, 0);
});

test('applies across test path conventions', () => {
  const code = "it.skip('a', () => {});";
  for (const path of ['src/a.test.ts', 'src/a.spec.tsx', 'tests/a.ts', '__tests__/a.js', 'e2e/a.mjs', 'supabase/tests/a.ts']) {
    assert.equal(ofRule(run(path, code), R).length, 1, path);
  }
});

test('smugan-ignore suppresses with a written reason', () => {
  const code = "// smugan-ignore test-weakening: flaky upstream API, tracked in issue #42\nit.skip('syncs with the billing API', () => { expect(add(1, 2)).toBe(3); });";
  assert.equal(ofRule(run('src/a.test.ts', code), R).length, 0);
});
