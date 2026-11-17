# smugan-codex

smugan ([main repo](../../README.md)) adapted to **OpenAI Codex** — the CLI and
the desktop app, which embed the same binary and read the same `~/.codex`. A single
adapter covers both.

Of the four ports, this one has the closest parity with Claude Code: Codex
blocks the write **before** it happens, returns text to the model after it,
and genuinely holds the end of the turn. On one point it is better: it injects
context without denying the call, so stack rules arrive without costing a
denied tool call.

## What changes compared to Claude Code

| Event | Claude Code | Codex |
|---|---|---|
| Write violating a check | PreToolUse exit 2 | `PreToolUse` → `permissionDecision: "deny"` — the patch is not written |
| The project's eslint/tsc fail | PostToolUse exit 2 (stderr) | `PostToolUse` → `decision: "block"` — the failure becomes the tool result |
| Definition of Done red | Stop exit 2 holds the turn | `Stop` → `decision: "block"` holds the turn (same 3-attempt cap as the engine) |
| Stack rule | path-based loading, native | `PreToolUse` → `additionalContext` — the rule enters the context **without denying anything** |

The structural difference: in Codex every edit travels as **one** `apply_patch`
whose payload is the raw V4A envelope (`tool_input.command`). The launcher uses the
engine's parser (`packages/gate/src/patch.mjs`) to turn the patch into
per-file judgments, resolving relative paths against the session's
`cwd`. A file the parser cannot reconstruct is **still**
recorded as touched: the project's checks run on the real file on
disk and the end-of-turn DoD re-examines it — a parser failure degrades to a
later check, never to a silent skip.

## Install

```bash
cd adapters/codex && ./install.sh
```

Idempotent. Generates/copies:

- `~/.codex/AGENTS.md` — managed block generated from this repo's `claude/CLAUDE.md`
- `~/.codex/rules/*.md` — stack rules
- `~/.codex/agents/critic.toml` + `flow-critic.toml` — subagents generated from the `.md` files
- `~/.codex/hooks/` — launcher + rule-teach + `smugan.paths.json` (points to this checkout)
- `~/.codex/hooks.json` — merge; other groups are preserved
- `~/.agents/skills/smugan/SKILL.md` — deep audit, invoked with `$smugan`
- `~/.agents/skills/smugan-build/` — version- and integration-aware preparation, with full references and implicit discovery enabled by default in `agents/openai.yaml`

Variables honored: `CODEX_HOME` replaces `~/.codex` in the installer and the launcher;
`SMUGAN_CODEX_SKILLS_DIR` replaces `~/.agents/skills`; `SMUGAN_DIR` points to another
Smugan checkout; `SMUGAN_GATE_DIR` makes the launcher use another engine instead of the
one registered in `smugan.paths.json`.

The shared preparation from `claude/CLAUDE.md` stays in `AGENTS.md`; only the
explanation of rule loading is adapted to Codex. Reinstalling updates the
distributed files and preserves additional files in the skill folders.
Metadata and preferences already present in `smugan-build/agents/openai.yaml`
are also kept.

The installer does not download dependencies. If the parsers for the
`context` command are missing, it prints the `npm ci --ignore-scripts --prefix` command with the
correct path. The gate remains available. To query context without a
global binary, use the checkout path registered in
`~/.codex/hooks/smugan.paths.json`:

```bash
node /path/to/smugan/packages/gate/bin/smugan.mjs context --json /path/to/project
```

### What stays manual — and why

Codex **refuses untrusted hooks**: each hook's identity (command +
timeout + matcher) is hashed and stored when you approve it
(`codex-rs/hooks/src/engine/discovery.rs`). After installing:

1. Restart your Codex sessions (hooks are read at startup).
2. Run `/hooks` inside Codex and **trust** the four smugan hooks
   (PreToolUse, PostToolUse, Stop, SessionEnd). Until then the gate does not run.

If a smugan update changes a hook's command, `/hooks` shows it as
`modified` and it **silently stops running** — trust it again.
The installer generates byte-stable groups precisely so this only happens
when something really changes.

## Known limits

- Hooks are enabled by default in current Codex (`features/src/lib.rs`:
  `hooks` stable, `default_enabled: true`; checked on build 0.147.0 with
  `codex features list`). If your `config.toml` has `hooks = false` under
  `[features]`, the installer warns and the gate stays inert — it never
  modifies the file.
- Writes made by a shell command (outside `apply_patch`) do not go through the
  matcher and are neither judged nor recorded. There is no backstop for that path.
- openai/codex#21639 (open) reports builds in which hooks stopped firing.
  On 0.147.0 they fire — proven on this machine with a fake model
  provider (the same trick Codex's own suite uses): a patch violating RLS denied
  before reaching disk, a clean patch applied, and Stop holding the turn 3× with the
  suite red before yielding to the cap. If your build regresses, everything here
  stays installed and inert until upstream fixes it.
- Codex version this adapter was developed against: **codex-cli
  0.147.0** (payload/output schemas read from `codex-rs/hooks/schema/` in
  `openai/codex@main`).

## Verify

```bash
cd adapters/codex && node --test   # launcher and installers in an isolated HOME
```

On the machine, after installing and trusting:

1. Ask Codex for an `apply_patch` creating a migration without RLS → the patch is
   denied with the list of violations.
2. Introduce a type error in a project with `tsc` → the failure comes back as the
   tool result.
3. End a turn with the suite red → the turn resumes with the
   DoD report.
