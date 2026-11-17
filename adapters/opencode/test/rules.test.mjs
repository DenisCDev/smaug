// Path-scoped rule injection, against the real smugan rule files: the rule text
// must ride back with the write that touched a matching file, once per rule per
// session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from '../opencode/smugan/rules.mjs';
import { SMUGAN } from './helpers.mjs';

const RULES = join(SMUGAN, 'claude', 'rules');
assert.ok(readdirSync(RULES).includes('testing.md'), 'the smugan repo must sit next to smugan-opencode');

test('the first write to a test file injects the whole testing rule', () => {
  const surfaced = new Set();
  const out = rulesFor('/proj/src/foo.test.ts', surfaced, 2, RULES);
  assert.equal(out.length, 1);
  assert.match(out[0], /smugan rule `testing`/);
  assert.match(out[0], /paths:/, 'the rule is injected whole, frontmatter included');
  assert.ok(surfaced.has('testing'));
});

test('a rule already surfaced this session is not injected again', () => {
  const surfaced = new Set(['testing']);
  assert.deepEqual(rulesFor('/proj/src/other.spec.ts', surfaced, 2, RULES), []);
});

test('a file matching no rule stays quiet', () => {
  assert.deepEqual(rulesFor('/proj/src/plain.ts', new Set(), 2, RULES), []);
});

test('a .tsx matches several rules but only maxPerInjection ride along', () => {
  const surfaced = new Set();
  const first = rulesFor('/proj/app/page.tsx', surfaced, 2, RULES);
  assert.equal(first.length, 2, 'capped so one edit cannot flood the context');
  const second = rulesFor('/proj/app/other.tsx', surfaced, 2, RULES);
  assert.ok(second.length >= 1, 'the rules held back arrive on the next matching write');
  const names = [...surfaced];
  assert.ok(names.includes('nextjs') || names.includes('ui-ptbr') || names.includes('ux-flows'));
});

test('a missing rules directory fails open', () => {
  assert.deepEqual(rulesFor('/proj/src/x.test.ts', new Set(), 2, join(SMUGAN, 'nope')), []);
});
