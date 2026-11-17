---
title: Install as a plugin
description: Run Smugan as a Claude Code plugin enabled per project.
---

The repository is also a Claude Code plugin. The plugin provides the skills, the
reviewers, the response style and the hooks straight from this checkout, without
copying anything into `~/.claude`, and can be enabled or disabled per project.
`install.sh` remains the global option.

When the global installation is present, the plugin's hooks exit without acting and
session start shows a warning. The plugin's skills, agents and style are still
listed next to the global copies, and a reviewer launched as `smugan:critic` skips
the profile check; so keep only one of the two. To switch from global to the plugin,
run `./install.sh --uninstall` in the checkout, install the plugin and open a new
session. To keep only the global one, disable the plugin with
`claude plugin disable smugan@smugan`.

```bash
claude plugin marketplace add DenisCDev/smugan
claude plugin install smugan@smugan --scope project   # writes to the project's .claude/settings.json
```

So that whoever clones the project gets the plugin, commit `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "smugan": { "source": { "source": "github", "repo": "DenisCDev/smugan" } }
  },
  "enabledPlugins": { "smugan@smugan": true }
}
```

To disable it in a specific project, only on your machine, use that project's
`.claude/settings.local.json`:

```json
{
  "enabledPlugins": { "smugan@smugan": false }
}
```

The same works from the command line: `claude plugin disable smugan@smugan --scope local`.

A plugin does not install `CLAUDE.md` or rules. At the start of each session, and
again after `/clear` or a compaction, the hook delivers the general rules from
`claude/CLAUDE.md` as context. The first edit of a file covered by a stack rule
points to the rule the agent needs to read, once per rule per session. Skills and
reviewers appear with the plugin prefix, such as `smugan:smugan-build` and
`smugan:critic`.

Languages are plugin options, off by default: `ui_language` and `reply_language`,
with a language code or `off`. They appear in `/config` and can be set at install
time:

```bash
claude plugin install smugan@smugan --scope project --config ui_language=pt-BR --config reply_language=pt-BR
```

The cost profile is the `profile` option (`completo`, `economico` or `minimo`), with
the same effect and the same caveat as `SMUGAN_PROFILE`. Since a plugin's agent files
are fixed, the model goes with each launch: the session-start context tells the agent
which `model` to pass when launching `smugan:critic`, and a hook on `Agent` refuses a
reviewer launched without that model, a reviewer launched with an explicit `model` in
the `completo` profile (which uses the conversation's model) or `smugan:flow-critic`
in the `minimo` profile, explaining how to fix it.

Disabled parts are the `disable` option, with the same list as `SMUGAN_DISABLE`. A
plugin ships every agent and skill, and their list does not change by option: a
disabled reviewer or skill still shows up in Claude Code's listing. That is why the
session-start context says the part is not used, and a hook on `Agent` and `Skill`
refuses the launch. A disabled rule is not taught. An unknown name produces a warning
and, for that session, nothing is disabled.

As with `install.sh`, a Portuguese `ui_language` enables the `ui-ptbr` rule and the
`ui-strings` check. The `smugan` command is not added to `PATH`: the session context
tells the agent how to call the CLI inside the plugin. `smugan context` needs three
engine parsers: on the first session after installing or updating the plugin, session
start runs `npm ci` in the plugin's data folder, only once, and warns if it fails (no
network, for example); the next session tries again. Loaded from a checkout with
`--plugin-dir`, the plugin uses the checkout's own `node_modules`. `smugan doctor`
checks only the global installation.
