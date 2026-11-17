---
title: How the engine works
description: How smugan analyzes one file, blanks comments and strings before matching, applies suppressions, and separates violations a change introduced from ones that were already there.
---

The rule engine lives in [`packages/gate/src/engine.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/engine.mjs). It has two entry points:

- `analyzeContent(relPath, content, config)` judges one file's text and returns its violations.
- `checkPaths(targets, cwd)` walks files and folders for the `smugan check` command and calls `analyzeContent` on each file.

The hooks call `analyzeContent` directly, on the text a file would have after an edit and on the text it had before. The engine reads no git history and has no idea what a turn is. The hook decides what counts as new (see [Introduced vs. pre-existing](#introduced-vs-pre-existing-violations)).

## Analyzing one file

`analyzeContent` does the following, in order:

1. **Context artifacts are skipped.** A path that `isContextArtifact` recognizes returns no violations.
2. **The text is normalized.** It removes a leading BOM and turns `\r\n` into `\n`. Without this step, the same violation read from an autocrlf checkout and from a git-HEAD baseline would carry two different messages, and the before/after comparison would stop cancelling old debt.
3. **Every applicable check runs.** The check list is `CHECKS` in [`checks/index.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/index.mjs), 18 rules. A check runs only when:
   - its `appliesTo(path)` accepts the path (each check filters by extension and folder), and
   - `checkEnabled(config, name, path)` in [`config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs) allows it. `checks.<rule>: false` turns a rule off. The seven Supabase rules (`rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`, `search-path`, `rls-policy`) default to on only where the file belongs to a Supabase project. `ui-strings` defaults to on only when `SMUGAN_UI_LANG` is a `pt` tag.

   Each check gets `{ path, content, lines, config, options }`, where `options` is the object under `checks.<rule>` in the config. It returns `{ line, message }` findings. The engine adds `file`, `rule` and `severity: 'error'` to each one.
4. **Suppressions are applied.** `parseSuppressions` reads `smugan-ignore` comments from the normalized lines (rules below). A suppression whose reason is too short creates its own `smugan-ignore` violation, and that violation cannot be suppressed.

`await-in-loop` is not in `CHECKS`. The `pre` hook calls it separately, only in a critical turn. The end-of-turn detectors (contract drift, clones, residue, assertion weakening) live in their own modules and call `parseSuppressions` themselves where they honor it. See [End-of-turn detectors](/reference/end-of-turn-detectors/).

## Blanking comments and strings

Most checks match regular expressions. To keep those from matching inside comments or string contents, the checks first run the text through [`strip.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/strip.mjs):

- **`stripCode`** (JS/TS) replaces comments, string contents, regex bodies and template-literal text with spaces. It keeps the length and every line break, so an offset or line number in the stripped copy is the same in the original. Code inside `${…}` is kept and scanned the same way. Other behaviors:
  - The `/` that opens a regex is told apart from division by the previous significant character, plus a list of keywords (`return`, `typeof`, `case`, …). After a postfix operator (`i++ / 2`, `price! / 100`) or a JSX closing tag, `/` is never a regex.
  - An apostrophe glued to a word (JSX text such as `You're`) does not open a string, unless the word is a keyword such as `from` or `import`.
- **`stripSql`** blanks `--` comments, `/* … */` comments and `'…'` string contents (with `''` escapes). It keeps dollar-quoted bodies, because those hold DDL that the SQL rules need to read.

Because the copy keeps offsets, a check can find a construct in the stripped text and then read the original at the same position. `stale-mutation` reads an `.rpc('name')` this way, `rls-policy` reads `user_metadata` inside a string, and `test-weakening` compares the two sides of an `expect(…)`.

Two checks read the raw text on purpose:

- `secrets` scans every raw line, comments included, so a key left in a comment is still flagged.
- The `smugan-ignore` parser matches raw lines, which is why a suppression works in `//`, `--`, `/* */` and `<!-- -->` comments alike.

Shared SQL helpers are in [`sql-util.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/sql-util.mjs):

| Helper | What it does |
|---|---|
| `QUALIFIED_NAME` | Accepts bare or double-quoted parts, so `"public"."notes"` from `supabase db diff` reads as table `notes` |
| `normalizeIdent` | Defaults the schema to `public` |
| `PLATFORM_SCHEMAS` | `auth`, `storage`, `extensions`, `realtime`, `vault`, `pg_catalog` |
| `userTables` | The non-temporary tables a file creates outside those schemas |
| `isMigrationPath` | True for a `.sql` file under a `migration/` or `migrations/` folder |
| `statementHeader` | A statement's text up to its `;`, without dollar-quoted bodies |

## Suppressions

The syntax, from `SUPPRESS_RE` and `parseSuppressions`:

```
smugan-ignore <rule>[,<rule>…]: <reason>
smugan-ignore-file <rule>[,<rule>…]: <reason>
```

- **Rule list.** Lowercase letters, digits, `-`, `*` and commas, with no spaces. `*` matches every rule. If the list does not match that shape, or the colon is missing, the comment is not read as a suppression at all.
- **Reason.** It is cut at a trailing `*/` or `-->` and trimmed. It must be at least 6 characters. A shorter one suppresses nothing and is reported as a `smugan-ignore` violation: `suppression without a real reason — use "smugan-ignore <rule>: <reason with 6+ chars>"`.
- **Scope.** `smugan-ignore` covers its own line and the line after it. A blank line in between breaks the link. `smugan-ignore-file` covers the whole file, wherever it stands.
- **One per line.** Only the first suppression on a line is read.
- **Old name.** `smaug-ignore`, the project's former name, is accepted the same way.

Suppressions apply only to rule findings. A typecheck, test or ESLint failure is not a rule line, and the hook does not suggest `smugan-ignore` for one.

## Walking a tree (`smugan check`)

`checkPaths` visits each target. A folder is walked recursively.

- **Skipped folders.** It never descends into `node_modules`, `.git`, `.next`, `dist`, `build`, `out`, `coverage`, `.vercel`, `.turbo`, `.expo`, `.claude`, `.venv`, `venv`, `site-packages`, `__pycache__` or `.terraform`.
- **Ignored paths.** The config's `ignore` globs and the fixed `DEFAULT_IGNORE` list also apply. That list includes lockfiles, `*.min.*`, `*.gen.*`, `database.types.ts`, `.env`, `.env.local`, `.env.*.local`, and a `vendor` folder that a package manager filled.
- **Which files are read.** A file is read only when at least one check's `appliesTo` accepts it and it is at most 1 MiB (`MAX_FILE_BYTES`).
- **Config per file.** Each file is judged with the config found by walking up from its own folder. That config's folder is the root that the rule paths and ignore globs are relative to. A folder with no config, `.git` or `package.json` of its own inherits its parent's config.

[`format.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/format.mjs) prints the result, sorted by file, line and rule. There are two formats:

- Human text: `file:line  [rule]  message`, plus a footer that tells you how to suppress.
- `--json`: `{ ok, filesChecked, violations }`.

`smugan check` exits with `1` when it found violations, `0` with `--warn` or a clean run, and `2` on a usage or internal error ([`bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs)). It lists every violation in the files it reads and does not compare against any baseline.

## Introduced vs. pre-existing violations

The hooks block only what a change adds. The comparison is in [`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs):

- **Identity.** `countViolations` turns a list of violations into a count per `rule|message`. The line number is not part of the key, so a violation that only moved is not new.
- **Comparison.** `freshAgainst(baseline, violations)` spends each baseline count against the current violations. Whatever is left over is new: a second identical violation counts as new even when one was already there.

**Before a write (`pre`).**

1. The hook builds the text the file would have after the edit. A `Write` provides the whole content. `Edit` and `MultiEdit` replace `old_string` with `new_string` in the current file.
2. It analyzes the current file and the result, and blocks with exit code `2` on the violations that are new.
3. If an `old_string` does not match, or the file is over 1 MiB, there is nothing to judge and the write passes.
4. A new file has no "before", so every violation in it counts.
5. `dead-imports` is not judged in `Edit` or `MultiEdit`, only in `Write`. A change made in several steps legitimately passes through an unused import.

**First touch of the turn.** The first time a turn touches a file, `recordBaseline` stores the before counts in the turn state. For a code file it also stores:

- the names of the functions the file already has,
- the contract-drift shapes it already has,
- for a test file, its assertion profile and test counts.

The first touch wins: later edits in the same turn do not move the baseline.

**End of turn (`stop`).** The hook analyzes every touched file again and compares against one baseline, chosen in this order:

1. The first-touch baseline, when there is one.
2. For a file a shell command changed, its version from before the turn's first commit to it.
3. Otherwise, the committed version at git HEAD (`freshVsHead`). HEAD baselines are cached per blob sha.
4. A file outside git gets the full check.

It reports at most 20 violations per file.

**Warn mode.** With `"mode": "warn"` in the config, both hooks report the same findings without blocking.
