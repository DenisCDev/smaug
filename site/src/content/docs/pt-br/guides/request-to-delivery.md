---
title: Do pedido à entrega
description: Critérios de aceite, execução por tarefa, tratamento de revisões e entrega.
---

Quatro peças cobrem o que vem antes do código e o que vem depois da verificação. Elas
são adaptações de fluxos do [Superpowers](https://github.com/obra/superpowers) (MIT)
à abordagem do Smugan: menos conversa e mais evidência, partindo do princípio de que a
pessoa pode não estar acompanhando.

**Critérios de aceite antes do código.** Quando o pedido deixa o resultado em aberto,
o `smugan-build` diz em uma ou duas linhas, antes da primeira edição, o que vai
considerar pronto e o que decidiu por conta própria. Para uma mudança crítica com
resultado em aberto, ele escreve e salva um contrato de 3 a 6 critérios, cada um com
um jeito de verificar. Só pergunta o que é decisão da pessoa e não espera aprovação.
Um pedido claro, como "renomeie X para Y", não precisa de nenhum dos dois.

O hook de pré-escrita lembra o modelo na primeira edição de um arquivo crítico na
sessão. O que é crítico é decidido pelo caminho, nunca pelo modelo: migrations e
`.sql`, `middleware`/`proxy` (arquivo ou pasta), nomes como `auth`, `authorization`,
`session`, `login`, `password`, `jwt`, `token`, `role`, `permission`, `guard`,
`policy`, `billing`, `checkout`, `stripe`, `webhook`, arquivos de env e de segredos,
`package.json` e `Cargo.toml`, e Rust com `unsafe`. Arquivos que não mudam o que o
código faz (prosa, estilos, imagens, fontes, catálogos de tradução) são triviais, e o
resto é normal. `smugan risk <level>` força o nível do checkout por 8 horas; quando
ele rebaixa um arquivo, todo fim de turno avisa a pessoa. O lembrete diz por que o
arquivo é crítico, pede o contrato quando o projeto não tem nenhum em andamento e
menciona o `critic`. Quando todos os critérios do contrato existente estão concluídos,
ele pede para conferir com `smugan contract` antes de substituí-lo, porque o contrato
pode ser de outra sessão. Um contrato ilegível também dispara um lembrete, e
`--set --replace` ou `--clear` resolvem. Ele aparece uma vez por sessão e por projeto
e nunca bloqueia a escrita. Só o Claude Code recebe o lembrete; os adaptadores não.

O contrato fica guardado fora do repositório, um por checkout. Ele não é por sessão
porque o agente não sabe o próprio id de sessão, e os revisores, que são outros
subagentes, precisam encontrar o mesmo arquivo. Para que uma segunda sessão ou uma
tarefa nova não apague o progresso de outra, o `--set` se recusa a substituir um
contrato existente sem `--replace`. `done` e `blocked` exigem a evidência. O `critic` e
o `flow-critic` leem o contrato por conta própria e revisam o diff contra ele, em vez
de reconstruir a intenção a partir do código que estão julgando.

```bash
smugan contract --set contract.json     # quoted request, {behavior, verify} criteria, out of scope, decisions
smugan contract --mark 2 done --evidence "npm test -- shipping → 12 passed"
smugan contract                         # what is left, and the evidence for what is done
```

Os comandos `smugan …` desta seção e das seguintes usam o comando que o `install.sh`
coloca em `~/.local/bin`. Com a pasta fora do `PATH`, use
`node packages/gate/bin/smugan.mjs …`; os agentes encontram esse caminho sozinhos,
pelo `smugan.paths.json` da instalação.

**Um contexto novo por tarefa.** A aderência às instruções cai ao longo de uma
sessão. Quando o contrato tem critérios em partes separadas do código, cada tarefa vai
para um subagente novo que recebe só o que precisa. O agente principal confere cada
critério rodando ele mesmo a verificação. O contrato serve de registro de progresso e
sobrevive à compactação.

As edições de subagentes passam pelos mesmos hooks e entram na mesma verificação de
fim de turno. Isso foi verificado no Claude Code 2.1.316: a edição de um subagente cai
no estado de turno da sessão principal.

**Achados de revisão não são aceitos às cegas.** Todo relatório do `critic` e do
`flow-critic` termina com instruções para quem o recebe:

- reproduzir cada achado antes de corrigir;
- rejeitar, com a saída do comando, um achado que não reproduz;
- devolver à pessoa o que entrar em conflito com uma decisão dela;
- relatar cada achado como corrigido, rejeitado ou aceito.

**Entrega por um único caminho.** Quando a pessoa pede para entregar o trabalho, a
skill `smugan-finish` escolhe o caminho pelas palavras dela e pela convenção do
repositório (histórico de PRs ou commits diretos). Ela executa esse caminho e informa
o status real da CI depois do push, inclusive quando a CI nem começou. Descartar
trabalho exige pedido explícito e confirmação do que será perdido. Commit e push
continuam acontecendo só quando a pessoa pede.
