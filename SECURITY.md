# Security policy

## Supported versions

Only the current version of the `main` branch receives fixes. The installed hooks load the engine straight from the checkout (`packages/gate`), so updating is `git pull` followed by `./install.sh` (or the adapter's installer).

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private form: **Security** tab → **Report a vulnerability** (<https://github.com/DenisCDev/smugan/security/advisories/new>).

Include the version (commit), the operating system, the host (Claude Code, Codex, Grok Build, OpenCode or Antigravity), the steps to reproduce and the observed impact.

What to expect: the project has one maintainer and does not promise a response time. Each report is handled in its own advisory, where the fix is agreed on, and the advisory is published together with the fix, crediting the reporter if they want.

## What Smugan does on your machine

Facts checked against the code; the file cited is the source.

### The installer (`install.sh`)

Requires `node` on the PATH. Writes to `~/.claude/` (or `CLAUDE_CONFIG_DIR`):

- `CLAUDE.md`: adds or updates only the block between the `smugan:start` and `smugan:end` markers; the rest of the file stays as it is.
- `rules/`, `skills/`, `agents/`, `output-styles/` and `hooks/smugan-hook.mjs`: copied from the checkout, overwriting previous versions with the same name.
- `hooks/smugan.paths.json`: the path to the checkout's `packages/gate`, the chosen languages and the installation date.
- `settings.json`: merges the hooks from `claude/hooks/settings-fragment.json` (replacing only Smugan's own old entries) and sets `outputStyle: "Smugan"` only when the field does not exist. If the JSON is invalid, nothing is written to it. `settings.local.json` is never touched.

It also writes the `smugan` command (and `smugan.cmd` on Windows) to `~/.local/bin` (or `SMUGAN_BIN_DIR`); a file with that name that the installer did not write is kept.

The adapter installers (`adapters/*/tools/install.mjs`) do the equivalent on each host: `~/.codex/` (or `CODEX_HOME`) and `~/.agents/skills/`; `~/.grok/` (or `GROK_HOME`); `~/.config/opencode/` (or `OPENCODE_CONFIG_DIR`/`XDG_CONFIG_HOME`); `~/.gemini/` (or `SMUGAN_AGY_HOME`). The host's hook configuration is either merged (`~/.codex/hooks.json`; the `smugan` key in Antigravity's `hooks.json`) or kept in its own file (`~/.grok/hooks/smugan.json`, the plugin and `smugan.opencode.json` in OpenCode). Codex's `config.toml` is only read, and `opencode.json` is not touched.

### What the hooks run

The launcher (`claude/hooks/smugan-hook.mjs`) imports `packages/gate/src/hook.mjs` from the checkout and runs on each event:

| Event | What runs |
|---|---|
| `SessionStart` | Reads `smugan.config.json` and the project to detect use of AI engines; does not run project code. |
| `PreToolUse` on `Bash`/`PowerShell` | Only analyzes the command text; may refuse a command that lowers the forced risk level. |
| `PreToolUse` on `Write`/`Edit`/`MultiEdit` | Smugan's own checks, in process, on the content about to be written; does not run project code. |
| `PostToolUse` on `Write`/`Edit`/`MultiEdit` | The `eslint` installed in the project's `node_modules`, when there is an ESLint config (`hook.eslint`, on by default); with `hook.stop: false`, also the project's `tsc` on the edited file. |
| `Stop` | Smugan's checks again on the files touched in the turn, the `typecheck` or `type-check` script from `package.json` (`npm`/`pnpm`/`yarn run`), the tests (`vitest related` when vitest is installed, otherwise `<package manager> test`) and, without a typecheck script, the `tsc` from the project's `node_modules`. Never a build. |

**This runs code from the open project on your machine**, as your user: `package.json` scripts, ESLint config files, the tests and the binaries in `node_modules`. Treat an unknown repository the way you would treat running `npm test` in it. Each run has a deadline (`hook.timeoutMs`, 30 s by default; `hook.stop.timeoutMs`, 120 s); when it expires, the process is terminated; for project scripts, the whole tree (`taskkill /T /F` on Windows, `SIGKILL` on the process group elsewhere). The checks can be turned off per project in `smugan.config.json` (`hook.eslint`, `hook.typecheck`, `hook.stop.typecheck`, `hook.stop.tests` or `hook.stop: false`).

In addition, the hooks and the CLI call `git` (for example `git show`, `git ls-files`, `git grep`) in the edited file's repository.

### Network

No code in the installer, the launchers or `packages/gate/src` makes network calls (no `fetch`, `http`, `https` or `net`). What reaches the network is what you or the project run: the `npm ci` that installs the dependencies and any project script run by `Stop`. The `smugan-ai-research` agent, when a model invokes it, reads documentation on the web through the host's own tools.

### Stored state

- System temp directory (`os.tmpdir()`): `smugan-turn-*`, `smugan-session-*`, `smugan-stopdebt-*`, `smugan-report-*` and `smugan-events-*` (per-session JSON, used by `smugan why`), plus `smugan-baseline/` and `smugan-tsbuild/` (eslint and tsc caches) and `smugan-clones-*.json` (the repository's function index).
- In the project: temporary files `.smugan-tsc-*.json` and `.smugan-tscbase-*`, deleted after use; `.smugan.local/` (the `smugan context` cache), which the command itself adds to `.git/info/exclude`.
- User cache (`LOCALAPPDATA`, `XDG_CACHE_HOME` or `~/.cache`, or `SMUGAN_CACHE_DIR`): `smugan/risk/` (levels forced with `smugan risk`, which expire) and `smugan/context/` when `.smugan.local/` cannot be used.
- `~/.smugan/ai-guides/` (or `SMUGAN_AI_GUIDES_DIR`): guides written by `smugan ai-guide --write`.

None of this is sent off the machine.

### Dependencies

`packages/gate/package.json` pins three dependencies to exact versions, with no transitive dependencies in `package-lock.json`: `jsonc-parser@3.3.1`, `smol-toml@1.9.0` and `yaml@2.9.1`. The documented installation uses `npm ci --ignore-scripts`. Without them, only context preparation is unavailable; the installer warns about it.

### Failing open

An internal Smugan error never blocks the session: the launcher exits with code 0 and shows that the verification did not pass. Smugan is a quality layer, not a security boundary.

## Scope

In scope:

- Code execution or file writes beyond what is described above, for example triggered by the content of an edit, a file name or the text of a command.
- An installer or adapter that destroys or exposes user configuration (`settings.json`, `hooks.json`, `CLAUDE.md`, `AGENTS.md`).
- State stored outside the locations above, or with sensitive content that should not be there.
- Bypassing the risk-level guard (`smugan risk`) with a command it should refuse.
- Leaking private data through `scripts/public-guard.mjs`, which must not print terms or the matched text.

Out of scope:

- What the project's own scripts, tests and configs do when `Stop` runs them: that is the documented behavior.
- A Smugan check that misses a security problem in the user's code (open a regular issue).
- The behavior of the model or the host (Claude Code, Codex, Grok Build, OpenCode, Antigravity) itself.
- Vulnerabilities in dependencies without a path exploitable through Smugan.
