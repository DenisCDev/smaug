---
title: Install in Claude Code
description: Global installation with install.sh, cost profiles, disabling parts and languages.
---

Requirements:

- Node.js 22 or newer (CI runs 22 and 24);
- Claude Code installed (integration verified with 2.1.299);
- Git for Windows on Windows, which is the tested environment. Without Git Bash,
  Claude Code runs hooks in PowerShell, and a failing pre-write hook starts
  blocking the edit ([hooks documentation](https://code.claude.com/docs/en/hooks),
  `shell` field). `smugan doctor` warns when it cannot find Git Bash.

```bash
git clone https://github.com/DenisCDev/smugan.git
cd smugan
./install.sh
```

The installer can be run again. It updates only the blocks Smugan manages and
preserves the rest of the configuration. The hooks point to this checkout, so
updating the repository also updates the engine used in later sessions. Rules,
agents, skills and the style are copies: after a `git pull`, run `./install.sh`
again. `smugan doctor` points out which copy fell behind.

To uninstall, run `./install.sh --uninstall`. It removes only what the installer
writes: the managed block in `CLAUDE.md`, Smugan's rules, skills, agents, style and
hook files, its hooks in `settings.json`, `outputStyle` if it is still `Smugan`, and
the `smugan` commands it marked in `~/.local/bin`. The rest of the configuration
stays as it was.

The process installs:

- the general rules in a delimited block of `~/.claude/CLAUDE.md`. Text outside the
  block is not touched; the block is replaced in full on every install;
- the stack-specific rules in `~/.claude/rules/`;
- the `critic` and `flow-critic` reviewers in `~/.claude/agents/`;
- the skills from `claude/skills/`: `/smugan` (audit), `smugan-build` (preparation,
  acceptance criteria and per-task execution, with the per-stack references) and
  `smugan-finish` (delivery);
- the Smugan response style in `~/.claude/output-styles/`. It becomes the default
  only when `settings.json` does not yet set `outputStyle`; an earlier choice is
  kept;
- the `~/.claude/hooks/smugan-hook.mjs` launcher and the `PreToolUse`, `PostToolUse`
  and `Stop` hooks that call it, merged into `settings.json`. A fresh install
  replaces old Smugan entries and preserves the others;
- `~/.claude/hooks/smugan.paths.json`, which points to this checkout's engine;
- the `smugan` command in `~/.local/bin`, the same folder where the Claude Code
  installer puts `claude`. On Windows, it comes as two files: `smugan`, for Git Bash,
  and `smugan.cmd`, for PowerShell and cmd. A file with that name that Smugan did not
  write is left alone. If the folder is not on `PATH`, the installer warns.
  `SMUGAN_BIN_DIR` changes the folder.

The installer honors `CLAUDE_CONFIG_DIR` when the Claude Code configuration lives
outside `~/.claude`. If `settings.json` contains invalid JSON, the installer writes
the rest, leaves that file as it is and exits with an error; the hooks only take
effect after fixing the file and running again. Hooks only apply to sessions opened
after installation, and the response style after `/clear` or a new session.

To run `critic` and `flow-critic` on a different model from the one that wrote the
code, set `SMUGAN_REVIEW_MODEL` at install time, with an alias or a full ID:

```bash
SMUGAN_REVIEW_MODEL=sonnet ./install.sh
```

Without the variable, the reviewers follow Claude Code's default for subagents: the
conversation's model, or `CLAUDE_CODE_SUBAGENT_MODEL` when set.
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` overrides even the `model:` written by the installer.

### Cost profile

`SMUGAN_PROFILE` chooses how much review costs:

| Profile | Reviewers |
|---|---|
| `completo` (default) | `critic` and `flow-critic` on the conversation's model |
| `economico` | `critic` and `flow-critic` on sonnet; nothing else changes |
| `minimo` | only `critic`, on haiku; `flow-critic` is neither installed nor mentioned in the rules |

```bash
SMUGAN_PROFILE=economico ./install.sh
```

The gate, the rules and the `critic` checklist are the same in all of them. What
changes is who reviews, and a cheaper reviewer finds less: it reads the diff less
carefully and misses defects the larger model would catch. Without `flow-critic`,
no review looks at the flow of the person using the screen. Use `economico` and
`minimo` only for small, reversible tasks, and switch back to `completo` before
touching authentication, money, migrations or screens. The choice is saved like the
languages, and `SMUGAN_REVIEW_MODEL`, when set, takes precedence over the profile's
model.

### Turning parts off

`SMUGAN_DISABLE` takes a comma-separated list of what you do not want to use: a
reviewer (`critic`, `flow-critic`), a skill (`smugan`, `smugan-build`,
`smugan-finish`) or a stack rule (the file name in `claude/rules/` without `.md`,
such as `nextjs` or `supabase`).

```bash
SMUGAN_DISABLE=flow-critic,nextjs ./install.sh   # turns off flow-critic and the Next rule
SMUGAN_DISABLE=none ./install.sh                 # turns everything back on
```

What is turned off is not installed, and what was already installed is removed.
`CLAUDE.md` stops mentioning the part: without `critic`, the Definition of done asks
only for `flow-critic`; without both, the review items go away; without
`smugan-build`, preparation asks only for `smugan context`; a disabled rule leaves
the rule list. A disabled skill loses only its `SKILL.md`: the guides in
`smugan-build/references/` stay, because the stack rules point to them. The list is
saved like the profile, an unknown name aborts the install before writing anything,
and `smugan doctor` compares the installation against the applied list. The adapters
(`adapters/*/install.sh`) accept the same variable.

In a project, `"disable": [...]` in `smugan.config.json` or `smugan.local.json`
turns off the same parts only there, as far as a hook can reach:

- the first-edit reminder for a critical file stops asking for the disabled
  reviewer and stops mentioning `smugan-build`, in any installation;
- in the plugin, the session-start context leaves the part out, the rule stops being
  taught and launching the reviewer or skill is refused;
- in Codex, the rule stops being taught.

In the global Claude Code installation, `CLAUDE.md`, the agents and the rules in
`~/.claude` apply to every project and Claude Code itself loads rules by path: no
hook can remove them from a single project. For that, turn them off at install time
or use the plugin. In the Antigravity, OpenCode and Grok adapters, the project list
does not change rule teaching either.

Languages are off by default. With no configuration, no rule enforces the language
of the project's strings and the agent replies in the language you write in. To pin
one or both, pass a language code at install time:

```bash
SMUGAN_UI_LANG=pt-BR SMUGAN_REPLY_LANG=pt-BR ./install.sh   # UI strings and conversation
SMUGAN_UI_LANG=es ./install.sh                              # UI strings only
SMUGAN_UI_LANG=off ./install.sh                             # turns it off again
```

The choice is saved and applies to later reinstalls until you change it. With a
Portuguese UI, the `ui-ptbr` rule and the `ui-strings` check also come in; both know
only pt-BR. A project can turn that check on or off on its own in
`smugan.config.json` (`"checks": { "ui-strings": true }`), which is how it runs in
CI, where there is no installation.
