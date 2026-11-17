---
title: Repository structure
description: Layout of the repository and how to verify Smugan itself.
---

```text
smugan/
├── .claude-plugin/            Claude Code plugin and marketplace manifests
├── .github/workflows/         CI for the engine and adapters, and the pgTAP proof of the access model
├── .claude/skills/smugan-rules this repository's skill for writing and testing rules
├── claude/                    CLAUDE.md, rules, hooks, reviewers, skills and response style
├── packages/gate/             checks, hooks, version context, contract, doctor and why
├── evals/                     scenarios, fixtures and harness that measure the rules with and without them
├── adapters/                  integrations with Codex, Antigravity, OpenCode and Grok
├── templates/                 pgTAP, E2E, observability, security and CI
├── docs/                      version context validation walkthrough and quality report
├── CHANGELOG.md               changes in each version, across all packages
├── smugan.config.json         Smugan configuration for this repository itself
└── install.sh                 global installation for Claude Code
```

## Verifying Smugan itself

These are the same steps as continuous integration, which runs on Linux and Windows
with Node 22 and 24:

```bash
npm ci --ignore-scripts --prefix packages/gate

# engine: tests, strict-mode types and Smugan checking its own code
(cd packages/gate && node --test)
(cd packages/gate && npm i --no-save --ignore-scripts typescript@5.7.3 @types/node@22 \
  && node node_modules/typescript/bin/tsc -p tsconfig.json)
node packages/gate/bin/smugan.mjs check

# rules harness with a fake claude, no tokens
node --test evals/test/run.test.mjs

# adapters, each with this checkout's engine
for adapter in codex antigravity opencode grok; do
  (cd adapters/$adapter && node --test && node ../../packages/gate/bin/smugan.mjs check)
done
```

A separate workflow proves the access model's behavior: a policy that allows
improper reads must fail; a policy limited to the owner must pass.

See the [main workflow](https://github.com/DenisCDev/smugan/blob/main/.github/workflows/ci.yml), the
[database access test](https://github.com/DenisCDev/smugan/blob/main/.github/workflows/pgtap-smoke.yml) and the
[changelog](https://github.com/DenisCDev/smugan/blob/main/CHANGELOG.md) for what changed in each version.
