---
title: End-of-turn detectors
description: What the stop hook's contract-drift, clone, exploration-residue and assertion-weakening detectors find, their limits, and which of them hold the turn once versus every time.
---

These four detectors need to know what the turn did, so they run only in the `stop` hook, at the end of a turn. `smugan check` never runs them. They are wired up in [`packages/gate/src/hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs), after the touched files are analyzed again.

**Prerequisites.** For a project's files, each detector needs all of these:

- `hook.stop` is not `false`,
- `hook.stop.smugan` is not `false`,
- the file is not in an `ignore` glob,
- the rule is not turned off with `"checks": { "<rule>": false }`.

## Listed once vs. blocking

Every finding goes into the end-of-turn report. A report with any finding holds the turn: the hook exits with `2`, and the agent has to answer. How often a finding can hold the turn depends on the detector.

| Detector | Behavior |
|---|---|
| `contract-drift` | Listed once |
| `clone` | Listed once |
| `exploration-residue` | Listed once |
| `assertion-weakening`, removed tests and deleted test files | Listed once |
| `assertion-weakening`, lost assertions in a test that is still there | Blocks like a gate violation |

**Listed once.** When a hold includes a "listed once" finding, its key is stored in the turn state (`state.shown`). Later ends of the same turn skip it. The agent may have a reason that the gate cannot see. Nothing is deleted or restored.

**Blocking.** A lost-assertion finding counts against the turn's hold budget on every end of turn, like a gate violation.

**Hold budget.** A turn gets 1 hold, or 2 when it touched a critical file (`ROUTINE_STOP_BLOCKS`, `MAX_STOP_BLOCKS`). When the budget is spent and the last hold contained only "listed once" items, the turn ends with a note that every check was green.

In warn mode (`"mode": "warn"`), the same report is shown without a hold.

## `contract-drift`

Source: [`contract-drift.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/contract-drift.mjs)

**What it detects.** A function that already existed when the turn first touched its file, and that now answers bad input or a failure with a quiet default. Only constructs the turn added count. There are four shapes:

- **A `catch` block that swallows the failure.** Its statements only log (`console.*`, `logger.*`, `log.*`, `this.logger.*`, `Sentry.*`, `captureException`, `reportError`), `continue`, or `return` without using the error variable, and it has no `throw`.
- **A `.catch(…)` callback that swallows the rejection.** The callback is empty, only logs, or returns a literal that does not use the error (`.catch(() => [])`, `.catch(() => ({}))`).
- **A fallback to a literal.** `?? literal` or `|| literal` over one of these:
  - a parameter of the function (optionally through `.field` or `[index]`), or
  - a field of `res`, `resp`, `response`, `data`, `json`, `body`, `payload` or `result`.

  The literals are numbers, strings, `[]`, `{}`, `null`, `undefined`, `true` and `false`.
- **A new guard.** `if (…) return null`, `return undefined` or `return []`, also with a cast (`return [] as Item[]`, `return null!`). A bare `return` counts only when the function returns a value elsewhere.

Example, from [`test/contract-drift.test.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/test/contract-drift.test.mjs). This existing function:

```js
export async function loadOrders(userId, opts) {
  const res = await fetch('/orders/' + userId, { signal: AbortSignal.timeout(5000) });
  return res.json();
}
```

gains `try { … } catch (error) { console.error('orders', error); return []; }`, and is reported as:

```
loadOrders(): new catch answers the failure with `return [];` — callers that saw the error now get a normal-looking value
```

**Not drift:**

- A rethrow (`throw new Error(…, { cause: error })`).
- A new function: it defines its own contract.
- A shape that was already in the function at first touch.
- `?? []` that is then walked as a list (`for … of`, spread, `.map`/`.filter`/`.length`/…).
- A spread `?? {}`.
- A construct inside a nested function or callback. It belongs to that function, which is judged on its own if it existed.

**Limits:**

- **Excluded paths:** script, test, e2e, bin and config files, `.d.ts`, and UI files (`.jsx`/`.tsx`, `component/`, `components/`, `ui/` folders).
- **Which functions are judged.** Only files whose function names and drift shapes the `pre` hook recorded at first touch. A file created in the turn, or changed outside `Write`/`Edit` without a recorded first touch, is not judged.
- **How functions are found.** By text ([`functions.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/functions.mjs)): declarations, function and arrow expressions assigned to a name, property or class field, the anonymous default export, and methods. Arrows with an expression body have no block and are left out.
- **What cancels.** Shapes are keyed as `kind|function|shape`, without line numbers, and counted. The same shape appearing again in a function that already had it is cancelled once per earlier occurrence.
- **Cap:** at most 10 findings per file per end of turn.

**Suppress** with `smugan-ignore contract-drift: <reason>` on the reported line or the line above.

## `clone`

Source: [`clones.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/clones.mjs)

**What it detects.** A function the turn wrote that is identical to another function in the repository, up to names and literals (type-1 and type-2 clones). A function counts as written by the turn when:

- it is in a file created in the turn, or
- the file did not have a function of that name at its first touch.

**How bodies are compared:**

1. The body is taken from the stripped code and tokenized.
2. Keywords and punctuation are kept as they are.
3. Identifiers are renamed in order of first appearance (`$0`, `$1`, …).
4. Numbers become `N` and strings become `S`.
5. The token sequence is hashed (SHA-256, first 20 hex characters).

Only bodies with at least 60 tokens count. The project config can change that with `"checks": { "clone": { "minTokens": n } }`. Two new functions that copy each other are reported once.

The message names the function to reuse. In this example the paths are made up, and the two functions are the `FORMAT` and `RENAMED` fixtures from [`test/clones.test.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/test/clones.test.mjs):

```
src/money.mjs:1  [clone]  `moneyLabel` repeats `formatCents` up to names and literals — reuse `formatCents` at src/format.mjs:1, or extract what differs into a parameter
```

**Limits:**

- **Excluded paths:** `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `.next`, `.d.ts`, `.min.`, `.gen.`, test and fixture folders (`test/`, `tests/`, `__tests__/`, `e2e/`, `fixture/`, `fixtures/`), and `.test.`/`.spec.` files.
- **Exact clones only.** A semantic clone (same behavior, different code) is not detected.
- **Repository index.** The files come from `git ls-files -co --exclude-standard`, with a 2 s timeout and a 16 MB output buffer.
  - At most 5,000 code files are indexed.
  - Files larger than 512 KiB are listed with no functions.
  - When the listing fails, there is nothing to compare against.
- **Time budget.** The index is cached in the system temp folder as `smugan-clones-<hash>.json`, keyed per file by size, mtime and `minTokens`. Each end of turn spends at most 500 ms reading changed files, always at least one, and continues on the next end of turn.
  - An incomplete index is recorded as `clone-index-partial`, which `smugan why` shows.
  - A clone of a function that has not been indexed yet is missed until the index catches up.
- **Prerequisite:** a file with no first-touch snapshot that was not created in the turn is not judged.

**Suppress** with `smugan-ignore clone: <reason>` on the new function's line or the line above.

## `exploration-residue`

Source: [`residue.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/residue.mjs)

**What it detects.** Two kinds of leftovers.

**1. A new script that nothing references.** It applies to a file created in the turn that meets all of these:

- It has one of these extensions: `.js`, `.cjs`, `.mjs`, `.ts`, `.cts`, `.mts`, `.tsx`, `.jsx`, `.py`, `.sh`, `.ps1`, `.rb`.
- It is not a test path, a config name (`*.config.*`, `.xxxrc`, `eslint.*`, `prettier.*`) or a framework convention file (`middleware`, `proxy`, `instrumentation`, `instrumentation-client`, `mdx-components`, `sentry.*`, `*-env.d`, `global.d`, `env.d`).
- It is either:
  - named like exploration (`repro`, `reproduce`, `scratch`, `debug`, `tmp`, `temp`, `try`, `playground` or `poc`, followed by `-`, `_`, `.`, a digit or nothing), or
  - left loose at the project root, when the turn's scope is known.
- The scope does not name it.
- No other file references it.

How a reference is found:

1. `git grep -l -z -F --untracked` lists candidate files. The search terms are the file name and the forms `/stem'`, `/stem"`, `` /stem` `` and `/stem.`. Lockfiles are never candidates.
2. Each candidate is read whole. It references the script when it contains either:
   - the whole file name, or
   - a path ending in the stem, written as an import or a config writes one (`./tmp`, `../lib/tmp.js`, `@/tmp`).

   An absolute path (`'/tmp'`), a URL, or a package path (`@types/tmp`, `node_modules/tmp`) does not count.

**2. A config change that the scope does not ask for.** It applies to a touched file of one of these kinds:

| Kind | Files | Scope words that clear it (excerpt) |
|---|---|---|
| Manifest | `package.json` | `depend`, `package`, `instal`, `version`, `upgrade`, `npm`, `pnpm`, `yarn`, `bun`, `lockfile` |
| Lockfile | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb` | same as the manifest |
| TS/JS config | `tsconfig*.json`, `jsconfig*.json` | `tsconfig`, `typescript`, `compil`, `strict`, `alias` |
| Build/lint/test config | `vite`, `vitest`, `webpack`, `rollup`, `next`, `nuxt`, `astro`, `svelte`, `tsup`, `esbuild`, `babel`, `jest`, `playwright`, `tailwind`, `postcss`, `eslint`, `prettier` or `rspack` `.config.*`; `.babelrc`, `.swcrc`, `turbo.json`, `.eslintrc*` | `build`, `bundl`, `config`, `lint`, and the tool names |

The word lists are regular expressions, matched without regard to case. The manifest list also has Portuguese stems (`pacote`, `bibliotec`, `versão`, `atualiz`). The full lists are `DEPENDENCY_WORDS` and `CONFIG_KINDS`.

- **How a lockfile counts as changed.** The turn does not edit it directly, so it counts when its mtime is at or after the turn's start and `git status --porcelain` shows it.
- **What else clears a change.** The scope naming the file, or naming a dependency that the manifest added or changed against HEAD (`use zod`). For a lockfile, the manifests beside it and the ones the turn touched are compared.

**The scope** is put together in `turnScope`:

- the active [acceptance contract](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#acceptance-contract), when one of its criteria is not `done`, and
- the person's last three requests, read from the last 512 KiB of the transcript.

With neither, the scope is unknown. Then only exploration-named scripts are judged, and config changes are not judged at all.

**Limits:**

- **When `git grep` can't answer.** If it fails, exceeds the git helper's 2 s timeout or 256 KB output buffer, or more than 2,000 candidate files match, the script counts as referenced.
- **Read budget.** Candidates are read up to 32 MiB in all. A candidate that does not fit in what is left also counts as a reference.
- **Paths are not resolved.** An import of a file with the same name in another folder still clears the script.
- **Suppressing.** A `smugan-ignore` comment does not apply. A path in the project's `ignore` globs is never listed, and `"checks": { "exploration-residue": false }` turns the detector off.

The message for a script is `new file that no import, test, script or config references — delete it if the task does not need it, or say why it stays`. For a config it is `changed, but neither the acceptance contract nor the request asks for it — revert it if the task does not need it, or say why it changed`.

## `assertion-weakening`

Sources: [`assertion-weakening.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/assertion-weakening.mjs), using the test-block reader from [`checks/test-weakening.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/test-weakening.mjs)

**When it runs.** Only when the same turn also touched a production file, meaning one that is neither prose nor a test path. Editing only tests is treated as a task of its own.

**Baseline.** Each touched test file is compared with one of these, in order of preference:

1. the assertion profile and test counts the `pre` hook stored at the turn's first touch,
2. for a file a shell command changed, its version before the turn's first commit to it,
3. git HEAD.

**What counts as a strong assertion:**

- An `expect(…)` (also `expect.soft`, `expect.poll`) whose first matcher after the chain words is not weak. The chain words are `not`, `to`, `be`, `resolves` and similar.
  - Weak matchers: `toBeDefined`, `toBeTruthy`, `toBeFalsy`, `ok`, `exist`.
  - Weak only after `not`: `toBeNull`, `toBeUndefined`, `null`, `undefined`.
- An `assert.<method>(…)` other than bare `assert(…)`, `assert.ok` and `assert.strict`.

**Lost assertions (blocks).** For every literal test title present both before and now, a drop in strong assertions is reported at the test's line, at most 20 per file:

```
test "<title>" lost 1 strong assertion(s) this turn (2 → 1) while production code changed — …
```

Rules for titles:

- A title declared more than once in the file is skipped.
- A computed title (a variable, a template with `${…}`) is skipped.
- Titles are compared on their first 200 characters.

**Removed tests (listed once).** A file is checked for removals when it meets all of these:

- it declares fewer tests than at the start,
- it does not have more table or untitled tests than before, and
- it holds fewer strong assertions in total.

Then every title that had strong assertions and is now declared fewer times is listed. The rules for counting:

- **Moved tests.** A title that another test file of the turn gained offsets one removal: the test moved.
- **Tables and computed titles.** These are counted without a name.
- **Deleted test files.** A test file deleted during the turn, by a command or by a commit of the turn, is listed the same way. A suppression cannot cover it.
- **Message.** At most five titles are named, followed by `and N more`.

**Accepted misses:**

- A renamed test.
- Tests folded into an `it.each` table or a loop.
- A changed expected value: a legitimate behavior change looks identical.
- Assertions lost under a title repeated across several `describe` blocks.
- Assertions that live in helpers.

**Suppress:**

- Lost assertions: `smugan-ignore assertion-weakening: <reason>` on the reported line or the line above.
- Removed tests: a suppression on line 1 of the file, or `smugan-ignore-file assertion-weakening: <reason>`.
