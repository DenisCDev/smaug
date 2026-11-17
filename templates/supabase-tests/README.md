# RLS tests (pgTAP)

RLS being present is not RLS being correct. These tests prove the **behavior** of the policies
with real, impersonated users — what smugan's static check cannot see.

## Files

- `000-setup.sql` — installs pgTAP and the helpers (`tests.create_supabase_user`,
  `tests.authenticate_as`, `tests.clear_authentication`, `tests.rls_enabled`). A
  self-contained port inspired by [basejump/supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers) (MIT), without dbdev or network access.
- `001-rls-enabled.sql` — global guard: every table in `public` has RLS enabled.
- `table-rls.test.sql.template` — per-table template with the required scenarios:
  **anon denied (read and write) · owner reads only their own rows · another signed-in user reads zero**.

## Usage

```bash
# for each new table: copy the template, replace __TABLE__ and the insert columns
cp table-rls.test.sql.template 100-my_table.test.sql

# run (requires Docker + supabase start):
supabase test db
```

smugan's `rls-tests` check blocks a migration that creates a table without a matching test
file in this folder. Governed exception: `-- smugan-ignore rls-tests: <reason>`.
