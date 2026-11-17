---
title: OpenCode
description: Install smugan for OpenCode as an auto-loaded plugin, how each Claude Code hook maps to a plugin hook, the session-resume safeguards, options and known limits.
---

The OpenCode adapter lives in [`adapters/opencode/`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/README.md). On [OpenCode](https://opencode.ai) smugan runs as a plugin instead of shell hooks, with the same engine, stack rules and reviewers.

The engine, the stack rules, the `critic` and `flow-critic` subagents, the skills and the body of `AGENTS.md` come from the repository root at install time. Only the OpenCode-specific parts live in the adapter: the plugin, the gate runner and the installer.

## Install

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/opencode && ./install.sh    # or: node tools/install.mjs
```

The engine and the rules come from the same checkout, two levels up. The installer ([`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/tools/install.mjs)) is idempotent and writes into `~/.config/opencode/`:

| Target | Content |
|---|---|
| `AGENTS.md` | Managed block generated from [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) plus [`AGENTS.opencode.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/opencode/AGENTS.opencode.md); a missing anchor aborts the install |
| `rules/` | The stack rules (`ui-ptbr.md` only with a Portuguese UI language) |
| `agents/critic.md`, `agents/flow-critic.md` | Translated: `tools:` replaced with `mode: subagent` and `permission: edit: deny` |
| `skills/smugan/` | The audit skill without `argument-hint` (not an OpenCode key); scopes are described in the body |
| `skills/smugan-build/` | The preparation skill with its guides |
| `plugins/smugan.js`, `smugan/*.mjs`, `bin/gate-runner.mjs` | The plugin, its modules and the child-process gate runner |
| `hooks/smugan.paths.json` | The gate path, languages, disabled parts and the `node` binary to run the gate with |
| `smugan.opencode.json` | Options, written only the first time; reinstalling keeps yours |

`opencode.json` is not touched. `smugan-ai-research` and `smugan-finish` are not installed.

| Variable | Effect |
|---|---|
| `OPENCODE_CONFIG_DIR` | Replaces the config folder |
| `XDG_CONFIG_HOME` | Base for `opencode/` when `OPENCODE_CONFIG_DIR` is unset |
| `SMUGAN_DIR` | smugan checkout elsewhere: `SMUGAN_DIR=/path ./install.sh` |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_DISABLE` | Install-time languages and disabled parts |

### Options

`~/.config/opencode/smugan.opencode.json`, merged over the defaults in [`opencode/smugan/config.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/opencode/smugan/config.mjs):

```json
{
  "gate":     { "enabled": true },
  "rules":    { "enabled": true, "maxPerInjection": 2 },
  "dod":      { "enabled": true, "timeoutMs": 300000 },
  "continue": { "layer": "B", "maxSameReason": 3, "maxPerSession": 5, "throttleMs": 5000 },
  "smallModel": "opencode/big-pickle"
}
```

| Option | Meaning |
|---|---|
| `gate.enabled` | Pre-write gate |
| `rules.enabled`, `rules.maxPerInjection` | Stack-rule injection, at most this many rules per tool result |
| `dod.enabled`, `dod.timeoutMs` | End-of-turn Definition of Done and how long the plugin waits for it. 300 s covers the typecheck and the tests at the gate's 120 s each (`hook.stop.timeoutMs`). When the check is still running then, the plugin stops waiting and reports the turn as not verified, never as clean; a project script already started runs to its own end. A file written by an earlier install keeps its 180000. |
| `continue.layer` | `"A"` resumes only when the DoD is red; `"B"` (default) also resumes turns that ended with no sign of completion |
| `continue.maxSameReason`, `maxPerSession`, `throttleMs` | Resume caps, see below |
| `smallModel` | The title-generator redirect. Must be a free model different from your main one, in `provider/model` form, and one the provider actually offers |

Zen's free models listed in the adapter README: `big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `laguna-s-2.1-free`, `ling-3.0-flash-free`, `north-mini-code-free`, `nemotron-3-ultra-free`.

Environment overrides for debugging: `SMUGAN_OC_DISABLE=1` turns gate, rules and DoD off; `SMUGAN_OC_LAYER=A|B|off` (`off` disables the DoD); `SMUGAN_TEACH=0` disables rule injection; `SMUGAN_GATE_DIR` points at another engine. A malformed options file falls back to the defaults.

## Hook mapping

From [`opencode/plugin/smugan.js`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/opencode/plugin/smugan.js):

| smugan component | Claude Code | OpenCode | Status |
|---|---|---|---|
| Global rules | `~/.claude/CLAUDE.md` | `~/.config/opencode/AGENTS.md` managed block | 1:1 |
| Stack rules | `~/.claude/rules/` loaded by `paths:` | `~/.config/opencode/rules/`; the plugin reads the same `paths:` and injects the rule text into the result of the write that touched a matching file, once per rule per session | 1:1 functional |
| Pre-write gate | `PreToolUse` exit 2 | `tool.execute.before`: the violating write fails the tool call itself | 1:1 |
| eslint/tsc delegation | `PostToolUse` returns stderr | `tool.execute.after`: results appended to the tool result | 1:1 |
| DONE seal | `Stop` exit 2 holds the turn | `session.idle` runs the same DoD (gate, typecheck, tests) and resumes the session with the failures | Adapted: speaks in the next turn |
| critic / flow-critic | subagents in `~/.claude/agents/` | subagents in `~/.config/opencode/agents/` | 1:1 |
| Audit skill | `~/.claude/skills/smugan/` | `~/.config/opencode/skills/smugan/` | 1:1 |
| Installation | merge into `settings.json` | auto-loaded plugin, options in their own file | Simpler |

Two more plugin hooks:

- `chat.message` resets the resume budget on a message from you; a message carrying the plugin's own resume mark does not, so the session cap still binds.
- `experimental.provider.small_model` redirects the title generator to `smallModel` (works around [#31042](https://github.com/sst/opencode/issues/31042)).

### Details

- **The gate runs in a child `node` process.** The engine is synchronous (typecheck and tests with `execSync`) and the plugin runs under Bun; importing it directly would block OpenCode's event loop for up to 2 minutes. The installer records which `node` to use.
- **OpenCode's `edit` matches approximately**, so an edit can escape the pre-write gate. The turn baseline is anchored anyway and the end-of-turn DoD catches it, which is why the DoD is not optional.
- **A relative path belongs to the session's folder.** The plugin resolves it against the `directory` OpenCode hands it, and every `apply_patch` path is relative, so a server started in another folder judges and records the right file.
- **No duplicated steering.** OpenCode looks for `AGENTS.md` and then `~/.claude/CLAUDE.md`, but stops at the first one that exists. The installer always creates `AGENTS.md`, so the OpenCode-adapted version applies even when smugan is installed for Claude Code too.
- The plugin file exports exactly one function: OpenCode's loader throws on any non-function export, which would take down every plugin.

## Resuming stalled sessions

On OpenCode Zen's free models the agent can stop mid-task without an error. The plugin addresses each known cause:

| Symptom | Cause | What the plugin does |
|---|---|---|
| Session hangs ~90 s, model does not respond | Title generator hardcoded to `deepseek-v4-flash-free`, ignoring `small_model`; on exhausted quota it retries 3 times on the same thread ([#31042](https://github.com/sst/opencode/issues/31042)) | Redirects the title generator to `smallModel` |
| Stops right after a tool | OpenAI-compatible providers (Zen is one) return `finish_reason: "stop"` with a tool call ([#14972](https://github.com/sst/opencode/issues/14972), [#13577](https://github.com/sst/opencode/issues/13577)) | Detects the turn that ended right after a tool and resumes |
| Response cut midway | `finish: "length"` at the 32K output cap, no auto-continue ([#17471](https://github.com/sst/opencode/issues/17471)) | Resumes from the cut-off point |
| "Done" with open todos | A small model declares done without closing todos ([#27560](https://github.com/sst/opencode/issues/27560), [#21534](https://github.com/sst/opencode/issues/21534)) | Resumes listing the open todos |
| Red checks slip through | No blocking end-of-turn hook ([#16626](https://github.com/sst/opencode/issues/16626)) | Runs the DoD at idle and resumes with the failures |

A resume always carries content (the failures or the specific reason), never a bare "continue", so it ends once the checks pass. Safeguards:

- **At most 5 resumes per session** (`maxPerSession`). After it, only a message from you reopens the budget.
- **At most 3 resumes with the same complaint** (`maxSameReason`). Progress means the reason changed. The comparison ignores only the counter the gate stamps on the message ("attempt 2/3").
- 5 s between resumes (`throttleMs`); none during the runtime's rate-limit backoff; none in a subagent child session.
- **Nothing revives a session you stopped with ESC.** The flag is checked again after the check run, which can take minutes.

## Known limits

- **The DONE seal arrives one turn late.** OpenCode has no blocking end-of-turn hook ([#16626](https://github.com/sst/opencode/issues/16626)); the failure becomes the first message of the next turn. Running the checks before declaring done is the only same-turn seal.
- **A silent freeze is not detectable.** If the model hangs without emitting an event ([#24342](https://github.com/sst/opencode/issues/24342)) or the runtime retries forever without notifying ([#21960](https://github.com/sst/opencode/issues/21960)), there is nothing to observe. A time-based watchdog was left out on purpose so legitimate pauses are not interrupted.
- **The resume shows up as a user message** in the history (platform limitation), always tagged `smugan —`.
- **`Update File` hunks from `apply_patch`** are reconstructed approximately; one that does not match exactly passes the gate and is caught by the DoD.
- **Rate-limit retry is OpenCode's.** OpenCode already backs off and handles `FreeUsageLimitError`; the plugin only observes and does not resume during the backoff.

## Verify

Automated:

```bash
npm test    # loads the real plugin with a fake client; the gate really runs in the child process
```

The [tests](https://github.com/DenisCDev/smugan/tree/main/adapters/opencode/test) cover a migration without RLS and a `catch {}`, V4A `apply_patch`, argument aliases, a relative path with the server in another folder, an end-of-turn check cut at the deadline, checks and rules injected into the tool result, and the end-of-turn decision table, including the cases that must never resume (ESC during the check run, rate-limit backoff, child session), both caps, and a resume echoed back by the runtime not reopening the budget. The installer tests cover `AGENTS.md` without any `~/.claude/`, reinstalling without stacking, translated agents and a missing anchor aborting.

With OpenCode installed:

1. `opencode --log-level DEBUG` starts with no plugin error.
2. Ask for a `.sql` migration without RLS. The tool call fails with smugan's reason.
3. Edit a `.tsx`. The rule text appears appended to the result, once.
4. Break the typecheck and let the turn end. `smugan — Definition of Done` arrives and the model resumes.
5. Press ESC in the middle of a task. Nothing revives the session.
6. `@critic` and `@flow-critic` resolve; asking the critic to write something is denied.
