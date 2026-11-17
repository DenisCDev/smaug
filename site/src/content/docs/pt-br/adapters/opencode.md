---
title: OpenCode
description: Instale o smugan no OpenCode como um plugin carregado automaticamente, veja como cada hook do Claude Code corresponde a um hook de plugin, as salvaguardas de retomada de sessão, as opções e os limites conhecidos.
---

O adaptador do OpenCode fica em [`adapters/opencode/`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/README.md). No [OpenCode](https://opencode.ai), o smugan roda como plugin em vez de hooks de shell, com o mesmo engine, as mesmas regras de stack e os mesmos revisores.

O engine, as regras de stack, os subagentes `critic` e `flow-critic`, as skills e o corpo do `AGENTS.md` vêm da raiz do repositório no momento da instalação. Só as partes específicas do OpenCode ficam no adaptador: o plugin, o executor do gate e o instalador.

## Instalação

```bash
git clone https://github.com/DenisCDev/smugan
cd smugan/adapters/opencode && ./install.sh    # or: node tools/install.mjs
```

O engine e as regras vêm do mesmo checkout, dois níveis acima. O instalador ([`tools/install.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/tools/install.mjs)) é idempotente e escreve em `~/.config/opencode/`:

| Destino | Conteúdo |
|---|---|
| `AGENTS.md` | Bloco gerenciado gerado a partir de [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) mais [`AGENTS.opencode.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/opencode/AGENTS.opencode.md); uma âncora ausente aborta a instalação |
| `rules/` | As regras de stack (`ui-ptbr.md` só com um idioma de UI em português) |
| `agents/critic.md`, `agents/flow-critic.md` | Traduzidos: `tools:` substituído por `mode: subagent` e `permission: edit: deny` |
| `skills/smugan/` | A skill de auditoria sem `argument-hint` (não é uma chave do OpenCode); os escopos são descritos no corpo |
| `skills/smugan-build/` | A skill de preparação com os guias |
| `plugins/smugan.js`, `smugan/*.mjs`, `bin/gate-runner.mjs` | O plugin, os módulos dele e o executor do gate em processo filho |
| `hooks/smugan.paths.json` | O caminho do gate, idiomas, partes desativadas e o binário `node` com que o gate roda |
| `smugan.opencode.json` | Opções, escritas só na primeira vez; reinstalar mantém as suas |

O `opencode.json` não é tocado. `smugan-ai-research` e `smugan-finish` não são instalados.

| Variável | Efeito |
|---|---|
| `OPENCODE_CONFIG_DIR` | Substitui a pasta de configuração |
| `XDG_CONFIG_HOME` | Base para `opencode/` quando `OPENCODE_CONFIG_DIR` não está definido |
| `SMUGAN_DIR` | Checkout do smugan em outro lugar: `SMUGAN_DIR=/path ./install.sh` |
| `SMUGAN_UI_LANG`, `SMUGAN_REPLY_LANG`, `SMUGAN_DISABLE` | Idiomas e partes desativadas na instalação |

### Opções

`~/.config/opencode/smugan.opencode.json`, mesclado sobre os padrões em [`opencode/smugan/config.mjs`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/opencode/smugan/config.mjs):

```json
{
  "gate":     { "enabled": true },
  "rules":    { "enabled": true, "maxPerInjection": 2 },
  "dod":      { "enabled": true, "timeoutMs": 300000 },
  "continue": { "layer": "B", "maxSameReason": 3, "maxPerSession": 5, "throttleMs": 5000 },
  "smallModel": "opencode/big-pickle"
}
```

| Opção | Significado |
|---|---|
| `gate.enabled` | Gate de pré-escrita |
| `rules.enabled`, `rules.maxPerInjection` | Injeção das regras de stack, no máximo esse número de regras por resultado de ferramenta |
| `dod.enabled`, `dod.timeoutMs` | Definition of Done de fim de turno e quanto tempo o plugin espera por ela. 300 s cobrem o typecheck e os testes com os 120 s de cada um no gate (`hook.stop.timeoutMs`). Se a verificação ainda estiver rodando nesse ponto, o plugin para de esperar e informa o turno como não verificado, nunca como limpo; um script do projeto que já começou roda até o próprio fim. Um arquivo escrito por uma instalação anterior mantém os 180000 dele. |
| `continue.layer` | `"A"` retoma só quando a DoD está vermelha; `"B"` (padrão) também retoma turnos que terminaram sem sinal de conclusão |
| `continue.maxSameReason`, `maxPerSession`, `throttleMs` | Limites de retomada, veja abaixo |
| `smallModel` | O redirecionamento do gerador de títulos. Precisa ser um modelo gratuito diferente do seu principal, no formato `provider/model`, e que o provedor de fato ofereça |

Modelos gratuitos do Zen listados no README do adaptador: `big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `laguna-s-2.1-free`, `ling-3.0-flash-free`, `north-mini-code-free`, `nemotron-3-ultra-free`.

Sobreposições por ambiente para depuração: `SMUGAN_OC_DISABLE=1` desliga gate, regras e DoD; `SMUGAN_OC_LAYER=A|B|off` (`off` desativa a DoD); `SMUGAN_TEACH=0` desativa a injeção de regras; `SMUGAN_GATE_DIR` aponta para outro engine. Um arquivo de opções malformado volta para os padrões.

## Correspondência de hooks

A partir de [`opencode/plugin/smugan.js`](https://github.com/DenisCDev/smugan/blob/main/adapters/opencode/opencode/plugin/smugan.js):

| Componente do smugan | Claude Code | OpenCode | Status |
|---|---|---|---|
| Regras globais | `~/.claude/CLAUDE.md` | bloco gerenciado em `~/.config/opencode/AGENTS.md` | 1:1 |
| Regras de stack | `~/.claude/rules/` carregadas por `paths:` | `~/.config/opencode/rules/`; o plugin lê os mesmos `paths:` e injeta o texto da regra no resultado da escrita que tocou um arquivo correspondente, uma vez por regra por sessão | 1:1 funcional |
| Gate de pré-escrita | `PreToolUse` exit 2 | `tool.execute.before`: a escrita que viola faz a própria chamada de ferramenta falhar | 1:1 |
| Delegação ao eslint/tsc | `PostToolUse` devolve o stderr | `tool.execute.after`: resultados anexados ao resultado da ferramenta | 1:1 |
| Selo DONE | `Stop` exit 2 segura o turno | `session.idle` roda a mesma DoD (gate, typecheck, testes) e retoma a sessão com as falhas | Adaptado: fala no turno seguinte |
| critic / flow-critic | subagentes em `~/.claude/agents/` | subagentes em `~/.config/opencode/agents/` | 1:1 |
| Skill de auditoria | `~/.claude/skills/smugan/` | `~/.config/opencode/skills/smugan/` | 1:1 |
| Instalação | mesclagem no `settings.json` | plugin carregado automaticamente, opções em arquivo próprio | Mais simples |

Mais dois hooks do plugin:

- `chat.message` zera o orçamento de retomadas quando chega uma mensagem sua; uma mensagem que carrega a marca de retomada do próprio plugin não zera, então o limite por sessão continua valendo.
- `experimental.provider.small_model` redireciona o gerador de títulos para o `smallModel` (contorna a [#31042](https://github.com/sst/opencode/issues/31042)).

### Detalhes

- **O gate roda em um processo `node` filho.** O engine é síncrono (typecheck e testes com `execSync`) e o plugin roda sob o Bun; importá-lo diretamente bloquearia o event loop do OpenCode por até 2 minutos. O instalador registra qual `node` usar.
- **O `edit` do OpenCode casa de forma aproximada**, então uma edição pode escapar do gate de pré-escrita. A base do turno fica ancorada mesmo assim e a DoD de fim de turno pega a edição, e é por isso que a DoD não é opcional.
- **Um caminho relativo pertence à pasta da sessão.** O plugin o resolve contra o `directory` que o OpenCode entrega, e todo caminho de `apply_patch` é relativo, então um servidor iniciado em outra pasta julga e registra o arquivo certo.
- **Nada de steering duplicado.** O OpenCode procura o `AGENTS.md` e depois o `~/.claude/CLAUDE.md`, mas para no primeiro que existir. O instalador sempre cria o `AGENTS.md`, então a versão adaptada ao OpenCode vale mesmo quando o smugan também está instalado para o Claude Code.
- O arquivo do plugin exporta exatamente uma função: o loader do OpenCode lança erro em qualquer export que não seja função, o que derrubaria todos os plugins.

## Retomando sessões paradas

Nos modelos gratuitos do OpenCode Zen, o agente pode parar no meio da tarefa sem erro. O plugin trata cada causa conhecida:

| Sintoma | Causa | O que o plugin faz |
|---|---|---|
| A sessão trava ~90 s, o modelo não responde | Gerador de títulos fixo em `deepseek-v4-flash-free`, ignorando o `small_model`; com a cota esgotada, ele tenta 3 vezes na mesma thread ([#31042](https://github.com/sst/opencode/issues/31042)) | Redireciona o gerador de títulos para o `smallModel` |
| Para logo depois de uma ferramenta | Provedores compatíveis com OpenAI (o Zen é um deles) retornam `finish_reason: "stop"` junto com uma chamada de ferramenta ([#14972](https://github.com/sst/opencode/issues/14972), [#13577](https://github.com/sst/opencode/issues/13577)) | Detecta o turno que terminou logo depois de uma ferramenta e retoma |
| Resposta cortada no meio | `finish: "length"` no limite de saída de 32K, sem continuação automática ([#17471](https://github.com/sst/opencode/issues/17471)) | Retoma do ponto de corte |
| "Pronto" com tarefas abertas | Um modelo pequeno declara pronto sem fechar a lista de tarefas (todos) ([#27560](https://github.com/sst/opencode/issues/27560), [#21534](https://github.com/sst/opencode/issues/21534)) | Retoma listando as tarefas abertas |
| Checagens vermelhas passam batido | Não há hook bloqueante de fim de turno ([#16626](https://github.com/sst/opencode/issues/16626)) | Roda a DoD no idle e retoma com as falhas |

Uma retomada sempre leva conteúdo (as falhas ou o motivo específico), nunca um "continue" vazio, então ela termina assim que as checagens passam. Salvaguardas:

- **No máximo 5 retomadas por sessão** (`maxPerSession`). Depois disso, só uma mensagem sua reabre o orçamento.
- **No máximo 3 retomadas com a mesma reclamação** (`maxSameReason`). Progresso significa que o motivo mudou. A comparação ignora só o contador que o gate carimba na mensagem ("attempt 2/3").
- 5 s entre retomadas (`throttleMs`); nenhuma durante o backoff de rate limit do runtime; nenhuma em uma sessão filha de subagente.
- **Nada ressuscita uma sessão que você parou com ESC.** A flag é conferida de novo depois da execução das checagens, que pode levar minutos.

## Limites conhecidos

- **O selo DONE chega um turno atrasado.** O OpenCode não tem hook bloqueante de fim de turno ([#16626](https://github.com/sst/opencode/issues/16626)); a falha vira a primeira mensagem do turno seguinte. Rodar as verificações antes de declarar pronto é o único selo no mesmo turno.
- **Um congelamento silencioso não é detectável.** Se o modelo trava sem emitir evento ([#24342](https://github.com/sst/opencode/issues/24342)) ou o runtime tenta de novo para sempre sem avisar ([#21960](https://github.com/sst/opencode/issues/21960)), não há nada a observar. Um watchdog baseado em tempo ficou de fora de propósito, para não interromper pausas legítimas.
- **A retomada aparece como mensagem do usuário** no histórico (limitação da plataforma), sempre marcada com `smugan —`.
- **Hunks `Update File` do `apply_patch`** são reconstruídos de forma aproximada; um que não casa exatamente passa pelo gate e é pego pela DoD.
- **O retry de rate limit é do OpenCode.** O OpenCode já faz backoff e trata o `FreeUsageLimitError`; o plugin só observa e não retoma durante o backoff.

## Verificação

Automatizada:

```bash
npm test    # loads the real plugin with a fake client; the gate really runs in the child process
```

Os [testes](https://github.com/DenisCDev/smugan/tree/main/adapters/opencode/test) cobrem uma migration sem RLS e um `catch {}`, `apply_patch` V4A, aliases de argumentos, um caminho relativo com o servidor em outra pasta, uma verificação de fim de turno cortada no prazo, checagens e regras injetadas no resultado da ferramenta e a tabela de decisão de fim de turno, incluindo os casos que nunca podem retomar (ESC durante a execução das checagens, backoff de rate limit, sessão filha), os dois limites e uma retomada ecoada de volta pelo runtime sem reabrir o orçamento. Os testes do instalador cobrem `AGENTS.md` sem nenhum `~/.claude/`, reinstalação sem empilhar, agentes traduzidos e âncora ausente abortando.

Com o OpenCode instalado:

1. `opencode --log-level DEBUG` inicia sem erro de plugin.
2. Peça uma migration `.sql` sem RLS. A chamada de ferramenta falha com o motivo do smugan.
3. Edite um `.tsx`. O texto da regra aparece anexado ao resultado, uma vez.
4. Quebre o typecheck e deixe o turno terminar. Chega `smugan — Definition of Done` e o modelo retoma.
5. Aperte ESC no meio de uma tarefa. Nada ressuscita a sessão.
6. `@critic` e `@flow-critic` são resolvidos; pedir ao critic que escreva algo é negado.
