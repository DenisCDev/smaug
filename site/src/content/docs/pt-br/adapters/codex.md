---
title: OpenAI Codex
description: Instale o smugan no Codex CLI e no app desktop, veja como cada hook do Claude Code corresponde a um hook do Codex, o passo manual de confiança e os limites conhecidos.
---

O adaptador do Codex fica em [`adapters/codex/`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/README.md). Ele cobre tanto o Codex CLI quanto o app desktop, que embutem o mesmo binário e leem a mesma pasta `~/.codex`.

Dos quatro adaptadores, o Codex é o mais próximo do Claude Code: bloqueia uma escrita antes que ela aconteça, devolve texto ao modelo depois dela e segura o fim do turno. Ele também consegue injetar contexto sem negar a chamada de ferramenta, então as regras de stack chegam sem custar uma chamada negada.

## Instalação

```bash
cd adapters/codex && ./install.sh
```

O [`install.sh`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/install.sh) só confere se o `node` está no `PATH` e passa a vez para o [`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/tools/install.mjs). O checkout do smugan é considerado dois níveis acima do adaptador, a menos que `SMUGAN_DIR` diga outra coisa. No Git Bash ou no Cygwin, os caminhos são convertidos com `cygpath -m` antes de chegar ao node.

O instalador é idempotente. Ele escreve:

| Destino | Conteúdo |
|---|---|
| `~/.codex/AGENTS.md` | Um bloco gerenciado entre os marcadores `smugan:start` / `smugan:end`, gerado a partir de [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) mais [`codex/AGENTS.codex.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/AGENTS.codex.md). O texto fora dos marcadores é mantido. |
| `~/.codex/rules/*.md` | As regras de stack de `claude/rules/` |
| `~/.codex/agents/critic.toml`, `flow-critic.toml` | Papéis de agente do Codex gerados a partir dos agentes `.md`, com `sandbox_mode = "read-only"` e o corpo como `developer_instructions` |
| `~/.codex/hooks/` | O lançador `smugan-hook.mjs`, `rule-teach.mjs` e `smugan.paths.json` (aponta para o `packages/gate` deste checkout) |
| `~/.codex/hooks.json` | Mesclado: grupos anteriores do smugan são substituídos, os outros grupos são mantidos. Um `hooks.json` inválido aborta sem que nada mude nele. |
| `~/.agents/skills/smugan/` | A skill de auditoria, invocada como `$smugan` |
| `~/.agents/skills/smugan-build/` | A skill de preparação com todo o `references/`; o `agents/openai.yaml` é criado com `allow_implicit_invocation: true` só quando não existe |

O `smugan-ai-research` não é instalado: a mensagem que pede por ele só chega ao modelo pelo lançador do Claude Code ([`adapters/shared/install-tree.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/shared/install-tree.mjs), `adapterAgent`). O `smugan-finish` também não é instalado por este adaptador.

Reinstalar atualiza os arquivos distribuídos e mantém arquivos adicionais nas pastas das skills. Metadados e preferências existentes em `smugan-build/agents/openai.yaml` são mantidos. Só a explicação do carregamento de regras no `AGENTS.md` é adaptada ao Codex; o resto do `CLAUDE.md` é igual. O instalador aborta se as âncoras `## Stack rules` ou `## Definition of done` estiverem ausentes do `CLAUDE.md`.

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `CODEX_HOME` | Substitui `~/.codex` no instalador e no lançador |
| `SMUGAN_CODEX_SKILLS_DIR` | Substitui `~/.agents/skills` |
| `SMUGAN_DIR` | Outro checkout do smugan |
| `SMUGAN_GATE_DIR` | Faz o lançador usar outro engine em vez do que está no `smugan.paths.json` |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG` | Idiomas na instalação; sem elas, os valores anteriores do `smugan.paths.json` são mantidos. O `ui-ptbr.md` só é instalado para um idioma de UI em português |
| `SMUGAN_DISABLE` | Lista separada por vírgulas de revisores, skills e regras de stack a deixar de fora; uma skill desativada perde só o `SKILL.md` |
| `SMUGAN_TEACH=0` | Desliga o ensino das regras |

### Dependências

O instalador não baixa nada. Se faltarem os parsers de que o `smugan context` precisa, ele imprime um comando `npm ci --ignore-scripts --prefix "<gateDir>"` com o caminho correto; o gate em si continua funcionando. Sem um binário global, rode o context a partir do checkout registrado:

```bash
node /path/to/smugan/packages/gate/bin/smugan.mjs context --json /path/to/project
```

### Confiando nos hooks (manual)

O Codex recusa hooks não confiáveis. A identidade de cada hook (comando, timeout e matcher) vira um hash e é guardada quando você o aprova (`codex-rs/hooks/src/engine/discovery.rs`). Depois de instalar:

1. Reinicie as sessões do Codex; os hooks são lidos na inicialização.
2. Rode `/hooks` dentro do Codex e marque como confiáveis os quatro hooks do smugan (PreToolUse, PostToolUse, Stop, SessionEnd). Até lá, o gate não roda.

Se uma atualização do smugan muda o comando de um hook, o `/hooks` o mostra como `modified` e ele para de rodar sem aviso até você confiar nele de novo. O instalador escreve grupos byte a byte estáveis para que isso só aconteça quando algo realmente muda.

O `config.toml` é lido, nunca escrito. Se ele tiver `hooks = false` (ou `codex_hooks = false`) em `[features]`, o instalador avisa que o gate fica inerte.

## Correspondência de hooks

Registrados em [`codex/hooks/hooks.json`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/hooks.json):

| Evento do Codex | Matcher | Timeout | Equivalente no Claude Code | Comportamento |
|---|---|---|---|---|
| `PreToolUse` | `^apply_patch$` | 60 s | PreToolUse exit 2 | `permissionDecision: "deny"` com as violações; o patch não é escrito. O ensino das regras vai em `additionalContext`, com ou sem negação. |
| `PostToolUse` | `^apply_patch$` | 120 s | PostToolUse exit 2 (stderr) | As falhas de eslint/tsc do projeto viram `decision: "block"` com o motivo como resultado da ferramenta |
| `Stop` | nenhum | 300 s | Stop exit 2 | `decision: "block"` segura o turno enquanto a Definition of Done estiver vermelha |
| `SessionEnd` | nenhum | 3 s | limpeza do marcador de turno | Apaga os arquivos `smugan-turn-`, `smugan-stopdebt-` e `smugan-codex-rules-` da sessão na pasta temporária |

### apply_patch

Toda edição do Codex viaja como uma única chamada `apply_patch` cujo `tool_input.command` é o envelope V4A bruto. O lançador ([`codex/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/smugan-hook.mjs)) o interpreta com o `packages/gate/src/patch.mjs` do engine em julgamentos por arquivo e resolve caminhos relativos contra o `cwd` da sessão vindo do payload. Arquivos sob `CODEX_HOME` ou `~/.agents` são pulados, por serem estado do próprio Codex.

Um arquivo que o parser não consegue reconstruir continua sendo registrado como tocado. As checagens do projeto rodam no arquivo real em disco depois do patch, e a DoD de fim de turno o examina de novo, então uma falha do parser leva a uma verificação posterior, nunca a um pulo silencioso.

### Limite do Stop

O lançador não adiciona trava de loop própria; vale o limite por turno do engine: uma retenção, duas quando o turno tocou um arquivo crítico (`MAX_STOP_BLOCKS` e o limite de rotina em [`packages/gate/src/hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs)).

### Regras de stack

O [`rule-teach.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/rule-teach.mjs) faz as vezes do carregamento por caminho do Claude Code. No primeiro patch de uma sessão que toca arquivos que casam com regras ainda não lidas, ele injeta os caminhos das regras no contexto, uma vez por regra por sessão. Ele nunca nega. As regras de framework `nextjs`, `astro` e `hono` só casam quando o `package.json` mais próximo lista `next`, `astro` ou `hono`; sem um manifest legível, contam só arquivos `.astro` e `astro.config.*` / `next.config.*`. Uma regra que o projeto desativa na própria config não é ensinada.

### Modo de falha

O lançador falha aberto: um erro interno emite uma `systemMessage` dizendo que o gate está indisponível e que a verificação não passou, e sai com 0.

## Limites conhecidos

- Os hooks vêm ativados por padrão no Codex atual (`features/src/lib.rs`: `hooks` estável, `default_enabled: true`; conferido no build 0.147.0 com `codex features list`). Com `hooks = false` em `[features]`, o instalador avisa e o gate fica inerte; ele nunca modifica o arquivo.
- Escritas feitas por um comando de shell, fora do `apply_patch`, não passam pelo matcher e não são julgadas nem registradas. Não há rede de segurança para esse caminho.
- A [openai/codex#21639](https://github.com/openai/codex/issues/21639) (aberta) relata builds em que os hooks pararam de disparar. Na 0.147.0 eles disparam: com um provedor de modelo falso (a técnica que a própria suíte do Codex usa), um patch que violava RLS foi negado antes de chegar ao disco, um patch limpo foi aplicado, e o Stop segurou o turno com a suíte vermelha até o limite. Se o seu build regredir, tudo continua instalado e inerte até o upstream corrigir.
- Desenvolvido contra o codex-cli 0.147.0, com os schemas de payload e de saída lidos de `codex-rs/hooks/schema/` em `openai/codex@main`.

## Verificação

Automatizada, em um `HOME` isolado:

```bash
cd adapters/codex && node --test
```

Em uma máquina com o Codex, depois de instalar e confiar nos hooks:

1. Peça ao Codex um `apply_patch` criando uma migration sem RLS. O patch é negado com a lista de violações.
2. Introduza um erro de tipo em um projeto com `tsc`. A falha volta como resultado da ferramenta.
3. Termine um turno com a suíte vermelha. O turno é retomado com o relatório da DoD.

As últimas linhas do instalador imprimem os comandos de CLI desta instalação: `node <gateDir>/bin/smugan.mjs check` e `node "<gateDir>/bin/smugan.mjs" context --json <project-path>`.
