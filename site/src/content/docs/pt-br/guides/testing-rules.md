---
title: Testando as próprias regras
description: O harness de evals que mede cada regra com e sem ela.
---

Uma regra em Markdown é uma afirmação de que ela muda o que o agente faz. O harness em
`evals/` mede isso do jeito que o Superpowers mede as próprias skills: o mesmo pedido
roda em uma sessão real do Claude Code com a regra e sem ela. A métrica é o que o gate
conta sem depender de opinião: quantas vezes o hook bloqueou nas regras do cenário e
quantas violações sobraram na entrega. Para comportamento que o gate não enxerga, como
o `critic` encontrar uma falha de autorização plantada, o cenário define dois padrões:
o que a resposta precisa dizer e o que a desqualifica. Sozinho, "encontrou a falha"
também casa com "não há falha".

```bash
node evals/run.mjs --scenario all --dry-run       # what would run
node evals/run.mjs --scenario db-naming --reps 3  # real sessions: costs tokens
```

Cada sessão usa o próprio `CLAUDE_CONFIG_DIR`, instalado pelo `install.sh`, e por isso
precisa de `CLAUDE_CODE_OAUTH_TOKEN` (do `claude setup-token`) ou de
`ANTHROPIC_API_KEY`. Os resultados vão para `evals/results/`, fora do Git.

A CI roda o harness inteiro com um `claude` falso, sem tokens: instalação real,
remoção real da regra, projeto real e `smugan check` na entrega.

Para comparar duas versões do Smugan, `--tasks` roda pedidos comuns de código, sem
`/smugan`, neste checkout e em uma ref do Git instalada pelo `install.sh` dessa ref.
Cada tarefa em `evals/tasks/` tem um nível (trivial, normal, crítico ou código com LLM)
e uma suíte oculta que só entra no projeto depois da sessão: se ela falha, a entrega
levou um defeito. O harness mede tempo de parede, custo, paradas (bloqueios de fim de
turno e perguntas do agente), testes adicionados e, nas tarefas de LLM, quantas vezes
os testes do agente tentaram usar a rede, que fica desligada. No fim, ele imprime a
regra de decisão: tempo e custo caem 25% ou mais, paradas caem 50% ou mais, testes nas
tarefas de LLM caem 50% ou mais sem chamadas de rede, nenhum defeito escapado a mais no
crítico e no máximo um a mais em vinte no trivial e no normal.

```bash
node evals/run.mjs --tasks all --baseline main --reps 3   # real sessions: costs tokens
```

Poucas tarefas não pegam diferenças sutis: o resultado indica direção. Uma tarefa nova
é um arquivo JSON em `evals/tasks/` e duas pastas em `evals/fixtures/`, o projeto e a
suíte oculta. Confira se a suíte falha no projeto sem a correção. Com `prompts` em vez
de `prompt`, a tarefa roda vários pedidos em sessões separadas sobre o mesmo projeto,
como um PR que se apoia no anterior; tempo e custo se somam entre as sessões.

Um cenário pode remover um único item de um arquivo instalado (`"items":
["agents/critic.md#Contract drift."]`, pelo rótulo em negrito) e pode medir uma regra
que ainda não está instalada: `draft` aplica um texto de `evals/drafts/` só no braço
com a regra, e o outro braço é a instalação como está. Com `"addedLines": true`, o
cenário conta as linhas que a sessão adicionou. O bloco de armadilhas do SlopCodeBench
é montado assim:

```bash
node evals/run.mjs --scenario claude-md-gotchas --reps 3   # real sessions: costs tokens
```

A skill de projeto `.claude/skills/smugan-rules` conduz qualquer mudança de regra neste
repositório pelo ciclo de writing-skills do Superpowers:

1. um cenário que falha sem a regra;
2. o menor texto que o resolve, no lugar mais estreito possível;
3. a rodada que fecha as brechas;
4. os números dos dois braços no CHANGELOG.
