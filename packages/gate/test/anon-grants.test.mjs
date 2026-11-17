// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'anon-grants';
const MIG = 'supabase/migrations/0001_init.sql';

test('GRANT to anon on a non-public schema is flagged', () => {
  const v = ofRule(run(MIG, 'GRANT SELECT ON ALL TABLES IN SCHEMA app_private TO anon;'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /app_private/);
});

test('GRANT to authenticated on a qualified table is flagged', () => {
  const v = ofRule(run(MIG, 'GRANT SELECT, INSERT ON app_private.accounts TO authenticated;'), R);
  assert.equal(v.length, 1);
});

test('GRANT USAGE on a data schema to mixed roles is flagged', () => {
  const sql = 'GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;';
  const v = ofRule(run(MIG, sql), R);
  assert.equal(v.length, 1);
});

test('ALTER DEFAULT PRIVILEGES GRANT to anon on a data schema is flagged', () => {
  const sql = 'ALTER DEFAULT PRIVILEGES IN SCHEMA app_private GRANT SELECT ON TABLES TO anon;';
  const v = ofRule(run(MIG, sql), R);
  assert.equal(v.length, 1);
});

test('GRANT to anon on public is allowed (Data API / PostgREST)', () => {
  const sql = 'GRANT USAGE ON SCHEMA public TO anon, authenticated;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;';
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});

test('GRANT on an unqualified table is treated as public and allowed', () => {
  assert.equal(ofRule(run(MIG, 'GRANT SELECT ON users TO anon;'), R).length, 0);
});

test('GRANT to service_role only is allowed', () => {
  assert.equal(ofRule(run(MIG, 'GRANT ALL ON ALL TABLES IN SCHEMA app_private TO service_role;'), R).length, 0);
});

test('REVOKE is not a GRANT', () => {
  assert.equal(ofRule(run(MIG, 'REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM anon, authenticated;'), R).length, 0);
});

test('only applies inside migrations paths', () => {
  assert.equal(ofRule(run('db/seed.sql', 'GRANT SELECT ON ALL TABLES IN SCHEMA app_private TO anon;'), R).length, 0);
});

test('ALTER DEFAULT PRIVILEGES FOR ROLE … IN SCHEMA still flags', () => {
  const sql = 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private GRANT SELECT ON TABLES TO anon;';
  const v = ofRule(run(MIG, sql), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /app_private/);
});

test('GRANT ON TABLE ONLY schema.table is flagged', () => {
  const v = ofRule(run(MIG, 'GRANT SELECT ON TABLE ONLY app_private.accounts TO anon;'), R);
  assert.equal(v.length, 1);
});

test('GRANT listing a data schema next to public is flagged', () => {
  const v = ofRule(run(MIG, 'GRANT SELECT ON ALL TABLES IN SCHEMA public, app_private TO anon;'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /app_private/);
});

test('GRANT on mixed qualified tables flags only the data schema', () => {
  const v = ofRule(run(MIG, 'GRANT SELECT ON public.users, app_private.accounts TO anon;'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /app_private/);
});

test('a type in a FUNCTION signature is not a grant target', () => {
  const sql = 'GRANT EXECUTE ON FUNCTION public.foo(integer, app_private.bar) TO anon;';
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});
