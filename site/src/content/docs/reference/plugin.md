---
title: Plugin manifest
description: The Claude Code plugin and marketplace manifests, the four plugin options with their values and defaults, and what the plugin hooks do differently from install.sh.
---

The repository is also a Claude Code plugin. Its manifests are in [`.claude-plugin/`](https://github.com/DenisCDev/smugan/tree/main/.claude-plugin).

## plugin.json

[`.claude-plugin/plugin.json`](https://github.com/DenisCDev/smugan/blob/main/.claude-plugin/plugin.json):

| Field | Value |
|---|---|
| `name` | `smugan` |
| `version` | `0.21.0` |
| `description` | Quality gate, stack rules and reviewers for code written with Claude Code |
| `icon` | `./.claude-plugin/icon.png` |
| `license` | MIT |
| `skills` | `./claude/skills/` (`smugan`, `smugan-build`, `smugan-finish`) |
| `agents` | `./claude/agents/critic.md`, `./claude/agents/flow-critic.md`, `./claude/agents/smugan-ai-research.md` |
| `outputStyles` | `./claude/output-styles/` |
| `hooks` | `./claude/hooks/plugin-hooks.json` |

Skills and agents appear with the plugin prefix, for example `smugan:smugan-build` and `smugan:critic`.

## marketplace.json

[`.claude-plugin/marketplace.json`](https://github.com/DenisCDev/smugan/blob/main/.claude-plugin/marketplace.json) declares a marketplace named `smugan` with one plugin, `smugan`, whose `source` is the repository root (`./`). The plugin's full id is therefore `smugan@smugan`.

Installation, per the [README](https://github.com/DenisCDev/smugan/blob/main/README.md):

```bash
claude plugin marketplace add DenisCDev/smugan
claude plugin install smugan@smugan --scope project
```

## Options

Declared under `userConfig` in `plugin.json`. Claude Code hands them to every plugin hook as `CLAUDE_PLUGIN_OPTION_*` environment variables; the launcher ([`claude/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/smugan-hook.mjs), `pluginLanguage`) maps them to the same settings `install.sh` takes from `SMUGAN_*` variables.

| Option | Type | Values | Default | install.sh equivalent |
|---|---|---|---|---|
| `ui_language` | string | A language code (`pt-BR`, `en`, `es`…) or `off`. With `pt-BR`, the `ui-ptbr` rule and the `ui-strings` check are added. | `off` | `SMUGAN_UI_LANG` |
| `reply_language` | string | A language code, or `off` to reply in the language you write in | `off` | `SMUGAN_REPLY_LANG` |
| `profile` | string | `completo` (reviewers on the conversation's model), `economico` (reviewers on sonnet), `minimo` (reviewers on haiku, without flow-critic) | `completo` | `SMUGAN_PROFILE` |
| `disable` | string | Comma-separated list of `critic`, `flow-critic`, `smugan`, `smugan-build`, `smugan-finish` or a stack rule name (`nextjs`, `supabase`…). Empty or `none`: nothing disabled. | `""` | `SMUGAN_DISABLE` |

The model mapping comes from `PROFILE_MODEL` in [`packages/gate/src/profile.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/profile.cjs). The manifest notes that cheaper reviewers find less and that the smaller profiles are meant for small tasks.

Options can be set at install time:

```bash
claude plugin install smugan@smugan --scope project --config ui_language=pt-BR --config reply_language=pt-BR
```

Invalid values do not fail the session. A bad language code turns both languages off, a bad profile falls back to `completo`, and a bad `disable` list disables nothing; each case is reported once as a `systemMessage` at session start.

`SMUGAN_REVIEW_MODEL` still applies under the plugin, but only with `sonnet`, `opus`, `haiku`, `fable` or `inherit`; any other value is reported and the profile's model is used.

A project's own `"disable"` list in `smugan.config.json` or `smugan.local.json` is added to the option's list for sessions in that project.

## Plugin hooks

[`claude/hooks/plugin-hooks.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/plugin-hooks.json) runs the same launcher as `install.sh`, from the checkout (`${CLAUDE_PLUGIN_ROOT}/claude/hooks/smugan-hook.mjs`) with a second argument, `plugin`.

| Event | Matcher | Command | Timeout | In install.sh? |
|---|---|---|---|---|
| `SessionStart` | `startup\|clear\|compact` | `steer plugin` | 10 s | No |
| `SessionStart` | none | `session plugin` | 30 s | Yes (`session`) |
| `SessionStart` | `startup` | `deps plugin` | 120 s | No |
| `PreToolUse` | `Agent\|Task\|Skill` | `agent plugin` | 10 s | No |
| `PreToolUse` | `Bash\|PowerShell` | `bash plugin` | 10 s | Yes (`bash`) |
| `PreToolUse` | `Write\|Edit\|MultiEdit` | `pre plugin` | 30 s | Yes (`pre`) |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `post plugin` | 120 s | Yes (`post`) |
| `Stop` | none | `stop plugin` | 300 s | Yes (`stop`) |

The `install.sh` side is [`claude/hooks/settings-fragment.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/settings-fragment.json), merged into `~/.claude/settings.json`.

## Differences from install.sh

`install.sh` copies `CLAUDE.md` (as a managed block), the rules, skills, agents and output style into `~/.claude/`, writes `hooks/smugan.paths.json`, merges the hooks into `settings.json`, sets `outputStyle` when none is set, and writes a `smugan` command into `~/.local/bin`. A plugin cannot ship `CLAUDE.md` or a rules folder, and the plugin writes no `smugan.paths.json`. The plugin hooks make up for that as follows.

### Steering as context (`steer`)

On session start, and again after `/clear` or a compaction, the hook delivers `claude/CLAUDE.md` as `additionalContext`, with `~/.claude/` rewritten to the checkout's `claude/` folder, the languages applied, and disabled parts and profile removed the same way `install.sh` would. It appends a "Plugin install" section that says:

- skills and agents carry the `smugan:` prefix;
- where smugan files say `~/.claude/`, read the checkout's `claude/`, and where they take `gateDir` from `smugan.paths.json`, use the checkout's `packages/gate`;
- stack rules do not load by themselves: the first edit of a matching file names the rule;
- under a profile with a reviewer model, launch every reviewer with that `model`;
- which reviewers and skills are not used in this install, since the plugin's listings are static;
- how to run the CLI without `smugan` on `PATH`: `node "<checkout>/packages/gate/bin/smugan.mjs" <command>`.

### Stack-rule teaching (in `pre`)

Claude Code loads rules from `~/.claude/rules` by path; a plugin has none. On a `Write`, `Edit` or `MultiEdit`, the plugin runs the Codex adapter's [`rule-teach.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/rule-teach.mjs) against the checkout's `claude/rules/` and names each matching unread rule once per session. The note rides in `additionalContext` when the edit is allowed and is appended to the block reason when it is denied. Rules turned off by language (`ui-ptbr` without a Portuguese UI language) or by `disable` are not taught.

### Reviewer and skill guard (`agent`)

Plugin agent files are static, so the profile's model cannot be written into them as `install.sh` does. The `agent` hook denies, with the fix in the reason:

- a `Skill` call to a disabled `smugan:` skill;
- a `critic` or `flow-critic` launch (with or without the `smugan:` prefix) when it is disabled;
- `flow-critic` under the `minimo` profile;
- a reviewer launched with a `model` other than the profile's;
- under `completo` (conversation's model), a reviewer launched with an explicit `model` other than `inherit`.

`install.sh`, by contrast, writes the model into the installed agent files and removes `flow-critic` under `minimo` or when disabled.

### Dependencies (`deps`)

The plugin cache has no `node_modules`, and `smugan context` needs the gate's parsers. On startup the `deps` hook copies the gate's manifests into `CLAUDE_PLUGIN_DATA` and runs `npm ci` there when the installed copy is missing or pinned differently ([`packages/gate/src/deps.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/deps.mjs), `installPluginDeps`). It does nothing when the gate folder already has its dependencies. A plugin loaded from a checkout with `--plugin-dir` gets a message to run `npm ci --ignore-scripts` in the gate folder instead. A failed install is retried in the next session. `install.sh` installs no dependencies; when they are missing it prints the `npm ci --ignore-scripts --prefix` command to run.

### Coexistence with install.sh

When the plugin's hooks find a global install (a `hooks/smugan.paths.json` in the Claude config folder, or a `smugan-hook.mjs` command in its `settings.json`; `CLAUDE_CONFIG_DIR` is honored), every plugin hook exits without acting. The `steer` hook shows a message instead: the plugin's `smugan:*` skills and agents stay listed and do not follow the profile, so keep only one of the two. To keep only the plugin, run `./install.sh --uninstall` in the checkout; to keep only the global install, run `claude plugin disable smugan@smugan`.

### Failure mode

Both modes share the launcher's fail-open behavior: an internal error emits a `systemMessage` saying the gate is unavailable and the check did not pass, and exits 0.
