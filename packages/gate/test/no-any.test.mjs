// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'no-any';

test('annotation any is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const x: any = load();'), R);
  assert.equal(v.length, 1);
});

test('as any is flagged', () => {
  assert.equal(ofRule(run('src/a.ts', 'const y = value as any;'), R).length, 1);
});

test('generic any is flagged', () => {
  assert.equal(ofRule(run('src/a.ts', 'const list: Array<any> = [];'), R).length, 1);
});

test('any[] is flagged', () => {
  assert.equal(ofRule(run('src/a.ts', 'function f(items: any[]) {}'), R).length, 1);
});

test('as unknown as double cast is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const user = payload as unknown as User;'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /as unknown as/);
});

test('as unknown as with a written justification passes', () => {
  const code = '// any: SDK payload has no types, validated by zod right below\nconst user = payload as unknown as User;';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('as unknown as inside strings and comments is ignored', () => {
  const code = "const s = 'as unknown as'; // cast as unknown as User";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('justification on the same line passes', () => {
  const code = 'const x: any = window.__thing; // any: injected by legacy analytics script, no types exist';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('justification on the previous line passes', () => {
  const code = '// any: third-party SDK returns untyped payloads\nconst x: any = sdk.load();';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('any inside strings and comments is ignored', () => {
  const code = "const s = ': any'; // as any in a comment\n";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('words containing any are not matched', () => {
  const code = 'const company: Company = getCompany(); let anywhere = 1;';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('d.ts files are skipped', () => {
  assert.equal(ofRule(run('src/globals.d.ts', 'declare const x: any;'), R).length, 0);
});

// Regression (production app, jul-ago/2026): 8 gate blocks were placement retries —
// the justification existed but sat higher up in the comment block, or used
// the eslint directive the post-hook itself recommends.

test('justification anywhere in the comment block directly above passes', () => {
  const code = [
    '// any: hono context is untyped in this house-style handler (r1-r11)',
    '// keeps the route registration one-liner readable',
    'const handler = (c: any) => c.json(ok);',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('justification in a JSDoc block above passes', () => {
  const code = [
    '/**',
    ' * any: fixture mirrors the untyped wire payload exactly as received',
    ' */',
    'const fixture: any = load();',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('a blank line inside the comment block does not break the justification', () => {
  const code = [
    '// any: SDK payload has no types, validated by zod at the boundary',
    '',
    'const x: any = sdk.load();',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('a code line between the justification and the any still blocks', () => {
  const code = [
    '// any: this reason governs the statement below, not the one after it',
    'const ok = 1;',
    'const x: any = sdk.load();',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 1);
});

test('eslint-disable-next-line no-explicit-any WITH a reason passes', () => {
  const code = [
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wire payload validated below',
    'const x: any = sdk.load();',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('eslint-disable-next-line WITHOUT a reason still blocks', () => {
  const code = [
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
    'const x: any = sdk.load();',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 1);
});

test('eslint-disable-next-line two lines up does not count (eslint semantics)', () => {
  const code = [
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason here',
    'const ok = 1;',
    'const x: any = sdk.load();',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 1);
});

test('eslint-disable-line trailing on the flagged line passes; -next-line there does not', () => {
  const sameLineOk = 'const x: any = sdk.load(); // eslint-disable-line @typescript-eslint/no-explicit-any -- wire payload';
  assert.equal(ofRule(run('src/a.ts', sameLineOk), R).length, 0);
  const nextLineMisplaced = 'const x: any = sdk.load(); // eslint-disable-next-line @typescript-eslint/no-explicit-any -- governs the NEXT line, not this one';
  assert.equal(ofRule(run('src/a.ts', nextLineMisplaced), R).length, 1);
});

test('"*/ code()" is code, not comment — it breaks the justification block', () => {
  const code = [
    '/* any: justification that must NOT reach past real code',
    '*/ doRealWork();',
    'const x: any = 1;',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 1);
});

test('any in a later generic slot, a tuple, a union, a function return or a type alias is flagged', () => {
  for (const code of [
    'export const cache: Record<string, any> = {};',
    'export const byId = new Map<string, any>();',
    'export type Pair = [string, any];',
    'export type Head = [any, string];',
    'export let value: string | any;',
    'export type Handler = (event: Event) => any;',
    'export type Payload = any;',
    'export function wrap<T = any>(v: T) { return v; }',
    'export type Mid = Reducer<State, any, Action>;',
  ]) {
    assert.equal(ofRule(run('src/a.ts', code), R).length, 1, code);
  }
});

test('keyof any, T extends any and values named any stay clean', () => {
  const code = [
    'export type Key = keyof any;',
    'export type Each<T> = T extends any ? T[] : never;',
    'const schema = z.any();',
    'const first = await Promise.any([a, b]);',
    'expect(fn).toHaveBeenCalledWith(expect.any(String));',
    'const ok = a || anyOther;',
    "import { all, any, race } from 'async';",
    'const { some, any: anyOf, every } = helpers;',
  ].join('\n');
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('@ts-nocheck and a bare @ts-ignore switch the type system off and are flagged', () => {
  const nocheck = ofRule(run('src/a.ts', '// @ts-nocheck\nexport const x = 1;'), R);
  assert.equal(nocheck.length, 1);
  assert.equal(nocheck[0].line, 1);
  assert.match(nocheck[0].message, /@ts-nocheck/);
  const ignore = ofRule(run('src/a.ts', 'export function f(x: number) {\n  // @ts-ignore\n  return x.foo;\n}'), R);
  assert.equal(ignore.length, 1);
  assert.equal(ignore[0].line, 2);
  assert.match(ignore[0].message, /@ts-ignore/);
  const jsx = 'export const A = () => (\n  <div>\n    {/* @ts-ignore */}\n    <Legacy prop={1} />\n  </div>\n);';
  assert.deepEqual(ofRule(run('src/a.tsx', jsx), R).map((v) => v.line), [3]);
  assert.equal(ofRule(run('src/a.ts', '/**\n * @ts-ignore\n */\nfoo(1);'), R).length, 1);
});

test('a type directive with a written reason passes, and so does @ts-expect-error', () => {
  for (const code of [
    '// @ts-nocheck generated by openapi-typescript, do not edit\nexport const x = 1;',
    '// @ts-ignore: upstream types miss the overload, fixed in v5\nfoo(1);',
    '// @ts-ignore -- upstream types miss the overload\nfoo(1);',
    '/* @ts-ignore the SDK ships no types for this call */\nfoo(1);',
    '// @ts-expect-error\nfoo(1);',
    "const s = '// @ts-ignore';",
    '// this codebase avoids @ts-ignore\nfoo(1);',
  ]) {
    assert.deepEqual(ofRule(run('src/a.ts', code), R), [], code);
  }
  assert.equal(ofRule(run('src/a.ts', '// @ts-ignore: no\nfoo(1);'), R).length, 1, 'a reason shorter than 6 characters is none');
});
