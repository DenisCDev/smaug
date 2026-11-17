---
title: Configuration
description: smugan.config.json and smugan.local.json — every key, its type and default, how the layers merge and what happens with an invalid file.
---

Configuration is loaded by `loadConfig` in [`packages/gate/src/config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs). The same loader serves `smugan check`, the hooks, `smugan doctor` and `smugan why`.

## Files

| File | Role |
|---|---|
| `smugan.config.json` | shared project configuration, committed |
| `smaug.config.json` | the project's former name; read when `smugan.config.json` is absent from the same folder |
| `smugan.local.json` | personal layer beside the shared file; its keys win. `smugan init` adds it to `.gitignore` |

A UTF-8 byte order mark at the start of a file is stripped before parsing.

## Lookup and project root

The loader walks up from the starting folder (the analyzed file's folder, or the current directory for the CLI). In each folder it looks for a shared file (`smugan.config.json`, then `smaug.config.json`) and for `smugan.local.json`.

- The first folder that holds either file stops the walk and becomes the project root. Both layers are read from that folder only.
- If no folder holds either file, the defaults apply, rooted at the nearest folder with `.git`; without one, the nearest with `package.json`; without either, the starting folder.

Relative paths in the configuration and in the checks (`migrations/`, `supabase/tests`, ...) are relative to that root.

## Keys

| Key | Type | Default | Effect |
|---|---|---|---|
| `mode` | `"block"` or `"warn"` | `"block"` | `warn` makes the hooks show violations without blocking or holding the end of turn. `smugan check` still exits `1` on violations ([`smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs)) |
| `disable` | array of strings | `[]` | parts this project turns off (a reviewer, a skill or a stack rule); the hooks silence their mentions. Names unknown to the checkout are dropped ([`parts.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/parts.cjs)) |
| `ignore` | array of glob strings | `[]` | added to the fixed ignore list below. Globs support `*`, `**` and `?` |
| `checks` | object | `{}` | per-rule settings, see [Checks](#checks) |
| `hook.eslint` | boolean | `true` | the post hook runs the project's ESLint on the written file |
| `hook.typecheck` | boolean | `true` | type checking of touched TypeScript files (see the gate README for when it runs in `post` or at the end of turn) |
| `hook.timeoutMs` | number (ms) | `30000` | deadline for each ESLint run, and for `tsc` when it runs in `post` |
| `hook.stop` | object or `false` | object below | `false` turns off the whole end-of-turn check for the project's files |
| `hook.stop.smugan` | boolean | `true` | re-analyzes the touched files with Smugan's rules at the end of turn |
| `hook.stop.typecheck` | boolean | `true` | runs the `typecheck` or `type-check` script |
| `hook.stop.tests` | boolean | `true` | runs the related tests |
| `hook.stop.shell` | boolean | `true` | also checks files a shell command changed during the turn; `false` when people edit the repository while the agent works |
| `hook.stop.timeoutMs` | number (ms) | `120000` | deadline for each end-of-turn script |

The effects of the `hook.*` keys are described in the [gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#configuration) and applied in [`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs).

`hook.stop.build` is not read. The `smugan.config.json` written by `smugan init` contains `"build": false`; `smugan doctor` warns when it is `true`, because the end of turn no longer runs the build ([`doctor.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/doctor.mjs)).

### Checks

`checks.<rule>` takes:

- `false`: the rule is off.
- an object: the rule is on, with options. Options per rule are listed in the [gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#configuration) and on the [Checks](/reference/checks/) page.
- any other value, or absent: the rule's default.

Defaults when the rule is absent from `checks` (`checkEnabled` in `config.mjs`):

| Rules | Default |
|---|---|
| `ui-strings` | on only when `SMUGAN_UI_LANG` is a Portuguese tag (`pt`, `pt-BR`, ...) |
| `rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`, `search-path`, `rls-policy` | on only where the project, or the package that owns the checked file, uses Supabase |
| every other rule | on |

Setting a Supabase rule or `ui-strings` explicitly (to `true` or an object) turns it on regardless of detection.

### Fixed ignores

Never checked, whatever the configuration (`DEFAULT_IGNORE` in `config.mjs`):

`**/node_modules/**`, `**/.git/**`, `**/.next/**`, `**/dist/**`, `**/build/**`, `**/out/**`, `**/coverage/**`, `**/.vercel/**`, `**/.turbo/**`, `**/.expo/**`, `**/.venv/**`, `**/venv/**`, `**/site-packages/**`, `**/__pycache__/**`, `**/.terraform/**`, `**/*.min.*`, `**/*.gen.*`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock`, `**/database.types.ts`, `**/.env`, `**/.env.local`, `**/.env.*.local`.

Also ignored: the context cache artifacts, and a `vendor` folder filled by a package manager, recognized by one of `autoload.php`, `modules.txt`, `bundle/ruby`, `bundle/jruby` or `bundle/truffleruby` inside it. A folder that is merely named `vendor` is checked.

## Merge rules

The defaults are built first, then the shared file is applied, then `smugan.local.json`. Each layer is applied key by key (`applyLayer`):

| Key | Rule |
|---|---|
| `mode` | replaced when the layer sets it |
| `disable` | union of all layers, without duplicates |
| `ignore` | union of all layers, without duplicates; a non-array value is ignored |
| `checks` | per rule: when both the existing and the new value are objects, they are shallow-merged; otherwise the new value replaces the old one. A non-object `checks` is ignored |
| `hook` (except `stop`) | shallow-merged; the layer's keys replace existing ones |
| `hook.stop` | `false` replaces it with `false`. An object is shallow-merged over the current `stop`, or over the default `stop` when a previous layer set it to `false` |

Example: the shared file turns `console-log` off and exempts a table from `rls`; the personal layer switches only the hooks to warn mode.

```json title="smugan.config.json"
{
  "ignore": ["generated/**"],
  "checks": { "console-log": false, "rls": { "exempt": ["reference_data"] } },
  "hook": { "stop": { "tests": true, "timeoutMs": 120000 } }
}
```

```json title="smugan.local.json"
{ "mode": "warn", "hook": { "stop": { "shell": false } } }
```

Result: `mode` is `warn`; `hook.stop` keeps `tests: true` and `timeoutMs: 120000` and gains `shell: false`; `checks` and `ignore` come from the shared file.

## Invalid files

A layer is skipped as a whole when:

- it is not valid JSON;
- `mode` is present and is not `"block"` or `"warn"`;
- `disable` is present and is not an array of strings.

Every field is validated before any is applied, so a skipped layer changes nothing. The other layer is still applied, and the root stays the folder where the files were found. Only the first broken file is recorded.

- `smugan check` prints `smugan: warning — could not use <file> (invalid JSON or setting), ignoring that file` on stderr and runs normally.
- The hooks continue without a message ([gate README](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#configuration)).

Wrong types in other keys are not rejected: a non-array `ignore` or non-object `checks` is ignored, and `hook` values are merged as given.

## Inspecting the active configuration

`smugan doctor` reports, for the current folder, when warn mode is active, when a `smugan.local.json` layer is in use, and when `"stop": {"build": true}` is set. See [doctor and why](/reference/doctor-and-why/).
