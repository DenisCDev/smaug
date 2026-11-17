# smugan (gate) — check engine

Quality-gate CLI with local, version-aware context. The checks and hooks use
only Node; the `context` command loads three maintained parsers (`yaml`,
`smol-toml`, `jsonc-parser`). The rationale is in the [root README](../../README.md).

## Usage

```bash
node packages/gate/bin/smugan.mjs check            # whole project from the cwd
node packages/gate/bin/smugan.mjs check src/ --json # specific path, output for agents
node packages/gate/bin/smugan.mjs init             # config + verification scaffolding, never overwrites
node packages/gate/bin/smugan.mjs context --json   # versions, evidence and relevant guides
node packages/gate/bin/smugan.mjs hook pre         # hook entry point: reads the event JSON from stdin
node packages/gate/bin/smugan.mjs doctor           # checks the Claude Code installation, with a test event
node packages/gate/bin/smugan.mjs why              # what the hooks did in the most recent session
node packages/gate/bin/smugan.mjs contract         # the checkout's acceptance contract
node packages/gate/bin/smugan.mjs risk critical    # forces the checkout's risk level for 8 h; `auto` hands it back to the hook
node packages/gate/bin/smugan.mjs ai-guide         # the project's engine + model pairs and the state of their guides
node packages/gate/bin/smugan.mjs version          # package version
```

Exit codes: `0` clean · `1` violations · `2` usage/internal error. `hook` follows
the Claude Code contract: `2` blocks and sends stderr to the agent; `0` allows. The
`--json` output of `check` includes `ok`, `filesChecked` and `violations` (file, line,
rule and message), sorted by file and line. `doctor` exits with `1` when any
check fails; `why` and `contract` exit with `1` when
there is no record, and with `2` on a usage error.

## Acceptance contract

```bash
smugan contract [folder] --set contract.json [--replace]
smugan contract [folder] --mark <n> <pending|done|blocked> [--evidence "<command> → <result>"]
smugan contract [folder] [--json]
smugan contract [folder] --clear
```

The contract belongs to the checkout: the Git top level from the folder, or the folder
itself outside a repository. It is stored outside it, in `<cache>/smugan/contracts/<hash>.json`
(`LOCALAPPDATA`, `XDG_CACHE_HOME` or `~/.cache`; `SMUGAN_CACHE_DIR/contracts` when
set), so it never shows up in `git status` or in a commit.

`--set` accepts only these fields and rejects anything else, listing each problem:

| Field | Rule |
|---|---|
| `request` | the quoted request, up to 4000 characters |
| `criteria` | 3 to 6 `{ "behavior", "verify" }` objects, up to 600 characters per field |
| `outOfScope` | optional, up to 6 short items |
| `decisions` | optional, up to 6 `{ "decision", "reason" }` |

Every criterion starts as `pending`. About the actions:

- **`--mark`** records the status; `done` and `blocked` require `--evidence`, and `pending`
  clears the previous evidence.
- **`--set`**, when a contract already exists, refuses and shows what exists: the request, the
  date and how many criteria are done. Only `--replace` overwrites it. There is one contract per
  checkout, and another session's progress in the same checkout must not disappear
  silently.
- **`--clear`** removes it and says what it removed.
- One action at a time. The exit code is 1 when there is no contract to read, and 2 on a usage
  error or a rejected contract.

`critic` and `flow-critic` read the contract through the command itself and ignore it when the
quoted request does not match the one under review.

## Diagnostics: `doctor` and `why`

`smugan doctor` reads the installation in `CLAUDE_CONFIG_DIR` or `~/.claude` and checks:

- Node;
- Smugan's hooks in `settings.json`;
- `"disableAllHooks": true`, which turns off every hook, in the user's `settings.json` and
  in the current folder's `.claude/settings.json` or `.claude/settings.local.json`.
  `allowManagedHooksOnly` only applies in managed settings, which it does not read; the session's
  `/status` shows that source;
- the launcher and `smugan.paths.json`;
- the `smugan` command in `~/.local/bin` (or `SMUGAN_BIN_DIR`): whether it was written by
  `install.sh`, whether it points to this checkout, whether the folder is on `PATH` and whether another
  `smugan` comes before it. All of these are warnings, because agents still reach the
  engine through `smugan.paths.json`;
- the installed copies against this checkout, with the same path rewriting as
  `install.sh`;
- the parsers;
- Git Bash, on Windows.

Then it sends a synthetic migration `Write` through the installed launcher and requires
exit 2 with `smugan gate: blocked`, plus an empty-session `Stop`, which must exit with 0.
This runs in a temporary folder, deleted at the end along with that test session's state
files. `--json` returns the lines for agents. The exit code is 1 when any
line fails, including an outdated copy, which still works but is not this
checkout's.

`smugan why [--session <id>] [--json]` reads what the engine recorded for the session. Without
`--session`, it shows the most recent session that worked in the current folder: the one that
edited files inside it, ran from it or checked a project that contains it.
A session opened in the home folder does not count for every folder below it. With none,
it shows the most recent one from any folder and warns. This record also applies to the adapters, which
use the same `runHook`. There are two files in the system temp folder, deleted
after 7 days:

- `smugan-report-<session>.json`, written at every end of turn, with:
  - the outcome, including `error` when the end of turn itself fails and releases the
    turn without checking;
  - the attempt and the session folder;
  - each file, analyzed or left out of the analysis and why (ignored, larger than
    1 MiB, end of turn or re-analysis turned off, deleted);
  - the scripts with their results;
  - the projects where the scripts did not run, and why;
  - the failures and the incomplete checks.

  A turn with no edits does not replace the report of the last checked turn:
  it only notes when it happened;
- `smugan-events-<session>.json`, with the last 50 `pre` and `post` blocks and the
  internal failures that made a hook fail open.

Allowing an edit writes nothing. A failure to write these records never changes the
hook's decision.

## Version-aware context

After cloning, install the parsers once with
`npm ci --ignore-scripts --prefix packages/gate`. The command installs nothing
automatically. Run it in the working project, passing the installed Smugan
executable or the absolute path to `bin/smugan.mjs`:

```bash
smugan context --json apps/web --environment development
smugan context --json apps/web --refresh
smugan context --json apps/web --no-cache
```

`packages` presents the inventory; `selectedPackages` and `guides` select the target.
Each component separates the declared, lockfile-resolved and installed version, with
evidence. `runtime.node` is only the process that ran the command. Docker
images and local Supabase configuration do not prove the production version.
JS/TS configurations are never executed; uncertain flags, topology and capabilities
require specific inspection. `--environment` is a label, not a remote connection.

The detector parses npm, pnpm importers, text/JSONC Bun and Cargo/TOML.
Ambiguity, an unsupported format, a read limit or an inconsistent lockfile produces
an explicit limitation. Yarn and binary Bun require installed evidence or
manual verification; no unknown version is treated as the latest.

The default cache is `.smugan.local/context.json`, along with an ownership
marker. Only the managed artifacts go into Git's local `info/exclude`;
the shared `.gitignore` does not change. Worktrees use the metadata path
reported by Git and separate inventories. A collision, tracked path, link or
lack of write access redirects to the user's private cache. `SMUGAN_CACHE_DIR`
lets you choose the base of that fallback; if it also fails, discovery continues
without persistence and reports the limitation. Do not force these files into Git.

Each entry is separated by checkout, target and environment. Content hashes of the
manifests, lockfiles, configurations and installed metadata invalidate results;
adding/removing an app also invalidates them. Atomic writes and a lock with a deadline
preserve concurrent entries; an abandoned lock is not stolen by age.
`--refresh` resolves again. `--no-cache` does not read/write the cache or change exclusions.
The inventory contains derived data, never `.env` values, source code,
credentials or permanent approval of tests/review.

The `docs` block (read on the fly, outside the cache, like `ai`) lists, for up to four
selected packages, the declared dependencies whose installed copy ships doc files
in `dist/docs/` or `docs/` (Next 16.2+ ships `node_modules/next/dist/docs`), with
installed version, folder and file count, and a text `index`. When the target is a
file, the `index` starts with the `.d.ts` signatures of the modules it imports
(resolved through `exports`, `types` or `@types/`, following re-exports): the imported
names first and, in a module with up to 20 exports, the others. The `index` is at
most 8,000 characters (~2k tokens), lists paths grouped by folder and never
copies the body of a doc; whatever does not fit becomes "list <folder> for the rest". The
`pre` hook delivers the same text (see Hooks).

### Reusing a researched decision

The assistant consults the appropriate official documentation when needed. To
persist a short conclusion, create a JSON file with exactly these fields:

```json
{
  "component": "next",
  "version": "16.2.1",
  "concern": "cache-components",
  "summary": "Cache Components depends on explicit configuration; check the configuration before adopting that mode's APIs.",
  "source": "https://nextjs.org/docs/app/getting-started/caching",
  "reviewedAt": "2026-10-02"
}
```

Use the version actually observed and the actual research date, then run
`smugan context --json apps/web --record research.json`. The writer validates the format,
the version observed in the target, an HTTPS source on an allowed official domain and
bounded fields. It does not fetch the URL or certify the conclusion. The input file is
the responsibility of whoever created it: use a private temporary file without credentials.

`decisions` reappears in the next chat; metadata changes invalidate these
records conservatively. After 30 days, `status: review-required` requires
a new check. Security, dependencies and deployment require current sources even
before that deadline. The record is informational evidence, never an executable instruction,
a user-approved preference or a substitute for checks. Up to 32 decisions per
context and 64 contexts per checkout are kept. No daemon is installed.

## AI guides per engine + model pair

`smugan context --json` includes the `ai` block: the engines, models and
`engine@major.minor+family@version` pairs the project uses, each with its guide's state
(`valid`, `expired` or `missing`) and its path. Detection reads only the disk, with no
network, no executing configuration and no opening `.env`: `package.json` dependencies,
the version installed in `node_modules`, `pyproject.toml` and `requirements*.txt`, images
pinned in Dockerfile and compose, marker files and model ids written as
strings in the code. A model that only arrives through an environment variable becomes `runtime`; a
model with no known engine produces a model-only pair. A model pairs with the engines
imported in the same file; in a project with a single engine, with that one. Tests, fixtures, docs, examples,
`node_modules` and prose do not count. The scan stops at 8,000 entries and 800 files
read and says when it stopped (`truncated`).

Everything the detector knows is in `src/ai/signatures.json`: package names,
imported modules, markers, images and the model id pattern. A new engine or
model is an entry in that file, with no code change. Smugan ships no
guide, version or best practice for any engine or model.

```bash
smugan ai-guide [--project folder]                  # the project's pairs and the state of each guide
smugan ai-guide --write guide.md [--project folder] # saves a researched guide
```

A guide is researched only when a detected pair has no valid guide, by the
`smugan-ai-research` subagent, which confirms the model string and the installed version
in the repository, reads only official documentation and the project's releases, and cites URL and date.
`--write` rejects a pair the project does not use, a date outside the last 30 days, a source that
is not HTTPS, more than 400 words and a first paragraph longer than 60. The guide lives in
`~/.smugan/ai-guides/`, one file per pair, valid for 30 days from the research; the
checkout only points to it.

## Per-project installation

The global hook (installed by `install.sh`) already runs the gate on every Claude Code Edit/Write —
no per-project installation is needed. `install.sh` also puts the `smugan` command
in `~/.local/bin` (`SMUGAN_BIN_DIR` changes the folder). In an environment without it, such as CI:

```bash
npm i -D file:<path-to>/smugan/packages/gate
npx smugan check
```

## Configuration

`smugan.config.json` is looked up walking up from the analyzed file's folder; the
folder that contains it becomes the project root. Without the file, the defaults below apply, and the
root is the nearest folder with `.git`; without `.git`, the nearest one with `package.json`;
without either, the file's own folder. That is why a monorepo with a single
`.git` has one root, and packages are separated by the end-of-turn test
scope. Invalid JSON
also falls back to the defaults: `smugan check` warns, the hooks continue silently.

```json
{
  "ignore": ["generated/**"],
  "checks": { "console-log": false, "rls": { "exempt": ["reference_data"] } },
  "hook": {
    "eslint": true,
    "typecheck": true,
    "timeoutMs": 30000,
    "stop": { "smugan": true, "typecheck": true, "tests": true, "shell": true, "timeoutMs": 120000 }
  }
}
```

| Field | Default | Effect |
|---|---|---|
| `ignore` | `[]` | globs (`*`, `**`, `?`) added to the fixed ignores below |
| `checks.<rule>` | on | `false` turns the rule off; an object passes options |
| `hook.eslint` | `true` | the post hook runs the project's ESLint on the written file |
| `hook.typecheck` | `true` | without a typecheck script, the end of turn runs the project's `tsc` on the touched `.ts`/`.tsx`/`.mts`/`.cts` files; with `"stop": false`, the post hook runs it on the written file |
| `hook.timeoutMs` | `30000` | deadline for each ESLint run, and for `tsc` when it runs in `post` |
| `hook.stop` | object | `false` turns off the whole end of turn for that project's files: re-analysis, test comparison and scripts |
| `hook.stop.smugan` | `true` | re-analyzes the touched files with Smugan's rules and compares the existing tests |
| `hook.stop.typecheck` | `true` | runs the `typecheck` or `type-check` script |
| `hook.stop.tests` | `true` | runs the related tests |
| `hook.stop.shell` | `true` | also checks the files a Bash or PowerShell command changed in the repository during the turn; `false` when people edit the repository while the agent works, since their changes would count as the turn's |
| `hook.stop.timeoutMs` | `120000` | deadline for each end-of-turn script and for each `tsc` program in it |

Per-rule options:

| Rule | Option | Effect |
|---|---|---|
| `db-naming` | `allow` | identifiers accepted even outside the convention |
| `rls` | `exempt` | tables exempt from RLS |
| `rls-tests` | `exempt`, `dir` | tables with no required test; pgTAP test folder (default `supabase/tests`) |
| `security-notes` | `exempt`, `file` | tables with no required description; notes file (default `SECURITY_NOTES.md`) |
| `ui-strings` | `english`, `accents` | `false` turns off the search for English or the search for words missing accents |
| `clone` | `minTokens` | minimum body size, in tokens, for a function to count as a clone (default 60) |

`exploration-residue`, `contract-drift`, `clone` and `await-in-loop` also accept
`false` in `checks`.

Never analyzed: `node_modules`, `.git`, `.next`, `dist`, `build`, `out`,
`coverage`, `.vercel`, `.turbo`, `.expo`, the dependency folders of other stacks
(`.venv`, `venv`, `site-packages`, `__pycache__`, `.terraform`, and a `vendor`
folder that Composer, Go modules or Bundler filled: one holding `autoload.php`,
`modules.txt` or `bundle/ruby` (`jruby` and `truffleruby` too); a folder merely named
`vendor` is the project's own code),
`*.min.*` and `*.gen.*` files, npm, pnpm
and yarn lockfiles, `database.types.ts`, `.env`, `.env.local`, `.env.*.local` and the
context cache artifacts.

## Checks

`rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`,
`search-path` and `rls-policy` follow Supabase's access model, so by default they run only on a
migration Supabase owns: one under
`supabase/migrations/`, or one whose folder or any folder above it, up to the
project root, has `supabase/config.toml` or a `supabase` / `@supabase/*` dependency in
its `package.json` (so a monorepo app counts). A plain Postgres project turns one on with `true` in `checks`, and
`false` turns it off anywhere.

| Rule | Catches |
|---|---|
| `db-naming` | SQL identifier in Portuguese, accented or not in snake_case: a table (temporary and unlogged ones too) and its columns, an added column, a rename (`rename column … to`, `rename to`), an index, function, procedure, type, view, materialized view, schema, sequence, trigger and policy |
| `rls` | `create table` in a migration without `enable row level security` in the same file; a migration that runs `disable row level security` on a table, unless the same file enables it again later or drops the table, or it is a down migration (`*.down.sql`, Diesel's `down.sql`, the down section of a goose, dbmate or sql-migrate file) |
| `view-invoker` | view in `public` created in a migration without `security_invoker = true`, and not set later with `alter view … set (security_invoker = true)` — the view reads its tables with its owner's rights, so their RLS does not apply to whoever queries it (PostgreSQL 15+; Supabase's `security_definer_view`) |
| `search-path` | `security definer` function or procedure created in a migration without `set search_path` in its clauses or in a later `alter function` — a caller can shadow what it uses and run code with its owner's rights (PostgreSQL docs, "Writing SECURITY DEFINER Functions Safely"; Supabase's `function_search_path_mutable`) |
| `rls-policy` | `create policy` in a migration that leaves RLS enabled but not restricting: a permissive policy for `update`, `delete` or `all` (the default) whose `using` is `(true)` or `(1=1)`, unless every role in its `to` is a server role such as `service_role`; and a policy of any command whose `using` or `with check` reads `user_metadata` or `raw_user_meta_data`, which the user edits through `auth.updateUser()` (Supabase's `permissive_rls_policy` and `rls_references_user_metadata`). A read or an insert open to everyone is left to the table's pgTAP test, and a policy without `using` shows no row in PostgreSQL |
| `rls-tests` | table created in a migration with no matching pgTAP test in `supabase/tests/` |
| `security-notes` | table created in a migration with no plain-language description in `SECURITY_NOTES.md` |
| `ui-strings` | hardcoded English in JSX/visible attributes; pt-BR missing accents/cedilla |
| `no-any` | `any` in a type position (annotation, `as any`, any generic or tuple slot such as `Record<string, any>`, union, function return, `type X = any`) without a justification comment (`// any: <reason>`); `keyof any` and `T extends any` pass. Also the other off switches of the type system, when the comment gives no reason of 6+ characters after the directive: `@ts-nocheck` and `@ts-ignore`. `@ts-expect-error` passes without one: it fails by itself once the error is gone |
| `secrets` | AWS/Google/OpenAI/GitHub (classic and fine-grained)/Slack/Stripe keys, `whsec_` webhook signing secrets, hardcoded JWT, `sb_secret_…`, a database URL carrying its password for a remote host (`postgres://user:password@db.….supabase.co/…`; a compose service name, loopback and private addresses, a placeholder and a password that is a variable, an expression or an interpolation (`$DB_PASS`, `${DB_PASS}`, `$(DbSecret)`, `{quote_plus(db_pass)}`) pass; a capitalized `$Name` is a variable only where the language reads it as one, in shell, PowerShell, YAML, PHP, Kotlin and Dart files and in Dockerfiles, and a password elsewhere; every `@` between the user's colon and the first `/` is tried as the one before the host, so `P@ssw0rd` and `P@ss#w0rd` are flagged whichever way a parser reads them, while an `@` inside an interpolation (`#{@config.host}`, `${ user }`) or after a host and its query separates nothing; a host is local by its own text, so one the code builds with a dot in it (`${config.db.host}`, `db.${STAGE}.acme.io`) is not, a placeholder inside a remote name is part of it (`aws-0-[region].pooler.supabase.com`), and the address a protocol wraps or a variable defaults to is the host (`tcp(127.0.0.1:3306)`, `${DB_HOST:-db}`); every URL of a line is read; an authority that opens with a host and goes on with a property or a query (`host:1433;database=app;user=…`, as SQL Server writes its URL; `host:5672?owner=ops@acme.io`) holds no user and password pair, and a password given as a property or a query parameter, `;password=…` or `?password=…`, is not read), service_role/`sb_secret_` in `"use client"` or `NEXT_PUBLIC_*`, a real secret or database URL in `.env.example` (also `.env.sample`, `.env.template`, `.env.dist`; the URL on any line, a commented-out one included). Read in JS/TS, JSON, YAML, TOML and SQL, and in the source and infrastructure files of other stacks: Python, Go, Rust, Ruby, PHP, Java, Kotlin, C#, Swift, Dart, shell and PowerShell scripts, Astro, Vue and Svelte components, Terraform, Prisma schemas and Dockerfiles. Prose is not read |
| `console-log` | `console.log/debug/info/table/dir/trace` outside scripts/tests/config (`warn`/`error` allowed) |
| `dead-imports` | import declared and never used in the file |
| `stale-mutation` | server action (`'use server'`) that writes to the database (`.from(...).insert/update/upsert/delete` or `.rpc(...)` — read-only prefixes `get_/list_/search_/count_/fetch_` exempt) with no `revalidatePath`/`revalidateTag` (or `expirePath`/`expireTag`, or `updateTag()`/`refresh()` imported from `next/cache`) in the file — the mutation writes and the screen keeps showing stale cache |
| `test-weakening` | in test files: `.skip`/`.only`/`.todo`/`.fixme`/`xit`/`fit`/`fdescribe`, a `skip`/`only`/`todo` option set to `true` or a reason (`test('x', { skip: true }, fn)`), a test marked as expected to fail, which passes while the behavior stays broken (Playwright's `test.fail`, also where it annotates the test it stands in, Vitest's `it.fails` and `{ fails: true }`, Jest's `it.failing`), any of those markers behind another modifier (`it.concurrent.fails`, `test.describe.serial.only`) or set on Playwright's test info (`testInfo.skip()`, `test.info().fail()`), an `it`/`test` block with no assertion (`expect`/`assert`, Vitest's `expectTypeOf`/`assertType`, chai's `.should`, or any Cypress `cy.` command, which fails the test by itself; a block runs to where the next test starts, and Playwright's `test.step`, `test.slow`, `test.setTimeout`, `test.info` and `test.expect` inside it start none, nor does `test.skip`, `test.fixme` or `test.fail` where it annotates the test it stands in), an assertion between equal constants (`expect(true).toBe(true)`, `assert.equal(1, 1)`) outside a file that counts its assertions (`t.plan`, `expect.assertions`), `process.exit(0)` — the mechanical forms of test gaming; a test that asserts a mock is left to the critic |
| `assertion-weakening` | only at end of turn, when the same turn changed production code: a pre-existing test, with the same title, lost strong assertions — removed or replaced with `toBeDefined`/`toBeTruthy`/`toBeFalsy`/`not.toBeNull`/`assert.ok` (`expect.soft` and `expect.poll` are read like `expect`). Compares against the version from the start of the turn (or HEAD). Also, listed once per turn like `contract-drift`: a pre-existing test with strong assertions that is gone, when its file declares fewer tests than at the start of the turn (deleted or commented out; every declaration counts, a title several `describe` blocks share and a test declared with a modifier or a condition included, a table and a test with a computed title too, counted with no name to quote, while Playwright's `test.skip(condition, reason)` and `test.fail()` declare none), and a test file deleted during the turn, by a command or by a commit of the turn, or renamed to a name that is no test file. Not counted: a title another test file of the turn gained (the test moved; each test gained there takes one test gone, whichever file lost it, and a table or a computed title moves by count), tests merged with their assertions kept, a test the turn itself wrote, and a deletion made before the turn, an earlier turn of the session included, that the turn only commits. Production code changed means a production file that is still there was written: a test file deleted together with its module is listed when the turn also rewrote other code (the importers of a removed feature), and the agent says the feature went, because file names could not tell the two apart without missing real deletions; a turn that only deletes files is not listed. A changed expected value, a renamed test, tests folded into a new `it.each` table or loop, and assertions lost under a title repeated across several `describe` blocks or inside `it.each` are left to the critic: a legitimate behavior change has the same shape. Tests turned into rows of a table the file already had are listed once, since rows cannot be counted |
| `money-float` | column whose name has a money word (`price`, `amount`, `total`, `cost`, `value`, `balance`, `fee`, `salary`, `payment`, `revenue`), plural or not, as a word of the name (`unit_price`) or at the end of one (`subtotal`, `unitprice`); `fee` counts only as a whole word, so `feedback_score` and `coffee_count` pass. Declared or converted (`alter column … type`) as `real`/`float`/`double precision`/`money` in a migration — use `numeric(12,2)` or integer cents (PostgreSQL §8.1) |
| `empty-catch` | empty `catch` or one with only comments, empty `.catch(() => {})` — error silently swallowed; a catch with a body that ignores the error variable requires judgment and is left to the critic |
| `anon-grants` | `GRANT` (or `ALTER DEFAULT PRIVILEGES … GRANT`) to `anon`/`authenticated` on a schema that is not `public`/`graphql_public`/platform — the browser role does not reach a data schema; a genuinely public catalog uses `smugan-ignore` with a reason |
| `fetch-timeout` | `fetch(` in server code (file without `"use client"`) without `signal:`/`AbortSignal` — a hang is worse than a fast error. `timeout:` counts only for a `fetch` imported from a library (node-fetch 2) and for `$fetch`: the platform fetch and undici ignore it; a `client.fetch()` wrapper is a deliberate false negative, while `globalThis.fetch` is the platform fetch. A function, method or type member named `fetch` being declared (`export default { fetch(request) { … } }` in a Worker or Bun server) is not a call |

These do not run in `smugan check` because they depend on the turn: they only exist in the hook.

| Rule | Where | Catches |
|---|---|---|
| `await-in-loop` | `pre`, only in a critical turn (forced level, the edited file or another critical file already touched in the turn) | `await` on a database client (`db`, `prisma`, `supabase`, `knex`, `sql`, `tx`, `drizzle`, `repo`…; `client`, `pool` and `conn` only with `.query(`/`.execute(`) inside a collection traversal (`for…of`, `for…in`, index up to `.length`, `forEach`/`map`/`flatMap` callback), and `await fetch` inside `forEach(async…)`. Only the loop the edit adds. Excluded: `while`, `for (;;)` and retry loops, `for await`, `storage` transfers and `fetch` in a `for` |
| `exploration-residue` | end of turn, once per finding | a script created in the turn that no other file references (`git grep` for the whole file name or a path that ends in it as an import writes one, relative, aliased or from the root, including `./x.js` for `x.ts`, tracked and untracked: `retry.mjs` does not name `try.mjs`, and an absolute path (`'/tmp'`, `'/private/tmp'`), a URL, a package (`@types/debug`, `node_modules/tmp`) and a lockfile name no file of the project, while an import of a file of the same name in another folder still counts, since paths are not resolved; the files that hold a piece of the name are read whole, up to 2,000 of them or 32 MiB between them, and past either limit the script counts as referenced; convention files such as `proxy`, `middleware` and `instrumentation` never count), named `repro`/`scratch`/`debug`/`tmp`/`try`/`playground`/`poc` or, when the turn's scope is known, left loose at the root; a changed `package.json`, lockfile (by mtime and `git status`), `tsconfig`/`jsconfig` or build config that the scope does not mention, either by the subject's words or by the name of a dependency the diff added. The scope is the contract with an open criterion plus the person's last three requests in the transcript; with neither, only the exploration names count. Without git, nothing is judged |
| `contract-drift` | end of turn, once per finding | inside a function the file already had at the turn's first touch, only what the turn added: a `catch`, or the callback of a `.catch`, that only logs, continues or returns a value without rethrowing or using the error; `?? literal`/`\|\| literal` over a function parameter or a field of `res`/`response`/`data`/`json`/`body`/`payload`/`result`; a new guard with `return null`/`[]`/`undefined` (a bare `return` only in a function that returns a value). Constructs inside callbacks belong to the callback; `?? []` traversed as a collection and spread `?? {}` do not count; UI components (`.tsx`/`.jsx`, `components/`, `ui/`) are excluded |
| `clone` | end of turn, once per finding | a new function in the turn (from a new file, or with a name the file did not have at its first touch) identical to another one in the repository up to names and literals: tokens with identifiers renamed by order of appearance and strings/numbers reduced to their type, body of 60 tokens or more. Tests, fixtures, `.d.ts`, `dist` and `node_modules` are excluded |

## Hooks (via install.sh)

The installer registers four hooks in Claude Code: `session` on `SessionStart` and, for
`Write`, `Edit` and `MultiEdit`, `pre`, `post` and `stop`, with deadlines of 30 s (`session` and
`pre`), 120 s (`post`) and 300 s (`stop`).

**`session`, at session start.** When the project uses an LLM, it returns to the model
(`SessionStart`'s `additionalContext`) the AI guide index, up to six pairs with
up to ~120 words each, marked as reference rather than instruction, plus the short
LLM testing rules from `src/ai/llm-testing.md`. Without LLM use, or in a session
opened in the home folder, it adds nothing.

In `pre`, an edit that imports an engine's SDK or writes a model id receives,
once per session, the LLM testing rules and, for each pair the file uses without a
valid guide, the request to delegate to `smugan-ai-research`. The project scan only
runs when the edit brings an engine or model the session has not seen yet. An internal Smugan error
never blocks: the event passes and the interface shows it was not checked.

**`pre`, before writing.** Builds the content the file would have after the edit and
compares its violations with those of the current file. It blocks only the new ones, so old
debt does not prevent an unrelated change. The first time the turn touches a
file, the before counts are stored as the baseline for the end of turn.
`dead-imports` does not block `Edit` or `MultiEdit`: a staged change goes through an
unused import along the way, and the end of turn checks the final state. In a
`Write`, which delivers the whole file, the rule applies. At that same first touch, `pre`
stores whether the file is new, the names of the functions it already had and the
`contract-drift` forms that already existed, so the end of turn judges only what the turn did.
In a critical turn, `pre` also blocks the `await-in-loop` the edit adds.

On the first edit, per session and per package (the folder of the nearest `package.json`),
of a file covered by the `paths` of a rule in `claude/rules/` (this
checkout's rules, or those in Claude's configuration folder when the gate runs without them), the
`pre` hook returns to the model the `smugan context` docs index as `additionalContext`,
with the sentence "Prefer what these docs say over what you remember about the
version." With no installed doc
or signature to show, that turn is not used up.

On a session's first edit of a critical file, `pre` returns to the model a
reminder (`PreToolUse`'s `additionalContext`) with the reason and the request for `critic`.
Critical comes from `src/risk.mjs`, by path: migrations and `.sql`, `middleware`/`proxy`
(file or folder), auth and authorization names, session, password, JWT and token, role,
permission, guard and policy, payment and webhook (also in camelCase), env
and secret files, `package.json` and `Cargo.toml`; and by content, Rust with `unsafe`.
Prose is never critical.

Every file has one of three levels, also decided in `src/risk.mjs`: critical (above),
trivial (prose, styles, images and fonts, translation catalogs in `locales`,
`i18n`, `lang`, `translations` or `messages` folders, `.po`, and `.editorconfig`, `.prettierrc`,
`.gitignore`, `.gitattributes`) or normal (everything else). The turn's level is the highest among
its files. In a project where the turn only touched trivial files, the end of turn runs
the gate and the typecheck, but not the tests. `smugan risk <trivial|normal|critical>` forces the
level of the whole checkout for 8 hours, and `smugan risk auto` hands the decision back to the hook;
with no argument, it shows the state. When the forced level is lower than the file's, every
end of turn warns the person (`systemMessage`) and `smugan why` records it, because a
downgrade may have been made by the agent itself. That is why, in Claude Code, the agent cannot downgrade through the
`Bash` and `PowerShell` tools (the adapters do not have this protection): a `PreToolUse` hook denies every command that mentions smugan and `risk` together with
`trivial`, `normal` or `auto` (in quotes, in a variable, anywhere), every call
to `runRisk` and every command that names, by exact path, the forced-levels folder or
the smugan cache folder that contains it; `pre` denies `Write` and `Edit` in it. Deleting those
folders some other way (an environment variable, a `cd` first) is not guessed from the
text, which used to deny ordinary commands: the hooks remember, per session, each forced level they
see (at session start, before each shell command, on each edit and at each end
of turn), and the next end of turn that releases the turn warns you when one of them disappears
before expiring without `smugan risk auto`. Limitation: the agent runs code as your user, with
access to the same files. It can call `auto` through a script generated on the fly, which
leaves the same record you would leave, or also delete the session memory
(`smugan-session-<session>.json`, in the temp folder), and in both cases no warning is issued.
The guard and the warning stop direct and accidental downgrades; against an agent determined to
get around them, no text or file check is enough. The matching is broad on purpose: an `echo` that merely mentions the command is also
denied. A more indirect route (a script generated on the fly, encoded text) still
gets through, which is why the end-of-turn warning remains. The person runs the command in the terminal
or with `!` in Claude Code, which according to the documentation runs without going through Claude (not
verified in a real session; if the hook denies it, the terminal works). Raising to `critical` and
querying remain unrestricted.

Renaming stays normal, with the suite running: proving from tokens alone that a name
is not read from outside the file let real changes slip through.

With no acceptance contract in progress, the reminder includes the
`smugan contract --set` command; with all criteria done, it asks you to check before
replacing it. A `blocked` criterion counts as work in progress. An unreadable
contract also triggers a reminder; `smugan contract` shows the file, and `--set --replace`
or `--clear` work anyway. The write proceeds normally. The reminder appears
once per session and per project, recorded in `smugan-session-<session>.json`. The
adapters ignore this field.

**`post`, after writing.** On JS/TS files (`.mts`, `.cts` and `.cjs` included), runs the
project's ESLint when there is `node_modules/eslint` and an ESLint configuration file. Only
errors that are new relative to Git HEAD block.

**Per-file typecheck.** Without a typecheck script in the project, the end of turn runs the
project's `tsc` on the touched `.ts`/`.tsx` files, and on the `.mts`/`.cts` ones its tsconfig includes, when there is a `tsconfig.json` and
`node_modules/typescript`: one program per `tsconfig`, with all of its files, and
at most one more for the committed versions of those with errors. A `tsc` that exits with
an error without reporting any type error (out of memory, broken installation) holds the
turn; a tsconfig that does not accept per-file checking and an exceeded deadline become
incomplete checks. With
`"stop": false`, it runs in `post`, file by file. Running on every write blocked
intermediate states of a multi-file change, which the next write
would fix. The base is the
nearest `tsconfig.json`. A test file uses the first `tsconfig.spec.json`,
`tsconfig.test.json` or `tsconfig.vitest.json`, walking up to the repository root, whose
`files`/`include` includes it. That is where many projects declare the runner's globals,
such as `vitest/globals` in Nest. Without that, every `it`, `vi` and `expect` in a new test
came back as an unknown name. The nearest `tsconfig.json` wins when it already includes the
test. A `tsconfig.json` further up never applies to the test, because it is usually the base
without the package's `paths` and `types`. Only errors
that are new relative to Git HEAD block, and only those in the file itself. A file outside
Git gets the full check. The HEAD baselines and `tsc`'s incremental state live
in `smugan-baseline/` and `smugan-tsbuild/`, in the system temp folder. The
`.smugan-tsc-*` and `.smugan-tscbase-*` temporary files left by an interrupted hook are
deleted after 10 minutes.

**`stop`, at end of turn.** It is the mechanical Definition of Done:

1. re-analyzes the touched files and flags only what the turn introduced: the baseline is the
   first touch's or, without it, HEAD. Shows up to 20 lines per file;
2. compares the pre-existing tests with the start of the turn (rule
   `assertion-weakening`), when the turn also touched production. A turn that changes
   production and weakens the test that should hold it does not end clean, and one that
   removes the test, or deletes its file, gets the removal listed once;
3. runs the `typecheck` or `type-check` script with the package manager indicated by the lockfile
   (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise npm). Bun projects fall back to
   npm;
4. runs `vitest related --run` with the touched JS/TS files (`.mts`, `.cts` and `.cjs`
   included) when Vitest is installed; otherwise, the `test` script, ignoring the "no test
   specified" placeholder.
   In a monorepo (`pnpm-workspace.yaml` or `workspaces`), `test` runs only in the touched
   packages, up to three; beyond that, or if the turn touched the root, it runs the whole suite;
5. without a typecheck script, runs `tsc` on the touched TypeScript files (above);
6. lists `contract-drift`, `clone` and `exploration-residue` (table in Checks). Each
   finding appears in a single hold and never again in the turn, because the agent may
   have a reason the gate cannot see; nothing is deleted. `smugan-ignore contract-drift`
   and `smugan-ignore clone` apply on the line. The `clone` function index lives in
   `smugan-clones-<hash>.json`, in the temp folder, keyed by each file's size and mtime
   (the `git ls-files` listing has its own 16 MB buffer, for
   large checkouts, and 2 s to answer); once it answers, each end of turn reads files into
   the index for at most 500 ms, never less than one file, and continues where it left off
   in the next one (`smugan why` shows `clone-index-partial`).

The end of turn never runs a build: it shares the hook's deadline with typecheck and tests, and
on timeout the hook fails open. An old `"build": true` is ignored, and
`smugan doctor` warns about it.

Scripts run in up to two projects per turn, because they all share the hook's 300 s.
A project beyond the limit shows up as an incomplete check, never as
approved. Before the limit is applied, projects with nothing to run are left out of the count: those with
`"stop": false`, with no applicable script, the user's home folder and projects where
the turn only touched prose (`.md`, `.markdown`, `.txt`, `.rst`, `.adoc`), because nothing
there changes the scripts' answer. `.mdx` compiles, so it counts as code. Files that Claude Code itself
maintains (`~/.claude` or `CLAUDE_CONFIG_DIR`) do not count as the turn's work, and the
scratchpad (`<tmp>/claude/**`) goes through no hook. Smugan's rules do not read
a file larger than 1 MiB on disk: an `Edit` on it passes without them and the end of turn does not
re-analyze it. ESLint and `tsc` still run on it.

One block per turn, or two when the turn touched a critical file; turn it off per
project with `"hook": {"stop": false}`. Only a gate rule and a script with a
non-zero exit code block. At the limit, the turn ends without the hook running the checks
again, and the message says so. The limit belongs to the turn that was held: an end of turn
the host reports as no continuation (`stop_hook_active: false`) is checked whatever an
earlier one spent, when something was written since that hold (what the hold's own checks
wrote or left behind, a test script that regenerates a file or a report, is not counted).
Claude Code sends the field and the Grok Build adapter passes it on: there a held turn that
was interrupted, or one the host cannot hold, never leaves the next turn's work unchecked.
The Codex, Antigravity and OpenCode adapters do not pass it and keep the count until the
next end of turn. A turn that wrote nothing is released. The remaining failures are recorded. A following turn
in which all failures are already recorded ends without a new block, so that a
suite that is red for an old reason does not hold every turn. Any
new failure blocks with the limit renewed. A green turn with no incomplete check
clears the record. Durations and
timestamps do not distinguish failures; a different value in a different assertion does.
If a file changes while the scripts run, the same end of turn checks the
new state again, once, instead of holding the turn; if it changes again, the turn ends
with a warning that the most recent edits were not checked. A failure with `ECONNREFUSED` comes with
a warning that a local service is probably missing. The turn's state lives in
`smugan-turn-<session>.json` and the recorded failures' state in
`smugan-stopdebt-<session>.json`, in the system temp folder.

Claude Code downgrades a `Stop`'s exit 2 to "hook script appears to be missing"
when stdout is empty and stderr contains "no such file" or "can't open". That is why
the hook always writes a line to stdout and rewrites those phrases in the report.

Scripts keep being read until they finish, even with long logs. The hook
keeps only the last 64 Ki characters of each stream and flags the discarded
output in the report. The deadline also terminates the command's subprocesses;
a real timeout keeps the fail-open policy and emits an unverified-result
warning. If terminating the subprocesses fails, Stop blocks
with that diagnostic.

Governed exception: `// smugan-ignore <rule>: <reason with 6+ characters>` on the line (or on the
line above), `smugan-ignore-file` for the whole file. A reason that is too short is a violation.
This exception applies only to rule lines (`[db-naming]`, `[rls]`…); a typecheck,
test or build failure is resolved in the code or with the tool's own directive
(`eslint-disable`, `@ts-expect-error`).

## `smugan init`

Creates only the missing files and reports the ones that already existed. Each group
is created only when the project's root `package.json` declares its stack (Supabase,
`@playwright/test`, `next` with `@sentry/nextjs`); a skipped group is listed with what
it needs. The generated config leaves the four Supabase checks to that detection, which
during checks also looks at the package that owns each migration and treats a
`supabase/migrations/` path as Supabase; in a monorepo, run `smugan init` in that package.

| File created | Purpose |
|---|---|
| `smugan.config.json` | all rules on and the default deadlines |
| `supabase/tests/000-setup.sql`, `001-rls-enabled.sql`, `table-rls.test.sql.template`, `README.md` | pgTAP helpers with no network install, a test that RLS is enabled on every `public` table, and a per-table template (anonymous denied, owner sees their own rows, another user sees zero) |
| `SECURITY_NOTES.md` | one plain line per table: who reads and who writes |
| `playwright.config.ts`, `tests/app.context.md`, `tests/e2e/smoke.spec.ts` | E2E with the app's context described for whoever writes the tests |
| `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `docs/sentry-setup.md` | observability with Sentry |
| `.github/workflows/smugan.yml` | `smugan check`, typecheck, tests, pgTAP and Playwright in continuous integration; clones Smugan with the `SMUGAN_TOKEN` secret, which must exist in the repository |

## Environment variables

| Variable | Where | Effect |
|---|---|---|
| `SMUGAN_PROFILE` | `install.sh` | cost profile: `completo` (default), `economico` (reviewers on sonnet) or `minimo` (reviewers on haiku, no `flow-critic`); stored in `smugan.paths.json` |
| `SMUGAN_REVIEW_MODEL` | `install.sh` and plugin | writes `model:` into the `critic` and `flow-critic` reviewers, overriding the profile; in the plugin only an alias is accepted |
| `SMUGAN_BIN_DIR` | `install.sh` and `doctor` | folder for the `smugan` command, instead of `~/.local/bin` |
| `CLAUDE_CONFIG_DIR` | `install.sh`, hooks and `doctor` | Claude Code configuration folder, instead of `~/.claude` |
| `SMUGAN_GATE_DIR` | hook launcher | uses this engine instead of the path stored in `smugan.paths.json`; `doctor` warns when it is set |
| `SMUGAN_STOP_DEADLINE_MS` | `stop` hook | total end-of-turn deadline, in ms (default 270000, for the installer's 300 s timeout); past half of it, the second check after files changed during the checks does not run |
| `SMUGAN_AI_GUIDES_DIR` | hooks, `smugan context` and `smugan ai-guide` | AI guides folder, instead of `~/.smugan/ai-guides` |
| `SMUGAN_CACHE_DIR` | `smugan context`, `smugan contract`, `smugan risk` and hooks | base of the private cache when `.smugan.local/` cannot be used, of the contracts (`<base>/contracts`) and of the forced level (`<base>/risk`) |
| `CLAUDE_CODE_GIT_BASH_PATH` | `doctor` | path to the Git Bash that Claude Code uses on Windows |

Each adapter's variables are in its own README.
