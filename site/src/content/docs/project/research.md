---
title: Research and references
description: The studies and projects behind each design decision.
---

The design combines short rules in context with mechanical checks after them. The
main decisions rest on the references below:

- Anthropic: [memory and rules](https://code.claude.com/docs/en/memory),
  [hooks](https://code.claude.com/docs/en/hooks) and
  [best practices](https://code.claude.com/docs/en/best-practices);
- Supabase: [database testing](https://supabase.com/docs/guides/local-development/testing/overview)
  and [`supabase test db`](https://supabase.com/docs/reference/cli/supabase-test-db);
- Playwright: [locators based on what the user perceives](https://playwright.dev/docs/locators);
- OpenAI: [CriticGPT](https://arxiv.org/abs/2407.00215), on reviewing responses
  produced by models;
- Distyl AI: [IFScale](https://arxiv.org/abs/2507.11538), on the drop in adherence as
  the number of instructions grows;
- [ponytail](https://github.com/DietrichGebert/ponytail), a reference for short,
  imperative rules;
- [basejump/supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers),
  the MIT base of the pgTAP helpers incorporated into the templates;
- [Superpowers](https://github.com/obra/superpowers) 7.0.1 (MIT, Jesse Vincent). From
  it came, adapted and rewritten for Smugan:
  - the acceptance criteria, from brainstorming;
  - the fresh-context-per-task executor, from subagent-driven-development;
  - the rule testing cycle, from writing-skills;
  - the block for whoever receives the review, from receiving-code-review;
  - delivery, from finishing-a-development-branch;
  - `smugan why`, from diagnosing-superpowers;
  - the post-install smoke test.

### Using it with Superpowers

The two attack the same problem from opposite ends. Superpowers drives the process
before the code: intent, specification, plan and TDD. Smugan demands the evidence
afterwards: blocking, checks and review.

In Superpowers 7.0.1, the plugin registers only a `SessionStart` hook, and its skills
live in the `superpowers:` namespace. Smugan uses `PreToolUse`, `PostToolUse` and
`Stop`, with skills and agents under its own names, so there is no component with the
same name and no hook on the same event. When a brainstorming specification already
exists, `smugan-build` takes the criteria from it instead of interviewing the person
again.

Combining the two in the same session has not been measured yet.

### October 2026 review

Studies published after the original design confirmed the combination of short rules
with mechanical blocking and led to the adjustments below. Most are still preprints;
the Atlassian study appeared at ICSE 2026.

| Study | What it showed | What changed in Smugan |
|---|---|---|
| McMillan, [arXiv 2605.10039](https://arxiv.org/abs/2605.10039) | Across 1,650 Claude Code sessions, adherence to the rules file drops over the session (about 5.6% lower odds per generated function); rule size and position had no detectable effect | Confirms hook-based blocking instead of trusting the written rule |
| Gloaguen et al. (ETH), [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) | Context files do not raise the success rate and make runs more than 20% more expensive; they help when they describe non-standard practices | `CLAUDE.md` lost its generic lines and kept its own conventions |
| Zhong, Raghunathan and Carlini, [ImpossibleBench](https://arxiv.org/abs/2510.20270) | Over 79% of Claude models' cheating was editing the test; LLM-based monitors caught 42% to 65% of it on real tasks | New `assertion-weakening` rule at the end of the turn |
| Ma et al., [Building to the Test](https://arxiv.org/abs/2606.28430) | With access to the tests, agents deliver what is checked, not what was asked | `critic` requires the test to fail without the change, in a throwaway worktree, and checks the real entry point |
| Alexopoulos et al., [arXiv 2603.18740](https://arxiv.org/abs/2603.18740) | Telling the reviewer the code is correct drops detection (Claude Sonnet 4.5: from 97% to 75%); removing the PR description recovers some of the cases | Whoever calls the reviewer passes the original request, not the verdict; `critic` forms its findings from the diff |
| Tantithamthavorn et al. (Atlassian), [arXiv 2601.01129](https://arxiv.org/abs/2601.01129) | Over 12 months, 38.7% of the LLM reviewer's comments led to code changes, versus 44.5% of human comments | `critic` reports only what would lead to changing code: at most five findings, three of them LOW |
| Wataoka et al., [arXiv 2410.21819](https://arxiv.org/abs/2410.21819) | LLM judges favor text that seems familiar to them, such as what they generate themselves | Optional `SMUGAN_REVIEW_MODEL`; the default stays the conversation's model because the evidence for code is mixed |

### November 2026 review

Version 0.20 started verifying according to the change's risk, instead of applying
the same ceremony to everything. The studies below support the mechanism; attributing
each symptom (slowness, too many tests, stops, re-verification) to a specific Smugan
rule remains a hypothesis until the `evals/` A/B runs. Most are preprints or company
documentation.

| Study | What it showed | What changed in Smugan |
|---|---|---|
| Chen et al., [arXiv 2602.07900](https://arxiv.org/abs/2602.07900) | On SWE-bench Verified, resolved and unresolved tasks have similar test frequency; changing test volume via prompt, across 4 models, did not change the outcome significantly | The Definition of done replaces "green tests for everything" with one test that fails without the fix for a bug fix and one per new behavior, none for a reversible edit |
| Mündler et al., [SWT-Bench](https://arxiv.org/abs/2406.12952) (NeurIPS 2024) | Generated tests that fail before and pass after the fix work as a filter and double SWE-Agent's precision | The test that fails without the fix stays mandatory and `critic` still proves it in a worktree |
| Anthropic, [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Opus 4.5 and 4.6 respond more to the system prompt, and aggressive language ("CRITICAL: You MUST") meant to prevent undertriggering starts causing overtriggering | `CLAUDE.md` in a neutral tone; Claims stops telling the agent to distrust everything and accepts what the session ran as evidence |
| Huang et al., [arXiv 2310.01798](https://arxiv.org/abs/2310.01798) (ICLR 2024) | Without external feedback, models do not self-correct, and sometimes get worse after trying | Review and verification anchored in a command, test or reproduction; a finding that does not reproduce is dropped |
| Laban et al., [FlipFlop](https://arxiv.org/abs/2311.08596) | Challenged with "are you sure?", 10 models changed their answer in about 46% of cases and lost 17% accuracy on average | The instruction to re-check everything was removed: a run that already passed in the session is not repeated for confirmation |
| Sadowski et al., [Lessons from building static analysis tools at Google](https://cacm.acm.org/research/lessons-from-building-static-analysis-tools-at-google/) (CACM 2018) | Checks shown at review tolerate up to 10% effective false positives; checks that stop the build can have none | The end of the turn only holds on a gate rule or a script with a nonzero exit code: one block on an ordinary turn, two on a critical one |
| Petrović et al., [arXiv 2102.11378](https://arxiv.org/abs/2102.11378) | Mutation testing at Google runs only on changed and covered lines, with at most one mutant per line, and 82% of mutants with feedback were marked useful (later 89%) | Mutation and build are left to CI or on demand, never at the end of the turn, which shares a short timeout |
| Abreu et al. (Meta), [arXiv 2410.06351](https://arxiv.org/abs/2410.06351) | Gating the riskiest 5%, 10% and 50% of diffs captured 18.7%, 27.9% and 84.6% of incidents | Three risk levels decided by file path, with full rigor only for critical |
| Rajasekaran (Anthropic), [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) | A separate evaluator pays off when the task exceeds what the model solves alone and becomes cost without gain within that capability; each harness piece encodes an assumption to revisit with each model | `critic` and `flow-critic` only for a critical change or an ordinary diff over ~300 lines |
| Jin and Chen, [Are LLMs reliable code reviewers?](https://link.springer.com/article/10.1007/s10515-026-00638-5) (Automated Software Engineering, 2026) | LLM reviewers frequently flag correct code as defective, and more detailed prompts, especially those asking for explanation and a fix, increase the error | At most five findings per review, three of them LOW, each reproduced by its own `verify` |

The earlier prototype, [`gate`](https://github.com/DenisCDev/gate), defined the first
separation between rules, blocks and proof. Smugan kept that idea, removed the
mandatory per-project toolchain and focused the engine on checks that work without
installing dependencies.

### November 2026 review: code quality

The second November round asked what improves the quality of the agent's code per
token spent, without reading the diff. The evidence points to three things: the
installed version's context always present and compact, deterministic verification
at the end of the turn with a cap on rounds, and mechanical removal of what the
agent's search left behind. Generic quality prompts and open-ended reviewers cost a
lot and barely change the outcome. Almost everything below is a preprint or company
document, and none of the changes has run in a real session yet.

| Study | What it showed | What changed in Smugan |
|---|---|---|
| Vercel, [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) (vendor document) | An 8 KB index of the installed Next.js docs, always in context, took the Next 16 API evals from 53% to 100%; the same information as a skill stayed at 53%, because it was not invoked in 56% of cases | `smugan context` generates the index of the installed version's docs, and the `pre` hook delivers it on the first edit of a file covered by a stack rule, once per session and per package |
| Vercel, [How Next.js supports AI coding agents](https://nextjs.org/docs/app/guides/ai-agents) (vendor document) | Next.js started shipping the version's docs inside the package | The index points to `node_modules/next/dist/docs`, which on this machine already exists in `next@16.2.10` and does not exist in 16.0.10 |
| "When LLMs Lag Behind", [arXiv 2604.09515](https://arxiv.org/abs/2604.09515) (preprint) | Across 270 real API updates, only 42.55% of code generated without documentation runs in the target environment; with structured documentation, 66.36% | The same index, with the paths to the installed version's docs and the sentence "Prefer what these docs say over what you remember about the version." |
| "On Mitigating Code LLM Hallucinations with API Documentation", [arXiv 2407.09726](https://arxiv.org/abs/2407.09726) (preprint) | The API signature alone yields 86.82% valid calls, versus 88.75% with the full doc, which costs 13× more tokens; irrelevant retrieval makes frequent APIs worse | The index carries the `.d.ts` signatures of what the file imports and never the body of a doc, capped at ~2k tokens |
| TRIM, [arXiv 2607.18161](https://arxiv.org/abs/2607.18161) (preprint) | In patch minimization on SWE-bench Verified, the removed files were repro scripts (49.6% of removed lines) and build/config changes (35.8%), with hidden correctness preserved in 99.1% | The end of the turn lists, once and without deleting, a new script nothing references and changed config that neither the contract nor the request mentions (`exploration-residue`) |
| CodeThread, [arXiv 2606.21804](https://arxiv.org/abs/2606.21804) (preprint) | Building on agent code reduced resolution of the next task by up to 13.1 points; the predictor was drift in the input and error contract (OR 1.83), which survived in 85.9% of cases, and cyclomatic, cognitive and Halstead complexity predicted nothing | `contract-drift` detector at the end of the turn, only on existing functions; a closed item in `critic`; no complexity limit as a block |
| RepoReuse, [arXiv 2609.35357](https://arxiv.org/abs/2609.35357) (preprint) | Across 3,000 turns, agents left duplicated logic in 50.8% of chains by turn 5, with an almost unchanged pass rate | Type 1 and 2 `clone` detector at the end of the turn, with an incremental index and a 500 ms cap |
| PerfAgent, [arXiv 2607.19653](https://arxiv.org/abs/2607.19653) (preprint) | Profiler feedback in the loop doubled the patches matching the expert (19.6% → 39.2% on GSO; 26% → 74% on SWE-fficiency-Lite); merely instructing the agent to use the profiler stayed at 16.7%, a figure the report took from a secondary source | In `smugan-build`, a performance task measures before and after, in up to 3 rounds; a critical change to a handler gets a query-count criterion; `await-in-loop` in `pre`, only on critical turns |
| PERFOPT-Bench, [arXiv 2607.07744](https://arxiv.org/abs/2607.07744) (preprint) | Raw speedup is an unsafe metric: part of the large gains comes from shortcuts that exploit the benchmark | The measured round ends with the suite green, and the N+1 task in `evals/` uses a hidden volume |
| Cost-Aware Text-to-SQL, [arXiv 2512.22364](https://arxiv.org/abs/2512.22364) (preprint) | Partition filters are missing in up to 50% of generated queries, and cost varies up to 3.4× between models | The "the listing has a limit" criterion enters the contract for a critical change to a listing |
| Stripe, [Minions, part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) (engineering post) | Deterministic nodes (lint in under 5 s) interleaved with agentic ones; CI stays at 2 rounds due to diminishing returns | The new detectors are deterministic and each finding appears once; the end of the turn keeps 1 block on an ordinary turn and 2 on a critical one |
| Anthropic, [code-simplifier](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) (vendor document) | The Claude Code team uses an agent to simplify the changed code at the end of the session; no effect figure is published | End-of-session cleanup becomes a mechanical check (residue and clone), with no extra model pass |
| SlopCodeBench, [arXiv 2603.24755](https://arxiv.org/abs/2603.24755) (preprint) | Structural erosion rises in 80% of trajectories; the anti-slop prompt with a concrete list cuts about 1/3 of the initial verbosity, without changing the slope or the pass rate, and cost +47.9% on GPT 5.4 | The gotchas block became a measured draft (`evals/drafts/gotchas.md`, `claude-md-gotchas` scenario), outside the installed `CLAUDE.md` |
| Kadam, [arXiv 2610.38977](https://arxiv.org/abs/2610.38977) (preprint) | A quality prompt in a single call did not reduce analyzer issues in any of 4 models; an agentic reviewer does not beat best-of-n at equal budget; an analyzer loop run until zero drops pass@1 by up to 9.94 points | No new generic quality sentence in `CLAUDE.md`; `critic` keeps a closed checklist |
| CodeRabbit, [arXiv 2607.03316](https://arxiv.org/abs/2607.03316) (preprint) | Across 31k comments, 56.3% of the agentic reviewer's suggestions were rejected; among them, 43.3% were false positives and 23.7% intentional trade-offs | `critic` dropped design and organization findings that lack a written repository norm, and a finding without an executable `verify` is discarded |
| Goldman et al., [What Types of Code Review Comments Do Developers Most Frequently Resolve?](https://www.researchgate.net/publication/396291600_What_Types_of_Code_Review_Comments_Do_Developers_Most_Frequently_Resolve) (ASE 2025, peer-reviewed) | Design comments were resolved in 28.6% of cases, versus 43.3% for readability ones | LOW in `critic` now requires a cited norm the repository writes down |
| SWE-Shield, [arXiv 2604.05955](https://arxiv.org/abs/2604.05955) (preprint) | Patches that pass the tests satisfy the repository's design constraints in only 32.64–50.20% of cases, and giving the agent the issue's constraint barely changes that | What counts as a design finding in `critic` is the norm the repository writes down, not the reviewer's preference |

Left out for lack of evidence, to be measured in the harness before any adoption: the
gotchas block itself, tested only on OpenAI models; counting queries as an agent
guard, which no study measures; waterfall and re-render detection in React/Next; a
symbol map of the touched module to increase reuse; and replicating each figure above
on Opus and Gemini, since PerfAgent ran only on GPT-5.1 and the Vercel eval does not
state a model.

The full report, with the table by dimension, what not to add and the quality of each
source, is in [docs/senior-quality.md](https://github.com/DenisCDev/smugan/blob/main/docs/senior-quality.md).
