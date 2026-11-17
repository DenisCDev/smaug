// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/hook.mjs';

/** @returns {string} project root with a package.json anchor */
function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-test-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}');
  return dir;
}

test('pre blocks a Write that introduces a violation', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'config.toml'), '');
    const file = join(dir, 'supabase', 'migrations', '0001_init.sql');
    const result = await runHook('pre', {
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'create table patients (\n  nome_completo text\n);' },
    });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /db-naming/);
    assert.match(result.stderr, /rls/); // table without RLS in a migration
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre lets clean content through', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    // v2 contract: a clean migration also has its pgTAP test and a
    // SECURITY_NOTES.md entry describing the table's access rules.
    mkdirSync(join(dir, 'supabase', 'tests'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'tests', '100-patients.test.sql'), '-- pgTAP scenarios for patients\n');
    writeFileSync(join(dir, 'SECURITY_NOTES.md'), '- Tabela `patients`: visitante não lê nada; usuário logado lê e edita só os próprios registros.\n');
    const file = join(dir, 'supabase', 'migrations', '0001_init.sql');
    const result = await runHook('pre', {
      tool_name: 'Write',
      tool_input: {
        file_path: file,
        content: 'create table patients (id uuid);\nalter table patients enable row level security;',
      },
    });
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre only blocks NEW violations on Edit', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'console.log("old");\nexport const x = 1;\n');
    // Edit that keeps the legacy console.log untouched: allowed.
    const untouched = await runHook('pre', {
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: 'export const x = 1;', new_string: 'export const x = 2;' },
    });
    assert.equal(untouched.exitCode, 0);
    // Edit that adds a second console.log: blocked.
    const adding = await runHook('pre', {
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: 'export const x = 1;', new_string: 'console.log("new");\nexport const x = 1;' },
    });
    assert.equal(adding.exitCode, 2);
    assert.match(adding.stderr, /console-log/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre judges an Edit on the text it writes when new_string carries a $ sequence', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'price.ts');
    writeFileSync(file, 'console.log("first");\nexport const label = \'x\';\nconsole.log("last");\n');
    // $' and $` are replacement patterns: read as such, they copy the rest of
    // the file into the judged text and the legacy log looks newly added.
    for (const literal of ["'R$'", '`R$`']) {
      const result = await runHook('pre', {
        tool_name: 'Edit',
        tool_input: { file_path: file, old_string: "export const label = 'x';", new_string: `export const label = ${literal};` },
      });
      assert.equal(result.exitCode, 0, `${literal}: ${result.stderr}`);
    }
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    const migration = join(dir, 'supabase', 'migrations', '0001_touch.sql');
    writeFileSync(migration, '-- functions\n');
    // $$ read as a pattern becomes $, the body stops being dollar-quoted and
    // the clauses after it are cut off at the body's first semicolon.
    const definer = await runHook('pre', {
      tool_name: 'Edit',
      tool_input: {
        file_path: migration,
        old_string: '-- functions',
        new_string: "create function public.touch() returns void\nsecurity definer\nas $$ begin perform 1; end; $$\nlanguage plpgsql\nset search_path = '';",
      },
    });
    assert.equal(definer.exitCode, 0, definer.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression (production app, jul/2026): every dead-imports pre-block on Edit was a
// legitimate intermediate state of a multi-step change (import first, usage
// next — or a rename split across two Edits), and the friction trained
// Bash-heredoc bypasses. The turn's FINAL state is still guarded by the stop
// hook; a Write hands over a whole file, so there the check still applies.

test('pre allows an Edit that adds an import before its usage exists', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    const result = await runHook('pre', {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'export const x = 1;',
        new_string: "import { join } from 'node:path';\nexport const x = 1;",
      },
    });
    assert.equal(result.exitCode, 0, 'intermediate import-without-usage is the stop hook’s business, not pre’s');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre allows a MultiEdit whose intermediate state carries an unused import', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    const result = await runHook('pre', {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: file,
        edits: [
          { old_string: 'export const x = 1;', new_string: "import { join } from 'node:path';\nexport const x = 1;" },
        ],
      },
    });
    assert.equal(result.exitCode, 0, 'MultiEdit takes the same intermediate-state exemption as Edit');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre still blocks a Write whose final content carries a dead import', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    const result = await runHook('pre', {
      tool_name: 'Write',
      tool_input: { file_path: file, content: "import { join } from 'node:path';\nexport const x = 1;\n" },
    });
    assert.equal(result.exitCode, 2, 'a whole file IS a final state');
    assert.match(result.stderr, /dead-imports/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown tools and missing file_path are ignored', async () => {
  assert.equal((await runHook('pre', { tool_name: 'Bash', tool_input: { command: 'ls' } })).exitCode, 0);
  assert.equal((await runHook('pre', { tool_name: 'Write', tool_input: {} })).exitCode, 0);
  assert.equal((await runHook('pre', {})).exitCode, 0);
});

test('post passes when the project has no eslint/tsc installed', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    const result = await runHook('post', {
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'export const x = 1;\n' },
    });
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project config disables a check for the hook too', async () => {
  const dir = makeProject();
  try {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ checks: { 'console-log': false } }));
    mkdirSync(join(dir, 'src'));
    const file = join(dir, 'src', 'a.ts');
    const result = await runHook('pre', {
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'console.log("allowed here");\n' },
    });
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('warn mode: pre reports the same violations as context and never exits 2', async () => {
  const dir = makeProject();
  try {
    writeFileSync(join(dir, 'smugan.config.json'), '{"mode":"warn"}');
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'config.toml'), '');
    const file = join(dir, 'supabase', 'migrations', '0001_init.sql');
    const result = await runHook('pre', {
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'create table patients (\n  nome_completo text\n);' },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '', 'exit-0 stderr is a hold or a deferred deny for some adapters');
    assert.match(result.context ?? '', /warn mode, nothing blocked/);
    assert.match(result.context ?? '', /db-naming/);
    assert.match(result.context ?? '', /rls/);
    assert.match(JSON.parse(result.stdout ?? '{}').systemMessage, /db-naming/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('warn mode set only in the personal layer still holds nothing', async () => {
  const dir = makeProject();
  try {
    writeFileSync(join(dir, 'smugan.config.json'), '{}');
    writeFileSync(join(dir, 'smugan.local.json'), '{"mode":"warn"}');
    mkdirSync(join(dir, 'src'));
    const result = await runHook('pre', {
      tool_name: 'Write',
      tool_input: { file_path: join(dir, 'src', 'a.ts'), content: 'export function f() { try { g(); } catch {} }\n' },
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.context ?? '', /empty-catch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('post lints .mts and .cts modules with the project eslint, like .ts', async () => {
  const dir = makeProject();
  try {
    mkdirSync(join(dir, 'node_modules', 'eslint', 'bin'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      'console.log(JSON.stringify([{ filePath: "a", messages: [{ ruleId: "no-undef", severity: 2, message: "boom is not defined", line: 1 }] }])); process.exit(1);',
    );
    writeFileSync(join(dir, 'eslint.config.mjs'), 'export default [];\n');
    mkdirSync(join(dir, 'src'));
    for (const name of ['a.mts', 'a.cts']) {
      const file = join(dir, 'src', name);
      writeFileSync(file, 'export const x = boom;\n');
      const result = await runHook('post', { tool_name: 'Write', tool_input: { file_path: file } });
      assert.equal(result.exitCode, 2, name);
      assert.match(result.stderr, /eslint \(src\/a\.[mc]ts\) — 1 new/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
