// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'fetch-timeout';

test('server fetch without a deadline is flagged', () => {
  const v = ofRule(run('src/api.ts', 'await fetch("https://example.com");'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /deadline/);
});

test('fetch with AbortSignal.timeout passes', () => {
  const code = 'await fetch(url, { signal: AbortSignal.timeout(3_000) });';
  assert.equal(ofRule(run('src/api.ts', code), R).length, 0);
});

test('fetch with signal from AbortController passes', () => {
  const code = 'const c = new AbortController();\nawait fetch(url, { signal: c.signal });';
  assert.equal(ofRule(run('app/api/route.ts', code), R).length, 0);
});

test('the platform fetch ignores timeout:, so that call has no deadline', () => {
  const v = ofRule(run('src/api.ts', 'await fetch(url, { timeout: 5_000 });'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /ignores the timeout: option/);
  const undici = "import { fetch } from 'undici';\nawait fetch(url, { timeout: 5_000 });";
  assert.equal(ofRule(run('src/api.ts', undici), R).length, 1);
  const leftover = "// import fetch from 'node-fetch'; // Node 18+ ships fetch\nawait fetch(url, { timeout: 5_000 });";
  assert.equal(ofRule(run('src/api.ts', leftover), R).length, 1, 'a commented-out import binds nothing');
  const entry = "import {\n  Headers,\n  // fetch, -- Node 18+ ships fetch\n} from 'node-fetch';\nawait fetch(url, { timeout: 5_000, headers: new Headers() });";
  assert.equal(ofRule(run('src/api.ts', entry), R).length, 1, 'a commented-out entry binds nothing either');
});

test('timeout: counts for a fetch imported from a library and for $fetch', () => {
  for (const code of [
    "import fetch from 'node-fetch';\nawait fetch(url, { timeout: 5_000 });",
    "const fetch = require('node-fetch');\nawait fetch(url, { timeout: 5_000 });",
    'await $fetch(url, { timeout: 5_000 });',
  ]) {
    assert.equal(ofRule(run('src/api.ts', code), R).length, 0, code);
  }
});

test('object shorthand { signal } is a deadline', () => {
  const code = 'const signal = AbortSignal.timeout(3000);\nawait fetch(url, { signal });';
  assert.equal(ofRule(run('src/api.ts', code), R).length, 0);
});

test('timeout nested in the body is not a deadline', () => {
  const code = 'await fetch(url, { method: "POST", body: JSON.stringify({ timeout: 1 }) });';
  const v = ofRule(run('src/api.ts', code), R);
  assert.equal(v.length, 1);
});

test('use client after a leading comment is still the client module', () => {
  const code = '// table\n"use client";\nawait fetch("/api");';
  assert.equal(ofRule(run('src/c.tsx', code), R).length, 0);
});

test('client fetch is ignored', () => {
  const code = '"use client";\nawait fetch("/api");';
  assert.equal(ofRule(run('src/c.tsx', code), R).length, 0);
});

test('client.fetch wrapper is ignored (precision over recall)', () => {
  assert.equal(ofRule(run('src/api.ts', 'await client.fetch(url);'), R).length, 0);
});

test('tests and scripts are ignored', () => {
  assert.equal(ofRule(run('src/a.test.ts', 'await fetch(url);'), R).length, 0);
  assert.equal(ofRule(run('scripts/probe.ts', 'await fetch(url);'), R).length, 0);
});

test('a function or method named fetch being declared is not a call', () => {
  for (const code of [
    'export default {\n  async fetch(request: Request, env: Env) {\n    return new Response("ok");\n  },\n};',
    'export async function fetch(url: string) {\n  return load(url);\n}',
    'export interface Client {\n  fetch(input: string): Promise<Response>;\n}',
    'type Client = { fetch(input: string): Promise<Response> };',
    'class Api {\n  private async fetch(path: string): Promise<Response> {\n    return this.http.get(path);\n  }\n}',
    'Bun.serve({ fetch(req) { return new Response("ok"); } });',
    'declare function fetch(input: string): Promise<Response>;',
  ]) {
    assert.equal(ofRule(run('src/worker.ts', code), R).length, 0, code);
  }
});

test('a call inside a method named fetch, or before a ternary colon, is still a call', () => {
  const inside = 'export default {\n  async fetch(request: Request) {\n    return fetch("https://origin.example/" + request.url);\n  },\n};';
  const v = ofRule(run('src/worker.ts', inside), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
  assert.equal(ofRule(run('src/api.ts', 'const res = await (cached ? fetch(a) : fetch(b));'), R).length, 2);
  assert.equal(ofRule(run('src/api.ts', 'const res = cached\n  ? await fetch(a)\n  : await fetch(b);'), R).length, 2);
  assert.deepEqual(ofRule(run('src/api.ts', 'const res = cached ?\n  fetch(a) :\n  fetch(b);'), R).map((x) => x.line), [2, 3]);
});

test('the platform fetch reached through globalThis is the same call; a local object is not', () => {
  assert.equal(ofRule(run('src/api.ts', 'await globalThis.fetch(url);'), R).length, 1);
  assert.equal(ofRule(run('src/api.ts', 'const self = this;\nawait self.fetch(url);'), R).length, 0, 'self is a common alias of this');
  assert.equal(ofRule(run('src/api.ts', 'await globalThis.fetch(url, { signal: AbortSignal.timeout(1000) });'), R).length, 0);
});

test('each unbounded fetch reports its own line', () => {
  const code = 'await fetch(a);\nawait fetch(b, { signal: AbortSignal.timeout(1) });\nawait fetch(c);';
  const v = ofRule(run('src/api.ts', code), R);
  assert.equal(v.length, 2);
  assert.equal(v[0].line, 1);
  assert.equal(v[1].line, 3);
});
