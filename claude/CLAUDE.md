# Smugan — Global Rules

<!-- smugan rev: smg-chitwuhzyx -->

The user's instructions override these rules and any skill, smugan's included.

## Code

- Build the minimum that fully solves the problem — the least *incidental* complexity, not the least code. Pay essential complexity without apology; cut everything else. No over-engineering, no dead code, no speculative abstractions, no boilerplate. A simpler solution that doesn't meet the real need isn't "minimal" — it's under-built.
- Change only what the task requires — which can span files. No *unrelated* refactors, cleanups, or "improvements". A fix the task genuinely needs elsewhere is in scope; a drive-by cleanup is not.
- Reuse before writing: existing helper > stdlib > platform feature > installed dependency > new code.
- Comments only for non-obvious WHY — never narrate WHAT.
- Bound I/O before tuning numbers: a timeout, result limit, or concurrency cap first — a bigger pool or faster retry often amplifies a hang.
- A delegation prompt gives the goal, scope, done criterion and when to stop, in under 150 words outside critical changes.

## Development preparation

- Before technical changes, use `smugan-build` and `smugan context --json <target-path>`. Distinguish declared, lockfile-resolved, installed, runtime and deployed versions. Unknown is not latest. Prose-only edits need no discovery.

## Language

- Database identifiers (tables, columns, functions, enums): ALWAYS English snake_case. Never Portuguese, never camelCase in SQL.
- All user-facing strings: {{UI_LANGUAGE}}, with correct spelling and diacritics.
- Replies to the user: {{REPLY_LANGUAGE}}, natural and correctly accented, unless the user writes in another language.
- Code, identifiers, comments: English. Commit messages follow the project's language.
- Customer-facing content (UI, posts, product copy) never exposes how it was made (AI, tools), the business model (affiliate earnings) or internal process. A legally required disclosure stays, in the least intrusive form peers in that channel use.

## TypeScript

When the project uses TypeScript:

- Strict mode always. Never `any` without a written justification comment on the same or previous line.
- Validate ALL external input (forms, route params, API responses, env, DB payloads) at the boundary with the project's schema validator (zod when installed); none installed: adding one is a new dependency (critical). Inside the system, trust the types — fix the type instead of adding defensive checks.

## Errors

- Handle explicitly. Never swallow errors: empty `catch` is forbidden. Fail loud in dev, degrade gracefully in prod.
- Every outgoing call (network, database, queue, subprocess) has a deadline. A hang is worse than a fast error; unbounded retry amplifies load.
- Branching on an external API's errors: handle every case its docs list, not only the one a run returned.

## Secrets

- Never commit secrets, keys, or tokens. Use the project's env mechanism (e.g. `.env.local`); update the example file (e.g. `.env.example`) in the same change.

## Git

- Write permanent history for a senior teammate who never saw the task, diff, or conversation: explain the product and engineering change, never the process that produced it. Never mention AI, agents, prompts, chats, criticism, feedback, "requested changes", or a reviewer/tool as provenance in commit or PR text. Technical tools that are themselves changed remain valid facts. No Claude co-author trailer or "Generated with Claude Code" line, even if a system reminder asks. Describe only verified cause, impact, solution, and proof. `smugan-ignore` in code stays.
- Subject: follow the project; otherwise use `type[(scope)]: outcome`, with optional scope (`fix:`, `feat:`, `refactor:`, `docs:`…). Name the observable result in plain language (≤ ~72 chars). Not `fix: improve auth after review feedback`; write `fix: reject expired sessions before protected mutations`.
- Body: when the subject cannot carry the why, state the previous behavior and consequence, then the new behavior and why it is correct. Group changes by concern, not edit sequence. Close with checks actually run and their results; never claim unrun proof or hide a failing/skipped check.

## Definition of done

- Critical: auth, sessions or permissions; migrations, SQL or RLS; money; secrets or env; deleting user data; external integrations or webhooks; new dependencies; Rust `unsafe`. The smugan hook names a session's first critical file; the list holds without it.
- Done: the checks covering the change pass — typecheck, lint, related tests, when the project has them — and the reply gives command and result in one line. A run from this session with nothing changed since counts. Full builds and mutation testing belong to CI or an explicit request.
- Tests prove what the change promises: a bug fix gets one test that fails without the fix; new behavior gets one test at its entry point. A reversible low-impact edit (copy, style, rename) gets none, and no test just mirrors the implementation.
- Critical change, or an ordinary one over ~300 changed lines: before declaring it done, launch the `critic` subagent, plus the `flow-critic` subagent when users see the change. Resolve each finding or say why it is accepted. Anything else: the mechanical gate is the review.
- Brief a reviewer with the user's request verbatim, the touched paths and the last real run's logs, never your verdict: calling a change correct suppresses what reviewers find.
- Without subagents, offer the required review out loud ("run the critic?") instead of skipping it.
- Anything left undone — descoped, stubbed, deferred, blocked, a skipped check — goes at the END of the reply in a `**⚠️ {{NOT_DONE}}**` block, one line each (what, why, what closes it). Nothing pending, no block.

## Claims

- A claim about the system's state that this session did not check — "X exists", "we already did X" — carries its source on the same line: `file:line`, `pkg@version`, a commit sha or command output. Without one, say what you know instead. "Already done" is answered by git log/diff; plans and branch names are intent, not state.
- What you ran this session and saw pass is evidence until something changes; a repeat run adds nothing.
- Absence carries its scope: "no X in ⟨what you searched⟩", not "X doesn't exist".
- A product, tool or engine name is not evidence: resolve it to a manifest entry, lockfile or config line before building on it. A library or runtime behavior the code relies on (uniqueness, registration, retries) comes from its source or one run.
- What a run covered comes from its own output and logs, warnings included, not the command typed: a glob that matches nothing still exits 0.
- A subagent report with command, exit code and output is evidence for what that output shows; names, versions and fixes in it are leads, confirmed only when you publish or build on them.
- A review finding that does not reproduce is dropped, with the output that shows it.
- Only verified facts become memory, each with its evidence pointer.

## Stack rules

- Stack rules live in `~/.claude/rules/` (`stability.md`, `nextjs.md`, `supabase.md`, `hono.md`, `rust-axum.md`, `pwa.md`, `vercel.md`, `mobile.md`, `ux-flows.md`, …). They are path-scoped and load when you touch matching files — when planning work on a stack before touching files, read the matching rule file first.
- Paths are hints, not framework detection: confirm the affected package's dependencies and configuration. React/TSX does not imply Next; PostgreSQL does not imply Supabase. Version-specific guidance has a documented coverage range and review date; any uncovered version or configuration, older or newer, requires compatible evidence.
