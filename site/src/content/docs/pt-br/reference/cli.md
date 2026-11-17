---
title: CLI
description: Todos os subcomandos do smugan, suas flags, seus códigos de saída e um exemplo de cada.
---

O comando `smugan` é [`packages/gate/bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs). O `install.sh` grava um launcher para ele em `~/.local/bin` (ou `SMUGAN_BIN_DIR`); sem o launcher, chame-o como `node packages/gate/bin/smugan.mjs <command>`.

Sem comando, `smugan` imprime a ajuda. Um comando desconhecido imprime `smugan: unknown command "<name>"`, depois a ajuda, e sai com `2`.

Fora de um hook, quando `SMUGAN_UI_LANG` não está definida, a CLI lê `uiLanguage` de `hooks/smugan.paths.json` em `CLAUDE_CONFIG_DIR` (ou `~/.claude`), para que um `smugan check` manual julgue as strings de UI do mesmo jeito que os hooks. Um arquivo de caminhos ilegível imprime um aviso no stderr e deixa o idioma de UI desligado.

## Visão geral dos comandos

| Comando | Flags e argumentos | Códigos de saída |
|---|---|---|
| `check` | `[paths...]` `--json` `--warn` | `0` limpo (ou `--warn`), `1` violações, `2` caminho não encontrado ou erro interno |
| `context` | `[target]` `--json` `--environment <label>` `--refresh` `--no-cache` `--record <research.json>` | `0` sucesso, `2` erro de uso, parsers ausentes ou falha |
| `risk` | `[trivial\|normal\|critical\|auto]` `[dir]` | `0` sucesso, `2` erro de uso |
| `ai-guide` | `--write <guide.md>` `--project <dir>` | `0` sucesso, `2` erro de uso ou guia rejeitado |
| `contract` | `[target]` `--set <contract.json>` `--replace` `--mark <n> <pending\|done\|blocked>` `--evidence <text>` `--clear` `--json` | `0` sucesso, `1` sem contrato, `2` erro de uso ou contrato rejeitado |
| `doctor` | `--json` | `0` nenhuma linha com falha, `1` ao menos uma linha com falha |
| `why` | `--session <id>` `--json` | `0` registro exibido, `1` sem registro, `2` erro de uso |
| `hook` | `pre`, `post` ou `stop` | `0` permite, `2` bloqueia (contrato de hooks do Claude Code) |
| `init` | nenhum | `0` |
| `version` | aliases `--version`, `-v` | `0` |
| `help` | aliases `--help`, `-h` | `0` |

O texto de ajuda resume os códigos como `0 clean · 1 violations found · 2 usage/internal error`.

## `check`

```bash
smugan check [paths...] [--json] [--warn]
```

Roda as [verificações](/pt-br/reference/checks/) nos arquivos ou pastas informados, resolvidos a partir do diretório atual. Sem caminhos, verifica `.`, o projeto inteiro a partir do diretório atual.

| Flag | Efeito |
|---|---|
| `--json` | saída legível por máquina; segundo o [README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#usage), ela inclui `ok`, `filesChecked` e `violations` (arquivo, linha, regra, mensagem), ordenadas por arquivo e linha |
| `--warn` | sai com `0` mesmo quando há violações |

Qualquer outro argumento que comece com `--` é ignorado; os demais argumentos são tratados como caminhos.

Códigos de saída:

- `0`: nenhuma violação, ou `--warn` foi passado.
- `1`: ao menos uma violação. O `"mode": "warn"` da configuração não muda isso; só o `--warn` na linha de comando muda.
- `2`: um caminho não existe (`smugan: path not found: <path>`), ou houve um erro interno (`smugan: internal error — ...`).

Um arquivo de configuração que não pôde ser usado imprime `smugan: warning — could not use <file> (invalid JSON or setting), ignoring that file` no stderr; a verificação roda mesmo assim. Veja [Configuração](/pt-br/reference/configuration/#arquivos-inválidos).

```bash
smugan check src/ --json
```

## `context`

```bash
smugan context [target] [--json] [--environment label] [--refresh] [--no-cache] [--record research.json]
```

Informa as versões locais e os guias relevantes por pacote para `target` (padrão `.`). Implementado em [`context.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context.mjs). Veja [Contexto de versões](/pt-br/reference/version-context/).

| Flag | Efeito |
|---|---|
| `--json` | saída em JSON |
| `--environment <label>` | rótulo do ambiente (padrão `local`); até 64 letras, dígitos, `_` ou `-`, começando com letra ou dígito |
| `--refresh` | reconstrói o contexto em vez de reaproveitar o que está em cache |
| `--no-cache` | não lê nem grava o cache |
| `--record <research.json>` | salva uma decisão pesquisada junto com o contexto; não pode ser combinado com `--no-cache` |

Mais de um alvo, ou uma flag desconhecida, é erro de uso. Todo erro sai com `2`. Quando faltam as dependências dos parsers, ele imprime `smugan: parsers unavailable; install the gate package dependencies with npm ci --ignore-scripts ...`.

```bash
smugan context --json packages/web
```

## `risk`

```bash
smugan risk [trivial|normal|critical|auto] [dir]
```

Força o nível de risco do checkout que contém `dir` (padrão `.`) por 8 horas. `auto` devolve a decisão ao hook, arquivo por arquivo. Sem nível, imprime o nível forçado no momento, se houver. Implementado em [`risk.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/risk.mjs). Veja [Níveis de risco](/pt-br/reference/risk-levels/).

Um primeiro argumento que não seja nem um nível nem uma pasta existente é rejeitado como `unknown level "<word>"`. Mais de dois argumentos, ou um alvo começando com `-`, é erro de uso. Erros saem com `2`.

Os hooks recusam comandos de shell do agente que baixariam o nível (`trivial`, `normal`, `auto`); elevar para `critical` e consultar o nível continuam liberados para o agente.

```bash
smugan risk critical
```

## `ai-guide`

```bash
smugan ai-guide [--write guide.md] [--project dir]
```

Sem `--write`, lista os pares motor de IA + modelo detectados no projeto (padrão `.`) e o estado de cada guia: válido até uma data, expirado ou sem guia. Com `--write`, valida um guia pesquisado em Markdown e o salva; um guia rejeitado lista seus erros e sai com `2`. Qualquer outro argumento é erro de uso. Implementado em [`ai-guides.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-guides.mjs). Veja [Guias de IA](/pt-br/reference/ai-guides/).

```bash
smugan ai-guide --project .
```

## `contract`

```bash
smugan contract [target] [--set contract.json [--replace]] [--mark <n> <pending|done|blocked> [--evidence text]] [--clear] [--json]
```

Mostra ou altera o contrato de aceite do checkout que contém `target` (padrão `.`). Veja [Contrato de aceite](/pt-br/reference/contract/).

| Flag | Efeito |
|---|---|
| (nenhuma) | imprime o contrato; `--json` o imprime como JSON |
| `--set <contract.json>` | valida e salva um contrato; recusado quando já existe um |
| `--replace` | com `--set`, substitui o contrato existente |
| `--mark <n> <state>` | define o critério `n` (um inteiro positivo) como `pending`, `done` ou `blocked` |
| `--evidence <text>` | com `--mark`, registra a evidência do critério |
| `--clear` | remove o contrato |

Apenas um de `--set`, `--mark` e `--clear` por chamada. `--evidence` sem `--mark`, `--replace` sem `--set`, uma flag sem o seu valor e qualquer flag desconhecida são erros de uso.

Códigos de saída: `0` sucesso; `1` não existe contrato ao exibi-lo; `2` erro de uso, contrato rejeitado, contrato existente sem `--replace` ou outra falha.

```bash
smugan contract --mark 2 done --evidence "npm test: 41 passed"
```

## `doctor`

```bash
smugan doctor [--json]
```

Verifica a instalação do Claude Code em `CLAUDE_CONFIG_DIR` (ou `~/.claude`) e passa um evento de teste pelo hook instalado. `--json` imprime `{ claudeDir, lines }`. Sai com `1` quando alguma linha tem nível `fail`; caso contrário, `0`. Veja [doctor e why](/pt-br/reference/doctor-and-why/).

```bash
smugan doctor
```

## `why`

```bash
smugan why [--session id] [--json]
```

Mostra o que os hooks registraram em uma sessão. `--session` sem id, ou qualquer outra flag, sai com `2`. Sem registro, sai com `1`. Veja [doctor e why](/pt-br/reference/doctor-and-why/).

```bash
smugan why --json
```

## `hook`

```bash
smugan hook <pre|post|stop>
```

Ponto de entrada dos hooks do Claude Code. Lê o JSON do evento do stdin, esperando por ele no máximo 2 segundos. `pre` e `stop` selecionam esses hooks; qualquer outro valor roda `post`. Saída `2` bloqueia e envia o stderr ao agente; `0` permite. Se a entrada não puder ser interpretada ou o motor lançar um erro, sai com `0`: as falhas do próprio smugan nunca bloqueiam uma sessão. Veja [Hooks](/pt-br/reference/hooks/).

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"a.ts","content":""}}' | smugan hook pre
```

## `init`

```bash
smugan init
```

Gera templates de configuração e de verificação no diretório atual. Nunca sobrescreve um arquivo. Implementado em [`init.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/init.mjs).

1. Grava `smugan.config.json`, a menos que `smugan.config.json` ou `smaug.config.json` já exista.
2. Adiciona `smugan.local.json` ao `.gitignore`, a menos que ele já esteja listado.
3. Copia cada grupo de templates apenas quando o projeto declara a stack correspondente:

| Grupo | Requer | Arquivos |
|---|---|---|
| Supabase | `supabase/config.toml` ou uma dependência `@supabase/*` | `supabase/tests/000-setup.sql`, `supabase/tests/001-rls-enabled.sql`, `supabase/tests/table-rls.test.sql.template`, `supabase/tests/README.md`, `SECURITY_NOTES.md` |
| E2E | `@playwright/test` | `playwright.config.ts`, `tests/app.context.md`, `tests/e2e/smoke.spec.ts` |
| Observabilidade | `next` e `@sentry/nextjs` | `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `docs/sentry-setup.md` |
| CI | sempre | `.github/workflows/smugan.yml` |

Cada linha do relatório começa com `+` (criado), `=` (já existe, mantido) ou `-` (grupo pulado, com o que ele exige). Quando a pasta de templates não é encontrada, a geração é pulada com uma linha `!`. O comando termina com `smugan: init complete.` e, para os arquivos que criou, os próximos passos.

O workflow gerado clona o Smugan com o secret `SMUGAN_TOKEN`, que precisa existir no repositório ([README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#smugan-init)).

```bash
smugan init
```

## `version`

Imprime `smugan <version>` a partir do `package.json` do gate, ou `smugan (unknown version)` quando ele não pode ser lido.

```bash
smugan version
```

## `help`

Imprime o resumo de uso, os códigos de saída, os nomes das verificações e a sintaxe de supressão `// smugan-ignore <rule>: <reason (6+ chars)>`.

```bash
smugan help
```
