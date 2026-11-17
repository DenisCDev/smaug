# Version-aware context validation

The verifiable contract lives in the subprocess, temporary-install and
concurrency tests. Run from the checkout:

```sh
npm ci --ignore-scripts --prefix packages/gate
cd packages/gate && node --test
```

Also run `node --test` in each adapter directory. The `ci` workflow covers
Linux and Windows on Node 22 and 24, plus strict checkJs and the gate itself.
No existing test was removed to shrink the suite.

## Exercised guarantees

- Resolutions by owner/importer, lockfile conflicts, prereleases and distinct
  installed versions; configs never executed and secrets never copied.
- Cross-process cache, mtime-independent hashes, added/removed apps, concurrent
  writes, invalid format, collisions, junctions and local exclusion.
- A disposable copy of the resolver is instrumented to fail: the valid cache
  keeps working and `--refresh` hits the error, proving which path was used.
- Researched decisions persisted per version/target/environment, curated sources,
  invalidation, review after 30 days, concurrency and retention warning.
- Hooks with 120 concurrent events, checks during new edits, visible
  unavailability and attempt limits; composition of adapter messages.
- Real installers in temporary directories, including Git Bash/Claude, custom
  paths, complete guides and preservation of third-party content.

## Limits of the evidence

The installer/hook tests do not certify that the model adheres automatically in
every session. The evaluation attempt inside Codex CLI on this machine had its
read commands refused by policy (`blocked by policy`); the Claude Code CLI was not
available. Full activation and enforcement on those two hosts need a smoke test
in an environment where execution works. The contextual evaluation of the guides
and the installer contracts are evidence separate from that certification.

Guides describe conditional practices; they do not claim that every combination
of frameworks, databases, providers and versions was executed. Deployment,
restore, RLS, telemetry and performance need the appropriate proof in the
project that uses them. No production system was changed as part of validating
Smugan.
