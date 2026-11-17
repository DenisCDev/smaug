---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/tests/**"
  - "**/test/**"
  - "**/*_test.*"
  - "**/e2e/**"
  - "**/playwright.config.*"
  - "**/vitest.config.*"
  - "**/supabase/tests/**"
---

<!-- A test that cannot fail is a receipt, not a proof. -->

# Testing

How many tests a change gets is in the Definition of done. This file is about
making each one count. Read `~/.claude/skills/smugan-build/references/testing.md`
when choosing tests or proposing a removal.

## Writing a test

- The expectation comes from a requirement, contract or known bug, never a copy of the algorithm under test, and never freezes a known defect as intended behavior. Asserting a call is valid when the call is the contract (no charge on denied access); it does not certify the integration. A scanner fixture full of bad code is input: judge the outer assertion.
- Pick the smallest boundary with enough fidelity: input combinations fit small tests; API chains, database rules and races need real boundaries, and a mock cannot prove a database, auth or provider integration.
- Build fixtures the way production builds that state: same process, prior registrations and call order.
- A race is shown with barriers, distinct connections or processes, never `Promise.all` alone or sleeps; assert the invariant.
- Skip what the type checker, a schema or the framework already guarantees, snapshot tests of components and tests that only render.

## E2E

- Use the project's E2E runner. Cover the affected critical journeys (auth, main CRUD, payment) through the real effect and persistence, not a success message or a screenshot. Read `tests/app.context.md` when present, and keep it current.
- Locators come from the running app's DOM: role plus the accessible name the user sees first (`getByRole` with Playwright); a test id only when that is ambiguous, adding the `data-testid` in the same change. Isolated test accounts, never real credentials.

## Existing tests

- Green never comes from weakening the suite: no `.skip`, `.only`, removed or loosened assertion, or early runner exit. Fix the code, or show with evidence that the test's premise was wrong and say which.
- Removing or merging a test names its guarantee and the executed replacement that still detects it, or the retired requirement.
- A retry that passes does not erase the first failure.

## Database (Supabase)

- pgTAP access tests for Supabase tables follow `supabase.md` (Behavioral proof).
