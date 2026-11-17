// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'rls-policy';
const MIG = 'supabase/migrations/0004_notes_policies.sql';
const OWNER = '((select auth.uid()) = user_id)';

test('a policy that lets a browser role update or delete every row is flagged', () => {
  for (const sql of [
    'create policy "allow all" on notes for all using (true) with check (true);',
    'create policy notes_update on public.notes for update to authenticated using (true);',
    'create policy notes_delete on notes for delete to anon using ( 1 = 1 );',
    'create policy "p" on "public"."notes" as permissive for all to public using ((true));',
    // No FOR means every command, no TO means every role.
    'create policy notes_open on notes using (true);',
    `create policy notes_mixed on notes\n  for all\n  to authenticated, service_role\n  using (true)\n  with check ${OWNER};`,
  ]) {
    const v = ofRule(run(MIG, sql), R);
    assert.equal(v.length, 1, sql);
    assert.equal(v[0].line, 1);
    assert.match(v[0].message, /every row of "notes"/);
  }
});

test('the message names the policy, the roles and what they can do', () => {
  const [v] = ofRule(run(MIG, 'create policy "staff edits" on notes for update to authenticated using (true);'), R);
  assert.match(v.message, /^policy "staff edits" lets authenticated update every row of "notes" \(using \(true\)\)/);
  const [open] = ofRule(run(MIG, 'create policy notes_delete on notes for delete using (true);'), R);
  assert.match(open.message, /^policy "notes_delete" lets every role delete every row of "notes"/);
  const [all] = ofRule(run(MIG, 'create policy notes_all on notes to anon, authenticated using (true);'), R);
  assert.match(all.message, /^policy "notes_all" lets anon, authenticated update and delete every row of "notes"/);
});

test('a scoped policy, a public read, an open insert, a restrictive policy and a server role pass', () => {
  for (const sql of [
    `create policy notes_update on notes for update to authenticated using ${OWNER} with check ${OWNER};`,
    `create policy notes_delete on notes for delete using (auth.uid() = user_id);`,
    `create policy notes_all on notes for all using ${OWNER};`,
    // A catalog anyone may read is a product decision.
    'create policy notes_read on notes for select using (true);',
    // A contact form or a waitlist inserts for anyone: the pgTAP test says who may.
    'create policy leads_insert on leads for insert to anon with check (true);',
    'create policy notes_floor on notes as restrictive for all using (true);',
    // PostgreSQL shows no row to a permissive policy without USING (rowsecurity.c, add_security_quals).
    'create policy notes_update on notes for update to authenticated with check (true);',
    'create policy notes_delete on notes for delete to authenticated;',
    'create policy notes_service on notes for all to service_role using (true) with check (true);',
    '-- create policy notes_open on notes for all using (true);',
    "select 'create policy notes_open on notes for all using (true)';",
  ]) {
    assert.deepEqual(ofRule(run(MIG, sql), R), [], sql);
  }
});

test('a policy that decides access from user_metadata is flagged, whatever the command', () => {
  for (const sql of [
    "create policy notes_admin on notes for select to authenticated using (((select auth.jwt()) -> 'user_metadata' ->> 'is_admin')::bool);",
    "create policy notes_admin on notes for all using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');",
    "create policy notes_admin on notes for delete using ((select raw_user_meta_data ->> 'role' from auth.users where id = auth.uid()) = 'admin');",
  ]) {
    const v = ofRule(run(MIG, sql), R);
    assert.equal(v.length, 1, sql);
    assert.match(v[0].message, /the user can change/);
  }
});

test('app_metadata and a mention of user_metadata in a comment pass', () => {
  for (const sql of [
    "create policy notes_admin on notes for select using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');",
    `create policy notes_owner on notes for select\n  -- never user_metadata here: the user edits it\n  using ${OWNER};`,
    // The name of the table or of the policy is not what the policy reads.
    `create policy "read own" on user_metadata for select using ${OWNER};`,
    `create policy "not from user_metadata" on notes for select using ${OWNER};`,
  ]) {
    assert.deepEqual(ofRule(run(MIG, sql), R), [], sql);
  }
});

test('each policy of a migration is judged on its own line', () => {
  const sql = [
    'create table notes (id uuid primary key, user_id uuid not null);',
    'alter table notes enable row level security;',
    `create policy notes_read on notes for select using ${OWNER};`,
    'create policy notes_write on notes for update using (true);',
    `create policy notes_remove on notes for delete using ${OWNER};`,
    'create policy notes_purge on notes for delete to anon using (true);',
  ].join('\n');
  assert.deepEqual(ofRule(run(MIG, sql), R).map((v) => v.line), [4, 6]);
});

test('smugan-ignore suppresses with a written reason', () => {
  const sql = '-- smugan-ignore rls-policy: single-tenant back office, every signed-in user is staff\ncreate policy staff_all on notes for all to authenticated using (true) with check (true);';
  assert.deepEqual(ofRule(run(MIG, sql), R), []);
});

test('only migrations are read, and only in a Supabase project unless turned on', () => {
  const sql = 'create policy notes_open on notes for all using (true);';
  assert.equal(ofRule(run('queries/policies.sql', sql), R).length, 0);
  assert.equal(ofRule(run('db/migrations/0001_init.sql', sql), R).length, 0, 'plain Postgres: off by default');
  assert.equal(ofRule(run('db/migrations/0001_init.sql', sql, { 'rls-policy': true }), R).length, 1);
  assert.equal(ofRule(run(MIG, sql, { 'rls-policy': false }), R).length, 0);
});
