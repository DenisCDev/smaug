---
title: Known limits
description: What the engine does not see and where it fails open.
---

- The engine uses a tokenizer and regular expressions, not a full syntax tree.
- The checks favor precision. An ambiguous pattern may pass to keep a false positive
  from making the gate unusable.
- Most rules look at one file at a time. Cross-module decisions are left to the
  reviewers and the project's tests.
- A migration must enable RLS in the same file that creates the table. Enabling it
  later leaves an exposure window and is treated as a failure.
- An internal failure or timeout in Smugan does not block work. The error is
  reported, but the tool prefers to fail open rather than stop every session.
- Writes made outside the tools the platform observes may not go through the gate.
  On Claude Code, a file a shell command changes is seen through Git at the end of
  the turn, also when the turn commits it: only in the repository the command ran
  in, and alongside anything else that changed the repository during the turn,
  such as a person editing in parallel (`"hook": {"stop": {"shell": false}}` turns
  it off). A commit is the turn's when HEAD's reflog shows the turn making it (an
  amend counts for what it adds); what a pull, merge, checkout or rebase brings is
  not, whoever wrote it. With more than 2,000 files already changed, or past a
  3-second budget for recording them, the end of the turn says what it did not
  check.
  Each adapter's README records that scope.
- A model-based reviewer helps find semantic problems, but it is not deterministic
  proof. Tests and mechanical checks remain the basis for completion.
- The assertion comparison does not notice a changed expected value, a renamed test
  or `it.each`. A requested behavior change has the same shape, so those cases are
  left to `critic`.
