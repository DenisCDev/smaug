---
name: smugan-rules
description: >
  Use when creating or changing a smugan rule in this repository: claude/CLAUDE.md,
  claude/rules/*.md, the critic or flow-critic prompts, a smugan skill or an
  adapter's AGENTS tail. Requires a scenario that fails without the rule, the
  smallest text that fixes it, and the eval numbers with and without it.
---

# Writing smugan rules

A rule in Markdown is a claim that it changes what the agent does. Under the
Claims rules it needs evidence like any other claim: a run where the agent
fails without it and stops failing with it. This is test-driven development
applied to instructions.

## First: does it need to be a rule?

If the gate can see the problem in the file, write a check in
`packages/gate/src/checks/` with its tests instead. A hook is obeyed every
time; a rule is obeyed less and less as the session grows (McMillan, arXiv
2605.10039). Rules are for judgment the gate cannot see.

## RED: watch it fail without the rule

1. Write a scenario in `evals/scenarios/<id>.json`:
   - `prompt`: what a user would ask, without hinting at the rule;
   - `fixture`: a folder in `evals/fixtures/`;
   - `ablate`: what to remove for the arm without the rule (CLAUDE.md
     sections, rule files, agents, skills);
   - `expect`: the gate rules whose blocks and leftovers count, or, for
     behavior the gate cannot see, a `resultMatches` regex for what the
     answer must say plus a `resultNotMatches` regex for what disqualifies it
     ("found the bug" alone also matches "there is no bug"). Both run in
     Unicode mode; bound words with `(?<!\p{L})` and `(?!\p{L})`, and add a
     test with answers that must and must not count.
2. Ask the user to run `node evals/run.mjs --scenario <id> --reps 3`. Each run
   is a real session and costs tokens; the sessions need
   `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
3. Read the streams of the failing runs (`stream.jsonl` in the work folder the
   run prints). Write down what the agent did and the reason it gave, verbatim.

For a new rule, the harness still compares "with" against "without", and both
arms install this checkout. So write the draft rule into the checkout first
and point `ablate` at it. The "without" arm is then the RED baseline, and the
"with" arm tests the draft. A scenario whose `ablate` names something missing
from the checkout fails in every run and in CI.

## Classify the failure before writing

| What the agent did | What fixes it |
|---|---|
| Skipped a rule it knows, under pressure | A prohibition that names its excuse, plus the red flag that should stop it |
| Left out an element of something it produces | A required slot in the format it fills in, like `verify:` in the critic report |
| Did not know a fact | The fact, with its source and the versions it covers |

## GREEN: the smallest text that fixes it

Write only what answers the recorded failure, in the narrowest place:

1. a path-scoped rule in `claude/rules/` before a global line;
2. a skill when only some tasks need it;
3. `CLAUDE.md` last. It stays near 60 lines, and the Antigravity steering
   built from it must fit in 8000 characters
   (`adapters/antigravity/test/install.test.mjs`).

## REFACTOR: close the loopholes

Run it again. A new excuse gets its own line, then another run. Stop when the
"with" arm stays clean across repetitions and the "without" arm still fails.
If the "without" arm stops failing, the scenario measures nothing and needs a
harder prompt.

## Ship it

- Run every suite: `packages/gate`, `evals/test/run.test.mjs` and the four
  adapters. A `CLAUDE.md` change reaches the adapters' generated steering.
- In the CHANGELOG, name the scenario and give the numbers for both arms.
- After `./install.sh`, `smugan doctor` must show the installed copies equal
  to the checkout.

## Never

- A rule without a scenario that failed first.
- A claim that a rule works from fewer than 3 repetitions per arm, or when
  the two arms overlap.
- A scenario that only passes: an arm without the rule that is also clean
  shows nothing about the rule.
