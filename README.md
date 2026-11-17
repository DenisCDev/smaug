<h1 align="center">Smugan</h1>

<p align="center">
  <b>Checks and reviewers for code produced with AI agents</b>
</p>

<p align="center">
  <img src="https://github.com/DenisCDev/smugan/actions/workflows/ci.yml/badge.svg" alt="Continuous integration status">
  <img src="https://github.com/DenisCDev/smugan/actions/workflows/pgtap-smoke.yml/badge.svg" alt="Database access test status">
  <img src="https://img.shields.io/badge/context-per%20version-43A48E?labelColor=171310" alt="Context per project version">
</p>

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

<p align="center">
  <a href="https://smugan-docs.vercel.app"><b>Read the documentation</b></a>
  ·
  <a href="https://smugan-deck.vercel.app"><b>View the presentation in your browser</b></a>
</p>

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
servers, read `.env` or search the network. See [version context and researched decisions](packages/gate/README.md#version-aware-context).

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
[engine documentation](packages/gate/README.md).

A legitimate exception must explain its reason:

```ts
// smugan-ignore fetch-timeout: the internal client already applies a 5-second timeout
```

A comment without a sufficient justification is also rejected. The exception stays
in the code so someone else can understand why that rule does not apply.

## What the rules ask of the agent

The checks catch what can be proven from the file's text. The rest becomes
instructions in [`claude/CLAUDE.md`](claude/CLAUDE.md), which the installer copies
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

The stack rules live in [`claude/rules/`](claude/rules/) and only enter the context
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

The [Smugan style](claude/output-styles/smugan.md) changes how the agent talks, not
what it does with the code. A reply opens with the conclusion, in short prose with
no sign-off formulas, and avoids internal labels the reader has never seen.
Everything left undone goes in the `⚠️ NÃO FEITO` block, at the end and set apart,
because a pending item mentioned mid-paragraph goes unnoticed and the reply looks
finished when it is not. Shortening never removes evidence: the command run, the
result and the `file:line` reference stay. To use another style, switch it in
`/config` or set `outputStyle` in `settings.json`.

## Install in Claude Code

Requirements:

- Node.js 22 or newer (CI runs 22 and 24);
- Claude Code installed (integration verified with 2.1.299);
- Git for Windows on Windows, which is the tested environment. Without Git Bash,
  Claude Code runs hooks in PowerShell, and a failing pre-write hook starts
  blocking the edit ([hooks documentation](https://code.claude.com/docs/en/hooks),
  `shell` field). `smugan doctor` warns when it cannot find Git Bash.

```bash
git clone https://github.com/DenisCDev/smugan.git
cd smugan
./install.sh
```

The installer can be run again. It updates only the blocks Smugan manages and
preserves the rest of the configuration. The hooks point to this checkout, so
updating the repository also updates the engine used in later sessions. Rules,
agents, skills and the style are copies: after a `git pull`, run `./install.sh`
again. `smugan doctor` points out which copy fell behind.

To uninstall, run `./install.sh --uninstall`. It removes only what the installer
writes: the managed block in `CLAUDE.md`, Smugan's rules, skills, agents, style and
hook files, its hooks in `settings.json`, `outputStyle` if it is still `Smugan`, and
the `smugan` commands it marked in `~/.local/bin`. The rest of the configuration
stays as it was.

The process installs:

- the general rules in a delimited block of `~/.claude/CLAUDE.md`. Text outside the
  block is not touched; the block is replaced in full on every install;
- the stack-specific rules in `~/.claude/rules/`;
- the `critic` and `flow-critic` reviewers in `~/.claude/agents/`;
- the skills from `claude/skills/`: `/smugan` (audit), `smugan-build` (preparation,
  acceptance criteria and per-task execution, with the per-stack references) and
  `smugan-finish` (delivery);
- the Smugan response style in `~/.claude/output-styles/`. It becomes the default
  only when `settings.json` does not yet set `outputStyle`; an earlier choice is
  kept;
- the `~/.claude/hooks/smugan-hook.mjs` launcher and the `PreToolUse`, `PostToolUse`
  and `Stop` hooks that call it, merged into `settings.json`. A fresh install
  replaces old Smugan entries and preserves the others;
- `~/.claude/hooks/smugan.paths.json`, which points to this checkout's engine;
- the `smugan` command in `~/.local/bin`, the same folder where the Claude Code
  installer puts `claude`. On Windows, it comes as two files: `smugan`, for Git Bash,
  and `smugan.cmd`, for PowerShell and cmd. A file with that name that Smugan did not
  write is left alone. If the folder is not on `PATH`, the installer warns.
  `SMUGAN_BIN_DIR` changes the folder.

The installer honors `CLAUDE_CONFIG_DIR` when the Claude Code configuration lives
outside `~/.claude`. If `settings.json` contains invalid JSON, the installer writes
the rest, leaves that file as it is and exits with an error; the hooks only take
effect after fixing the file and running again. Hooks only apply to sessions opened
after installation, and the response style after `/clear` or a new session.

To run `critic` and `flow-critic` on a different model from the one that wrote the
code, set `SMUGAN_REVIEW_MODEL` at install time, with an alias or a full ID:

```bash
SMUGAN_REVIEW_MODEL=sonnet ./install.sh
```

Without the variable, the reviewers follow Claude Code's default for subagents: the
conversation's model, or `CLAUDE_CODE_SUBAGENT_MODEL` when set.
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` overrides even the `model:` written by the installer.

### Cost profile

`SMUGAN_PROFILE` chooses how much review costs:

| Profile | Reviewers |
|---|---|
| `completo` (default) | `critic` and `flow-critic` on the conversation's model |
| `economico` | `critic` and `flow-critic` on sonnet; nothing else changes |
| `minimo` | only `critic`, on haiku; `flow-critic` is neither installed nor mentioned in the rules |

```bash
SMUGAN_PROFILE=economico ./install.sh
```

The gate, the rules and the `critic` checklist are the same in all of them. What
changes is who reviews, and a cheaper reviewer finds less: it reads the diff less
carefully and misses defects the larger model would catch. Without `flow-critic`,
no review looks at the flow of the person using the screen. Use `economico` and
`minimo` only for small, reversible tasks, and switch back to `completo` before
touching authentication, money, migrations or screens. The choice is saved like the
languages, and `SMUGAN_REVIEW_MODEL`, when set, takes precedence over the profile's
model.

### Turning parts off

`SMUGAN_DISABLE` takes a comma-separated list of what you do not want to use: a
reviewer (`critic`, `flow-critic`), a skill (`smugan`, `smugan-build`,
`smugan-finish`) or a stack rule (the file name in `claude/rules/` without `.md`,
such as `nextjs` or `supabase`).

```bash
SMUGAN_DISABLE=flow-critic,nextjs ./install.sh   # turns off flow-critic and the Next rule
SMUGAN_DISABLE=none ./install.sh                 # turns everything back on
```

What is turned off is not installed, and what was already installed is removed.
`CLAUDE.md` stops mentioning the part: without `critic`, the Definition of done asks
only for `flow-critic`; without both, the review items go away; without
`smugan-build`, preparation asks only for `smugan context`; a disabled rule leaves
the rule list. A disabled skill loses only its `SKILL.md`: the guides in
`smugan-build/references/` stay, because the stack rules point to them. The list is
saved like the profile, an unknown name aborts the install before writing anything,
and `smugan doctor` compares the installation against the applied list. The adapters
(`adapters/*/install.sh`) accept the same variable.

In a project, `"disable": [...]` in `smugan.config.json` or `smugan.local.json`
turns off the same parts only there, as far as a hook can reach:

- the first-edit reminder for a critical file stops asking for the disabled
  reviewer and stops mentioning `smugan-build`, in any installation;
- in the plugin, the session-start context leaves the part out, the rule stops being
  taught and launching the reviewer or skill is refused;
- in Codex, the rule stops being taught.

In the global Claude Code installation, `CLAUDE.md`, the agents and the rules in
`~/.claude` apply to every project and Claude Code itself loads rules by path: no
hook can remove them from a single project. For that, turn them off at install time
or use the plugin. In the Antigravity, OpenCode and Grok adapters, the project list
does not change rule teaching either.

Languages are off by default. With no configuration, no rule enforces the language
of the project's strings and the agent replies in the language you write in. To pin
one or both, pass a language code at install time:

```bash
SMUGAN_UI_LANG=pt-BR SMUGAN_REPLY_LANG=pt-BR ./install.sh   # UI strings and conversation
SMUGAN_UI_LANG=es ./install.sh                              # UI strings only
SMUGAN_UI_LANG=off ./install.sh                             # turns it off again
```

The choice is saved and applies to later reinstalls until you change it. With a
Portuguese UI, the `ui-ptbr` rule and the `ui-strings` check also come in; both know
only pt-BR. A project can turn that check on or off on its own in
`smugan.config.json` (`"checks": { "ui-strings": true }`), which is how it runs in
CI, where there is no installation.

## Install as a plugin

The repository is also a Claude Code plugin. The plugin provides the skills, the
reviewers, the response style and the hooks straight from this checkout, without
copying anything into `~/.claude`, and can be enabled or disabled per project.
`install.sh` remains the global option.

When the global installation is present, the plugin's hooks exit without acting and
session start shows a warning. The plugin's skills, agents and style are still
listed next to the global copies, and a reviewer launched as `smugan:critic` skips
the profile check; so keep only one of the two. To switch from global to the plugin,
run `./install.sh --uninstall` in the checkout, install the plugin and open a new
session. To keep only the global one, disable the plugin with
`claude plugin disable smugan@smugan`.

```bash
claude plugin marketplace add DenisCDev/smugan
claude plugin install smugan@smugan --scope project   # writes to the project's .claude/settings.json
```

So that whoever clones the project gets the plugin, commit `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "smugan": { "source": { "source": "github", "repo": "DenisCDev/smugan" } }
  },
  "enabledPlugins": { "smugan@smugan": true }
}
```

To disable it in a specific project, only on your machine, use that project's
`.claude/settings.local.json`:

```json
{
  "enabledPlugins": { "smugan@smugan": false }
}
```

The same works from the command line: `claude plugin disable smugan@smugan --scope local`.

A plugin does not install `CLAUDE.md` or rules. At the start of each session, and
again after `/clear` or a compaction, the hook delivers the general rules from
`claude/CLAUDE.md` as context. The first edit of a file covered by a stack rule
points to the rule the agent needs to read, once per rule per session. Skills and
reviewers appear with the plugin prefix, such as `smugan:smugan-build` and
`smugan:critic`.

Languages are plugin options, off by default: `ui_language` and `reply_language`,
with a language code or `off`. They appear in `/config` and can be set at install
time:

```bash
claude plugin install smugan@smugan --scope project --config ui_language=pt-BR --config reply_language=pt-BR
```

The cost profile is the `profile` option (`completo`, `economico` or `minimo`), with
the same effect and the same caveat as `SMUGAN_PROFILE`. Since a plugin's agent files
are fixed, the model goes with each launch: the session-start context tells the agent
which `model` to pass when launching `smugan:critic`, and a hook on `Agent` refuses a
reviewer launched without that model, a reviewer launched with an explicit `model` in
the `completo` profile (which uses the conversation's model) or `smugan:flow-critic`
in the `minimo` profile, explaining how to fix it.

Disabled parts are the `disable` option, with the same list as `SMUGAN_DISABLE`. A
plugin ships every agent and skill, and their list does not change by option: a
disabled reviewer or skill still shows up in Claude Code's listing. That is why the
session-start context says the part is not used, and a hook on `Agent` and `Skill`
refuses the launch. A disabled rule is not taught. An unknown name produces a warning
and, for that session, nothing is disabled.

As with `install.sh`, a Portuguese `ui_language` enables the `ui-ptbr` rule and the
`ui-strings` check. The `smugan` command is not added to `PATH`: the session context
tells the agent how to call the CLI inside the plugin. `smugan context` needs three
engine parsers: on the first session after installing or updating the plugin, session
start runs `npm ci` in the plugin's data folder, only once, and warns if it fails (no
network, for example); the next session tries again. Loaded from a checkout with
`--plugin-dir`, the plugin uses the checkout's own `node_modules`. `smugan doctor`
checks only the global installation.

## Verify the installation

First, with no session and no tokens spent:

```bash
smugan doctor
```

`doctor` checks:

- the Node version;
- the four hooks in `settings.json` (session start, before and after the write, end of turn) and the launcher they call;
- the engine the hooks point to;
- whether the `smugan` command is on `PATH` and points to this checkout;
- whether the installed copies match the checkout's;
- whether `"disableAllHooks": true` turns the hooks off, in the user's `settings.json`
  or in the `.claude/` of the folder it runs in;
- the `context` parsers;
- Git Bash, on Windows.

At the end, it passes a test write of a migration with a Portuguese name and no RLS
through the installed hook, and requires it to come back blocked. Each failing line
includes the command that fixes it. The exit code is 1 when any line fails,
including an installed copy that fell behind the checkout.

Then, in a throwaway folder, so the test migration does not end up in a real
project:

```bash
mkdir smugan-smoke && cd smugan-smoke && git init && claude
```

And ask:

```text
Create supabase/migrations/0001_clientes.sql with create table clientes (id uuid primary key, nome_completo text).
```

The write must come back refused with `smugan gate: blocked`, and the lines must
include `[db-naming]` and `[rls]`. Delete the folder afterwards.

If the migration is written without that message, the hooks did not run in that
session:

1. sessions opened before installation do not read the hooks; open a new one;
2. run `doctor` from inside that folder;
3. if it comes back green and the session still does not block, run `/status` in the
   session. An organization can restrict hooks through managed settings
   (`allowManagedHooksOnly`), which `doctor` cannot read.

## Use in a project

Passive mode starts working in the sessions after installation. There is no need to
change each project.

To add the full verification structure to a repository:

```bash
smugan init
```

The command creates only missing files, and only for the stacks the project already
declares; the rest is listed as skipped:

- Smugan configuration;
- database access tests with pgTAP (Supabase);
- E2E test context and example (`@playwright/test`);
- `SECURITY_NOTES.md` to document who can access each piece of data (Supabase);
- initial observability structure (`next` with `@sentry/nextjs`);
- continuous integration workflow.

To use only the engine:

```bash
smugan check
smugan check src/ --json
```

Without the installation, the same works through `node packages/gate/bin/smugan.mjs check`.

### Personal configuration

`smugan.config.json` belongs to the team and goes into git. Settings that are yours
alone go in `smugan.local.json`, in the same folder; `smugan init` adds that file to
`.gitignore` when it is not listed yet.

```json
{ "checks": { "console-log": false }, "hook": { "stop": { "tests": false } } }
```

The personal file takes precedence over the shared one, key by key: each check gets
the local value, `hook` and `stop` merge field by field, and `ignore` combines both
lists without repeating patterns. On its own, without the shared file, the personal
file also applies. Invalid JSON in either produces a warning with the file name, and
the file is ignored; `smugan doctor` says when the personal layer is active. A `mode`
other than `"block"` and `"warn"` also invalidates the file.

### Warn mode, for code with debt

In a project that already has violations, `"mode": "warn"` makes Smugan only warn
while the team cleans up the codebase. It works in both layers; the default is
`"block"`.

```json
{ "mode": "warn" }
```

The hooks run the same checks and show the same findings, but nothing is blocked: no
write is refused and the end of the turn is not held. Findings arrive through each
platform's non-blocking channel:

| Platform | Before writing | After writing | End of turn |
|---|---|---|---|
| Claude Code | agent context and on-screen warning | agent context and on-screen warning | on-screen warning |
| Codex | agent context | on-screen warning | on-screen warning |
| OpenCode | appended to the tool result | appended to the tool result | notification |
| Antigravity, Grok Build | — | — | — |

Antigravity and Grok Build have no channel that reaches the agent without blocking;
there, warn mode only records the findings, which `smugan why` shows. A turn that
also touched a project in `block` mode is held as before. Smugan's internal failures
still let the event through, as in any mode.

`smugan check` ignores `mode` and exits with 1 when there is a violation, so CI does
not loosen because someone changed the configuration. To only list, use
`smugan check --warn`, which exits with 0. `smugan doctor` and `smugan why` say when
warn mode is active.

The broader audit remains available through `/smugan`. It is read-only by default and
examines security, database access, UI text, unused code, error handling and
conformance with the installed rules.

## From request to delivery

Four pieces cover what comes before the code and what comes after verification. They
are adaptations of [Superpowers](https://github.com/obra/superpowers) (MIT) workflows
to Smugan's approach: less conversation and more evidence, assuming a person who may
not be following along.

**Acceptance criteria before code.** When the request leaves the outcome open,
`smugan-build` states in one or two lines, before the first edit, what it will treat
as done and what it decided on its own. For a critical change with an open outcome,
it writes and saves a contract of 3 to 6 criteria, each with a way to verify it. It
only asks about what is the person's decision and does not wait for approval. A clear
request, such as "rename X to Y", needs neither.

The pre-write hook reminds the model on the first edit of a critical file in the
session. Critical is decided by path, never by the model: migrations and `.sql`,
`middleware`/`proxy` (file or folder), names such as `auth`, `authorization`,
`session`, `login`, `password`, `jwt`, `token`, `role`, `permission`, `guard`,
`policy`, `billing`, `checkout`, `stripe`, `webhook`, env and secret files,
`package.json` and `Cargo.toml`, and Rust with `unsafe`. Files that do not change
what the code does (prose, styles, images, fonts, translation catalogs) are trivial,
and the rest is normal. `smugan risk <level>` forces the checkout's level for 8
hours; when it downgrades a file, every end of turn warns the person. The reminder
says why the file is critical, asks for the contract when the project has none in
progress and mentions `critic`. When every criterion of the existing contract is
done, it asks to check with `smugan contract` before replacing it, because the
contract may belong to another session. An unreadable contract also triggers a
reminder, and `--set --replace` or `--clear` resolve it. It appears once per session
and per project and never blocks the write. Only Claude Code gets the reminder; the
adapters do not.

The contract is stored outside the repository, one per checkout. It is not per
session because the agent does not know its own session id, and the reviewers, which
are other subagents, need to find the same file. So that a second session or a new
task does not wipe out another's progress, `--set` refuses to replace an existing
contract without `--replace`. `done` and `blocked` require the evidence. `critic` and
`flow-critic` read the contract on their own and review the diff against it, instead
of reconstructing intent from the code they are judging.

```bash
smugan contract --set contract.json     # quoted request, {behavior, verify} criteria, out of scope, decisions
smugan contract --mark 2 done --evidence "npm test -- shipping → 12 passed"
smugan contract                         # what is left, and the evidence for what is done
```

The `smugan …` commands in this section and the following ones use the command
`install.sh` puts in `~/.local/bin`. With the folder off `PATH`, use
`node packages/gate/bin/smugan.mjs …`; agents find that path on their own, through
the installation's `smugan.paths.json`.

**A fresh context per task.** Adherence to instructions drops over the course of a
session. When the contract has criteria in separate parts of the code, each task goes
to a new subagent that receives only what it needs. The main agent checks each
criterion by running the verification itself. The contract serves as the progress
record and survives compaction.

Subagent edits go through the same hooks and enter the same end-of-turn
verification. This was verified on Claude Code 2.1.316: a subagent's edit lands in
the main session's turn state.

**Review findings are not accepted blindly.** Every `critic` and `flow-critic` report
ends with instructions for whoever receives it:

- reproduce each finding before fixing;
- reject, with the command output, a finding that does not reproduce;
- hand back to the person anything that conflicts with one of their decisions;
- report each finding as fixed, rejected or accepted.

**Delivery through a single path.** When the person asks to ship the work, the
`smugan-finish` skill picks the path from their words and the repository's convention
(PR history or direct commits). It executes that path and reports the real CI status
after the push, including when CI has not even started. Discarding work requires an
explicit request and confirmation of what will be lost. Commit and push still happen
only when the person asks.

## Code that uses an LLM

When the project uses an AI engine (an SDK, an agent framework, a runtime pinned in
an image) or writes a model id in the code, Smugan identifies the engine + model
pairs and the version of each, reading only from disk. The detector knows names and
patterns, listed in `packages/gate/src/ai/signatures.json`; adding an engine or model
is one entry in that file. Smugan ships no guide or best practice for any engine or
model.

A pair's guide is researched the first time a turn edits code that uses a pair
without a valid guide: the hook asks for delegation to the `smugan-ai-research`
subagent, which confirms the pair in the repository, reads only official
documentation and releases and saves up to 400 words with the sources. The guide is
valid for 30 days and lives in `~/.smugan/ai-guides/`, outside the checkout. At the
start of each session, the hook injects the guide index as reference material, and
the LLM testing rules come in only for projects that use an LLM: no real model and no
generated text in unit tests, only the deterministic part, and model behavior in a
separate eval. Details are in the
[engine documentation](packages/gate/README.md#ai-guides-per-engine--model-pair).

## Other coding agents

The engine is the same in every integration. What changes is each platform's ability
to block a write or resume a session.

| Platform | Installation | Main behavior |
|---|---|---|
| Claude Code | `./install.sh` | Blocks the write and can prevent the end of the turn |
| [Codex](adapters/codex/) | `cd adapters/codex && ./install.sh` | Blocks patches, returns errors to the agent and holds the end of the turn; hooks must be trusted in `/hooks` |
| [Antigravity](adapters/antigravity/) | `cd adapters/antigravity && ./install.sh` | Uses pre, post and final hooks; reviewers are reserved for risky changes |
| [OpenCode](adapters/opencode/) | `cd adapters/opencode && ./install.sh` | Blocks the tool call and resumes the session when the final check fails |
| [Grok Build](adapters/grok/) | `cd adapters/grok && ./install.sh` | Blocks before writing; a final failure shows up as a denial on the next turn |

Each adapter has its own README with installation, known limits and a verification
walkthrough. An integration is not described as equivalent when the platform does
not offer the same event.

All four adapters copy `smugan-build`, so the contract step reaches all of them.
Codex, Antigravity and OpenCode generate the reviewers from `claude/agents/`, with the
contract reading and the block for whoever receives the review. Grok uses its own
copies of the reviewers, which do not have these changes yet.

Per-task execution was written for Claude Code's `general-purpose` subagent and has
only been verified there. On the other platforms, nothing guarantees that subagent
edits go through the hooks. No adapter installs `smugan-finish`. `smugan contract`
and `smugan why` work with any platform; `smugan doctor` checks only the Claude Code
installation.

## How completion is verified

At the end of the turn, Smugan:

1. re-analyzes the touched files and enforces only what the turn introduced. An old
   problem in a file that was merely edited does not block. On Claude Code, the
   files a Bash or PowerShell command changed in its repository during the turn
   count as touched, with what each carried before the turn as its baseline;
2. compares pre-existing tests against their version at the start of the turn, when
   the turn also touched production code: an assertion lost or loosened holds the
   turn, and a test or test file removed is listed once;
3. runs the project's `typecheck` (or `type-check`) script, with the package manager
   indicated by the lockfile: pnpm, yarn or npm;
4. runs `vitest related` with the touched files when Vitest is installed; without it,
   runs the `test` script. In a monorepo, that script runs only in the touched
   packages, up to three; beyond that, it runs the whole suite;
5. in a project where the turn only touched trivial files, does not run the tests;
   without a typecheck script, runs the project's `tsc` on the touched TypeScript
   files, one program per `tsconfig`, and enforces only errors the committed version
   did not have; a `tsc` that exits with an error without reporting any type error
   also holds the turn. During the turn, the write runs only the file's eslint;
6. lists, once per turn and without deleting anything, what the agent's search tends
   to leave behind: a new script no other file references, named `repro`, `scratch`
   or `debug` or loose at the root; a `package.json`, lockfile, `tsconfig` or build
   config changed without the acceptance contract or the person's latest requests
   mentioning it; a new `catch`, `?? value` or guard that makes an existing function
   return a default value where it used to fail; and a new function identical to
   another in the repository, up to names and literals, with the file and line of the
   one that can be reused. The agent decides what stays and says why;
7. returns all failures to the session;
8. holds the turn once when no touched file is critical, and up to twice when one is.
   Only a gate rule or a script with a nonzero exit code holds it; if files change
   during the checks, the same end of turn re-checks the new state once, instead of
   holding the turn.
   At the limit, the turn ends without the hook running the checks again: the agent
   shows its own green run. Where the host says which end of turn continues a hold (Claude
   Code, and Grok Build through its adapter), the limit is the held turn's own: what the next
   turn writes is checked even when that one was interrupted. On a later turn in which every failure has already used up
   its limit, the turn ends without a new block; a new failure blocks again.

Scripts run in at most two projects per turn, because they all share the same hook
timeout. A third project with scripts to run shows up as incomplete verification,
never as passed; projects with nothing to run do not take a slot. The full behavior,
with timeouts and state files, is in the
[engine documentation](packages/gate/README.md#hooks-via-installsh).

The end of the turn never runs a build or mutation testing. Scripts share the same
hook timeout, and when the timeout runs out Smugan fails open: the person waits and
nothing gets verified. Build and mutation are left to CI or to an explicit request.
An old `"stop": {"build": true}` no longer has any effect, and `smugan doctor` warns
about it.

A task that changed only Markdown does not trigger typecheck or tests, because those
commands would not change the result. MDX is still counted as code, since it takes
part in the application build.

To find out later what happened, run `smugan why` from inside the project. It shows
the most recent session that worked in that folder, or another with `--session <id>`:

- how the last end of turn that checked files finished, and whether there were turns
  without edits after it;
- which files were analyzed and which were left out, with the reason;
- which scripts ran and with what result;
- which projects had no scripts, and why;
- the session's recent blocks and internal failures.

Those internal failures are the ones that, under the fail-open policy, only show up
as a warning at the time. The records stay in the system temp folder for 7 days.

## Testing the rules themselves

A Markdown rule is a claim that it changes what the agent does. The harness in
`evals/` measures this the way Superpowers measures its own skills: the same request
runs in a real Claude Code session with the rule and without it. The metric is what
the gate counts without relying on opinion: how many times the hook blocked on the
scenario's rules and how many violations remained in the delivery. For behavior the
gate cannot see, such as `critic` finding a planted authorization flaw, the scenario
defines two patterns: what the reply must say and what disqualifies it. On its own,
"found the flaw" also matches "there is no flaw".

```bash
node evals/run.mjs --scenario all --dry-run       # what would run
node evals/run.mjs --scenario db-naming --reps 3  # real sessions: costs tokens
```

Each session uses its own `CLAUDE_CONFIG_DIR`, installed by `install.sh`, and
therefore needs `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
`ANTHROPIC_API_KEY`. Results go in `evals/results/`, outside Git.

CI runs the whole harness with a fake `claude`, without tokens: real installation,
real rule removal, real project and `smugan check` on the delivery.

To compare two Smugan versions, `--tasks` runs ordinary coding requests, without
`/smugan`, in this checkout and in a Git ref installed by that ref's `install.sh`.
Each task in `evals/tasks/` has a level (trivial, normal, critical or LLM code) and a
hidden suite that only enters the project after the session: if it fails, the
delivery shipped a defect. The harness measures wall time, cost, stops (end-of-turn
blocks and agent questions), tests added and, in the LLM tasks, how many times the
agent's tests tried to use the network, which is turned off. At the end, it prints
the decision rule: time and cost drop by 25% or more, stops drop by 50% or more,
tests in the LLM tasks drop by 50% or more with no network calls, no additional
escaped defect in critical and at most one more in twenty in trivial and normal.

```bash
node evals/run.mjs --tasks all --baseline main --reps 3   # real sessions: costs tokens
```

A few tasks do not catch subtle differences: the result indicates direction. A new
task is a JSON file in `evals/tasks/` and two folders in `evals/fixtures/`, the
project and the hidden suite. Check that the suite fails on the project without the
fix. With `prompts` instead of `prompt`, the task runs several requests in separate
sessions on the same project, like a PR that builds on the previous one; time and
cost add up across sessions.

A scenario can remove a single item from an installed file (`"items":
["agents/critic.md#Contract drift."]`, by its bold label) and can measure a rule that
is not installed yet: `draft` applies a text from `evals/drafts/` only in the arm with
the rule, and the other arm is the installation as it is. With `"addedLines": true`,
the scenario counts the lines the session added. The SlopCodeBench gotchas block is
set up like this:

```bash
node evals/run.mjs --scenario claude-md-gotchas --reps 3   # real sessions: costs tokens
```

The project skill `.claude/skills/smugan-rules` drives any rule change in this
repository through the Superpowers writing-skills cycle:

1. a scenario that fails without the rule;
2. the smallest text that solves it, in the narrowest possible place;
3. the round that closes the loopholes;
4. the numbers from both arms in the CHANGELOG.

## Known limits

- The engine uses a tokenizer and regular expressions, not a full syntax tree.
- The checks favor precision. An ambiguous pattern may pass to keep a false positive
  from making the gate unusable.
- Most rules look at one file at a time. Cross-module decisions are left to the
  reviewers and the project's tests.
- A migration must enable RLS in the same file that creates the table. Enabling it
  later leaves an exposure window and is treated as a failure.
- An internal failure or timeout in Smugan does not block work. The error is
  reported, but the tool prefers to fail open rather than stop every session.
- Writes made outside the tools the platform observes may not go through the gate.
  On Claude Code, a file a shell command changes is seen through Git at the end of
  the turn, also when the turn commits it: only in the repository the command ran
  in, and alongside anything else that changed the repository during the turn,
  such as a person editing in parallel (`"hook": {"stop": {"shell": false}}` turns
  it off). A commit is the turn's when HEAD's reflog shows the turn making it (an
  amend counts for what it adds); what a pull, merge, checkout or rebase brings is
  not, whoever wrote it. With more than 2,000 files already changed, or past a
  3-second budget for recording them, the end of the turn says what it did not
  check.
  Each adapter's README records that scope.
- A model-based reviewer helps find semantic problems, but it is not deterministic
  proof. Tests and mechanical checks remain the basis for completion.
- The assertion comparison does not notice a changed expected value, a renamed test
  or `it.each`. A requested behavior change has the same shape, so those cases are
  left to `critic`.

## Repository structure

```text
smugan/
├── .claude-plugin/            Claude Code plugin and marketplace manifests
├── .github/workflows/         CI for the engine and adapters, and the pgTAP proof of the access model
├── .claude/skills/smugan-rules this repository's skill for writing and testing rules
├── claude/                    CLAUDE.md, rules, hooks, reviewers, skills and response style
├── packages/gate/             checks, hooks, version context, contract, doctor and why
├── evals/                     scenarios, fixtures and harness that measure the rules with and without them
├── adapters/                  integrations with Codex, Antigravity, OpenCode and Grok
├── templates/                 pgTAP, E2E, observability, security and CI
├── docs/                      version context validation walkthrough and quality report
├── CHANGELOG.md               changes in each version, across all packages
├── smugan.config.json         Smugan configuration for this repository itself
└── install.sh                 global installation for Claude Code
```

## Verifying Smugan itself

These are the same steps as continuous integration, which runs on Linux and Windows
with Node 22 and 24:

```bash
npm ci --ignore-scripts --prefix packages/gate

# engine: tests, strict-mode types and Smugan checking its own code
(cd packages/gate && node --test)
(cd packages/gate && npm i --no-save --ignore-scripts typescript@5.7.3 @types/node@22 \
  && node node_modules/typescript/bin/tsc -p tsconfig.json)
node packages/gate/bin/smugan.mjs check

# rules harness with a fake claude, no tokens
node --test evals/test/run.test.mjs

# adapters, each with this checkout's engine
for adapter in codex antigravity opencode grok; do
  (cd adapters/$adapter && node --test && node ../../packages/gate/bin/smugan.mjs check)
done
```

A separate workflow proves the access model's behavior: a policy that allows
improper reads must fail; a policy limited to the owner must pass.

See the [main workflow](.github/workflows/ci.yml), the
[database access test](.github/workflows/pgtap-smoke.yml) and the
[changelog](CHANGELOG.md) for what changed in each version.

## Origin and references

The design combines short rules in context with mechanical checks after them. The
main decisions rest on the references below:

- Anthropic: [memory and rules](https://code.claude.com/docs/en/memory),
  [hooks](https://code.claude.com/docs/en/hooks) and
  [best practices](https://code.claude.com/docs/en/best-practices);
- Supabase: [database testing](https://supabase.com/docs/guides/local-development/testing/overview)
  and [`supabase test db`](https://supabase.com/docs/reference/cli/supabase-test-db);
- Playwright: [locators based on what the user perceives](https://playwright.dev/docs/locators);
- OpenAI: [CriticGPT](https://arxiv.org/abs/2407.00215), on reviewing responses
  produced by models;
- Distyl AI: [IFScale](https://arxiv.org/abs/2507.11538), on the drop in adherence as
  the number of instructions grows;
- [ponytail](https://github.com/DietrichGebert/ponytail), a reference for short,
  imperative rules;
- [basejump/supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers),
  the MIT base of the pgTAP helpers incorporated into the templates;
- [Superpowers](https://github.com/obra/superpowers) 7.0.1 (MIT, Jesse Vincent). From
  it came, adapted and rewritten for Smugan:
  - the acceptance criteria, from brainstorming;
  - the fresh-context-per-task executor, from subagent-driven-development;
  - the rule testing cycle, from writing-skills;
  - the block for whoever receives the review, from receiving-code-review;
  - delivery, from finishing-a-development-branch;
  - `smugan why`, from diagnosing-superpowers;
  - the post-install smoke test.

### Using it with Superpowers

The two attack the same problem from opposite ends. Superpowers drives the process
before the code: intent, specification, plan and TDD. Smugan demands the evidence
afterwards: blocking, checks and review.

In Superpowers 7.0.1, the plugin registers only a `SessionStart` hook, and its skills
live in the `superpowers:` namespace. Smugan uses `PreToolUse`, `PostToolUse` and
`Stop`, with skills and agents under its own names, so there is no component with the
same name and no hook on the same event. When a brainstorming specification already
exists, `smugan-build` takes the criteria from it instead of interviewing the person
again.

Combining the two in the same session has not been measured yet.

### October 2026 review

Studies published after the original design confirmed the combination of short rules
with mechanical blocking and led to the adjustments below. Most are still preprints;
the Atlassian study appeared at ICSE 2026.

| Study | What it showed | What changed in Smugan |
|---|---|---|
| McMillan, [arXiv 2605.10039](https://arxiv.org/abs/2605.10039) | Across 1,650 Claude Code sessions, adherence to the rules file drops over the session (about 5.6% lower odds per generated function); rule size and position had no detectable effect | Confirms hook-based blocking instead of trusting the written rule |
| Gloaguen et al. (ETH), [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) | Context files do not raise the success rate and make runs more than 20% more expensive; they help when they describe non-standard practices | `CLAUDE.md` lost its generic lines and kept its own conventions |
| Zhong, Raghunathan and Carlini, [ImpossibleBench](https://arxiv.org/abs/2510.20270) | Over 79% of Claude models' cheating was editing the test; LLM-based monitors caught 42% to 65% of it on real tasks | New `assertion-weakening` rule at the end of the turn |
| Ma et al., [Building to the Test](https://arxiv.org/abs/2606.28430) | With access to the tests, agents deliver what is checked, not what was asked | `critic` requires the test to fail without the change, in a throwaway worktree, and checks the real entry point |
| Alexopoulos et al., [arXiv 2603.18740](https://arxiv.org/abs/2603.18740) | Telling the reviewer the code is correct drops detection (Claude Sonnet 4.5: from 97% to 75%); removing the PR description recovers some of the cases | Whoever calls the reviewer passes the original request, not the verdict; `critic` forms its findings from the diff |
| Tantithamthavorn et al. (Atlassian), [arXiv 2601.01129](https://arxiv.org/abs/2601.01129) | Over 12 months, 38.7% of the LLM reviewer's comments led to code changes, versus 44.5% of human comments | `critic` reports only what would lead to changing code: at most five findings, three of them LOW |
| Wataoka et al., [arXiv 2410.21819](https://arxiv.org/abs/2410.21819) | LLM judges favor text that seems familiar to them, such as what they generate themselves | Optional `SMUGAN_REVIEW_MODEL`; the default stays the conversation's model because the evidence for code is mixed |

### November 2026 review

Version 0.20 started verifying according to the change's risk, instead of applying
the same ceremony to everything. The studies below support the mechanism; attributing
each symptom (slowness, too many tests, stops, re-verification) to a specific Smugan
rule remains a hypothesis until the `evals/` A/B runs. Most are preprints or company
documentation.

| Study | What it showed | What changed in Smugan |
|---|---|---|
| Chen et al., [arXiv 2602.07900](https://arxiv.org/abs/2602.07900) | On SWE-bench Verified, resolved and unresolved tasks have similar test frequency; changing test volume via prompt, across 4 models, did not change the outcome significantly | The Definition of done replaces "green tests for everything" with one test that fails without the fix for a bug fix and one per new behavior, none for a reversible edit |
| Mündler et al., [SWT-Bench](https://arxiv.org/abs/2406.12952) (NeurIPS 2024) | Generated tests that fail before and pass after the fix work as a filter and double SWE-Agent's precision | The test that fails without the fix stays mandatory and `critic` still proves it in a worktree |
| Anthropic, [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Opus 4.5 and 4.6 respond more to the system prompt, and aggressive language ("CRITICAL: You MUST") meant to prevent undertriggering starts causing overtriggering | `CLAUDE.md` in a neutral tone; Claims stops telling the agent to distrust everything and accepts what the session ran as evidence |
| Huang et al., [arXiv 2310.01798](https://arxiv.org/abs/2310.01798) (ICLR 2024) | Without external feedback, models do not self-correct, and sometimes get worse after trying | Review and verification anchored in a command, test or reproduction; a finding that does not reproduce is dropped |
| Laban et al., [FlipFlop](https://arxiv.org/abs/2311.08596) | Challenged with "are you sure?", 10 models changed their answer in about 46% of cases and lost 17% accuracy on average | The instruction to re-check everything was removed: a run that already passed in the session is not repeated for confirmation |
| Sadowski et al., [Lessons from building static analysis tools at Google](https://cacm.acm.org/research/lessons-from-building-static-analysis-tools-at-google/) (CACM 2018) | Checks shown at review tolerate up to 10% effective false positives; checks that stop the build can have none | The end of the turn only holds on a gate rule or a script with a nonzero exit code: one block on an ordinary turn, two on a critical one |
| Petrović et al., [arXiv 2102.11378](https://arxiv.org/abs/2102.11378) | Mutation testing at Google runs only on changed and covered lines, with at most one mutant per line, and 82% of mutants with feedback were marked useful (later 89%) | Mutation and build are left to CI or on demand, never at the end of the turn, which shares a short timeout |
| Abreu et al. (Meta), [arXiv 2410.06351](https://arxiv.org/abs/2410.06351) | Gating the riskiest 5%, 10% and 50% of diffs captured 18.7%, 27.9% and 84.6% of incidents | Three risk levels decided by file path, with full rigor only for critical |
| Rajasekaran (Anthropic), [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) | A separate evaluator pays off when the task exceeds what the model solves alone and becomes cost without gain within that capability; each harness piece encodes an assumption to revisit with each model | `critic` and `flow-critic` only for a critical change or an ordinary diff over ~300 lines |
| Jin and Chen, [Are LLMs reliable code reviewers?](https://link.springer.com/article/10.1007/s10515-026-00638-5) (Automated Software Engineering, 2026) | LLM reviewers frequently flag correct code as defective, and more detailed prompts, especially those asking for explanation and a fix, increase the error | At most five findings per review, three of them LOW, each reproduced by its own `verify` |

The earlier prototype, [`gate`](https://github.com/DenisCDev/gate), defined the first
separation between rules, blocks and proof. Smugan kept that idea, removed the
mandatory per-project toolchain and focused the engine on checks that work without
installing dependencies.

### November 2026 review: code quality

The second November round asked what improves the quality of the agent's code per
token spent, without reading the diff. The evidence points to three things: the
installed version's context always present and compact, deterministic verification
at the end of the turn with a cap on rounds, and mechanical removal of what the
agent's search left behind. Generic quality prompts and open-ended reviewers cost a
lot and barely change the outcome. Almost everything below is a preprint or company
document, and none of the changes has run in a real session yet.

| Study | What it showed | What changed in Smugan |
|---|---|---|
| Vercel, [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) (vendor document) | An 8 KB index of the installed Next.js docs, always in context, took the Next 16 API evals from 53% to 100%; the same information as a skill stayed at 53%, because it was not invoked in 56% of cases | `smugan context` generates the index of the installed version's docs, and the `pre` hook delivers it on the first edit of a file covered by a stack rule, once per session and per package |
| Vercel, [How Next.js supports AI coding agents](https://nextjs.org/docs/app/guides/ai-agents) (vendor document) | Next.js started shipping the version's docs inside the package | The index points to `node_modules/next/dist/docs`, which on this machine already exists in `next@16.2.10` and does not exist in 16.0.10 |
| "When LLMs Lag Behind", [arXiv 2604.09515](https://arxiv.org/abs/2604.09515) (preprint) | Across 270 real API updates, only 42.55% of code generated without documentation runs in the target environment; with structured documentation, 66.36% | The same index, with the paths to the installed version's docs and the sentence "Prefer what these docs say over what you remember about the version." |
| "On Mitigating Code LLM Hallucinations with API Documentation", [arXiv 2407.09726](https://arxiv.org/abs/2407.09726) (preprint) | The API signature alone yields 86.82% valid calls, versus 88.75% with the full doc, which costs 13× more tokens; irrelevant retrieval makes frequent APIs worse | The index carries the `.d.ts` signatures of what the file imports and never the body of a doc, capped at ~2k tokens |
| TRIM, [arXiv 2607.18161](https://arxiv.org/abs/2607.18161) (preprint) | In patch minimization on SWE-bench Verified, the removed files were repro scripts (49.6% of removed lines) and build/config changes (35.8%), with hidden correctness preserved in 99.1% | The end of the turn lists, once and without deleting, a new script nothing references and changed config that neither the contract nor the request mentions (`exploration-residue`) |
| CodeThread, [arXiv 2606.21804](https://arxiv.org/abs/2606.21804) (preprint) | Building on agent code reduced resolution of the next task by up to 13.1 points; the predictor was drift in the input and error contract (OR 1.83), which survived in 85.9% of cases, and cyclomatic, cognitive and Halstead complexity predicted nothing | `contract-drift` detector at the end of the turn, only on existing functions; a closed item in `critic`; no complexity limit as a block |
| RepoReuse, [arXiv 2609.35357](https://arxiv.org/abs/2609.35357) (preprint) | Across 3,000 turns, agents left duplicated logic in 50.8% of chains by turn 5, with an almost unchanged pass rate | Type 1 and 2 `clone` detector at the end of the turn, with an incremental index and a 500 ms cap |
| PerfAgent, [arXiv 2607.19653](https://arxiv.org/abs/2607.19653) (preprint) | Profiler feedback in the loop doubled the patches matching the expert (19.6% → 39.2% on GSO; 26% → 74% on SWE-fficiency-Lite); merely instructing the agent to use the profiler stayed at 16.7%, a figure the report took from a secondary source | In `smugan-build`, a performance task measures before and after, in up to 3 rounds; a critical change to a handler gets a query-count criterion; `await-in-loop` in `pre`, only on critical turns |
| PERFOPT-Bench, [arXiv 2607.07744](https://arxiv.org/abs/2607.07744) (preprint) | Raw speedup is an unsafe metric: part of the large gains comes from shortcuts that exploit the benchmark | The measured round ends with the suite green, and the N+1 task in `evals/` uses a hidden volume |
| Cost-Aware Text-to-SQL, [arXiv 2512.22364](https://arxiv.org/abs/2512.22364) (preprint) | Partition filters are missing in up to 50% of generated queries, and cost varies up to 3.4× between models | The "the listing has a limit" criterion enters the contract for a critical change to a listing |
| Stripe, [Minions, part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) (engineering post) | Deterministic nodes (lint in under 5 s) interleaved with agentic ones; CI stays at 2 rounds due to diminishing returns | The new detectors are deterministic and each finding appears once; the end of the turn keeps 1 block on an ordinary turn and 2 on a critical one |
| Anthropic, [code-simplifier](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) (vendor document) | The Claude Code team uses an agent to simplify the changed code at the end of the session; no effect figure is published | End-of-session cleanup becomes a mechanical check (residue and clone), with no extra model pass |
| SlopCodeBench, [arXiv 2603.24755](https://arxiv.org/abs/2603.24755) (preprint) | Structural erosion rises in 80% of trajectories; the anti-slop prompt with a concrete list cuts about 1/3 of the initial verbosity, without changing the slope or the pass rate, and cost +47.9% on GPT 5.4 | The gotchas block became a measured draft (`evals/drafts/gotchas.md`, `claude-md-gotchas` scenario), outside the installed `CLAUDE.md` |
| Kadam, [arXiv 2610.38977](https://arxiv.org/abs/2610.38977) (preprint) | A quality prompt in a single call did not reduce analyzer issues in any of 4 models; an agentic reviewer does not beat best-of-n at equal budget; an analyzer loop run until zero drops pass@1 by up to 9.94 points | No new generic quality sentence in `CLAUDE.md`; `critic` keeps a closed checklist |
| CodeRabbit, [arXiv 2607.03316](https://arxiv.org/abs/2607.03316) (preprint) | Across 31k comments, 56.3% of the agentic reviewer's suggestions were rejected; among them, 43.3% were false positives and 23.7% intentional trade-offs | `critic` dropped design and organization findings that lack a written repository norm, and a finding without an executable `verify` is discarded |
| Goldman et al., [What Types of Code Review Comments Do Developers Most Frequently Resolve?](https://www.researchgate.net/publication/396291600_What_Types_of_Code_Review_Comments_Do_Developers_Most_Frequently_Resolve) (ASE 2025, peer-reviewed) | Design comments were resolved in 28.6% of cases, versus 43.3% for readability ones | LOW in `critic` now requires a cited norm the repository writes down |
| SWE-Shield, [arXiv 2604.05955](https://arxiv.org/abs/2604.05955) (preprint) | Patches that pass the tests satisfy the repository's design constraints in only 32.64–50.20% of cases, and giving the agent the issue's constraint barely changes that | What counts as a design finding in `critic` is the norm the repository writes down, not the reviewer's preference |

Left out for lack of evidence, to be measured in the harness before any adoption: the
gotchas block itself, tested only on OpenAI models; counting queries as an agent
guard, which no study measures; waterfall and re-render detection in React/Next; a
symbol map of the touched module to increase reuse; and replicating each figure above
on Opus and Gemini, since PerfAgent ran only on GPT-5.1 and the Vercel eval does not
state a model.

The full report, with the table by dimension, what not to add and the quality of each
source, is in [docs/senior-quality.md](docs/senior-quality.md).
