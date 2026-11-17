-- smugan test setup — pgTAP + minimal Supabase test helpers.
-- Self-contained port inspired by usebasejump/supabase-test-helpers (MIT),
-- so no dbdev/network install is needed. Runs first (000-) and COMMITS the
-- tests schema so later test files can use it. Safe to re-run.
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Creates a fake authenticated user and returns its id.
create or replace function tests.create_supabase_user(identifier text)
returns uuid
security definer
set search_path = auth, pg_temp
language plpgsql as $$
declare
  new_user_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    identifier || '@test.smugan.local',
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('test_identifier', identifier),
    now(),
    now()
  );
  return new_user_id;
end;
$$;

create or replace function tests.get_supabase_uid(identifier text)
returns uuid
security definer
set search_path = auth, pg_temp
language sql as $$
  select id from auth.users
  where raw_user_meta_data ->> 'test_identifier' = identifier
  limit 1;
$$;

-- Switches the current transaction to an authenticated user (RLS applies).
create or replace function tests.authenticate_as(identifier text)
returns void
language plpgsql as $$
declare
  user_id uuid := tests.get_supabase_uid(identifier);
begin
  if user_id is null then
    raise exception 'tests.authenticate_as: unknown test user %', identifier;
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', user_id,
      'role', 'authenticated',
      'email', identifier || '@test.smugan.local'
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Back to anon (RLS applies, no user).
create or replace function tests.clear_authentication()
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- One assertion: every plain table in the schema has RLS enabled.
create or replace function tests.rls_enabled(testing_schema text)
returns text
language sql as $$
  select extensions.is(
    (select count(*)::int
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = testing_schema
        and c.relkind = 'r'
        and not c.relrowsecurity),
    0,
    'all tables in schema "' || testing_schema || '" have row level security enabled'
  );
$$;

grant usage on schema tests to postgres, anon, authenticated, service_role;
grant execute on all functions in schema tests to postgres, anon, authenticated, service_role;

-- Mirror the platform's PostgREST grant model: API roles hold broad table
-- grants and RLS is the security layer these tests exercise. On a bare
-- `supabase db start` database, migration-created tables can lack these
-- grants, which would abort the tests with "permission denied" before any
-- policy is ever evaluated.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Sanity check: this file is itself a pgTAP test.
begin;
select plan(1);
select ok(true, 'smugan test helpers installed');
select * from finish();
rollback;
