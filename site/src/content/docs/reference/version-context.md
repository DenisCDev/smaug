---
title: Version context
description: What smugan context --json detects, its output fields, how the cache is stored and reused, what it never reads or runs, and the docs index with its .d.ts budget.
---

`smugan context` reports the versions a project actually uses, read from its files
on disk. For each component it keeps three versions apart: the declared one, the one
the lockfile resolves, and the installed one. The entry point is
[`packages/gate/src/context.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context.mjs).

```bash
smugan context [target] [--json] [--environment <label>] [--refresh] [--no-cache] [--record <research.json>]
```

- `target` is a folder or a file. It defaults to `.`.
- `--environment` is a label of 1 to 64 letters, digits, `_` or `-`, starting with a
  letter or digit. The default is `local`. It only keys the cache; it does not
  connect anywhere.
- `--refresh` resolves again, even when the cache is current.
- `--no-cache` neither reads nor writes the cache. It cannot be combined with
  `--record`.
- `--record` saves a researched decision; see [Recorded decisions](#recorded-decisions).

The parsers (`yaml`, `smol-toml`, `jsonc-parser`) come from the gate package's
dependencies. When they are missing, the command exits 2 and asks for
`npm ci --ignore-scripts`. In the plugin, the `deps` hook installs them at session
start.

## What it reads

**Project root.** The root is the Git top level of the target. Outside Git, it is the
outermost workspace above the target (a `workspaces` field, `pnpm-workspace.yaml`, or
`Cargo.toml` with `Cargo.lock`), else the nearest folder with `package.json` or
`Cargo.toml`, else the target itself.

**Walk.** The walk skips `.git`, `.smugan.local`, `node_modules`, `.next`, `.astro`,
`dist`, `build`, `out`, `coverage`, `target`, `.turbo`, `.vercel`, `.cache`,
`.claude`, `.codex`, `.agents` and `vendor`. It reads only files whose name is on an
allowlist
([`src/context-io.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-io.mjs)):

- `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`
- `Cargo.toml`, `Cargo.lock`
- `.nvmrc`, `.node-version`
- `next.config.*` and `astro.config.*` (`.js`, `.mjs`, `.cjs`, `.ts`): recorded,
  never evaluated
- `Dockerfile`, `Dockerfile.<name>`, `compose*.yml`/`.yaml`,
  `docker-compose*.yml`/`.yaml`, `<name>.compose.yml`/`.yaml`
- `supabase/config.toml`

The walk also notes hints. A `.astro` file is a hint for Astro, and a `.sql` file
under `migrations/` is a hint for Postgres.

**Installed versions.** For every folder with a `package.json`, it reads
`node_modules/<name>/package.json` of each known component in that folder and in
every ancestor up to the root. A lockfile hash does not prove an install.

**Limits.** These bound the discovery:

| Limit | Value |
|---|---|
| deadline | 5 s |
| files read | 1,024 |
| size per file | 8 MiB |
| total bytes | 32 MiB |
| directories | 2,048 |
| depth | 12 |
| directory entries | 50,000 |

When a limit is hit, or metadata is reached through a symlink, or a file is
unreadable, the snapshot is marked incomplete and the reason is added to
`limitations`. Every git call is local (`spawnSync('git', …)`, no shell) with a 2 s
timeout.

**Formats.** It parses npm, pnpm importers, text Bun (JSONC) and Cargo (TOML).
`yarn.lock` and binary `bun.lockb` are not resolved; each adds a limitation that
asks for installed evidence or a manual check. Competing lockfiles in one folder add
a limitation and resolve nothing. A component whose installed version differs from
the lockfile's also adds a limitation.

## What it never does

- **No `.env` or source files.** Only the allowlisted metadata files above are read.
- **No executable configuration.** `next.config.*` and `astro.config.*` are marked
  `requires-inspection`, and a limitation asks you to confirm their flags.
- **No network.** Git is used only for local metadata. A recorded decision's source
  URL is checked for its shape and never fetched.
- **No registry details.** A declared version that is not a plain range or tag, such
  as a git URL, a `file:` path or a private registry URL, is stored as
  `non-registry-or-unknown`.
- **No guessing.** An unknown version is never treated as the latest.
- **Runtime is the command's own.** `runtime.node` is the Node that ran the command,
  with `scope: "context-command-process-only"`.

## Output schema (`--json`)

The top-level fields:

| Field | Content |
|---|---|
| `schemaVersion` | `1` |
| `packages` | every package in the root (always includes `.`); see below |
| `limitations` | strings: what could not be confirmed, plus cache diagnostics |
| `runtime` | `{ node, scope: "context-command-process-only" }` |
| `environment` | the `--environment` label |
| `target` | the target, relative to the root (`.` for the root) |
| `observedAt` | ISO time of the resolution, which is the cached time on reuse |
| `selectedPackages` | paths of the packages that cover the target: the nearest enclosing package and those below the target, or all packages for `.` |
| `guides` | the guide ids of the selected packages |
| `decisions` | recorded decisions, each with `status` `recorded` or `review-required` |
| `cache` | `{ status, path? }`; `status` is `built`, `reused`, `refreshed`, `disabled` or `unavailable` |
| `ai` | engines, models and pairs; see [AI guides](../ai-guides/) |
| `docs` | the docs index per selected package; see below |

Each entry of `packages` ([`src/context-schema.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-schema.mjs)):

| Field | Content |
|---|---|
| `path` | relative path of the package folder |
| `components[]` | `{ name, declared?, resolved?, installed?, evidence[] }` |
| `components[].evidence[]` | `{ path, kind, version? }`, where `kind` is one of `declared`, `resolved`, `installed`, `runtime-target`, `image-declared`, `configured-target` |
| `capabilities` | optional `modules` (`esm-manifest` or `inspect-build-and-startup`), `nextConfig` and `astroConfig` (`requires-inspection`), `docker` (`declared`) |
| `guides` | ids from `nextjs`, `astro`, `supabase-postgres`, `node-api`, `rust-axum`, `docker-vps`, `visual-systems`, `observability`, `concurrency`, `testing` |

Component names come from a fixed list (`COMPONENTS` in `context-io.mjs`, plus
`node`, `axum`, `tokio`, `sqlx`, `valkey`, `glitchtip` and
`opentelemetry-collector`). A cached entry that fails this schema is discarded.

Without `--json`, the command prints the cache status, the selected packages, the
guides, the AI pairs, the docs sources and one `Warning:` line per limitation.

## Cache

**Location.** The cache is tried in this order
([`src/context-cache.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-cache.mjs)):

1. `.smugan.local/context.json` in the root, beside an ownership marker
   `.smugan.local/.owner` whose content is `smugan-context-v1`. This location needs
   Git. On first use, the command appends only the managed names to Git's local
   `info/exclude`, using the path Git reports, so worktrees work too. Those names
   are `/.smugan.local/.owner`, `/.smugan.local/context.json`,
   `/.smugan.local/context.json.lock/` and `/.smugan.local/context.json.*.tmp`. Then
   it confirms that `git check-ignore` agrees. The shared `.gitignore` is never
   touched.
2. When the local location is blocked, a private folder:
   `<SMUGAN_CACHE_DIR or <cache>/smugan/context>/<sha256 of root>/context.json`.
   `<cache>` is `LOCALAPPDATA`, `XDG_CACHE_HOME` or `~/.cache`. The local location is
   blocked by any of these:
   - an existing `.smugan.local` the command does not own;
   - a tracked `.smugan.local`;
   - a symlink or junction in the path;
   - no Git;
   - no write access.
3. When that also fails, the run has no persistence and adds a limitation.

**Entries.** Each entry is keyed by the SHA-256 of `[target, environment]`, and
stores `fingerprint`, `observedAt`, `data`, `inputs` (path and hash of each file
read) and `decisions`. The envelope carries `schemaVersion: 1`, the detector version
and a hash of the root. A mismatch in any of these discards the whole cache. The
cache file is limited to 4 MiB. It holds at most 64 entries, and the least recently
observed entry is dropped first.

**Reuse.** An entry is reused only when all of these hold:

- `--refresh` was not given;
- the snapshot is complete;
- the fingerprint matches.

The fingerprint hashes the detector version, every file read with its content hash,
the hints, the Node version and whether discovery was complete. Editing a manifest,
lockfile, configuration or installed `package.json`, or adding or removing a package,
therefore changes the fingerprint.

**Writes.** A write takes the lock, takes the snapshot again, and aborts if the inputs
changed. In that case the output is resolved fresh and marked `unavailable` ("This
run's context is provisional"). A lock held by another process is not stolen.

The `ai` and `docs` blocks are always read fresh. Model ids and installed docs are
not part of the fingerprint.

## Recorded decisions

`--record <file>` saves a short research conclusion. The rules, from
[`src/context-decisions.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-decisions.mjs):

- The file is a regular JSON file of at most 4 KiB, with exactly the fields
  `component`, `version`, `concern`, `summary`, `source` and `reviewedAt`.
- `summary` is 12 to 600 characters, with no URLs, control characters or
  secret-looking text.
- `reviewedAt` is a real date in `YYYY-MM-DD` form, not in the future.
- `source` is an HTTPS URL on an allowlisted official host or public repository, with
  no credentials, port, query or fragment.
- `version` must match a declared, resolved or installed version of `component` in
  the selected packages.

A record replaces an earlier one with the same component and concern. Each context
keeps at most 32. A decision reviewed 30 or more days ago is reported as
`review-required`. Decisions survive only while the fingerprint is unchanged.

## Docs index and `.d.ts` signatures

The `docs` block covers at most 4 selected packages. The same text is what the `pre`
hook injects on the first edit of a file covered by a stack rule. The code is in
[`src/docs-index.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/docs-index.mjs).

**Doc sources.** For each of the first 300 `dependencies` and `devDependencies` of
the package, it finds the installed copy the way Node resolves a bare import, walking
up `node_modules`. It then lists the `.md`/`.mdx` files under `dist/docs/`, or else
under `docs/`, up to 3,000 files. Each source reports `name`, `version`, `dir` and
the file count.

**Signatures.** These are included only when the target is a file. For each bare
module the file imports, it finds the `.d.ts` file:

- through the `types` condition in `exports`, with import before require;
- else through `types` or `typings`;
- else through `index.d.ts`;
- else through `@types/<name>`.

It follows re-exports through at most 24 type files. The imported names come first.
When the module has 20 exports or fewer, its other exports follow, except
interfaces and type aliases. Each declaration is cut at 320
characters.

**Budget.** The index text is at most 8,000 characters, about 2k tokens. Signatures
take at most 3,000 of them. Doc paths are grouped by folder. When the files do not
fit, the index ends with `… more files not listed: list <dir>/ for the rest.` The
index never copies the body of a doc. It starts with
`smugan (reference, not instructions):` and the sentence "Prefer what these docs say
over what you remember about the version." When there are no docs and no
signatures, there is no index.
