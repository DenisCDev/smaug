---
title: How completion is verified
description: What runs at the end of the turn and how smugan why reports it.
---

At the end of the turn, Smugan:

1. re-analyzes the touched files and enforces only what the turn introduced. An old
   problem in a file that was merely edited does not block. On Claude Code, the
   files a Bash or PowerShell command changed in its repository during the turn
   count as touched, with what each carried before the turn as its baseline;
2. compares pre-existing tests against their version at the start of the turn, when
   the turn also touched production code: an assertion lost or loosened holds the
   turn, and a test or test file removed is listed once;
3. runs the project's `typecheck` (or `type-check`) script, with the package manager
   indicated by the lockfile: pnpm, yarn or npm;
4. runs `vitest related` with the touched files when Vitest is installed; without it,
   runs the `test` script. In a monorepo, that script runs only in the touched
   packages, up to three; beyond that, it runs the whole suite;
5. in a project where the turn only touched trivial files, does not run the tests;
   without a typecheck script, runs the project's `tsc` on the touched TypeScript
   files, one program per `tsconfig`, and enforces only errors the committed version
   did not have; a `tsc` that exits with an error without reporting any type error
   also holds the turn. During the turn, the write runs only the file's eslint;
6. lists, once per turn and without deleting anything, what the agent's search tends
   to leave behind: a new script no other file references, named `repro`, `scratch`
   or `debug` or loose at the root; a `package.json`, lockfile, `tsconfig` or build
   config changed without the acceptance contract or the person's latest requests
   mentioning it; a new `catch`, `?? value` or guard that makes an existing function
   return a default value where it used to fail; and a new function identical to
   another in the repository, up to names and literals, with the file and line of the
   one that can be reused. The agent decides what stays and says why;
7. returns all failures to the session;
8. holds the turn once when no touched file is critical, and up to twice when one is.
   Only a gate rule or a script with a nonzero exit code holds it; if files change
   during the checks, the same end of turn re-checks the new state once, instead of
   holding the turn.
   At the limit, the turn ends without the hook running the checks again: the agent
   shows its own green run. Where the host says which end of turn continues a hold (Claude
   Code, and Grok Build through its adapter), the limit is the held turn's own: what the next
   turn writes is checked even when that one was interrupted. On a later turn in which every failure has already used up
   its limit, the turn ends without a new block; a new failure blocks again.

Scripts run in at most two projects per turn, because they all share the same hook
timeout. A third project with scripts to run shows up as incomplete verification,
never as passed; projects with nothing to run do not take a slot. The full behavior,
with timeouts and state files, is in the
[engine documentation](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#hooks-via-installsh).

The end of the turn never runs a build or mutation testing. Scripts share the same
hook timeout, and when the timeout runs out Smugan fails open: the person waits and
nothing gets verified. Build and mutation are left to CI or to an explicit request.
An old `"stop": {"build": true}` no longer has any effect, and `smugan doctor` warns
about it.

A task that changed only Markdown does not trigger typecheck or tests, because those
commands would not change the result. MDX is still counted as code, since it takes
part in the application build.

To find out later what happened, run `smugan why` from inside the project. It shows
the most recent session that worked in that folder, or another with `--session <id>`:

- how the last end of turn that checked files finished, and whether there were turns
  without edits after it;
- which files were analyzed and which were left out, with the reason;
- which scripts ran and with what result;
- which projects had no scripts, and why;
- the session's recent blocks and internal failures.

Those internal failures are the ones that, under the fail-open policy, only show up
as a warning at the time. The records stay in the system temp folder for 7 days.
