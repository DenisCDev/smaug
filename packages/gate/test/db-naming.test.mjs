// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'db-naming';

test('flags Portuguese column in create table', () => {
  const v = ofRule(run('supabase/migrations/0001_init.sql',
    'create table patients (\n  id uuid primary key,\n  nome_completo text\n);'), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
  assert.match(v[0].message, /nome/);
});

test('flags Portuguese table name', () => {
  const v = ofRule(run('db/schema.sql', 'create table pacientes (id uuid);'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /paciente/);
});

test('flags accented identifier', () => {
  const v = ofRule(run('db/x.sql', 'alter table products add column preço numeric;'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /accented/);
});

test('flags camelCase identifier', () => {
  const v = ofRule(run('db/x.sql', 'create table events (\n  createdAt timestamptz\n);'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /snake_case/);
});

test('clean English snake_case passes', () => {
  const sql = `create table patients (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    created_at timestamptz not null default now()
  );
  create index patients_full_name_idx on patients (full_name);`;
  assert.equal(ofRule(run('db/x.sql', sql), R).length, 0);
});

test('add constraint is not an identifier', () => {
  const sql = 'alter table patients add constraint patients_pkey primary key (id);';
  assert.equal(ofRule(run('db/x.sql', sql), R).length, 0);
});

test('sentence-like policy names skip the case check', () => {
  const sql = 'create policy "Users can read own rows" on patients for select using (auth.uid() = user_id);';
  assert.equal(ofRule(run('db/x.sql', sql), R).length, 0);
});

test('Portuguese policy name is still flagged', () => {
  const sql = 'create policy "usuarios podem ler" on patients for select using (true);';
  const v = ofRule(run('db/x.sql', sql), R);
  assert.equal(v.length, 1);
});

test('identifiers inside comments and strings are ignored', () => {
  const sql = "-- create table usuarios\nselect 'create table clientes';";
  assert.equal(ofRule(run('db/x.sql', sql), R).length, 0);
});

test('allow option whitelists an identifier', () => {
  const sql = 'create table products (\n  nome_completo text\n);';
  const v = ofRule(run('db/x.sql', sql, { 'db-naming': { allow: ['nome_completo'] } }), R);
  assert.equal(v.length, 0);
});

test('only applies to .sql files', () => {
  assert.equal(ofRule(run('src/a.ts', 'const q = 1; // create table usuarios'), R).length, 0);
});

test('a quoted schema-qualified table (supabase db diff) is checked by table and column names', () => {
  const v = ofRule(run('supabase/migrations/0001_init.sql', 'create table "public"."pacientes" (\n    "id" uuid,\n    "nome" text\n);'), R);
  assert.deepEqual(v.map((x) => x.line), [1, 3]);
  assert.match(v[0].message, /"pacientes"/);
});

test('a table or object renamed to a Portuguese name is flagged', () => {
  const v = ofRule(run('db/x.sql', 'alter table clients rename to clientes;\nalter index clients_idx rename to "clientesIdx";'), R);
  assert.deepEqual(v.map((x) => x.line), [1, 2]);
  assert.match(v[0].message, /clientes/);
  assert.equal(ofRule(run('db/x.sql', 'alter table clientes rename to clients;'), R).length, 0, 'renaming away from it is the fix');
});

test('temporary and unlogged tables are checked by table and column names', () => {
  const v = ofRule(run('db/x.sql', 'create unlogged table pedidos (\n  id uuid\n);\ncreate temp table staging (\n  nome text\n);'), R);
  assert.deepEqual(v.map((x) => x.line), [1, 5]);
});

test('materialized views, procedures, schemas and sequences are checked by name', () => {
  const sql = 'create materialized view vendas_mensais as select 1;\ncreate or replace procedure fecha_pedido() language sql as $$ select 1 $$;\ncreate schema if not exists cobrancas;\ncreate sequence pedido_seq;';
  // Findings come in pattern order, not line order.
  const v = ofRule(run('db/x.sql', sql), R);
  assert.deepEqual(v.map((x) => x.line).sort(), [1, 2, 3, 4]);
  const clean = 'create materialized view monthly_sales as select 1;\ncreate schema billing;\ncreate sequence order_seq;';
  assert.equal(ofRule(run('db/x.sql', clean), R).length, 0);
});
