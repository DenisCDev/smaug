---
title: Rules, agents, skills and style
description: The general rules in claude/CLAUDE.md, every stack rule with its paths frontmatter, the critic, flow-critic and smugan-ai-research agents, the three skills and the Smugan output style.
---

Everything on this page lives under [`claude/`](https://github.com/DenisCDev/smugan/tree/main/claude) in the repository. `install.sh` copies it into `~/.claude/`, the [plugin](/reference/plugin/) serves it from the checkout, and the [adapters](/adapters/codex/) generate their host's equivalents from it.

## General rules

[`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) opens with one precedence line: the user's instructions override these rules and any skill, smugan's included. The sections:

| Section | Summary |
|---|---|
| Code | Build the minimum that fully solves the problem (least incidental complexity, not least code). Change only what the task requires. Reuse before writing: existing helper > stdlib > platform feature > installed dependency > new code. Comments only for a non-obvious why. Bound I/O (timeout, limit, concurrency cap) before tuning numbers. A delegation prompt gives goal, scope, done criterion and stop condition in under 150 words outside critical changes. |
| Development preparation | Before technical changes, use `smugan-build` and `smugan context --json <target-path>`. Distinguish declared, lockfile-resolved, installed, runtime and deployed versions; unknown is not latest. Prose-only edits need no discovery. |
| Language | Database identifiers in English snake_case. User-facing strings in `{{UI_LANGUAGE}}` and replies in `{{REPLY_LANGUAGE}}` (filled in from the install's language settings). Code, identifiers and comments in English; commit messages follow the project. Customer-facing content never exposes how it was made, the business model or internal process; a legally required disclosure stays. |
| TypeScript | Strict mode; no `any` without a justification comment. Validate all external input at the boundary with the project's schema validator (zod when installed); adding one is a new dependency (critical). Inside the system, trust the types. |
| Errors | No swallowed errors, no empty `catch`. Every outgoing call has a deadline. When branching on an external API's errors, handle every case its docs list. |
| Secrets | Never commit secrets; use the project's env mechanism and update the example file in the same change. |
| Git | History written for a senior teammate who never saw the conversation: the product and engineering change, not the process. No AI, agent, prompt, feedback or reviewer provenance; no Claude co-author trailer. Subject follows the project, otherwise `type[(scope)]: outcome` (≤ ~72 chars). Body: previous behavior and consequence, new behavior and why, grouped by concern, closing with checks actually run. |
| Definition of done | Critical: auth, sessions or permissions; migrations, SQL or RLS; money; secrets or env; deleting user data; external integrations or webhooks; new dependencies; Rust `unsafe`. Done means the covering checks (typecheck, lint, related tests) pass, with command and result in one line. A bug fix gets one test that fails without the fix; new behavior gets one test at its entry point; reversible low-impact edits get none. A critical change, or an ordinary one over ~300 changed lines, launches `critic`, plus `flow-critic` when users see the change. Brief reviewers with the request verbatim, the touched paths and real logs, never a verdict. Anything left undone goes in a `⚠️ {{NOT_DONE}}` block at the end of the reply. |
| Claims | A claim about system state the session did not check carries its source (`file:line`, `pkg@version`, sha, command output). Absence carries its scope. A product name is not evidence until resolved to a manifest, lockfile or config line. What a run covered comes from its output. A subagent's report is evidence for its output only. A non-reproducing review finding is dropped with the output that shows it. Only verified facts become memory. |
| Stack rules | Rules live in `~/.claude/rules/` and load by path. Paths are hints, not framework detection: confirm the package's dependencies and configuration. Version-specific guidance has a documented coverage range and review date. |

Adapters rewrite the Stack rules section for their host and append a host-specific section (for example [`AGENTS.codex.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/AGENTS.codex.md)).

## Stack rules

Each file in [`claude/rules/`](https://github.com/DenisCDev/smugan/tree/main/claude/rules) has a `paths:` frontmatter that Claude Code uses to load it when a matching file is touched. The adapters and the plugin read the same globs for their rule teaching.

| Rule | `paths:` | Covers |
|---|---|---|
| [`astro.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/astro.md) | `**/*.astro`, `**/astro.config.*` | Confirm versions first (docs reviewed 2026-10-02 for Astro 4–7). Hydrate only needed interaction; SSR, server islands and Actions need their adapter; `output: 'hybrid'` belongs to 4; protect private responses and secrets from `PUBLIC_`; check with `astro check` plus build. |
| [`hono.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/hono.md) | `**/src/**/routes/**`, `**/hono/**`, `**/*.hono.ts` | Applies only when `hono` is in `package.json`. Docs reviewed 2026-10-02 for Hono 4. App separated from the runtime adapter; chained routes for RPC; validator middleware at every boundary and `c.req.valid()`; typed `Bindings`/`Variables`; one root `onError` with `HTTPException`; ordered, scoped middleware. |
| [`mobile.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/mobile.md) | `**/app.json`, `**/app.config.{js,ts}`, `**/eas.json`, `**/*.kt`, `**/android/**`, `**/ios/**` | A stub. Expo / React Native: preserve the existing workflow; new projects start on Expo managed + expo-router; secrets never in the bundle; test on every target platform. Kotlin: preserve toolkit, new projects on Compose, strings in `res/values/strings.xml`. Shared accessibility and locale rules. |
| [`nextjs.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/nextjs.md) | `**/app/**/*.{ts,tsx}`, `**/next.config.*`, `**/middleware.ts`, `**/proxy.ts` | Applies only to a package that uses Next. Docs reviewed 2026-10-02 for Next 15/16. Per-version deltas for 16.x (async request APIs, Cache Components opt-in, `revalidateTag` profile, `proxy.ts`, Turbopack default, `default.js` for parallel slots, `next/image` defaults), 15.x and 14.x. Server Components by default; server-side data; validated and authorized Server Actions; cache invalidation after mutation; `loading.tsx`/`error.tsx`; Metadata API; `next/image`, `next/font`. |
| [`pwa.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/pwa.md) | `**/manifest.{json,ts,webmanifest}`, `**/sw.{js,ts}`, `**/service-worker*.{js,ts}`, `**/serwist*`, `**/workbox*` | Complete manifest and icons (192, 512, maskable, 180 apple-touch); a cache strategy per asset class, written as comments; versioned caches; never cache authenticated or personal data; offline fallback; installability verified on a real or emulated device. |
| [`rust-axum.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/rust-axum.md) | `**/*.rs`, `**/Cargo.toml` | General Rust rules for any `.rs`; Axum sections only when `axum` is in `Cargo.toml`. Axum 0.8 vs 0.7 path syntax, extractors and `Option<T>`. Body extractor last; `State` with `FromRef`; one error enum implementing `IntoResponse`, no `unwrap` on request paths; no blocking calls in handlers; `tower` layers. |
| [`stability.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/stability.md) | `**/*.go`, `**/*.rs`, `**/*.py` | Production survival: deadlines, leverage before tuning numbers, delays. Deliberately not globbed onto `*.ts`/`*.tsx`, which already share a teach budget with other rules; JS/TS are covered by the two global bullets in `CLAUDE.md`. |
| [`supabase.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/supabase.md) | `**/*.sql`, `**/supabase/**`, `**/lib/supabase/**` | SQL paths alone do not establish Supabase. Docs reviewed 2026-10-02 for supabase-js 2 and PostgreSQL 16/17/18. Key and client handling; `getClaims()`/`getUser()`, never `getSession()` alone; RLS enabled in the migration that creates the table, per-operation policies; append-only versioned migrations; naming; atomic counters and money as `numeric` or cents; pgTAP access tests and `SECURITY_NOTES.md`; generated types. |
| [`testing.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/testing.md) | `**/*.test.*`, `**/*.spec.*`, `**/tests/**`, `**/test/**`, `**/*_test.*`, `**/e2e/**`, `**/playwright.config.*`, `**/vitest.config.*`, `**/supabase/tests/**` | Expectations from requirements, not the algorithm; smallest boundary with enough fidelity; production-like fixtures; races shown with barriers. E2E through real persistence with role-based locators. Never green by weakening the suite; removing a test names its replacement. |
| [`ui-ptbr.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/ui-ptbr.md) | `**/*.tsx`, `**/*.jsx` | Installed only when the UI language is Portuguese (`LANGUAGE_RULES` in [`language.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/language.cjs)). Placeholders, aria-labels and errors are user-facing; `Intl` with `pt-BR` for dates, numbers and currency; an accessibility floor. |
| [`ux-flows.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/ux-flows.md) | `**/*.tsx`, `**/*.jsx` | Destructive actions confirm through the app's component; every async action has pending and terminal states; what can be created can be viewed, edited and deleted; submit disabled until valid; empty states; no silent `slice(0, N)`. |
| [`vercel.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/vercel.md) | `**/vercel.json`, `**/next.config.*`, `**/.env.example`, `**/.env.local` | Env vars per environment; no secrets behind a public prefix; `.env.example` in sync; runtime chosen per route; preview deploy as review artifact, production from `main`; zero build warnings, never `ignoreBuildErrors`. |

Several rules point to the guides under `smugan-build/references/` for detail. A rule named in `SMUGAN_DISABLE` (or the plugin's `disable` option) is not installed or taught.

## Agents

Agent definitions are in [`claude/agents/`](https://github.com/DenisCDev/smugan/tree/main/claude/agents). All three are read-only.

### critic

[`critic.md`](https://github.com/DenisCDev/smugan/blob/main/claude/agents/critic.md). Tools: `Read, Glob, Grep, Bash`.

A hostile reviewer that judges behavior against the stated intent. Launched before declaring done a critical change or an ordinary diff over ~300 changed lines, or when the user says "critic", "revisão hostil" or "red team".

**Input:** the user's request quoted verbatim, the touched paths and logs from real runs. Any statement in the invocation that the change is correct, safe or complete is treated as a claim to check, not as context. If an acceptance contract exists (`smugan contract`) and its quoted request matches, its criteria are the floor of the review.

**Procedure:** reconstruct intent; read the real diff (`git diff HEAD`) and every touched file end to end, plus direct callers and callees; run the specific tests for the change (not the whole suite or a build); prove a new test fails on the pre-change base in a throwaway `git worktree`; prove each probe could fail. Then attack in order: requirement vs implementation, unbacked claims, undeclared deferral, authorization, logic edges, races, staleness, theater tests, fixtures that skip production setup, error handling, data integrity. Two closed checklists follow: integration failure (call without a deadline, unbounded listing on a request path, checkout without release) and contract and scope (contract drift, out-of-scope residue).

**Output:**

```
VERDICT: REJECTED | APPROVED

findings:
  1. CRITICAL <file>:<line> — <why it breaks, one line>
     verify: <a command or test to run that demonstrates it>

tested:
  - <command you ran> → <result>
  - reversion: <test> on <base> → FAIL (expected) | not executed: <why>
  - probe: <command> → <output>, differs from <base or broken case>: <its output>
  - reasoned, not run: <claim>

for the caller:
  <fixed block: reproduce each finding before changing code, ...>
```

Severities: CRITICAL (data leak or loss, auth bypass), HIGH (wrong behavior on a real path), MEDIUM (edge case, missing error handling), LOW (breaks a written repository norm, cited). REJECTED whenever a CRITICAL or HIGH exists. At most 5 findings, at most 3 LOW; every finding has `file:line` and an executable `verify:`. No design findings unless the repository writes the norm down. "Looks good" without a `tested:` list is invalid. The only write allowed is the throwaway worktree outside the author's tree.

### flow-critic

[`flow-critic.md`](https://github.com/DenisCDev/smugan/blob/main/claude/agents/flow-critic.md). Tools: `Read, Glob, Grep, Bash`.

Reviews a user-facing change for flow completeness, a product/UX lens distinct from `critic`. Launched before declaring done a critical change that alters a screen, form or flow, or a UI diff over ~300 changed lines, or on "flow review", "revisão de fluxo", "gaps de UX".

**Input:** same as critic; a matching acceptance contract's user-facing criteria are walked too.

**Procedure:** list every screen, form, button and action the diff adds or alters, read each touched component end to end, and walk each interaction as a user (tap, success, failure, in flight, deletion, empty list, return to a created item). Then grade a closed checklist: 1 destructive without confirm, 2 no feedback, 3 submit before valid, 4 dead end, 5 affordance gap, 6 lying label, 7 missing empty or overflow state, 8 danger not signaled.

**Output:**

```
VERDICT: REJECTED | APPROVED

findings:
  1. <MISS # from the checklist> <file>:<line> — <what the user experiences, one line>
     repro: <the exact user step that hits it>

tested:
  - <file read end to end>
  - <git command run>

for the caller:
  <fixed block>
```

REJECTED whenever a miss in items 1–4 exists. At most 5 misses, at most 3 from items 5–8. Style preferences are not findings; pixel-level accessibility is flagged as "verify in E2E".

### smugan-ai-research

[`smugan-ai-research.md`](https://github.com/DenisCDev/smugan/blob/main/claude/agents/smugan-ai-research.md). Tools: `Read, Grep, Glob, Bash, WebFetch, WebSearch`.

Writes the guide for one AI engine + model pair that the smugan hook found in the repository without a valid guide. Used only when a smugan message asks for it.

**Input:** the pair key (`engine@major.minor+family@version`, or `family@version` for a model used without a known engine) and the project path.

**Procedure:** confirm the pair in the code (model id at `file:line`, engine version from what is installed or declared; `smugan ai-guide --project <path>` lists detected pairs); an unconfirmed pair gets no guide. Sources are the vendor's official model docs and the engine's own docs, releases or changelog, never blogs, forums or memory. At most 400 words, a first paragraph of at most 60 words, every statement citing its URL, "not confirmed" where sources are silent. Save with `smugan ai-guide --write <file> --project <path>` from a temp file whose frontmatter has `key`, `reviewedAt` and `sources`.

**Output:** the key, the saved path, the step-1 confirmations with `file:line`, and each source with the date it was read.

This agent is not installed by the adapters: the message that requests it reaches the model only through the Claude Code launcher ([`adapterAgent`](https://github.com/DenisCDev/smugan/blob/main/adapters/shared/install-tree.mjs)).

## Skills

Skills are in [`claude/skills/`](https://github.com/DenisCDev/smugan/tree/main/claude/skills).

### smugan

[`smugan/SKILL.md`](https://github.com/DenisCDev/smugan/blob/main/claude/skills/smugan/SKILL.md). A deep, on-demand, read-only audit. Argument hint: `[scope: security | rls | ui | flows | dead-code | full (default)]`.

Procedure: identify versions with `smugan context --json --no-cache`; re-check the open CRITICAL/HIGH findings in an existing `SMUGAN_AUDIT.md`; run `node "<gateDir>/bin/smugan.mjs" check --json` as the mechanical baseline; audit the dimensions security, rls, ui, flows, dead-code, patterns and errors. Report one line per finding ranked by severity, then `smugan: N findings (...) across F files.` and the top 3 actions, or `smugan: no findings. The hoard is accounted for.` The full report is written to `SMUGAN_AUDIT.md`, the only file the audit edits.

### smugan-build

[`smugan-build/SKILL.md`](https://github.com/DenisCDev/smugan/blob/main/claude/skills/smugan-build/SKILL.md). Prepares a code change from the affected package's real versions, runtime and integrations.

- **Prepare:** run `smugan context --json <target-path>` at the affected package, read its packages, evidence, guides and limitations, and resolve declared vs resolved vs installed vs runtime vs deployed versions. For uncovered versions, consult version-matched official sources and record them; volatile guidance is revalidated after 30 days.
- **Define done:** for an open-ended request, state what counts as done before the first edit. For a critical change, save an acceptance contract with `smugan contract --set <file.json>` (`request`, `criteria` as `{behavior, verify}`, optional `outOfScope` and `decisions`) and mark criteria with `smugan contract --mark <n> done --evidence "..."`.
- **Performance:** only for critical changes or performance tasks: query-budget and listing-limit criteria, or a measured loop of at most 3 rounds.
- **Fresh context:** several independent criteria are implemented in fresh subagents.
- **Research records:** `smugan context --json <target> --record <research.json>` with `component`, `version`, `concern`, `summary`, `source`, `reviewedAt`.

References, loaded by concern (reviewed 2026-10-02), in [`references/`](https://github.com/DenisCDev/smugan/tree/main/claude/skills/smugan-build/references): `astro.md`, `components.md`, `concurrency.md`, `docker-vps.md`, `fresh-context.md`, `icons.md`, `implementer-prompt.md`, `motion.md`, `nextjs.md`, `node-api.md`, `observability.md`, `rust-axum.md`, `supabase-postgres.md`, `testing.md`, `three.md`, `visual-systems.md`.

### smugan-finish

[`smugan-finish/SKILL.md`](https://github.com/DenisCDev/smugan/blob/main/claude/skills/smugan-finish/SKILL.md). Delivers finished work only when the user asks: commit, push, open or merge a PR, finish or discard a branch or worktree.

1. **Evidence first:** the Definition of Done ran on the final state and required reviews are resolved; a red check or an unaccepted `⚠️` item stops delivery.
2. **Read the repository:** status, worktree, remotes, default branch, recent history, CI workflows, PR template, commit convention.
3. **One path:** the user's words, then the project's convention, then a PR with a shared remote or a local merge without one.
4. **Execute:** branch first on a PR path; commit per the Git rules; rebase or merge when behind and re-run checks; never force-push a shared branch or skip hooks.
5. **Report CI:** `gh run list --branch <branch> --limit 1`, reporting passed, failed, running or never started with the reason.
6. **Clean up** only what this work created.

Discarding work requires an explicit request and a confirmed list of everything that goes away. PR review comments are handled the way the critic's `for the caller:` block describes.

The adapters install `smugan` and `smugan-build`; none installs `smugan-finish`.

## Output style

[`claude/output-styles/smugan.md`](https://github.com/DenisCDev/smugan/blob/main/claude/output-styles/smugan.md), named `Smugan`, with `keep-coding-instructions: true`. `install.sh` sets it as `outputStyle` in `settings.json` only when no output style is set.

- Lead with the answer; short prose by default; structure only for real lists or comparisons.
- One recommendation, not a menu; no closing summary; no process narration.
- Plain words; explain a thing before naming an internal label; state the consequence before the mechanism.
- Length follows the question.
- Leave the user's own setup out unless it changes what they must do.
- Prose in the reply language the instructions set, otherwise the user's language.
- **Unfinished work is loud:** anything undone ends the reply in the `⚠️` block, one line per item; no block when nothing is pending.
- **The lock:** brevity never removes evidence (command, result, `file:line`), and the style never overrides the Definition of Done.

The adapters carry the same rules as an "Answers" section in their steering file.
