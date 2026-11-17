---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# Flows (product completeness)

A user-facing change is complete when a user can walk it end to end:

- A destructive or irreversible action (delete, discard, overwrite, unassign, cancel in progress) confirms first, through the app's one confirmation component (never `window.confirm`), on a danger-colored control.
- Every async action shows a pending state (control disabled + spinner or "…") and ends in success or an actionable error in the UI's language. Long actions show progress; optimistic UI reverts and says so when the write fails.
- What a user can create they can view, edit and delete, and after creating it they land on it the same way everywhere. A screen a role reaches has that role's actions, or says why it can't act.
- A submit button stays disabled until its required inputs are valid.
- Headings match what is under them; every collection has an empty state saying what to do next; a list that can grow is ordered and paginated, never cut by a silent `slice(0, N)`.
