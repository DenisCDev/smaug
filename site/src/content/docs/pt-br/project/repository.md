---
title: Estrutura do repositório
description: Organização do repositório e como verificar o próprio Smugan.
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

## Verificando o próprio Smugan

São os mesmos passos da integração contínua, que roda em Linux e Windows
com Node 22 e 24:

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

Um workflow separado comprova o comportamento do modelo de acesso: uma policy que permite
leituras indevidas precisa falhar; uma policy restrita ao dono precisa passar.

Veja o [workflow principal](https://github.com/DenisCDev/smugan/blob/main/.github/workflows/ci.yml), o
[teste de acesso ao banco](https://github.com/DenisCDev/smugan/blob/main/.github/workflows/pgtap-smoke.yml) e o
[changelog](https://github.com/DenisCDev/smugan/blob/main/CHANGELOG.md) para saber o que mudou em cada versão.
