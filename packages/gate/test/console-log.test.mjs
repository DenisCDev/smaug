// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'console-log';

test('console.log in source is flagged', () => {
  const v = ofRule(run('src/a.ts', 'console.log(user);'), R);
  assert.equal(v.length, 1);
});

test('console.debug/info/table/dir/trace are flagged too', () => {
  for (const method of ['debug', 'info', 'table', 'dir', 'trace']) {
    const v = ofRule(run('src/a.ts', `console.${method}(user);`), R);
    assert.equal(v.length, 1, method);
    assert.match(v[0].message, new RegExp(`console\\.${method}`));
  }
});

test('console.warn and console.error pass', () => {
  assert.equal(ofRule(run('src/a.ts', 'console.warn(x); console.error(y);'), R).length, 0);
});

test('console.log inside strings or comments passes', () => {
  const code = "const s = 'console.log(x)'; // console.log(y)";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('scripts, tests and config files are excluded', () => {
  assert.equal(ofRule(run('scripts/deploy.mjs', 'console.log("deploying");'), R).length, 0);
  assert.equal(ofRule(run('src/a.test.ts', 'console.log(1);'), R).length, 0);
  assert.equal(ofRule(run('next.config.mjs', 'console.log(1);'), R).length, 0);
  assert.equal(ofRule(run('packages/cli/bin/tool.mjs', 'console.log(1);'), R).length, 0);
});

// Regression (production app, jul/2026): the old message suggested console.warn as
// a fix, and 7 informational logs were mass-renamed to warnings just to pass.
test('the message never invites a blanket warn/error rename', () => {
  const [v] = ofRule(run('src/a.ts', 'console.log(user);'), R);
  assert.doesNotMatch(v.message, /use console\.warn/);
});

test('tools/ scripts are excluded like scripts/ and bin/', () => {
  assert.equal(ofRule(run('tools/reaccent.js', 'console.log(out);'), R).length, 0);
});
