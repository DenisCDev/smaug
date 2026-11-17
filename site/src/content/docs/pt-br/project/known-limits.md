---
title: Limites conhecidos
description: O que o engine não enxerga e onde ele falha em modo aberto.
---

- O engine usa um tokenizer e expressões regulares, não uma árvore sintática completa.
- As verificações priorizam a precisão. Um padrão ambíguo pode passar para evitar que um falso positivo
  torne o gate inutilizável.
- A maioria das regras olha um arquivo por vez. Decisões que atravessam módulos ficam para os
  revisores e para os testes do projeto.
- Uma migration precisa habilitar RLS no mesmo arquivo que cria a tabela. Habilitar
  depois deixa uma janela de exposição e é tratado como falha.
- Uma falha interna ou um timeout no Smugan não bloqueia o trabalho. O erro é
  reportado, mas a ferramenta prefere falhar em modo aberto a travar todas as sessões.
- Escritas feitas fora das ferramentas que a plataforma observa podem não passar pelo gate.
  No Claude Code, um arquivo alterado por um comando de shell é visto pelo Git no fim
  do turno, inclusive quando o turno o commita: só no repositório em que o comando rodou
  e junto com qualquer outra coisa que tenha alterado o repositório durante o turno,
  como uma pessoa editando em paralelo (`"hook": {"stop": {"shell": false}}` desliga
  isso). Um commit é do turno quando o reflog do HEAD mostra o turno criando-o (um
  amend conta pelo que acrescenta); o que um pull, merge, checkout ou rebase traz
  não é, seja quem for o autor. Com mais de 2.000 arquivos já alterados, ou passado um
  orçamento de 3 segundos para registrá-los, o fim do turno diz o que não
  verificou.
  O README de cada adaptador registra esse alcance.
- Um revisor baseado em modelo ajuda a achar problemas semânticos, mas não é prova
  determinística. Testes e verificações mecânicas continuam sendo a base para considerar algo pronto.
- A comparação de asserções não percebe um valor esperado alterado, um teste renomeado
  nem `it.each`. Uma mudança de comportamento pedida tem a mesma forma, então esses casos
  ficam para o `critic`.
