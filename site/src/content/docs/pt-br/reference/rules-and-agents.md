---
title: Regras, agentes, skills e estilo
description: As regras gerais em claude/CLAUDE.md, cada regra de stack com seu frontmatter paths, os agentes critic, flow-critic e smugan-ai-research, as três skills e o estilo de saída Smugan.
---

Tudo nesta página fica em [`claude/`](https://github.com/DenisCDev/smugan/tree/main/claude) no repositório. O `install.sh` copia isso para `~/.claude/`, o [plugin](/pt-br/reference/plugin/) serve a partir do checkout, e os [adaptadores](/pt-br/adapters/codex/) geram a partir daí os equivalentes do seu host.

## Regras gerais

O [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md) abre com uma linha de precedência: as instruções do usuário sobrepõem estas regras e qualquer skill, inclusive as do smugan. As seções:

| Seção | Resumo |
|---|---|
| Code | Construir o mínimo que resolve o problema por completo (a menor complexidade incidental, não o menor código). Mudar só o que a tarefa exige. Reusar antes de escrever: helper existente > stdlib > recurso da plataforma > dependência instalada > código novo. Comentários só para um porquê não óbvio. Limitar I/O (timeout, limite, teto de concorrência) antes de ajustar números. Um prompt de delegação traz objetivo, escopo, critério de pronto e condição de parada em menos de 150 palavras, fora de mudanças críticas. |
| Development preparation | Antes de mudanças técnicas, usar `smugan-build` e `smugan context --json <target-path>`. Distinguir versões declarada, resolvida pelo lockfile, instalada, de runtime e implantada; desconhecida não é a mais recente. Edições só de prosa não precisam de descoberta. |
| Language | Identificadores de banco em snake_case em inglês. Strings voltadas ao usuário em `{{UI_LANGUAGE}}` e respostas em `{{REPLY_LANGUAGE}}` (preenchidos a partir das configurações de idioma da instalação). Código, identificadores e comentários em inglês; mensagens de commit seguem o projeto. Conteúdo voltado ao cliente nunca expõe como foi feito, o modelo de negócio ou o processo interno; uma divulgação exigida por lei permanece. |
| TypeScript | Strict mode; nada de `any` sem comentário de justificativa. Validar toda entrada externa na fronteira com o validador de schema do projeto (zod quando instalado); adicionar um é uma dependência nova (crítica). Dentro do sistema, confiar nos tipos. |
| Errors | Nenhum erro engolido, nenhum `catch` vazio. Toda chamada de saída tem prazo. Ao ramificar pelos erros de uma API externa, tratar todos os casos que a documentação lista. |
| Secrets | Nunca commitar secrets; usar o mecanismo de env do projeto e atualizar o arquivo de exemplo na mesma mudança. |
| Git | Histórico escrito para um colega sênior que nunca viu a conversa: a mudança de produto e de engenharia, não o processo. Sem proveniência de IA, agente, prompt, feedback ou revisor; sem trailer de coautoria do Claude. O assunto segue o projeto; senão, `type[(scope)]: outcome` (≤ ~72 caracteres). Corpo: comportamento anterior e consequência, comportamento novo e porquê, agrupados por assunto, fechando com as verificações de fato executadas. |
| Definition of done | Crítico: auth, sessões ou permissões; migrations, SQL ou RLS; dinheiro; secrets ou env; exclusão de dados do usuário; integrações externas ou webhooks; dependências novas; Rust `unsafe`. Pronto significa que as verificações que cobrem a mudança (typecheck, lint, testes relacionados) passam, com comando e resultado em uma linha. Uma correção de bug ganha um teste que falha sem a correção; um comportamento novo ganha um teste no seu ponto de entrada; edições reversíveis de baixo impacto não ganham nenhum. Uma mudança crítica, ou uma comum com mais de ~300 linhas alteradas, aciona o `critic`, mais o `flow-critic` quando o usuário vê a mudança. Os revisores recebem o pedido literal, os caminhos tocados e logs reais, nunca um veredito. O que ficar por fazer vai num bloco `⚠️ {{NOT_DONE}}` no fim da resposta. |
| Claims | Uma afirmação sobre o estado do sistema que a sessão não verificou traz sua fonte (`file:line`, `pkg@version`, sha, saída de comando). Uma ausência traz seu escopo. Nome de produto não é evidência até ser resolvido para uma linha de manifesto, lockfile ou configuração. O que uma execução cobriu vem da saída dela. O relatório de um subagente é evidência só da saída que mostra. Um achado de revisão que não se reproduz é descartado com a saída que mostra isso. Só fatos verificados viram memória. |
| Stack rules | As regras ficam em `~/.claude/rules/` e carregam por caminho. Caminhos são pistas, não detecção de framework: confirmar as dependências e a configuração do pacote. Orientação específica de versão tem faixa de cobertura e data de revisão documentadas. |

Os adaptadores reescrevem a seção Stack rules para o seu host e acrescentam uma seção específica dele (por exemplo, [`AGENTS.codex.md`](https://github.com/DenisCDev/smugan/blob/main/adapters/codex/codex/AGENTS.codex.md)).

## Regras de stack

Cada arquivo em [`claude/rules/`](https://github.com/DenisCDev/smugan/tree/main/claude/rules) tem um frontmatter `paths:` que o Claude Code usa para carregá-lo quando um arquivo correspondente é tocado. Os adaptadores e o plugin leem os mesmos globs para ensinar as regras.

| Regra | `paths:` | Cobre |
|---|---|---|
| [`astro.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/astro.md) | `**/*.astro`, `**/astro.config.*` | Confirmar as versões primeiro (docs revisadas em 2026-10-02 para Astro 4–7). Hidratar só a interação necessária; SSR, server islands e Actions precisam do seu adapter; `output: 'hybrid'` é do 4; proteger respostas privadas e secrets do `PUBLIC_`; verificar com `astro check` mais build. |
| [`hono.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/hono.md) | `**/src/**/routes/**`, `**/hono/**`, `**/*.hono.ts` | Vale só quando `hono` está no `package.json`. Docs revisadas em 2026-10-02 para Hono 4. App separado do adapter de runtime; rotas encadeadas para RPC; middleware de validação em toda fronteira e `c.req.valid()`; `Bindings`/`Variables` tipados; um único `onError` na raiz com `HTTPException`; middleware ordenado e com escopo. |
| [`mobile.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/mobile.md) | `**/app.json`, `**/app.config.{js,ts}`, `**/eas.json`, `**/*.kt`, `**/android/**`, `**/ios/**` | Um esboço. Expo / React Native: preservar o fluxo existente; projetos novos começam em Expo managed + expo-router; secrets nunca no bundle; testar em toda plataforma-alvo. Kotlin: preservar o toolkit, projetos novos em Compose, strings em `res/values/strings.xml`. Regras compartilhadas de acessibilidade e locale. |
| [`nextjs.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/nextjs.md) | `**/app/**/*.{ts,tsx}`, `**/next.config.*`, `**/middleware.ts`, `**/proxy.ts` | Vale só para um pacote que usa Next. Docs revisadas em 2026-10-02 para Next 15/16. Diferenças por versão para 16.x (APIs de request assíncronas, Cache Components opt-in, perfil do `revalidateTag`, `proxy.ts`, Turbopack como padrão, `default.js` para parallel slots, padrões do `next/image`), 15.x e 14.x. Server Components por padrão; dados no servidor; Server Actions validadas e autorizadas; invalidação de cache depois de mutação; `loading.tsx`/`error.tsx`; Metadata API; `next/image`, `next/font`. |
| [`pwa.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/pwa.md) | `**/manifest.{json,ts,webmanifest}`, `**/sw.{js,ts}`, `**/service-worker*.{js,ts}`, `**/serwist*`, `**/workbox*` | Manifest e ícones completos (192, 512, maskable, 180 apple-touch); uma estratégia de cache por classe de asset, escrita como comentário; caches versionados; nunca cachear dados autenticados ou pessoais; fallback offline; instalabilidade verificada em dispositivo real ou emulado. |
| [`rust-axum.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/rust-axum.md) | `**/*.rs`, `**/Cargo.toml` | Regras gerais de Rust para qualquer `.rs`; seções de Axum só quando `axum` está no `Cargo.toml`. Sintaxe de path, extractors e `Option<T>` no Axum 0.8 vs 0.7. Extractor de body por último; `State` com `FromRef`; um enum de erro que implementa `IntoResponse`, sem `unwrap` em caminhos de request; nada de chamadas bloqueantes em handlers; layers do `tower`. |
| [`stability.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/stability.md) | `**/*.go`, `**/*.rs`, `**/*.py` | Sobrevivência em produção: prazos, alavancas antes de ajustar números, atrasos. Propositalmente sem glob para `*.ts`/`*.tsx`, que já dividem um orçamento de ensino com outras regras; JS/TS são cobertos pelos dois itens globais do `CLAUDE.md`. |
| [`supabase.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/supabase.md) | `**/*.sql`, `**/supabase/**`, `**/lib/supabase/**` | Caminhos SQL sozinhos não caracterizam Supabase. Docs revisadas em 2026-10-02 para supabase-js 2 e PostgreSQL 16/17/18. Manuseio de chaves e clientes; `getClaims()`/`getUser()`, nunca `getSession()` sozinho; RLS habilitado na migration que cria a tabela, policies por operação; migrations versionadas e só de acréscimo; nomenclatura; contadores atômicos e dinheiro como `numeric` ou centavos; testes de acesso em pgTAP e `SECURITY_NOTES.md`; tipos gerados. |
| [`testing.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/testing.md) | `**/*.test.*`, `**/*.spec.*`, `**/tests/**`, `**/test/**`, `**/*_test.*`, `**/e2e/**`, `**/playwright.config.*`, `**/vitest.config.*`, `**/supabase/tests/**` | Expectativas vindas dos requisitos, não do algoritmo; a menor fronteira com fidelidade suficiente; fixtures parecidas com produção; corridas demonstradas com barreiras. E2E passando por persistência real, com locators baseados em papel. Nunca ficar verde enfraquecendo a suíte; remover um teste exige citar o substituto. |
| [`ui-ptbr.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/ui-ptbr.md) | `**/*.tsx`, `**/*.jsx` | Instalada só quando o idioma de UI é português (`LANGUAGE_RULES` em [`language.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/language.cjs)). Placeholders, aria-labels e erros são voltados ao usuário; `Intl` com `pt-BR` para datas, números e moeda; um piso de acessibilidade. |
| [`ux-flows.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/ux-flows.md) | `**/*.tsx`, `**/*.jsx` | Ações destrutivas confirmam pelo componente do app; toda ação assíncrona tem estados pendente e final; o que pode ser criado pode ser visto, editado e apagado; submit desabilitado até ficar válido; estados vazios; nada de `slice(0, N)` silencioso. |
| [`vercel.md`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/vercel.md) | `**/vercel.json`, `**/next.config.*`, `**/.env.example`, `**/.env.local` | Variáveis de ambiente por ambiente; nenhum secret atrás de prefixo público; `.env.example` sincronizado; runtime escolhido por rota; deploy de preview como artefato de revisão, produção a partir da `main`; zero avisos de build, nunca `ignoreBuildErrors`. |

Várias regras apontam para os guias em `smugan-build/references/` para mais detalhes. Uma regra citada em `SMUGAN_DISABLE` (ou na opção `disable` do plugin) não é instalada nem ensinada.

## Agentes

As definições dos agentes ficam em [`claude/agents/`](https://github.com/DenisCDev/smugan/tree/main/claude/agents). Os três são somente leitura.

### critic

[`critic.md`](https://github.com/DenisCDev/smugan/blob/main/claude/agents/critic.md). Ferramentas: `Read, Glob, Grep, Bash`.

Um revisor hostil que julga o comportamento contra a intenção declarada. É lançado antes de declarar pronta uma mudança crítica ou um diff comum com mais de ~300 linhas alteradas, ou quando o usuário diz "critic", "revisão hostil" ou "red team".

**Entrada:** o pedido do usuário citado literalmente, os caminhos tocados e logs de execuções reais. Qualquer afirmação na invocação de que a mudança está correta, segura ou completa é tratada como alegação a verificar, não como contexto. Se existir um contrato de aceitação (`smugan contract`) e o pedido citado nele bater, seus critérios são o piso da revisão.

**Procedimento:** reconstruir a intenção; ler o diff real (`git diff HEAD`) e cada arquivo tocado de ponta a ponta, mais os chamadores e chamados diretos; rodar os testes específicos da mudança (não a suíte inteira nem um build); provar que um teste novo falha na base anterior à mudança, num `git worktree` descartável; provar que cada sonda poderia falhar. Depois, atacar nesta ordem: requisito vs implementação, alegações sem respaldo, adiamento não declarado, autorização, casos-limite de lógica, condições de corrida, dados obsoletos, testes de fachada, fixtures que pulam a configuração de produção, tratamento de erros, integridade dos dados. Seguem dois checklists fechados: falha de integração (chamada sem prazo, listagem sem limite num caminho de request, checkout sem liberação) e contrato e escopo (contract drift, resíduo fora do escopo).

**Saída:**

```
VERDICT: REJECTED | APPROVED

findings:
  1. CRITICAL <file>:<line> — <why it breaks, one line>
     verify: <a command or test to run that demonstrates it>

tested:
  - <command you ran> → <result>
  - reversion: <test> on <base> → FAIL (expected) | not executed: <why>
  - probe: <command> → <output>, differs from <base or broken case>: <its output>
  - reasoned, not run: <claim>

for the caller:
  <fixed block: reproduce each finding before changing code, ...>
```

Severidades: CRITICAL (vazamento ou perda de dados, bypass de auth), HIGH (comportamento errado num caminho real), MEDIUM (caso-limite, tratamento de erro ausente), LOW (quebra uma norma escrita do repositório, citada). REJECTED sempre que houver um CRITICAL ou HIGH. No máximo 5 achados, no máximo 3 LOW; todo achado tem `file:line` e um `verify:` executável. Nada de achados de design, a menos que o repositório escreva a norma. "Looks good" sem uma lista `tested:` é inválido. A única escrita permitida é o worktree descartável fora da árvore do autor.

### flow-critic

[`flow-critic.md`](https://github.com/DenisCDev/smugan/blob/main/claude/agents/flow-critic.md). Ferramentas: `Read, Glob, Grep, Bash`.

Revisa uma mudança visível ao usuário quanto à completude dos fluxos, uma lente de produto/UX distinta do `critic`. É lançado antes de declarar pronta uma mudança crítica que altera uma tela, formulário ou fluxo, ou um diff de UI com mais de ~300 linhas alteradas, ou diante de "flow review", "revisão de fluxo", "gaps de UX".

**Entrada:** a mesma do critic; os critérios voltados ao usuário de um contrato de aceitação correspondente também são percorridos.

**Procedimento:** listar cada tela, formulário, botão e ação que o diff adiciona ou altera, ler cada componente tocado de ponta a ponta e percorrer cada interação como usuário (toque, sucesso, falha, em andamento, exclusão, lista vazia, retorno a um item criado). Depois, avaliar um checklist fechado: 1 destrutiva sem confirmação, 2 sem feedback, 3 submit antes de ficar válido, 4 beco sem saída, 5 lacuna de affordance, 6 rótulo mentiroso, 7 estado vazio ou de overflow ausente, 8 perigo não sinalizado.

**Saída:**

```
VERDICT: REJECTED | APPROVED

findings:
  1. <MISS # from the checklist> <file>:<line> — <what the user experiences, one line>
     repro: <the exact user step that hits it>

tested:
  - <file read end to end>
  - <git command run>

for the caller:
  <fixed block>
```

REJECTED sempre que houver uma falha nos itens 1–4. No máximo 5 falhas, no máximo 3 dos itens 5–8. Preferências de estilo não são achados; acessibilidade em nível de pixel é marcada como "verify in E2E".

### smugan-ai-research

[`smugan-ai-research.md`](https://github.com/DenisCDev/smugan/blob/main/claude/agents/smugan-ai-research.md). Ferramentas: `Read, Grep, Glob, Bash, WebFetch, WebSearch`.

Escreve o guia de um par engine de IA + modelo que o hook do smugan encontrou no repositório sem guia válido. Usado só quando uma mensagem do smugan pede.

**Entrada:** a chave do par (`engine@major.minor+family@version`, ou `family@version` para um modelo usado sem engine conhecido) e o caminho do projeto.

**Procedimento:** confirmar o par no código (id do modelo em `file:line`, versão do engine pelo que está instalado ou declarado; `smugan ai-guide --project <path>` lista os pares detectados); um par não confirmado não ganha guia. As fontes são a documentação oficial do fornecedor sobre o modelo e a própria documentação, os releases ou o changelog do engine, nunca blogs, fóruns ou memória. No máximo 400 palavras, um primeiro parágrafo de no máximo 60 palavras, toda afirmação citando sua URL, "not confirmed" onde as fontes silenciam. Salvar com `smugan ai-guide --write <file> --project <path>` a partir de um arquivo temporário cujo frontmatter tenha `key`, `reviewedAt` e `sources`.

**Saída:** a chave, o caminho salvo, as confirmações do passo 1 com `file:line` e cada fonte com a data em que foi lida.

Este agente não é instalado pelos adaptadores: a mensagem que o solicita só chega ao modelo pelo launcher do Claude Code ([`adapterAgent`](https://github.com/DenisCDev/smugan/blob/main/adapters/shared/install-tree.mjs)).

## Skills

As skills ficam em [`claude/skills/`](https://github.com/DenisCDev/smugan/tree/main/claude/skills).

### smugan

[`smugan/SKILL.md`](https://github.com/DenisCDev/smugan/blob/main/claude/skills/smugan/SKILL.md). Uma auditoria profunda, sob demanda e somente leitura. Dica de argumento: `[scope: security | rls | ui | flows | dead-code | full (default)]`.

Procedimento: identificar as versões com `smugan context --json --no-cache`; conferir de novo os achados CRITICAL/HIGH em aberto num `SMUGAN_AUDIT.md` existente; rodar `node "<gateDir>/bin/smugan.mjs" check --json` como baseline mecânica; auditar as dimensões security, rls, ui, flows, dead-code, patterns e errors. Reportar uma linha por achado, ordenada por severidade, e depois `smugan: N findings (...) across F files.` e as 3 ações principais, ou `smugan: no findings. The hoard is accounted for.` O relatório completo é gravado em `SMUGAN_AUDIT.md`, o único arquivo que a auditoria edita.

### smugan-build

[`smugan-build/SKILL.md`](https://github.com/DenisCDev/smugan/blob/main/claude/skills/smugan-build/SKILL.md). Prepara uma mudança de código a partir das versões, do runtime e das integrações reais do pacote afetado.

- **Preparar:** rodar `smugan context --json <target-path>` no pacote afetado, ler seus pacotes, evidências, guias e limitações e resolver as versões declarada vs resolvida vs instalada vs de runtime vs implantada. Para versões não cobertas, consultar fontes oficiais da versão correspondente e registrá-las; orientações voláteis são revalidadas depois de 30 dias.
- **Definir pronto:** para um pedido em aberto, dizer o que conta como pronto antes da primeira edição. Para uma mudança crítica, salvar um contrato de aceitação com `smugan contract --set <file.json>` (`request`, `criteria` como `{behavior, verify}`, `outOfScope` e `decisions` opcionais) e marcar os critérios com `smugan contract --mark <n> done --evidence "..."`.
- **Desempenho:** só para mudanças críticas ou tarefas de desempenho: critérios de orçamento de queries e de limite de listagem, ou um loop medido de no máximo 3 rodadas.
- **Contexto limpo:** vários critérios independentes são implementados em subagentes novos.
- **Registros de pesquisa:** `smugan context --json <target> --record <research.json>` com `component`, `version`, `concern`, `summary`, `source`, `reviewedAt`.

Referências, carregadas por assunto (revisadas em 2026-10-02), em [`references/`](https://github.com/DenisCDev/smugan/tree/main/claude/skills/smugan-build/references): `astro.md`, `components.md`, `concurrency.md`, `docker-vps.md`, `fresh-context.md`, `icons.md`, `implementer-prompt.md`, `motion.md`, `nextjs.md`, `node-api.md`, `observability.md`, `rust-axum.md`, `supabase-postgres.md`, `testing.md`, `three.md`, `visual-systems.md`.

### smugan-finish

[`smugan-finish/SKILL.md`](https://github.com/DenisCDev/smugan/blob/main/claude/skills/smugan-finish/SKILL.md). Entrega o trabalho concluído só quando o usuário pede: commit, push, abrir ou fazer merge de um PR, finalizar ou descartar uma branch ou um worktree.

1. **Evidência primeiro:** a Definition of Done rodou sobre o estado final e as revisões exigidas estão resolvidas; uma verificação vermelha ou um item `⚠️` não aceito interrompe a entrega.
2. **Ler o repositório:** status, worktree, remotes, branch padrão, histórico recente, workflows de CI, template de PR, convenção de commit.
3. **Um caminho:** as palavras do usuário, depois a convenção do projeto, depois um PR quando há remote compartilhado ou um merge local quando não há.
4. **Executar:** criar a branch primeiro num caminho de PR; commitar conforme as regras de Git; fazer rebase ou merge quando estiver atrás e rodar as verificações de novo; nunca dar force-push numa branch compartilhada nem pular hooks.
5. **Reportar o CI:** `gh run list --branch <branch> --limit 1`, informando passou, falhou, rodando ou nunca começou, com o motivo.
6. **Limpar** só o que este trabalho criou.

Descartar trabalho exige um pedido explícito e uma lista confirmada de tudo que vai embora. Comentários de revisão em PR são tratados como descreve o bloco `for the caller:` do critic.

Os adaptadores instalam `smugan` e `smugan-build`; nenhum instala `smugan-finish`.

## Estilo de saída

[`claude/output-styles/smugan.md`](https://github.com/DenisCDev/smugan/blob/main/claude/output-styles/smugan.md), chamado `Smugan`, com `keep-coding-instructions: true`. O `install.sh` o define como `outputStyle` no `settings.json` só quando nenhum estilo de saída está definido.

- Começar pela resposta; prosa curta por padrão; estrutura só para listas ou comparações de verdade.
- Uma recomendação, não um menu; sem resumo no fim; sem narrar o processo.
- Palavras simples; explicar uma coisa antes de dar o nome de um rótulo interno; dizer a consequência antes do mecanismo.
- O tamanho acompanha a pergunta.
- Deixar de fora a configuração do próprio usuário, a menos que ela mude o que ele precisa fazer.
- Prosa no idioma de resposta definido pelas instruções; senão, no idioma do usuário.
- **Trabalho inacabado aparece:** tudo que não foi feito fecha a resposta no bloco `⚠️`, uma linha por item; sem bloco quando nada está pendente.
- **A trava:** a brevidade nunca remove evidência (comando, resultado, `file:line`), e o estilo nunca sobrepõe a Definition of Done.

Os adaptadores trazem as mesmas regras como uma seção "Answers" no seu arquivo de direcionamento.
