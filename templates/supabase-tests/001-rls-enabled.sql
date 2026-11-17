-- Global guard: RLS on every table in public. Fails the suite the moment a
-- migration ships a table without row level security.
begin;
select plan(1);
select tests.rls_enabled('public');
select * from finish();
rollback;
