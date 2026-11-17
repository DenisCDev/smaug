// The gate hooks, driven exactly as OpenCode drives them, against the real
// smugan engine from the sibling checkout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GATE, PLUGIN, fakeClient, makeProject } from './helpers.mjs';
import { normalize, parsePatch } from '../opencode/smugan/gate.mjs';
import { randomUUID } from 'node:crypto';

// PIDs repeat across runs on Windows; leftover per-session files from an
// earlier run must never belong to this one.
const RUN = randomUUID().slice(0, 8);

assert.ok(existsSync(join(GATE, 'src', 'hook.mjs')), 'the smugan repo must sit next to smugan-opencode');
process.env.SMUGAN_GATE_DIR = GATE;

const { smugan } = await import(PLUGIN);
const hooks = await smugan({ client: fakeClient() });
const proj = makeProject();
after(() => rmSync(proj, { recursive: true, force: true }));

const sid = (suffix) => 'ses' + RUN + suffix;
const before = (tool, args, sessionID = sid('g')) =>
  hooks['tool.execute.before']({ tool, sessionID, callID: 'c1' }, { args });

test('a migration without RLS is blocked before it reaches disk', async () => {
  await assert.rejects(
    () => before('write', {
      filePath: join(proj, 'supabase', 'migrations', '0001_create_clientes.sql'),
      content: 'create table clientes (\n  nome_completo text\n);\n',
    }),
    (error) => {
      assert.match(error.message, /violation/);
      assert.match(error.message, /db-naming|rls/);
      return true;
    },
  );
});

test('an edit that introduces an empty catch is blocked', async () => {
  const file = join(proj, 'src', 'risky.ts');
  writeFileSync(file, 'export function risky() {}\n');
  await assert.rejects(
    () => before('edit', {
      filePath: file,
      oldString: 'export function risky() {}',
      newString: 'export function risky() { try { throw new Error("x"); } catch {} }',
    }),
    /empty-catch/,
  );
});

test('a clean write passes', async () => {
  await assert.doesNotReject(
    () => before('write', { filePath: join(proj, 'src', 'util.ts'), content: 'export const answer = 42;\n' }),
  );
});

test('non-write tools are ignored', async () => {
  await assert.doesNotReject(() => before('bash', { command: 'ls' }));
  await assert.doesNotReject(() => before('read', { filePath: join(proj, 'src', 'util.ts') }));
});

test('files under the OpenCode config dir are assistant state, not project code', async () => {
  const configDir = join(proj, 'fake-config');
  mkdirSync(configDir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = configDir;
  try {
    await assert.doesNotReject(
      () => before('write', {
        filePath: join(configDir, 'notes.sql'),
        content: 'create table clientes (nome_completo text);\n',
      }),
    );
    // a sibling directory must NOT be swallowed by the prefix check
    await assert.rejects(
      () => before('write', {
        filePath: join(proj, 'fake-config-app', 'm', '0001_clientes.sql'),
        content: 'create table clientes (nome_completo text);\n',
      }),
      /violation/,
    );
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

test('apply_patch: Add File is gated exactly', async () => {
  const patch = [
    '*** Begin Patch',
    '*** Add File: ' + join(proj, 'supabase', 'migrations', '0002_pedidos.sql'),
    '+create table pedidos (',
    '+  valor_total numeric',
    '+);',
    '*** End Patch',
  ].join('\n');
  await assert.rejects(() => before('apply_patch', { patchText: patch }), /db-naming|rls/);
});

test('apply_patch with only a deletion has nothing to judge', async () => {
  const gone = join(proj, 'src', 'gone.ts');
  const patch = '*** Begin Patch\n*** Delete File: ' + gone + '\n*** End Patch';
  // A Write with no content: the gate records how the file arrived and judges nothing.
  assert.deepEqual(await parsePatch(patch), [{ tool_name: 'Write', tool_input: { file_path: gone } }]);
  await assert.doesNotReject(() => before('apply_patch', { patchText: patch }));
});

test('apply_patch: a hunk that only adds lines is still recorded for the end-of-turn check', async () => {
  const session = sid('add');
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  rmSync(marker, { force: true });
  const file = join(proj, 'src', 'appended.ts');
  writeFileSync(file, 'export const one = 1;\n');
  const patch = ['*** Begin Patch', '*** Update File: ' + file, '@@', '+export function load() { try { read(); } catch {} }', '*** End Patch'].join('\n');
  await assert.doesNotReject(() => hooks['tool.execute.before']({ tool: 'apply_patch', sessionID: session }, { args: { patchText: patch } }));
  writeFileSync(file, 'export const one = 1;\nexport function load() { try { read(); } catch {} }\n');
  await hooks['tool.execute.after']({ tool: 'apply_patch', sessionID: session, args: { patchText: patch } }, { title: 'apply_patch', output: 'ok', metadata: {} });
  assert.ok(existsSync(marker), 'the gate recorded the touch');
  const state = JSON.parse(readFileSync(marker, 'utf8'));
  assert.ok(state.files.some((f) => f.endsWith('appended.ts')), 'the end of the turn will read the file');
  assert.ok(Object.keys(state.baselines).some((f) => f.endsWith('appended.ts')), 'and knows how it arrived');
  rmSync(marker, { force: true });
});

test('parsePatch turns Update hunks into edits', async () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.ts',
    '@@',
    ' const keep = 1;',
    '-const old = 2;',
    '+const fresh = 2;',
    '*** End Patch',
  ].join('\n');
  const calls = await parsePatch(patch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool_name, 'MultiEdit');
  assert.equal(calls[0].tool_input.edits[0].old_string, 'const keep = 1;\nconst old = 2;');
  assert.equal(calls[0].tool_input.edits[0].new_string, 'const keep = 1;\nconst fresh = 2;');
});

test('arg aliases and shape inference cover unknown writers', async () => {
  assert.equal((await normalize('write', { filePath: '/tmp/a.ts', content: 'x' }))[0].tool_name, 'Write');
  assert.equal((await normalize('write', { filepath: '/tmp/a.ts', content: 'x' }))[0].tool_name, 'Write');
  assert.equal((await normalize('write', { path: '/tmp/a.ts', content: 'x' }))[0].tool_name, 'Write');
  assert.equal((await normalize('mcp_custom_write', { filePath: '/tmp/a.ts', content: 'x' }))[0].tool_name, 'Write');
  assert.equal((await normalize('mcp_custom_edit', { filePath: '/tmp/a.ts', oldString: 'a', newString: 'b' }))[0].tool_name, 'Edit');
  assert.deepEqual(await normalize('bash', { command: 'ls' }), []);
  assert.deepEqual(await normalize('read', { filePath: '/tmp/a.ts' }), []);
});

test('after records the touched file for the end-of-turn check', async () => {
  const session = sid('h');
  const marker = join(tmpdir(), 'smugan-turn-' + session + '.json');
  rmSync(marker, { force: true });
  const file = join(proj, 'src', 'touched.ts');
  writeFileSync(file, 'export const touched = 1;\n');
  const output = { title: 'write', output: 'ok', metadata: {} };
  await hooks['tool.execute.after']({ tool: 'write', sessionID: session, args: { filePath: file, content: '' } }, output);
  assert.ok(existsSync(marker), 'the gate recorded the touch');
  assert.ok(JSON.parse(readFileSync(marker, 'utf8')).files.some((f) => f.endsWith('touched.ts')));
  rmSync(marker, { force: true });
});

test('a relative path is read from the session folder, not from the folder the server runs in', async () => {
  const project = makeProject();
  writeFileSync(join(project, 'src', 'util.ts'), 'export const one = 1;\nexport const two = 2;\n');
  // This process runs in the adapter's folder; the session lives in `project`.
  const session = await smugan({ client: fakeClient(), directory: project });
  const sessionID = sid('rel');
  const marker = join(tmpdir(), 'smugan-turn-' + sessionID + '.json');
  const swallow = 'export function swallow() { try { JSON.parse("x"); } catch {} }';
  const patchText = ['*** Begin Patch', '*** Update File: src/util.ts', '@@', ' export const two = 2;', '+' + swallow, '*** End Patch'].join('\n');
  try {
    await assert.rejects(() => session['tool.execute.before']({ tool: 'apply_patch', sessionID }, { args: { patchText } }), /empty-catch/);
    await assert.rejects(() => session['tool.execute.before']({ tool: 'edit', sessionID }, { args: { filePath: 'src/util.ts', oldString: 'export const two = 2;', newString: 'export const two = 2;\n' + swallow } }), /empty-catch/);
    await session['tool.execute.after']({ tool: 'write', sessionID, args: { filePath: 'src/util.ts', content: '' } }, { title: 'write', output: 'ok', metadata: {} });
    const slashes = (file) => file.replace(/\\/g, '/');
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')).files.map(slashes), [slashes(join(project, 'src', 'util.ts'))], 'the end of the turn reads the file where the session wrote it');
  } finally {
    rmSync(marker, { force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('after appends the project eslint failure to what the model reads', async () => {
  const proj2 = makeProject();
  const eslintBin = join(proj2, 'node_modules', 'eslint', 'bin');
  mkdirSync(eslintBin, { recursive: true });
  // The 0.10.0 gate parses `--format json` stdout; a crashed eslint fails open.
  writeFileSync(
    join(eslintBin, 'eslint.js'),
    'console.log(JSON.stringify([{ filePath: "bad.js", messages: [{ ruleId: "fake-rule", message: "fake-eslint: boom", line: 1 }] }])); process.exit(1);',
  );
  writeFileSync(join(proj2, '.eslintrc.json'), '{}');
  const file = join(proj2, 'src', 'bad.js');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const bad = 1;\n');

  const output = { title: 'write', output: 'File written', metadata: {} };
  await hooks['tool.execute.after']({ tool: 'write', sessionID: sid('i'), args: { filePath: file, content: '' } }, output);
  assert.match(output.output, /^File written/);
  assert.match(output.output, /fake-eslint: boom/);
  rmSync(proj2, { recursive: true, force: true });
});

test('a missing gate engine disables everything instead of breaking the session', async () => {
  const saved = process.env.SMUGAN_GATE_DIR;
  process.env.SMUGAN_GATE_DIR = join(proj, 'nope');
  try {
    await assert.doesNotReject(
      () => before('write', {
        filePath: join(proj, 'supabase', 'migrations', '0003_x.sql'),
        content: 'create table clientes (nome_completo text);\n',
      }),
    );
  } finally {
    process.env.SMUGAN_GATE_DIR = saved;
  }
});

test('warn mode: a violating write is not rejected and its findings reach the tool result', async () => {
  const lenient = makeProject('{"mode":"warn"}');
  try {
    const session = sid('w');
    const file = join(lenient, 'src', 'risky.ts');
    const args = { filePath: file, content: 'export function risky() { try { throw new Error("x"); } catch {} }\n' };
    await assert.doesNotReject(() => before('write', args, session));
    writeFileSync(file, args.content);
    const output = { title: 'write', output: 'File written', metadata: {} };
    await hooks['tool.execute.after']({ tool: 'write', sessionID: session, args }, output);
    assert.match(output.output, /^File written/);
    assert.match(output.output, /warn mode, nothing blocked[\s\S]*empty-catch/);
    rmSync(join(tmpdir(), 'smugan-turn-' + session + '.json'), { force: true });
  } finally {
    rmSync(lenient, { recursive: true, force: true });
  }
});
