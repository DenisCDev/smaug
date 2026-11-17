---
title: Grok Build
description: Instale o smugan no Grok Build CLI da xAI, veja como cada hook do Claude Code corresponde ao contrato de hooks do Grok Build, o desenho de feedback adiado e os limites conhecidos.
---

O adaptador do Grok Build fica em [`adapters/grok/`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/README.md). Ele mira o [Grok Build](https://docs.x.ai/build/overview), a CLI de agente de código da xAI, e usa o mesmo engine de checagens, as mesmas regras de stack, os mesmos revisores e a mesma skill de auditoria da instalação do Claude Code.

Nada do steering é duplicado no adaptador. O engine, as regras de stack, os subagentes `critic` e `flow-critic`, as skills `smugan` e `smugan-build` e o corpo do `AGENTS.md` são lidos da raiz do repositório no momento da instalação. Só as partes específicas do Grok ficam no adaptador: o lançador de hooks, o `rule-teach.mjs`, o apêndice `AGENTS.grok.md`, as skills de fallback e o instalador.

## Instalação

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/grok && ./install.sh    # Git Bash on Windows, or: node tools/install.mjs
```

O engine e as regras vêm do mesmo checkout, dois níveis acima. O instalador ([`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/tools/install.mjs)) é idempotente e escreve em `~/.grok/`:

| Destino | Conteúdo |
|---|---|
| `AGENTS.md` | Bloco gerenciado gerado a partir de [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md): caminhos reescritos, a seção Stack rules substituída e o apêndice [`AGENTS.grok.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/grok/AGENTS.grok.md) adicionado. A instalação aborta se faltar uma âncora esperada. |
| `rules/` | As regras de stack de `claude/rules/` (`ui-ptbr.md` só com um idioma de UI em português) |
| `agents/critic.md`, `agents/flow-critic.md` | Copiados de `claude/agents/` sem a linha `tools:`, já que os nomes de ferramenta do Claude não existem no Grok Build |
| `skills/smugan/` | A skill de auditoria com `~/.claude/` reescrito para `~/.grok/` (inclui a dimensão `flows`) |
| `skills/smugan-build/` | A skill de preparação com os guias |
| `hooks/` | O lançador, `rule-teach.mjs`, `smugan.json` (o registro do hook) e `smugan.paths.json` apontando para o gate do checkout |

`smugan-ai-research` e `smugan-finish` não são instalados por este adaptador (o [`adapters/shared/install-tree.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/shared/install-tree.mjs) exclui o primeiro).

Atualizar o repositório e rodar o instalador de novo sincroniza tudo.

| Variável | Efeito |
|---|---|
| `SMUGAN_DIR` | Checkout do smugan em outro lugar: `SMUGAN_DIR=/path/to/smugan ./install.sh` |
| `GROK_HOME` | Substitui `~/.grok` |
| `SMUGAN_GROK_FALLBACK_SKILLS=1` | Instala `/critic` e `/flow-critic` como skills em vez de subagentes e remove os arquivos de agente |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_DISABLE` | Idiomas e partes desativadas na instalação, resolvidos pelos helpers compartilhados do instalador |
| `SMUGAN_GATE_DIR` | O lançador usa outro engine em vez do que está no `smugan.paths.json` |
| `SMUGAN_TEACH=0` | Desliga o ensino das regras |

Hooks pessoais em `~/.grok/hooks/*.json` não exigem confiança; hooks de projeto exigem `/hooks-trust`.

## Correspondência de hooks

Com base na documentação da xAI sobre [hooks](https://docs.x.ai/build/features/hooks), [subagentes](https://docs.x.ai/build/features/subagents), [configurações](https://docs.x.ai/build/settings) e [skills](https://docs.x.ai/build/features/skills-plugins-marketplaces). Registrados em [`grok/hooks/hooks.json`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/grok/hooks/hooks.json), todos sem matcher:

| Componente do smugan | Claude Code | Grok Build | Status |
|---|---|---|---|
| Regras globais | `~/.claude/CLAUDE.md` | bloco gerenciado em `~/.grok/AGENTS.md` gerado na instalação | 1:1 |
| Regras de stack | `~/.claude/rules/` carregadas por `paths:` | `~/.grok/rules/` mais rule-teach: a primeira edição da sessão de um arquivo que casa com uma regra não lida é negada uma vez, apontando para a regra | Adaptado: uma negação por regra por sessão |
| Gate de pré-escrita | `PreToolUse` exit 2 | `PreToolUse` (30 s): `{"decision":"deny","reason"}` no stdout e exit 2 | 1:1 |
| Delegação ao eslint/tsc | `PostToolUse` exit 2 devolve o stderr | a saída do `PostToolUse` (120 s) é ignorada; a falha fica guardada por sessão e é entregue como uma negação única no próximo `PreToolUse` | Adaptado: adiado |
| Selo DONE | `Stop` exit 2 segura o turno | o `Stop` (300 s) roda a DoD mecânica completa (nova verificação, typecheck, testes); um veredito vermelho fica guardado e é entregue como negação na primeira ação do turno seguinte | Adaptado: um turno atrasado |
| critic | subagente em `~/.claude/agents/` | subagente em `~/.grok/agents/`; `SMUGAN_GROK_FALLBACK_SKILLS=1` o instala como skill | 1:1 |
| flow-critic | subagente | igual ao critic | 1:1 |
| Auditoria `/smugan` | `~/.claude/skills/smugan/` | `~/.grok/skills/smugan/` | 1:1 |
| Limpeza de estado | o marcador de turno morre no Stop | o `SessionEnd` (10 s) apaga os quatro marcadores (turno, falhas já retidas, pendências, regras); a dívida do Stop precisa sobreviver ao fim do turno | Adaptado |
| Instalação dos hooks | mesclagem no `settings.json` | `~/.grok/hooks/smugan.json` independente | Mais simples |
| `smugan init`, pgTAP, E2E, CI | templates do repositório | idênticos, independentes de agente | Reuso direto |

### O contrato de hooks

O que o lançador ([`grok/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/grok/hooks/smugan-hook.mjs)) implementa:

- **stdin em camelCase** (`hookEventName`, `sessionId`, `toolName`, `toolInput`) e ambiente `GROK_*`. O lançador normaliza para o formato que o engine espera e também aceita o formato snake_case do Claude, já que o Grok Build lê arquivos de hook do Claude Code.
- **Os nomes de ferramenta podem ser nativos do Grok.** A documentação mapeia nomes do Claude nos matchers, mas não lista os nativos, então o hook se registra sem matcher e o lançador decide pelo formato do payload: `edits[]` é MultiEdit, `old_string`/`oldString` é Edit, `content` mais um caminho é Write.
- **`apply_patch`** (o conjunto de ferramentas do Codex) leva todos os arquivos em um único texto `patch`. Cada arquivo é julgado separadamente, com os caminhos resolvidos a partir do `cwd` da sessão. Um patch que o host cortou (`toolInputTruncated`, acima de 128 KiB) é recusado, já que os últimos arquivos dele não podem ser vistos. Uma ferramenta que não escreve arquivo sai em milissegundos.
- **O `PreToolUse` é o único evento que bloqueia**: exit 0 permite, exit 2 nega, e a negação fala por JSON no stdout. Os timeouts são em segundos (padrão 5); o smugan usa 30/120/300/10 para Pre/Post/Stop/SessionEnd. O Stop espelha os 300 s do fragmento do Claude porque o orçamento interno do gate é de 120 s por script.
- **Eventos passivos têm o stdout ignorado**, `UserPromptSubmit` incluído. Por isso o `post` e o `stop` guardam as falhas em `smugan-grok-pending-<sid>.json` na pasta temporária, e o próximo `pre` entrega tudo em uma única negação marcada como "deferred".
- **Builds mais novos dizem mais.** O guia de hooks que vem com o Grok Build 1.0.77 (`~/.grok/docs/user-guide/10-hooks.md`) documenta um `Stop` que pode bloquear o fim do turno e um `PostToolUse` cujo motivo chega ao modelo ao lado do resultado da ferramenta. O adaptador ainda não usa nenhum dos dois; guardar e entregar no próximo `PreToolUse` funciona nos dois casos. O `Stop` extra que esse guia descreve no fim da sessão (`reason` diferente de `end_turn`, 1,5 s) é pulado, já que não sobra turno a quem avisar.
- **Fail-open por desenho da plataforma**: timeout, crash ou saída malformada não bloqueiam.
- Arquivos sob `GROK_HOME` (memória, `AGENTS.md`, regras instaladas) não são tratados como código do projeto.

### Ordem dentro do `pre`

A dívida adiada é entregue primeiro, depois o ensino das regras de stack, depois a checagem do gate, para que uma edição receba no máximo uma negação.

## Limites conhecidos

- **O selo DONE chega um turno atrasado.** O `Stop` roda a DoD mecânica, mas não segura o turno. A falha vira uma negação na primeira ação (qualquer ferramenta) do turno seguinte, e um veredito guardado só é descartado depois de entregue uma vez. Quando outro fim de turno falha antes que alguma chamada de ferramenta o leia, o veredito novo é guardado ao lado e os dois são entregues juntos; os mais antigos são mantidos, até 32 KiB deles, e o primeiro é o único que nomeia o que o gate lista uma vez por turno. Quando o turno seguinte escreve algo, o fim dele é verificado de novo; quando não escreve nada, ele é liberado com um aviso. Um turno é segurado uma vez, ou duas quando tocou um arquivo crítico, e o segundo veredito de um turno assim se junta ao primeiro quando nenhuma chamada de ferramenta veio entre eles. Rodar as verificações antes de declarar pronto é o único selo no mesmo turno.
- **O formato do arquivo de agente é inferido, não documentado.** A documentação da xAI confirma `~/.grok/agents/` e o gerenciamento por `/agents`, mas não o formato do arquivo. A instalação é aditiva, e o fallback com skills está a uma variável de ambiente de distância.
- **Latência no fim do turno.** O Stop paga por gate, typecheck e testes (limite externo de 300 s). O orçamento interno do gate é configurável por projeto no `smugan.config.json`: `hook.stop.timeoutMs`, `typecheck: false`, `tests: false`.
- **Nomes de ferramenta não documentados.** A inferência por formato cobre qualquer ferramenta que escreve um arquivo com os campos habituais; um formato de edição exótico passa sem verificação (fail-open).
- **O canal adiado é de melhor esforço.** Eventos passivos concorrentes na mesma sessão podem perder uma entrada (a última escrita vence, sem lock). A checagem falha de novo no próximo toque no arquivo ou no próximo Stop.

## Verificação

Automatizada:

```bash
npm test    # runs the real launcher and installer against the repository's gate
```

Os [testes do lançador](https://github.com/DenisCDev/smugan/blob/main/adapters/grok/test/launcher.test.mjs) cobrem um payload em camelCase com nome de ferramenta nativo, a inferência de Edit pelo formato, todos os arquivos de um `apply_patch` e um patch truncado, o pulo de arquivos sob `$GROK_HOME`, o ciclo de negação adiada, o Stop delegando a DoD ao gate, a limpeza no SessionEnd, o ensino das regras (uma vez por regra por sessão, arquivos da pasta temporária ignorados, `SMUGAN_TEACH=0`) e o instalador (nenhum `~/.claude/` no `AGENTS.md`, agentes sem `tools:`, idempotência, fallback, âncora ausente abortando).

Com o Grok Build instalado:

1. Reinicie as sessões do Grok Build.
2. Rode `grok inspect` ou abra a aba `/hooks`. O hook `smugan` precisa aparecer em PreToolUse, PostToolUse, Stop e SessionEnd.
3. Confira se o `/agents` lista `critic` e `flow-critic`. Se não listar, reinstale com `SMUGAN_GROK_FALLBACK_SKILLS=1` para usar `/critic` e `/flow-critic` como skills.
4. Auditoria profunda em uma sessão: `/smugan`.
