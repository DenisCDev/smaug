# Contributing

Vulnerabilities do not go through here: see [SECURITY.md](SECURITY.md).

## How a contribution is accepted

The project has one maintainer (see [SECURITY.md](SECURITY.md)), who reviews, approves and merges every pull request.

1. **Issue first for big changes.** Before writing code for a new check, a new adapter, a change to what a hook outputs or blocks, a new dependency, or anything that breaks compatibility, open an issue with the **Proposal** form describing the problem and the proposed behavior, and wait for the maintainer to agree on the direction. A bug fix, a test, or a docs correction can go straight to a pull request.
2. **Branch and pull request.** Fork the repository, create a branch from `main` named for the concern (`fix/...`, `feat/...`, `docs/...`), and open the pull request against `main`. One concern per pull request; fill in the template.
3. **Checks.** CI (`ci.yml` and `public-guard.yml`) must pass on the pull request. Run the steps under [Checks](#checks) locally first, plus those under [Documentation site](#documentation-site) when the change touches `site/`.
4. **Review.** The maintainer's approval is the one required approval. A review may ask for changes; push them to the same branch. Only the maintainer merges.

What blocks a merge:

- a failing CI check, or a step from the template left unchecked without a reason;
- a behavior change without the test described under [Tests](#tests);
- a change users can notice without its `CHANGELOG.md` entry and its update to the documentation site in both languages;
- a big change that did not go through an issue first.

## Environment

- Node 22 or newer (`engines` in `packages/gate/package.json`). CI runs Node 22 and 24, on Ubuntu and Windows.
- Git. On Windows, the commands below run in Git Bash or PowerShell.

```sh
git clone https://github.com/DenisCDev/smugan.git
cd smugan
npm ci --ignore-scripts --prefix packages/gate
git config core.hooksPath .githooks
```

The last command enables the repository's hooks: `commit-msg` checks identity and message, and `pre-push` checks each commit about to be pushed. Both run `scripts/public-guard.mjs`, which blocks local machine paths, internal folders and private terms.

## Checks

The same steps as `.github/workflows/ci.yml` and `public-guard.yml`, from the repository root.

Engine (`packages/gate`):

```sh
cd packages/gate
node --test
npm i --no-save --ignore-scripts --silent typescript@5.7.3 @types/node@22
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext --types node --typeRoots node_modules/@types ../../evals/run.mjs ../../evals/ab.mjs ../../evals/no-network.mjs ../../evals/test/run.test.mjs
cd ../..
node packages/gate/bin/smugan.mjs check
node --test evals/test/run.test.mjs
```

For `@types/node`, use your Node's major version. `smugan check` is the gate itself checking the repository; the evals test uses a fake `claude` and spends no tokens.

Publication guard:

```sh
node --test scripts/public-guard.test.mjs
node scripts/public-guard.mjs
```

Without arguments, the guard checks the names and contents of the files in the index (`git add` first). CI also checks each pushed commit with `--commits` and `--ref`; on a PR from a fork, only the generic patterns run, because the private list is a CI secret.

## Adapters

Each adapter (`adapters/codex`, `grok`, `opencode`, `antigravity`) runs the engine from this checkout, so a change to the gate can break a host. With the gate's dependencies installed:

```sh
cd adapters/codex
node --test
node ../../packages/gate/bin/smugan.mjs check
```

Repeat for all four. The tests install into temporary directories (variables such as `CODEX_HOME`), never into your `~/`.

## Documentation site

The site in `site/` (Astro Starlight) is published at <https://smugan-docs.vercel.app>. English pages live under `site/src/content/docs/`, and their Brazilian Portuguese translations under `site/src/content/docs/pt-br/`, at the same path. Astro needs Node 22.12 or newer (`engines` in `site/package-lock.json`).

```sh
cd site
npm ci
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

CI does not build the site, so run `npm run build` before opening a pull request that touches `site/`; invalid frontmatter or a config error fails there. A new page also needs its entry in the `sidebar` of `site/astro.config.mjs`.

A change users can notice updates the page that describes it in both languages, in the same pull request. If you cannot write one of the two, say so in the pull request and the maintainer completes it before merging.

## Tests

- Bug fix: one test that fails without the fix.
- New behavior: one test at the entry point (hook, CLI or installer).
- A text edit or a rename with no behavior change needs no test.
- A test does not mirror the implementation; it proves what the change promises.

## Commits and pull requests

- Messages in English, in the `type: observable outcome` format, with `feat`, `fix`, `docs`, `test`, `perf`, `chore` or `revert`, and an optional scope such as `fix(site):` or `fix(adapters):`. Example: `fix: second Stop check respects the deadline and says when it was skipped`.
- When the subject is not enough, the body states the previous behavior and its consequence, the new behavior and why it is correct, grouped by concern, and ends with the checks that ran and their results.
- A change users can notice goes into `CHANGELOG.md`, under `## [Unreleased]`, and into the documentation site in English and Brazilian Portuguese (see [Documentation site](#documentation-site)).
- A release bumps the `version` in `packages/gate/package.json` and the one in `.claude-plugin/plugin.json` together (a test checks this); without it, users who already have the plugin do not receive the update. The plugin icon (`.claude-plugin/icon.png`, with its source in `icon.svg`) enters the official listing only on the first submission to the developer portal: replace it before that submission, not after.
- One PR per concern, from a branch such as `docs/external-api-errors`. Fill in the PR template; CI must pass. Review and merge follow [How a contribution is accepted](#how-a-contribution-is-accepted).
- By contributing, you agree that your contribution is distributed under the [MIT license](LICENSE).
