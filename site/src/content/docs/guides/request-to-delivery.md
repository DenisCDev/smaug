---
title: From request to delivery
description: Acceptance criteria, per-task execution, review handling and delivery.
---

Four pieces cover what comes before the code and what comes after verification. They
are adaptations of [Superpowers](https://github.com/obra/superpowers) (MIT) workflows
to Smugan's approach: less conversation and more evidence, assuming a person who may
not be following along.

**Acceptance criteria before code.** When the request leaves the outcome open,
`smugan-build` states in one or two lines, before the first edit, what it will treat
as done and what it decided on its own. For a critical change with an open outcome,
it writes and saves a contract of 3 to 6 criteria, each with a way to verify it. It
only asks about what is the person's decision and does not wait for approval. A clear
request, such as "rename X to Y", needs neither.

The pre-write hook reminds the model on the first edit of a critical file in the
session. Critical is decided by path, never by the model: migrations and `.sql`,
`middleware`/`proxy` (file or folder), names such as `auth`, `authorization`,
`session`, `login`, `password`, `jwt`, `token`, `role`, `permission`, `guard`,
`policy`, `billing`, `checkout`, `stripe`, `webhook`, env and secret files,
`package.json` and `Cargo.toml`, and Rust with `unsafe`. Files that do not change
what the code does (prose, styles, images, fonts, translation catalogs) are trivial,
and the rest is normal. `smugan risk <level>` forces the checkout's level for 8
hours; when it downgrades a file, every end of turn warns the person. The reminder
says why the file is critical, asks for the contract when the project has none in
progress and mentions `critic`. When every criterion of the existing contract is
done, it asks to check with `smugan contract` before replacing it, because the
contract may belong to another session. An unreadable contract also triggers a
reminder, and `--set --replace` or `--clear` resolve it. It appears once per session
and per project and never blocks the write. Only Claude Code gets the reminder; the
adapters do not.

The contract is stored outside the repository, one per checkout. It is not per
session because the agent does not know its own session id, and the reviewers, which
are other subagents, need to find the same file. So that a second session or a new
task does not wipe out another's progress, `--set` refuses to replace an existing
contract without `--replace`. `done` and `blocked` require the evidence. `critic` and
`flow-critic` read the contract on their own and review the diff against it, instead
of reconstructing intent from the code they are judging.

```bash
smugan contract --set contract.json     # quoted request, {behavior, verify} criteria, out of scope, decisions
smugan contract --mark 2 done --evidence "npm test -- shipping → 12 passed"
smugan contract                         # what is left, and the evidence for what is done
```

The `smugan …` commands in this section and the following ones use the command
`install.sh` puts in `~/.local/bin`. With the folder off `PATH`, use
`node packages/gate/bin/smugan.mjs …`; agents find that path on their own, through
the installation's `smugan.paths.json`.

**A fresh context per task.** Adherence to instructions drops over the course of a
session. When the contract has criteria in separate parts of the code, each task goes
to a new subagent that receives only what it needs. The main agent checks each
criterion by running the verification itself. The contract serves as the progress
record and survives compaction.

Subagent edits go through the same hooks and enter the same end-of-turn
verification. This was verified on Claude Code 2.1.316: a subagent's edit lands in
the main session's turn state.

**Review findings are not accepted blindly.** Every `critic` and `flow-critic` report
ends with instructions for whoever receives it:

- reproduce each finding before fixing;
- reject, with the command output, a finding that does not reproduce;
- hand back to the person anything that conflicts with one of their decisions;
- report each finding as fixed, rejected or accepted.

**Delivery through a single path.** When the person asks to ship the work, the
`smugan-finish` skill picks the path from their words and the repository's convention
(PR history or direct commits). It executes that path and reports the real CI status
after the push, including when CI has not even started. Discarding work requires an
explicit request and confirmation of what will be lost. Commit and push still happen
only when the person asks.
