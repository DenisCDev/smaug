---
title: Grok Build
description: Install smugan for xAI's Grok Build CLI, how each Claude Code hook maps to Grok Build's hook contract, the deferred-feedback design and the known limits.
---

The Grok Build adapter lives in [`adapters/grok/`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/README.md). It targets [Grok Build](https://docs.x.ai/build/overview), xAI's coding agent CLI, and uses the same check engine, stack rules, reviewers and audit skill as the Claude Code install.

Nothing from the steering is duplicated in the adapter. The engine, the stack rules, the `critic` and `flow-critic` subagents, the `smugan` and `smugan-build` skills and the body of `AGENTS.md` are read from the repository root at install time. Only the Grok-specific parts live in the adapter: the hook launcher, `rule-teach.mjs`, the `AGENTS.grok.md` appendix, the fallback skills and the installer.

## Install

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/grok && ./install.sh    # Git Bash on Windows, or: node tools/install.mjs
```

The engine and the rules come from the same checkout, two levels up. The installer ([`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/tools/install.mjs)) is idempotent and writes into `~/.grok/`:

| Target | Content |
|---|---|
| `AGENTS.md` | Managed block generated from [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md): paths rewritten, the Stack rules section replaced, and the [`AGENTS.grok.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/grok/AGENTS.grok.md) appendix added. The install aborts if an expected anchor is missing. |
| `rules/` | The stack rules from `claude/rules/` (`ui-ptbr.md` only with a Portuguese UI language) |
| `agents/critic.md`, `agents/flow-critic.md` | Copied from `claude/agents/` with the `tools:` line removed, since Claude tool names do not exist in Grok Build |
| `skills/smugan/` | The audit skill with `~/.claude/` rewritten to `~/.grok/` (includes the `flows` dimension) |
| `skills/smugan-build/` | The preparation skill with its guides |
| `hooks/` | The launcher, `rule-teach.mjs`, `smugan.json` (the hook registration) and `smugan.paths.json` pointing at the checkout's gate |

`smugan-ai-research` and `smugan-finish` are not installed by this adapter ([`adapters/shared/install-tree.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/shared/install-tree.mjs) excludes the former).

Updating the repository and running the installer again re-syncs everything.

| Variable | Effect |
|---|---|
| `SMUGAN_DIR` | smugan checkout elsewhere: `SMUGAN_DIR=/path/to/smugan ./install.sh` |
| `GROK_HOME` | Replaces `~/.grok` |
| `SMUGAN_GROK_FALLBACK_SKILLS=1` | Installs `/critic` and `/flow-critic` as skills instead of subagents, and removes the agent files |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_DISABLE` | Install-time languages and disabled parts, resolved by the shared installer helpers |
| `SMUGAN_GATE_DIR` | Launcher uses another engine than the one in `smugan.paths.json` |
| `SMUGAN_TEACH=0` | Turns rule teaching off |

Personal hooks in `~/.grok/hooks/*.json` do not require trust; project hooks require `/hooks-trust`.

## Hook mapping

Based on xAI's [hooks](https://docs.x.ai/build/features/hooks), [subagents](https://docs.x.ai/build/features/subagents), [settings](https://docs.x.ai/build/settings) and [skills](https://docs.x.ai/build/features/skills-plugins-marketplaces) docs. Registered in [`grok/hooks/hooks.json`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/grok/hooks/hooks.json), all without a matcher:

| smugan component | Claude Code | Grok Build | Status |
|---|---|---|---|
| Global rules | `~/.claude/CLAUDE.md` | `~/.grok/AGENTS.md` managed block generated at install | 1:1 |
| Stack rules | `~/.claude/rules/` loaded by `paths:` | `~/.grok/rules/` plus rule-teach: the session's first edit of a file matching an unread rule is denied once, pointing to the rule | Adapted: one deny per rule per session |
| Pre-write gate | `PreToolUse` exit 2 | `PreToolUse` (30 s): `{"decision":"deny","reason"}` on stdout and exit 2 | 1:1 |
| eslint/tsc delegation | `PostToolUse` exit 2 returns stderr | `PostToolUse` (120 s) output is ignored; the failure is stored per session and delivered as a one-time deny on the next `PreToolUse` | Adapted: deferred |
| DONE seal | `Stop` exit 2 holds the turn | `Stop` (300 s) runs the full mechanical DoD (re-check, typecheck, tests); a red verdict is parked and delivered as a deny on the first action of the next turn | Adapted: one turn late |
| critic | subagent in `~/.claude/agents/` | subagent in `~/.grok/agents/`; `SMUGAN_GROK_FALLBACK_SKILLS=1` installs it as a skill | 1:1 |
| flow-critic | subagent | same as critic | 1:1 |
| `/smugan` audit | `~/.claude/skills/smugan/` | `~/.grok/skills/smugan/` | 1:1 |
| State cleanup | turn marker dies on Stop | `SessionEnd` (10 s) deletes the four markers (turn, failures already held, pending, rules); the Stop debt has to survive the end of the turn | Adapted |
| Hook installation | merge into `settings.json` | standalone `~/.grok/hooks/smugan.json` | Simpler |
| `smugan init`, pgTAP, E2E, CI | repository templates | identical, agent-agnostic | Direct reuse |

### The hook contract

What the launcher ([`grok/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/grok/hooks/smugan-hook.mjs)) implements:

- **camelCase stdin** (`hookEventName`, `sessionId`, `toolName`, `toolInput`) and `GROK_*` environment. The launcher normalizes to the shape the engine expects, and also accepts Claude's snake_case shape, since Grok Build reads Claude Code hook files.
- **Tool names may be Grok-native.** The docs map Claude names in matchers but do not list the native ones, so the hook registers without a matcher and the launcher decides by payload shape: `edits[]` is MultiEdit, `old_string`/`oldString` is Edit, `content` plus a path is Write.
- **`apply_patch`** (the Codex toolset) carries every file in one `patch` text. Each file is judged on its own, with paths resolved from the session's `cwd`. A patch the host cut short (`toolInputTruncated`, past 128 KiB) is refused, since its last files cannot be seen. A tool that writes no file exits in milliseconds.
- **`PreToolUse` is the only blocking event**: exit 0 allows, exit 2 denies, and the denial speaks through JSON on stdout. Timeouts are in seconds (default 5); smugan uses 30/120/300/10 for Pre/Post/Stop/SessionEnd. Stop mirrors the 300 s of the Claude fragment because the gate's internal budget is 120 s per script.
- **Passive events have their stdout ignored**, `UserPromptSubmit` included. `post` and `stop` therefore park failures in `smugan-grok-pending-<sid>.json` in the temp folder, and the next `pre` delivers everything in a single deny labeled "deferred".
- **Newer builds say more.** The hooks guide shipped with Grok Build 1.0.77 (`~/.grok/docs/user-guide/10-hooks.md`) documents a `Stop` that can block the end of the turn and a `PostToolUse` whose reason reaches the model beside the tool result. The adapter does not use either yet; parking and delivering on the next `PreToolUse` works on both. The extra `Stop` that guide describes at session end (`reason` other than `end_turn`, 1.5 s) is skipped, since there is no turn left to tell.
- **Fail-open by platform design**: a timeout, crash or malformed output does not block.
- Files under `GROK_HOME` (memory, `AGENTS.md`, installed rules) are not treated as project code.

### Order inside `pre`

Deferred debt is delivered first, then stack-rule teaching, then the gate check, so one edit gets at most one deny.

## Known limits

- **The DONE seal arrives one turn late.** `Stop` runs the mechanical DoD but does not hold the turn. The failure becomes a deny on the first action (any tool) of the next turn, and a parked verdict is discarded only after being delivered once. When another end of turn fails before any tool call read it, the new verdict is parked beside it and both are delivered together; the oldest are kept, up to 32 KiB of them, and the first is the only one that names what the gate lists once per turn. When the next turn writes something, its end is checked again; when it writes nothing, it is released with a notice. A turn is held once, or twice when it touched a critical file, and the second verdict of such a turn joins the first when no tool call came between them. Running the checks before declaring done is the only same-turn seal.
- **The agent file format is inferred, not documented.** xAI's docs confirm `~/.grok/agents/` and management through `/agents`, but not the file format. The install is additive, and the skills fallback is one environment variable away.
- **End-of-turn latency.** Stop pays for gate, typecheck and tests (external cap of 300 s). The gate's internal budget is configurable per project in `smugan.config.json`: `hook.stop.timeoutMs`, `typecheck: false`, `tests: false`.
- **Undocumented tool names.** Shape inference covers any tool that writes a file with the usual fields; an exotic edit format passes unchecked (fail-open).
- **The deferred channel is best-effort.** Concurrent passive events in the same session can lose an entry (last write wins, no lock). The check fails again on the next touch of the file or on the next Stop.

## Verify

Automated:

```bash
npm test    # runs the real launcher and installer against the repository's gate
```

The [launcher tests](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/test/launcher.test.mjs) cover a camelCase payload with a native tool name, Edit inference by shape, every file of an `apply_patch` and a truncated patch, skipping files under `$GROK_HOME`, the deferred-deny cycle, Stop delegating the DoD to the gate, cleanup on SessionEnd, rule teaching (once per rule per session, temp-folder files ignored, `SMUGAN_TEACH=0`) and the installer (no `~/.claude/` in `AGENTS.md`, agents without `tools:`, idempotence, fallback, missing anchor aborts).

With Grok Build installed:

1. Restart your Grok Build sessions.
2. Run `grok inspect` or open the `/hooks` tab. The `smugan` hook must appear under PreToolUse, PostToolUse, Stop and SessionEnd.
3. Check that `/agents` lists `critic` and `flow-critic`. If not, reinstall with `SMUGAN_GROK_FALLBACK_SKILLS=1` to use `/critic` and `/flow-critic` as skills.
4. Deep audit in a session: `/smugan`.
