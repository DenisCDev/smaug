---
name: smugan-finish
description: >
  Deliver finished work when the user asks for it: commit, push, open or merge
  a pull request, finish or discard a branch or worktree ("manda pro github",
  "abre o PR", "pode subir", "faz o merge", "finaliza a branch", "descarta").
  Picks one integration path from the user's words and the repository's own
  convention, executes it, and reports what CI actually did. Never commits or
  pushes on its own initiative.
---

# Smugan — deliver finished work

Commit, push and merge happen only when the user asks. This skill runs when
they do, and the integration decision stays theirs.

## 1. Evidence first

- The Definition of Done ran on the final state: typecheck, lint and tests,
  with their results in this turn, and the findings of the
  reviewers it calls for resolved. Something red or unreviewed: report it and stop. Delivering it
  anyway is the user's call, with the red named.
- An item in the unfinished-work block (`⚠️`, at the end of a reply) the user has not accepted stops the
  delivery the same way.

## 2. Read the repository

```bash
git status --short --branch
git rev-parse --git-dir --git-common-dir   # two different paths: you are in a worktree
git remote -v
git symbolic-ref --short refs/remotes/origin/HEAD
git log --oneline -15                      # "Merge pull request" entries: the project merges by PR
git fetch && git status -sb                # behind or diverged from the remote?
```

Also read the CI workflows (`.github/workflows/`), the PR template if there is
one, and the commit convention of the recent history: language, subject format.

## 3. One path, not a menu

Choose in this order:

1. The user's words. "Sem PR, direto na main" or "abre um PR" settle it.
2. The project's convention. PR merges in the history mean a PR; direct
   commits on the default branch mean a direct push.
3. Otherwise, a pull request when there is a shared remote, and a local merge
   when there is none.

State the path in one line and execute it. Ask only when the user's words do
not settle it and the path has a cost they would want to choose: pushing
straight to a protected or shared default branch, or a merge with conflicts.
One question, never a list of options.

## 4. Execute

- On the default branch with a PR path, create a branch first.
- Commit following the project's convention and the Git rules: permanent
  history for a teammate who never saw the conversation, no AI attribution,
  and a body that closes with the checks that ran and their results.
- Behind the remote: rebase the local, unpushed commits onto it, or merge if
  the project merges. Run the checks again on the result before pushing.
  Never force-push a shared branch, and never skip hooks or signing.
- Push. For a PR, use the forge's CLI (`gh pr create`) with a body that
  follows the template and the same rules, and give the user the URL.
- Local merge: merge, run the checks again on the merged result, then delete
  the merged branch.

## 5. After the push: what CI actually did

Run `gh run list --branch <branch> --limit 1`, or the forge's equivalent, and
report the real state:

- passed;
- failed, with the failing job;
- still running;
- never started, with the reason the forge gives (billing, disabled workflows,
  missing runner).

A queued run is not a green run. Wait for it, in bounded stretches, only when
the user asked for the result.

## 6. Clean up only what this work created

- Delete a branch only after its work is merged.
- Remove a worktree only if this work created it and
  `git -C <worktree> status --porcelain -uall` is empty. Never `--force` on
  your own initiative: show what would be lost and ask.

## Discarding work

Only on an explicit request. Before deleting anything, show everything that
goes away, most valuable first:

- changes never committed, tracked or not:
  `git -C <worktree> status --porcelain -uall`;
- commits that exist nowhere else: `git log --oneline <base>..<branch>`, minus
  what the remote already has;
- the local branch and the worktree path.

Also show what stays and must be handled separately:

- the remote branch (`git ls-remote --heads origin <branch>`);
- an open pull request (`gh pr list --head <branch> --state open`);
- stashes made on this branch (`git stash list`).

Discarding local work neither deletes the remote branch nor closes the pull
request. Do either only if the user asks for it by name. Wait for the user to
confirm the list as shown; a list that changed since they saw it needs a new
confirmation.

## Review comments on the pull request

Handle them the way the critic's `for the caller:` block says:

- reproduce a comment's claim before changing code;
- push back with evidence when it is wrong for this codebase;
- send a conflict with the user's own decisions back to the user;
- answer each comment with what changed, or why not.
