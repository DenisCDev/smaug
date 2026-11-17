# Senior-level quality in agent code without reading the diff: what the 2025–2026 evidence supports for Smugan

What improves quality per token the most is not a quality prompt. It is three things: (1) context for the installed version, always present and compact; (2) executable, deterministic verification at the end of the turn, with a cap on rounds; (3) mechanical, test-validated removal of what the agent left behind. Generic "write like a senior engineer" prompts, multi-agent debate and open-ended reviewers are expensive and barely change the outcome.

## TL;DR

- **What moves the needle:** Vercel tested an 8 KB (about 2K tokens) docs index for the installed version kept always in context and went from 53% to 100% (+47pp) on Next.js 16 API evals. The same information packaged as a skill changed nothing (53%, +0pp), because it was not invoked in 56% of cases; it only reached 79% with an explicit instruction to use it (Vercel, "AGENTS.md outperforms skills in our agent evals", Jan 2026, vendor document). On performance, profiler feedback in the loop doubled the patches that match the expert: from 19.6% to 39.2% on GSO and from 26% to 74% on SWE-fficiency-Lite. PerfAgent also "surpasses an oracle best-of-five baseline at substantially lower cost", while merely instructing the agent to use the profiler stayed at 16.7% (Deng et al., arXiv 2607.19653, preprint). For concision, test-validated mechanical minimization (TRIM) removes 17.9–32.9% of the patch with no relevant loss of correctness. Asking the agent itself to minimize fails in 3.8–44.9% of cases.
- **What does not move it:** an "anti-slop" prompt cuts initial verbosity by about 1/3. However, it does not change how fast quality degrades, does not improve the pass rate and cost +47.9% on GPT 5.4 (SlopCodeBench). A single-call quality prompt does not reduce analyzer issues on any model (Kadam). Homogeneous multi-agent debate spends 2.1–3.4× more tokens for equal or lower accuracy. An open-ended agentic reviewer had 56.3% of its suggestions rejected in production (CodeRabbit, 31K comments).
- **For Smugan:** prioritize, in this order:
  1. A per-version docs index injected by the path-scoped rules, not only by the skill.
  2. Deterministic Stop checks for "exploration residue": repro scripts, config/build changes outside the contract, and exact clones of existing functions.
  3. High-precision detectors for the behavioral anti-patterns that actually predict future breakage: silent fallback, invented input gating, changed error handling.
  4. Performance as a cheap, contract-optional executable check (query count, `await` in a loop), not as prose.
  5. A `critic` with a closed checklist and no design opinions.

  Do not add: cyclomatic complexity limits as blockers, per-turn best-of-n, debate, uncapped loops, or any new prose rule without an A/B test.

## Key findings: measured state of the art (2025–2026)

**Concision and bloat**
- **SlopCodeBench** (arXiv 2603.24755, preprint, Mar 2026, v1):
  - Structural erosion rises in 80% of trajectories and verbosity in 89.8%.\[1\]
  - Agent code shows erosion of 0.68 versus 0.31 and verbosity of 0.33 versus 0.15 for maintained human repositories.\[2\]
  - Cost per checkpoint grows 2.9× over the trajectory.\[1\]
  - Later versions cited by third parties report 77%/75.5% and 2.3×; the numbers vary by paper version.\[3\]\[4\]
- **TRIM** (arXiv 2607.18161, preprint, Jul 2026, Columbia + Google): the cause of bloat is the agent's own search process. Speculative edits and abandoned hypotheses survive into the final patch.\[5\]
  - On SWE-bench Verified, the files removed by minimization were 100% repro scripts (49.6% of removed lines) and build/config changes (35.8%).\[5\]
  - 20.4% of source-code lines were also removed. Correctness on the hidden oracle was preserved in 99.1% (327/330).\[5\]
- **"Humans are Missing from AI Coding Agent Research"** (arXiv 2608.12355, preprint, Aug 2026):
  - Resolved patches are, on average, 2.38× the size of the gold patch.\[6\]
  - Two LLM judges attribute about 60% of the bloat to "verbose implementation" (unnecessary intermediate variables), 20–30% to excessive documentation and about 10% to over-engineering.\[6\]\[7\]
- **Luo et al./RECAP** (arXiv 2608.13292, preprint, Aug 2026; already known): across 28 systems on SWE-bench Verified, the patch is verbose even when it resolves the issue. For SWE-agent, total changes run +690.91% above the developer's patch.\[8\]
- **Nakashima et al.** (arXiv 2602.04226, preprint, Feb 2026): every PR rejection for size was of an agentic PR. In 67.9% of rejections there was no explicit reviewer feedback, so the agent does not learn from them.\[9\]\[10\]\[11\]
- **Watanabe et al.** (arXiv 2602.17091, preprint, Feb 2026): a notable share of generated functions is deleted during review. A model predicts these functions with an AUC of 87.1%, a sign that code "to cut" has detectable characteristics.\[12\]

**Performance**
- **SWE-fficiency and SWE-Perf** (already known): agents fall far short of the expert.\[13\]
- **PerfAgent** (arXiv 2607.19653, preprint, Jul 2026): agents miss bottlenecks hidden behind layers, stop at the first shallow gain and test little.\[14\]
- **PERFOPT-Bench** (arXiv 2607.07744, preprint, Jul 2026): raw speedup is an unsafe metric, because some of the large gains come from shortcuts that exploit the benchmark.\[15\]\[16\]
- **MicroPerf-Bench** (arXiv 2610.29695, preprint, Oct 2026): the dominant failure is not invalid code. It is correct changes that do not improve end-to-end performance, meaning the agent mislocates the bottleneck.\[17\]
- **Text-to-SQL with cloud cost** (arXiv 2512.22364, preprint, Dec 2025):
  - Partition filters are missing in up to 50% of applicable queries.\[18\]
  - Average cost varies up to 3.4× across models.\[18\]
  - It is the closest measured equivalent of an "unbounded query".
- **Abbassi et al.** (ICSME 2025, peer-reviewed, arXiv 2503.06327): a taxonomy of 19 inefficiency subcategories. Logic and performance are the most frequent and the ones that co-occur most.\[19\]

**Correct API for the version**
- **"When LLMs Lag Behind"** (arXiv 2604.09515, preprint, Apr 2026):
  - Basis: 270 real API updates across 8 Python libraries, tested with 11 models.\[20\]\[21\]
  - Without complete documentation, only 42.55% of the generated code runs in the target environment.\[20\]
  - With structured documentation, 66.36%. Even with the update spec in the prompt, old patterns persist.\[20\]\[21\]
  - Self-reflection adds about 11 points of executability.\[20\]
- **Wang et al. 2025**, cited in 2604.09515: deprecated API usage of 25–38% across 8 Python libraries.\[21\] I did not read the original.
- **"On Mitigating Code LLM Hallucinations with API Documentation"** (arXiv 2407.09726, preprint, 2024):
  - Injecting only the API specification (name + arguments, about 53 tokens) yields 86.82% valid invocations.\[22\]
  - The full documentation (about 685 tokens) yields 88.75%, that is, ~13× more tokens for +2 points.\[22\]
  - Irrelevant retrieval hurts frequent APIs: from 84.39% to 67.32% at 50% retriever precision.\[22\]

**Architecture and maintainability**
- **CodeThread** (arXiv 2606.21804, preprint, Jun 2026, NYU/CMU):
  - Design: 1,377 instances, 4 benchmarks and 4 models (Claude 4.5 Sonnet, GPT-5, GLM 4.7, MiniMax M2.5).\[23\]
  - Building on agent code lowers the resolution rate of the next task by up to 13.1 points. In refactoring, the average drop is 8.21 points.\[23\]
  - **Classic static metrics do not explain the difference:** cyclomatic and cognitive complexity, Halstead and LLOC of PR1 all gave p>0.27.\[23\]
  - The significant predictors were the agent's input/error contract drift (silent fallback, input gating, error handling; OR 1.83) and the size of the next edit (ΔLLOC; OR 1.88).\[23\]
  - The drift survives the next change in 85.9% of cases.\[23\]
- **RepoReuse** (arXiv 2609.35357, preprint, Sep 2026): over 3,000 turns, agents progressively stop exploring relevant code. They also reuse their own history less and leave duplicated logic in 50.8% of chains by turn 5, while the pass rate barely changes.\[24\] This is consistent with arXiv 2601.21276 (already known).\[25\]
- **SWE-Shield** (Yu et al., Fudan/NTU, arXiv 2604.05955, preprint, Apr 2026): 495 issues and 1,787 design constraints. Patches that pass the tests satisfy the repository's design constraints in only 32.64–50.20% of cases, with a violation rate of up to 45.85%. Providing the issue-specific constraint helps little: on Claude Sonnet 4.5, violations drop from 37.15% to 30.80%, and "residual violation rates remain above 30%".
- **Trivedi and Schmitt** (arXiv 2605.20049, preprint, May 2026, SonarSource authors, hence a conflict of interest):\[26\]
  - Design: 660 runs with Claude Code (Sonnet 4.6).\[27\]\[28\]
  - Cleaner code does not change the pass rate.\[26\]
  - It reduces tokens by 7–8% and file revisits by 34%.\[26\]
  - The quality gain pays off in the cost of future turns, not in immediate correctness.\[29\]

**Big tech and production**
- **Stripe Minions** (engineering post, part 2, Feb 2026): more than 1,300 PRs per week, all with human review.
  - "Blueprints" alternate deterministic nodes (lint, git) with agentic nodes.\[30\]
  - Local lint runs in under 5 s before the push. CI is limited to 2 rounds (initial push + 1 retry) due to "diminishing marginal returns".
  - There is no controlled measurement of non-functional quality.
- **Anthropic code-simplifier** (vendor): an agent the Claude Code team uses to simplify modified code at the end of a session or before a PR.\[31\]\[32\] No effect size has been published.
- **Google** (Goldman et al., "Resolving Code Review Comments with Machine Learning", and the Google Research post): "code-change authors at Google address 7.5% of all reviewer comments by applying an ML-suggested edit". In addition, 40–50% of previewed suggested edits are applied. The company traded suggestion volume for precision to raise acceptance.
- **Vercel/Next.js** (vendor): Next.js 16.3+ ships version docs in the package and manages AGENTS.md.\[33\] This makes the "docs index" a framework default.
- Meta (ACH, diff risk), Microsoft, Shopify, Cursor and Cognition: **I did not verify numbers in this research**. Treat as a gap.

## Table by dimension

Layer legend: Prose = prose rule; Pre = regex check in PreToolUse; Stop = check in the Stop hook; Critic = critic dimension; Build = smugan-build skill step; Contract = contract criterion; Eval = harness metric.

| Dimension | Measured defect | Intervention | Effect | Cost | Evidence | Layer in Smugan and why |
|---|---|---|---|---|---|---|
| Concision | Search residue: repro scripts, config and speculative edits (TRIM) | Test-validated counterfactual minimization | −17.9 to −32.9% of the patch; correctness preserved in 99.1% | ~9 validations per bug on average (2.6K jobs for ~293 bugs; max. 16) | Preprint, Gemini 3 Pro/Opus 4.5/Sonnet 4 | **Stop:** detect new unreferenced files (repro/scratch) and config/build changes outside the contract. It is deterministic, nearly free of false positives and covers ~85% of the lines removed on SWE-bench. Full hunk-level minimization stays outside the turn (expensive).\[5\] |
| Concision | Patch 2–7× larger than the human one | Post-generation RECAP | Changes from +242% to +4% vs. developer (report)\[34\] | 1 extra model pass | Preprint | **Eval** (measure before adopting). Do not use self-minimization without verification: it fails in 3.8–44.9% (TRIM). |
| Concision | Initial verbosity | Anti-slop prompt with a concrete list of "gotchas" | −33 to −34.5% initial verbosity; same slope; same pass rate\[2\] | +47.9% cost on GPT 5.4; 0% on 5.3 Codex\[2\] | Preprint, 2 OpenAI models | **Eval** first. If adopted, only the gotcha list (operational), never a persona. |
| Concision | Generic quality prompt | — | Does not reduce issues on any of 4 models\[35\] | Fixed tokens per turn | Preprint (Kadam) | **Do not add.**\[13\] |
| Performance | Mislocated bottleneck; stopping at the first gain | Profiler in the loop (PerfAgent) | 19.6→39.2% (GSO); 26→74% (SWE-fficiency-Lite); instruction alone: 16.7% | ~$2.88/task vs. $11.01 for oracle best-of-5 (secondary report) | Preprint, GPT-5.1 | **Build/Contract**, only when the task is about performance. Executable feedback beats prose.\[14\]\[36\] |
| Performance | N+1, `await` in a loop, waterfall | Syntactic detector for `await` inside `for`/`map` with a DB/fetch call | No study with agents | ~ms | Gap | **Pre** (high precision if restricted to known DB client/fetch calls). |
| Performance | Unbounded query | Check for `select` without `limit`/`range` in listings | Analogue: up to 50% without a partition filter | ~ms | Preprint (SQL analogue) | **Pre** only on listing-handler paths; otherwise it is noisy.\[18\] |
| Performance | False gain via shortcut | Measure with a hidden test and do not trust raw speedup | Shortcuts inflate speedup | — | Preprint (PERFOPT) | **Eval:** perf budget with a hidden fixture.\[15\] |
| Version API | Deprecated/hallucinated; only 42.55% executable without docs | Compact version docs index always present | 53%→100% (Next.js 16); default skill: +0 | ~2K tokens/session (cacheable) | Vendor, small suite | **Path-scoped prose** generated by `smugan context` (index, not content). A skill alone does not trigger.\[37\] |
| Version API | Wrong signature | Inject the spec (signature), not the full doc | 86.8% vs. 88.8% with 13× fewer tokens | ~50 tokens/API | 2024 preprint | **Build:** when resolving versions, extract the signatures from the `.d.ts` files in use.\[22\] |
| Version API | Old patterns persist even with docs (66%)\[21\] | Project type-check and build | Catches what does not compile | Already exists | Preprint | **Stop** (already implemented). Add TS `@deprecated` diagnostics. |
| Architecture | Contract drift (silent fallback, gating, error): OR 1.83; survives in 85.9% | Detectors for `?? default`/`\|\| default` on input reads, `catch` that swallows/converts, new guard with `return null` | Predictor of future failure (correlational) | ~ms | Preprint, 4 models | **Pre/Stop:** empty catch already exists; extend to catch that only logs and continues, and to fallback on a public function parameter. **Critic:** "did the error/input contract change?"\[23\] |
| Architecture | Duplication: 50.8% of chains by turn 5 | Type 1/2 clone detector (normalized AST hash) against existing functions | No intervention study | ~100–500 ms per touched file | Gap | **Stop** (high precision). Type 4 clones are not cheaply detectable.\[24\] |
| Architecture | Reuse ignored | Symbol map of the touched module at the start | Retrieved context improves file-level F1 with less exploration | ~500–1,500 tokens | Preprint (Agent Retrieval Bench, indirect) | **Build;** measure in the harness.\[38\] |
| Architecture | Repo norms violated | Package of verified norms (RepoNorm) | +7.4 to +10.8% overall compliance; 86% precision | Offline preprocessing | Preprint | **Eval** as a direction; not a priority (heavy tool).\[39\] |
| Architecture | Concentrated complexity | Cyclomatic/cognitive limit as a blocker | Does not predict downstream failure (p>0.27) | False blocks | Preprint | **Eval only**, never a blocker.\[23\] |
| E2E correctness | Agent tests pass regressions and shortcuts | Hidden tests, assertion comparison, round cap | Stripe: 2 CI rounds; TRIM: the agent's tests are enough to minimize with 99.1% preservation | Per turn: related tests | Engineering + preprint | **Stop** (already implemented) + **Contract** with behavior-based verification.\[5\]\[30\] |
| E2E correctness | Analyzer-based selector degrades correctness | Do not use linter ranking for selection | Best-of-n loses hidden correctness as n grows; analyzer loop drops pass@1 by up to 9.94 points\[13\] | n× | Preprint (Kadam) | **Do not add** per turn.\[13\] |

## Prioritized recommendations (gain/cost)

Costs are my own estimates from the sources; all of them must be measured in the harness.

1. **Version docs index in the path-scoped rules**
   - **Mechanism:**
     - `smugan context` resolves the version and generates a compressed index (paths to local doc files).
     - On Next.js 16.3+, point to the docs in the package. On earlier versions, to `.next-docs` via the official codemod.\[33\]
     - Includes the instruction "prefer retrieval-led reasoning over pre-training-led reasoning".\[37\]
     - Load it alongside the stack rule, not only via the skill.
   - **Cost:** ~2K tokens per session (cacheable) and ~0 s.
   - **Evidence:**
     - Vercel: 53%→100%; the skill without an instruction stayed at 53% (56% non-invocation).\[37\]
     - 2604.09515: structured docs raise executability from 42.55% to 66.36%.\[20\]
   - **Measurement:** tasks with post-cutoff APIs (Next 16, current Supabase, Hono, Axum) and a hidden behavior-based suite. Metrics: build/test rate, deprecated API usage in the diff, and tokens.

2. **"Exploration residue" Stop hook**
   - **Mechanism:**
     - At the end of the turn, list new files not imported or referenced by tests/config (`repro_*.ts`, `scratch`, `debug`).
     - Also list changes to `package.json`, `tsconfig`, build configs and the lockfile that the contract does not call for.
     - Block once with the list.
   - **Cost:** <200 ms and ~150 tokens when it fires.
   - **Evidence:** TRIM. These two groups were 85.4% of the lines removed without loss of correctness on SWE-bench Verified.\[5\]
   - **Measurement:** final diff lines vs. gold, false blocks per 100 turns, and escaped defects.

3. **Input/error contract drift detectors (Pre/Stop)**
   - **Mechanism:** extend the empty-catch check to three cases:
     - (a) a `catch` that only logs and continues, or returns a default value, in a non-UI function;
     - (b) `?? value`/`|| value` applied to a newly introduced parameter or API response field;
     - (c) a new guard that returns `null`/`[]` in an existing function.
   - **Precision rule:** fire only when the line is new in the diff and the function already existed.
   - **Cost:** ~ms; 0 tokens when it does not fire.
   - **Evidence:** CodeThread (contract drift with OR 1.83; survives in 85.9%). Classic metrics do not predict it.\[23\]
   - **Measurement:** chained tasks in the harness (PR1→PR2, CodeThread style). Compare PR2 resolution with and without the check.

4. **Exact/renamed clone detector (Stop)**
   - **Mechanism:** normalized AST hash (identifiers and literals abstracted) of the diff's new functions against the repository's functions. If there is a match of ≥ N nodes, block with "reuse `foo` in `src/x.ts:42`".
   - **Cost:** 100–500 ms, with an incremental index keyed by file hash.
   - **Evidence:**
     - RepoReuse: duplication in 50.8% of chains.\[24\]
     - 2601.21276: the agent generates more type 4 clones.\[25\]
     - The detector only catches types 1/2, so coverage is partial, but precision is high.
   - **Measurement:** multi-turn suite with utilities planted in the repository. Metrics: reuse rate and duplication after 5 turns.

5. **Performance as an optional executable check in the contract**
   - **Mechanism:**
     - On a critical change that touches a handler/query, smugan-build proposes criteria such as "endpoint X makes ≤ K queries for N items" (spy on the DB client in a test) and "the listing has a limit".
     - For explicitly performance-focused tasks: run a benchmark/profiler and iterate up to 3 times (PerfAgent style).
     - In PreToolUse, `await` in a loop over a DB/fetch call.
   - **Cost:** ~0 per ordinary turn; seconds to tens of seconds only on a critical turn.
   - **Evidence:** PerfAgent (executable feedback > instruction: 39.2% vs. 16.7%); Text-to-SQL (unbounded queries).\[18\]\[36\] For query counting as an agent guard, **there is no study**.
   - **Measurement:** tasks with a planted N+1 and a hidden volume fixture. Metrics: queries/request and p95 on the hidden test.

6. **Narrower `critic`**
   - **Mechanism:**
     - Keep the closed checklist, the maximum of 5 findings and the executable verify.
     - Remove "design/organization" items that have no repository norm.
     - Add "did the error/input contract change?" and "is there residue outside the scope?".
     - A finding without an executable verify is discarded by the host.
   - **Cost:** stays as it is today. It may reduce rounds.
   - **Evidence:**
     - CodeRabbit: 56.3% rejection. Among the rejected ones, 43.3% are false positives and 23.7% are intentional trade-offs.\[40\]
     - Design comments resolved in 28.6% versus 43.3% for readability (Goldman et al., ASE 2025, Atlassian).\[41\]
     - Kadam: an agentic reviewer does not beat best-of-n at equal budget.\[13\]\[42\]
   - **Measurement:** rate of findings that become changes, and escaped defects per critic version.

7. **A/B test of the SlopCodeBench "gotchas" block in CLAUDE.md**
   - **Mechanism:** replace any generic quality sentence with the operational list:
     - abnormal defensive try/catch;
     - casts to work around types;
     - single-use variables;
     - comments a human would not write;
     - trivial wrappers;
     - heavy nesting;
     - too many helpers.
   - **Cost:** ~120 fixed tokens. Total cost may rise (+47.9% on GPT 5.4).\[2\]
   - **Evidence:** −1/3 initial verbosity, with no effect on slope or pass rate.\[2\]
   - **Measurement:** adopt only if the harness shows fewer lines without a per-task cost increase above ~10%.

## What not to add

- **"Write like a senior engineer/tech lead" or a generic quality prompt:** it does not reduce issues in a single call across 4 models; the gains at larger budgets come from the ranker (Kadam 2610.38977).\[13\]\[35\] Quality prompts raise cost and do not change the degradation slope (SlopCodeBench).\[2\]
- **Cyclomatic/cognitive complexity, Halstead or LLOC limits as blockers:** they do not predict failure in the next change (CodeThread, p>0.27).\[23\] In code that is "cleaner" by these criteria, the agent read 11.2% more files on complexity-hotspot tasks (Trivedi and Schmitt, as reported by third parties).\[43\]\[44\] Use them only as eval metrics.
- **Asking the agent to "minimize its own patch" without verification:** it fails in 3.8–44.9% (inflation, wrong file, reintroduced bug) and removes 1.6–3.1× less than mechanical search (TRIM).\[5\]
- **Per-turn best-of-n:** it costs n× and loses hidden correctness as n grows on the Gemma models tested (Kadam).\[13\] It only makes sense offline in the harness, as a comparison baseline.
- **Analyzer loop until zero issues:** it improves only the analyzer's own metric, drops pass@1 by up to 9.94 points and is worse according to the judge (Kadam).\[13\]
- **Homogeneous multi-agent debate:** 2.1–3.4× more tokens for accuracy equal to or lower than isolated self-correction (arXiv 2605.00914, 7–8B models; not replicated on frontier models).\[45\]\[46\]
- **Open-ended/generic reviewer and "design" review without a norm:** 56.3% rejection in production (CodeRabbit).\[40\]
- **Uncapped CI/test loops:** Stripe limits them to 2 rounds due to diminishing returns.\[30\]\[47\] Keep 1/2 blocks per turn.
- **Full docs in context:** the API spec gives nearly the same result with 13× fewer tokens, and irrelevant retrieval hurts frequent APIs (2407.09726).\[22\] Use an index and signatures.
- **Framework knowledge only in a skill:** in 56% of cases the skill was not invoked and the gain was zero (Vercel).\[37\]

## Gaps: measure in our own harness

- **Query counting and EXPLAIN assertions as an agent guard:** there is no study. It is plausible and cheap, but has no number.
- **Waterfall and re-render detection in React/Next:** no benchmark measures agent code on these dimensions. I also did not verify the precision of eslint-plugin-react-perf with agents.
- **Symbol map and reuse:** there is evidence that retrieval improves navigation, but not that it reduces duplication.
- **Negative vs. positive instruction and few-shot from the repo itself:** no controlled study on frontier agents was found in this research. Kadam reports, via Khojah et al. 2025, that few-shot increased smells and that a "best practices" persona reduced complexity with a slight loss of correctness.\[13\]
- **Frontier replication:** the anti-slop prompt was tested only on GPT 5.3 Codex/5.4,\[2\] PerfAgent only on GPT-5.1, and the Vercel eval does not state a model. Opus/Gemini 3.x need their own A/B tests.
- **Conflict over context files:** AGENTS.md associated with −28.64% runtime and −16.58% output tokens (arXiv 2601.20404; 124 PRs, 10 repositories; correlational) vs. ~+20% cost with no gain in success (Gloaguen et al., 2602.11988, already known).\[48\]\[49\]\[50\] The likely difference lies in the content (exact commands vs. overview). The harness should measure rule by rule.
- **Meta, Microsoft, Shopify, Cursor and Cognition cases:** not confirmed in this research. TDAD, TDDev, McMillan, GitClear, Atlassian, Alexopoulos, and Jin and Chen are known to the user and were not re-verified here.
- **SlopCodeBench number discrepancy across versions:** v1 reports 17.2%, 80% and 2.2× (48 repositories);\[1\] the version cited by Kadam reports 14.8%, 77% and 2.3× (473 repositories).\[13\] Use the most recent version when citing.

## Quality of the evidence used

- **Peer-reviewed:** Abbassi et al. (ICSME 2025); Goldman et al. (ASE 2025); LibEvolutionEval (NAACL 2025).\[51\]
- **arXiv preprints (2026 unless noted):**
  - SlopCodeBench 2603.24755, TRIM 2607.18161, CodeThread 2606.21804, RECAP 2608.13292, Position 2608.12355.
  - Nakashima 2602.04226, Watanabe 2602.17091, PerfAgent 2607.19653, PERFOPT 2607.07744, MicroPerf 2610.29695.
  - Text-to-SQL 2512.22364 (2025), When LLMs Lag Behind 2604.09515, API Docs 2407.09726 (2024), RepoReuse 2609.35357, SWE-Shield 2604.05955.
  - RepoNorm 2610.07757, Code Cleanliness 2605.20049 (SonarSource affiliation), Kadam 2610.38977, CodeRabbit 2607.03316, AGENTS.md efficiency 2601.20404.
  - Cost of Consensus 2605.00914, Agent Retrieval Bench 2607.24882.
- **Vendor document:** Vercel "AGENTS.md outperforms skills" (Jan 2026); Next.js guide for agents; Anthropic's code-simplifier plugin page.
- **Engineering post:** Stripe Minions part 2; Google Research "Resolving code review comments with ML".
- **Secondary/anecdotal (used only for numbers I did not confirm in the original):** Daniel Vaughan's blog for PerfAgent's cost ($2.88 vs. $11.01) and the 16.7% result with instructions, and for RECAP (+242% to +4%).\[34\]

## Sources

1. [SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks](https://arxiv.org/html/2603.24755v1)
2. <https://arxiv.org/pdf/2603.24755v1>
3. [SlopCodeBench: Benchmarking How Coding Agents ...](https://arxiv.org/pdf/2603.24755)
4. [SlopCodeBench Explained: Results, Metrics, and What It Means (arXiv 2603.24755)](https://scanaislop.com/blog/what-slopcodebench-measures/)
5. [TRIM: Reducing AI-Generated CodeSlop via Agent Trajectory Minimization](https://arxiv.org/pdf/2607.18161)
6. [Position: Humans are Missing from AI Coding Agent Research Zora Zhiruo Wang1∗](https://zorazrw.github.io/files/position-haicode.pdf)
7. [Position: Humans are Missing from AI Coding Agent Research](https://arxiv.org/html/2608.12355v1)
8. [Refine After Generation: Toward Correct and Concise Patches in LLM-based Program Repair](https://arxiv.org/html/2608.13292)
9. [(PDF) Why Agentic-PRs Get Rejected: A Comparative Study of Coding Agents](https://www.researchgate.net/publication/400459775_Why_Agentic-PRs_Get_Rejected_A_Comparative_Study_of_Coding_Agents)
10. [Why Agentic PRs Get Rejected: What the First Comparative Study Means for Codex CLI Developers](https://codex.danielvaughan.com/2026/06/27/why-agentic-prs-get-rejected-codex-cli-acceptance-rates-trust-attribution-open-source/)
11. [Why Nearly Half of Agentic Pull Requests Get Rejected — and How Codex CLI Can Cut the Waste](https://codex.danielvaughan.com/2026/06/18/why-agentic-pull-requests-get-rejected-codex-cli-ci-gates-review-hooks-defence/)
12. [What to Cut? Predicting Unnecessary Methods in Agentic Code Generation](https://arxiv.org/abs/2602.17091)
13. [Beyond Passing Tests: A Systematic Review and Controlled Re-evaluation of Techniques for Improving the Quality of LLM-Generated Code](https://arxiv.org/html/2610.38977)
14. [PerfAgent: Profiler-Guided Iterative Refinement for Repository-Level Code Optimization](https://arxiv.org/abs/2607.19653)
15. [PERFOPT-Bench: Evaluating Coding Agents on Software Performance Optimization](https://arxiv.org/pdf/2607.07744)
16. [\[2607.07744\] PERFOPT-Bench: Evaluating Coding Agents on Software Performance Optimization](https://arxiv.org/abs/2607.07744)
17. [\[2610.29695\] Benchmarking Coding Agents for System-Level Performance Optimization](https://arxiv.org/abs/2610.29695)
18. [Cost-Aware Text-to-SQL: An Empirical Study of Cloud Compute Costs for LLM-Generated Queries](https://arxiv.org/html/2512.22364v1)
19. [A Taxonomy of Inefficiencies in LLM-Generated Python Code](https://www.alphaxiv.org/abs/2503.06327)
20. [When LLMs Lag Behind: Knowledge Conflicts from Evolving APIs in Code Generation](https://arxiv.org/abs/2604.09515)
21. [When LLMs Lag Behind: Knowledge Conflicts from Evolving APIs in Code Generation](https://arxiv.org/html/2604.09515v1)
22. [On Mitigating Code LLM Hallucinations with API Documentation](https://arxiv.org/pdf/2407.09726)
23. <https://arxiv.org/pdf/2606.21804>
24. [Do Coding Agents Reuse Existing Code or Reinvent the Wheel?](https://arxiv.org/abs/2609.35357v1)
25. [More Code, Less Reuse: Investigating Code Quality and Reviewer](https://arxiv.org/pdf/2601.21276)
26. [Does Code Cleanliness Affect Coding Agents? A Controlled Minimal-Pair Study](https://arxiv.org/pdf/2605.20049)
27. [Does Code Cleanliness Affect Coding Agents? A Controlled Minimal-Pair Study](https://arxiv.org/html/2605.20049v1)
28. [Does Code Cleanliness Affect Coding Agents? A Controlled Minimal-Pair Study — The Commonplace](https://commonplace.workforcefutures.net/paper/arxiv:2605.20049)
29. [\[Literature Review\] Does Code Cleanliness Affect Coding Agents? A Controlled Minimal-Pair Study](https://www.themoonlight.io/en/review/does-code-cleanliness-affect-coding-agents-a-controlled-minimal-pair-study)
30. [Minions: Stripe’s one-shot, end-to-end coding agents—Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)
31. [claude-code/plugins/pr-review-toolkit/agents/code-simplifier.md at main · anthropics/claude-code · GitHub](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md)
32. [We just open sourced the code-simplifier agent we use on the Claude Code team. Try it: claude plugin install code-simplifier Or from within a session: /plugin marketplace update claude-plugins-official /plugin install code-simplifier Ask Claude to use the code simplifier agent at the end of a long coding session, or to clean up complex PRs. Let us know what you think!](https://www.threads.com/@boris_cherny/post/DTRejvBkZCy/we-just-open-sourced-the-code-simplifier-agent-we-use-on-the-claude-code-team)
33. [How Next.js supports AI coding agents](https://nextjs.org/docs/app/guides/ai-agents)
34. [Refine After Generation: What RECAP Reveals About Patch Verbosity in Coding Agents — and How to Defend Against It in Codex CLI](https://codex.danielvaughan.com/2026/08/16/refine-after-generation-recap-patch-verbosity-concise-patches-codex-cli-agents-md-posttooluse-hooks-diff-review/)
35. [Beyond Passing Tests: A Systematic Review and Controlled Re-evaluation of Techniques for Improving the Quality of LLM-Generated Code](https://arxiv.org/html/2610.38977v1)
36. [PerfAgent and the Profiler Feedback Loop: Why Your Coding Agent Stops at Shallow Speedups — and How to Build an Iterative Optimisation Workflow in Codex CLI](https://codex.danielvaughan.com/2026/08/06/perfagent-profiler-guided-iterative-refinement-codex-cli-performance-optimization-postooluse-hooks/)
37. [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
38. [\[2607.24882\] Agent Retrieval Bench: Evaluating Repository Context Retrieval for Coding Agents](https://arxiv.org/abs/2607.24882)
39. [Acquiring and Verifying Repository Norms for Coding Agents](https://arxiv.org/abs/2610.07757)
40. [Is Agentic Code Review Helpful? Mining Developers' Feedback to CodeRabbit Reviews in the Wild](https://arxiv.org/pdf/2607.03316)
41. [(PDF) What Types of Code Review Comments Do Developers Most Frequently Resolve?](https://www.researchgate.net/publication/396291600_What_Types_of_Code_Review_Comments_Do_Developers_Most_Frequently_Resolve)
42. [Beyond Passing Tests: A Systematic Review and Controlled Re-evaluation of Techniques for Improving the Quality of LLM-Generated Code](https://arxiv.org/abs/2610.38977)
43. [Code complexity limits and how linters count them · Prickles](https://prickles.org/articles/code-complexity)
44. [Vibe coding best practices for cleaning up an app · Prickles](https://prickles.org/articles/vibe-coding-best-practices)
45. [The Cost of Consensus: Isolated Self-Correction Prevails Over Unguided Homogeneous Multi-Agent Debate — CAIS 2026 — ACM CAIS 2026](https://www.caisconf.org/program/2026/papers/decomposing-sycophancy-fragility-consensus-collapse-and-cost-in-homogeneous-mult/)
46. [The Cost of Consensus: Isolated Self-Correction Prevails Over Unguided Homogeneous Multi-Agent Debate · Pith](https://pith.science/paper/2605.00914)
47. [Inside the Architecture of Stripe’s AI Coding Agent “Minions”](https://lilting.ch/en/articles/stripe-minions-agent-architecture)
48. [\[2601.20404\] On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents](https://arxiv.org/abs/2601.20404)
49. [AGENTS.md Guide: Setup, Examples & Best Practices](https://kingy.ai/news/the-definitive-guide-to-agents-md-what-it-is-how-to-use-it-and-why-it-matters/)
50. [Engineering Reliable Coding Agents: Evaluating and Operating the System Around the Model](https://arxiv.org/pdf/2608.13867)
51. [LIBEVOLUTIONEVAL: A Benchmark and Study for Version- ...](https://aclanthology.org/2025.naacl-long.348.pdf)
