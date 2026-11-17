---
title: Introduction
description: What Smugan checks, when it checks it and what the rules ask of the agent.
---

A coding agent can deliver something that compiles and still let an important
problem slip through: an exposed table, an ignored error, a disabled test or an
action that never updates the screen.

Smugan follows the session at three points. Before a change is written, it looks
for objective violations. After the write, it runs the project's own tools. At the
end of the work, it repeats the checks and requires the proof the platform makes
available before accepting the task as done.

It does not replace human review, tests or the application's internal rules. Its
job is to make those checks part of the normal flow, without relying on the agent
to remember to run them.

The name comes from *smugan*, the Old Germanic verb that, according to Tolkien himself, gave its name to the dragon in *The Hobbit*: "to squeeze through a hole". That gap is where whatever an agent lets slip gets through.
In the project, the idea becomes a simple rule: a change must leave evidence of
what it altered and how it was verified.


## What changes in practice

Before implementation decisions, the **smugan-build** skill identifies the versions
of the affected package and loads only the relevant guides. It covers Next, Astro,
Supabase/PostgreSQL, Node/Express/Nest/Hono, Rust/Axum, Docker/VPS, Redis,
concurrency, observability and UI libraries. The **smugan** skill remains
dedicated to auditing. Implicit selection depends on the host's support and
preferences; the shared instructions also point to the preparation step.

The `smugan context --json` command keeps evidence across Codex and Claude chats
in the same checkout. The next run checks the files and installed versions
before reusing the result. It does not execute project configuration, query
servers, read `.env` or search the network. See [version context and researched decisions](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#version-aware-context).

To enable the parsers after cloning, run
`npm ci --ignore-scripts --prefix packages/gate`. Hooks and checks keep working
without these parsers; the installer reports when preparation is incomplete. The
three parsers have pinned versions and their own lockfile.

| When | What Smugan does | What you get |
|---|---|---|
| Before implementing | Checks versions, capabilities and integrations; selects guides; writes the acceptance criteria | Guidance compatible with the affected package and a verifiable definition of done |
| Before writing | Analyzes only the new change and blocks known violations | The file left untouched and a message with line, rule and expected fix |
| After writing | Runs lint and type checking when the project provides those commands | Errors introduced by the edit go back to the agent to fix |
| Before finishing | Re-checks the touched files and runs the related tests | The session only ends clean when the platform allows blocking the end of the turn |
| At review | Launches separate reviewers for behavior and flow completeness, against the original request and the acceptance criteria, never against the author's summary | Findings with file, line and a way to reproduce |
| At delivery | Picks one integration path and checks CI after the push | The real CI status, including when it has not even started |
| Afterwards | `smugan why` shows what ran, what was skipped and why | The answer to "did the check run?" without opening the transcript |

The general rules stay short. Specific rules come in only when the matching file
shows up: database for migrations, UI for components, testing for suites and so
on. This reduces the constant context without hiding a rule when it is needed.

## An example

A migration creates a table with Portuguese identifiers, no row-level access
control, no access test and no description of who can read the data. The write is
refused before the file exists, with this message:

```text
smugan gate: blocked — this Write would introduce 5 violations in supabase/migrations/0007_create_clientes.sql:
  line 1  [db-naming]  Portuguese identifier "clientes" ("clientes") — use English snake_case
  line 3  [db-naming]  Portuguese identifier "nome_completo" ("nome") — use English snake_case
  line 1  [rls]  table "clientes" created without RLS — add "alter table clientes enable row level security;" plus per-operation policies in this migration
  line 1  [rls-tests]  table "clientes" has no pgTAP RLS test in supabase/tests/ — instantiate table-rls.test.sql.template (anon denied, owner sees own rows, other user sees zero) and run "supabase test db"
  line 1  [security-notes]  project has no SECURITY_NOTES.md — create it and describe table "clientes" in one plain-language line: who can read, who can write (template: smugan init)
Fix the content and retry. False positive? Add: // smugan-ignore <rule>: <reason (6+ chars)>
```

Renaming to `clients`/`full_name` and enabling RLS fixes only the first three. The
write goes through once there is also a pgTAP test that references the table in
`supabase/tests/` and a line about it in `SECURITY_NOTES.md`. An allowed write
prints nothing: silence is the normal result.

The same applies to a test disabled while fixing a failure. Smugan blocks adding
`.skip`, `.only`, `.todo`, a marker that makes a failing test pass (`test.fail`,
`it.fails`) and tests without assertions. When the turn changes
production code, an existing test also cannot lose assertions or swap `toBe(0)`
for `toBeDefined()` without a reason recorded in the code, and a test that is
deleted, commented out or loses its file is listed for the agent to restore or
explain. An old problem the edit did not touch stays visible, but does not block
an unrelated change.

## What is checked

The engine uses deliberately narrow textual analysis. It covers patterns where a
deterministic result is more useful than an opinion.

| Area | Checks |
|---|---|
| Database and access | English SQL names; in Supabase projects, RLS at table creation, policies that let a browser role update or delete every row or that trust `user_metadata`, views and `security definer` functions that bypass RLS, anonymous permissions, pgTAP tests and a readable description of the access policy |
| Data and security | known secrets in the source files of any language, a database URL that carries its password, unsuitable types for money and network calls without a timeout |
| TypeScript and errors | `any`, `@ts-nocheck` and `@ts-ignore` without justification, empty `catch`, unused imports and leftover logs |
| UI | with a pt-BR UI, visible text in English or missing diacritics; always, mutations that change data without updating the screen |
| Tests | disabled, focused, pending or assertion-free tests; assertions removed or loosened in an existing test, and tests or test files removed, when the turn also changed production code |
| What the turn left behind | at the end of the turn, listed once: an exploration script nothing references, a `package.json`, lockfile, `tsconfig` or build config that neither the contract nor the request mentions, an existing function that starts silently returning a default value, and a new function that duplicates another in the repository |
| Performance, only in critical turns | a database query awaited on each iteration of a loop (N+1) |

The full list, with the scope and accepted false negatives of each rule, is in the
[engine documentation](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md).

A legitimate exception must explain its reason:

```ts
// smugan-ignore fetch-timeout: the internal client already applies a 5-second timeout
```

A comment without a sufficient justification is also rejected. The exception stays
in the code so someone else can understand why that rule does not apply.

## What the rules ask of the agent

The checks catch what can be proven from the file's text. The rest becomes
instructions in [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md), which the installer copies
into the global rules. Each section exists for a concrete reason:

| Section | What it asks | Why |
|---|---|---|
| Code | The minimum that fully solves the problem, only what the task requires, reuse before writing, comments only for the non-obvious why, I/O timeouts and limits before tuning numbers | A diff bigger than the request costs review time and hides what matters. A bigger pool or faster retry tends to amplify a hang instead of fixing it |
| Development preparation | `smugan-build` and `smugan context --json` before a technical change, distinguishing declared, lockfile-resolved, installed, runtime and deployed versions | Guidance written for another version produces wrong code for the installed one. An unknown version is not treated as the latest |
| Language | SQL in English snake_case, UI in the language chosen at install (off by default), code in English, commits in the project's language, customer-facing content that does not reveal tooling, business model or process | A database name is a contract with every piece of code that queries it. UI text is what people read |
| TypeScript | Strict mode, `any` only with justification, zod on every external input | Types are only trustworthy inside the system if the boundary validated what came in |
| Errors | No empty `catch`, a timeout on every external call, handle every error an API's documentation lists | A hang is worse than a fast error. One app treated as "name taken" only the 409 a test returned; the documented 400 for the same case became a generic failure |
| Secrets | Secrets out of the repository, `.env.example` updated in the same change | A committed secret stays in history after it is deleted |
| Git | History written for a teammate who never saw the task: product and engineering change, never the process; no AI attribution or co-author trailer; checks that ran at the end of the body | History is permanent and read by people who do not have the conversation |
| Definition of done | What a critical change is (auth, migrations and SQL, money, secrets, data deletion, external integrations, new dependencies, `unsafe` in Rust); the checks covering the change green, with command and result, without repeating a run that already passed in the session; one test that fails without the fix for a bug fix and one per new behavior, none for a reversible low-impact edit; `critic` and `flow-critic` only for a critical change or an ordinary diff over ~300 lines; the reviewer gets the original request, the files and the logs of the last real run, never the verdict; pending items in a `⚠️ NÃO FEITO` block at the end | Uniform verification costs the same on a typo as on a migration with RLS. Agent-written tests in volume do not change the outcome (arXiv 2602.07900); what counts is the test that fails before and passes after. Telling the reviewer the code is correct drops detection (study table below) |
| Claims | A claim about system state the session did not check carries its source on the same line (`file:line`, version, sha or command output); what the session ran and saw pass is already evidence; absence has a scope; a tool name is not evidence; what a check covered comes from its output and logs; a subagent report with command, exit code and output is evidence for what the output shows, and the rest of it is a lead; a review finding that does not reproduce is dropped | A glob that matches nothing exits successfully. One PR cited tests from a nonexistent folder because the text came from the command typed, and an issue carried details of another version taken from a report. Telling the agent to distrust everything made it re-run what had already passed: current models follow emphatic instructions literally |
| Stack rules | Stack rules load by file path; the path is a hint, not framework detection | React does not imply Next, and PostgreSQL does not imply Supabase |

The stack rules live in [`claude/rules/`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/) and only enter the context
when the touched file matches the path declared at the top of each one:

| Rule | Loads with | Covers |
|---|---|---|
| `supabase.md` | `*.sql`, `supabase/**`, `lib/supabase/**` | keys and clients, RLS, migrations, naming, concurrency, pgTAP proof |
| `nextjs.md` | `app/**/*.{ts,tsx}`, `next.config.*`, `middleware.ts`, `proxy.ts` | version differences, components, data, caching and revalidation |
| `astro.md` | `*.astro`, `astro.config.*` | minimal hydration, adapters, version differences, `astro check` |
| `hono.md` | `src/**/routes/**`, `hono/**`, `*.hono.ts` | structure, validation, errors and middleware |
| `rust-axum.md` | `*.rs`, `Cargo.toml` | handlers, state, errors and async discipline |
| `stability.md` | `*.go`, `*.rs`, `*.py` | timeouts that contain failures, where to apply effort, slowness |
| `vercel.md` | `vercel.json`, `next.config.*`, `.env.example`, `.env.local` | environments, runtime, deploys and build |
| `pwa.md` | manifest, service worker, `serwist*`, `workbox*` | manifest, service worker, offline and acceptance criteria |
| `mobile.md` | `app.json`, `app.config.*`, `eas.json`, `*.kt`, `android/**`, `ios/**` | Expo/React Native and Kotlin (still a draft) |
| `ui-ptbr.md` | `*.tsx`, `*.jsx` | only with `SMUGAN_UI_LANG=pt-BR`: pt-BR text, date and currency formats, baseline accessibility |
| `ux-flows.md` | `*.tsx`, `*.jsx` | confirmation of destructive actions, feedback for async actions, dead ends, empty states |
| `testing.md` | test files and folders, Playwright and Vitest configs, `supabase/tests/**` | E2E, unit, existing tests, database and Definition of Done |

The `smugan-build` skill loads longer guides by topic (Next, Astro,
Supabase/PostgreSQL, Node APIs, Rust/Axum, Docker/VPS, concurrency, observability,
testing and UI libraries) based on the versions `smugan context` found. For a
critical change to a handler or listing, it asks for performance criteria a test
verifies (at most K queries for N items, a listing with a limit), and for a task
the user calls performance work, it measures before and after, in up to 3 rounds.
The `smugan` skill runs the full audit on demand.

On the first edit, per session and per package, of a file one of these rules covers,
the hook gives the agent the index of the docs the installed dependencies ship (such
as `node_modules/next/dist/docs` in Next 16.2+) and the `.d.ts` signatures of what
the file imports, capped at ~2k tokens and never the docs' content. A skill with the
same information goes uncalled much of the time; a path rule always arrives.

### Response style

The [Smugan style](https://github.com/DenisCDev/smugan/blob/main/claude/output-styles/smugan.md) changes how the agent talks, not
what it does with the code. A reply opens with the conclusion, in short prose with
no sign-off formulas, and avoids internal labels the reader has never seen.
Everything left undone goes in the `⚠️ NÃO FEITO` block, at the end and set apart,
because a pending item mentioned mid-paragraph goes unnoticed and the reply looks
finished when it is not. Shortening never removes evidence: the command run, the
result and the `file:line` reference stay. To use another style, switch it in
`/config` or set `outputStyle` in `settings.json`.
