---
title: Variáveis de ambiente
description: Todas as variáveis SMUGAN_* e CLAUDE_* que o instalador, a CLI, os hooks ou o engine leem, quem lê cada uma e seu valor padrão.
---

Esta lista vem das variáveis lidas em [`install.sh`](https://github.com/DenisCDev/smugan/blob/main/install.sh), [`packages/gate/bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs), [`packages/gate/src/`](https://github.com/DenisCDev/smugan/tree/main/packages/gate/src) e no launcher dos hooks, [`claude/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/smugan-hook.mjs). Cada adaptador para outro agente de código documenta as próprias variáveis.

## Resumo

| Variável | Lida por | Padrão |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `install.sh`, CLI, `doctor`, launcher dos hooks, engine dos hooks | `~/.claude` |
| `SMUGAN_BIN_DIR` | `install.sh`, `doctor` | `~/.local/bin` |
| `SMUGAN_UI_LANG` | `install.sh`, CLI, launcher dos hooks, verificação `ui-strings` | desligado |
| `SMUGAN_REPLY_LANG` | `install.sh` | desligado |
| `SMUGAN_PROFILE` | `install.sh`, launcher dos hooks, engine dos hooks | `completo` |
| `SMUGAN_REVIEW_MODEL` | `install.sh`, launcher dos hooks do plugin | o modelo do perfil |
| `SMUGAN_DISABLE` | `install.sh`, launcher dos hooks, engine dos hooks | nenhum |
| `SMUGAN_GATE_DIR` | launcher dos hooks, `doctor` | o `gateDir` em `smugan.paths.json` |
| `SMUGAN_STOP_DEADLINE_MS` | hook `stop` | `270000` |
| `SMUGAN_AI_GUIDES_DIR` | `ai-guides.mjs` (hooks, `context`, `ai-guide`) | `~/.smugan/ai-guides` |
| `SMUGAN_CACHE_DIR` | `context`, `contract`, `risk`, hooks | `smugan/<kind>` dentro de `LOCALAPPDATA`, `XDG_CACHE_HOME` ou `~/.cache` |
| `CLAUDE_CODE_GIT_BASH_PATH` | `doctor` | procurado |
| `CLAUDE_PLUGIN_OPTION_UI_LANGUAGE`, `_REPLY_LANGUAGE`, `_PROFILE`, `_DISABLE` | launcher dos hooks do plugin | desligado, desligado, `completo`, nenhum |
| `CLAUDE_PLUGIN_DATA` | launcher dos hooks do plugin | nenhum |

## Escolhas feitas na instalação

O `install.sh` valida `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_PROFILE`, `SMUGAN_REVIEW_MODEL` e `SMUGAN_DISABLE` antes de escrever qualquer coisa; um valor inválido imprime `smugan install: <message>` e sai com `1`. Os valores resolvidos ficam em `hooks/smugan.paths.json` como `uiLanguage`, `replyLanguage`, `profile`, `reviewModel` e `disable`. Quando uma variável não está definida ou está vazia, vale o valor do `smugan.paths.json` da instalação anterior; assim, reinstalar sem nada muda nenhuma escolha.

### `SMUGAN_UI_LANG`

Idioma das strings do projeto voltadas ao usuário. Valores: uma tag de idioma que case com `^[a-z]{2,3}(-[a-z0-9]{2,8})*$` (sem diferenciar maiúsculas), como `pt-BR` ou `en`, ou `off`. Padrão: desligado. Resolvido em [`language.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/language.cjs).

- O `install.sh` preenche as linhas `{{UI_LANGUAGE}}` das regras instaladas e só instala `ui-ptbr.md` para uma tag de português.
- A CLI e o launcher dos hooks a definem a partir de `uiLanguage` em `smugan.paths.json` quando ela não está definida no ambiente.
- A verificação `ui-strings`, quando não está configurada em `checks`, só roda quando o valor é uma tag de português (`pt`, `pt-...`) ([`config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs)).

### `SMUGAN_REPLY_LANG`

Idioma em que o agente responde. Mesmos valores e padrão de `SMUGAN_UI_LANG`. Lida só pelo `install.sh`, que preenche as linhas `{{REPLY_LANGUAGE}}` e escreve `NÃO FEITO` em vez de `NOT DONE` para uma tag de português.

### `SMUGAN_PROFILE`

Perfil de custo, resolvido em [`profile.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/profile.cjs). Não diferencia maiúsculas.

| Valor | Modelo do revisor | `flow-critic` |
|---|---|---|
| `completo` (padrão) | o modelo da conversa | usado |
| `economico` | `sonnet` | usado |
| `minimo` | `haiku` | não usado |

O launcher dos hooks a exporta a partir de `profile` em `smugan.paths.json` quando ela não está definida; o engine dos hooks a lê para decidir quais revisores suas mensagens citam.

### `SMUGAN_REVIEW_MODEL`

Modelo gravado como `model:` nos agentes `critic` e `flow-critic` instalados, sobrepondo o perfil. O `install.sh` aceita um valor que case com `^[A-Za-z][\w.-]*(\[1m\])?$`: um alias (`sonnet`, `opus`, `haiku`, `fable`, `inherit`) ou um ID de modelo completo. Vazio significa que o perfil decide.

No plugin, só `sonnet`, `opus`, `haiku`, `fable` ou `inherit` têm efeito; qualquer outro valor gera um aviso e o modelo do perfil é usado.

### `SMUGAN_DISABLE`

Lista separada por vírgulas das partes a desligar: `critic`, `flow-critic`, `smugan`, `smugan-build`, `smugan-finish` e os nomes das regras de stack em `claude/rules/` (sem `.md`). `none` limpa a lista. Os nomes passam por trim e ficam em minúsculas; um nome desconhecido faz a instalação falhar, mostrando a lista de nomes válidos. Resolvido em [`parts.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/parts.cjs).

Uma regra ou um agente desligado não é instalado; uma skill desligada mantém seus arquivos, mas perde o `SKILL.md`. O launcher dos hooks exporta a lista salva quando a variável não está definida, e o engine dos hooks a combina com a chave `disable` do projeto ([Configuração](/pt-br/reference/configuration/)).

## Caminhos e pastas

### `CLAUDE_CONFIG_DIR`

Pasta de configuração do Claude Code. Padrão `~/.claude`. O `install.sh` instala nela e o `--uninstall` remove dela; a CLI lê `hooks/smugan.paths.json` dela; o `doctor` a inspeciona; o launcher dos hooks procura nela uma instalação feita pelo `install.sh`; o engine dos hooks a usa para seus caminhos e como pasta de regras de fallback.

### `SMUGAN_BIN_DIR`

Pasta onde o `install.sh` grava o launcher `smugan` (e `smugan.cmd` no Windows). Padrão `~/.local/bin`. O `doctor` verifica o launcher na mesma pasta.

### `SMUGAN_GATE_DIR`

Pasta do engine que o launcher dos hooks usa no lugar do `gateDir` de `smugan.paths.json`. Quando ela está definida, o launcher a retorna antes de ler o `smugan.paths.json`, então os `uiLanguage`, `profile` e `disable` salvos não são exportados para os hooks. O `doctor` imprime um aviso quando ela está definida.

### `SMUGAN_AI_GUIDES_DIR`

Pasta dos guias de IA por par engine + modelo. Padrão `~/.smugan/ai-guides` ([`ai-guides.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-guides.mjs)).

### `SMUGAN_CACHE_DIR`

Pasta base do estado privado mantido fora do checkout:

| Uso | Com a variável | Sem ela |
|---|---|---|
| cache de contexto, quando `.smugan.local/` no projeto não pode ser usado ([`context-cache.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-cache.mjs)) | `<SMUGAN_CACHE_DIR>` | `<base>/smugan/context` |
| contratos de aceitação ([`contract.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/contract.mjs)) | `<SMUGAN_CACHE_DIR>/contracts` | `<base>/smugan/contracts` |
| nível de risco forçado ([`risk.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/risk.mjs)) | `<SMUGAN_CACHE_DIR>/risk` | `<base>/smugan/risk` |

`<base>` é `LOCALAPPDATA`; na falta dele, `XDG_CACHE_HOME`; na falta deste, `~/.cache`.

### `CLAUDE_CODE_GIT_BASH_PATH`

Lida pelo `doctor` no Windows. Usada quando o arquivo existe e se chama `bash`, `sh`, `bash.exe` ou `sh.exe`; caso contrário, o `doctor` procura `bash.exe` ao lado do `git` no `PATH` e depois em `ProgramFiles\Git\bin` e `LOCALAPPDATA\Programs\Git\bin`.

## Comportamento dos hooks

### `SMUGAN_STOP_DEADLINE_MS`

Prazo total de fim de turno do hook `stop`, em milissegundos. Padrão `270000` ([`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs)). Um valor que não seja um número positivo volta ao padrão. Segundo o [README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#environment-variables), o padrão cabe no timeout de 300 s que o instalador dá ao hook, e, passada metade do prazo, a segunda verificação (feita quando arquivos mudam durante as verificações) não roda.

## Plugin

Quando o Smugan roda como plugin do Claude Code, o Claude Code entrega a cada hook as opções do plugin como `CLAUDE_PLUGIN_OPTION_*`. O launcher dos hooks as mapeia do mesmo jeito que o `smugan.paths.json` faz numa instalação e, em seguida, define `SMUGAN_UI_LANG`, `SMUGAN_PROFILE` e `SMUGAN_DISABLE` para o engine.

| Variável | Vira | Valor inválido |
|---|---|---|
| `CLAUDE_PLUGIN_OPTION_UI_LANGUAGE` | `SMUGAN_UI_LANG` | os dois idiomas desligados na sessão, com aviso |
| `CLAUDE_PLUGIN_OPTION_REPLY_LANGUAGE` | idioma de resposta | os dois idiomas desligados na sessão, com aviso |
| `CLAUDE_PLUGIN_OPTION_PROFILE` | `SMUGAN_PROFILE` | `completo`, com aviso |
| `CLAUDE_PLUGIN_OPTION_DISABLE` | `SMUGAN_DISABLE` | nada desligado, com aviso |

`CLAUDE_PLUGIN_DATA` é a pasta de dados do plugin: o launcher instala ali as dependências do gate quando a pasta do gate não tem nenhuma ([`deps.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/deps.mjs)).

## O que não é variável de ambiente

- `SMUGAN_ROOT` e `SMUGAN_HOOK` no `install.sh` são variáveis internas do script, não lidas do ambiente.
- `SMUGAN_CONTRACT_UNREADABLE` é um código de erro em `contract.mjs`.
- `SMUGAN_TOKEN` é um secret do GitHub Actions usado pelo template `.github/workflows/smugan.yml` que o `smugan init` copia; nenhum código do Smugan o lê.
