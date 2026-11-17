---
title: Código que usa um LLM
description: Como o Smugan detecta engines e modelos de IA e pesquisa um guia para cada par.
---

Quando o projeto usa um engine de IA (um SDK, um framework de agentes, um runtime
fixado em uma imagem) ou escreve o id de um modelo no código, o Smugan identifica os
pares engine + modelo e a versão de cada um, lendo só do disco. O detector conhece
nomes e padrões, listados em `packages/gate/src/ai/signatures.json`; adicionar um
engine ou modelo é uma entrada nesse arquivo. O Smugan não traz guia nem boa prática
para nenhum engine ou modelo.

O guia de um par é pesquisado na primeira vez que um turno edita código que usa um par
sem guia válido: o hook pede a delegação ao subagente `smugan-ai-research`, que
confirma o par no repositório, lê só documentação e releases oficiais e salva até 400
palavras com as fontes. O guia vale por 30 dias e fica em `~/.smugan/ai-guides/`, fora
do checkout. No início de cada sessão, o hook injeta o índice de guias como material
de referência, e as regras de teste para LLM entram só em projetos que usam um LLM:
nada de modelo real nem de texto gerado em testes unitários, só a parte
determinística, e o comportamento do modelo em uma eval separada. Os detalhes estão
na
[documentação do engine](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#ai-guides-per-engine--model-pair).
