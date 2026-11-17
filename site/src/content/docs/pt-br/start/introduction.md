---
title: Introdução
description: O que o Smugan verifica, quando verifica e o que as regras pedem ao agente.
---

Um agente de código pode entregar algo que compila e ainda deixar passar um problema
importante: uma tabela exposta, um erro ignorado, um teste desativado ou uma ação que
nunca atualiza a tela.

O Smugan acompanha a sessão em três pontos. Antes de uma mudança ser escrita, ele
procura violações objetivas. Depois da escrita, roda as ferramentas do próprio
projeto. No fim do trabalho, repete as verificações e exige a prova que a plataforma
disponibiliza antes de aceitar a tarefa como concluída.

Ele não substitui revisão humana, testes nem as regras internas da aplicação. O papel
dele é tornar essas verificações parte do fluxo normal, sem depender de o agente
lembrar de rodá-las.

O nome vem de *smugan*, o verbo do germânico antigo que, segundo o próprio Tolkien, deu nome ao dragão de *O Hobbit*: "espremer-se por um buraco". É por essa fresta que passa o que um agente deixa escapar.
No projeto, a ideia vira uma regra simples: uma mudança precisa deixar evidência do
que alterou e de como foi verificada.


## O que muda na prática

Antes das decisões de implementação, a skill **smugan-build** identifica as versões
do pacote afetado e carrega só os guias relevantes. Ela cobre Next, Astro,
Supabase/PostgreSQL, Node/Express/Nest/Hono, Rust/Axum, Docker/VPS, Redis,
concorrência, observabilidade e bibliotecas de UI. A skill **smugan** continua
dedicada à auditoria. A seleção implícita depende do suporte e das preferências do
host; as instruções compartilhadas também apontam para a etapa de preparação.

O comando `smugan context --json` mantém a evidência entre chats do Codex e do Claude
no mesmo checkout. A execução seguinte confere os arquivos e as versões instaladas
antes de reaproveitar o resultado. Ele não executa configuração do projeto, não
consulta servidores, não lê `.env` e não busca na rede. Veja [contexto de versão e decisões pesquisadas](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#version-aware-context).

Para ativar os parsers depois de clonar, rode
`npm ci --ignore-scripts --prefix packages/gate`. Hooks e checagens continuam
funcionando sem esses parsers; o instalador avisa quando a preparação está
incompleta. Os três parsers têm versões fixadas e lockfile próprio.

| Quando | O que o Smugan faz | O que você recebe |
|---|---|---|
| Antes de implementar | Verifica versões, capacidades e integrações; seleciona guias; escreve os critérios de aceite | Orientação compatível com o pacote afetado e uma definição de pronto verificável |
| Antes de escrever | Analisa só a mudança nova e bloqueia violações conhecidas | O arquivo intocado e uma mensagem com linha, regra e correção esperada |
| Depois de escrever | Roda lint e checagem de tipos quando o projeto oferece esses comandos | Os erros introduzidos pela edição voltam para o agente corrigir |
| Antes de terminar | Verifica de novo os arquivos tocados e roda os testes relacionados | A sessão só termina limpa quando a plataforma permite bloquear o fim do turno |
| Na revisão | Lança revisores separados para comportamento e completude de fluxo, contra o pedido original e os critérios de aceite, nunca contra o resumo do autor | Achados com arquivo, linha e um jeito de reproduzir |
| Na entrega | Escolhe um único caminho de integração e confere a CI depois do push | O status real da CI, inclusive quando ela nem começou |
| Depois | `smugan why` mostra o que rodou, o que foi pulado e por quê | A resposta para "a verificação rodou?" sem abrir a transcrição |

As regras gerais ficam curtas. As regras específicas só entram quando aparece o
arquivo correspondente: banco de dados para migrations, UI para componentes, testes
para suítes e assim por diante. Isso reduz o contexto fixo sem esconder uma regra
quando ela é necessária.

## Um exemplo

Uma migration cria uma tabela com identificadores em português, sem controle de
acesso por linha, sem teste de acesso e sem descrição de quem pode ler os dados. A
escrita é recusada antes de o arquivo existir, com esta mensagem:

```text
smugan gate: blocked — this Write would introduce 5 violations in supabase/migrations/0007_create_clientes.sql:
  line 1  [db-naming]  Portuguese identifier "clientes" ("clientes") — use English snake_case
  line 3  [db-naming]  Portuguese identifier "nome_completo" ("nome") — use English snake_case
  line 1  [rls]  table "clientes" created without RLS — add "alter table clientes enable row level security;" plus per-operation policies in this migration
  line 1  [rls-tests]  table "clientes" has no pgTAP RLS test in supabase/tests/ — instantiate table-rls.test.sql.template (anon denied, owner sees own rows, other user sees zero) and run "supabase test db"
  line 1  [security-notes]  project has no SECURITY_NOTES.md — create it and describe table "clientes" in one plain-language line: who can read, who can write (template: smugan init)
Fix the content and retry. False positive? Add: // smugan-ignore <rule>: <reason (6+ chars)>
```

Renomear para `clients`/`full_name` e ativar RLS resolve só as três primeiras. A
escrita passa quando também existe um teste pgTAP que referencia a tabela em
`supabase/tests/` e uma linha sobre ela no `SECURITY_NOTES.md`. Uma escrita permitida
não imprime nada: silêncio é o resultado normal.

O mesmo vale para um teste desativado durante a correção de uma falha. O Smugan
bloqueia a adição de `.skip`, `.only`, `.todo`, de um marcador que faz um teste que
falha passar (`test.fail`, `it.fails`) e de testes sem asserções. Quando o turno muda
código de produção, um teste existente também não pode perder asserções nem trocar
`toBe(0)` por `toBeDefined()` sem um motivo registrado no código, e um teste que é
apagado, comentado ou perde o arquivo é listado para o agente restaurar ou explicar.
Um problema antigo que a edição não tocou continua visível, mas não bloqueia uma
mudança não relacionada.

## O que é verificado

O engine usa análise textual deliberadamente estreita. Ele cobre padrões em que um
resultado determinístico é mais útil do que uma opinião.

| Área | Verificações |
|---|---|
| Banco de dados e acesso | Nomes SQL em inglês; em projetos Supabase, RLS na criação da tabela, policies que deixam um papel de navegador atualizar ou apagar todas as linhas ou que confiam em `user_metadata`, views e funções `security definer` que contornam o RLS, permissões anônimas, testes pgTAP e uma descrição legível da política de acesso |
| Dados e segurança | segredos conhecidos nos arquivos-fonte de qualquer linguagem, uma URL de banco que carrega a senha, tipos inadequados para dinheiro e chamadas de rede sem timeout |
| TypeScript e erros | `any`, `@ts-nocheck` e `@ts-ignore` sem justificativa, `catch` vazio, imports não usados e logs esquecidos |
| UI | com UI em pt-BR, texto visível em inglês ou sem acentuação; sempre, mutações que mudam dados sem atualizar a tela |
| Testes | testes desativados, focados, pendentes ou sem asserções; asserções removidas ou afrouxadas em um teste existente, e testes ou arquivos de teste removidos, quando o turno também mudou código de produção |
| O que o turno deixou para trás | no fim do turno, listados uma vez: um script de exploração que nada referencia, um `package.json`, lockfile, `tsconfig` ou config de build que nem o contrato nem o pedido mencionam, uma função existente que passa a retornar silenciosamente um valor padrão, e uma função nova que duplica outra do repositório |
| Desempenho, só em turnos críticos | uma consulta ao banco aguardada a cada iteração de um loop (N+1) |

A lista completa, com o escopo e os falsos negativos aceitos de cada regra, está na
[documentação do engine](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md).

Uma exceção legítima precisa explicar o motivo:

```ts
// smugan-ignore fetch-timeout: the internal client already applies a 5-second timeout
```

Um comentário sem justificativa suficiente também é rejeitado. A exceção fica no
código para que outra pessoa entenda por que aquela regra não se aplica.

## O que as regras pedem ao agente

As checagens pegam o que dá para provar pelo texto do arquivo. O resto vira
instruções em [`claude/CLAUDE.md`](https://github.com/DenisCDev/smugan/blob/main/claude/CLAUDE.md), que o instalador copia
para as regras globais. Cada seção existe por um motivo concreto:

| Seção | O que pede | Por quê |
|---|---|---|
| Code | O mínimo que resolve o problema por completo, só o que a tarefa exige, reutilizar antes de escrever, comentários só para o porquê não óbvio, timeouts e limites de I/O antes de ajustar números | Um diff maior que o pedido custa tempo de revisão e esconde o que importa. Um pool maior ou um retry mais rápido tende a amplificar um travamento em vez de resolvê-lo |
| Development preparation | `smugan-build` e `smugan context --json` antes de uma mudança técnica, distinguindo versões declaradas, resolvidas no lockfile, instaladas, de runtime e implantadas | Orientação escrita para outra versão produz código errado para a instalada. Uma versão desconhecida não é tratada como a mais recente |
| Language | SQL em snake_case em inglês, UI no idioma escolhido na instalação (desligado por padrão), código em inglês, commits no idioma do projeto, conteúdo voltado ao cliente que não revela ferramentas, modelo de negócio ou processo | Um nome no banco é um contrato com todo código que o consulta. O texto da UI é o que as pessoas leem |
| TypeScript | Strict mode, `any` só com justificativa, zod em toda entrada externa | Os tipos só são confiáveis dentro do sistema se a fronteira validou o que entrou |
| Errors | Nada de `catch` vazio, timeout em toda chamada externa, tratar todo erro que a documentação de uma API lista | Um travamento é pior que um erro rápido. Um app tratava como "nome já usado" só o 409 que um teste retornou; o 400 documentado para o mesmo caso virou uma falha genérica |
| Secrets | Segredos fora do repositório, `.env.example` atualizado na mesma mudança | Um segredo commitado fica no histórico depois de apagado |
| Git | Histórico escrito para um colega que nunca viu a tarefa: mudança de produto e de engenharia, nunca o processo; sem atribuição a IA nem trailer de coautoria; as checagens que rodaram no fim do corpo | O histórico é permanente e lido por pessoas que não têm a conversa |
| Definition of done | O que é uma mudança crítica (auth, migrations e SQL, dinheiro, segredos, exclusão de dados, integrações externas, dependências novas, `unsafe` em Rust); as checagens que cobrem a mudança verdes, com comando e resultado, sem repetir uma execução que já passou na sessão; um teste que falha sem a correção para um bug fix e um por comportamento novo, nenhum para uma edição reversível de baixo impacto; `critic` e `flow-critic` só para uma mudança crítica ou um diff comum acima de ~300 linhas; o revisor recebe o pedido original, os arquivos e os logs da última execução real, nunca o veredito; pendências em um bloco `⚠️ NÃO FEITO` no fim | Verificação uniforme custa o mesmo num erro de digitação e numa migration com RLS. Testes escritos por agente em volume não mudam o resultado (arXiv 2602.07900); o que conta é o teste que falha antes e passa depois. Dizer ao revisor que o código está correto derruba a detecção (tabela do estudo abaixo) |
| Claims | Uma afirmação sobre o estado do sistema que a sessão não verificou traz a fonte na mesma linha (`file:line`, versão, sha ou saída de comando); o que a sessão rodou e viu passar já é evidência; ausência tem escopo; nome de ferramenta não é evidência; o que uma checagem cobriu vem da saída e dos logs dela; um relatório de subagente com comando, código de saída e saída é evidência do que a saída mostra, e o resto dele é pista; um achado de revisão que não reproduz é descartado | Um glob que não casa com nada sai com sucesso. Um PR citou testes de uma pasta inexistente porque o texto veio do comando digitado, e uma issue trouxe detalhes de outra versão tirados de um relatório. Mandar o agente desconfiar de tudo o fez rodar de novo o que já tinha passado: os modelos atuais seguem instruções enfáticas ao pé da letra |
| Stack rules | As regras de stack carregam pelo caminho do arquivo; o caminho é uma pista, não detecção de framework | React não implica Next, e PostgreSQL não implica Supabase |

As regras de stack ficam em [`claude/rules/`](https://github.com/DenisCDev/smugan/blob/main/claude/rules/) e só entram no contexto
quando o arquivo tocado casa com o caminho declarado no topo de cada uma:

| Regra | Carrega com | Cobre |
|---|---|---|
| `supabase.md` | `*.sql`, `supabase/**`, `lib/supabase/**` | chaves e clients, RLS, migrations, nomenclatura, concorrência, prova com pgTAP |
| `nextjs.md` | `app/**/*.{ts,tsx}`, `next.config.*`, `middleware.ts`, `proxy.ts` | diferenças entre versões, componentes, dados, cache e revalidação |
| `astro.md` | `*.astro`, `astro.config.*` | hidratação mínima, adapters, diferenças entre versões, `astro check` |
| `hono.md` | `src/**/routes/**`, `hono/**`, `*.hono.ts` | estrutura, validação, erros e middleware |
| `rust-axum.md` | `*.rs`, `Cargo.toml` | handlers, estado, erros e disciplina assíncrona |
| `stability.md` | `*.go`, `*.rs`, `*.py` | timeouts que contêm falhas, onde aplicar esforço, lentidão |
| `vercel.md` | `vercel.json`, `next.config.*`, `.env.example`, `.env.local` | ambientes, runtime, deploys e build |
| `pwa.md` | manifest, service worker, `serwist*`, `workbox*` | manifest, service worker, offline e critérios de aceite |
| `mobile.md` | `app.json`, `app.config.*`, `eas.json`, `*.kt`, `android/**`, `ios/**` | Expo/React Native e Kotlin (ainda um rascunho) |
| `ui-ptbr.md` | `*.tsx`, `*.jsx` | só com `SMUGAN_UI_LANG=pt-BR`: texto em pt-BR, formatos de data e moeda, acessibilidade básica |
| `ux-flows.md` | `*.tsx`, `*.jsx` | confirmação de ações destrutivas, feedback para ações assíncronas, becos sem saída, estados vazios |
| `testing.md` | arquivos e pastas de teste, configs do Playwright e do Vitest, `supabase/tests/**` | E2E, unitários, testes existentes, banco de dados e Definition of Done |

A skill `smugan-build` carrega guias mais longos por tema (Next, Astro,
Supabase/PostgreSQL, APIs Node, Rust/Axum, Docker/VPS, concorrência, observabilidade,
testes e bibliotecas de UI) com base nas versões que o `smugan context` encontrou.
Para uma mudança crítica em um handler ou listagem, ela pede critérios de desempenho
que um teste verifica (no máximo K consultas para N itens, uma listagem com limite),
e para uma tarefa que o usuário chama de trabalho de desempenho, ela mede antes e
depois, em até 3 rodadas. A skill `smugan` roda a auditoria completa sob demanda.

Na primeira edição, por sessão e por pacote, de um arquivo que uma dessas regras
cobre, o hook entrega ao agente o índice da documentação que as dependências
instaladas trazem (como `node_modules/next/dist/docs` no Next 16.2+) e as assinaturas
`.d.ts` do que o arquivo importa, limitado a ~2k tokens e nunca o conteúdo da
documentação. Uma skill com a mesma informação fica sem ser chamada boa parte das
vezes; uma regra por caminho sempre chega.

### Estilo de resposta

O [estilo Smugan](https://github.com/DenisCDev/smugan/blob/main/claude/output-styles/smugan.md) muda como o agente fala, não o
que ele faz com o código. Uma resposta abre com a conclusão, em prosa curta, sem
fórmulas de despedida, e evita rótulos internos que o leitor nunca viu. Tudo o que
ficou por fazer vai no bloco `⚠️ NÃO FEITO`, no fim e separado, porque uma pendência
mencionada no meio de um parágrafo passa despercebida e a resposta parece concluída
quando não está. Encurtar nunca remove evidência: o comando executado, o resultado e
a referência `file:line` ficam. Para usar outro estilo, troque no `/config` ou defina
`outputStyle` no `settings.json`.
