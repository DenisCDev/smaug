<h1 align="center">smugan-antigravity</h1>

<p align="center">
  <b>Smugan adapted to Google Antigravity</b><br>
  <sub><i>The same dragon, another mountain.</i></sub>
</p>

[Smugan](https://github.com/DenisCDev/smugan) is a passive quality system: global
rules, a gate that blocks violating writes before they touch the disk, hostile
reviewers and a mechanical Definition of Done. This directory is the **adapter for
[Google Antigravity](https://antigravity.google)** — same philosophy, same checks,
same engine.

`AGENTS.md`, the subagents, both skills and the rules come from the repo root at
install time. The rules are adapted in `config/rules/` to point
to this host's guides. Run the installer again after updating Smugan.

## This is the most complete port after Claude Code itself

Antigravity gained hooks with veto power, and that changes everything compared to the other
adapters:

| Smugan component | In Claude Code | In Antigravity | Status |
|---|---|---|---|
| Pre-write gate | `PreToolUse`, exit 2 blocks | `PreToolUse` with `{"decision":"deny"}` — the write dies before reaching disk | **1:1** |
| Delegation to eslint/tsc | `PostToolUse` returns stderr | `PostToolUse` is passive: the failure is parked and delivered as a one-time denial on the next write (or at the end of the turn) | **adapted** |
| **DONE seal** | `Stop`, exit 2 prevents the turn from ending | **`Stop` with `{"decision":"continue"}` — the turn really does not end** | **1:1** |
| Stack rules | `paths:` loads on its own | the **full** text of the rule arrives on the first write it governs, once per rule per session | **adapted** |
| Critic / flow-critic | proactive subagents | subagents in `~/.gemini/config/agents/` — invoked by you with `invoke_subagent` | **adapted** (see below) |
| Audit skill | `~/.claude/skills/smugan/` | `~/.gemini/config/skills/smugan/` | **1:1** |

### Why the reviewers do not run on their own here

On the free plan the quota is measured in **"agent work"**, it is opaque, it has been cut
several times without notice, and the official forum has reports of lockouts lasting days after
20–30 minutes of use. An LLM reviewer on every turn is the fastest way to burn through the
quota — and then you turn the whole system off.

So the split is explicit: **gate, lint and Definition of Done run as local scripts
and cost nothing**; the reviewers are reserved for risky changes (auth, personal
or financial data, money, migrations, destructive operations). The installed steering
tells the agent this in no uncertain terms, and closes with *"everything else: the mechanical
gate IS the review"*.

## The hook contract (and the traps it hides)

- **Exiting with a non-zero code is fail-closed.** A broken hook has been seen
  denying *every* tool call in a session. That is why the launcher **exits 0 on every
  path** and speaks only through JSON on stdout — stderr is left empty on purpose.
- **`{}` is not an "allow"**: in `PreToolUse` the `decision` field is required. The launcher
  emits an explicit `{"decision":"allow"}`.
- **The schema changed between versions** (`decision`/`reason` today, `allow_tool`/`deny_reason`
  in a June 2026 guide). The launcher emits **both in the same object** — the engine is Go and
  ignores unknown keys, so this removes the risk for ~40 bytes.
- **The field names of `toolCall.args` are undocumented.** The engine is Cascade
  (Windsurf), which historically uses `TargetFile`/`CodeContent`/`ReplacementChunks`.
  `normalize.mjs` accepts PascalCase, camelCase and snake_case and **decides by shape, not
  by tool name**: a half-known shape (a chunk whose replacement text
  we do not recognize) is discarded instead of becoming a deletion. The hook's `matcher`, on the
  other hand, does filter by name — which is why it includes plausible aliases, and adding a
  new name is one line.
- **The command path must be absolute** (a relative one exits 127) and `timeout` can never
  be `0` (it kills the process immediately).

If a write ever slips through, run with `SMUGAN_AGY_DUMP=<folder>`: the launcher
writes the raw payload of every event and you see exactly which field names arrived.

## Installation

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/antigravity && ./install.sh    # or: node tools/install.mjs
```

Idempotent. Installs into `~/.gemini/`: `AGENTS.md` (marked block — a `GEMINI.md`
shared with Gemini CLI is never destroyed), `config/agents/{critic,flow-critic}.md`,
`config/skills/smugan/`, `smugan/hooks/` (launcher + modules + `smugan.paths.json`), and the
`smugan` entry **merged** into `config/hooks.json` **and** `antigravity-cli/hooks.json` —
both surfaces, a single launcher. Honors `SMUGAN_AGY_HOME`. In the launcher,
`SMUGAN_GATE_DIR` and `SMUGAN_RULES_DIR` replace the engine and the rules folder registered
in `smugan.paths.json`.

To turn it off without uninstalling: `SMUGAN_TEACH=0` removes rule delivery;
`"enabled": false` on the `smugan` entry in `hooks.json` turns everything off.

## Tests

```bash
npm test    # 64 tests; Antigravity does not need to be installed
```

The contract is simulated (camelCase payload on stdin, JSON decision on stdout) and **the gate
really runs**. They cover: the entire alias table (PascalCase/camelCase/snake_case,
chunks, N files, shape winning over name); explicit `{"decision":"allow"}` and the dual
schema on deny; **exit 0 with corrupted input, missing engine and unknown event**;
null `toolCall`; `post` recording the touched file; the one-time delivery of the deferred
debt; and the whole `Stop` — it holds the turn, releases it when green, honors the gate's cap
with a message telling the agent to *stop trying and tell the user*, honors its own cap
of 4 blocks per turn (and resets it together with the gate's marker, so that one hard turn
does not disable checking in the following ones), expires stale counters, and **never holds a turn
you cancelled**.

## Verification with Antigravity installed

1. Ask for a `.sql` migration without RLS → the tool call **fails** with smugan's reason.
2. After any write, `<tmpdir>/smugan-turn-<conversationId>.json` must exist
   and list the file. If it does not exist, `PostToolUse` is not matching — adjust the
   `matcher` (it is one line) and reinstall.
3. Break the typecheck and let the turn end → `smugan stop:` arrives and the agent **cannot
   finish**.
4. First edit of a `*.test.ts` → a one-time denial with the full rule text.
5. **Cancel a turn midway → nothing holds the session.**

## Known limits

- **Adherence to text is weak on this platform.** The official forum documents the agent
  ignoring rules, skills and even hooks, and narrating that it followed them when it did not. That is why
  everything that must hold here lives in a hook, not in prose — and the steering is short on
  purpose.
- **12,000-character limit per rule file.** The installer aborts if the steering
  exceeds it (truncating silently would be worse) and warns from 8,000.
- **`PostToolUse` does not speak.** The eslint/tsc result arrives deferred, on the next
  write or at the end of the turn.
- **The reviewers do not invoke themselves** — the platform does not support it, and on the free plan it would be
  expensive anyway.
- **Tool names may change** in a release. The `matcher` already includes plausible
  aliases; adding one is one line.

## References

- [Antigravity — Hooks](https://antigravity.google/docs/hooks) ·
  [Rules & Workflows](https://antigravity.google/docs/rules-workflows) ·
  [Subagents](https://antigravity.google/docs/subagents) ·
  [Skills](https://antigravity.google/docs/skills) ·
  [Permissions](https://antigravity.google/docs/permissions) ·
  [Plans](https://antigravity.google/docs/plans)
- The reasoning behind each component: [smugan README](https://github.com/DenisCDev/smugan#origin-and-references)
