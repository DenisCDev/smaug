---
title: Manifesto do plugin
description: Os manifestos de plugin e de marketplace do Claude Code, as quatro opções do plugin com seus valores e padrões, e o que os hooks do plugin fazem de diferente do install.sh.
---

O repositório também é um plugin do Claude Code. Os manifestos ficam em [`.claude-plugin/`](https://github.com/DenisCDev/smugan/tree/main/.claude-plugin).

## plugin.json

[`.claude-plugin/plugin.json`](https://github.com/DenisCDev/smugan/blob/main/.claude-plugin/plugin.json):

| Campo | Valor |
|---|---|
| `name` | `smugan` |
| `version` | `0.21.0` |
| `description` | Quality gate, stack rules and reviewers for code written with Claude Code |
| `icon` | `./.claude-plugin/icon.png` |
| `license` | MIT |
| `skills` | `./claude/skills/` (`smugan`, `smugan-build`, `smugan-finish`) |
| `agents` | `./claude/agents/critic.md`, `./claude/agents/flow-critic.md`, `./claude/agents/smugan-ai-research.md` |
| `outputStyles` | `./claude/output-styles/` |
| `hooks` | `./claude/hooks/plugin-hooks.json` |

Skills e agentes aparecem com o prefixo do plugin, por exemplo `smugan:smugan-build` e `smugan:critic`.

## marketplace.json

O [`.claude-plugin/marketplace.json`](https://github.com/DenisCDev/smugan/blob/main/.claude-plugin/marketplace.json) declara um marketplace chamado `smugan` com um plugin, `smugan`, cujo `source` é a raiz do repositório (`./`). O id completo do plugin, portanto, é `smugan@smugan`.

Instalação, conforme o [README](https://github.com/DenisCDev/smugan/blob/main/README.md):

```bash
claude plugin marketplace add DenisCDev/smugan
claude plugin install smugan@smugan --scope project
```

## Opções

Declaradas em `userConfig` no `plugin.json`. O Claude Code as entrega a todo hook do plugin como variáveis de ambiente `CLAUDE_PLUGIN_OPTION_*`; o launcher ([`claude/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/smugan-hook.mjs), `pluginLanguage`) as mapeia para as mesmas configurações que o `install.sh` tira das variáveis `SMUGAN_*`.

| Opção | Tipo | Valores | Padrão | Equivalente no install.sh |
|---|---|---|---|---|
| `ui_language` | string | Um código de idioma (`pt-BR`, `en`, `es`…) ou `off`. Com `pt-BR`, entram a regra `ui-ptbr` e a verificação `ui-strings`. | `off` | `SMUGAN_UI_LANG` |
| `reply_language` | string | Um código de idioma, ou `off` para responder no idioma em que você escreve | `off` | `SMUGAN_REPLY_LANG` |
| `profile` | string | `completo` (revisores no modelo da conversa), `economico` (revisores no sonnet), `minimo` (revisores no haiku, sem flow-critic) | `completo` | `SMUGAN_PROFILE` |
| `disable` | string | Lista separada por vírgulas de `critic`, `flow-critic`, `smugan`, `smugan-build`, `smugan-finish` ou nome de regra de stack (`nextjs`, `supabase`…). Vazio ou `none`: nada desligado. | `""` | `SMUGAN_DISABLE` |

O mapeamento de modelos vem de `PROFILE_MODEL` em [`packages/gate/src/profile.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/profile.cjs). O manifesto observa que revisores mais baratos encontram menos e que os perfis menores são pensados para tarefas pequenas.

As opções podem ser definidas na instalação:

```bash
claude plugin install smugan@smugan --scope project --config ui_language=pt-BR --config reply_language=pt-BR
```

Valores inválidos não derrubam a sessão. Um código de idioma inválido desliga os dois idiomas, um perfil inválido volta para `completo` e uma lista `disable` inválida não desliga nada; cada caso é reportado uma vez como `systemMessage` no início da sessão.

O `SMUGAN_REVIEW_MODEL` continua valendo no plugin, mas só com `sonnet`, `opus`, `haiku`, `fable` ou `inherit`; qualquer outro valor é reportado e o modelo do perfil é usado.

A lista `"disable"` do próprio projeto, em `smugan.config.json` ou `smugan.local.json`, é somada à lista da opção nas sessões desse projeto.

## Hooks do plugin

O [`claude/hooks/plugin-hooks.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/plugin-hooks.json) executa o mesmo launcher do `install.sh`, a partir do checkout (`${CLAUDE_PLUGIN_ROOT}/claude/hooks/smugan-hook.mjs`), com um segundo argumento, `plugin`.

| Evento | Matcher | Comando | Timeout | No install.sh? |
|---|---|---|---|---|
| `SessionStart` | `startup\|clear\|compact` | `steer plugin` | 10 s | Não |
| `SessionStart` | nenhum | `session plugin` | 30 s | Sim (`session`) |
| `SessionStart` | `startup` | `deps plugin` | 120 s | Não |
| `PreToolUse` | `Agent\|Task\|Skill` | `agent plugin` | 10 s | Não |
| `PreToolUse` | `Bash\|PowerShell` | `bash plugin` | 10 s | Sim (`bash`) |
| `PreToolUse` | `Write\|Edit\|MultiEdit` | `pre plugin` | 30 s | Sim (`pre`) |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `post plugin` | 120 s | Sim (`post`) |
| `Stop` | nenhum | `stop plugin` | 300 s | Sim (`stop`) |

O lado do `install.sh` é o [`claude/hooks/settings-fragment.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/settings-fragment.json), mesclado em `~/.claude/settings.json`.

## Diferenças em relação ao install.sh

O `install.sh` copia o `CLAUDE.md` (como bloco gerenciado), as regras, as skills, os agentes e o estilo de saída para `~/.claude/`, grava `hooks/smugan.paths.json`, mescla os hooks no `settings.json`, define `outputStyle` quando nenhum está definido e grava um comando `smugan` em `~/.local/bin`. Um plugin não consegue distribuir `CLAUDE.md` nem uma pasta de regras, e o plugin não grava `smugan.paths.json`. Os hooks do plugin compensam isso da seguinte forma.

### Direcionamento como contexto (`steer`)

No início da sessão, e de novo depois de `/clear` ou de uma compactação, o hook entrega o `claude/CLAUDE.md` como `additionalContext`, com `~/.claude/` reescrito para a pasta `claude/` do checkout, os idiomas aplicados e as partes desligadas e o perfil removidos do mesmo jeito que o `install.sh` faria. Ele acrescenta uma seção "Plugin install" que diz:

- skills e agentes levam o prefixo `smugan:`;
- onde os arquivos do smugan dizem `~/.claude/`, leia a pasta `claude/` do checkout, e onde eles tiram o `gateDir` do `smugan.paths.json`, use o `packages/gate` do checkout;
- as regras de stack não carregam sozinhas: a primeira edição de um arquivo correspondente cita a regra;
- sob um perfil com modelo de revisor, lance todo revisor com esse `model`;
- quais revisores e skills não são usados nesta instalação, já que as listagens do plugin são estáticas;
- como rodar a CLI sem `smugan` no `PATH`: `node "<checkout>/packages/gate/bin/smugan.mjs" <command>`.

### Ensino das regras de stack (no `pre`)

O Claude Code carrega regras de `~/.claude/rules` por caminho; um plugin não tem essa pasta. Num `Write`, `Edit` ou `MultiEdit`, o plugin executa o [`rule-teach.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/hooks/rule-teach.mjs) do adaptador do Codex contra o `claude/rules/` do checkout e cita cada regra correspondente ainda não lida, uma vez por sessão. O aviso vai em `additionalContext` quando a edição é permitida e é anexado ao motivo do bloqueio quando ela é negada. Regras desligadas por idioma (`ui-ptbr` sem idioma de UI português) ou por `disable` não são ensinadas.

### Guarda de revisores e skills (`agent`)

Os arquivos de agente do plugin são estáticos, então o modelo do perfil não pode ser gravado neles como o `install.sh` faz. O hook `agent` nega, com a correção no motivo:

- uma chamada `Skill` a uma skill `smugan:` desligada;
- um lançamento de `critic` ou `flow-critic` (com ou sem o prefixo `smugan:`) quando ele está desligado;
- `flow-critic` sob o perfil `minimo`;
- um revisor lançado com `model` diferente do perfil;
- sob `completo` (modelo da conversa), um revisor lançado com um `model` explícito diferente de `inherit`.

O `install.sh`, por outro lado, grava o modelo nos arquivos de agente instalados e remove o `flow-critic` sob `minimo` ou quando ele está desligado.

### Dependências (`deps`)

O cache do plugin não tem `node_modules`, e o `smugan context` precisa dos parsers do gate. Na inicialização, o hook `deps` copia os manifestos do gate para `CLAUDE_PLUGIN_DATA` e roda `npm ci` ali quando a cópia instalada falta ou está fixada em versões diferentes ([`packages/gate/src/deps.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/deps.mjs), `installPluginDeps`). Não faz nada quando a pasta do gate já tem suas dependências. Um plugin carregado de um checkout com `--plugin-dir` recebe, em vez disso, uma mensagem para rodar `npm ci --ignore-scripts` na pasta do gate. Uma instalação que falha é tentada de novo na sessão seguinte. O `install.sh` não instala dependências; quando elas faltam, ele imprime o comando `npm ci --ignore-scripts --prefix` a executar.

### Convivência com o install.sh

Quando os hooks do plugin encontram uma instalação global (um `hooks/smugan.paths.json` na pasta de configuração do Claude, ou um comando `smugan-hook.mjs` no `settings.json` dela; `CLAUDE_CONFIG_DIR` é respeitado), todo hook do plugin sai sem agir. O hook `steer` mostra uma mensagem no lugar: as skills e os agentes `smugan:*` do plugin continuam listados e não seguem o perfil, então mantenha só um dos dois. Para ficar só com o plugin, rode `./install.sh --uninstall` no checkout; para ficar só com a instalação global, rode `claude plugin disable smugan@smugan`.

### Modo de falha

Os dois modos compartilham o comportamento fail-open do launcher: um erro interno emite um `systemMessage` dizendo que o gate está indisponível e que a verificação não passou, e sai com 0.
