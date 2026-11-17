---
title: Checks
description: Every smugan rule id, where it runs, what it flags, its scope, a triggering and a passing example, known false negatives, and how to suppress it.
---

Each rule below is a module in [`packages/gate/src/checks/`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/). The examples come from the tests in [`packages/gate/test/`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/test/), or were checked against the rule's code.

## Where each rule runs

The columns use these meanings:

- **pre**: the hook that runs before a `Write`, `Edit` or `MultiEdit`. It blocks (exit code `2`) only the violations the edit introduces.
- **end of turn**: the `stop` hook. It analyzes every file the turn touched again and blocks what the turn introduced, compared with the file's first-touch baseline or git HEAD. It shows at most 20 lines per file.
- **check CLI**: `smugan check`. It lists every violation in the files it reads and exits `1`.

"Listed once" means the finding is part of one end-of-turn hold and is recorded, so it never holds the turn again. The detectors marked that way are covered in [End-of-turn detectors](/reference/end-of-turn-detectors/). With `"mode": "warn"` in the config, every blocking column only reports.

| Rule id | Area | pre | end of turn | check CLI |
|---|---|---|---|---|
| `db-naming` | SQL naming | blocks | blocks | lists |
| `rls` | Supabase RLS | blocks | blocks | lists |
| `rls-tests` | Supabase RLS | blocks | blocks | lists |
| `security-notes` | Supabase RLS | blocks | blocks | lists |
| `rls-policy` | Supabase RLS | blocks | blocks | lists |
| `view-invoker` | Supabase RLS | blocks | blocks | lists |
| `search-path` | Supabase functions | blocks | blocks | lists |
| `anon-grants` | Supabase grants | blocks | blocks | lists |
| `money-float` | SQL types | blocks | blocks | lists |
| `ui-strings` | UI copy (pt-BR) | blocks | blocks | lists |
| `no-any` | TypeScript | blocks | blocks | lists |
| `secrets` | Secrets | blocks | blocks | lists |
| `console-log` | Debug residue | blocks | blocks | lists |
| `dead-imports` | Dead code | blocks on `Write` only | blocks | lists |
| `stale-mutation` | Next.js server actions | blocks | blocks | lists |
| `empty-catch` | Error handling | blocks | blocks | lists |
| `fetch-timeout` | Outgoing calls | blocks | blocks | lists |
| `test-weakening` | Tests | blocks | blocks | lists |
| `await-in-loop` | N+1 queries | blocks, critical turn only | — | — |
| `assertion-weakening` | Tests | — | lost assertions block; removed tests listed once | — |
| `contract-drift` | Error/input contract | — | listed once | — |
| `clone` | Duplication | — | listed once | — |
| `exploration-residue` | Leftover files | — | listed once | — |
| `smugan-ignore` | Suppressions | blocks | blocks | lists |

The first 18 rules are the `CHECKS` list in [`checks/index.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/index.mjs). The hook skips `dead-imports` on `Edit` and `MultiEdit` because a change made in several steps passes through an unused import. The end of turn checks the final state instead ([`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs), `preHook`).

## Turning rules on and off

The logic is `checkEnabled` in [`config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs).

- **Any rule.** `"checks": { "<rule>": false }` turns it off. An object passes options to it and keeps it on.
- **Supabase rules.** `rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`, `search-path` and `rls-policy` default to on only for a migration Supabase owns:
  - one under `supabase/migrations/`, or
  - one where some folder from the file up to the project root has `supabase/config.toml` or a `supabase` / `@supabase/*` dependency in its `package.json` ([`stack.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/stack.mjs)).

  A plain Postgres project turns one on with `true`.
- **`ui-strings`.** Defaults to on only when the environment variable `SMUGAN_UI_LANG` is a `pt` tag (`pt`, `pt-BR`, …). Setting the rule in `checks` overrides that.

## Suppressing a finding

```
// smugan-ignore <rule>: <reason of 6+ characters>
// smugan-ignore-file <rule>: <reason of 6+ characters>
```

This is how `parseSuppressions` in [`engine.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/engine.mjs) reads them:

- **Scope.** `smugan-ignore` covers its own line and the next line. A blank line in between breaks the link. `smugan-ignore-file` covers the whole file.
- **Rules.** Several rules go comma-separated with no spaces (`console-log,empty-catch`). `*` matches every rule.
- **Colon.** Required. A comment without it is not read as a suppression.
- **Reason.** Cut at a trailing `*/` or `-->`, then trimmed. Fewer than 6 characters suppresses nothing and is reported as a [`smugan-ignore`](#smugan-ignore) violation.
- **Comment style.** The parser reads raw text, so the same syntax works in `//`, `--`, `/* */` and `<!-- -->` comments.
- **Old name.** `smaug-ignore` is accepted as well.

---

## `db-naming`

Source: [`checks/db-naming.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/db-naming.mjs)

**Flags** an identifier declared in DDL that:

- has a non-ASCII character,
- has a word from a fixed list of unambiguous Portuguese words (`nome`, `usuario`, `pedidos`, `valor`, …), or
- has an uppercase letter (not snake_case).

It reads the names in `create table` (temporary and unlogged too) and that table's column list, `add column`, `rename … to`, `rename to`, `create index`, `function`, `procedure`, `type`, `view`, `materialized view`, `schema`, `sequence`, `trigger` and `policy`. Policy names skip the case check, because they are often sentences.

**Scope:** every `.sql` file, migration or not. Comments and string contents are blanked first.

**Options:** `allow`, a list of identifiers accepted as they are.

```sql
-- flagged: "nome" is Portuguese
create table patients (
  id uuid primary key,
  nome_completo text
);
-- flagged: not snake_case
create table events (createdAt timestamptz);
```

```sql
-- passes
create table patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null
);
```

**Known false negatives:**

- Portuguese words outside the list. Words that are also English (`data`, `total`, `status`, `local`, `agenda`) are left out on purpose.
- Identifiers written in DDL forms the patterns do not cover.
- Identifiers declared outside `.sql` files (ORM schemas).

## `rls`

Source: [`checks/rls.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/rls.mjs)

**Flags:**

- A `create table` without `alter table … enable row level security` for that table in the same file.
- An `alter table … disable row level security`, unless one of these holds:
  - the same file enables it again later (outside a down section),
  - the file drops the table,
  - the table is in a platform schema,
  - it sits in a down migration. That is a `*.down.sql` file, Diesel's `down.sql`, or the down section after a goose (`-- +goose Down`), dbmate (`-- migrate:down`) or sql-migrate (`-- +migrate Down`) marker.

**Scope:** migration `.sql` files (`migration/` or `migrations/` folder), Supabase projects by default. Temporary tables and the `auth`, `storage`, `extensions`, `realtime`, `vault` and `pg_catalog` schemas are skipped.

**Options:** `exempt`, a list of table names.

```sql
-- flagged
create table notes (id uuid primary key);
```

```sql
-- passes
create table notes (id uuid primary key);
alter table notes enable row level security;
create policy "own rows" on notes for select using (auth.uid() = user_id);
```

**Known false negatives:**

- The enable statement is matched by table name only, without its schema: `alter table public.notes enable …` also clears `create table private.notes`.
- DDL built inside a string (`execute 'create table …'`) is blanked and not read.
- Only the same file is read: RLS enabled in a later migration does not clear the finding.

## `rls-tests`

Source: [`checks/rls-tests.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/rls-tests.mjs)

**Flags** a table created in a migration whose name does not appear, as a whole word, in any `.sql` file under the pgTAP test folder. The check only proves that a test exists. `supabase test db` proves it passes.

**Scope:** migration `.sql` files, Supabase projects by default. Same table filter as `rls`.

**Options:** `exempt`; `dir`, the test folder (default `supabase/tests`).

```sql
-- flagged when no .sql file under supabase/tests/ mentions notes
create table notes (id uuid);
```

This passes once a file such as `supabase/tests/100-notes.test.sql` mentions the table:

```sql
select results_eq($$ select count(*) from notes $$, $$ values (0::bigint) $$, 1);
```

**Known false negatives:** the test files are read raw, so any whole-word mention of the table, a comment included, counts as a test. `notes_archive` does not count for `notes`.

## `security-notes`

Source: [`checks/security-notes.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/security-notes.mjs)

**Flags:**

- A table created in a migration whose name does not appear, as a whole word, in the project's notes file.
- Every such table when the notes file does not exist.

**Scope:** migration `.sql` files, Supabase projects by default.

**Options:** `exempt`; `file` (default `SECURITY_NOTES.md`, relative to the project root).

```sql
-- flagged when SECURITY_NOTES.md does not mention notes
create table notes (id uuid);
```

This passes once `SECURITY_NOTES.md` has a line about the table:

```md
- Tabela `notes`: visitante não lê nada; usuário logado lê/edita só o que é dele.
```

**Known false negatives:** any whole-word mention of the name counts as a description. The check does not judge what the line says.

## `rls-policy`

Source: [`checks/rls-policy.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/rls-policy.mjs)

**Flags a `create policy` that:**

- **Opens writes to every row.** The policy is permissive, for `update`, `delete` or `all` (the default), and its `using` is `(true)` or `(1=1)` once spaces and wrapping parentheses are removed. It is skipped when every role in its `to` list is a server role (`service_role`, `postgres`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user`).
- **Reads `user_metadata` or `raw_user_meta_data`** in its `using` or `with check` expression, whatever the command. The user can edit that metadata through `auth.updateUser()`.

**Scope:** migration `.sql` files, Supabase projects by default.

```sql
-- flagged: every role can update and delete every row
create policy "allow all" on notes for all using (true) with check (true);
-- flagged: access decided by metadata the user edits
create policy notes_admin on notes for select to authenticated
  using (((select auth.jwt()) -> 'user_metadata' ->> 'is_admin')::bool);
```

```sql
-- passes
create policy notes_delete on notes for delete using (auth.uid() = user_id);
create policy notes_admin on notes for select
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
```

**Known false negatives, by design:**

- A `select` or `insert` policy open to everyone. A public catalog or a contact form is left to the table's pgTAP test.
- A policy with no `using`, which PostgreSQL treats as showing no row.
- An `as restrictive` policy.
- A `using` that is always true in any form other than `true` or `1=1` (for example `auth.role() = 'authenticated'`).

## `view-invoker`

Source: [`checks/view-invoker.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/view-invoker.mjs)

**Flags** a view created in the `public` schema (an unqualified name counts as `public`) without `security_invoker`. Without it, the view reads its tables with its owner's rights, so their RLS does not apply to the caller. Either of these clears it:

- `security_invoker` in the view's own options. A bare `security_invoker` counts as true; `false`, `off`, `0` or `no` does not.
- A later `alter view … set (security_invoker = …)` in the same file. An `alter` that comes before a `create or replace` does not count, because the `create or replace` redefines the view.

**Scope:** migration `.sql` files, Supabase projects by default. Temporary views are skipped. Materialized views are not matched by the pattern.

```sql
-- flagged
create view public.profile_names as select id, full_name from profiles;
```

```sql
-- passes
create view profile_names with (security_invoker = true) as select id from profiles;
```

**Known false negatives:** views in schemas other than `public` are not judged, even when the API exposes that schema.

## `search-path`

Source: [`checks/search-path.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/search-path.mjs)

**Flags** a `create function` or `create procedure` whose header (the statement without its dollar-quoted body) says `security definer` and has no `set search_path`. A later `alter function … set search_path` in the same file clears it. One placed before a `create or replace` does not.

**Scope:** migration `.sql` files, Supabase projects by default. Routines in platform schemas are skipped.

```sql
-- flagged
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer as $$ begin return new; end; $$;
```

```sql
-- passes
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$ begin return new; end; $$;
```

**Known false negatives:** a pinned `search_path` that still includes a schema callers can write to is accepted. The check only looks for the clause.

## `anon-grants`

Source: [`checks/anon-grants.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/anon-grants.mjs)

**Flags** a top-level `GRANT`, or `ALTER DEFAULT PRIVILEGES … GRANT`, to `anon` or `authenticated` on a schema other than `public`, `graphql_public` or a platform schema. The schemas are read from:

- `on schema …` / `in schema …` lists, and
- qualified object names (`app_private.accounts`).

Arguments inside parentheses (function signatures) are ignored. An unqualified object counts as `public`.

**Scope:** migration `.sql` files, Supabase projects by default.

```sql
-- flagged
GRANT SELECT ON ALL TABLES IN SCHEMA app_private TO anon;
```

```sql
-- passes
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA app_private TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM anon, authenticated;
```

**Known false negatives:**

- Grants to other roles that the API uses are not judged.
- A grant inside a string (`execute '…'`) is blanked.

A non-public schema that is meant to be a public catalog takes a `smugan-ignore` with the reason.

## `money-float`

Source: [`checks/money-float.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/money-float.mjs)

**Flags** a column with a money-like name declared as `real`, `float`, `float(n)`, `float4`, `float8`, `double precision` or `money`. The column can be declared in a `create table`, an `add column`, or an `alter column … type` conversion.

How the name is judged:

- It is split into words (camelCase too).
- A word that ends in `price`, `amount`, `total`, `cost`, `value`, `balance`, `payment` or `revenue` (plural or not), or in `salary`/`salaries`, counts. So `unit_price`, `subtotal` and `unitprice` count.
- `fee` and `fees` count only as a whole word: `feedback_score` and `coffee_count` pass.

**Scope:** migration `.sql` files. This is not a Supabase rule: it runs on any project.

```sql
-- flagged
create table orders (id uuid primary key, price real not null);
alter table orders add column if not exists shipping_cost real;
```

```sql
-- passes
create table t (price numeric(12,2), amount_cents integer, balance bigint);
```

**Known false negatives:**

- Money words outside the list (`discount`, `tax`).
- Columns of `create temp table` or `create unlogged table`, which this rule's pattern does not match.

## `ui-strings`

Source: [`checks/ui-strings.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/ui-strings.mjs)

**Flags two things.** Both checks are tuned to report few false positives at the cost of missing some cases.

- **English in the UI.** A word from a fixed English vocabulary (`Save`, `Cancel`, `Submit`, `Loading`, `password`, …) in JSX text or in a `placeholder`, `title`, `alt`, `aria-label`, `aria-description` or `label` attribute. Words common in Brazilian UIs (`download`, `login`, `email`, `dashboard`, …) are left out of the vocabulary.
- **Missing accents.** A pt-BR word written without its accent or cedilla (`nao` → `não`, `configuracao` → `configuração`, …). It is looked for in the same places, plus string literals that contain whitespace.

**Scope:**

- Only `.tsx` and `.jsx` files.
- Off by default unless `SMUGAN_UI_LANG` is a `pt` tag or the project sets the rule in `checks`.
- Not scanned: code attributes (`className`, `id`, `href`, `type`, `name`, `value`, …), text with URLs, `@`, braces or other code characters, and single-word literals (often enum values).

**Options:** `english: false` and `accents: false` turn off either half.

```tsx
// flagged
export default function P() { return <button>Save</button>; }
// flagged twice: "Configuracao" and "invalida"
<p>Configuracao invalida</p>
```

```tsx
// passes
export default function P() { return <button>Salvar</button>; }
```

**Known false negatives:**

- English words outside the vocabulary.
- English in plain string literals: only JSX text and the attributes above are read for English.
- Copy in `.ts`/`.js` files.

## `no-any`

Source: [`checks/no-any.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/no-any.mjs)

**Flags, without a justification:**

- `any` in a type position. That covers annotations, `as any`, generic and tuple slots (`Record<string, any>`, `[any, string]`), `any[]`, union and intersection members, a function type's return, and type aliases or defaults (`type X = any`, `<T = any>`).
- The double cast `as unknown as`.

`keyof any`, `T extends any`, and a value named `any` followed by `.` or `(` pass.

**What counts as a justification:**

- A comment matching `any: <reason>`, with at least 6 characters after the colon. It can be on the same line or anywhere in the contiguous block of comment lines directly above (blank lines allowed). Because of how this match works, a `smugan-ignore no-any: …` comment above the line also satisfies it.
- An `eslint-disable…` for `no-explicit-any` with a `-- <reason>`. `-line` covers its own line and `-next-line` the line below.

**Also flags** `@ts-nocheck` and `@ts-ignore` at the start of a comment, unless the directive is followed by a reason of at least 6 characters. `@ts-expect-error` passes without one, because it fails by itself once the error is gone.

**Scope:** `.ts`, `.tsx`, `.mts`, `.cts`, excluding declaration files (`.d.ts`, `.d.mts`, `.d.cts`).

```ts
// flagged
const x: any = load();
const user = payload as unknown as User;
```

```ts
// passes
// any: third-party SDK returns untyped payloads
const x: any = sdk.load();
```

**Known false negatives:**

- Implicit `any`: no `any` is written, so there is nothing to match.
- `any` in `.js` files.
- Type-system escapes other than the listed directives and the double cast.

## `secrets`

Source: [`checks/secrets.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/secrets.mjs)

**Flags, line by line on the raw text (comments included):**

- **Key shapes:**
  - private key blocks;
  - AWS access key ids;
  - Google API keys;
  - `sk-…` secret keys;
  - GitHub classic and fine-grained tokens;
  - Slack tokens with real-length ids;
  - Stripe `sk_`/`rk_` keys;
  - `whsec_` webhook secrets, unless the base64 decodes to readable text;
  - hardcoded JWTs;
  - `sb_secret_…`.
- **Secret-looking literals.** A literal of 16+ characters assigned to a name containing `secret`, `password`, `passwd`, `token`, `api_key`/`apikey`, `private_key` or `service_role`. It must look like a key (digits, or 24+ characters) and not match a placeholder pattern (`process.env`, `example`, `your-`, `xxx`, `changeme`, `<…>`, `${`, …).
- **Database URLs carrying a password for a remote host.** Placeholders, variables, expressions and interpolations pass, and so do local hosts (no dot, loopback, private ranges, `.local`, `.internal`, `.test`, `example.*`). The README's [Checks section](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#checks) has the full parsing rules.
- **Admin keys in client code.** `service_role` or `sb_secret_` behind `NEXT_PUBLIC_*`, or in a `"use client"` module.
- **Example env files.** In `.env.example`, `.env.sample`, `.env.template` and `.env.dist`, a value that looks like a real secret, or a database URL with a real password on any line, a commented-out one included.

**Scope:**

- JS/TS, JSON, YAML, TOML, SQL, Python, Go, Rust, Ruby, PHP, Java, Kotlin, C#, Swift, Dart, shell, PowerShell, Astro, Vue, Svelte, Terraform, Prisma, Dockerfiles/Containerfiles, and the example env files.
- Prose files are not read.
- `.env`, `.env.local` and `.env.*.local` are in the default ignore list.

```ts
// flagged
const apiKey = "a1b2c3d4e5f6g7h8i9j0";
```

```ts
// passes
const apiKey = process.env.API_KEY;
```

**Known false negatives:**

- A secret split across literals (`"AKIA" + "…"`), which no single line holds whole.
- A secret assigned to a name outside the list.
- A password given as a URL property or query parameter (`;password=…`, `?password=…`).

## `console-log`

Source: [`checks/console-log.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/console-log.mjs)

**Flags** `console.log`, `console.debug`, `console.info`, `console.table`, `console.dir` and `console.trace` calls. `console.warn` and `console.error` pass.

**Scope:** JS/TS code files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`), excluding:

- `script/`, `scripts/`, `test/`, `tests/`, `__tests__/`, `e2e/`, `bin/`, `tool/` and `tools/` folders,
- `.test.` and `.spec.` files,
- `.config.` files.

```ts
console.log(user); // flagged
```

**Fix:** delete the call, or route the output through the project's logger. The message deliberately does not suggest renaming it to `warn` or `error`.

**Known false negatives:** a call through an alias (`const { log } = console; log(x)`) or bracket access is not matched.

## `dead-imports`

Source: [`checks/dead-imports.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/dead-imports.mjs)

**Flags** an imported binding (default, named, renamed or namespace, `import type` included) whose name never appears again in the file outside comments and strings. Side-effect imports (`import './x.css'`) are never flagged.

**Scope:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts`, `.cts`, excluding declaration files. In the `pre` hook it applies only to `Write`.

```ts
// flagged: useEffect is never used
import { useState, useEffect } from 'react';
export const n = useState(0);
```

```ts
// passes
import { join as joinPath } from 'node:path';
export const p = joinPath('a', 'b');
```

**Known false negatives:**

- The analysis covers one file and matches by name, so any occurrence counts as a use. That includes a property of the same name (`obj.helper` keeps `import { helper }` alive).
- `import x = require(…)` is not read.

## `stale-mutation`

Source: [`checks/stale-mutation.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/stale-mutation.mjs)

**Flags** a file with a `'use server'` directive line that writes to the database but has no cache revalidation anywhere in it.

- **Writes:** `.from(…).insert/update/upsert/delete(…)`, or `.rpc('name')` with a literal name not starting with `get_`, `list_`, `search_`, `count_` or `fetch_`.
- **Revalidation:** `revalidatePath`, `revalidateTag`, `expirePath` or `expireTag`, or `updateTag()` / `refresh()` when imported from `next/cache`.

It reports the first write only.

**Scope:** `.ts` and `.tsx`, excluding script, test, e2e, bin and config paths.

```ts
// flagged
'use server';
export async function addClient(name: string) {
  await supabase.from('clients').insert({ name });
}
```

```ts
// passes
'use server';
import { revalidatePath } from 'next/cache';
export async function addClient(name: string) {
  await supabase.from('clients').insert({ name });
  revalidatePath('/clients');
}
```

**Known false negatives:**

- Any revalidation call anywhere in the file clears every write in it.
- Writes through other clients (an ORM's `create`) are not matched.
- An `.rpc` with a dynamic name is never flagged.

A read-only RPC whose name does not show it takes `smugan-ignore stale-mutation: <reason>`.

## `empty-catch`

Source: [`checks/empty-catch.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/empty-catch.mjs)

**Flags:**

- A `catch` block that is empty or holds only comments.
- An empty `.catch(() => {})` handler, in arrow or `function` form.

**Scope:** JS/TS code files, excluding script, test, e2e, bin and config paths.

```ts
try { save(); } catch (e) {}      // flagged
fetch(url).catch(() => {});        // flagged
```

```ts
try { save(); } catch (e) { throw e; }   // passes
fetch(url).catch((e) => report(e));      // passes
```

**Known false negatives, by design:**

- A `catch` whose body has statements that ignore the error. That needs judgment and is left to the reviewer.
- A handler with an expression body (`.catch(() => null)`).

The end-of-turn [`contract-drift`](/reference/end-of-turn-detectors/#contract-drift) detector covers some of these cases inside functions that already existed.

## `fetch-timeout`

Source: [`checks/fetch-timeout.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/fetch-timeout.mjs)

**Flags** a `fetch(…)` or `globalThis.fetch(…)` call with no deadline. A call has a deadline when it mentions `AbortSignal`/`AbortController`, or when its inline options object has a `signal` key. A `timeout:` key counts only in two cases:

- `fetch` is imported or required from a library other than `undici` (for example node-fetch 2), or
- the call is `$fetch`.

Anywhere else the message says the `timeout:` option is ignored. A declaration named `fetch` (`function fetch(`, a Worker's `fetch(request) { … }` method, a typed member signature) is not a call.

**Scope:** JS/TS code files without a `"use client"` directive (leading comments skipped), excluding script, test, e2e, bin and config paths.

```ts
await fetch("https://example.com");           // flagged
await fetch(url, { timeout: 5_000 });          // flagged: the platform fetch ignores timeout:
```

```ts
await fetch(url, { signal: AbortSignal.timeout(3_000) });   // passes
```

**Known false negatives:**

- Wrappers (`api.get()`, `client.fetch()`).
- `window.fetch` and `self.fetch`.
- Any call preceded by a `.`.

**Known false positive:** options passed as a variable (`fetch(url, init)`) are not read, so the call is flagged even when `init` carries a signal.

## `test-weakening`

Source: [`checks/test-weakening.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/test-weakening.mjs)

**Flags, in test files:**

- **Disabled or focused tests:**
  - modifiers on `describe`/`it`/`test`, also behind another modifier (`it.concurrent.fails`): `.skip`, `.only`, `.todo` and `.fixme`;
  - the aliases `xit`, `xdescribe`, `xtest`, `fit` and `fdescribe`;
  - a `skip`, `only`, `todo` or `fails` option set to `true` or to a string (`test('x', { skip: true }, fn)`);
  - `testInfo.skip/fixme/fail()` and `test.info().skip/fixme/fail()`.
- **Tests marked as expected to fail:** `.fail`, `.fails` and `.failing`.
- **An `it`/`test` block with no assertion.** The block runs to where the next test or describe starts. These count as assertions: `expect`, `assert`, `expectTypeOf`, `assertType`, `.should` and `cy.`.
- **An assertion between equal constants** (`expect(true).toBe(true)`, `assert.equal(1, 1)`, `expect(true).toBeTruthy()`). Skipped in a file that counts its assertions (`t.plan`, `plan: n`, `expect.assertions`, `expect.hasAssertions`).
- **`process.exit()` or `process.exit(0)`.**

**Scope:** JS/TS code files whose path has `.test.` or `.spec.`, or sits under `test/`, `tests/`, `__tests__/` or `e2e/`.

```ts
it.only('adds', () => { expect(add(1, 2)).toBe(3); });   // flagged: focused
it('adds', () => { expect(1).toBe(1); });                 // flagged: constant compared with itself
```

```ts
it('adds', () => { expect(add(1, 2)).toBe(3); });         // passes
```

**Known false negatives:**

- A test that asserts only on a mock.
- An assertion removed from an existing test. That needs the turn-start version, so the end-of-turn [`assertion-weakening`](/reference/end-of-turn-detectors/#assertion-weakening) detector covers it.

**Known false positive, accepted:** a test whose assertions all live in an imported helper is flagged. Suppress it with a reason.

## `await-in-loop`

Source: [`checks/await-in-loop.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/await-in-loop.mjs)

**Flags:**

- An `await` on a database client inside a walk over a collection. The walk is a `for…of`, a `for…in`, an index loop bounded by `.length`, or a `forEach`/`map`/`flatMap` async callback. The clients are `supabase`, `db`, `prisma`, `knex`, `sql`, `tx`, `trx`, `drizzle`, `pg`, `database`, `repo` and `repository`. `client`, `pool`, `conn` and `connection` count only with `.query(`/`.execute(`.
- An `await fetch(` inside a `forEach` callback.

**When it runs:** only in the `pre` hook, and only in a critical turn. A critical turn means:

- the risk level is forced to `critical`,
- the edited file is critical, or
- another critical file was already touched in the turn ([`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs), `turnIsCritical`).

Only loops the edit adds block. `smugan check` and the end of turn do not run this rule.

**Scope:** JS/TS code files, excluding script, test, e2e, bin, seed, migration and config paths.

```ts
// flagged
for (const inv of invoices) {
  inv.items = await db.items.findMany({ where: { invoiceId: inv.id } });
}
```

```ts
// passes: one query
const rows = await db.items.findMany({ where: { invoiceId: { in: ids } } });
```

**Known false negatives, by design:**

- `while` loops, `for (;;)` loops and retry loops.
- `for await` loops.
- `.storage` transfers.
- `await fetch` in a `for` loop.
- SDK clients (`client.messages.create`).

---

## `assertion-weakening`

End of turn only, when the same turn changed production code. It has two parts:

- A pre-existing test that lost strong assertions **blocks**, like a gate violation.
- A removed test, or a deleted test file, is **listed once**.

Details and limits: [End-of-turn detectors](/reference/end-of-turn-detectors/#assertion-weakening).

How to suppress:

- **Lost assertions.** `smugan-ignore assertion-weakening: <reason>` on or above the test's line.
- **Removed tests.** A suppression on line 1 or a `smugan-ignore-file`. A deleted file has no line left to carry one.

## `contract-drift`

End of turn, listed once. It flags a quiet default added to a function that existed at the turn's first touch. Suppress it with `smugan-ignore contract-drift: <reason>` on or above the reported line. See [End-of-turn detectors](/reference/end-of-turn-detectors/#contract-drift).

## `clone`

End of turn, listed once. It flags a new function identical to another one in the repository, up to names and literals. Suppress it with `smugan-ignore clone: <reason>` on or above the new function's line. Option: `minTokens` (default 60). See [End-of-turn detectors](/reference/end-of-turn-detectors/#clone).

## `exploration-residue`

End of turn, listed once. It flags a new script that nothing references, and a config or lockfile change that the request does not mention. A `smugan-ignore` comment does not cover it. The project's `ignore` globs and `checks["exploration-residue"]: false` do. See [End-of-turn detectors](/reference/end-of-turn-detectors/#exploration-residue).

## `smugan-ignore`

Source: [`engine.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/engine.mjs), `parseSuppressions`

**Flags** a `smugan-ignore` or `smugan-ignore-file` comment whose reason has fewer than 6 characters. This violation cannot itself be suppressed.

```ts
// smugan-ignore console-log: short      ← flagged, and the next line is still flagged
console.log(1);
```

```ts
// smugan-ignore console-log: startup banner for operators   ← passes
console.log(1);
```
