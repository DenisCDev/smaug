---
title: Risk levels
description: How smugan classifies each file as trivial, normal or critical by its path, and how `smugan risk` overrides the level for a checkout.
---

Each file gets one of three levels: `trivial`, `normal` or `critical`. The hook
decides the level from the file's path, and for Rust from its content too. The model
never decides it. A turn takes the highest level among its files. All of this is in
[`packages/gate/src/risk.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/risk.mjs).

## What the level changes

| Level | Effect |
|---|---|
| `critical` | The Stop allows 2 holds per turn instead of 1. In `pre`, `await-in-loop` findings the edit adds are judged. The session's first edit of a critical file per project returns a reminder to run the reviewers, with a contract suggestion. |
| `normal` | The full end-of-turn run: gate, typecheck and tests. |
| `trivial` | For a project root whose level is trivial, the Stop keeps the gate and the typecheck and skips the tests (`tests (<root>: trivial level)` is reported as skipped). |

## Critical paths

Matching works on a normalized path. First the camelCase and acronym boundaries
become hyphens: `JWTService` → `jwt-service`, `withAuth` → `with-auth`. Then the path is
lowercased. Names match as whole words: a word must be bounded by the start or end of
the path or by one of `/ . _ ( ) [ ] -`. So `withAuth.ts` and `(auth)/` match, and
`author.ts` does not. Prose files (`.md`, `.markdown`, `.txt`, `.rst`, `.adoc`) are
never critical.

The patterns are checked in this order, and the first match gives the reason:

| Reason | Pattern |
|---|---|
| `migration` | a `migration/` or `migrations/` segment |
| `SQL` | a name ending in `.sql` |
| `request middleware` | `middleware` or `proxy` as a file (`.js`, `.jsx`, `.ts`, `.tsx`, `.cjs`, `.mjs`, `.cts`, `.mts`, …) or a folder |
| `auth or permissions` | whole words `auth`, `authn`, `authz`, `authentication`, `authenticate`, `authenticated`, `authenticates`, `authenticator`, `authorization`, `authorize`, `authorized`, `authorizes`, `authorizer`, `oauth`, `oauth2`, `session`, `sessions`, `login`, `logout`, `signin`, `sign-in`, `signup`, `sign-up`, `password`, `passwords`, `credential`, `credentials`, `jwt`, `token`, `tokens`, `permission`, `permissions`, `role`, `roles`, `rbac`, `acl`, `guard`, `guards`, `policy`, `policies` |
| `payments or webhooks` | whole words `payment`, `payments`, `billing`, `checkout`, `stripe`, `invoice`, `invoices`, `subscription`, `subscriptions`, `webhook`, `webhooks` |
| `secrets or env` | a file named `.env` or `.env.<suffix>`; `env.js`, `env.ts`, `env.cjs`, `env.mjs`, `env.cts` or `env.mts`; or `secret`/`secrets` alone or with dotted suffixes (`secrets.json`, `secret.prod.yaml`) |
| `dependencies` | `package.json` or `cargo.toml` (matched after lowercasing, so `Cargo.toml`) |
| `Rust unsafe` | a `.rs` file whose content matches `unsafe` followed by `{`, `fn`, `impl`, `trait` or `extern` |

The Rust content check needs the file's content. The Stop reads `.rs` files for it.
On `pre`, the content the edit writes is passed in.

## Trivial paths

A file is trivial when it is not critical and its path matches one of these
(case-insensitive):

- prose: `.md`, `.markdown`, `.txt`, `.rst`, `.adoc`
- styles: `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.pcss`
- images and fonts: `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.ico`,
  `.bmp`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`
- translation catalogs: `.po`, `.pot`, and `.json`/`.yaml`/`.yml` files at any depth
  under a `locale/`, `locales/`, `i18n/`, `lang/`, `translations/` or `messages/`
  folder
- editor and ignore files: `.editorconfig`, `.prettierrc` (also `.json`, `.yaml`,
  `.yml`), `.prettierignore`, `.gitignore`, `.gitattributes`

Every other file is `normal`. `.mdx` is normal because it compiles.

## `smugan risk`: forcing a level

```bash
smugan risk                                  # show the forced level, if any
smugan risk <trivial|normal|critical> [dir]  # force a level on the checkout
smugan risk auto [dir]                       # hand the decision back to the hook
```

- **Scope.** The override applies to the checkout that holds `dir`: the Git top level,
  or the folder itself outside a repository. While it lasts, every file in that
  checkout takes the forced level.
- **Duration.** 8 hours from the moment it is set (`OVERRIDE_HOURS = 8`). Expired
  overrides are deleted the next time any override is read.
- **`auto`.** It writes an `auto` record that also lasts 8 hours. That record lets
  the Stop tell an override cleared on purpose from one whose file was deleted.
- **Argument check.** A first argument that is neither a level nor an existing
  folder is rejected as a mistyped level, for example `crítico`.
- **Storage.** The override is stored at
  `<cache>/smugan/risk/<hash>.json`. `<cache>` is `LOCALAPPDATA`, `XDG_CACHE_HOME`
  or `~/.cache`; when `SMUGAN_CACHE_DIR` is set, the path is
  `SMUGAN_CACHE_DIR/risk/<hash>.json`. The hash is the first 32 hex characters of
  the SHA-256 of the lowercased, forward-slash checkout path.

When the forced level is lower than a file's own level, every end of turn warns the
user in a `systemMessage`. The warning lists up to 5 downgraded files, and the
downgrade is recorded for `smugan why`.

## Only the user lowers a level

Lowering the level skips tests and reviews, so only the user can do it. In Claude Code,
the `bash` hook refuses a `Bash` or `PowerShell` command (exit 2) when any of these
holds:

- the command names the forced-level folder, or the smugan cache folder above it, by
  its exact path. Windows, Git Bash (`/c/...`), `~/...` and `$HOME/...` spellings all
  count, and so does any `smugan/risk` path;
- the command contains `runRisk`;
- the command mentions `smugan` or `risk.mjs`, and also the word `risk`, and also one
  of `trivial`, `normal` or `auto`, anywhere in it.

The `pre` hook also refuses a `Write` or `Edit` into the forced-level folder. Raising
the level (`smugan risk critical`) and reading it (`smugan risk`) are never refused.
The refusal message asks the user to run the command in their own terminal, or with
`!` in Claude Code.

Other ways to delete the override file are not detected from the command text.
Instead, the hooks record in `smugan-session-<session>.json` each forced level they
see: at session start, before each shell command, on each edit and at each Stop. If
a level disappears before it expires and there is no `auto` record, the next Stop
that lets the turn end reports it to the user.
