---
title: OpenAI Codex
description: Install smugan for the Codex CLI and desktop app, how each Claude Code hook maps to a Codex hook, the manual trust step and the known limits.
---

The Codex adapter lives in [`adapters/codex/`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/README.md). It covers both the Codex CLI and the desktop app, which embed the same binary and read the same `~/.codex` folder.

Of the four adapters, Codex is the closest to Claude Code: it blocks a write before it happens, returns text to the model after it, and holds the end of the turn. It can also inject context without denying the tool call, so stack rules arrive without costing a denied call.

## Install

```bash
cd adapters/codex && ./install.sh
```

[`install.sh`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/install.sh) only checks that `node` is on `PATH` and hands off to [`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/tools/install.mjs). The smugan checkout is taken as two levels above the adapter unless `SMUGAN_DIR` says otherwise. On Git Bash or Cygwin, paths are converted with `cygpath -m` before reaching node.

The installer is idempotent. It writes:

| Target | Content |
|---|---|
| `~/.codex/AGENTS.md` | A managed block between `smugan:start` / `smugan:end` markers, generated from [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) plus [`codex/AGENTS.codex.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/AGENTS.codex.md). Text outside the markers is kept. |
| `~/.codex/rules/*.md` | The stack rules from `claude/rules/` |
| `~/.codex/agents/critic.toml`, `flow-critic.toml` | Codex agent roles generated from the `.md` agents, with `sandbox_mode = "read-only"` and the body as `developer_instructions` |
| `~/.codex/hooks/` | The launcher `smugan-hook.mjs`, `rule-teach.mjs` and `smugan.paths.json` (points at this checkout's `packages/gate`) |
| `~/.codex/hooks.json` | Merged: earlier smugan groups are replaced, other groups are kept. An invalid `hooks.json` aborts with nothing changed in it. |
| `~/.agents/skills/smugan/` | The audit skill, invoked as `$smugan` |
| `~/.agents/skills/smugan-build/` | The preparation skill with its full `references/`; `agents/openai.yaml` is created with `allow_implicit_invocation: true` only when it does not exist |

`smugan-ai-research` is not installed: the message that asks for it reaches the model only through the Claude Code launcher ([`adapters/shared/install-tree.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/shared/install-tree.mjs), `adapterAgent`). `smugan-finish` is not installed by this adapter either.

Reinstalling updates the distributed files and keeps additional files in the skill folders. Existing metadata and preferences in `smugan-build/agents/openai.yaml` are kept. Only the explanation of rule loading in `AGENTS.md` is adapted to Codex; the rest of `CLAUDE.md` is the same. The installer aborts if the `## Stack rules` or `## Definition of done` anchors are missing from `CLAUDE.md`.

### Environment variables

| Variable | Effect |
|---|---|
| `CODEX_HOME` | Replaces `~/.codex` in the installer and the launcher |
| `SMUGAN_CODEX_SKILLS_DIR` | Replaces `~/.agents/skills` |
| `SMUGAN_DIR` | Another smugan checkout |
| `SMUGAN_GATE_DIR` | Makes the launcher use another engine instead of the one in `smugan.paths.json` |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG` | Install-time languages; without them the previous `smugan.paths.json` values are kept. `ui-ptbr.md` is installed only for a Portuguese UI language |
| `SMUGAN_DISABLE` | Comma list of reviewers, skills and stack rules to leave out; a disabled skill loses only its `SKILL.md` |
| `SMUGAN_TEACH=0` | Turns rule teaching off |

### Dependencies

The installer does not download anything. If the parsers that `smugan context` needs are missing, it prints an `npm ci --ignore-scripts --prefix "<gateDir>"` command with the correct path; the gate itself still works. Without a global binary, run context from the registered checkout:

```bash
node /path/to/smugan/packages/gate/bin/smugan.mjs context --json /path/to/project
```

### Trusting the hooks (manual)

Codex refuses untrusted hooks. Each hook's identity (command, timeout and matcher) is hashed and stored when you approve it (`codex-rs/hooks/src/engine/discovery.rs`). After installing:

1. Restart your Codex sessions; hooks are read at startup.
2. Run `/hooks` inside Codex and trust the four smugan hooks (PreToolUse, PostToolUse, Stop, SessionEnd). Until then the gate does not run.

If a smugan update changes a hook's command, `/hooks` shows it as `modified` and it stops running without notice until you trust it again. The installer writes byte-stable groups so that this happens only when something really changes.

`config.toml` is read, never written. If it has `hooks = false` (or `codex_hooks = false`) under `[features]`, the installer warns that the gate stays inert.

## Hook mapping

Registered in [`codex/hooks/hooks.json`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/hooks.json):

| Codex event | Matcher | Timeout | Claude Code equivalent | Behavior |
|---|---|---|---|---|
| `PreToolUse` | `^apply_patch$` | 60 s | PreToolUse exit 2 | `permissionDecision: "deny"` with the violations; the patch is not written. Rule teaching rides in `additionalContext`, with or without a deny. |
| `PostToolUse` | `^apply_patch$` | 120 s | PostToolUse exit 2 (stderr) | The project's eslint/tsc failures become `decision: "block"` with the reason as the tool result |
| `Stop` | none | 300 s | Stop exit 2 | `decision: "block"` holds the turn while the Definition of Done is red |
| `SessionEnd` | none | 3 s | turn marker cleanup | Deletes the session's `smugan-turn-`, `smugan-stopdebt-` and `smugan-codex-rules-` files in the temp folder |

### apply_patch

Every Codex edit travels as one `apply_patch` call whose `tool_input.command` is the raw V4A envelope. The launcher ([`codex/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/smugan-hook.mjs)) parses it with the engine's `packages/gate/src/patch.mjs` into per-file judgments and resolves relative paths against the session's `cwd` from the payload. Files under `CODEX_HOME` or `~/.agents` are skipped as Codex's own state.

A file the parser cannot reconstruct is still recorded as touched. The project's checks run on the real file on disk after the patch, and the end-of-turn DoD re-examines it, so a parser failure leads to a later check, never to a silent skip.

### Stop cap

The launcher adds no loop guard of its own; the engine's per-turn cap applies: one hold, two when the turn touched a critical file (`MAX_STOP_BLOCKS` and the routine cap in [`packages/gate/src/hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs)).

### Stack rules

[`rule-teach.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/rule-teach.mjs) stands in for Claude Code's path-scoped loading. On the first patch of a session that touches files matching unread rules, it injects the rule paths into context, once per rule per session. It never denies. The framework rules `nextjs`, `astro` and `hono` match only when the nearest `package.json` lists `next`, `astro` or `hono`; without a readable manifest, only `.astro` files and `astro.config.*` / `next.config.*` count. A rule the project disables in its config is not taught.

### Failure mode

The launcher fails open: an internal error emits a `systemMessage` saying the gate is unavailable and the check did not pass, and exits 0.

## Known limits

- Hooks are enabled by default in current Codex (`features/src/lib.rs`: `hooks` stable, `default_enabled: true`; checked on build 0.147.0 with `codex features list`). With `hooks = false` under `[features]` the installer warns and the gate stays inert; it never modifies the file.
- Writes made by a shell command, outside `apply_patch`, do not go through the matcher and are neither judged nor recorded. There is no backstop for that path.
- [openai/codex#21639](https://github.com/openai/codex/issues/21639) (open) reports builds in which hooks stopped firing. On 0.147.0 they fire: with a fake model provider (the technique Codex's own suite uses), a patch violating RLS was denied before reaching disk, a clean patch applied, and Stop held the turn with the suite red until the cap. If your build regresses, everything stays installed and inert until upstream fixes it.
- Developed against codex-cli 0.147.0, with payload and output schemas read from `codex-rs/hooks/schema/` in `openai/codex@main`.

## Verify

Automated, in an isolated `HOME`:

```bash
cd adapters/codex && node --test
```

On a machine with Codex, after installing and trusting the hooks:

1. Ask Codex for an `apply_patch` creating a migration without RLS. The patch is denied with the list of violations.
2. Introduce a type error in a project with `tsc`. The failure comes back as the tool result.
3. End a turn with the suite red. The turn resumes with the DoD report.

The installer's last lines print the CLI commands for this install: `node <gateDir>/bin/smugan.mjs check` and `node "<gateDir>/bin/smugan.mjs" context --json <project-path>`.
