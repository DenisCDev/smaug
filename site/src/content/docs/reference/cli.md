---
title: CLI
description: Every smugan subcommand, its flags, its exit codes and one example each.
---

The `smugan` command is [`packages/gate/bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs). `install.sh` writes a launcher for it into `~/.local/bin` (or `SMUGAN_BIN_DIR`); without the launcher, call it as `node packages/gate/bin/smugan.mjs <command>`.

With no command, `smugan` prints the help. An unknown command prints `smugan: unknown command "<name>"`, then the help, and exits `2`.

Outside a hook, when `SMUGAN_UI_LANG` is unset, the CLI reads `uiLanguage` from `hooks/smugan.paths.json` in `CLAUDE_CONFIG_DIR` (or `~/.claude`), so a manual `smugan check` judges UI strings the way the hooks do. An unreadable paths file prints a warning on stderr and leaves the UI language off.

## Commands at a glance

| Command | Flags and arguments | Exit codes |
|---|---|---|
| `check` | `[paths...]` `--json` `--warn` | `0` clean (or `--warn`), `1` violations, `2` path not found or internal error |
| `context` | `[target]` `--json` `--environment <label>` `--refresh` `--no-cache` `--record <research.json>` | `0` success, `2` usage error, missing parsers or failure |
| `risk` | `[trivial\|normal\|critical\|auto]` `[dir]` | `0` success, `2` usage error |
| `ai-guide` | `--write <guide.md>` `--project <dir>` | `0` success, `2` usage error or guide rejected |
| `contract` | `[target]` `--set <contract.json>` `--replace` `--mark <n> <pending\|done\|blocked>` `--evidence <text>` `--clear` `--json` | `0` success, `1` no contract, `2` usage error or rejected contract |
| `doctor` | `--json` | `0` no failing line, `1` at least one failing line |
| `why` | `--session <id>` `--json` | `0` record shown, `1` no record, `2` usage error |
| `hook` | `pre`, `post` or `stop` | `0` allow, `2` block (Claude Code hook contract) |
| `init` | none | `0` |
| `version` | aliases `--version`, `-v` | `0` |
| `help` | aliases `--help`, `-h` | `0` |

The help text summarizes the codes as `0 clean · 1 violations found · 2 usage/internal error`.

## `check`

```bash
smugan check [paths...] [--json] [--warn]
```

Runs the [checks](/reference/checks/) on the given files or folders, resolved from the current directory. Without paths it checks `.`, the whole project from the current directory.

| Flag | Effect |
|---|---|
| `--json` | machine-readable output; per the [gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#usage) it includes `ok`, `filesChecked` and `violations` (file, line, rule, message), sorted by file and line |
| `--warn` | exit `0` even when there are violations |

Any other argument starting with `--` is ignored; the remaining arguments are treated as paths.

Exit codes:

- `0`: no violations, or `--warn` was passed.
- `1`: at least one violation. The configuration's `"mode": "warn"` does not change this; only `--warn` on the command line does.
- `2`: a path does not exist (`smugan: path not found: <path>`), or an internal error (`smugan: internal error — ...`).

A configuration file that could not be used prints `smugan: warning — could not use <file> (invalid JSON or setting), ignoring that file` on stderr; the check still runs. See [Configuration](/reference/configuration/#invalid-files).

```bash
smugan check src/ --json
```

## `context`

```bash
smugan context [target] [--json] [--environment label] [--refresh] [--no-cache] [--record research.json]
```

Reports local versions and relevant guides per package for `target` (default `.`). Implemented in [`context.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context.mjs). See [Version context](/reference/version-context/).

| Flag | Effect |
|---|---|
| `--json` | JSON output |
| `--environment <label>` | environment label (default `local`); up to 64 letters, digits, `_` or `-`, starting with a letter or digit |
| `--refresh` | rebuild the context instead of reusing the cached one |
| `--no-cache` | do not read or write the cache |
| `--record <research.json>` | save a researched decision with the context; cannot be combined with `--no-cache` |

More than one target, or an unknown flag, is a usage error. Every error exits `2`. When the parser dependencies are missing, it prints `smugan: parsers unavailable; install the gate package dependencies with npm ci --ignore-scripts ...`.

```bash
smugan context --json packages/web
```

## `risk`

```bash
smugan risk [trivial|normal|critical|auto] [dir]
```

Forces the risk level of the checkout that holds `dir` (default `.`) for 8 hours. `auto` hands the decision back to the hook, file by file. With no level, it prints the level currently forced, if any. Implemented in [`risk.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/risk.mjs). See [Risk levels](/reference/risk-levels/).

A first argument that is neither a level nor an existing folder is rejected as `unknown level "<word>"`. More than two arguments, or a target starting with `-`, is a usage error. Errors exit `2`.

The hooks refuse agent shell commands that would lower the level (`trivial`, `normal`, `auto`); raising it to `critical` and reading it stay open to the agent.

```bash
smugan risk critical
```

## `ai-guide`

```bash
smugan ai-guide [--write guide.md] [--project dir]
```

Without `--write`, lists the AI engine + model pairs detected in the project (default `.`) and the state of each guide: valid until a date, expired, or no guide. With `--write`, validates a researched guide in Markdown and saves it; a rejected guide lists its errors and exits `2`. Any other argument is a usage error. Implemented in [`ai-guides.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-guides.mjs). See [AI guides](/reference/ai-guides/).

```bash
smugan ai-guide --project .
```

## `contract`

```bash
smugan contract [target] [--set contract.json [--replace]] [--mark <n> <pending|done|blocked> [--evidence text]] [--clear] [--json]
```

Shows or changes the acceptance contract of the checkout that holds `target` (default `.`). See [Acceptance contract](/reference/contract/).

| Flag | Effect |
|---|---|
| (none) | print the contract; `--json` prints it as JSON |
| `--set <contract.json>` | validate and save a contract; refused when one already exists |
| `--replace` | with `--set`, replace the existing contract |
| `--mark <n> <state>` | set criterion `n` (a positive integer) to `pending`, `done` or `blocked` |
| `--evidence <text>` | with `--mark`, record evidence for the criterion |
| `--clear` | remove the contract |

Only one of `--set`, `--mark` and `--clear` per call. `--evidence` without `--mark`, `--replace` without `--set`, a flag missing its value and any unknown flag are usage errors.

Exit codes: `0` success; `1` no contract exists when showing it; `2` usage error, a rejected contract, an existing contract without `--replace`, or another failure.

```bash
smugan contract --mark 2 done --evidence "npm test: 41 passed"
```

## `doctor`

```bash
smugan doctor [--json]
```

Checks the Claude Code installation in `CLAUDE_CONFIG_DIR` (or `~/.claude`) and passes a test event through the installed hook. `--json` prints `{ claudeDir, lines }`. Exits `1` when any line has level `fail`, otherwise `0`. See [doctor and why](/reference/doctor-and-why/).

```bash
smugan doctor
```

## `why`

```bash
smugan why [--session id] [--json]
```

Shows what the hooks recorded for a session. `--session` without an id, or any other flag, exits `2`. No record exits `1`. See [doctor and why](/reference/doctor-and-why/).

```bash
smugan why --json
```

## `hook`

```bash
smugan hook <pre|post|stop>
```

Claude Code hook entry. Reads the event JSON from stdin, waiting at most 2 seconds for it. `pre` and `stop` select those hooks; any other value runs `post`. Exit `2` blocks and sends stderr to the agent; `0` allows. If the input cannot be parsed or the engine throws, it exits `0`: smugan's own failures never block a session. See [Hooks](/reference/hooks/).

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"a.ts","content":""}}' | smugan hook pre
```

## `init`

```bash
smugan init
```

Scaffolds configuration and verification templates into the current directory. It never overwrites a file. Implemented in [`init.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/init.mjs).

1. Writes `smugan.config.json` unless `smugan.config.json` or `smaug.config.json` already exists.
2. Adds `smugan.local.json` to `.gitignore` unless it is already listed.
3. Copies each template group only when the project declares its stack:

| Group | Requires | Files |
|---|---|---|
| Supabase | `supabase/config.toml` or an `@supabase/*` dependency | `supabase/tests/000-setup.sql`, `supabase/tests/001-rls-enabled.sql`, `supabase/tests/table-rls.test.sql.template`, `supabase/tests/README.md`, `SECURITY_NOTES.md` |
| E2E | `@playwright/test` | `playwright.config.ts`, `tests/app.context.md`, `tests/e2e/smoke.spec.ts` |
| Observability | `next` and `@sentry/nextjs` | `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `docs/sentry-setup.md` |
| CI | always | `.github/workflows/smugan.yml` |

Each report line starts with `+` (created), `=` (exists, kept) or `-` (group skipped, with what it needs). When the templates folder is not found, scaffolding is skipped with a `!` line. The command ends with `smugan: init complete.` and, for files it created, next steps.

The generated workflow clones Smugan with the `SMUGAN_TOKEN` secret, which must exist in the repository ([gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#smugan-init)).

```bash
smugan init
```

## `version`

Prints `smugan <version>` from the gate's `package.json`, or `smugan (unknown version)` when it cannot be read.

```bash
smugan version
```

## `help`

Prints the usage summary, the exit codes, the check names and the suppression syntax `// smugan-ignore <rule>: <reason (6+ chars)>`.

```bash
smugan help
```
