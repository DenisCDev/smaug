---
title: Google Antigravity
description: Install smugan for Google Antigravity, how each Claude Code hook maps to Antigravity's hooks, the traps in its hook contract, why reviewers are manual, and the known limits.
---

The Antigravity adapter lives in [`adapters/antigravity/`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/README.md). It targets [Google Antigravity](https://antigravity.google) with the same engine, checks and reviewers as the Claude Code install.

The steering file, the subagents, both skills and the rules come from the repository root at install time. The rules are copied into `config/rules/` and adapted to point to this host's guides. Run the installer again after updating smugan.

Antigravity has hooks with veto power on both the write and the end of the turn, so after Claude Code itself this is the most complete port.

## Install

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/antigravity && ./install.sh    # or: node tools/install.mjs
```

The installer ([`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/tools/install.mjs)) is idempotent and writes into `~/.gemini/`:

| Target | Content |
|---|---|
| `AGENTS.md` | Managed block generated from [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) plus [`AGENTS.antigravity.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/AGENTS.antigravity.md). If `agy --version` reports a build older than 1.20.3, the block goes into `GEMINI.md` instead. A `GEMINI.md` shared with Gemini CLI is never destroyed. |
| `config/rules/` | The stack rules, adapted to this host's paths |
| `config/agents/critic.md`, `flow-critic.md` | Frontmatter rewritten for Antigravity: `name`, the full `description`, a reviewer tool list, `model: inherit`, `commandExecutionPolicy: auto`, `subagent: true` |
| `config/skills/smugan/` | The audit skill in Antigravity's frontmatter shape |
| `config/skills/smugan-build/` | The preparation skill with its guides |
| `smugan/hooks/` | The launcher, `normalize.mjs`, `rule-teach.mjs` and `smugan.paths.json` (gate path, rules folder, the absolute `node` path, languages and disabled parts) |
| `config/hooks.json` and `antigravity-cli/hooks.json` | The `smugan` entry merged into both surfaces; one launcher on disk, two registrations |

`smugan-ai-research` and `smugan-finish` are not installed.

| Variable | Effect |
|---|---|
| `SMUGAN_AGY_HOME` | Replaces `~/.gemini` |
| `SMUGAN_DIR` | smugan checkout elsewhere |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_DISABLE` | Install-time languages and disabled parts |
| `SMUGAN_GATE_DIR`, `SMUGAN_RULES_DIR` | In the launcher, replace the engine and the rules folder registered in `smugan.paths.json` |
| `SMUGAN_TEACH=0` | Turns rule delivery off |
| `SMUGAN_AGY_DUMP=<folder>` | The launcher writes the raw payload of every event there |

To turn everything off without uninstalling, set `"enabled": false` on the `smugan` entry in `hooks.json`.

## Hook mapping

Registered in [`antigravity/hooks/hooks.json`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/hooks/hooks.json). `PreToolUse` and `PostToolUse` share the matcher `^(write_to_file|create_file|edit_file|replace_file_content|multi_replace_file_content|apply_patch)$`.

| smugan component | Claude Code | Antigravity | Status |
|---|---|---|---|
| Pre-write gate | `PreToolUse` exit 2 | `PreToolUse` (30 s) with `{"decision":"deny"}`: the write dies before reaching disk | 1:1 |
| eslint/tsc delegation | `PostToolUse` returns stderr | `PostToolUse` (180 s) is passive: the failure is parked and delivered as a one-time denial on the next write, or at the end of the turn | Adapted |
| DONE seal | `Stop` exit 2 holds the turn | `Stop` (600 s) with `{"decision":"continue"}`: the turn does not end | 1:1 |
| Stack rules | `paths:` loads on its own | The full rule text arrives as a one-time denial on the first write it governs, once per rule per session | Adapted |
| critic / flow-critic | proactive subagents | subagents in `~/.gemini/config/agents/`, invoked by you with `invoke_subagent` | Adapted |
| Audit skill | `~/.claude/skills/smugan/` | `~/.gemini/config/skills/smugan/` | 1:1 |

There is no `SessionEnd` event here; the launcher's per-turn state expires by age (12 hours).

### Stop cap

On top of the gate's cap (one hold, two when a critical file was touched), the launcher ([`smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/hooks/smugan-hook.mjs)) has its own ceiling of 4 holds per turn (`MAX_CONTINUES`). The gate re-arms its counter whenever a new turn marker appears, so an agent that keeps writing files could otherwise be held indefinitely. The ceiling is scoped to the turn and resets with the gate's marker, so one hard turn does not switch the DoD off for the rest of the session. When the gate's cap is reached, the message tells the agent to stop trying and tell the user. A turn whose `terminationReason` reads as cancelled, aborted, interrupted, killed, timed out, quota, rate-limited, denied or refused, or that carries an error, is never held.

### Why the reviewers do not run on their own

On the free plan the quota is measured in "agent work", it is opaque, and it has been cut several times without notice; the official forum has reports of lockouts lasting days after 20–30 minutes of use. An LLM reviewer on every turn would burn that quota.

So the split is explicit: gate, lint and Definition of Done run as local scripts and cost nothing; the reviewers are reserved for risky changes (auth, personal or financial data, money, migrations, destructive operations). The installed steering says this and closes with "everything else: the mechanical gate IS the review".

## The hook contract and its traps

- **A non-zero exit is fail-closed.** A broken hook has been seen denying every tool call in a session. The launcher exits 0 on every path and speaks only through JSON on stdout; stderr is left empty on purpose.
- **`{}` is not an allow.** In `PreToolUse` the `decision` field is required; the launcher emits an explicit `{"decision":"allow"}`.
- **The schema changed between versions**: `decision`/`reason` today, `allow_tool`/`deny_reason` in a June 2026 guide. The launcher emits both in the same object; the engine is Go and ignores unknown keys.
- **The field names of `toolCall.args` are undocumented.** The engine is Cascade (Windsurf), which historically uses `TargetFile`/`CodeContent`/`ReplacementChunks`. [`normalize.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/hooks/normalize.mjs) accepts PascalCase, camelCase and snake_case and decides by shape, not by tool name. A half-known shape (a chunk whose replacement text is not recognized) is discarded instead of becoming a deletion. The hook's `matcher` does filter by name, which is why it lists plausible aliases; adding a name is one line.
- **The command path must be absolute** (a relative one exits 127), and `timeout` can never be `0` (it kills the process immediately). The installer writes the absolute path of the `node` that ran it.
- Deny reasons are capped at 24,000 characters, with the instruction placed first so truncation never drops it.

If a write ever slips through, run with `SMUGAN_AGY_DUMP=<folder>` to see exactly which field names arrived.

## Known limits

- **Adherence to text is weak on this platform.** The official forum documents the agent ignoring rules, skills and even hooks, and narrating that it followed them when it did not. Everything that must hold lives in a hook, not in prose, and the steering is short on purpose.
- **12,000-character limit per rule file.** The installer aborts if the steering exceeds it (Antigravity truncates silently past it) and warns from 8,000.
- **`PostToolUse` does not speak.** The eslint/tsc result arrives deferred, on the next write or at the end of the turn.
- **The reviewers do not invoke themselves.** The platform does not support it, and on the free plan it would be expensive anyway.
- **Tool names may change** in a release. The `matcher` already includes plausible aliases; adding one is one line.

## Verify

Automated, without Antigravity installed:

```bash
npm test
```

The contract is simulated (camelCase payload on stdin, JSON decision on stdout) and the gate really runs. The [tests](https://github.com/DenisCDev/smugan/tree/main/adapters/antigravity/test) cover the alias table (PascalCase, camelCase, snake_case, chunks, several files, shape winning over name); explicit `{"decision":"allow"}` and the dual schema on deny; exit 0 with corrupted input, a missing engine and an unknown event; a null `toolCall`; `post` recording the touched file; one-time delivery of deferred debt; and `Stop`: holding the turn, releasing it when green, the gate's cap, the 4-per-turn cap and its reset, stale counters expiring, and never holding a cancelled turn.

With Antigravity installed (restart its sessions first):

1. Ask for a `.sql` migration without RLS. The tool call fails with smugan's reason.
2. After any write, `<tmpdir>/smugan-turn-<conversationId>.json` must exist and list the file. If it does not, `PostToolUse` is not matching: adjust the `matcher` and reinstall.
3. Break the typecheck and let the turn end. `smugan stop:` arrives and the agent cannot finish.
4. First edit of a `*.test.ts`. A one-time denial arrives with the full rule text.
5. Cancel a turn midway. Nothing holds the session.
