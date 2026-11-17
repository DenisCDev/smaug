// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'search-path';
const MIG = 'supabase/migrations/0003_auth_trigger.sql';

const BODY = "$$\nbegin\n  insert into public.profiles (id) values (new.id);\n  return new;\nend;\n$$";

test('a security definer function or procedure without a fixed search_path is flagged', () => {
  for (const sql of [
    `create or replace function public.handle_new_user() returns trigger language plpgsql security definer as ${BODY};`,
    `create function handle_new_user() returns trigger as ${BODY} language plpgsql security definer;`,
    'create procedure public.archive_orders() language sql security definer as $body$ delete from orders; $body$;',
    // A SET run inside the body is code, not the function's own setting.
    'create function public.touch() returns void language plpgsql as $$ begin set local search_path = public; perform 1; end $$ security definer;',
  ]) {
    const v = ofRule(run(MIG, sql), R);
    assert.equal(v.length, 1, sql);
    assert.equal(v[0].line, 1);
    assert.match(v[0].message, /has no fixed search_path/);
  }
});

test('a pinned search_path, before or after the body or in a later alter, passes', () => {
  for (const sql of [
    `create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as ${BODY};`,
    `create function public.handle_new_user() returns trigger as ${BODY} language plpgsql security definer set search_path = public, pg_temp;`,
    `create function public.handle_new_user() returns trigger language plpgsql security definer as ${BODY};\nalter function public.handle_new_user() set search_path = '';`,
  ]) {
    assert.equal(ofRule(run(MIG, sql), R).length, 0, sql);
  }
});

test('an alter before a create or replace does not pin the new definition', () => {
  const sql = `alter function public.handle_new_user() set search_path = '';\ncreate or replace function public.handle_new_user() returns trigger language plpgsql security definer as ${BODY};`;
  const v = ofRule(run(MIG, sql), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
});

test('invoker functions and the words inside a body are not the clause', () => {
  const sql = [
    `create function public.count_notes() returns bigint language sql as $$ select count(*) from notes; $$;`,
    "create function public.audit() returns trigger language plpgsql as $f$ begin raise notice 'security definer'; return new; end; $f$;",
  ].join('\n');
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});

test('platform schemas are left to the platform', () => {
  const sql = `create function auth.uid_helper() returns uuid language sql security definer as $$ select null::uuid $$;`;
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});
