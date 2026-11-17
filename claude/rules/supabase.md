---
paths:
  - "**/*.sql"
  - "**/supabase/**"
  - "**/lib/supabase/**"
---

# Supabase

SQL paths alone do not establish Supabase. For plain PostgreSQL, apply its role
model and read `~/.claude/skills/smugan-build/references/supabase-postgres.md`;
do not invent `auth.uid()` or Supabase SDK dependencies.

## Version first — never assume

- Resolve SDK JS, SSR, CLI and PostgreSQL independently with `smugan context --json <target-path>`. Lockfile resolution is not installed/runtime proof; local configuration does not establish the remote server. Do not read secret env values merely to discover versions.
- Documentation reviewed 2026-10-02 for supabase-js 2 and PostgreSQL 16/17/18. Match the actual SSR cookie/auth API and configuration; uncovered versions need compatible official evidence. The SDK cannot establish the PostgreSQL version.

## Keys & clients

- Prefer publishable/secret keys for new supported setups. Existing legacy `anon`/`service_role` keys must retain their correct privilege interpretation; check current migration guidance before changing them, without assuming a removal date or migrating during unrelated work. [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
- Secret keys (`sb_secret_...` or legacy `service_role`): server-only code paths — never in Client Components, never in `NEXT_PUBLIC_*`, never in exposed routes. The new secret keys 401 from a browser; the legacy one does not even give you that guardrail.
- SSR session clients use the installed `@supabase/ssr` cookie contract and are scoped per request. A reusable SQL connection pool is different. Propagate refresh cookies correctly and keep personalized/refresh responses out of shared caches. A static Astro browser client alone does not require SSR or an adapter.
- Verify server identity with the supported `getClaims()`/`getUser()` contract and authorize the resource; never trust `getSession()` alone for sensitive access. Match the method to verification/freshness needs and SDK/key setup. [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## RLS — non-negotiable

- Enable Row Level Security on EVERY table in the SAME migration that creates it: `alter table x enable row level security;`. Deny-by-default: no policy = no access, and that is the correct starting state.
- Write policies per operation and actual access model: owner, team/tenant, role or intentionally public catalog. Private user data must not get blanket public access. `(select auth.uid())` can avoid repeated row-independent evaluation; it does not itself create/use an index or fit every policy. [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Test policies: for each table, verify the browser key (publishable or legacy anon) cannot read/write what it should not.

## Migrations

- Schema changes ONLY via versioned migrations with the project's migration tool (`supabase migration new` when Supabase), applied by CLI. Never edit schema in the dashboard — a dashboard change is undocumented drift.
- Migrations are append-only: fix a bad migration with a new one, never rewrite an applied file.

## Naming & shape

- Tables: English snake_case; follow the existing singular/plural convention, and for a new project use plural (`patients`, `appointment_notes`). Columns, functions, enums: English snake_case. NEVER Portuguese identifiers.
- Follow the project's key/audit conventions where they fit; relationship tables and other models may use composite keys or different lifecycle fields. Do not add redundant columns by rote. Native `uuidv7()` requires PostgreSQL 18; `transaction_timeout` requires 17. [17 release](https://www.postgresql.org/docs/17/release-17.html), [18 release](https://www.postgresql.org/docs/18/release-18.html).
- Foreign keys named `<singular>_id` (`patient_id`). Indexes on every FK used in filters.

## Concurrency & integrity

- Counters and money move in ONE atomic statement (`update ... set x = x + delta`) or an RPC inside a transaction. Read-modify-write in JS is a lost update waiting for the second click.
- Money is `numeric` (e.g. `numeric(12,2)`) or integer cents — never `real`/`double precision`/`float`/`money` (PostgreSQL docs §8.1: exact types for monetary amounts).
- Multi-step writes that must succeed together live in one RPC/transaction — never a sequence of separate client calls.
- Uniqueness is a database constraint, never check-then-insert in code. The constraint is the last line of defense; a disabled button is not a defense at all.
- Webhooks/payment callbacks need verified input/signature and idempotency with correctly scoped keys, payload consistency and handling for in-flight/unknown outcomes. A repeated delivery must not repeat the effect; return the protocol-appropriate result. Read `~/.claude/skills/smugan-build/references/concurrency.md` for transaction/retry guarantees.

## Behavioral proof (Tier 2)

- Every table created in a Supabase migration gets a pgTAP access test in `supabase/tests/` for its real roles and allowed/denied operations. For private owner data, prove anon denial and cross-user isolation; public catalogs and team access require their actual contract, not a falsely restrictive owner template. Include writes/tenant boundaries when relevant, using ordinary roles rather than a bypass owner. Run `supabase test db` before done.
- Every migration adds one plain-language line per table to `SECURITY_NOTES.md` at the project root: who can read, who can write. If the sentence is hard to write, the policy is probably wrong.

## Types

- Generate types after every schema change with the project's type generator (`supabase gen types typescript` when Supabase) → committed file (e.g. `src/lib/supabase/database.types.ts`).
- Use the generated `Database` type in every client. Never hand-write a table type.
- Schema changed but types file didn't → the change is not done.
