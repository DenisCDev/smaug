// @ts-check
// RLS, pgTAP and the anon/authenticated grants are Supabase's model: those
// checks run by default only where the project declares Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeContent } from '../src/engine.mjs';
import { loadConfig } from '../src/config.mjs';

const MIGRATION = 'migrations/0001_init.sql';
const SQL = 'create table notes (id uuid primary key);\ngrant select on private.notes to anon;';

/** @param {Record<string, unknown>} pkg @param {(dir: string) => void} body */
function withProject(pkg, body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-stack-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} dir */
const rules = (dir) => new Set(analyzeContent(MIGRATION, SQL, loadConfig(dir)).map((v) => v.rule));

test('a plain Postgres project gets no Supabase checks, and keeps the rest', () => {
  withProject({ dependencies: { 'drizzle-orm': '0.36.0', pg: '8.13.0' } }, (dir) => {
    const found = rules(dir);
    for (const rule of ['rls', 'rls-tests', 'security-notes', 'anon-grants']) assert.equal(found.has(rule), false, rule);
    assert.equal(analyzeContent(MIGRATION, 'create table clientes (id uuid);', loadConfig(dir)).some((v) => v.rule === 'db-naming'), true);
  });
});

test('a Supabase project gets them, from a dependency or from supabase/config.toml', () => {
  withProject({ dependencies: { '@supabase/supabase-js': '2.45.0' } }, (dir) => {
    assert.ok(rules(dir).has('rls'));
    assert.ok(rules(dir).has('anon-grants'));
  });
  withProject({}, (dir) => {
    mkdirSync(join(dir, 'supabase'));
    writeFileSync(join(dir, 'supabase', 'config.toml'), '');
    assert.ok(rules(dir).has('rls'));
  });
});

test('the project config wins over detection either way', () => {
  withProject({ dependencies: { pg: '8.13.0' } }, (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ checks: { rls: true } }));
    assert.ok(rules(dir).has('rls'));
  });
  withProject({ dependencies: { '@supabase/supabase-js': '2.45.0' } }, (dir) => {
    writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ checks: { rls: false } }));
    assert.equal(rules(dir).has('rls'), false);
  });
});

test('adding Supabase later is seen without restarting a long-lived host', () => {
  withProject({ dependencies: { pg: '8.13.0' } }, (dir) => {
    assert.equal(rules(dir).has('rls'), false);
    const file = join(dir, 'package.json');
    writeFileSync(file, JSON.stringify({ dependencies: { pg: '8.13.0', '@supabase/supabase-js': '2.45.0' } }));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    assert.ok(rules(dir).has('rls'));
  });
});

test('in a monorepo the evidence can sit in the package that owns the migration', () => {
  withProject({ private: true, workspaces: ['apps/*'] }, (dir) => {
    const app = join(dir, 'apps', 'web');
    mkdirSync(join(app, 'db', 'migrations'), { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { '@supabase/supabase-js': '2.45.0' } }));
    const found = (/** @type {string} */ path) => new Set(analyzeContent(path, SQL, loadConfig(dir)).map((v) => v.rule));
    assert.ok(found('apps/web/db/migrations/0001_init.sql').has('rls'));
    // The Supabase CLI layout is evidence on its own, wherever the dependency lives.
    assert.ok(found('supabase/migrations/0001_init.sql').has('rls'));
    assert.equal(found('apps/api/migrations/0001_init.sql').has('rls'), false);
  });
});
