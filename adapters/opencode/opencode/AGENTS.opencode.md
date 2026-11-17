## Stack rules

- Stack rules live in `~/.config/opencode/rules/` (`stability.md`, `supabase.md`, `nextjs.md`, `testing.md`, `ux-flows.md`, …). OpenCode has no path-scoped rule loading, so the smugan plugin injects them: the first write or edit of a file matching a rule appends that rule's text to the tool result, once per rule per session. When planning work on a stack before touching files, read the matching rule file up front.

## OpenCode adaptations

How this platform changes the smugan mechanics — the rules above are identical:

- The gate blocks a violating write or edit by failing the tool call itself. A tool error that starts with `smugan gate:` is the gate, not a bug: fix what it names and retry.
- The project's own checks (eslint/tsc) run after each write and arrive **appended to that tool's result** — read them; they report only what this change introduced.
- At the end of every turn the plugin runs the mechanical Definition of Done (gate re-check, typecheck, tests). If it fails, the session is re-prompted with the failures: a message starting with `smugan —` is the gate speaking, not the user. Fix what it lists. It stops on its own once the checks pass, after 3 resumes for the same complaint, and after 5 resumes in a session — past that only the user can restart it, so do not count on being nudged again.
- `edit` matches loosely here, so an edit can slip past the pre-write gate — the end-of-turn check is what catches it. Never treat a green write as proof the code is clean.
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
