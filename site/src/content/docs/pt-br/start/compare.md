---
title: Como o Smugan se compara
description: O Smugan ao lado de arquivos de regras, linters no CI, bots de revisão por IA e o Superpowers, e quando cada um é a melhor ferramenta.
---

A maioria das formas de manter um agente de IA honesto age antes do trabalho (instruções) ou depois dele (CI, revisão). O Smugan age durante o próprio turno do agente, em três pontos: antes de um arquivo ser escrito, logo depois da escrita e antes de o turno poder terminar. Essa posição é toda a diferença: o problema é pego enquanto o agente ainda pode corrigi-lo, antes que alguém precise revisá-lo.

## Visão geral

| Abordagem | Quando age | Consegue impedir que uma mudança ruim seja escrita? | Em que se apoia |
|---|---|---|---|
| Arquivos de regras (`CLAUDE.md`, `AGENTS.md`) | Antes do trabalho, como instruções | Não: o agente pode ou não seguir | Na aderência do modelo |
| Linters e testes no CI | Depois de um commit ou pull request | Não: a mudança já existe | Nas ferramentas do próprio projeto |
| Bots de revisão por IA | Depois que o pull request é aberto | Não | Na opinião de um modelo sobre o diff |
| Smugan | Antes da escrita, depois da escrita e no fim do turno | Sim: a escrita é recusada e o arquivo fica intocado | Em verificações determinísticas mais as ferramentas do projeto, e depois em revisores obrigados a achados reproduzíveis |

## Só arquivos de regras

Arquivos de regras dizem o que o agente deveria fazer. Continuam úteis, e o Smugan instala um. Mas uma regra escrita é um pedido: em 1.650 sessões do Claude Code, a aderência ao arquivo de regras caiu ao longo da sessão ([McMillan, arXiv 2605.10039](https://arxiv.org/abs/2605.10039)). O Smugan transforma as regras que dá para verificar mecanicamente em hooks que recusam a escrita, então elas valem na última edição de uma sessão longa tanto quanto na primeira. Veja [O que é verificado](/pt-br/start/introduction/#o-que-é-verificado).

## Linters e testes no CI

O CI roda as suas ferramentas depois que a mudança foi commitada, muitas vezes depois que o agente terminou e devolveu o trabalho. O Smugan roda as mesmas ferramentas, o seu `lint`, o `typecheck` e os testes relacionados aos arquivos tocados, dentro do turno, e segura o fim do turno enquanto elas falham. O próprio agente corrige o problema, em vez de deixá-lo para uma execução do CI e mais uma rodada. O CI continua: o Smugan nunca roda build completo nem teste de mutação no fim do turno e deixa isso para o CI. Veja [Como a conclusão é verificada](/pt-br/guides/completion/).

## Bots de revisão por IA

Um bot de revisão lê um pull request e dá uma opinião. As verificações do próprio Smugan são determinísticas: um bloqueio cita o arquivo, a linha e a regra, e a mesma entrada sempre dá a mesma resposta. Para o que um padrão não consegue provar, o Smugan aciona revisores separados, `critic` e `flow-critic`, só em mudanças críticas ou diffs grandes. Eles leem o diff contra o pedido original e os critérios de aceitação, nunca contra o resumo do autor, e todo achado precisa vir com um jeito de reproduzi-lo; o que não se reproduz é descartado. Os motivos são medidos: num estudo, 56,3% das sugestões de um revisor agêntico foram rejeitadas ([arXiv 2607.03316](https://arxiv.org/abs/2607.03316)), e dizer ao revisor que o código está correto diminui o que ele encontra ([arXiv 2603.18740](https://arxiv.org/abs/2603.18740)). Veja [Regras, agentes e skills](/pt-br/reference/rules-and-agents/).

## Superpowers

O [Superpowers](https://github.com/obra/superpowers) e o Smugan atacam o mesmo problema por pontas opostas, e se combinam. O Superpowers conduz o processo antes do código: intenção, especificação, plano e desenvolvimento guiado por testes. O Smugan cobra a evidência depois: bloqueio, verificações e revisão. Eles se registram em eventos de hook diferentes e usam nomes diferentes, então não colidem, e o `smugan-build` reaproveita uma especificação do Superpowers que já exista em vez de perguntar de novo. Rodar os dois na mesma sessão ainda não foi medido.

## O que mais é diferente

- **Funciona em vários agentes.** O mesmo engine roda no Claude Code, Codex, OpenCode, Antigravity e Grok Build; cada adapter documenta exatamente o que aquela plataforma deixa um hook bloquear. Veja [Outros agentes de código](/pt-br/adapters/).
- **Conhece as versões instaladas.** Antes de uma mudança, o `smugan context` lê as versões que o projeto realmente instala e entrega ao agente o índice da documentação daquela versão, em vez do que o modelo lembra. Veja [Contexto de versão](/pt-br/reference/version-context/).
- **Não precisa de nada extra para rodar as próprias verificações.** O engine lê arquivos do disco: sem rede, sem chave de API, sem tokens de modelo e sem a toolchain do projeto para as regras dele.
- **Custa menos em mudanças pequenas.** A verificação acompanha o risco da mudança: um erro de digitação não ganha revisor, uma migration com regras de acesso ganha o tratamento completo. Veja [Níveis de risco](/pt-br/reference/risk-levels/).
- **É open source.** Licença MIT, com o motivo de cada regra e os estudos por trás dela em [Pesquisa e referências](/pt-br/project/research/).

## Quando o Smugan não é a ferramenta certa

- **Você quer um analisador estático completo.** O engine usa um tokenizador e expressões regulares e prefere precisão, então um padrão ambíguo pode passar. Mantenha seus linters e seu type checker; o Smugan roda eles por você.
- **Você precisa de garantias entre módulos.** A maioria das regras olha um arquivo por vez; decisões que atravessam módulos ficam com os revisores e os seus testes.
- **Seu agente escreve arquivos fora das ferramentas que a plataforma observa.** Essas escritas podem não passar pelo gate antes de acontecer; no Claude Code elas ainda são vistas no fim do turno.

A lista completa está em [Limites conhecidos](/pt-br/project/known-limits/).
