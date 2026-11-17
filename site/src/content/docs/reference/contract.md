---
title: Acceptance contract
description: The acceptance contract file format, its validation rules, where it is stored, and the semantics of smugan contract --set, --replace, --mark and --clear.
---

An acceptance contract records what a change must do. It is written from the request
before any code exists, so that the reviewers judge the diff against it. Each checkout
has one contract, stored outside the checkout. The code is in
[`packages/gate/src/contract.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/contract.mjs),
and the command is in
[`packages/gate/bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs).

## Commands

```bash
smugan contract [folder] --set contract.json [--replace]
smugan contract [folder] --mark <n> <pending|done|blocked> [--evidence "<text>"]
smugan contract [folder] [--json]
smugan contract [folder] --clear
```

`folder` defaults to `.`. The command runs one action at a time. These are usage
errors, with exit code 2:

- two actions at once;
- `--set` without a file;
- `--mark` without a positive integer and a status;
- `--evidence` without `--mark`;
- `--replace` without `--set`;
- an unknown option.

With no action, the command prints the contract, or the raw JSON with `--json`. It
exits 1 when there is no contract.

## Input format (`--set`)

The input file must be a regular file of at most 64 KiB containing JSON. A leading BOM
is accepted. Only these fields are allowed. Any other key, at the top level or inside
a criterion or decision, is rejected:

| Field | Required | Rule |
|---|---|---|
| `request` | yes | a non-blank string, up to 4,000 characters: the quoted request |
| `criteria` | yes | 3 to 6 objects, each with exactly `behavior` and `verify` |
| `criteria[].behavior` | yes | a non-blank string, up to 600 characters: the observable behavior |
| `criteria[].verify` | yes | a non-blank string, up to 600 characters: the command, test or observation that proves it |
| `outOfScope` | no | up to 6 non-blank strings, up to 300 characters each |
| `decisions` | no | up to 6 objects with exactly `decision` and `reason`, each a non-blank string up to 300 characters |

A rejected contract lists every problem and exits 2. Fewer than 3 criteria are
rejected with "a request that fits in fewer needs no contract".

Example:

```json
{
  "request": "Reject expired sessions before any protected mutation.",
  "criteria": [
    { "behavior": "A mutation with an expired session returns 401.", "verify": "npm test -- session-expiry" },
    { "behavior": "A valid session still mutates.", "verify": "npm test -- session-valid" },
    { "behavior": "Reads are unaffected.", "verify": "npm test -- read-paths" }
  ],
  "outOfScope": ["Refresh-token rotation"],
  "decisions": [{ "decision": "Use 401, not 403", "reason": "The client already re-authenticates on 401" }]
}
```

## Stored format

On save, strings are trimmed and every criterion gets `"status": "pending"`. The
stored file adds the following fields:

| Field | Meaning |
|---|---|
| `version` | always `1` |
| `root` | the checkout the contract belongs to |
| `createdAt`, `updatedAt` | ISO timestamps |
| `criteria[].status` | `pending`, `done` or `blocked` |
| `criteria[].evidence` | present after `--mark … --evidence` |

## Storage location

The contract belongs to the checkout: the Git top level of `folder`
(`git rev-parse --show-toplevel`), or the folder itself outside a repository. It is
stored at:

```
<cache>/smugan/contracts/<hash>.json
```

`<cache>` is `LOCALAPPDATA`, `XDG_CACHE_HOME` or `~/.cache`, in that order. When
`SMUGAN_CACHE_DIR` is set, the file is `SMUGAN_CACHE_DIR/contracts/<hash>.json`.
`<hash>` is the first 32 hex characters of the SHA-256 of the lowercased,
forward-slash checkout path. The folder is created with mode `0700`. Writes take a
lock and use an atomic rename. Because the file lives outside the checkout, it never
shows up in `git status` or in a commit.

## Action semantics

### `--set`

`--set` validates the input file. When no contract exists, it saves the contract and
prints it. When one exists, it refuses with exit 2 and shows a summary of the existing
contract: its age, how many criteria are done, and the start of its request. The
existing contract is never overwritten in silence, so another session's progress in
the same checkout is not lost.

### `--replace`

`--replace` is only valid with `--set`. It overwrites the existing contract and
reports what it replaced. It also works when the stored file is not valid JSON, and
then reports that it replaced an unreadable contract.

### `--mark <n> <status>`

`--mark` sets the status of criterion `n`, counting from 1.

- `done` and `blocked` require `--evidence`. The evidence is 1 to 600 characters:
  what you saw, such as the command and its result, or the reason the criterion is
  blocked.
- `pending` without `--evidence` removes any previous evidence.
- `--mark` fails when there is no contract or no criterion `n`, and when the status
  is not one of the three.
- `updatedAt` is refreshed on every mark.

### `--clear`

`--clear` deletes the contract file and says what it removed: the summary, "the
unreadable contract", or that there was none. Like `--replace`, it works on a file
that is not valid JSON.

### Unreadable file

A contract file that exists but does not parse raises an error. The error names the
file and both ways out: `--set <file> --replace` and `--clear`.

## How the hooks use it

- **`pre`.** On the session's first edit of a critical file, per project, the hook
  looks at the contract. With no contract, the reminder suggests
  `smugan contract --set <file.json>`. When every criterion is `done`, it asks you to
  confirm the contract is finished work before replacing it. A `blocked` criterion
  counts as work in progress. An unreadable contract gets its own reminder. The
  reminder never blocks the edit. See [Hooks](../hooks/#pre-pretooluse-for-write-edit-and-multiedit).
- **`stop`.** The `exploration-residue` check uses the contract to define the turn's
  scope: the `request`, each criterion's `behavior` and `verify`, and each decision.
  It uses the contract only when some criterion is not `done`. The user's recent
  prompts from the transcript also count toward the scope.
