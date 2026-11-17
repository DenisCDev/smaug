---
id: testing
reviewed_at: 2026-10-02
coverage: "Test-selection policy; preserve project checks and review obligations"
---

# Prove a failure the change could introduce

Name the behavior, plausible failure and independent expected result before
implementation; a clear test name/data can suffice. Select the smallest boundary
with enough fidelity. E2E is valuable for critical journeys, not the sole proof
for parsers, concurrency, access policies or failure combinations. Fast diagnosis
and determinism can justify deliberate overlap. [Google unit tests](https://abseil.io/resources/swe-book/html/ch12.html),
[larger tests](https://abseil.io/resources/swe-book/html/ch14.html).

| Risk | Appropriate evidence |
|---|---|
| Parser/version resolution/path edge | Real input to output, positive and negative cases |
| Hook/CLI/install protocol | Subprocess, files, stdout/stderr/exit code and preserved unrelated state |
| RLS/constraints/atomicity | Isolated real database and actual allowed/denied roles |
| API auth/middleware/validation | Real framework request; production adapter when transport matters |
| Critical user journey | Browser journey plus persisted effect and access boundaries |
| Concurrent update/job/lease | Controlled overlap, distinct connections/processes and final invariant |
| Deploy/proxy/cookie/cache | Built artifact and representative disposable topology |

For reproducible bugs, prefer a regression that fails for the right reason
before fixing. Later tests and characterization of legacy code are legitimate;
observed behavior is not automatically the correct requirement. Avoid tests
that copy the implementation algorithm into their expected result or only
verify a simulation. A spy can prove an external interaction contract, such as
no charge on denial; it does not prove the provider integration.
[Test doubles](https://abseil.io/resources/swe-book/html/ch13.html),
[characterization](https://michaelfeathers.silvrback.com/characterization-testing).

Do not add a test per function, branch, loop or icon merely to increase coverage.
Reversible low-impact edits can use existing checks. Security, money, data,
concurrency and known regressions need proportional behavioral evidence. Never
make checks green with hidden skips, `.only`, weaker assertions or early runner
exit. A corrected premise needs evidence and still must protect the real contract.

Preserve existing tests by default. For deletion/merging, identify the guarantee
and executed replacement that still detects it, or the retired requirement.
Mock use, line count or hypothetical E2E overlap alone is insufficient. Scanner
fixtures intentionally containing bad code are inputs, not necessarily bad tests.
Measure expensive/flaky cases before reorganizing; no fixed test-type ratio or
automatic mass deletion. A targeted mutation can help in isolation, not as a
mandatory new tool or claim of full equivalence.

Record command, code/diff, relevant runtime/fixture and pass/fail/skip result.
Capture traces/video when useful; screenshots do not prove persistence or access
control. Keep required typecheck, lint, tests, gate and independent reviews;
repeat checks when changes or unresolved concerns justify it, not mechanically
without new evidence. [Playwright traces](https://playwright.dev/docs/trace-viewer-intro).
