// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'dead-imports';

test('unused named import is flagged', () => {
  const code = "import { useState, useEffect } from 'react';\nexport const n = useState(0);";
  const v = ofRule(run('src/a.ts', code), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /useEffect/);
});

test('import used in JSX passes', () => {
  const code = "import { Button } from './ui';\nexport const App = () => <Button />;";
  assert.equal(ofRule(run('src/a.tsx', code), R).length, 0);
});

test('unused default import is flagged', () => {
  const code = "import lodash from 'lodash';\nexport const x = 1;";
  const v = ofRule(run('src/a.ts', code), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /lodash/);
});

test('namespace import usage counts', () => {
  const used = "import * as path from 'node:path';\nexport const p = path.join('a');";
  assert.equal(ofRule(run('src/a.ts', used), R).length, 0);
  const unused = "import * as path from 'node:path';\nexport const p = 'x';";
  assert.equal(ofRule(run('src/a.ts', unused), R).length, 1);
});

test('renamed import tracks the local name', () => {
  const code = "import { join as joinPath } from 'node:path';\nexport const p = joinPath('a', 'b');";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('type-only import used in an annotation passes', () => {
  const code = "import type { User } from './types';\nexport function f(u: User) { return u; }";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('side-effect imports are never flagged', () => {
  assert.equal(ofRule(run('src/a.ts', "import './globals.css';\nexport const x = 1;"), R).length, 0);
});

test('usage only inside a comment does not count', () => {
  const code = "import { helper } from './helper';\n// helper is great\nexport const x = 1;";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 1);
});

test('usage inside a template expression counts', () => {
  const code = "import { Button } from './ui';\nexport const css = `${Button} { color: red }`;";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('multi-line imports are parsed', () => {
  const code = "import {\n  alpha,\n  beta,\n} from './lib';\nexport const x = alpha;";
  const v = ofRule(run('src/a.ts', code), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /beta/);
});

test('names with $ are found where they are used', () => {
  for (const code of [
    "import { $ } from 'bun';\nawait $`ls`;",
    "import $ from 'jquery';\n$('#menu').hide();",
    "import { component$ } from '@builder.io/qwik';\nexport default component$(() => null);",
  ]) {
    assert.equal(ofRule(run('src/a.ts', code), R).length, 0, code);
  }
  for (const code of [
    "import { $ } from 'bun';\nexport const s = '$';",
    "import { $ } from 'bun';\nexport const listed = (dir: string) => `listed ${dir}`;",
  ]) {
    assert.equal(ofRule(run('src/a.ts', code), R).length, 1, code);
  }
});
