---
title: Use in a project
description: smugan init, smugan check, personal configuration and warn mode.
---

Passive mode starts working in the sessions after installation. There is no need to
change each project.

To add the full verification structure to a repository:

```bash
smugan init
```

The command creates only missing files, and only for the stacks the project already
declares; the rest is listed as skipped:

- Smugan configuration;
- database access tests with pgTAP (Supabase);
- E2E test context and example (`@playwright/test`);
- `SECURITY_NOTES.md` to document who can access each piece of data (Supabase);
- initial observability structure (`next` with `@sentry/nextjs`);
- continuous integration workflow.

To use only the engine:

```bash
smugan check
smugan check src/ --json
```

Without the installation, the same works through `node packages/gate/bin/smugan.mjs check`.

### Personal configuration

`smugan.config.json` belongs to the team and goes into git. Settings that are yours
alone go in `smugan.local.json`, in the same folder; `smugan init` adds that file to
`.gitignore` when it is not listed yet.

```json
{ "checks": { "console-log": false }, "hook": { "stop": { "tests": false } } }
```

The personal file takes precedence over the shared one, key by key: each check gets
the local value, `hook` and `stop` merge field by field, and `ignore` combines both
lists without repeating patterns. On its own, without the shared file, the personal
file also applies. Invalid JSON in either produces a warning with the file name, and
the file is ignored; `smugan doctor` says when the personal layer is active. A `mode`
other than `"block"` and `"warn"` also invalidates the file.

### Warn mode, for code with debt

In a project that already has violations, `"mode": "warn"` makes Smugan only warn
while the team cleans up the codebase. It works in both layers; the default is
`"block"`.

```json
{ "mode": "warn" }
```

The hooks run the same checks and show the same findings, but nothing is blocked: no
write is refused and the end of the turn is not held. Findings arrive through each
platform's non-blocking channel:

| Platform | Before writing | After writing | End of turn |
|---|---|---|---|
| Claude Code | agent context and on-screen warning | agent context and on-screen warning | on-screen warning |
| Codex | agent context | on-screen warning | on-screen warning |
| OpenCode | appended to the tool result | appended to the tool result | notification |
| Antigravity, Grok Build | — | — | — |

Antigravity and Grok Build have no channel that reaches the agent without blocking;
there, warn mode only records the findings, which `smugan why` shows. A turn that
also touched a project in `block` mode is held as before. Smugan's internal failures
still let the event through, as in any mode.

`smugan check` ignores `mode` and exits with 1 when there is a violation, so CI does
not loosen because someone changed the configuration. To only list, use
`smugan check --warn`, which exits with 0. `smugan doctor` and `smugan why` say when
warn mode is active.

The broader audit remains available through `/smugan`. It is read-only by default and
examines security, database access, UI text, unused code, error handling and
conformance with the installed rules.
