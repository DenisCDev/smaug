---
title: doctor e why
description: O que o smugan doctor verifica na instalação e o que o smugan why lê dos registros de uma sessão.
---

Dois comandos de diagnóstico, ambos somente leitura para o projeto:

- `smugan doctor` verifica se a cadeia do Claude Code instalada funciona, sem sessão e sem gastar tokens.
- `smugan why` mostra o que os hooks fizeram em uma sessão: o que foi verificado, o que rodou, o que foi pulado e por quê, o que bloqueou.

## `smugan doctor`

```bash
smugan doctor [--json]
```

Implementado em [`packages/gate/src/doctor.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/doctor.mjs). Ele lê a instalação em `CLAUDE_CONFIG_DIR` (padrão `~/.claude`) e o comando `smugan` em `SMUGAN_BIN_DIR` (padrão `~/.local/bin`), e usa o diretório atual como projeto.

### Saída e código de saída

Cada resultado é uma linha com um nível:

| Marca | Nível | Significado |
|---|---|---|
| `✓` | `ok` | verificação aprovada |
| `!` | `warn` | funciona, com uma ressalva |
| `✗` | `fail` | problema de instalação; a linha traz a correção |

O resumo é `Installation working.`, `Installation working, with N warning(s).` ou `N installation problem(s); each ✗ line carries the fix.`

Com `--json`, a saída é `{ "claudeDir": "...", "lines": [{ "level": "...", "text": "..." }] }`. O código de saída é `1` quando alguma linha é `fail`; caso contrário, `0`. Uma cópia instalada desatualizada é `fail` mesmo que ainda funcione.

### Verificações, em ordem

| Verificação | Falha quando | Avisa quando |
|---|---|---|
| Versão do Node | versão major abaixo de 22 | |
| `settings.json` | ausente ou não é JSON válido | |
| Registro dos hooks | algum de `SessionStart`, `PreToolUse` (`bash` e `pre`), `PostToolUse` ou `Stop` não tem hook do Smugan | o matcher de `PreToolUse` ou `PostToolUse` não inclui `Write` |
| `disableAllHooks` | `true` no `settings.json` do usuário, ou no `.claude/settings.json` ou `.claude/settings.local.json` da pasta atual | |
| Output style | nunca; informa o `outputStyle` configurado | |
| Launcher | o launcher indicado no `settings.json` não existe; `smugan.paths.json` não aponta para um motor existente | `SMUGAN_GATE_DIR` está definida; os hooks usam um motor diferente do deste checkout |
| Comando `smugan` | | ausente; não foi gravado pelo `install.sh`; aponta para outro motor; a pasta dele não está no `PATH`; outro `smugan` vem antes no `PATH` |
| Cópias instaladas | regras, agentes, skills, output styles, o launcher dos hooks ou o bloco gerenciado do `CLAUDE.md` diferem deste checkout, depois da mesma reescrita que o `install.sh` aplica (caminhos, idiomas, perfil, modelo do revisor, partes desligadas); uma parte desligada continua instalada | o motor não está dentro de um checkout do Smugan, então as cópias não foram comparadas |
| Parsers de contexto | | uma dependência do gate não pode ser resolvida; `smugan context` fica indisponível |
| Git Bash (só Windows) | | não encontrado; veja `CLAUDE_CODE_GIT_BASH_PATH` em [Variáveis de ambiente](/pt-br/reference/environment-variables/) |
| Configuração do projeto | | `"mode": "warn"` está ativo; `"stop": {"build": true}` está definido, o que não tem mais efeito |
| Teste ponta a ponta | o hook `pre` instalado não bloqueia a gravação de teste; o hook `stop` instalado não sai com `0` | |

Quando há partes desligadas, uma linha `ok` as lista. Quando uma camada `smugan.local.json` está ativa para a pasta atual, uma linha `ok` a nomeia.

As verificações do comando `smugan` são todas avisos porque os agentes ainda chegam ao motor pelo `smugan.paths.json` ([README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#diagnostics-doctor-and-why)).

`allowManagedHooksOnly` só vale nas managed settings, que o `doctor` não lê; o `/status` da sessão mostra essa fonte.

### Teste ponta a ponta

Quando encontra um launcher, o `doctor` cria uma pasta temporária com um diretório `.git` vazio e alimenta o launcher instalado com o JSON que o Claude Code enviaria:

1. `pre`: um `Write` de `supabase/migrations/0001_doctor.sql` criando uma tabela `clientes` com nome de coluna em português e sem RLS. Ele precisa sair com `2` e `smugan gate: blocked` no stderr.
2. `stop`: uma sessão vazia. Ele precisa sair com `0`.

Cada chamada tem prazo de 30 segundos. A pasta temporária e os arquivos de estado dessa sessão de teste na pasta temporária do sistema são apagados em seguida.

### Exemplo

```bash
smugan doctor --json
```

## `smugan why`

```bash
smugan why [--session <id>] [--json]
```

Implementado em [`packages/gate/src/why.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/why.mjs), lendo os registros gravados por [`session-log.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/session-log.mjs).

### Registros

Dois arquivos por sessão na pasta temporária do sistema, apagados após 7 dias:

| Arquivo | Conteúdo |
|---|---|
| `smugan-report-<session>.json` | gravado a cada fim de turno: resultado, tentativa, nível de risco, pasta da sessão, cada arquivo e seu status, scripts do projeto e seus resultados, projetos onde os scripts não rodaram, falhas e verificações incompletas |
| `smugan-events-<session>.json` | os últimos 50 bloqueios ou avisos de `pre`, `post` e `stop`, e as falhas internas que fizeram um hook falhar aberto |

Uma edição permitida não grava nada. Um turno sem edições não substitui o relatório do último turno que verificou arquivos; ele só anota quando aconteceu ([README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#diagnostics-doctor-and-why)).

### Qual sessão

- `--session <id>`: essa sessão.
- Sem ele: a sessão mais recente que trabalhou na pasta atual — editou arquivos dentro dela, começou nela ou verificou um projeto que a contém. Uma sessão iniciada na pasta home não conta para todas as pastas abaixo dela.
- Se nenhuma corresponder, a sessão mais recente de qualquer pasta, com a linha `No session recorded in this folder; this is the most recent one from any folder.`

### Opções e códigos de saída

| Caso | Saída |
|---|---|
| registro exibido | `0` |
| nenhum registro para `--session <id>`, ou nenhum registro | `1` |
| `--session` sem id, ou uma opção desconhecida | `2` |

Com `--json`, a saída é `{ "session": "<id>", "report": {...}, "events": [...] }`, os registros brutos.

### Saída para humanos

O cabeçalho traz o id da sessão, há quanto tempo foi o último fim de turno dela e a pasta. Uma linha de modo de aviso aparece quando a configuração da pasta atual tem `"mode": "warn"`. Em seguida, a partir do relatório:

**Resultado do último fim de turno.** Um `passed` registrado é refinado conforme o que de fato rodou:

| Resultado | Texto |
|---|---|
| `nothing-touched` | no project files to analyze; there was nothing to verify |
| `passed` | turn passed: re-check and scripts green |
| `passed-no-scripts` | turn passed: no new violations in the analyzed files; no project script ran |
| `passed-scripts-only` | turn passed by the scripts; no file went through the Smugan re-check |
| `passed-nothing-ran` | turn released unverified: no file was analyzed and no script ran |
| `error` | the end of turn failed with an internal error and verified nothing; the turn ended unverified |
| `blocked` | turn held: the Definition of Done failed (with `attempt N of M`) |
| `warned` | turn released in warn mode: the Definition of Done failed without holding the turn |
| `incomplete` | turn released with incomplete checks |
| `known-failures` | turn released: only failures that had already used up the 3 holds remained |
| `released-after-cap` | turn released after 3 holds; the last check was still red |
| `changed-during-stop` | files changed while the checks ran; the latest edit was not verified |

**Nível do turno**: `trivial`, `normal` ou `critical`, e se foi forçado com `smugan risk`.

**Arquivos**: `✓` verificado e limpo, `✗` com a contagem de novas violações, ou `·` com o motivo de não ter sido verificado:

| Status | Texto |
|---|---|
| `ignored` | ignored by the configuration |
| `too-large` | larger than 1 MiB, not read |
| `stop-off` | end-of-turn check off in this project (`"stop": false`) |
| `recheck-off` | re-check off in this project (`"stop": {"smugan": false}`); the scripts still run |
| `missing` | deleted before the end of turn |

**Scripts do projeto**: `✓` aprovado, `✗` falhou, `⏱` prazo excedido (resultado não verificado), `·` pulado, `?` não verificado.

**Projetos onde os scripts não rodaram**:

| Motivo | Texto |
|---|---|
| `stop-off` | `"stop": false` in this project |
| `prose-only` | the turn only touched prose here |
| `home` | the home folder does not count as a project |
| `no-scripts` | no typecheck, test or build script to run |
| `cap` | limit of 2 projects with scripts per turn |
| `clone-index-partial` | the clone index did not finish within 500 ms; the next end of turn picks up where it stopped |

Depois vêm as falhas (a primeira linha de cada uma) e as verificações incompletas, os últimos 10 eventos (bloqueios, avisos do modo de aviso, turnos segurados e falhas `gate unavailable`, cada um com seu horário) e até 4 outros ids de sessões recentes para usar com `--session`.

### Exemplo

```bash
smugan why --session 3f2c9a1e-...
```
