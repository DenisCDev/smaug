---
title: Pesquisa e referências
description: Os estudos e projetos por trás de cada decisão de design.
---

O design combina regras curtas no contexto com verificações mecânicas depois delas. As
principais decisões se apoiam nas referências abaixo:

- Anthropic: [memória e regras](https://code.claude.com/docs/en/memory),
  [hooks](https://code.claude.com/docs/en/hooks) e
  [boas práticas](https://code.claude.com/docs/en/best-practices);
- Supabase: [testes de banco de dados](https://supabase.com/docs/guides/local-development/testing/overview)
  e [`supabase test db`](https://supabase.com/docs/reference/cli/supabase-test-db);
- Playwright: [locators baseados no que o usuário percebe](https://playwright.dev/docs/locators);
- OpenAI: [CriticGPT](https://arxiv.org/abs/2407.00215), sobre revisar respostas
  produzidas por modelos;
- Distyl AI: [IFScale](https://arxiv.org/abs/2507.11538), sobre a queda de aderência à
  medida que o número de instruções cresce;
- [ponytail](https://github.com/DietrichGebert/ponytail), uma referência de regras curtas
  e imperativas;
- [basejump/supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers),
  a base MIT dos helpers de pgTAP incorporados aos templates;
- [Superpowers](https://github.com/obra/superpowers) 7.0.1 (MIT, Jesse Vincent). Dele
  vieram, adaptados e reescritos para o Smugan:
  - os critérios de aceitação, de brainstorming;
  - o executor com contexto novo por tarefa, de subagent-driven-development;
  - o ciclo de teste das regras, de writing-skills;
  - o bloco para quem recebe a revisão, de receiving-code-review;
  - a entrega, de finishing-a-development-branch;
  - o `smugan why`, de diagnosing-superpowers;
  - o smoke test pós-instalação.

### Usando junto com o Superpowers

Os dois atacam o mesmo problema por pontas opostas. O Superpowers conduz o processo
antes do código: intenção, especificação, plano e TDD. O Smugan exige a evidência
depois: bloqueio, verificações e revisão.

No Superpowers 7.0.1, o plugin registra só um hook `SessionStart`, e suas skills
ficam no namespace `superpowers:`. O Smugan usa `PreToolUse`, `PostToolUse` e
`Stop`, com skills e agentes sob nomes próprios, então não há componente com o
mesmo nome nem hook no mesmo evento. Quando já existe uma especificação de
brainstorming, o `smugan-build` tira os critérios dela em vez de entrevistar a pessoa
de novo.

A combinação dos dois na mesma sessão ainda não foi medida.

### Revisão de outubro de 2026

Estudos publicados depois do design original confirmaram a combinação de regras curtas
com bloqueio mecânico e levaram aos ajustes abaixo. A maioria ainda é preprint;
o estudo da Atlassian saiu no ICSE 2026.

| Estudo | O que mostrou | O que mudou no Smugan |
|---|---|---|
| McMillan, [arXiv 2605.10039](https://arxiv.org/abs/2605.10039) | Em 1.650 sessões do Claude Code, a aderência ao arquivo de regras cai ao longo da sessão (chance cerca de 5,6% menor por função gerada); tamanho e posição das regras não tiveram efeito detectável | Confirma o bloqueio por hooks em vez de confiar na regra escrita |
| Gloaguen et al. (ETH), [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) | Arquivos de contexto não aumentam a taxa de sucesso e deixam as execuções mais de 20% mais caras; ajudam quando descrevem práticas fora do padrão | O `CLAUDE.md` perdeu as linhas genéricas e ficou com as convenções próprias |
| Zhong, Raghunathan e Carlini, [ImpossibleBench](https://arxiv.org/abs/2510.20270) | Mais de 79% das trapaças dos modelos Claude foram editar o teste; monitores baseados em LLM pegaram de 42% a 65% delas em tarefas reais | Nova regra `assertion-weakening` no fim do turno |
| Ma et al., [Building to the Test](https://arxiv.org/abs/2606.28430) | Com acesso aos testes, os agentes entregam o que é verificado, não o que foi pedido | O `critic` exige que o teste falhe sem a mudança, num worktree descartável, e verifica o ponto de entrada real |
| Alexopoulos et al., [arXiv 2603.18740](https://arxiv.org/abs/2603.18740) | Dizer ao revisor que o código está correto derruba a detecção (Claude Sonnet 4.5: de 97% para 75%); remover a descrição do PR recupera parte dos casos | Quem chama o revisor passa o pedido original, não o veredito; o `critic` forma seus achados a partir do diff |
| Tantithamthavorn et al. (Atlassian), [arXiv 2601.01129](https://arxiv.org/abs/2601.01129) | Em 12 meses, 38,7% dos comentários do revisor LLM levaram a mudanças no código, contra 44,5% dos comentários humanos | O `critic` só reporta o que levaria a mudar o código: no máximo cinco achados, três deles LOW |
| Wataoka et al., [arXiv 2410.21819](https://arxiv.org/abs/2410.21819) | Juízes LLM favorecem texto que lhes parece familiar, como o que eles mesmos geram | `SMUGAN_REVIEW_MODEL` opcional; o padrão continua sendo o modelo da conversa porque a evidência para código é mista |

### Revisão de novembro de 2026

A versão 0.20 passou a verificar de acordo com o risco da mudança, em vez de aplicar
a mesma cerimônia a tudo. Os estudos abaixo sustentam o mecanismo; atribuir
cada sintoma (lentidão, testes demais, paradas, reverificação) a uma regra específica do Smugan
continua sendo hipótese até as execuções A/B em `evals/`. A maioria é preprint ou
documentação de empresa.

| Estudo | O que mostrou | O que mudou no Smugan |
|---|---|---|
| Chen et al., [arXiv 2602.07900](https://arxiv.org/abs/2602.07900) | No SWE-bench Verified, tarefas resolvidas e não resolvidas têm frequência de testes parecida; mudar o volume de testes via prompt, em 4 modelos, não alterou o resultado de forma significativa | A Definition of done troca "testes verdes para tudo" por um teste que falha sem a correção, para correção de bug, e um por comportamento novo, nenhum para edição reversível |
| Mündler et al., [SWT-Bench](https://arxiv.org/abs/2406.12952) (NeurIPS 2024) | Testes gerados que falham antes e passam depois da correção funcionam como filtro e dobram a precisão do SWE-Agent | O teste que falha sem a correção continua obrigatório e o `critic` ainda o comprova num worktree |
| Anthropic, [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Opus 4.5 e 4.6 respondem mais ao system prompt, e linguagem agressiva ("CRITICAL: You MUST") pensada para evitar acionamento de menos passa a causar acionamento demais | `CLAUDE.md` em tom neutro; a seção Claims deixa de mandar o agente desconfiar de tudo e aceita como evidência o que a sessão executou |
| Huang et al., [arXiv 2310.01798](https://arxiv.org/abs/2310.01798) (ICLR 2024) | Sem feedback externo, os modelos não se autocorrigem e às vezes pioram depois de tentar | Revisão e verificação ancoradas num comando, teste ou reprodução; um achado que não se reproduz é descartado |
| Laban et al., [FlipFlop](https://arxiv.org/abs/2311.08596) | Questionados com "are you sure?", 10 modelos mudaram a resposta em cerca de 46% dos casos e perderam 17% de acurácia em média | Saiu a instrução de reverificar tudo: uma execução que já passou na sessão não é repetida só para confirmar |
| Sadowski et al., [Lessons from building static analysis tools at Google](https://cacm.acm.org/research/lessons-from-building-static-analysis-tools-at-google/) (CACM 2018) | Verificações mostradas na revisão toleram até 10% de falsos positivos efetivos; verificações que param o build não podem ter nenhum | O fim do turno só retém por uma regra do gate ou um script com exit code diferente de zero: um bloqueio num turno comum, dois num crítico |
| Petrović et al., [arXiv 2102.11378](https://arxiv.org/abs/2102.11378) | O mutation testing no Google roda só em linhas alteradas e cobertas, com no máximo um mutante por linha, e 82% dos mutantes com feedback foram marcados como úteis (depois 89%) | Mutação e build ficam para o CI ou sob demanda, nunca no fim do turno, que divide um timeout curto |
| Abreu et al. (Meta), [arXiv 2410.06351](https://arxiv.org/abs/2410.06351) | Barrar os 5%, 10% e 50% de diffs mais arriscados capturou 18,7%, 27,9% e 84,6% dos incidentes | Três níveis de risco decididos pelo caminho do arquivo, com rigor total só para o crítico |
| Rajasekaran (Anthropic), [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) | Um avaliador separado compensa quando a tarefa passa do que o modelo resolve sozinho e vira custo sem ganho dentro dessa capacidade; cada peça do harness codifica uma suposição a rever a cada modelo | `critic` e `flow-critic` só para mudança crítica ou diff comum com mais de ~300 linhas |
| Jin e Chen, [Are LLMs reliable code reviewers?](https://link.springer.com/article/10.1007/s10515-026-00638-5) (Automated Software Engineering, 2026) | Revisores LLM frequentemente apontam código correto como defeituoso, e prompts mais detalhados, sobretudo os que pedem explicação e correção, aumentam o erro | No máximo cinco achados por revisão, três deles LOW, cada um reproduzido pelo próprio `verify` |

O protótipo anterior, [`gate`](https://github.com/DenisCDev/gate), definiu a primeira
separação entre regras, bloqueios e prova. O Smugan manteve essa ideia, removeu o
toolchain obrigatório por projeto e concentrou o engine em verificações que funcionam sem
instalar dependências.

### Revisão de novembro de 2026: qualidade do código

A segunda rodada de novembro perguntou o que melhora a qualidade do código do agente por
token gasto, sem ler o diff. A evidência aponta para três coisas: o contexto da versão
instalada sempre presente e compacto, verificação determinística no fim do turno com
limite de rodadas e remoção mecânica do que a busca do agente deixou para trás. Prompts
genéricos de qualidade e revisores sem escopo fechado custam muito e quase não mudam o resultado. Quase tudo abaixo é preprint ou
documento de empresa, e nenhuma das mudanças rodou ainda numa sessão real.

| Estudo | O que mostrou | O que mudou no Smugan |
|---|---|---|
| Vercel, [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) (documento do fornecedor) | Um índice de 8 KB das docs instaladas do Next.js, sempre no contexto, levou as evals de API do Next 16 de 53% para 100%; a mesma informação como skill ficou em 53%, porque não foi invocada em 56% dos casos | O `smugan context` gera o índice das docs da versão instalada, e o hook `pre` o entrega na primeira edição de um arquivo coberto por uma regra de stack, uma vez por sessão e por pacote |
| Vercel, [How Next.js supports AI coding agents](https://nextjs.org/docs/app/guides/ai-agents) (documento do fornecedor) | O Next.js passou a distribuir as docs da versão dentro do pacote | O índice aponta para `node_modules/next/dist/docs`, que nesta máquina já existe no `next@16.2.10` e não existe no 16.0.10 |
| "When LLMs Lag Behind", [arXiv 2604.09515](https://arxiv.org/abs/2604.09515) (preprint) | Em 270 atualizações reais de API, só 42,55% do código gerado sem documentação roda no ambiente-alvo; com documentação estruturada, 66,36% | O mesmo índice, com os caminhos das docs da versão instalada e a frase "Prefer what these docs say over what you remember about the version." |
| "On Mitigating Code LLM Hallucinations with API Documentation", [arXiv 2407.09726](https://arxiv.org/abs/2407.09726) (preprint) | Só a assinatura da API rende 86,82% de chamadas válidas, contra 88,75% com a doc completa, que custa 13× mais tokens; recuperação irrelevante piora as APIs frequentes | O índice traz as assinaturas `.d.ts` do que o arquivo importa e nunca o corpo de uma doc, com teto de ~2k tokens |
| TRIM, [arXiv 2607.18161](https://arxiv.org/abs/2607.18161) (preprint) | Na minimização de patches no SWE-bench Verified, os arquivos removidos eram scripts de reprodução (49,6% das linhas removidas) e mudanças de build/config (35,8%), com a correção oculta preservada em 99,1% | O fim do turno lista, uma vez e sem apagar, um script novo que nada referencia e config alterada que nem o contrato nem o pedido mencionam (`exploration-residue`) |
| CodeThread, [arXiv 2606.21804](https://arxiv.org/abs/2606.21804) (preprint) | Construir sobre código de agente reduziu a resolução da tarefa seguinte em até 13,1 pontos; o preditor foi a deriva no contrato de entrada e de erro (OR 1,83), que sobreviveu em 85,9% dos casos, e as complexidades ciclomática, cognitiva e de Halstead não previram nada | Detector `contract-drift` no fim do turno, só em funções existentes; um item fechado no `critic`; nenhum limite de complexidade como bloqueio |
| RepoReuse, [arXiv 2609.35357](https://arxiv.org/abs/2609.35357) (preprint) | Em 3.000 turnos, os agentes deixaram lógica duplicada em 50,8% das cadeias até o turno 5, com taxa de aprovação quase inalterada | Detector de `clone` dos tipos 1 e 2 no fim do turno, com índice incremental e teto de 500 ms |
| PerfAgent, [arXiv 2607.19653](https://arxiv.org/abs/2607.19653) (preprint) | Feedback de profiler no loop dobrou os patches que batem com o do especialista (19,6% → 39,2% no GSO; 26% → 74% no SWE-fficiency-Lite); só instruir o agente a usar o profiler ficou em 16,7%, número que o relatório tirou de uma fonte secundária | No `smugan-build`, uma tarefa de desempenho mede antes e depois, em até 3 rodadas; uma mudança crítica num handler ganha um critério de contagem de queries; `await-in-loop` no `pre`, só em turnos críticos |
| PERFOPT-Bench, [arXiv 2607.07744](https://arxiv.org/abs/2607.07744) (preprint) | Speedup bruto é uma métrica insegura: parte dos grandes ganhos vem de atalhos que exploram o benchmark | A rodada medida termina com a suíte verde, e a tarefa de N+1 em `evals/` usa um volume oculto |
| Cost-Aware Text-to-SQL, [arXiv 2512.22364](https://arxiv.org/abs/2512.22364) (preprint) | Filtros de partição faltam em até 50% das queries geradas, e o custo varia até 3,4× entre modelos | O critério "a listagem tem limite" entra no contrato de uma mudança crítica numa listagem |
| Stripe, [Minions, part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) (post de engenharia) | Nós determinísticos (lint em menos de 5 s) intercalados com nós agênticos; o CI fica em 2 rodadas por retornos decrescentes | Os detectores novos são determinísticos e cada achado aparece uma vez; o fim do turno mantém 1 bloqueio num turno comum e 2 num crítico |
| Anthropic, [code-simplifier](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) (documento do fornecedor) | O time do Claude Code usa um agente para simplificar o código alterado no fim da sessão; nenhum número de efeito é publicado | A limpeza de fim de sessão vira uma verificação mecânica (resíduo e clone), sem passada extra de modelo |
| SlopCodeBench, [arXiv 2603.24755](https://arxiv.org/abs/2603.24755) (preprint) | A erosão estrutural cresce em 80% das trajetórias; o prompt anti-slop com lista concreta corta cerca de 1/3 da verbosidade inicial, sem mudar a inclinação nem a taxa de aprovação, e custou +47,9% no GPT 5.4 | O bloco de gotchas virou um rascunho medido (`evals/drafts/gotchas.md`, cenário `claude-md-gotchas`), fora do `CLAUDE.md` instalado |
| Kadam, [arXiv 2610.38977](https://arxiv.org/abs/2610.38977) (preprint) | Um prompt de qualidade numa única chamada não reduziu os problemas do analisador em nenhum de 4 modelos; um revisor agêntico não supera best-of-n com o mesmo orçamento; um loop de analisador rodado até zerar derruba o pass@1 em até 9,94 pontos | Nenhuma frase genérica de qualidade nova no `CLAUDE.md`; o `critic` mantém um checklist fechado |
| CodeRabbit, [arXiv 2607.03316](https://arxiv.org/abs/2607.03316) (preprint) | Em 31 mil comentários, 56,3% das sugestões do revisor agêntico foram rejeitadas; dessas, 43,3% eram falsos positivos e 23,7% trade-offs intencionais | O `critic` abandonou achados de design e organização sem norma escrita no repositório, e um achado sem `verify` executável é descartado |
| Goldman et al., [What Types of Code Review Comments Do Developers Most Frequently Resolve?](https://www.researchgate.net/publication/396291600_What_Types_of_Code_Review_Comments_Do_Developers_Most_Frequently_Resolve) (ASE 2025, revisado por pares) | Comentários de design foram resolvidos em 28,6% dos casos, contra 43,3% dos de legibilidade | LOW no `critic` agora exige uma norma citada que o repositório tenha por escrito |
| SWE-Shield, [arXiv 2604.05955](https://arxiv.org/abs/2604.05955) (preprint) | Patches que passam nos testes satisfazem as restrições de design do repositório em só 32,64–50,20% dos casos, e dar ao agente a restrição da issue quase não muda isso | O que conta como achado de design no `critic` é a norma que o repositório escreve, não a preferência do revisor |

Ficaram de fora por falta de evidência, para medir no harness antes de qualquer adoção: o
próprio bloco de gotchas, testado só em modelos da OpenAI; contar queries como guarda do
agente, o que nenhum estudo mede; detecção de waterfall e re-render em React/Next; um
mapa de símbolos do módulo tocado para aumentar o reuso; e replicar cada número acima
em Opus e Gemini, já que o PerfAgent rodou só no GPT-5.1 e a eval da Vercel não
informa o modelo.

O relatório completo, com a tabela por dimensão, o que não acrescentar e a qualidade de cada
fonte, está em [docs/senior-quality.md](https://github.com/DenisCDev/smugan/blob/main/docs/senior-quality.md).
