---
title: Usar em um projeto
description: smugan init, smugan check, configuração pessoal e modo de aviso.
---

O modo passivo começa a funcionar nas sessões abertas depois da instalação. Não é
preciso mudar cada projeto.

Para adicionar a estrutura completa de verificação a um repositório:

```bash
smugan init
```

O comando cria só os arquivos que faltam, e só para as stacks que o projeto já
declara; o resto é listado como pulado:

- configuração do Smugan;
- testes de acesso ao banco com pgTAP (Supabase);
- contexto e exemplo de teste E2E (`@playwright/test`);
- `SECURITY_NOTES.md` para documentar quem pode acessar cada dado (Supabase);
- estrutura inicial de observabilidade (`next` com `@sentry/nextjs`);
- workflow de integração contínua.

Para usar só o engine:

```bash
smugan check
smugan check src/ --json
```

Sem a instalação, o mesmo funciona com `node packages/gate/bin/smugan.mjs check`.

### Configuração pessoal

O `smugan.config.json` é do time e vai para o git. Configurações que são só suas vão
no `smugan.local.json`, na mesma pasta; o `smugan init` adiciona esse arquivo ao
`.gitignore` quando ele ainda não está listado.

```json
{ "checks": { "console-log": false }, "hook": { "stop": { "tests": false } } }
```

O arquivo pessoal tem precedência sobre o compartilhado, chave por chave: cada
checagem fica com o valor local, `hook` e `stop` se mesclam campo a campo, e `ignore`
combina as duas listas sem repetir padrões. Sozinho, sem o arquivo compartilhado, o
arquivo pessoal também vale. JSON inválido em qualquer um deles gera um aviso com o
nome do arquivo, e o arquivo é ignorado; o `smugan doctor` diz quando a camada pessoal
está ativa. Um `mode` diferente de `"block"` e `"warn"` também invalida o arquivo.

### Modo de aviso, para código com dívida

Em um projeto que já tem violações, `"mode": "warn"` faz o Smugan só avisar enquanto
o time limpa a base de código. Funciona nas duas camadas; o padrão é `"block"`.

```json
{ "mode": "warn" }
```

Os hooks rodam as mesmas checagens e mostram os mesmos achados, mas nada é bloqueado:
nenhuma escrita é recusada e o fim do turno não é segurado. Os achados chegam pelo
canal não bloqueante de cada plataforma:

| Plataforma | Antes de escrever | Depois de escrever | Fim do turno |
|---|---|---|---|
| Claude Code | contexto do agente e aviso na tela | contexto do agente e aviso na tela | aviso na tela |
| Codex | contexto do agente | aviso na tela | aviso na tela |
| OpenCode | anexado ao resultado da ferramenta | anexado ao resultado da ferramenta | notificação |
| Antigravity, Grok Build | — | — | — |

O Antigravity e o Grok Build não têm canal que chegue ao agente sem bloquear; lá, o
modo de aviso só registra os achados, que o `smugan why` mostra. Um turno que também
tocou um projeto em modo `block` é segurado como antes. As falhas internas do Smugan
continuam deixando o evento passar, como em qualquer modo.

O `smugan check` ignora o `mode` e sai com 1 quando há violação, para que a CI não
afrouxe porque alguém mudou a configuração. Para só listar, use
`smugan check --warn`, que sai com 0. O `smugan doctor` e o `smugan why` dizem quando
o modo de aviso está ativo.

A auditoria mais ampla continua disponível pelo `/smugan`. Ela é somente leitura por
padrão e examina segurança, acesso ao banco, textos de UI, código não usado,
tratamento de erros e conformidade com as regras instaladas.
