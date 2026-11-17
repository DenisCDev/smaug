<h1 align="center">smugan-grok</h1>

<p align="center">
  <b>Smugan adapted to Grok Build (xAI)</b><br>
  <sub><i>The same dragon, another mountain.</i></sub>
</p>

[Smugan](https://github.com/DenisCDev/smugan) is a passive quality system for
Claude Code: global rules, a gate that blocks violating writes before they touch
the disk, proactive hostile reviewers and an audit skill. This directory is the
**adapter for [Grok Build](https://docs.x.ai/build/overview)**, xAI's coding
agent CLI — same philosophy, same checks, same engine.

No steering is duplicated: the check engine, the stack rules, the subagents
(`critic`, `flow-critic`), the `/smugan` skill and the body of `AGENTS.md` come from the repo root
**at install time** (single source — update smugan, run `./install.sh` again
and you are in sync). Only what is specific to Grok Build lives here: the hook
launcher, the rule-teach module, the `AGENTS.grok.md` appendix, the fallback skills and the
installer.

## What ports 1:1, what changes

Based on the [official hooks docs](https://docs.x.ai/build/features/hooks),
[subagents](https://docs.x.ai/build/features/subagents),
[settings](https://docs.x.ai/build/settings) and
[skills/plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces):

| Smugan component | In Claude Code | In Grok Build | Status |
|---|---|---|---|
| Global rules (Tier 0) | `~/.claude/CLAUDE.md` | `~/.grok/AGENTS.md` — managed block **generated from smugan's `claude/CLAUDE.md`** at install (paths rewritten, Stack rules section replaced, adaptations appendix) | **1:1** — and never out of date again |
| Stack rules | `~/.claude/rules/` with `paths:` — loaded on their own by a platform mechanism | `~/.grok/rules/` + **rule-teach**: the session's first edit to a file that matches an unread rule is denied once, pointing to the rule | **adapted** — loading becomes a one-shot block-that-teaches (cost: 1 deny per rule per session); `SMUGAN_TEACH=0` turns it off |
| Pre-write gate (Tier 1) | `PreToolUse` hook, exit 2 blocks | `PreToolUse` hook — the only blocking event: `{"decision":"deny","reason"}` on stdout + exit 2 | **1:1** — the violation still dies before touching the disk |
| Delegation to eslint/tsc | `PostToolUse` hook, exit 2 returns stderr to the model | passive events have their stdout **ignored** — the failure is recorded per session and delivered as a **one-time deny on the next `PreToolUse`** | **adapted** — deferred feedback instead of immediate |
| DONE seal (Stop hook) | `Stop` event, exit 2 prevents the turn from ending | `Stop` runs the gate's **entire mechanical DoD** (re-check + typecheck + tests); a red verdict is parked and delivered as a deny on the first action of the next turn. What that next turn writes is checked at its own end; a turn that wrote nothing is released | **adapted** — the seal exists, it arrives one turn late |
| Critic (hostile reviewer) | subagent in `~/.claude/agents/`, launched proactively via the DoD | **subagent in `~/.grok/agents/`**, copied from smugan (`tools:` line removed — Claude tool names do not exist there); same proactive DoD | **1:1** — the `SMUGAN_GROK_FALLBACK_SKILLS=1` fallback installs `/critic` as a skill if the agents format does not load |
| Flow-critic (UX reviewer) | subagent in `~/.claude/agents/` | same as critic — subagent + fallback skill | **1:1** (new in the port — arrived in smugan 0.8.0) |
| `/smugan` skill (audit) | `~/.claude/skills/smugan/` | `~/.grok/skills/smugan/` — copied from smugan with paths rewritten (includes the `flows` dimension) | **1:1** |
| State cleanup | turn marker dies on Stop | `SessionEnd` hook deletes the four markers (turn, failures already held, pending, rules) — Stop's debt must survive the end of the turn | **adapted** |
| Hook installation | merge into `settings.json` | standalone file `~/.grok/hooks/smugan.json` | **simpler** |
| `smugan init`, pgTAP, E2E, CI | smugan repo templates | identical — they are agent-agnostic | **direct reuse** |

## The Grok Build hook contract

What the docs guarantee and the launcher (`grok/hooks/smugan-hook.mjs`) implements:

- **camelCase stdin** (`hookEventName`, `sessionId`, `toolName`, `toolInput`) and
  `GROK_*` env. The launcher normalizes to the shape smugan's engine expects — and also accepts
  Claude's snake_case shape, since Grok Build reads Claude Code
  hook files.
- **Tool names may be Grok-native.** The docs map Claude names
  automatically in matchers, but do not enumerate the native ones — so the hook registers
  **without a matcher** (catches everything) and the launcher decides by **payload shape**: `edits[]` →
  MultiEdit, `old_string`/`oldString` → Edit, `content` + path → Write. The Codex toolset's
  `apply_patch` carries every file in one `patch` text: each file is judged on its own, with
  paths read from the session's `cwd`. A patch the host cut short (`toolInputTruncated`, past
  128 KiB) is refused, since its last files cannot be seen. A tool that does not write a file
  exits in milliseconds.
- **`PreToolUse` is the only event that blocks**: exit 0 allows, exit 2 denies, and the
  denial speaks through JSON on stdout. Timeout in **seconds** (default 5 — smugan uses
  30/120/300/10 for Pre/Post/Stop/SessionEnd; Stop mirrors the 300s of the
  Claude fragment, because the gate's internal budget is 120s per script).
- **Every passive event has its stdout ignored** (including `UserPromptSubmit` — it does not
  inject context). That is why `post` and `stop` park failures in a per-session marker
  (`smugan-grok-pending-<sid>.json` in temp) and the next `pre` delivers everything in a single
  deny, labeled "deferred".
- **Newer builds say more.** The hooks guide shipped with Grok Build 1.0.77
  (`~/.grok/docs/user-guide/10-hooks.md`) documents a `Stop` that can block the end of the turn
  and a `PostToolUse` whose reason reaches the model beside the tool result. This adapter does
  not use either yet: it parks and delivers on the next `PreToolUse`, which works on both.
  The extra `Stop` that guide describes at session end (`reason` other than `end_turn`,
  1.5 s) is skipped: there is no turn left to tell anything to.
- **Fail-open by platform design**: a timeout, crash or malformed output does not block — the
  same engineering rule smugan already followed on its own.
- Personal hooks in `~/.grok/hooks/*.json` do not require trust; project hooks require
  `/hooks-trust`.

## Installation

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/grok && ./install.sh    # Git Bash on Windows, or: node tools/install.mjs
```

The engine and the rules come from the repo itself (two levels up) — there is no second clone.

Idempotent: creates/updates `~/.grok/AGENTS.md` (marked block, generated from smugan's
CLAUDE.md), `~/.grok/rules/` (copied from the repo), `~/.grok/agents/{critic,flow-critic}.md`,
`~/.grok/skills/smugan/`, `~/.grok/hooks/` (launcher + `rule-teach.mjs` + `smugan.json` +
`smugan.paths.json` pointing to the repo's gate). Updating the repo and running the installer
again re-syncs everything. With smugan somewhere else:
`SMUGAN_DIR=/path/to/smugan ./install.sh`. Honors `$GROK_HOME`.

Verification: restart your Grok Build sessions and run `grok inspect` (or open the
`/hooks` tab) — the `smugan` hook should appear under PreToolUse, PostToolUse, Stop and SessionEnd.
**Check that `/agents` lists `critic` and `flow-critic`** — the agent file format is not
documented by xAI; if they are not listed, reinstall with `SMUGAN_GROK_FALLBACK_SKILLS=1`
to fall back to the skills model (`/critic`, `/flow-critic`). Deep audit in a
session: `/smugan`.

## Tests

```bash
npm test    # the tests run the real launcher and installer against the repo's gate
```

29 integration tests: blocking a camelCase payload with a native tool name,
Edit inference by shape, every file of an `apply_patch` and a patch cut short, skipping files
under `$GROK_HOME` (with boundary), the full deferred-deny cycle (post writes, pre delivers
once, clean post removes), Stop delegating the DoD to the gate (red verdict parked; the debt
survives a green stop until delivered, and a second red one parked before it was read; what
the turn after a red one writes is checked again;
a turn that wrote nothing, a continuation and the session-end Stop are not), multi-source
delivery, cleanup on SessionEnd, the
rule-teach (teaches once per rule per session, ignores scratch files in temp,
`SMUGAN_TEACH=0`), and the installer (AGENTS.md generated without any `~/.claude/`, agents without
`tools:`, idempotence, fallback, missing anchor aborts).

## Known limits

- **The DONE seal arrives one turn late.** `Stop` runs the mechanical DoD but does not hold
  the turn — the failure becomes a deny on the first action (any tool) of the next turn,
  and a parked verdict is only discarded after being delivered once. When another end of
  turn fails before any tool call read it, the new verdict is parked beside it and both are
  delivered together (the oldest are the ones kept, up to 32 KiB of them): the first is the
  only one that names what the gate lists once per turn. When that next turn writes
  something, its end is checked again; when it writes nothing, it is released with a
  notice. A turn is held once, or twice when it touched a critical file, and the second
  verdict of such a turn joins the first when no tool call came between them. Running the
  checks before declaring done is still the only same-turn seal.
- **The agent file format is inferred, not documented.** xAI's docs confirm
  `~/.grok/agents/` and management via `/agents`, but not the file format. The
  installation is additive (nothing breaks if it does not load) and the skills fallback is one
  env var away.
- **End-of-turn latency.** Stop pays for gate + typecheck + tests (external cap of
  300s; the gate's internal budget is configurable per project in `smugan.config.json` —
  `hook.stop.timeoutMs`, `typecheck: false`, `tests: false`).
- **Undocumented tool names.** Shape inference covers any tool that
  writes a file with the usual fields; an exotic edit format would pass unchecked
  (fail-open, never fail-closed).
- **The deferred channel is best-effort.** Concurrent passive events in the same session can
  lose an entry (last-write-wins, no lock) — the check fails again on the next touch
  of the file or on the next Stop.

## References

- xAI — [Grok Build overview](https://docs.x.ai/build/overview) ·
  [Hooks](https://docs.x.ai/build/features/hooks) ·
  [Subagents](https://docs.x.ai/build/features/subagents) ·
  [Settings](https://docs.x.ai/build/settings) ·
  [Skills, Plugins & Marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces) ·
  [Modes & Commands](https://docs.x.ai/build/modes-and-commands) ·
  [announcement](https://x.ai/news/grok-build-cli)
- The reasoning behind each component (evidence, benchmarks, CVEs): [smugan README](https://github.com/DenisCDev/smugan#origin-and-references)
