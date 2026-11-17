---
title: How Smugan compares
description: Smugan next to rules files, linters in CI, AI code review bots and Superpowers, and when each one is the better tool.
---

Most ways of keeping an AI coding agent honest act either before the work (instructions) or after it (CI, review). Smugan acts during the agent's own turn, at three points: before a file is written, right after the write, and before the turn is allowed to end. That position is the whole difference: a problem is caught while the agent can still fix it, before anyone has to review it.

## At a glance

| Approach | When it acts | Can it stop a bad change from being written? | What it relies on |
|---|---|---|---|
| Rules files (`CLAUDE.md`, `AGENTS.md`) | Before the work, as instructions | No: the agent may or may not follow them | The model's adherence |
| Linters and tests in CI | After a commit or pull request | No: the change already exists | The project's own tools |
| AI code review bots | After a pull request is opened | No | A model's opinion on the diff |
| Smugan | Before the write, after the write, at the end of the turn | Yes: the write is refused and the file is left untouched | Deterministic checks plus the project's own tools, then reviewers held to reproducible findings |

## Rules files alone

Rules files say what the agent should do. They are still useful, and Smugan installs one. But a written rule is a request: across 1,650 Claude Code sessions, adherence to the rules file dropped as the session went on ([McMillan, arXiv 2605.10039](https://arxiv.org/abs/2605.10039)). Smugan turns the rules that can be checked mechanically into hooks that refuse the write, so they hold on the last edit of a long session as well as on the first. See [What is checked](/start/introduction/#what-is-checked).

## Linters and tests in CI

CI runs your tools after the change is committed, often after the agent has finished and handed the work back. Smugan runs the same tools, your `lint`, `typecheck` and the tests related to the touched files, inside the turn, and holds the end of the turn while they fail. The agent fixes the problem itself instead of leaving it for a CI run and another round. CI stays: Smugan never runs a full build or mutation testing at the end of a turn, and leaves those to CI. See [How completion is verified](/guides/completion/).

## AI code review bots

A review bot reads a pull request and gives an opinion. Smugan's own checks are deterministic: a block names the file, the line and the rule, and the same input always gives the same answer. For what a pattern cannot prove, Smugan launches separate reviewers, `critic` and `flow-critic`, only for critical changes or large diffs. They read the diff against the original request and the acceptance criteria, never against the author's summary, and every finding must come with a way to reproduce it; one that does not reproduce is dropped. The reasons are measured: in one study, 56.3% of an agentic reviewer's suggestions were rejected ([arXiv 2607.03316](https://arxiv.org/abs/2607.03316)), and telling a reviewer that code is correct lowers what it finds ([arXiv 2603.18740](https://arxiv.org/abs/2603.18740)). See [Rules, agents and skills](/reference/rules-and-agents/).

## Superpowers

[Superpowers](https://github.com/obra/superpowers) and Smugan work on the same problem from opposite ends, and they combine. Superpowers drives the process before the code: intent, specification, plan and test-driven development. Smugan demands the evidence afterwards: blocking, checks and review. They register on different hook events and use different names, so they do not collide, and `smugan-build` reuses an existing Superpowers specification instead of asking again. Running both in one session has not been measured yet.

## What else is different

- **It works across agents.** The same engine runs in Claude Code, Codex, OpenCode, Antigravity and Grok Build; each adapter documents exactly what that platform lets a hook block. See [Other coding agents](/adapters/).
- **It knows the installed versions.** Before a change, `smugan context` reads the versions the project actually installs and gives the agent the index of that version's docs, instead of what the model remembers. See [Version context](/reference/version-context/).
- **It needs nothing extra to run its checks.** The engine reads files from disk: no network, no API key, no model tokens and no project toolchain for its own rules.
- **It costs less on small changes.** Verification follows the change's risk: a typo gets no reviewer, a migration with access rules gets the full treatment. See [Risk levels](/reference/risk-levels/).
- **It is open source.** MIT licensed, with the reasons for each rule and the studies behind them in [Research and references](/project/research/).

## When Smugan is not the right tool

- **You want a full static analyzer.** The engine uses a tokenizer and regular expressions and favors precision, so an ambiguous pattern may pass. Keep your linters and type checker; Smugan runs them for you.
- **You need cross-module guarantees.** Most rules look at one file at a time; decisions that span modules are left to the reviewers and your tests.
- **Your agent writes files outside the tools the platform observes.** Those writes may not go through the gate before they happen; on Claude Code they are still seen at the end of the turn.

The complete list is in [Known limits](/project/known-limits/).
