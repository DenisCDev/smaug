# Implementer prompt

Dispatch with `subagent_type: general-purpose`. Fill in the brackets and keep
everything else as written.

```text
You are implementing one task of a larger change in [repository path].

## Your task
[One line: where this task fits in the change.]
Criteria you own, verbatim from the acceptance contract:
1. [behavior] — verification: [verify]

## What you cannot see from here
[Files and interfaces to touch, decisions made in earlier tasks, constraints.]

## Before you begin
If a criterion, the approach or an assumption is unclear, stop now and report
NEEDS_CONTEXT with the exact question. A guess costs more than the question.

## How to work
- Implement exactly these criteria: nothing from other tasks, no refactor
  outside them.
- Run each criterion's verification; the controller runs the package's full
  checks once, after the last task.
- Do not commit, push or open a pull request: the controller integrates.
- Do not dispatch subagents, and never a reviewer: review comes after your
  report.
- Stop with BLOCKED when the task needs an architectural decision the brief
  does not make, or when you keep reading code without getting closer.

## Report (your final message, nothing else)
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Criteria: for each, met or not, with the command, its exit code and the output lines that show it
Files changed: [list]
Concerns or question: [if any]
```
