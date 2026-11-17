---
name: smugan
description: >
  Deep on-demand quality audit of the current project: security, Supabase RLS,
  secrets, UI strings, database naming, dead code, error handling, and
  conformance with the smugan rules (~/.claude/rules/). Use when the user asks
  for an audit, review, or quality check — "auditoria", "audite", "revisão",
  "revise", "qualidade", "code review", "audit", "review", "check quality",
  "está seguro?", "RLS", "vazamento", "dead code" — or before a release/deploy.
  Read-only by default: report findings; only fix when explicitly asked.
  Do NOT use for writing new features or non-code questions.
argument-hint: "[scope: security | rls | ui | flows | dead-code | full (default)]"
---

<!-- smugan rev: smg-chitwuhzyx -->

# Smugan — deep audit mode

You are auditing, not building. Be a skeptical senior reviewer: every claim
needs a file:line. Report; do not fix unless the user asked for fixes.

## Procedure

1. **Scope.** Parse the argument and identify versions. Default `full`. A named scope
   runs only that dimension plus the gate. Run `smugan context --json --no-cache`
   at the target package, or the configured gate CLI below if not on PATH.
   Distinguish declared/resolved/installed/runtime evidence and unknowns; read
   only relevant guides from `../smugan-build/references/`. If discovery is
   unavailable, inspect bounded relevant artifacts and state the gap. Do not
   apply Next rules to Astro/React or Supabase identity functions to plain SQL.
2. **Settle the previous audit's debt.** If `SMUGAN_AUDIT.md` exists at the
   project root, re-check its OPEN CRITICAL/HIGH findings FIRST — still
   present (file:line unchanged or moved) or fixed? Mark each `RESOLVED
   <commit/evidence>` or `OPEN since <date>`. Preserve the evidence rather
   than treating a prior report or cached context as current approval.
3. **Run the gate.** Read `~/.claude/hooks/smugan.paths.json` → `gateDir`, then run
   `node "<gateDir>/bin/smugan.mjs" check --json` at the project root. Its findings
   are the mechanical baseline — do not re-derive what it already caught.
4. **Audit the dimensions below** (or the scoped subset). Use Grep/Read; sample
   intelligently instead of reading everything.

## Dimensions

**security** — secrets in code or git history (`git log -p` samples for keys);
`service_role` reachable from client code; when Next, `NEXT_PUBLIC_*` carrying
secrets; auth checked on the server (verified JWT; `getClaims()` when Supabase)
on every mutation and private route; input validated with the project's schema
validator (zod when installed) at every boundary (Server Actions, route
handlers, webhooks); `dangerouslySetInnerHTML` without sanitization.

**rls** — confirm database product, exposed roles, grants and RLS boundaries.
Check the project's required migration protections and policies per operation
(select/insert/update/delete) against actual owner/team/public access. Private
user data must not have blanket public access; an intentional public catalog
needs its stated read/write contract. No table relies on client filtering.
Test ordinary roles and cross-tenant access; storage policies matter too.

**ui** — JSX text/labels/placeholders/aria outside the UI language; text without
accents/cedilla; dates/numbers/currency hand-formatted instead of `Intl` with
the UI language's locale; raw error objects or English library messages shown to users;
missing labels, unreachable focus, clickable `<div>`s.

**flows** — user-journey completeness (read as a user, don't just grep): destructive
actions (delete/remove/discard/unassign) with no confirmation step, or `window.confirm`
instead of the app's own component; async actions with no loading state and no
success/error feedback; entities creatable with no view/edit/delete path; submit
enabled before inputs are valid; headings/labels that don't match their content;
collections with no empty state, or a silent `slice(0, N)` on a growable list. This is
a sweep across the project, not a per-feature flow review.

**dead-code** — exports never imported; files never referenced; dependencies in
package.json never imported; commented-out blocks; unreachable branches;
`console.log` leftovers.

**patterns** — conformance with `~/.claude/rules/` and relevant version/integration
guides for the detected package: use the actual rendering/router contract,
validated and authorized mutation boundaries, generated database types where
applicable, versioned migrations and English snake_case DB identifiers. Respect
supported Server-to-Client element composition and opt-in cache models.

**errors** — empty `catch`; caught-and-ignored promises; when Next, missing
`error.tsx` / `loading.tsx` on async route segments; errors swallowed into silent fallbacks;
fail-quiet code paths in dev.

## Report format

One line per finding, ranked by severity (CRITICAL → HIGH → MEDIUM → LOW):

```
CRITICAL src/app/api/admin/route.ts:12 — service_role key used in a public route. Move to server-only module + verify JWT.
HIGH     supabase/migrations/0002_notes.sql:1 — table `notes` created without RLS. Add enable row level security + per-op policies.
```

End with:

```
smugan: N findings (C critical, H high, M medium, L low) across F files.
Top 3 actions: <one line each>
```

If clean: `smugan: no findings. The hoard is accounted for.`

Then persist the ledger: write the full ranked report to `SMUGAN_AUDIT.md` at
the project root — date, per-finding status (`OPEN` / `RESOLVED <evidence>`,
carrying forward still-open findings from previous runs), and the top-3
actions. The chat shows the summary; the file is the memory the next audit
(and the next session) starts from.

## Boundaries

- Read-only: never edit project files during the audit — `SMUGAN_AUDIT.md`, the
  audit's own ledger, is the single exception. Offer fixes as the follow-up.
- Every finding cites file:line. No finding without evidence. No padding —
  if a dimension is clean, one line says so.
- Large repos: audit `src/`, `app/`, `supabase/` first; say what was not covered.
