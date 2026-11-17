---
title: Verify the installation
description: Check the installation with smugan doctor and a smoke session.
---

First, with no session and no tokens spent:

```bash
smugan doctor
```

`doctor` checks:

- the Node version;
- the four hooks in `settings.json` (session start, before and after the write, end of turn) and the launcher they call;
- the engine the hooks point to;
- whether the `smugan` command is on `PATH` and points to this checkout;
- whether the installed copies match the checkout's;
- whether `"disableAllHooks": true` turns the hooks off, in the user's `settings.json`
  or in the `.claude/` of the folder it runs in;
- the `context` parsers;
- Git Bash, on Windows.

At the end, it passes a test write of a migration with a Portuguese name and no RLS
through the installed hook, and requires it to come back blocked. Each failing line
includes the command that fixes it. The exit code is 1 when any line fails,
including an installed copy that fell behind the checkout.

Then, in a throwaway folder, so the test migration does not end up in a real
project:

```bash
mkdir smugan-smoke && cd smugan-smoke && git init && claude
```

And ask:

```text
Create supabase/migrations/0001_clientes.sql with create table clientes (id uuid primary key, nome_completo text).
```

The write must come back refused with `smugan gate: blocked`, and the lines must
include `[db-naming]` and `[rls]`. Delete the folder afterwards.

If the migration is written without that message, the hooks did not run in that
session:

1. sessions opened before installation do not read the hooks; open a new one;
2. run `doctor` from inside that folder;
3. if it comes back green and the session still does not block, run `/status` in the
   session. An organization can restrict hooks through managed settings
   (`allowManagedHooksOnly`), which `doctor` cannot read.
