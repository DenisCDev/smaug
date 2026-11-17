---
title: Níveis de risco
description: Como o smugan classifica cada arquivo como trivial, normal ou crítico pelo caminho, e como o `smugan risk` sobrepõe o nível de um checkout.
---

Cada arquivo recebe um de três níveis: `trivial`, `normal` ou `critical`. O hook
decide o nível pelo caminho do arquivo e, no caso de Rust, também pelo conteúdo. O modelo
nunca decide. Um turno assume o nível mais alto entre seus arquivos. Tudo isso está em
[`packages/gate/src/risk.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/risk.mjs).

## O que o nível muda

| Nível | Efeito |
|---|---|
| `critical` | O Stop permite 2 retenções por turno em vez de 1. No `pre`, os achados de `await-in-loop` que a edição adiciona são julgados. A primeira edição da sessão num arquivo crítico, em cada projeto, retorna um lembrete para rodar os revisores, com uma sugestão de contrato. |
| `normal` | A execução completa de fim de turno: gate, typecheck e testes. |
| `trivial` | Numa raiz de projeto cujo nível é trivial, o Stop mantém o gate e o typecheck e pula os testes (`tests (<root>: trivial level)` aparece como pulado). |

## Caminhos críticos

A comparação é feita sobre um caminho normalizado. Primeiro, as fronteiras de camelCase e de
siglas viram hífens: `JWTService` → `jwt-service`, `withAuth` → `with-auth`. Depois, o caminho
vai para minúsculas. Os nomes casam como palavras inteiras: uma palavra precisa estar delimitada pelo início ou fim do
caminho ou por um de `/ . _ ( ) [ ] -`. Assim, `withAuth.ts` e `(auth)/` casam, e
`author.ts` não. Arquivos de prosa (`.md`, `.markdown`, `.txt`, `.rst`, `.adoc`) nunca
são críticos.

Os padrões são verificados nesta ordem, e o primeiro que casar dá o motivo:

| Motivo | Padrão |
|---|---|
| `migration` | um segmento `migration/` ou `migrations/` |
| `SQL` | um nome terminado em `.sql` |
| `request middleware` | `middleware` ou `proxy` como arquivo (`.js`, `.jsx`, `.ts`, `.tsx`, `.cjs`, `.mjs`, `.cts`, `.mts`, …) ou pasta |
| `auth or permissions` | as palavras inteiras `auth`, `authn`, `authz`, `authentication`, `authenticate`, `authenticated`, `authenticates`, `authenticator`, `authorization`, `authorize`, `authorized`, `authorizes`, `authorizer`, `oauth`, `oauth2`, `session`, `sessions`, `login`, `logout`, `signin`, `sign-in`, `signup`, `sign-up`, `password`, `passwords`, `credential`, `credentials`, `jwt`, `token`, `tokens`, `permission`, `permissions`, `role`, `roles`, `rbac`, `acl`, `guard`, `guards`, `policy`, `policies` |
| `payments or webhooks` | as palavras inteiras `payment`, `payments`, `billing`, `checkout`, `stripe`, `invoice`, `invoices`, `subscription`, `subscriptions`, `webhook`, `webhooks` |
| `secrets or env` | um arquivo chamado `.env` ou `.env.<suffix>`; `env.js`, `env.ts`, `env.cjs`, `env.mjs`, `env.cts` ou `env.mts`; ou `secret`/`secrets` sozinho ou com sufixos separados por ponto (`secrets.json`, `secret.prod.yaml`) |
| `dependencies` | `package.json` ou `cargo.toml` (comparado depois da conversão para minúsculas, então vale `Cargo.toml`) |
| `Rust unsafe` | um arquivo `.rs` cujo conteúdo casa com `unsafe` seguido de `{`, `fn`, `impl`, `trait` ou `extern` |

A verificação de conteúdo Rust precisa do conteúdo do arquivo. O Stop lê os arquivos `.rs` para isso.
No `pre`, é passado o conteúdo que a edição escreve.

## Caminhos triviais

Um arquivo é trivial quando não é crítico e seu caminho casa com um destes
(sem diferenciar maiúsculas):

- prosa: `.md`, `.markdown`, `.txt`, `.rst`, `.adoc`
- estilos: `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.pcss`
- imagens e fontes: `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.ico`,
  `.bmp`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`
- catálogos de tradução: `.po`, `.pot` e arquivos `.json`/`.yaml`/`.yml` em qualquer profundidade
  dentro de uma pasta `locale/`, `locales/`, `i18n/`, `lang/`, `translations/` ou `messages/`
- arquivos de editor e de ignore: `.editorconfig`, `.prettierrc` (também `.json`, `.yaml`,
  `.yml`), `.prettierignore`, `.gitignore`, `.gitattributes`

Todo outro arquivo é `normal`. `.mdx` é normal porque é compilado.

## `smugan risk`: forçando um nível

```bash
smugan risk                                  # show the forced level, if any
smugan risk <trivial|normal|critical> [dir]  # force a level on the checkout
smugan risk auto [dir]                       # hand the decision back to the hook
```

- **Alcance.** A sobreposição vale para o checkout que contém `dir`: a raiz do repositório Git
  (top level) ou, fora de um repositório, a própria pasta. Enquanto ela dura, todo arquivo desse
  checkout assume o nível forçado.
- **Duração.** 8 horas a partir do momento em que é definida (`OVERRIDE_HOURS = 8`). Sobreposições
  vencidas são apagadas na próxima vez que qualquer sobreposição é lida.
- **`auto`.** Grava um registro `auto` que também dura 8 horas. Esse registro permite
  ao Stop distinguir uma sobreposição removida de propósito de uma cujo arquivo foi apagado.
- **Validação do argumento.** Um primeiro argumento que não é nível nem pasta existente
  é rejeitado como nível digitado errado, por exemplo `crítico`.
- **Armazenamento.** A sobreposição fica em
  `<cache>/smugan/risk/<hash>.json`. `<cache>` é `LOCALAPPDATA`, `XDG_CACHE_HOME`
  ou `~/.cache`; quando `SMUGAN_CACHE_DIR` está definida, o caminho é
  `SMUGAN_CACHE_DIR/risk/<hash>.json`. O hash são os primeiros 32 caracteres hexadecimais do
  SHA-256 do caminho do checkout em minúsculas e com barras normais.

Quando o nível forçado é menor que o nível próprio de um arquivo, todo fim de turno avisa o
usuário num `systemMessage`. O aviso lista até 5 arquivos rebaixados, e o
rebaixamento fica registrado para o `smugan why`.

## Só o usuário rebaixa um nível

Rebaixar o nível pula testes e revisões, então só o usuário pode fazer isso. No Claude Code,
o hook `bash` recusa um comando `Bash` ou `PowerShell` (exit 2) quando qualquer uma destas
condições vale:

- o comando cita a pasta de níveis forçados, ou a pasta de cache do smugan acima dela, pelo
  caminho exato. Contam as grafias do Windows, do Git Bash (`/c/...`), `~/...` e `$HOME/...`,
  e também qualquer caminho `smugan/risk`;
- o comando contém `runRisk`;
- o comando menciona `smugan` ou `risk.mjs`, e também a palavra `risk`, e também uma
  de `trivial`, `normal` ou `auto`, em qualquer parte dele.

O hook `pre` também recusa um `Write` ou `Edit` na pasta de níveis forçados. Elevar
o nível (`smugan risk critical`) e consultá-lo (`smugan risk`) nunca são recusados.
A mensagem de recusa pede que o usuário rode o comando no próprio terminal, ou com
`!` no Claude Code.

Outras formas de apagar o arquivo de sobreposição não são detectadas pelo texto do comando.
Em vez disso, os hooks registram em `smugan-session-<session>.json` cada nível forçado que
veem: no início da sessão, antes de cada comando de shell, a cada edição e a cada Stop. Se
um nível some antes de vencer e não há registro `auto`, o próximo Stop
que deixa o turno terminar avisa o usuário.
