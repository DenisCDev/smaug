---
title: Hooks
description: Each Claude Code hook event smugan registers, what it reads and runs, when it blocks, its deadline, how it fails open and where it keeps state.
---

Smugan acts through Claude Code command hooks. Every hook runs the same launcher,
[`claude/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/smugan-hook.mjs),
with the event kind as its first argument. The launcher loads the engine in
[`packages/gate/src/hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs)
and writes its answer back to Claude Code.

## Registration

There are two ways to register the hooks, and they register different sets.

| Event | Matcher | Kind | Timeout | Plugin | `install.sh` |
|---|---|---|---|---|---|
| `SessionStart` | `startup\|clear\|compact` | `steer` | 10 s | yes | no |
| `SessionStart` | (any) | `session` | 30 s | yes | yes |
| `SessionStart` | `startup` | `deps` | 120 s | yes | no |
| `PreToolUse` | `Agent\|Task\|Skill` | `agent` | 10 s | yes | no |
| `PreToolUse` | `Bash\|PowerShell` | `bash` | 10 s | yes | yes |
| `PreToolUse` | `Write\|Edit\|MultiEdit` | `pre` | 30 s | yes | yes |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `post` | 120 s | yes | yes |
| `Stop` | (any) | `stop` | 300 s | yes | yes |

Sources: [`claude/hooks/plugin-hooks.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/plugin-hooks.json)
and [`claude/hooks/settings-fragment.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/settings-fragment.json).
The plugin passes `plugin` as the second argument.

When the plugin runs while the `install.sh` copy is also active, the plugin's hooks
do nothing and exit 0. The launcher treats the `install.sh` copy as active when the
Claude config folder (`CLAUDE_CONFIG_DIR` or `~/.claude`) has
`hooks/smugan.paths.json`, or when its `settings.json` has a hook command of the
form `node "…/smugan-hook.mjs" <kind>`. Only `steer` reports it, in a
`systemMessage` that asks you to keep one of the two.

## Launcher

The launcher finds the engine in `SMUGAN_GATE_DIR`, then in the `gateDir` of
`smugan.paths.json` next to the launcher, then in `../../packages/gate` relative to
the launcher. `smugan.paths.json` can also set `uiLanguage`, `profile` and `disable`.
Each one is used only when the matching `SMUGAN_UI_LANG`, `SMUGAN_PROFILE` or
`SMUGAN_DISABLE` variable is unset. In plugin mode the values come from the
`CLAUDE_PLUGIN_OPTION_*` variables instead.

The launcher reads the hook JSON from stdin. A 2 s timer resolves the read even
when stdin never sends EOF, which some Windows shells cause.

How the answer is written back:

- Exit code 2 blocks. On `PreToolUse` it refuses the tool call; on `PostToolUse`
  it feeds stderr back to the model; on `Stop` it keeps the turn running.
- For `pre`, `post`, `session` and `steer`, text meant for the model is written as
  `hookSpecificOutput.additionalContext`, but only when the exit code is 0.
  A `systemMessage` already present in stdout is kept beside it.
- A note for the user on an exit-0 path is written as a stdout `systemMessage`.
  Claude Code does not show stderr from an exit-0 hook to anyone
  (see `userNote` in `hook.mjs`).

## Fail-open behavior

An internal smugan error never blocks the session. It fails open at two levels:

- **Engine.** `runHook` catches every error, including async rejections, and returns
  exit 0. It includes the error code when the code is one of `EEXIST`, `EPERM`,
  `EACCES`, `ENOENT` or `EBUSY`. The message says the event was not verified. It
  goes to stderr and to a `systemMessage`, and it is logged as a `gate-unavailable`
  event for `smugan why`.
- **Launcher.** Any exception, including an engine that cannot be found, writes the
  `systemMessage` "smugan: gate unavailable — the engine could not finish this event.
  The check did not pass." and exits 0.

## `steer` (plugin only)

This hook runs on `SessionStart` for `startup`, `clear` and `compact`. It returns the
steering text as `additionalContext`. The text is the checkout's `claude/CLAUDE.md`,
with paths rewritten to point at the checkout, the language, profile and disabled
parts applied, and a "Plugin install" section. Invalid plugin options produce a
`systemMessage` warning, and the session then uses safe defaults: languages off,
profile `completo`, nothing disabled.

## `session`

The `session` hook reads the `cwd` of the event and loads the project config from it.
It returns nothing when there is no `cwd` or when the project root is the home
folder.

When the project uses an LLM, it returns as `additionalContext`:

- the AI guide index for up to 6 engine + model pairs, plus a line that counts the
  rest;
- the LLM testing rules from
  [`src/ai/llm-testing.md`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai/llm-testing.md),
  labeled as reference rather than instructions.

The project uses an LLM when `detectAi` finds at least one pair; see
[AI guides](../ai-guides/). The hook also records any forced risk level it sees for
the checkout. Without LLM use it returns no context.

## `deps` (plugin only)

This hook runs on `SessionStart` for `startup`. The plugin cache has no
`node_modules`, but `smugan context` needs three parsers: `yaml`, `smol-toml` and
`jsonc-parser`. The hook copies the gate's `package.json` and `package-lock.json` to
`<CLAUDE_PLUGIN_DATA>/gate` and runs
`npm ci --ignore-scripts --omit=dev --no-audit --no-fund` there, with a 100 s
timeout. It reinstalls only when the copied manifests differ from the gate's, or
when `node_modules` is missing. If the install fails, it deletes the copied
`package.json` so that the next session tries again, and it reports a
`systemMessage`. Source: [`src/deps.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/deps.mjs).

## `agent` (plugin only)

The `agent` hook is a `PreToolUse` guard on `Agent`, `Task` and `Skill`. It denies the
call (`permissionDecision: "deny"`) when any of these holds:

- a `smugan:` skill is on the disable list, which merges the `disable` plugin option
  with the project config's `disable`;
- a `critic` or `flow-critic` agent (prefixed or not) is disabled;
- `flow-critic` is launched under a profile that does not use it (`minimo`);
- the profile sets a reviewer model and the call passes a different `model`, or
  sets no model and the call passes one other than `inherit`.

`SMUGAN_REVIEW_MODEL` overrides the profile's model with `sonnet`, `opus`, `haiku`,
`fable` or `inherit`.

## `bash`: `PreToolUse` for Bash and PowerShell

For `Bash` and `PowerShell` commands, this hook does two things.

1. **Refuses commands that could lower the risk level.** This check is pure text and
   runs before any I/O. The rules are in [Risk levels](../risk-levels/#only-the-user-lowers-a-level).
   A refusal exits 2.
2. **Takes a shell snapshot.** At the turn's first shell command in a Git repository,
   it records the commit HEAD points at, HEAD's reflog count and newest line, the
   fingerprint (size and mtime) of each file Git lists as changed, the tracked paths
   already deleted, and the smugan findings of each changed code file as its
   baseline. Test files also keep their assertion profile. The snapshot spends at
   most 3 s on findings. Files past that budget are marked `unrecorded`. The snapshot
   is skipped when there are more than 2,000 changed files or when `git status`
   fails, and the skip is recorded. It is also skipped when the project config sets
   `"hook": {"stop": false}` or `"stop": {"shell": false}`. Each git call has a 5 s
   timeout and passes `--no-optional-locks`
   ([`src/shell-writes.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/shell-writes.mjs)).

A failure in the snapshot is logged and never changes the decision.

## `pre`: `PreToolUse` for Write, Edit and MultiEdit

The `pre` hook skips these files:

- files under `<tmpdir>/claude/`, the Claude scratchpad;
- files outside the project root of the nearest config;
- paths matching the config's `ignore` list or the default ignores.

A write into the folder that holds forced risk levels is refused before anything else.

Then, for each edit:

1. It reads the current file, if it is at most 1 MiB, and builds the content the file
   would have after the edit. A `Write` uses `content` as given. `Edit` and
   `MultiEdit` apply each `old_string` → `new_string` replacement, with line endings
   normalized to LF on both sides. When an `old_string` is not found, there is
   nothing to judge and the edit passes.
2. At the turn's first touch of a file it records a baseline, even when the edit
   later fails. The baseline holds the violation counts, the assertion profile and
   test counts of a test file, whether the file is new, and for a code file the
   names of its functions and its contract-drift shapes. Later touches never
   overwrite it.
3. It blocks with exit 2 only on violations the edit introduces: a multiset diff by
   rule and message against the current file. `dead-imports` is not judged on `Edit`
   or `MultiEdit`, only on `Write`. In a critical turn, `await-in-loop` findings the
   edit adds are also judged. The turn is critical when the level is forced to
   critical, the file is critical, or a file the turn already touched is critical.

When the edit passes, `pre` can return `additionalContext`, each part at most once
per session:

- **Critical reminder.** It comes on the first edit of a critical file per project.
  It gives the reason and asks for the reviewers, and adds a
  `smugan contract --set` suggestion when no contract is in progress; see
  [Acceptance contract](../contract/).
- **AI hint.** It comes when the edit imports an engine SDK or writes a model id. It
  carries the LLM testing rules, and a request to delegate to `smugan-ai-research`
  for each pair the file uses that has no valid guide. The project scan runs only
  when the edit brings an engine or model this session has not seen.
- **Docs index.** It comes on the first edit, per session and per package (the
  nearest `package.json`), of a file covered by a stack rule's `paths`. The rules are
  read from the checkout's `claude/rules/`, or from `<claude config>/rules` when that
  folder is absent. It carries the docs index described in
  [Version context](../version-context/#docs-index-and-dts-signatures).
- **Rule teaching (plugin only).** On the first edit of a file that matches a stack
  rule, it names the rule to read, once per rule per session.

When the config sets `"mode": "warn"`, the hook reports the same findings but exits 0.
The findings go to `additionalContext` and to a `systemMessage`.

## `post`: `PostToolUse` for Write, Edit and MultiEdit

The `post` hook skips the same paths as `pre`. It records the file as touched by the
turn, except files in the Claude config folder. It then runs only when the file still
exists and matches `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts`.

- **ESLint.** It runs when `hook.eslint` is on, `node_modules/eslint/bin/eslint.js` is
  found walking up, and an ESLint config file is found walking up. It runs
  `eslint --format json --no-warn-ignored` and retries without the last flag on
  older ESLint. Only messages that are new relative to the Git HEAD version block.
  The HEAD result is cached per blob sha.
- **Per-file tsc.** It runs here only when `"hook": {"stop": false}`. Otherwise
  typecheck waits for `stop`.

Each tool run is bounded by `hook.timeoutMs`, 30,000 ms by default. An ESLint run that
times out yields no findings. Both checks run concurrently. New problems exit 2,
or 0 in warn mode.

## `stop`: end of turn

This is the mechanical Definition of Done. It does nothing when the session has no
turn marker, which means nothing was touched. The steps:

1. It lists the files the turn touched through Write/Edit, plus the files shell
   commands changed since each repository's snapshot. Those include files with a
   new fingerprint, files Git did not list at the snapshot, and files changed by the
   turn's own commits. It checks at most 100 shell-changed files per repository and
   reports the rest as unchecked.
2. It re-runs the smugan checks on each file and reports only what the turn
   introduced, up to 20 lines per file. The baseline is the first-touch one. Without
   it, the baseline is the Git HEAD version. For a shell-changed file it is the
   turn's own commits plus the uncommitted diff over HEAD. Reading commit history
   has a 30 s budget; files past it are compared with HEAD only.
3. When the turn also touched production code, it checks for weakened assertions and
   lists removed tests or deleted test files. It also lists `contract-drift`,
   `clone` and `exploration-residue` findings. Each of these listed findings appears
   in one hold only.
4. It runs project scripts in at most 2 roots:
   - `typecheck` or `type-check`, through the package manager the lockfile indicates
     (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise npm);
   - without that script, `tsc` on the touched TypeScript files;
   - tests: `vitest related --run --passWithNoTests` when Vitest is installed,
     otherwise the `test` script. In a workspace, the `test` script runs only in the
     touched packages, up to 3.

   A root is left out of the count when it has `"stop": false`, touched only prose,
   is the home folder, or has nothing to run. Tests are skipped for a root whose
   level is trivial. It never runs a build.

Each script runs with `CI=1` and without `NODE_TEST_CONTEXT`, under
`hook.stop.timeoutMs` (120,000 ms by default). When the deadline passes, the whole
process tree is killed. The hook keeps the last 64 Ki characters of each output
stream.

**When it blocks.** It exits 2 when there is a gate finding or a script exits
non-zero. A failure to kill a process tree also blocks. A timeout does not block: it
becomes an "incomplete checks" note. The hold budget is 1 hold per turn, or 2 when
the turn's level is critical. When the budget is spent, the turn ends with a
`systemMessage` saying the last check was red. On a Stop where
`stop_hook_active` is `false`, the budget resets if files changed since the last hold.

**Known failures.** When every failure in a run matches a fingerprint recorded after
an earlier turn spent its budget, the turn ends without a hold. A green run deletes
those fingerprints. Durations, bracketed ISO timestamps and smugan's truncation
counters are masked out of the fingerprint.

**Files changing during the checks.** If files change while the checks run, the Stop
re-checks once, when two passes fit the deadline. If they change again, it ends with
a warning. The overall deadline is 270,000 ms, which `SMUGAN_STOP_DEADLINE_MS`
overrides.

When every touched root is in warn mode, the failures are reported and the turn
ends with exit 0. On a block, stdout always carries one line, and stderr rewrites
"no such file" and "can't open". Without that, Claude Code would demote the exit 2
to "hook script appears to be missing".

## State files

All files are JSON. The session id is reduced to `[A-Za-z0-9-]`, at most 64
characters.

| File | Location | Written by | Retention |
|---|---|---|---|
| `smugan-turn-<session>.json` | OS temp folder | `pre`, `post`, `bash`, `stop` | Deleted by the Stop that checks it, when nothing changed meanwhile |
| `smugan-session-<session>.json` | OS temp folder | hints shown, forced levels seen | No automatic cleanup in `src/` |
| `smugan-stopdebt-<session>.json` | OS temp folder | `stop`, when the budget is spent | Deleted by a green Stop |
| `smugan-report-<session>.json` | OS temp folder | every Stop (for `smugan why`) | Swept after 7 days |
| `smugan-events-<session>.json` | OS temp folder | blocks and fail-open errors | Last 50 events; swept after 7 days |
| `smugan-baseline/<hash>.json` | OS temp folder | HEAD baselines for ESLint, tsc and smugan findings | Keyed by path, kind and blob sha; no cleanup |
| `smugan-tsbuild/<hash>.tsbuildinfo` | OS temp folder | incremental tsc | No cleanup |
| `smugan-clones-<hash>.json` | OS temp folder | clone index | Keyed by root |
| `.smugan-tsc-*.json`, `.smugan-tscbase-*` | next to the tsconfig / the file | temporary tsc inputs | Deleted after each run; leftovers older than 10 min are swept |

Writes use a lock directory (`<file>.lock`, 1.5 s acquire deadline) and an atomic
rename, from
[`src/file-state.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/file-state.mjs).
The report and event logs come from
[`src/session-log.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/session-log.mjs),
and the turn state from
[`src/turn-state.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/turn-state.mjs).
Forced risk levels and contracts live in the per-user cache; see
[Risk levels](../risk-levels/) and [Acceptance contract](../contract/).

The Codex adapter feeds V4A patches through
[`src/patch.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/patch.mjs).
It turns each patch into one `Write` or `MultiEdit` call per file, so the same
`pre`, `post` and `stop` logic applies.
