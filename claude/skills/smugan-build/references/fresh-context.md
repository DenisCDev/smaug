# Fresh context per task

Use when the acceptance contract has criteria in separate parts of the code, or
the session is already long. You stay the controller: you own the contract, the
split and the integration. Each task runs in a new `general-purpose` subagent.
It loads the same CLAUDE.md and stack rules, and its edits pass through the same
smugan hooks and end-of-turn check as yours.

## Before the first task

- Split the contract into tasks: one per criterion, or per group of criteria
  that touch the same files. Order them so no task depends on code a later
  task writes.
- Note what a later task needs from an earlier one: names, signatures, files.
- Never run two implementers at once: they edit the same tree.

## Each task

1. Dispatch a `general-purpose` subagent with
   [implementer-prompt.md](implementer-prompt.md). Give it one line on where
   the task fits, the criteria it owns verbatim from `smugan contract`, the
   files and interfaces it touches, and the decisions from earlier tasks it
   cannot know. Never paste the session's history or other tasks' reports: a
   fresh context only helps while it stays small.
2. Pick the model by the task. A mechanical task with a complete spec can take
   a cheaper one; integration and judgment keep the session's.
3. Read the report every time.
   - **NEEDS_CONTEXT or BLOCKED:** answer, or split the task again, then resume
     the same subagent instead of starting a new one.
   - **DONE_WITH_CONCERNS:** read the concerns before moving on.
4. A criterion the report shows with its command, exit code and output is
   met; read `git diff --stat` for the task's files and record it with
   `smugan contract --mark <n> done --evidence "<command> → <result>"`. A
   criterion without them goes back to the subagent.
   - **A failing verification:** goes back to the same subagent with the
     output.
   - **No progress after two rounds:** decide yourself. Fix it here, split it
     again, or record it with `smugan contract --mark <n> blocked --evidence "<reason>"`.
5. Move on only when every criterion of the task is done or blocked with a
   reason.

## After the last task

Run every criterion's verification and the package's checks once, on the
integrated tree, then follow the Definition of done. Report per criterion:
done with its evidence, or blocked with the reason.

## After a compaction

The contract is the ledger. `smugan contract` shows which criteria are done and
with what evidence. Trust it and `git diff` over memory, and never dispatch
again a task whose criteria are marked done.
