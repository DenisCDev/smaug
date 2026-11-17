---
title: Google Antigravity
description: Instale o smugan no Google Antigravity, veja como cada hook do Claude Code corresponde aos hooks do Antigravity, as armadilhas do contrato de hooks, por que os revisores são manuais e os limites conhecidos.
---

O adaptador do Antigravity fica em [`adapters/antigravity/`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/README.md). Ele mira o [Google Antigravity](https://antigravity.google) com o mesmo engine, as mesmas checagens e os mesmos revisores da instalação do Claude Code.

O arquivo de steering, os subagentes, as duas skills e as regras vêm da raiz do repositório no momento da instalação. As regras são copiadas para `config/rules/` e adaptadas para apontar para os guias deste host. Rode o instalador de novo depois de atualizar o smugan.

O Antigravity tem hooks com poder de veto tanto na escrita quanto no fim do turno, então, depois do próprio Claude Code, esta é a porta mais completa.

## Instalação

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/antigravity && ./install.sh    # or: node tools/install.mjs
```

O instalador ([`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/tools/install.mjs)) é idempotente e escreve em `~/.gemini/`:

| Destino | Conteúdo |
|---|---|
| `AGENTS.md` | Bloco gerenciado gerado a partir de [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) mais [`AGENTS.antigravity.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/AGENTS.antigravity.md). Se `agy --version` informar um build anterior ao 1.20.3, o bloco vai para o `GEMINI.md`. Um `GEMINI.md` compartilhado com o Gemini CLI nunca é destruído. |
| `config/rules/` | As regras de stack, adaptadas aos caminhos deste host |
| `config/agents/critic.md`, `flow-critic.md` | Frontmatter reescrito para o Antigravity: `name`, a `description` completa, uma lista de ferramentas de revisor, `model: inherit`, `commandExecutionPolicy: auto`, `subagent: true` |
| `config/skills/smugan/` | A skill de auditoria no formato de frontmatter do Antigravity |
| `config/skills/smugan-build/` | A skill de preparação com os guias |
| `smugan/hooks/` | O lançador, `normalize.mjs`, `rule-teach.mjs` e `smugan.paths.json` (caminho do gate, pasta de regras, o caminho absoluto do `node`, idiomas e partes desativadas) |
| `config/hooks.json` e `antigravity-cli/hooks.json` | A entrada `smugan` mesclada nas duas superfícies; um lançador em disco, dois registros |

`smugan-ai-research` e `smugan-finish` não são instalados.

| Variável | Efeito |
|---|---|
| `SMUGAN_AGY_HOME` | Substitui `~/.gemini` |
| `SMUGAN_DIR` | Checkout do smugan em outro lugar |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_DISABLE` | Idiomas e partes desativadas na instalação |
| `SMUGAN_GATE_DIR`, `SMUGAN_RULES_DIR` | No lançador, substituem o engine e a pasta de regras registrados no `smugan.paths.json` |
| `SMUGAN_TEACH=0` | Desliga a entrega das regras |
| `SMUGAN_AGY_DUMP=<folder>` | O lançador grava ali o payload bruto de cada evento |

Para desligar tudo sem desinstalar, defina `"enabled": false` na entrada `smugan` do `hooks.json`.

## Correspondência de hooks

Registrados em [`antigravity/hooks/hooks.json`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/hooks/hooks.json). `PreToolUse` e `PostToolUse` compartilham o matcher `^(write_to_file|create_file|edit_file|replace_file_content|multi_replace_file_content|apply_patch)$`.

| Componente do smugan | Claude Code | Antigravity | Status |
|---|---|---|---|
| Gate de pré-escrita | `PreToolUse` exit 2 | `PreToolUse` (30 s) com `{"decision":"deny"}`: a escrita morre antes de chegar ao disco | 1:1 |
| Delegação ao eslint/tsc | `PostToolUse` devolve o stderr | `PostToolUse` (180 s) é passivo: a falha fica guardada e é entregue como uma negação única na próxima escrita, ou no fim do turno | Adaptado |
| Selo DONE | `Stop` exit 2 segura o turno | `Stop` (600 s) com `{"decision":"continue"}`: o turno não termina | 1:1 |
| Regras de stack | `paths:` carrega sozinho | O texto completo da regra chega como uma negação única na primeira escrita que ela governa, uma vez por regra por sessão | Adaptado |
| critic / flow-critic | subagentes proativos | subagentes em `~/.gemini/config/agents/`, invocados por você com `invoke_subagent` | Adaptado |
| Skill de auditoria | `~/.claude/skills/smugan/` | `~/.gemini/config/skills/smugan/` | 1:1 |

Aqui não existe evento `SessionEnd`; o estado por turno do lançador expira por idade (12 horas).

### Limite do Stop

Além do limite do gate (uma retenção, duas quando um arquivo crítico foi tocado), o lançador ([`smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/hooks/smugan-hook.mjs)) tem um teto próprio de 4 retenções por turno (`MAX_CONTINUES`). O gate rearma o contador sempre que aparece um novo marcador de turno, então um agente que continua escrevendo arquivos poderia, de outra forma, ser segurado indefinidamente. O teto vale para o turno e é zerado junto com o marcador do gate, para que um turno difícil não desligue a DoD pelo resto da sessão. Quando o limite do gate é atingido, a mensagem diz ao agente para parar de tentar e avisar o usuário. Um turno cujo `terminationReason` indique cancelado, abortado, interrompido, encerrado, timeout, cota, rate limit, negado ou recusado, ou que traga um erro, nunca é segurado.

### Por que os revisores não rodam sozinhos

No plano gratuito, a cota é medida em "trabalho de agente", é opaca e já foi cortada várias vezes sem aviso; o fórum oficial tem relatos de bloqueios de dias depois de 20–30 minutos de uso. Um revisor LLM em todo turno queimaria essa cota.

Por isso a divisão é explícita: gate, lint e Definition of Done rodam como scripts locais e não custam nada; os revisores ficam reservados para mudanças arriscadas (auth, dados pessoais ou financeiros, dinheiro, migrations, operações destrutivas). O steering instalado diz isso e fecha com "everything else: the mechanical gate IS the review".

## O contrato de hooks e suas armadilhas

- **Uma saída diferente de zero é fail-closed.** Já se viu um hook quebrado negar todas as chamadas de ferramenta de uma sessão. O lançador sai com 0 em todos os caminhos e fala só por JSON no stdout; o stderr fica vazio de propósito.
- **`{}` não é uma permissão.** No `PreToolUse`, o campo `decision` é obrigatório; o lançador emite um `{"decision":"allow"}` explícito.
- **O schema mudou entre versões**: `decision`/`reason` hoje, `allow_tool`/`deny_reason` em um guia de junho de 2026. O lançador emite os dois no mesmo objeto; o engine é em Go e ignora chaves desconhecidas.
- **Os nomes de campo de `toolCall.args` não são documentados.** O engine é o Cascade (Windsurf), que historicamente usa `TargetFile`/`CodeContent`/`ReplacementChunks`. O [`normalize.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/antigravity/antigravity/hooks/normalize.mjs) aceita PascalCase, camelCase e snake_case e decide pelo formato, não pelo nome da ferramenta. Um formato conhecido pela metade (um chunk cujo texto de substituição não é reconhecido) é descartado em vez de virar uma exclusão. O `matcher` do hook filtra, sim, por nome, e é por isso que ele lista aliases plausíveis; adicionar um nome é uma linha.
- **O caminho do comando precisa ser absoluto** (um relativo sai com 127), e o `timeout` nunca pode ser `0` (mata o processo na hora). O instalador grava o caminho absoluto do `node` que o executou.
- Os motivos de negação são limitados a 24.000 caracteres, com a instrução colocada primeiro para que o truncamento nunca a corte.

Se uma escrita escapar algum dia, rode com `SMUGAN_AGY_DUMP=<folder>` para ver exatamente quais nomes de campo chegaram.

## Limites conhecidos

- **A aderência a texto é fraca nesta plataforma.** O fórum oficial documenta o agente ignorando regras, skills e até hooks, e narrando que os seguiu quando não seguiu. Tudo o que precisa valer vive em um hook, não em prosa, e o steering é curto de propósito.
- **Limite de 12.000 caracteres por arquivo de regra.** O instalador aborta se o steering passar disso (o Antigravity trunca em silêncio além desse ponto) e avisa a partir de 8.000.
- **O `PostToolUse` não fala.** O resultado do eslint/tsc chega adiado, na próxima escrita ou no fim do turno.
- **Os revisores não se invocam sozinhos.** A plataforma não suporta isso, e no plano gratuito sairia caro de qualquer forma.
- **Os nomes das ferramentas podem mudar** em uma release. O `matcher` já inclui aliases plausíveis; adicionar um é uma linha.

## Verificação

Automatizada, sem o Antigravity instalado:

```bash
npm test
```

O contrato é simulado (payload em camelCase no stdin, decisão em JSON no stdout) e o gate roda de verdade. Os [testes](https://github.com/DenisCDev/smugan/tree/main/adapters/antigravity/test) cobrem a tabela de aliases (PascalCase, camelCase, snake_case, chunks, vários arquivos, formato vencendo o nome); `{"decision":"allow"}` explícito e o schema duplo na negação; saída 0 com entrada corrompida, engine ausente e evento desconhecido; um `toolCall` nulo; o `post` registrando o arquivo tocado; a entrega única de dívida adiada; e o `Stop`: segurar o turno, liberá-lo quando verde, o limite do gate, o limite de 4 por turno e o reset dele, a expiração de contadores velhos e nunca segurar um turno cancelado.

Com o Antigravity instalado (reinicie as sessões dele antes):

1. Peça uma migration `.sql` sem RLS. A chamada de ferramenta falha com o motivo do smugan.
2. Depois de qualquer escrita, `<tmpdir>/smugan-turn-<conversationId>.json` precisa existir e listar o arquivo. Se não existir, o `PostToolUse` não está casando: ajuste o `matcher` e reinstale.
3. Quebre o typecheck e deixe o turno terminar. Chega `smugan stop:` e o agente não consegue terminar.
4. Primeira edição de um `*.test.ts`. Chega uma negação única com o texto completo da regra.
5. Cancele um turno no meio. Nada segura a sessão.
