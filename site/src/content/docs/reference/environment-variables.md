---
title: Environment variables
description: Every SMUGAN_* and CLAUDE_* variable that the installer, the CLI, the hooks or the engine reads, what reads it and its default.
---

This list comes from the variables read in [`install.sh`](https://github.com/DenisCDev/smugan/blob/main/install.sh), [`packages/gate/bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs), [`packages/gate/src/`](https://github.com/DenisCDev/smugan/tree/main/packages/gate/src) and the hook launcher [`claude/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/smugan-hook.mjs). Each adapter for another coding agent documents its own variables.

## Summary

| Variable | Read by | Default |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `install.sh`, CLI, `doctor`, hook launcher, hook engine | `~/.claude` |
| `SMUGAN_BIN_DIR` | `install.sh`, `doctor` | `~/.local/bin` |
| `SMUGAN_UI_LANG` | `install.sh`, CLI, hook launcher, `ui-strings` check | off |
| `SMUGAN_REPLY_LANG` | `install.sh` | off |
| `SMUGAN_PROFILE` | `install.sh`, hook launcher, hook engine | `completo` |
| `SMUGAN_REVIEW_MODEL` | `install.sh`, plugin hook launcher | the profile's model |
| `SMUGAN_DISABLE` | `install.sh`, hook launcher, hook engine | none |
| `SMUGAN_GATE_DIR` | hook launcher, `doctor` | the `gateDir` in `smugan.paths.json` |
| `SMUGAN_STOP_DEADLINE_MS` | `stop` hook | `270000` |
| `SMUGAN_AI_GUIDES_DIR` | `ai-guides.mjs` (hooks, `context`, `ai-guide`) | `~/.smugan/ai-guides` |
| `SMUGAN_CACHE_DIR` | `context`, `contract`, `risk`, hooks | `smugan/<kind>` under `LOCALAPPDATA`, `XDG_CACHE_HOME` or `~/.cache` |
| `CLAUDE_CODE_GIT_BASH_PATH` | `doctor` | searched |
| `CLAUDE_PLUGIN_OPTION_UI_LANGUAGE`, `_REPLY_LANGUAGE`, `_PROFILE`, `_DISABLE` | plugin hook launcher | off, off, `completo`, none |
| `CLAUDE_PLUGIN_DATA` | plugin hook launcher | none |

## Install-time choices

`install.sh` validates `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_PROFILE`, `SMUGAN_REVIEW_MODEL` and `SMUGAN_DISABLE` before it writes anything; an invalid value prints `smugan install: <message>` and exits `1`. The resolved values are stored in `hooks/smugan.paths.json` as `uiLanguage`, `replyLanguage`, `profile`, `reviewModel` and `disable`. When a variable is unset or empty, the value from the previous install's `smugan.paths.json` is kept, so a plain reinstall does not reset a choice.

### `SMUGAN_UI_LANG`

Language of the project's user-facing strings. Values: a language tag matching `^[a-z]{2,3}(-[a-z0-9]{2,8})*$` (case-insensitive), such as `pt-BR` or `en`, or `off`. Default: off. Resolved in [`language.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/language.cjs).

- `install.sh` fills the `{{UI_LANGUAGE}}` lines of the installed rules and installs `ui-ptbr.md` only for a Portuguese tag.
- The CLI and the hook launcher set it from `uiLanguage` in `smugan.paths.json` when it is unset in the environment.
- The `ui-strings` check, when not set in `checks`, runs only when the value is a Portuguese tag (`pt`, `pt-...`) ([`config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs)).

### `SMUGAN_REPLY_LANG`

Language the agent replies in. Same values and default as `SMUGAN_UI_LANG`. Read only by `install.sh`, which fills the `{{REPLY_LANGUAGE}}` lines and writes `NÃO FEITO` instead of `NOT DONE` for a Portuguese tag.

### `SMUGAN_PROFILE`

Cost profile, resolved in [`profile.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/profile.cjs). Case-insensitive.

| Value | Reviewer model | `flow-critic` |
|---|---|---|
| `completo` (default) | the conversation's model | used |
| `economico` | `sonnet` | used |
| `minimo` | `haiku` | not used |

The hook launcher exports it from `profile` in `smugan.paths.json` when it is unset; the hook engine reads it to decide which reviewers its messages name.

### `SMUGAN_REVIEW_MODEL`

Model written as `model:` into the installed `critic` and `flow-critic` agents, overriding the profile. `install.sh` accepts a value matching `^[A-Za-z][\w.-]*(\[1m\])?$`: an alias (`sonnet`, `opus`, `haiku`, `fable`, `inherit`) or a full model ID. Empty means the profile decides.

In the plugin, only `sonnet`, `opus`, `haiku`, `fable` or `inherit` apply; any other value is reported as a warning and the profile's model is used.

### `SMUGAN_DISABLE`

Comma-separated list of parts to turn off: `critic`, `flow-critic`, `smugan`, `smugan-build`, `smugan-finish` and the names of the stack rules in `claude/rules/` (without `.md`). `none` clears the list. Names are trimmed and lowercased; an unknown name fails the install with the list of valid names. Resolved in [`parts.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/parts.cjs).

A disabled rule or agent is not installed; a disabled skill keeps its files but loses its `SKILL.md`. The hook launcher exports the stored list when the variable is unset, and the hook engine combines it with the project's `disable` key ([Configuration](/reference/configuration/)).

## Paths and folders

### `CLAUDE_CONFIG_DIR`

Claude Code's configuration folder. Default `~/.claude`. `install.sh` installs into it and `--uninstall` removes from it; the CLI reads `hooks/smugan.paths.json` from it; `doctor` inspects it; the hook launcher looks in it for an `install.sh` installation; the hook engine uses it for its paths and as the fallback rules folder.

### `SMUGAN_BIN_DIR`

Folder where `install.sh` writes the `smugan` launcher (and `smugan.cmd` on Windows). Default `~/.local/bin`. `doctor` checks the launcher in the same folder.

### `SMUGAN_GATE_DIR`

Engine folder used by the hook launcher instead of `gateDir` from `smugan.paths.json`. When it is set, the launcher returns it before reading `smugan.paths.json`, so the stored `uiLanguage`, `profile` and `disable` are not exported to the hooks. `doctor` prints a warning when it is set.

### `SMUGAN_AI_GUIDES_DIR`

Folder of the AI guides per engine + model pair. Default `~/.smugan/ai-guides` ([`ai-guides.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-guides.mjs)).

### `SMUGAN_CACHE_DIR`

Base folder for private state kept outside the checkout:

| Use | With the variable | Without it |
|---|---|---|
| context cache, when `.smugan.local/` in the project cannot be used ([`context-cache.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-cache.mjs)) | `<SMUGAN_CACHE_DIR>` | `<base>/smugan/context` |
| acceptance contracts ([`contract.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/contract.mjs)) | `<SMUGAN_CACHE_DIR>/contracts` | `<base>/smugan/contracts` |
| forced risk level ([`risk.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/risk.mjs)) | `<SMUGAN_CACHE_DIR>/risk` | `<base>/smugan/risk` |

`<base>` is `LOCALAPPDATA`, else `XDG_CACHE_HOME`, else `~/.cache`.

### `CLAUDE_CODE_GIT_BASH_PATH`

Read by `doctor` on Windows. Used when the file exists and its name is `bash`, `sh`, `bash.exe` or `sh.exe`; otherwise `doctor` looks for `bash.exe` next to `git` on the `PATH`, then under `ProgramFiles\Git\bin` and `LOCALAPPDATA\Programs\Git\bin`.

## Hook behavior

### `SMUGAN_STOP_DEADLINE_MS`

Total end-of-turn deadline for the `stop` hook, in milliseconds. Default `270000` ([`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs)). A value that is not a positive number falls back to the default. Per the [gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#environment-variables), the default fits the installer's 300 s hook timeout, and past half of the deadline the second check after files changed during the checks does not run.

## Plugin

When Smugan runs as a Claude Code plugin, Claude Code hands each hook the plugin's options as `CLAUDE_PLUGIN_OPTION_*`. The hook launcher maps them the way `smugan.paths.json` does for an install, and then sets `SMUGAN_UI_LANG`, `SMUGAN_PROFILE` and `SMUGAN_DISABLE` for the engine.

| Variable | Becomes | Invalid value |
|---|---|---|
| `CLAUDE_PLUGIN_OPTION_UI_LANGUAGE` | `SMUGAN_UI_LANG` | both languages off for the session, with a warning |
| `CLAUDE_PLUGIN_OPTION_REPLY_LANGUAGE` | reply language | both languages off for the session, with a warning |
| `CLAUDE_PLUGIN_OPTION_PROFILE` | `SMUGAN_PROFILE` | `completo`, with a warning |
| `CLAUDE_PLUGIN_OPTION_DISABLE` | `SMUGAN_DISABLE` | nothing disabled, with a warning |

`CLAUDE_PLUGIN_DATA` is the plugin data folder: the launcher installs the gate's dependencies there when the gate folder has none ([`deps.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/deps.mjs)).

## Not environment variables

- `SMUGAN_ROOT` and `SMUGAN_HOOK` in `install.sh` are the script's own variables, not read from the environment.
- `SMUGAN_CONTRACT_UNREADABLE` is an error code in `contract.mjs`.
- `SMUGAN_TOKEN` is a GitHub Actions secret used by the `.github/workflows/smugan.yml` template that `smugan init` copies; no Smugan code reads it.
