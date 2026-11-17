// The args field names are the one undocumented part of the contract, so they
// get the cheapest and densest coverage: pure calls, no spawning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAssistantState, normalize, sessionId } from '../antigravity/hooks/normalize.mjs';

const WS = process.platform === 'win32' ? 'D:/proj' : '/proj';
const abs = (...p) => join(WS, ...p);
const call = (name, args, extra = {}) => normalize({
  toolCall: { name, args },
  conversationId: 'conv1',
  workspacePaths: [WS],
  ...extra,
});

test('write_to_file in PascalCase (the Cascade shape) becomes a Write', () => {
  const out = call('write_to_file', { TargetFile: abs('a.ts'), CodeContent: 'export const a = 1;\n' });
  assert.equal(out.length, 1);
  assert.equal(out[0].tool_name, 'Write');
  assert.equal(out[0].tool_input.content, 'export const a = 1;\n');
  assert.match(out[0].tool_input.file_path, /a\.ts$/);
});

test('the same call in camelCase and snake_case normalizes identically', () => {
  const camel = call('write_to_file', { targetFile: abs('a.ts'), codeContent: 'x' })[0];
  const snake = call('write_to_file', { target_file: abs('a.ts'), code_content: 'x' })[0];
  assert.deepEqual(camel, snake);
  assert.equal(camel.tool_name, 'Write');
});

test('other plausible spellings of the path field all resolve', () => {
  for (const key of ['AbsolutePath', 'FilePath', 'filePath', 'file_path', 'filepath', 'Path', 'path']) {
    const out = call('write_to_file', { [key]: abs('a.ts'), content: 'x' });
    assert.equal(out.length, 1, key + ' should resolve');
  }
});

test('replacement chunks become a MultiEdit, carrying replace_all', () => {
  const out = call('replace_file_content', {
    TargetFile: abs('b.ts'),
    ReplacementChunks: [
      { TargetContent: 'old', ReplacementContent: 'new', AllowMultiple: true },
      { TargetContent: 'a', ReplacementContent: 'b' },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].tool_name, 'MultiEdit');
  assert.equal(out[0].tool_input.edits.length, 2);
  assert.deepEqual(out[0].tool_input.edits[0], { old_string: 'old', new_string: 'new', replace_all: true });
  assert.equal(out[0].tool_input.edits[1].replace_all, undefined);
});

test('a flat old/new pair becomes an Edit', () => {
  const out = call('replace_file_content', { TargetFile: abs('c.ts'), OldString: 'a', NewString: 'b' });
  assert.equal(out[0].tool_name, 'Edit');
  assert.equal(out[0].tool_input.old_string, 'a');
  assert.equal(out[0].tool_input.new_string, 'b');
});

test('multi_replace_file_content yields one gate call per file', () => {
  const out = call('multi_replace_file_content', {
    Edits: [
      { TargetFile: abs('one.ts'), ReplacementChunks: [{ TargetContent: 'a', ReplacementContent: 'b' }] },
      { TargetFile: abs('two.ts'), ReplacementChunks: [{ TargetContent: 'c', ReplacementContent: 'd' }] },
    ],
  });
  assert.equal(out.length, 2);
  assert.match(out[0].tool_input.file_path, /one\.ts$/);
  assert.match(out[1].tool_input.file_path, /two\.ts$/);
});

test('chunks for one file are merged into a single MultiEdit', () => {
  // Separate calls would each be judged against the file on disk, scoring an
  // intermediate state that never exists — an import added by one chunk and
  // first used by the next would read as dead.
  const out = call('multi_replace_file_content', {
    Edits: [
      { TargetFile: abs('same.ts'), ReplacementChunks: [{ TargetContent: 'a', ReplacementContent: 'b' }] },
      { TargetFile: abs('same.ts'), ReplacementChunks: [{ TargetContent: 'c', ReplacementContent: 'd' }] },
      { TargetFile: abs('other.ts'), ReplacementChunks: [{ TargetContent: 'e', ReplacementContent: 'f' }] },
    ],
  });
  assert.equal(out.length, 2, 'one call per file, not per chunk');
  const same = out.find((c) => c.tool_input.file_path.endsWith('same.ts'));
  assert.equal(same.tool_name, 'MultiEdit');
  assert.equal(same.tool_input.edits.length, 2, 'both chunks travel together, in order');
  assert.equal(same.tool_input.edits[0].old_string, 'a');
  assert.equal(same.tool_input.edits[1].old_string, 'c');
});

test('a whole-file write mixed with edits for the same file is dropped, in either order', () => {
  // We cannot model the combination faithfully, and judging the write's content
  // while the edit's violation is what actually lands would be a wrong verdict.
  const chunk = { TargetFile: abs('mix.ts'), ReplacementChunks: [{ TargetContent: 'a', ReplacementContent: 'b' }] };
  const whole = { TargetFile: abs('mix.ts'), CodeContent: 'export const clean = 1;\n' };
  const other = { TargetFile: abs('untouched.ts'), CodeContent: 'export const o = 1;\n' };

  for (const order of [[whole, chunk], [chunk, whole]]) {
    const out = call('multi_replace_file_content', { Edits: [...order, other] });
    assert.equal(out.length, 1, 'the ambiguous file is dropped, the other still gated');
    assert.match(out[0].tool_input.file_path, /untouched\.ts$/);
  }
});

test('a chunk whose replacement we cannot name is dropped, not read as a deletion', () => {
  // Modelling it as "delete old_string" would be a wrong verdict from a
  // half-known shape — the module promises to drop instead.
  assert.deepEqual(call('replace_file_content', {
    TargetFile: abs('half.ts'),
    ReplacementChunks: [{ TargetContent: 'a', SomethingWeDoNotKnow: 'b' }],
  }), []);
  assert.deepEqual(call('replace_file_content', { TargetFile: abs('half.ts'), OldString: 'a' }), []);
});

test('the shape wins over the name', () => {
  // The name says whole-file write, the args carry chunks: trust the args.
  const out = call('write_to_file', {
    TargetFile: abs('d.ts'),
    ReplacementChunks: [{ TargetContent: 'a', ReplacementContent: 'b' }],
  });
  assert.equal(out[0].tool_name, 'MultiEdit');
});

test('an unknown tool name still normalizes, if the hook matcher lets it through', () => {
  // The module judges by shape; the installed matcher still filters by name, so
  // a brand new write tool needs one line added there to reach this at all.
  assert.equal(call('some_future_write_tool', { TargetFile: abs('e.ts'), CodeContent: 'x' })[0].tool_name, 'Write');
});

test('an unrecognisable shape is dropped instead of guessed', () => {
  assert.deepEqual(call('write_to_file', { Foo: 1, Bar: 'x' }), []);
  assert.deepEqual(call('run_command', { Command: 'ls' }), []);
  assert.deepEqual(normalize({ toolCall: null }), []);
  assert.deepEqual(normalize({}), []);
  assert.deepEqual(normalize(null), []);
});

test('creating an empty file has nothing to judge', () => {
  assert.deepEqual(call('write_to_file', { TargetFile: abs('f.ts'), CodeContent: '', EmptyFile: true }), []);
});

test('a relative path resolves against the workspace, or is dropped', () => {
  const withWs = call('write_to_file', { TargetFile: 'src/g.ts', CodeContent: 'x' });
  assert.equal(withWs.length, 1);
  assert.match(withWs[0].tool_input.file_path.replace(/\\/g, '/'), /proj\/src\/g\.ts$/);

  const noWs = normalize({ toolCall: { name: 'write_to_file', args: { TargetFile: 'src/g.ts', CodeContent: 'x' } } });
  assert.deepEqual(noWs, [], 'never resolve against the hook subprocess cwd');
});

test('a multi-root workspace does not get its files judged in the wrong root', () => {
  const rootA = mkdtempSync(join(tmpdir(), 'smugan-agy-rootA-'));
  const rootB = mkdtempSync(join(tmpdir(), 'smugan-agy-rootB-'));
  mkdirSync(join(rootB, 'src'), { recursive: true });
  writeFileSync(join(rootB, 'src', 'only-here.ts'), 'export const x = 1;\n');

  const found = normalize({
    toolCall: { name: 'write_to_file', args: { TargetFile: 'src/only-here.ts', CodeContent: 'y' } },
    workspacePaths: [rootA, rootB],
  });
  assert.equal(found.length, 1);
  assert.ok(found[0].tool_input.file_path.startsWith(rootB), 'the root that actually holds the file wins');

  // A new file that exists in neither root is ambiguous: guessing the first one
  // would hand the gate a path with no baseline, failing legacy code in full.
  const ambiguous = normalize({
    toolCall: { name: 'write_to_file', args: { TargetFile: 'src/brand-new.ts', CodeContent: 'y' } },
    workspacePaths: [rootA, rootB],
  });
  assert.deepEqual(ambiguous, []);

  rmSync(rootA, { recursive: true, force: true });
  rmSync(rootB, { recursive: true, force: true });
});

test('assistant state is skipped, and a sibling directory is not', () => {
  assert.equal(isAssistantState(join(homedir(), '.gemini', 'AGENTS.md')), true);
  assert.equal(isAssistantState(join(homedir(), '.gemini-dev', 'AGENTS.md')), false, 'boundary-safe prefix');
  assert.equal(isAssistantState(join(homedir(), '.claude', 'CLAUDE.md')), true);
  assert.equal(isAssistantState(abs('src', 'app.ts')), false);

  const out = call('write_to_file', { TargetFile: join(homedir(), '.gemini', 'notes.sql'), CodeContent: 'x' });
  assert.deepEqual(out, []);
});

test('a project under the temp dir is still gated', () => {
  // No blanket temp exemption: real projects do live under /tmp, and the gate
  // already exempts its own scratchpad. Exempting all of tmp here would quietly
  // switch smugan off for those projects.
  const out = call('write_to_file', { TargetFile: join(tmpdir(), 'proj', 'a.ts'), CodeContent: 'x' });
  assert.equal(out.length, 1);
  assert.equal(out[0].tool_name, 'Write');
});

test('an explicit null does not shadow a later alias', () => {
  const out = call('write_to_file', { TargetFile: null, filePath: abs('h.ts'), CodeContent: 'x' });
  assert.equal(out.length, 1);
  assert.match(out[0].tool_input.file_path, /h\.ts$/);
});

test('the conversation id is what the gate keys its turn marker on', () => {
  assert.equal(sessionId({ conversationId: 'abc' }), 'abc');
  assert.equal(sessionId({ sessionId: 'xyz' }), 'xyz');
  assert.equal(sessionId({}), '');
});
