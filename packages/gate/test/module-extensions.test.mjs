// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.mjs';

// One violation of each JS/TS rule, in an ESM or CommonJS TypeScript module.
const SOURCE = [
  "import { unused } from './lib';",
  'export const value: any = 1;',
  'try { load(); } catch {}',
  'console.log(value);',
  'export const page = await fetch(url);',
  'const key = "AKIAABCDEFGHIJKLMNOP";',
].join('\n');

test('.mts and .cts modules get the same rules as .ts', () => {
  for (const path of ['src/a.mts', 'src/a.cts']) {
    const rules = new Set(run(path, SOURCE).map((v) => v.rule));
    for (const rule of ['dead-imports', 'no-any', 'empty-catch', 'console-log', 'fetch-timeout', 'secrets']) {
      assert.ok(rules.has(rule), `${path}: ${rule}`);
    }
  }
});

test('test-weakening covers .mts and .cts test files', () => {
  for (const path of ['test/a.test.mts', 'test/a.test.cts']) {
    const v = run(path, "test.only('adds', () => { assert.equal(add(1, 2), 3); });");
    assert.ok(v.some((x) => x.rule === 'test-weakening'), path);
  }
});

test('declaration files stay out of no-any and dead-imports', () => {
  for (const path of ['types/a.d.mts', 'types/a.d.cts']) {
    const rules = run(path, "import { Foo } from './foo';\nexport declare const value: any;").map((v) => v.rule);
    assert.deepEqual(rules.filter((r) => r === 'no-any' || r === 'dead-imports'), [], path);
  }
});
