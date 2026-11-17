---
title: Testing the rules themselves
description: The evals harness that measures each rule with and without it.
---

A Markdown rule is a claim that it changes what the agent does. The harness in
`evals/` measures this the way Superpowers measures its own skills: the same request
runs in a real Claude Code session with the rule and without it. The metric is what
the gate counts without relying on opinion: how many times the hook blocked on the
scenario's rules and how many violations remained in the delivery. For behavior the
gate cannot see, such as `critic` finding a planted authorization flaw, the scenario
defines two patterns: what the reply must say and what disqualifies it. On its own,
"found the flaw" also matches "there is no flaw".

```bash
node evals/run.mjs --scenario all --dry-run       # what would run
node evals/run.mjs --scenario db-naming --reps 3  # real sessions: costs tokens
```

Each session uses its own `CLAUDE_CONFIG_DIR`, installed by `install.sh`, and
therefore needs `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
`ANTHROPIC_API_KEY`. Results go in `evals/results/`, outside Git.

CI runs the whole harness with a fake `claude`, without tokens: real installation,
real rule removal, real project and `smugan check` on the delivery.

To compare two Smugan versions, `--tasks` runs ordinary coding requests, without
`/smugan`, in this checkout and in a Git ref installed by that ref's `install.sh`.
Each task in `evals/tasks/` has a level (trivial, normal, critical or LLM code) and a
hidden suite that only enters the project after the session: if it fails, the
delivery shipped a defect. The harness measures wall time, cost, stops (end-of-turn
blocks and agent questions), tests added and, in the LLM tasks, how many times the
agent's tests tried to use the network, which is turned off. At the end, it prints
the decision rule: time and cost drop by 25% or more, stops drop by 50% or more,
tests in the LLM tasks drop by 50% or more with no network calls, no additional
escaped defect in critical and at most one more in twenty in trivial and normal.

```bash
node evals/run.mjs --tasks all --baseline main --reps 3   # real sessions: costs tokens
```

A few tasks do not catch subtle differences: the result indicates direction. A new
task is a JSON file in `evals/tasks/` and two folders in `evals/fixtures/`, the
project and the hidden suite. Check that the suite fails on the project without the
fix. With `prompts` instead of `prompt`, the task runs several requests in separate
sessions on the same project, like a PR that builds on the previous one; time and
cost add up across sessions.

A scenario can remove a single item from an installed file (`"items":
["agents/critic.md#Contract drift."]`, by its bold label) and can measure a rule that
is not installed yet: `draft` applies a text from `evals/drafts/` only in the arm with
the rule, and the other arm is the installation as it is. With `"addedLines": true`,
the scenario counts the lines the session added. The SlopCodeBench gotchas block is
set up like this:

```bash
node evals/run.mjs --scenario claude-md-gotchas --reps 3   # real sessions: costs tokens
```

The project skill `.claude/skills/smugan-rules` drives any rule change in this
repository through the Superpowers writing-skills cycle:

1. a scenario that fails without the rule;
2. the smallest text that solves it, in the narrowest possible place;
3. the round that closes the loopholes;
4. the numbers from both arms in the CHANGELOG.
