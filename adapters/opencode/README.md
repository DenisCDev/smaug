<h1 align="center">smugan-opencode</h1>

<p align="center">
  <b>Smugan adapted to OpenCode</b><br>
  <sub><i>The same dragon, another mountain.</i></sub>
</p>

[Smugan](https://github.com/DenisCDev/smugan) is a passive quality system for
Claude Code: global rules, a gate that blocks violating writes before they touch
the disk, proactive hostile reviewers and a mechanical Definition of Done. This directory is
the **adapter for [OpenCode](https://opencode.ai)** — same philosophy, same checks,
same engine.

No steering is duplicated here: the check engine, the stack rules, the subagents
(`critic`, `flow-critic`), the audit skill and the body of `AGENTS.md` come from the
repo root **at install time** (single source — update smugan, run `./install.sh`
again and you are in sync). Only what is specific to OpenCode lives here: the plugin, the
gate runner and the installer.

## Beyond parity: the session no longer stops midway

Anyone using OpenCode Zen's free models knows the symptom: **the agent stops in the middle
of the task, with no error and no warning**. It is not a single thing — they are open runtime bugs, and the
plugin tackles each one:

| Symptom | Cause (issue) | What smugan does |
|---|---|---|
| The session hangs ~90s and the model does not respond | The title generator is hardcoded to `deepseek-v4-flash-free` and ignores your `small_model`; when the quota runs out it makes 3 retries **on the same thread** ([#31042](https://github.com/sst/opencode/issues/31042)) | Redirects the title generator to another free model (`smallModel`), freeing your main model's quota |
| Stops right after running a tool | OpenAI-compatible providers (Zen is one) return `finish_reason: "stop"` even with a tool call, and the agent loop breaks ([#14972](https://github.com/sst/opencode/issues/14972), [#13577](https://github.com/sst/opencode/issues/13577)) | Detects the turn that ended right after a tool and resumes where it left off |
| The response is cut off midway | `finish: "length"` at the 32K output cap, with no auto-continue ([#17471](https://github.com/sst/opencode/issues/17471)) | Resumes by asking it to continue exactly from the cut-off point |
| "Done" with open tasks | A small model declares done without closing its todos ([#27560](https://github.com/sst/opencode/issues/27560), [#21534](https://github.com/sst/opencode/issues/21534)) | Resumes listing the todos that were left open |
| Red checks slip through | OpenCode has no blocking end-of-turn hook ([#16626](https://github.com/sst/opencode/issues/16626)) | Runs the Definition of Done at the end of the turn and resumes the session with the failures |

**The resume always carries content** — the list of failures or the specific reason — never
a blind "continue". That is why it ends on its own once the checks pass, instead of turning into
a loop.

The safeguards are explicit and protect your quota:

- **At most 5 resumes per session.** This is the cap that really **ends** it: after
  it, only a message from you reopens the budget. A time-based limit alone still
  means "forever" — and this runs unattended on your free quota.
- **At most 3 resumes with the same complaint.** "Progress" means the reason changed,
  not the model staying busy — counting tools or tokens would make the cap
  unreachable, since every resumed turn does something. The comparison ignores only the
  counter the gate itself stamps on the message ("attempt 2/3"); everything else counts, so
  fixing one `catch {}` and finding another on a different line is real progress.
- 5s between resumes; nothing during the runtime's rate-limit backoff; nothing in
  a subagent child session.
- **Nothing revives a session you killed with ESC** — the flag is checked even
  *after* the check run (which can take minutes), because that is exactly when you press
  ESC.

## What ports 1:1, what changes

| Smugan component | In Claude Code | In OpenCode | Status |
|---|---|---|---|
| Global rules (Tier 0) | `~/.claude/CLAUDE.md` | `~/.config/opencode/AGENTS.md` — managed block **generated from smugan's `claude/CLAUDE.md`** at install | **1:1** |
| Stack rules | `~/.claude/rules/` with `paths:` — loaded by a platform mechanism | `~/.config/opencode/rules/` — the plugin reads the same `paths:` and **injects the rule text into the result of the write** that touched a matching file, once per rule per session | **1:1 functional** |
| Pre-write gate (Tier 1) | `PreToolUse` hook, exit 2 blocks | `tool.execute.before` — the violating write **fails the tool call itself** | **1:1** |
| Delegation to eslint/tsc | `PostToolUse` hook returns stderr to the model | `tool.execute.after` — the check results are **appended to the tool result**, in hot context | **1:1** |
| DONE seal (Stop hook) | `Stop` event, exit 2 prevents the turn from ending | `session.idle` runs the same DoD (gate + typecheck + tests) and **resumes the session** with the failures | **adapted** — does not hold the turn, speaks in the next one |
| Critic / flow-critic | subagents in `~/.claude/agents/` | subagents in `~/.config/opencode/agents/` (`mode: subagent`, `permission: edit: deny`) | **1:1** — the same proactive description triggers the invocation |
| Audit skill | `~/.claude/skills/smugan/` | `~/.config/opencode/skills/smugan/` (no `argument-hint`, scopes in the body) | **1:1** |
| Installation | merge into `settings.json` | auto-loaded plugin; options in their own file | **simpler** — `opencode.json` is not touched |

## Details that matter

- **The gate runs in a child `node` process.** The engine is synchronous (typecheck/tests with
  `execSync`) and the plugin runs under Bun: importing it directly would block
  OpenCode's event loop for up to 2 minutes. The installer records which `node` to use.
- **OpenCode's `edit` matches approximately**, so an edit can escape the
  pre-write gate. It is not a hole: the turn baseline is anchored anyway and the
  end-of-turn DoD catches it — which is why it is not optional.
- **A relative path belongs to the session's folder.** OpenCode reads it from the `directory`
  it hands the plugin, and every path of an `apply_patch` is relative. The plugin resolves
  it there before the gate sees it, so a server started in another folder judges and
  records the right file.
- **There is no duplicated steering.** OpenCode looks for `AGENTS.md` and then
  `~/.claude/CLAUDE.md`, but **stops at the first one that exists** — and the installer always creates
  `AGENTS.md`. So, even with smugan installed in both places, the version that applies is the one
  adapted to OpenCode.

## Installation

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/opencode && ./install.sh    # or: node tools/install.mjs
```

The engine and the rules come from the repo itself (two levels up) — there is no second clone.

Idempotent. Installs into `~/.config/opencode/`: `AGENTS.md` (marked block), `rules/`,
`agents/{critic,flow-critic}.md`, `skills/smugan/`, `plugins/smugan.js` + `smugan/*.mjs` +
`bin/gate-runner.mjs`, `hooks/smugan.paths.json` and `smugan.opencode.json` (only the first
time — reinstalling preserves your options). Honors `$OPENCODE_CONFIG_DIR` and
`$XDG_CONFIG_HOME`. With smugan somewhere else: `SMUGAN_DIR=/path ./install.sh`.

### Options (`~/.config/opencode/smugan.opencode.json`)

```json
{
  "gate":     { "enabled": true },
  "rules":    { "enabled": true, "maxPerInjection": 2 },
  "dod":      { "enabled": true, "timeoutMs": 300000 },
  "continue": { "layer": "B", "maxSameReason": 3, "maxPerSession": 5, "throttleMs": 5000 },
  "smallModel": "opencode/big-pickle"
}
```

`dod.timeoutMs` is how long the plugin waits for the end-of-turn check: 300 s covers the
typecheck and the tests at the gate's 120 s each (`hook.stop.timeoutMs`). When the check is
still running then, the plugin stops waiting and reports the turn as **not verified**,
never as clean (a project script already started runs to its own end); raise the value
when the project's scripts need longer. A file written by an earlier install keeps its
180000.

`layer: "A"` only resumes when the Definition of Done is red; `"B"` (default) also resumes
turns that ended with no sign of completion. `smallModel` must be a free model **different
from your main one** — it is the title generator redirect. Zen's free models today:
`big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `laguna-s-2.1-free`,
`ling-3.0-flash-free`, `north-mini-code-free`, `nemotron-3-ultra-free`.

For debugging: `SMUGAN_OC_DISABLE=1` (turns everything off), `SMUGAN_OC_LAYER=A|B|off`,
`SMUGAN_TEACH=0` (no rule injection), `SMUGAN_GATE_DIR`.

## Tests

```bash
npm test    # runs the real plugin and installer against the repo's gate
```

62 tests. The plugin is a plain ESM module: the tests load the real plugin and trigger the
hooks with a fake client, while **the gate really runs** in the child process. They cover
blocking a migration without RLS and a `catch {}`, V4A `apply_patch`, argument aliases, a
relative path with the server in another folder, an end-of-turn check cut at the deadline,
injecting checks and rules into the tool result, and the entire end-of-turn decision
table — including the cases that can **never** resume (ESC, even when it
arrives in the middle of the check run; rate-limit backoff; child session), the two caps measured
without faking the message the gate actually emits, and the guarantee that a resume
echoed back by the runtime does not reopen the budget (the test that keeps the loop from coming back
— verified by mutation: changing that order makes the suite fail). Plus the installer:
`AGENTS.md` without any `~/.claude/`, reinstalling without stacking, translated agents, and
a missing anchor aborting.

## Verification with OpenCode installed

1. `opencode --log-level DEBUG` starts with no plugin error.
2. Ask for a `.sql` migration without RLS → the tool call **fails** with smugan's reason.
3. Edit a `.tsx` → the rule text appears appended to the result, once.
4. Break the typecheck and let the turn end → `smugan — Definition of Done` arrives and the
   model resumes.
5. **Press ESC in the middle of a task → nothing revives.** (The most important one.)
6. `@critic` and `@flow-critic` resolve; ask the critic to write something → denied.

## Known limits

- **The DONE seal arrives one turn late.** OpenCode has no blocking end-of-turn
  hook ([#16626](https://github.com/sst/opencode/issues/16626)) — the failure becomes the
  first message of the next turn. Running the checks before declaring done is still
  the only same-turn seal.
- **A silent freeze is not detectable.** If the model hangs without emitting an event
  ([#24342](https://github.com/sst/opencode/issues/24342)) or the runtime enters an infinite
  retry without notifying ([#21960](https://github.com/sst/opencode/issues/21960)), there is
  nothing to observe — only a time-based watchdog would catch it, and it was left out on purpose
  so as not to poke legitimate pauses.
- **The resume shows up as a user message** in the history (platform limitation).
  It is always tagged with `smugan —`.
- **`Update File` hunks from `apply_patch`** are reconstructed approximately; one that
  does not match exactly passes the gate and is caught by the DoD.
- **Rate-limit retry is not ours.** OpenCode already does backoff and handles
  `FreeUsageLimitError`; the plugin only observes and does not resume during the backoff.

## References

- [OpenCode docs](https://opencode.ai/docs) · [Plugins](https://opencode.ai/docs/plugins/) ·
  [Agents](https://opencode.ai/docs/agents/) · [Rules](https://opencode.ai/docs/rules/) ·
  [SDK](https://opencode.ai/docs/sdk/) · [Zen](https://opencode.ai/docs/zen/)
- The reasoning behind each component: [smugan README](https://github.com/DenisCDev/smugan#origin-and-references)
