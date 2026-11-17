// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCode } from '../src/strip.mjs';

/** The stripped copy with runs of spaces collapsed, for readable expectations. @param {string} code */
const squeezed = (code) => stripCode(code).split('\n').map((line) => line.replace(/ +/g, ' ').trimEnd());

test('the stripped copy keeps the length and the line structure', () => {
  const code = "const a = 'x'; // note\n/* block\n   comment */ const b = `t ${a} t`;\r\nconst c = /re[/]x/g;\n";
  const stripped = stripCode(code);
  assert.equal(stripped.length, code.length);
  assert.equal(stripped.split('\n').length, code.split('\n').length);
});

test('comments, string contents and regex bodies are blanked; template expressions are code', () => {
  assert.deepEqual(squeezed("const a = 'console.log(1)'; // console.log(2)\nconst b = `x ${ready(a)} y`; /* console.log(3) */ run();"), [
    "const a = ' ';",
    'const b = ` ${ready(a)} `; run();',
  ]);
  assert.deepEqual(squeezed('const ok = /^[\'"]use client[\'"]/.test(s) && !/\\/\\//.test(t);'), ['const ok = / /.test(s) && !/ /.test(t);']);
});

test('a quote inside a regex inside a template expression does not blank the rest of the file', () => {
  const code = 'const cell = `"${String(v).replace(/"/g, \'""\')}"`;\nconsole.log(cell);\nexport const after = 1;';
  const lines = squeezed(code);
  assert.equal(lines[1], 'console.log(cell);');
  assert.equal(lines[2], 'export const after = 1;');
  assert.match(lines[0], /\$\{String\(v\)\.replace\(\/ \/g, ' '\)\}/);
});

test('a comment or a brace inside a template expression stays inside it', () => {
  const code = 'const t = `a ${/* } */ pick({ b: 1 }) // }\n} z`;\nafter();';
  const lines = squeezed(code);
  assert.equal(lines[1], '} `;');
  assert.equal(lines[2], 'after();');
});

test('nested templates keep their expressions', () => {
  assert.deepEqual(squeezed('const s = `a ${list.map((x) => `<li>${x.name}</li>`).join("")} b`;\nnext();'), [
    'const s = ` ${list.map((x) => ` ${x.name} `).join("")} `;',
    'next();',
  ]);
});

test('JSX closing and self-closing tags are not regex starts', () => {
  for (const code of [
    'return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;',
    'return <div>{ok && <Icon size={2} />}</div>;',
    'return <>{a}</>;',
  ]) {
    assert.equal(stripCode(code), code, code);
  }
});

test('an apostrophe glued to a word in JSX text is not a string', () => {
  const code = "{!user && <p>You're not signed in, and it's late</p>}\nconst next = 1;";
  assert.equal(stripCode(code), code);
});

test('a regex after return, typeof or case is a regex', () => {
  assert.deepEqual(squeezed('return /^https?:\\/\\//.test(url) ? url : base + url;\nconst next = 1;'), ['return / /.test(url) ? url : base + url;', 'const next = 1;']);
  assert.deepEqual(squeezed('return /["\']/.test(s);\nconst next = 1;'), ['return / /.test(s);', 'const next = 1;']);
  assert.deepEqual(squeezed('return /^\\{\\{/.test(text);'), ['return / /.test(text);']);
});

test('division stays division', () => {
  for (const code of ['const half = total / 2; const r = a / b / c;', 'const x = f(a) / 2;', 'const y = list[0] / n; i++ / 2;', 'const returned = 4;\nconst z = returned / 2 / 1;']) {
    assert.equal(stripCode(code), code, code);
  }
});

test('a string still follows a keyword without a space', () => {
  assert.deepEqual(squeezed("switch (x) { case'a': return'b'; }"), ["switch (x) { case' ': return' '; }"]);
});

test('an unterminated quote stops at the end of its line', () => {
  assert.deepEqual(squeezed("const a = 'open\nconst b = 2;"), ["const a = '", 'const b = 2;']);
});

test('a division after a name that is also a keyword, a property, a non-null assertion or an increment stays a division', () => {
  assert.deepEqual(squeezed('export const pageOf = (from: number) => Math.floor(from / PAGE_SIZE); // zero-based'), ['export const pageOf = (from: number) => Math.floor(from / PAGE_SIZE);']);
  assert.deepEqual(squeezed('const half = spacing.default / 2; const rest = theme.in / 4 / 2; // px'), ['const half = spacing.default / 2; const rest = theme.in / 4 / 2;']);
  assert.deepEqual(squeezed('const cents = plan.price! / 100 + list[0]! / 2; // integer cents'), ['const cents = plan.price! / 100 + list[0]! / 2;']);
  assert.deepEqual(squeezed('const next = i++ / 2 + j-- / 2; // halves'), ['const next = i++ / 2 + j-- / 2;']);
});

test('a division inside a template expression does not swallow the end of the expression', () => {
  for (const line of [
    'export const url = (base, from, to) => `${base}/range/${from / 1000}/${to / 1000}`;',
    'export const label = (plan) => `${(plan.price! / 100).toFixed(2)}/month`;',
    'export const mid = (i) => `${i++ / 2}/${i}`;',
  ]) {
    assert.deepEqual(squeezed(`${line}\nconsole.log(done);`)[1], 'console.log(done);', line);
  }
});

test('a regex still follows a prefix not and a keyword', () => {
  assert.deepEqual(squeezed("if (!/^['\"]/.test(s) && !/a'b/.test(t)) return !/x'y/.test(u);"), ['if (!/ /.test(s) && !/ /.test(t)) return !/ /.test(u);']);
  assert.deepEqual(squeezed("const kind = typeof /a'b/; switch (k) { case /c'd/.source: break; }"), ['const kind = typeof / /; switch (k) { case / /.source: break; }']);
});
