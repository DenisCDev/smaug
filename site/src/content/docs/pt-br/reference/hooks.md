---
title: Hooks
description: Cada evento de hook do Claude Code que o smugan registra, o que ele lê e executa, quando bloqueia, seu prazo, como falha em modo aberto e onde guarda estado.
---

O Smugan atua por meio de hooks de comando do Claude Code. Todo hook executa o mesmo launcher,
[`claude/hooks/smugan-hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/smugan-hook.mjs),
com o tipo do evento como primeiro argumento. O launcher carrega o engine em
[`packages/gate/src/hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs)
e devolve a resposta ao Claude Code.

## Registro

Há duas formas de registrar os hooks, e cada uma registra um conjunto diferente.

| Evento | Matcher | Tipo | Timeout | Plugin | `install.sh` |
|---|---|---|---|---|---|
| `SessionStart` | `startup\|clear\|compact` | `steer` | 10 s | sim | não |
| `SessionStart` | (qualquer) | `session` | 30 s | sim | sim |
| `SessionStart` | `startup` | `deps` | 120 s | sim | não |
| `PreToolUse` | `Agent\|Task\|Skill` | `agent` | 10 s | sim | não |
| `PreToolUse` | `Bash\|PowerShell` | `bash` | 10 s | sim | sim |
| `PreToolUse` | `Write\|Edit\|MultiEdit` | `pre` | 30 s | sim | sim |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `post` | 120 s | sim | sim |
| `Stop` | (qualquer) | `stop` | 300 s | sim | sim |

Fontes: [`claude/hooks/plugin-hooks.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/plugin-hooks.json)
e [`claude/hooks/settings-fragment.json`](https://github.com/DenisCDev/smugan/blob/main/claude/hooks/settings-fragment.json).
O plugin passa `plugin` como segundo argumento.

Quando o plugin roda com a cópia do `install.sh` também ativa, os hooks do plugin
não fazem nada e saem com 0. O launcher considera a cópia do `install.sh` ativa quando a
pasta de configuração do Claude (`CLAUDE_CONFIG_DIR` ou `~/.claude`) tem
`hooks/smugan.paths.json`, ou quando o `settings.json` dela tem um comando de hook no
formato `node "…/smugan-hook.mjs" <kind>`. Só o `steer` avisa disso, num
`systemMessage` que pede para você manter apenas um dos dois.

## Launcher

O launcher procura o engine em `SMUGAN_GATE_DIR`, depois no `gateDir` do
`smugan.paths.json` ao lado do launcher e, por fim, em `../../packages/gate` relativo ao
launcher. O `smugan.paths.json` também pode definir `uiLanguage`, `profile` e `disable`.
Cada um só é usado quando a variável correspondente, `SMUGAN_UI_LANG`, `SMUGAN_PROFILE` ou
`SMUGAN_DISABLE`, não está definida. No modo plugin, os valores vêm das variáveis
`CLAUDE_PLUGIN_OPTION_*`.

O launcher lê o JSON do hook pelo stdin. Um timer de 2 s encerra a leitura mesmo
quando o stdin nunca envia EOF, o que acontece em alguns shells do Windows.

Como a resposta é devolvida:

- Exit code 2 bloqueia. No `PreToolUse`, recusa a chamada da ferramenta; no `PostToolUse`,
  devolve o stderr ao modelo; no `Stop`, mantém o turno rodando.
- Para `pre`, `post`, `session` e `steer`, o texto destinado ao modelo é escrito como
  `hookSpecificOutput.additionalContext`, mas só quando o exit code é 0.
  Um `systemMessage` que já esteja no stdout é mantido ao lado.
- Um aviso para o usuário num caminho com exit 0 é escrito como `systemMessage` no stdout.
  O Claude Code não mostra a ninguém o stderr de um hook que sai com 0
  (veja `userNote` em `hook.mjs`).

## Comportamento fail-open

Um erro interno do smugan nunca bloqueia a sessão. Ele falha em modo aberto em dois níveis:

- **Engine.** O `runHook` captura todo erro, inclusive rejeições assíncronas, e retorna
  exit 0. Ele inclui o código do erro quando é um de `EEXIST`, `EPERM`,
  `EACCES`, `ENOENT` ou `EBUSY`. A mensagem diz que o evento não foi verificado. Ela
  vai para o stderr e para um `systemMessage`, e é registrada como evento `gate-unavailable`
  para o `smugan why`.
- **Launcher.** Qualquer exceção, inclusive um engine que não pode ser encontrado, escreve o
  `systemMessage` "smugan: gate unavailable — the engine could not finish this event.
  The check did not pass." e sai com 0.

## `steer` (só no plugin)

Este hook roda no `SessionStart` para `startup`, `clear` e `compact`. Ele devolve o
texto de direcionamento como `additionalContext`. O texto é o `claude/CLAUDE.md` do checkout,
com os caminhos reescritos para apontar para o checkout, com idioma, perfil e partes
desligadas aplicados, e com uma seção "Plugin install". Opções inválidas do plugin geram um
aviso em `systemMessage`, e a sessão passa a usar padrões seguros: idiomas desligados,
perfil `completo`, nada desligado.

## `session`

O hook `session` lê o `cwd` do evento e carrega dele a configuração do projeto.
Não retorna nada quando não há `cwd` ou quando a raiz do projeto é a pasta
home.

Quando o projeto usa um LLM, ele retorna como `additionalContext`:

- o índice de guias de IA de até 6 pares engine + modelo, mais uma linha que conta o
  restante;
- as regras de teste de LLM de
  [`src/ai/llm-testing.md`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai/llm-testing.md),
  rotuladas como referência, não como instruções.

O projeto usa um LLM quando o `detectAi` encontra ao menos um par; veja
[Guias de IA](../ai-guides/). O hook também registra qualquer nível de risco forçado que
encontrar para o checkout. Sem uso de LLM, ele não retorna contexto.

## `deps` (só no plugin)

Este hook roda no `SessionStart` para `startup`. O cache do plugin não tem
`node_modules`, mas o `smugan context` precisa de três parsers: `yaml`, `smol-toml` e
`jsonc-parser`. O hook copia o `package.json` e o `package-lock.json` do gate para
`<CLAUDE_PLUGIN_DATA>/gate` e roda
`npm ci --ignore-scripts --omit=dev --no-audit --no-fund` ali, com timeout de
100 s. Ele só reinstala quando os manifestos copiados diferem dos do gate ou
quando falta `node_modules`. Se a instalação falhar, ele apaga o
`package.json` copiado para que a próxima sessão tente de novo e reporta um
`systemMessage`. Fonte: [`src/deps.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/deps.mjs).

## `agent` (só no plugin)

O hook `agent` é uma guarda `PreToolUse` sobre `Agent`, `Task` e `Skill`. Ele nega a
chamada (`permissionDecision: "deny"`) quando qualquer uma destas condições vale:

- uma skill `smugan:` está na lista de desligados, que junta a opção `disable` do plugin
  com o `disable` da configuração do projeto;
- um agente `critic` ou `flow-critic` (com ou sem prefixo) está desligado;
- o `flow-critic` é lançado sob um perfil que não o usa (`minimo`);
- o perfil define um modelo de revisor e a chamada passa um `model` diferente, ou
  não define modelo e a chamada passa um diferente de `inherit`.

O `SMUGAN_REVIEW_MODEL` sobrepõe o modelo do perfil com `sonnet`, `opus`, `haiku`,
`fable` ou `inherit`.

## `bash`: `PreToolUse` para Bash e PowerShell

Para comandos `Bash` e `PowerShell`, este hook faz duas coisas.

1. **Recusa comandos que poderiam rebaixar o nível de risco.** Esta verificação é puramente
   textual e roda antes de qualquer I/O. As regras estão em [Níveis de risco](../risk-levels/#só-o-usuário-rebaixa-um-nível).
   Uma recusa sai com 2.
2. **Tira um snapshot do shell.** No primeiro comando de shell do turno num repositório Git,
   ele registra o commit para o qual o HEAD aponta, a contagem do reflog do HEAD e a linha mais recente, a
   impressão digital (tamanho e mtime) de cada arquivo que o Git lista como alterado, os caminhos rastreados
   já apagados e, como baseline, os achados do smugan em cada arquivo de código alterado.
   Arquivos de teste também guardam seu perfil de asserções. O snapshot gasta no
   máximo 3 s com achados. Arquivos que passam desse orçamento são marcados como `unrecorded`. O snapshot
   é pulado quando há mais de 2.000 arquivos alterados ou quando o `git status`
   falha, e o pulo fica registrado. Ele também é pulado quando a configuração do projeto define
   `"hook": {"stop": false}` ou `"stop": {"shell": false}`. Cada chamada ao git tem timeout de 5 s
   e passa `--no-optional-locks`
   ([`src/shell-writes.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/shell-writes.mjs)).

Uma falha no snapshot é registrada em log e nunca muda a decisão.

## `pre`: `PreToolUse` para Write, Edit e MultiEdit

O hook `pre` ignora estes arquivos:

- arquivos em `<tmpdir>/claude/`, o scratchpad do Claude;
- arquivos fora da raiz de projeto da configuração mais próxima;
- caminhos que casam com a lista `ignore` da configuração ou com os ignores padrão.

Uma escrita na pasta que guarda os níveis de risco forçados é recusada antes de tudo.

Depois, para cada edição:

1. Ele lê o arquivo atual, se tiver no máximo 1 MiB, e monta o conteúdo que o arquivo
   teria depois da edição. Um `Write` usa `content` como veio. `Edit` e
   `MultiEdit` aplicam cada substituição `old_string` → `new_string`, com as quebras de linha
   normalizadas para LF dos dois lados. Quando um `old_string` não é encontrado, não há
   o que julgar e a edição passa.
2. No primeiro toque do turno num arquivo, ele registra uma baseline, mesmo que a edição
   falhe depois. A baseline guarda as contagens de violações, o perfil de asserções e
   as contagens de testes de um arquivo de teste, se o arquivo é novo e, para um arquivo de código, os
   nomes de suas funções e suas formas de contract-drift. Toques posteriores nunca
   a sobrescrevem.
3. Ele bloqueia com exit 2 só nas violações que a edição introduz: um diff de multiconjunto por
   regra e mensagem contra o arquivo atual. `dead-imports` não é julgado em `Edit`
   nem `MultiEdit`, só em `Write`. Num turno crítico, os achados de `await-in-loop` que a
   edição adiciona também são julgados. O turno é crítico quando o nível está forçado em
   critical, quando o arquivo é crítico ou quando um arquivo que o turno já tocou é crítico.

Quando a edição passa, o `pre` pode retornar `additionalContext`, cada parte no máximo uma vez
por sessão:

- **Lembrete de mudança crítica.** Vem na primeira edição de um arquivo crítico em cada projeto.
  Dá o motivo, pede os revisores e acrescenta uma sugestão de
  `smugan contract --set` quando não há contrato em andamento; veja
  [Contrato de aceitação](../contract/).
- **Dica de IA.** Vem quando a edição importa um SDK de engine ou escreve um id de modelo. Ela
  traz as regras de teste de LLM e um pedido para delegar ao `smugan-ai-research`
  cada par usado pelo arquivo que não tenha guia válido. A varredura do projeto só roda
  quando a edição traz um engine ou modelo que esta sessão ainda não viu.
- **Índice de docs.** Vem na primeira edição, por sessão e por pacote (o
  `package.json` mais próximo), de um arquivo coberto pelos `paths` de uma regra de stack. As regras são
  lidas de `claude/rules/` no checkout, ou de `<claude config>/rules` quando essa
  pasta não existe. Ela traz o índice de docs descrito em
  [Contexto de versão](../version-context/#índice-de-docs-e-assinaturas-dts).
- **Ensino de regras (só no plugin).** Na primeira edição de um arquivo que casa com uma regra
  de stack, cita a regra a ler, uma vez por regra por sessão.

Quando a configuração define `"mode": "warn"`, o hook reporta os mesmos achados, mas sai com 0.
Os achados vão para `additionalContext` e para um `systemMessage`.

## `post`: `PostToolUse` para Write, Edit e MultiEdit

O hook `post` ignora os mesmos caminhos que o `pre`. Ele registra o arquivo como tocado pelo
turno, exceto arquivos na pasta de configuração do Claude. Depois, só roda quando o arquivo ainda
existe e termina em `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` ou `.cts`.

- **ESLint.** Roda quando `hook.eslint` está ligado, quando `node_modules/eslint/bin/eslint.js` é
  encontrado subindo pelas pastas e quando um arquivo de configuração do ESLint é encontrado do mesmo jeito. Ele executa
  `eslint --format json --no-warn-ignored` e tenta de novo sem a última flag em
  versões antigas do ESLint. Só bloqueiam as mensagens novas em relação à versão do HEAD no Git.
  O resultado do HEAD fica em cache por sha do blob.
- **tsc por arquivo.** Só roda aqui quando `"hook": {"stop": false}`. Caso contrário,
  o typecheck espera o `stop`.

Cada execução de ferramenta é limitada por `hook.timeoutMs`, 30.000 ms por padrão. Uma execução do ESLint que
estoura o timeout não gera achados. As duas verificações rodam em paralelo. Problemas novos saem com 2,
ou com 0 no modo warn.

## `stop`: fim do turno

Esta é a Definition of Done mecânica. Não faz nada quando a sessão não tem
marcador de turno, o que significa que nada foi tocado. Os passos:

1. Lista os arquivos que o turno tocou via Write/Edit, mais os arquivos que comandos
   de shell alteraram desde o snapshot de cada repositório. Isso inclui arquivos com uma
   impressão digital nova, arquivos que o Git não listava no snapshot e arquivos alterados pelos
   próprios commits do turno. Verifica no máximo 100 arquivos alterados pelo shell por repositório e
   reporta o restante como não verificado.
2. Roda de novo as verificações do smugan em cada arquivo e reporta só o que o turno
   introduziu, até 20 linhas por arquivo. A baseline é a do primeiro toque. Sem
   ela, a baseline é a versão do HEAD no Git. Para um arquivo alterado pelo shell, são os
   próprios commits do turno mais o diff não commitado sobre o HEAD. Ler o histórico de commits
   tem orçamento de 30 s; arquivos além dele são comparados só com o HEAD.
3. Quando o turno também tocou código de produção, verifica asserções enfraquecidas e
   lista testes removidos ou arquivos de teste apagados. Também lista os achados de `contract-drift`,
   `clone` e `exploration-residue`. Cada um desses achados listados aparece
   em uma única retenção.
4. Roda scripts do projeto em no máximo 2 raízes:
   - `typecheck` ou `type-check`, pelo gerenciador de pacotes que o lockfile indica
     (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, caso contrário npm);
   - sem esse script, `tsc` nos arquivos TypeScript tocados;
   - testes: `vitest related --run --passWithNoTests` quando o Vitest está instalado;
     caso contrário, o script `test`. Num workspace, o script `test` só roda nos
     pacotes tocados, até 3.

   Uma raiz fica fora da contagem quando tem `"stop": false`, só teve prosa tocada,
   é a pasta home ou não tem nada para rodar. Os testes são pulados numa raiz cujo
   nível é trivial. Nunca roda build.

Cada script roda com `CI=1` e sem `NODE_TEST_CONTEXT`, sob
`hook.stop.timeoutMs` (120.000 ms por padrão). Quando o prazo estoura, toda a
árvore de processos é encerrada. O hook guarda os últimos 64 Ki caracteres de cada stream
de saída.

**Quando ele bloqueia.** Sai com 2 quando há um achado do gate ou quando um script sai com
código diferente de zero. Uma falha ao encerrar uma árvore de processos também bloqueia. Um timeout não bloqueia:
vira um aviso de "verificações incompletas". O orçamento é de 1 retenção por turno, ou 2 quando
o nível do turno é crítico. Quando o orçamento acaba, o turno termina com um
`systemMessage` dizendo que a última verificação ficou vermelha. Num Stop em que
`stop_hook_active` é `false`, o orçamento é zerado se arquivos mudaram desde a última retenção.

**Falhas conhecidas.** Quando toda falha de uma execução casa com uma impressão digital registrada depois que
um turno anterior esgotou o orçamento, o turno termina sem retenção. Uma execução verde apaga
essas impressões digitais. Durações, timestamps ISO entre colchetes e os contadores de
truncamento do smugan são mascarados na impressão digital.

**Arquivos mudando durante as verificações.** Se arquivos mudam enquanto as verificações rodam, o Stop
verifica de novo uma vez, quando duas passadas cabem no prazo. Se mudarem outra vez, termina com
um aviso. O prazo total é de 270.000 ms, que o `SMUGAN_STOP_DEADLINE_MS`
sobrepõe.

Quando todas as raízes tocadas estão em modo warn, as falhas são reportadas e o turno
termina com exit 0. Num bloqueio, o stdout sempre traz uma linha, e o stderr reescreve
"no such file" e "can't open". Sem isso, o Claude Code rebaixaria o exit 2
para "hook script appears to be missing".

## Arquivos de estado

Todos os arquivos são JSON. O id da sessão é reduzido a `[A-Za-z0-9-]`, com no máximo 64
caracteres.

| Arquivo | Local | Escrito por | Retenção |
|---|---|---|---|
| `smugan-turn-<session>.json` | pasta temporária do SO | `pre`, `post`, `bash`, `stop` | Apagado pelo Stop que o verifica, quando nada mudou no meio-tempo |
| `smugan-session-<session>.json` | pasta temporária do SO | dicas mostradas, níveis forçados vistos | Sem limpeza automática em `src/` |
| `smugan-stopdebt-<session>.json` | pasta temporária do SO | `stop`, quando o orçamento acaba | Apagado por um Stop verde |
| `smugan-report-<session>.json` | pasta temporária do SO | todo Stop (para o `smugan why`) | Varrido após 7 dias |
| `smugan-events-<session>.json` | pasta temporária do SO | bloqueios e erros fail-open | Últimos 50 eventos; varrido após 7 dias |
| `smugan-baseline/<hash>.json` | pasta temporária do SO | baselines do HEAD para ESLint, tsc e achados do smugan | Chaveado por caminho, tipo e sha do blob; sem limpeza |
| `smugan-tsbuild/<hash>.tsbuildinfo` | pasta temporária do SO | tsc incremental | Sem limpeza |
| `smugan-clones-<hash>.json` | pasta temporária do SO | índice de clones | Chaveado pela raiz |
| `.smugan-tsc-*.json`, `.smugan-tscbase-*` | ao lado do tsconfig / do arquivo | entradas temporárias do tsc | Apagados após cada execução; sobras com mais de 10 min são varridas |

As escritas usam um diretório de lock (`<file>.lock`, prazo de 1,5 s para adquirir) e um rename
atômico, de
[`src/file-state.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/file-state.mjs).
Os logs de relatório e de eventos vêm de
[`src/session-log.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/session-log.mjs),
e o estado do turno, de
[`src/turn-state.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/turn-state.mjs).
Níveis de risco forçados e contratos ficam no cache do usuário; veja
[Níveis de risco](../risk-levels/) e [Contrato de aceitação](../contract/).

O adaptador do Codex passa patches V4A por
[`src/patch.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/patch.mjs).
Ele transforma cada patch em uma chamada `Write` ou `MultiEdit` por arquivo, então a mesma
lógica de `pre`, `post` e `stop` se aplica.
