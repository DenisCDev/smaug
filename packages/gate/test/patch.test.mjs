// @ts-check
// parsePatch: the V4A envelope is the ONLY edit path on Codex, so every hole
// here is the gate silently off. The cases mirror openai/codex's own grammar
// (apply-patch/src/parser.rs, streaming_parser.rs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePatch } from '../src/patch.mjs';
import { runHook } from '../src/hook.mjs';

const patch = (/** @type {string[]} */ ...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');

test('Add File reconstructs the exact content', () => {
  const entries = parsePatch(patch('*** Add File: src/a.ts', '+const a = 1;', '+export { a };'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'src/a.ts');
  assert.deepEqual(entries[0].call, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/a.ts', content: 'const a = 1;\nexport { a };\n' },
  });
});

test('Update File turns hunks into edits', () => {
  const entries = parsePatch(patch(
    '*** Update File: a.ts',
    '@@',
    ' const keep = 1;',
    '-const old = 2;',
    '+const fresh = 2;',
  ));
  assert.equal(entries.length, 1);
  const call = entries[0].call;
  assert.ok(call);
  assert.equal(call.tool_name, 'MultiEdit');
  assert.deepEqual(call.tool_input.edits, [
    { old_string: 'const keep = 1;\nconst old = 2;', new_string: 'const keep = 1;\nconst fresh = 2;' },
  ]);
});

test('an entirely empty line is an empty CONTEXT line, not noise', () => {
  // Codex: streaming_parser.rs:307-315. Dropping it made old_string skip the
  // blank line, never match the disk, and the judgment fail open.
  const entries = parsePatch(patch(
    '*** Update File: a.ts',
    '@@',
    ' const a = 1;',
    '',
    '-const b = 2;',
    '+const b = 3;',
  ));
  const call = entries[0].call;
  assert.ok(call);
  assert.deepEqual(call.tool_input.edits, [
    { old_string: 'const a = 1;\n\nconst b = 2;', new_string: 'const a = 1;\n\nconst b = 3;' },
  ]);
});

test('Delete File carries the path with nothing to judge', () => {
  assert.deepEqual(parsePatch(patch('*** Delete File: gone.ts')), [{ path: 'gone.ts', call: null }]);
});

test('Move to: judged under the OLD path, new path reported for the touch', () => {
  const entries = parsePatch(patch(
    '*** Update File: old/name.ts',
    '*** Move to: new/name.ts',
    '@@',
    '-const x = 1;',
    '+const x = 2;',
  ));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, 'old/name.ts');
  assert.ok(entries[0].call);
  assert.equal(entries[0].call.tool_input.file_path, 'old/name.ts');
  assert.deepEqual(entries[1], { path: 'new/name.ts', call: null });
});

test('End of File marker and Environment ID preamble are skipped', () => {
  const entries = parsePatch([
    '*** Begin Patch',
    '*** Environment ID: env-1234',
    '*** Update File: a.ts',
    '@@',
    '-tail = 1;',
    '+tail = 2;',
    '*** End of File',
    '*** End Patch',
  ].join('\n'));
  assert.equal(entries.length, 1);
  assert.ok(entries[0].call);
  assert.deepEqual(entries[0].call.tool_input.edits, [{ old_string: 'tail = 1;', new_string: 'tail = 2;' }]);
});

test('multi-file patch yields one entry per file, in order', () => {
  const entries = parsePatch(patch(
    '*** Add File: a.ts',
    '+export const a = 1;',
    '*** Update File: b.ts',
    '@@',
    '-const b = 1;',
    '+const b = 2;',
    '*** Delete File: c.ts',
  ));
  assert.deepEqual(entries.map((e) => e.path), ['a.ts', 'b.ts', 'c.ts']);
  assert.ok(entries[0].call && entries[1].call);
  assert.equal(entries[2].call, null);
});

test('CRLF envelope parses the same as LF', () => {
  const lf = parsePatch(patch('*** Add File: a.ts', '+const a = 1;'));
  const crlf = parsePatch(patch('*** Add File: a.ts', '+const a = 1;').replace(/\n/g, '\r\n'));
  assert.deepEqual(crlf, lf);
});

test('a truncated patch (no End Patch) still flushes the open section', () => {
  const entries = parsePatch('*** Begin Patch\n*** Add File: a.ts\n+const a = 1;');
  assert.equal(entries.length, 1);
  assert.ok(entries[0].call);
});

test('a damaged section keeps its path with call null — the touch survives', () => {
  const entries = parsePatch(patch(
    '*** Add File: a.ts',
    '+fine',
    'this bare line is not V4A',
    '*** Update File: b.ts',
    '@@',
    '-x = 1;',
    '+x = 2;',
  ));
  assert.deepEqual(entries[0], { path: 'a.ts', call: null });
  assert.ok(entries[1].call, 'the next file still parses');
});

test('a context-free pure-addition hunk is dropped, other hunks survive', () => {
  const entries = parsePatch(patch(
    '*** Update File: a.ts',
    '@@',
    '+orphan addition',
    '@@',
    ' anchor',
    '-old',
    '+new',
  ));
  const call = entries[0].call;
  assert.ok(call);
  assert.deepEqual(call.tool_input.edits, [{ old_string: 'anchor\nold', new_string: 'anchor\nnew' }]);
});

test('garbage input never throws and reports nothing', () => {
  assert.deepEqual(parsePatch('not a patch at all'), []);
  assert.deepEqual(parsePatch(''), []);
  assert.deepEqual(parsePatch(/** @type {any} */ (null)), []);
});

// --- E1a: CRLF working tree must not disarm the judgment ---

test('an edit judged against a CRLF file on disk still blocks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-crlf-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export function f() {}\r\nexport const x = 1;\r\n');
    // old_string arrives LF-normalized, exactly as parsePatch produces it.
    const result = await runHook('pre', {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'export function f() {}',
        new_string: 'export function f() { try { throw new Error("x"); } catch {} }',
      },
    });
    assert.equal(result.exitCode, 2, 'CRLF on disk must not fail the judgment open');
    assert.match(result.stderr, /empty-catch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
