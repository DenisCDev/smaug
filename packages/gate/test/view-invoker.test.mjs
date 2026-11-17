// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'view-invoker';
const MIG = 'supabase/migrations/0002_views.sql';

test('a public view without security_invoker is flagged', () => {
  for (const sql of [
    'create view public.profile_names as select id, full_name from profiles;',
    'create or replace view profile_names as\n  select id, full_name from profiles;',
    'create view profile_names with (security_invoker = false) as select id from profiles;',
  ]) {
    const v = ofRule(run(MIG, sql), R);
    assert.equal(v.length, 1, sql);
    assert.match(v[0].message, /view "profile_names" reads its tables with its owner's rights/);
  }
});

test('security_invoker on the view, or set later in the file, passes', () => {
  for (const sql of [
    'create view profile_names with (security_invoker = true) as select id from profiles;',
    'create or replace view public.profile_names with (security_barrier, security_invoker) as select id from profiles;',
    'create view profile_names as select id from profiles;\nalter view profile_names set (security_invoker = on);',
  ]) {
    assert.equal(ofRule(run(MIG, sql), R).length, 0, sql);
  }
});

test('an alter before a create or replace does not count for the new definition', () => {
  const sql = 'alter view profile_names set (security_invoker = on);\ncreate or replace view profile_names as select id from profiles;';
  const v = ofRule(run(MIG, sql), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
});

test('temporary, materialized and non-public views are left alone', () => {
  const sql = [
    'create temp view scratch as select 1;',
    'create materialized view public.daily_totals as select 1;',
    'create view private.admin_stats as select count(*) from profiles;',
  ].join('\n');
  assert.equal(ofRule(run(MIG, sql), R).length, 0);
});

test('outside a Supabase project the rule stays off unless the config turns it on', () => {
  const sql = 'create view profile_names as select id from profiles;';
  assert.equal(ofRule(run('db/migrations/0002_views.sql', sql), R).length, 0);
  assert.equal(ofRule(run('db/migrations/0002_views.sql', sql, { [R]: true }), R).length, 1);
});
