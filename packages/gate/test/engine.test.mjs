// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule, testConfig } from './helpers.mjs';
import { analyzeContent } from '../src/engine.mjs';

test('smugan-ignore on the same line suppresses the rule', () => {
  const sql = 'create table x_things (\n  nome text -- smugan-ignore db-naming: mirrors a legacy external system\n);';
  assert.equal(ofRule(run('db/x.sql', sql), 'db-naming').length, 0);
});

test('smugan-ignore on the previous line suppresses the rule', () => {
  const code = '// smugan-ignore console-log: CLI output is the product here\nconsole.log("hi");';
  assert.equal(ofRule(run('src/a.ts', code), 'console-log').length, 0);
});

test('suppression with a short reason is itself a violation', () => {
  const code = '// smugan-ignore console-log: ok\nconsole.log("hi");';
  const v = run('src/a.ts', code);
  assert.equal(ofRule(v, 'smugan-ignore').length, 1);
  assert.equal(ofRule(v, 'console-log').length, 1); // not suppressed
});

test('smugan-ignore-file suppresses the whole file', () => {
  const code = '// smugan-ignore-file console-log: this module wraps console for the logger\nconsole.log(1);\nconsole.log(2);';
  assert.equal(ofRule(run('src/logger.ts', code), 'console-log').length, 0);
});

test('a disabled check reports nothing', () => {
  const v = run('db/x.sql', 'create table usuarios (id uuid);', { 'db-naming': false });
  assert.equal(ofRule(v, 'db-naming').length, 0);
});

test('BOM content is handled', () => {
  const bom = String.fromCharCode(0xfeff);
  const v = run('src/a.ts', bom + 'console.log(1);');
  assert.equal(ofRule(v, 'console-log').length, 1);
});

test('violations carry file, rule, line and severity', () => {
  const v = analyzeContent('src/a.ts', 'console.log(1);', testConfig());
  assert.equal(v.length, 1);
  assert.deepEqual(
    { file: v[0].file, rule: v[0].rule, line: v[0].line, severity: v[0].severity },
    { file: 'src/a.ts', rule: 'console-log', line: 1, severity: 'error' },
  );
});
