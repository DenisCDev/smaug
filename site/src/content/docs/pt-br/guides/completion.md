---
title: Como a conclusão é verificada
description: O que roda no fim do turno e como o smugan why mostra isso.
---

No fim do turno, o Smugan:

1. analisa de novo os arquivos tocados e cobra só o que o turno introduziu. Um
   problema antigo em um arquivo que foi apenas editado não bloqueia. No Claude Code,
   os arquivos que um comando Bash ou PowerShell alterou no próprio repositório
   durante o turno contam como tocados, tendo como base o que cada um tinha antes do
   turno;
2. compara os testes preexistentes com a versão do início do turno, quando o turno
   também tocou código de produção: uma asserção perdida ou afrouxada segura o turno,
   e um teste ou arquivo de teste removido é listado uma vez;
3. roda o script `typecheck` (ou `type-check`) do projeto, com o gerenciador de
   pacotes indicado pelo lockfile: pnpm, yarn ou npm;
4. roda `vitest related` com os arquivos tocados quando o Vitest está instalado; sem
   ele, roda o script `test`. Em um monorepo, esse script roda só nos pacotes
   tocados, até três; acima disso, roda a suíte inteira;
5. em um projeto em que o turno só tocou arquivos triviais, não roda os testes; sem
   script de typecheck, roda o `tsc` do projeto nos arquivos TypeScript tocados, um
   programa por `tsconfig`, e cobra só os erros que a versão commitada não tinha; um
   `tsc` que sai com erro sem reportar nenhum erro de tipo também segura o turno.
   Durante o turno, a escrita roda só o eslint do arquivo;
6. lista, uma vez por turno e sem apagar nada, o que a busca do agente costuma deixar
   para trás: um script novo que nenhum outro arquivo referencia, chamado `repro`,
   `scratch` ou `debug` ou solto na raiz; um `package.json`, lockfile, `tsconfig` ou
   config de build alterado sem que o contrato de aceite ou os pedidos mais recentes
   da pessoa o mencionem; um `catch`, `?? value` ou guarda novo que faz uma função
   existente retornar um valor padrão onde antes falhava; e uma função nova idêntica a
   outra do repositório, a menos de nomes e literais, com o arquivo e a linha da que
   pode ser reaproveitada. O agente decide o que fica e diz por quê;
7. devolve todas as falhas para a sessão;
8. segura o turno uma vez quando nenhum arquivo tocado é crítico, e até duas quando
   algum é. Só uma regra do gate ou um script com código de saída diferente de zero o
   seguram; se arquivos mudarem durante as verificações, o mesmo fim de turno verifica
   o novo estado uma vez, em vez de segurar o turno.
   No limite, o turno termina sem que o hook rode as verificações de novo: o agente
   mostra a própria execução verde. Onde o host informa qual fim de turno continua uma retenção (Claude
   Code, e o Grok Build pelo adaptador), o limite é o do próprio turno retido: o que o turno seguinte
   escreve é verificado mesmo quando aquele foi interrompido. Em um turno posterior em que toda falha já esgotou
   o próprio limite, o turno termina sem novo bloqueio; uma falha nova bloqueia de novo.

Os scripts rodam em no máximo dois projetos por turno, porque todos dividem o mesmo
timeout do hook. Um terceiro projeto com scripts a rodar aparece como verificação
incompleta, nunca como aprovado; projetos sem nada a rodar não ocupam vaga. O
comportamento completo, com timeouts e arquivos de estado, está na
[documentação do engine](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#hooks-via-installsh).

O fim do turno nunca roda build nem teste de mutação. Os scripts dividem o mesmo
timeout do hook, e quando o timeout se esgota o Smugan falha aberto: a pessoa espera e
nada é verificado. Build e mutação ficam para a CI ou para um pedido explícito.
Um `"stop": {"build": true}` antigo não tem mais efeito, e o `smugan doctor` avisa
sobre ele.

Uma tarefa que mudou só Markdown não dispara typecheck nem testes, porque esses
comandos não mudariam o resultado. MDX continua contando como código, já que faz
parte do build da aplicação.

Para descobrir depois o que aconteceu, rode `smugan why` de dentro do projeto. Ele
mostra a sessão mais recente que trabalhou naquela pasta, ou outra com
`--session <id>`:

- como terminou o último fim de turno que verificou arquivos, e se houve turnos sem
  edição depois dele;
- quais arquivos foram analisados e quais ficaram de fora, com o motivo;
- quais scripts rodaram e com que resultado;
- quais projetos não tinham scripts, e por quê;
- os bloqueios recentes da sessão e as falhas internas.

Essas falhas internas são as que, pela política de falhar aberto, só aparecem como
aviso no momento. Os registros ficam na pasta temporária do sistema por 7 dias.
