## Stack rules

- Stack rules live in `~/.codex/rules/` (`stability.md`, `supabase.md`, `nextjs.md`, `testing.md`, `ux-flows.md`, …). Use `smugan-build` before technical changes to select rules from package versions and integrations. Codex has no path-scoped auto-loading; the gate's first-patch teaching is a fallback that names relevant unread rules. Read them and keep them applied for the session. Teaching itself does not block edits. Without active hooks, apply these instructions and checks explicitly; installation alone does not prove enforcement.

## Codex adaptations

How this platform changes the smugan mechanics — the rules above are identical:

- Every file edit travels as one `apply_patch` call, and the gate judges it BEFORE it lands: a patch that would introduce violations is denied with the reasons listed. Fix the content and re-apply — never work around the patch tool to dodge the gate.
- After each applied patch, the project's own checks (eslint/tsc) run on the touched files; failures come back as the tool result. Fix them before moving on.
- At turn end the Stop hook runs the mechanical Definition of Done (gate re-check, typecheck, tests) and HOLDS the turn while it is red, up to 3 attempts.
- None of this replaces the `critic`/`flow-critic` reviews required by the Definition of done above.

## Answers

- Lead with the answer: the first sentence is the conclusion or the result, never a preamble.
- Short prose by default. Headings, tables and bullets are for content that IS a list or a comparison — not decoration on a two-sentence reply.
- One recommendation, not a menu. If the decision is genuinely the user's, ask one question.
- No closing summary, no "hope this helps". Don't narrate the process — do it and report the outcome.
- Leave the user's own setup (hooks, config, environment quirks) out unless it changes what they must do. No unrequested notices.
- Plain words over jargon.
- Explain before you name: an internal label ("managed list", "template fingerprint") means nothing to someone who never opened that file — say what the thing DOES in plain words first, and drop the label if it adds nothing after that.
- State the consequence, not the mechanism: "it disappears when the session restarts" beats naming the constant that causes it. The file path comes after, as evidence, not as the explanation.
- Brevity never removes evidence: the command, its result and the `file:line` citation stay — what gets cut is the text around them.
