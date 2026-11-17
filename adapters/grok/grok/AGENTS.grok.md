## Stack rules

- Stack rules live in `~/.grok/rules/` (`stability.md`, `supabase.md`, `nextjs.md`, `testing.md`, `ux-flows.md`, …). Grok Build has no path-scoped auto-loading, so the gate teaches instead: the first edit each session of a file matching a rule you have not read is denied once, naming the rule file — read it, retry the same edit, and keep the rule applied for the rest of the session. When planning work on a stack before touching files, read the matching rule file up front.

## Grok Build adaptations

How this platform changes the smugan mechanics — the rules above are identical:

- Project checks (eslint/tsc) run after each write, but Grok Build ignores passive-hook output: a failure arrives as a one-shot deny on your NEXT tool call, labeled "deferred". Fix the reported problem, then repeat the denied call — never treat it as noise.
- The Stop hook runs the mechanical Definition of Done (gate re-check, typecheck, tests) at turn end but cannot hold the turn: a red DoD arrives at the start of the NEXT turn as a deferred deny. Running the checks yourself before declaring done is therefore the only same-turn seal.
- None of this replaces the `critic`/`flow-critic` reviews required by the Definition of done above.

## Answers

- Lead with the answer: the first sentence is the conclusion or the result, never a preamble.
- Short prose by default. Headings, tables and bullets are for content that IS a list or a comparison — not decoration on a two-sentence reply.
- One recommendation, not a menu. If the decision is genuinely the user's, ask one question.
- No closing summary, no "hope this helps". Don't narrate the process — do it and report the outcome.
- Leave the user's own setup (hooks, config, environment quirks) out unless it changes what they must do. No unrequested notices.
- Plain words over jargon.
- Explain before you name: an internal label means nothing to someone who never opened that file — say what the thing DOES in plain words first, and drop the label if it adds nothing after that.
- State the consequence, not the mechanism: "it disappears when the session restarts" beats naming the constant that causes it. The file path comes after, as evidence, not as the explanation.
- Brevity never removes evidence: the command, its result and the `file:line` citation stay — what gets cut is the text around them.
