// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'rls';
const MIG = 'supabase/migrations/0001_init.sql';

test('table created without RLS in a migration is flagged', () => {
  const v = ofRule(run(MIG, 'create table notes (id uuid primary key);'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /notes/);
  assert.match(v[0].message, /enable row level security/);
});

test('table with RLS enabled in the same file passes', () => {
  const sql = `create table notes (id uuid primary key);
alter table notes enable row level security;
create policy "own rows" on notes for select using (auth.uid() = user_id);`;
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});

test('schema-qualified names match', () => {
  const sql = `create table public.notes (id uuid);
alter table public.notes enable row level security;`;
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});

test('platform schemas are skipped', () => {
  assert.equal(ofRule(run(MIG, 'create table auth.mirror (id uuid);'), R).length, 0);
  assert.equal(ofRule(run(MIG, 'create table storage.things (id uuid);'), R).length, 0);
});

test('temp tables are skipped', () => {
  assert.equal(ofRule(run(MIG, 'create temp table scratch (id int);'), R).length, 0);
});

test('exempt option skips a table', () => {
  const v = ofRule(run(MIG, 'create table reference_data (id int);', { rls: { exempt: ['reference_data'] } }), R);
  assert.equal(v.length, 0);
});

test('only applies inside migrations paths', () => {
  assert.equal(ofRule(run('db/seed.sql', 'create table notes (id uuid);'), R).length, 0);
});

test('multiple tables report each missing one', () => {
  const sql = `create table a_things (id uuid);
alter table a_things enable row level security;
create table b_things (id uuid);`;
  const v = ofRule(run(MIG, sql), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /b_things/);
});

test('supabase db diff output, with quoted schema and table, is read by table name', () => {
  const enabled = 'create table "public"."employees" (\n    "id" integer not null\n);\n\nalter table "public"."employees" enable row level security;';
  assert.equal(ofRule(run(MIG, enabled), R).length, 0);
  const v = ofRule(run(MIG, 'create table "public"."employees" (\n    "id" integer not null\n);'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /table "employees"/);
});

test('a migration that disables RLS is flagged', () => {
  for (const sql of ['alter table public.profiles disable row level security;', 'alter table if exists "public"."profiles" disable row level security;']) {
    const v = ofRule(run('supabase/migrations/0002_fix.sql', sql), R);
    assert.equal(v.length, 1, sql);
    assert.match(v[0].message, /RLS disabled on table "profiles"/);
  }
});

test('disabling RLS on an exempt table or a platform schema passes', () => {
  assert.equal(ofRule(run(MIG, 'alter table storage.buckets disable row level security;'), R).length, 0);
  assert.equal(ofRule(run(MIG, 'alter table countries disable row level security;', { rls: { exempt: ['countries'] } }), R).length, 0);
});

test('a rollback that drops the table, or a down migration, may disable RLS', () => {
  const rollback = 'alter table public.notes disable row level security;\ndrop table if exists public.notes, public.tags;';
  assert.equal(ofRule(run('supabase/migrations/0003_rollback.sql', rollback), R).length, 0);
  const off = 'alter table notes disable row level security;';
  assert.equal(ofRule(run('db/migrations/000002_notes.down.sql', off), R).length, 0);
  assert.equal(ofRule(run('migrations/2025-01-01-000000_enable_rls/down.sql', off), R).length, 0);
  const other = 'alter table public.profiles disable row level security;\ndrop table public.notes;';
  assert.equal(ofRule(run('supabase/migrations/0003_rollback.sql', other), R).length, 1);
  assert.equal(ofRule(run('supabase/migrations/20250101000000_lock_down.sql', off), R).length, 1);
});

test('RLS turned back on later in the same file is a backfill, not an exposure', () => {
  const backfill = "alter table public.profiles disable row level security;\nupdate public.profiles set plan = 'free';\nalter table public.profiles enable row level security;";
  assert.equal(ofRule(run(MIG, backfill), R).length, 0);
  const leftOff = 'alter table public.profiles enable row level security;\nalter table public.profiles disable row level security;';
  assert.equal(ofRule(run(MIG, leftOff), R).length, 1);
});

test('the down section of a goose, dbmate or sql-migrate file may disable RLS; its up section may not', () => {
  const off = 'alter table notes disable row level security;';
  for (const [up, down] of [['-- +goose Up', '-- +goose Down'], ['-- migrate:up', '-- migrate:down'], ['-- +migrate Up', '-- +migrate Down']]) {
    const rollback = `${up}\nalter table notes enable row level security;\n\n${down}\n${off}\n`;
    assert.equal(ofRule(run('db/migrations/20250101_notes.sql', rollback), R).length, 0, down);
    const exposed = `${up}\n${off}\n\n${down}\nalter table notes enable row level security;\n`;
    const v = ofRule(run('db/migrations/20250101_notes.sql', exposed), R);
    assert.equal(v.length, 1, up);
    assert.equal(v[0].line, 2);
    // A drop in the rollback runs only on undo; the up section still leaves RLS off.
    const droppedOnUndo = `${up}\n${off}\n\n${down}\ndrop table notes;\n`;
    assert.equal(ofRule(run('db/migrations/20250101_notes.sql', droppedOnUndo), R).length, 1, `${down} drop`);
  }
});
