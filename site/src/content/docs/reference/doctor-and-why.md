---
title: doctor and why
description: What smugan doctor checks in the installation and what smugan why reads from a session's records.
---

Two diagnostic commands, both read-only for the project:

- `smugan doctor` checks that the installed Claude Code chain works, without a session and without tokens.
- `smugan why` shows what the hooks did in a session: what was checked, what ran, what was skipped and why, what blocked.

## `smugan doctor`

```bash
smugan doctor [--json]
```

Implemented in [`packages/gate/src/doctor.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/doctor.mjs). It reads the installation in `CLAUDE_CONFIG_DIR` (default `~/.claude`) and the `smugan` command in `SMUGAN_BIN_DIR` (default `~/.local/bin`), and uses the current directory as the project.

### Output and exit code

Each result is a line with a level:

| Mark | Level | Meaning |
|---|---|---|
| `✓` | `ok` | check passed |
| `!` | `warn` | works, with a caveat |
| `✗` | `fail` | installation problem; the line carries the fix |

The summary is `Installation working.`, `Installation working, with N warning(s).` or `N installation problem(s); each ✗ line carries the fix.`

With `--json` the output is `{ "claudeDir": "...", "lines": [{ "level": "...", "text": "..." }] }`. The exit code is `1` when any line is `fail`, otherwise `0`. A stale installed copy is a `fail` even though it still works.

### Checks, in order

| Check | Fails when | Warns when |
|---|---|---|
| Node version | major version below 22 | |
| `settings.json` | missing or not valid JSON | |
| Hook registration | any of `SessionStart`, `PreToolUse` (`bash` and `pre`), `PostToolUse` or `Stop` has no Smugan hook | the `PreToolUse` or `PostToolUse` matcher does not include `Write` |
| `disableAllHooks` | `true` in the user's `settings.json`, or in the current folder's `.claude/settings.json` or `.claude/settings.local.json` | |
| Output style | never; reports the configured `outputStyle` | |
| Launcher | the launcher named in `settings.json` does not exist; `smugan.paths.json` does not point to an existing engine | `SMUGAN_GATE_DIR` is set; the hooks use an engine other than this checkout's |
| `smugan` command | | missing; not written by `install.sh`; points to another engine; its folder is not on `PATH`; another `smugan` comes first on `PATH` |
| Installed copies | rules, agents, skills, output styles, the hook launcher or the `CLAUDE.md` managed block differ from this checkout, after the same rewriting `install.sh` applies (paths, languages, profile, reviewer model, disabled parts); a disabled part is still installed | the engine is not inside a Smugan checkout, so copies were not compared |
| Context parsers | | a gate dependency cannot be resolved; `smugan context` is unavailable |
| Git Bash (Windows only) | | not found; see `CLAUDE_CODE_GIT_BASH_PATH` in [Environment variables](/reference/environment-variables/) |
| Project configuration | | `"mode": "warn"` is active; `"stop": {"build": true}` is set, which no longer has any effect |
| End-to-end test | the installed `pre` hook does not block the test write; the installed `stop` hook does not exit `0` | |

When parts are disabled, an `ok` line lists them. When a `smugan.local.json` layer is active for the current folder, an `ok` line names it.

The `smugan` command checks are all warnings because agents still reach the engine through `smugan.paths.json` ([gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#diagnostics-doctor-and-why)).

`allowManagedHooksOnly` only applies in managed settings, which `doctor` does not read; the session's `/status` shows that source.

### End-to-end test

When a launcher was found, `doctor` creates a temporary folder with an empty `.git` directory and feeds the installed launcher the JSON Claude Code would send:

1. `pre`: a `Write` of `supabase/migrations/0001_doctor.sql` creating a table `clientes` with a Portuguese column name and no RLS. It must exit `2` with `smugan gate: blocked` on stderr.
2. `stop`: an empty session. It must exit `0`.

Each call has a 30-second deadline. The temporary folder and that test session's state files in the system temp folder are deleted afterwards.

### Example

```bash
smugan doctor --json
```

## `smugan why`

```bash
smugan why [--session <id>] [--json]
```

Implemented in [`packages/gate/src/why.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/why.mjs), reading the records written by [`session-log.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/session-log.mjs).

### Records

Two files per session in the system temp folder, deleted after 7 days:

| File | Content |
|---|---|
| `smugan-report-<session>.json` | written at every end of turn: outcome, attempt, risk level, session folder, each file and its status, project scripts and their results, projects where scripts did not run, failures and incomplete checks |
| `smugan-events-<session>.json` | the last 50 `pre`, `post` and `stop` blocks or warnings, and internal failures that made a hook fail open |

An allowed edit writes nothing. A turn with no edits does not replace the report of the last turn that checked files; it only notes when it happened ([gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#diagnostics-doctor-and-why)).

### Which session

- `--session <id>`: that session.
- Without it: the most recent session that worked in the current folder — it edited files inside it, started in it, or checked a project that contains it. A session started in the home folder does not count for every folder below it.
- If none matches, the most recent session from any folder, with the line `No session recorded in this folder; this is the most recent one from any folder.`

### Options and exit codes

| Case | Exit |
|---|---|
| record shown | `0` |
| no record for `--session <id>`, or no record at all | `1` |
| `--session` without an id, or an unknown option | `2` |

With `--json` the output is `{ "session": "<id>", "report": {...}, "events": [...] }`, the raw records.

### Human output

The header gives the session id, how long ago its last end of turn was and its folder. A warn-mode line appears when the current folder's configuration has `"mode": "warn"`. Then, from the report:

**Outcome of the last end of turn.** A recorded `passed` is refined by what actually ran:

| Outcome | Text |
|---|---|
| `nothing-touched` | no project files to analyze; there was nothing to verify |
| `passed` | turn passed: re-check and scripts green |
| `passed-no-scripts` | turn passed: no new violations in the analyzed files; no project script ran |
| `passed-scripts-only` | turn passed by the scripts; no file went through the Smugan re-check |
| `passed-nothing-ran` | turn released unverified: no file was analyzed and no script ran |
| `error` | the end of turn failed with an internal error and verified nothing; the turn ended unverified |
| `blocked` | turn held: the Definition of Done failed (with `attempt N of M`) |
| `warned` | turn released in warn mode: the Definition of Done failed without holding the turn |
| `incomplete` | turn released with incomplete checks |
| `known-failures` | turn released: only failures that had already used up the 3 holds remained |
| `released-after-cap` | turn released after 3 holds; the last check was still red |
| `changed-during-stop` | files changed while the checks ran; the latest edit was not verified |

**Turn level**: `trivial`, `normal` or `critical`, and whether it was forced with `smugan risk`.

**Files**: `✓` checked clean, `✗` with the count of new violations, or `·` with the reason it was not checked:

| Status | Text |
|---|---|
| `ignored` | ignored by the configuration |
| `too-large` | larger than 1 MiB, not read |
| `stop-off` | end-of-turn check off in this project (`"stop": false`) |
| `recheck-off` | re-check off in this project (`"stop": {"smugan": false}`); the scripts still run |
| `missing` | deleted before the end of turn |

**Project scripts**: `✓` passed, `✗` failed, `⏱` deadline exceeded (result not verified), `·` skipped, `?` unverified.

**Projects where the scripts did not run**:

| Reason | Text |
|---|---|
| `stop-off` | `"stop": false` in this project |
| `prose-only` | the turn only touched prose here |
| `home` | the home folder does not count as a project |
| `no-scripts` | no typecheck, test or build script to run |
| `cap` | limit of 2 projects with scripts per turn |
| `clone-index-partial` | the clone index did not finish within 500 ms; the next end of turn picks up where it stopped |

Then the failures (first line of each) and the incomplete checks, the last 10 events (blocks, warn-mode warnings, held turns and `gate unavailable` failures, each with its time), and up to 4 other recent session ids for `--session`.

### Example

```bash
smugan why --session 3f2c9a1e-...
```
