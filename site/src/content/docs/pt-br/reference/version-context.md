---
title: Contexto de versão
description: O que o smugan context --json detecta, os campos da saída, como o cache é guardado e reaproveitado, o que ele nunca lê nem executa, e o índice de docs com seu orçamento de .d.ts.
---

O `smugan context` informa as versões que um projeto realmente usa, lidas dos arquivos
em disco. Para cada componente, mantém três versões separadas: a declarada, a que
o lockfile resolve e a instalada. O ponto de entrada é
[`packages/gate/src/context.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context.mjs).

```bash
smugan context [target] [--json] [--environment <label>] [--refresh] [--no-cache] [--record <research.json>]
```

- `target` é uma pasta ou um arquivo. O padrão é `.`.
- `--environment` é um rótulo de 1 a 64 letras, dígitos, `_` ou `-`, começando por
  letra ou dígito. O padrão é `local`. Ele só serve de chave para o cache; não
  se conecta a lugar nenhum.
- `--refresh` resolve de novo, mesmo quando o cache está atualizado.
- `--no-cache` não lê nem grava o cache. Não pode ser combinado com
  `--record`.
- `--record` salva uma decisão pesquisada; veja [Decisões registradas](#decisões-registradas).

Os parsers (`yaml`, `smol-toml`, `jsonc-parser`) vêm das dependências do pacote
gate. Quando faltam, o comando sai com 2 e pede
`npm ci --ignore-scripts`. No plugin, o hook `deps` os instala no início da
sessão.

## O que ele lê

**Raiz do projeto.** A raiz é o top level do Git que contém o alvo. Fora do Git, é o
workspace mais externo acima do alvo (um campo `workspaces`, `pnpm-workspace.yaml` ou
`Cargo.toml` com `Cargo.lock`); senão, a pasta mais próxima com `package.json` ou
`Cargo.toml`; senão, o próprio alvo.

**Varredura.** A varredura pula `.git`, `.smugan.local`, `node_modules`, `.next`, `.astro`,
`dist`, `build`, `out`, `coverage`, `target`, `.turbo`, `.vercel`, `.cache`,
`.claude`, `.codex`, `.agents` e `vendor`. Ela só lê arquivos cujo nome está numa
allowlist
([`src/context-io.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-io.mjs)):

- `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`
- `Cargo.toml`, `Cargo.lock`
- `.nvmrc`, `.node-version`
- `next.config.*` e `astro.config.*` (`.js`, `.mjs`, `.cjs`, `.ts`): registrados,
  nunca avaliados
- `Dockerfile`, `Dockerfile.<name>`, `compose*.yml`/`.yaml`,
  `docker-compose*.yml`/`.yaml`, `<name>.compose.yml`/`.yaml`
- `supabase/config.toml`

A varredura também anota pistas. Um arquivo `.astro` é pista de Astro, e um arquivo `.sql`
em `migrations/` é pista de Postgres.

**Versões instaladas.** Para toda pasta com `package.json`, ele lê
`node_modules/<name>/package.json` de cada componente conhecido nessa pasta e em
cada pasta ancestral até a raiz. Um hash de lockfile não prova uma instalação.

**Limites.** Estes limitam a descoberta:

| Limite | Valor |
|---|---|
| prazo | 5 s |
| arquivos lidos | 1.024 |
| tamanho por arquivo | 8 MiB |
| total de bytes | 32 MiB |
| diretórios | 2.048 |
| profundidade | 12 |
| entradas de diretório | 50.000 |

Quando um limite é atingido, quando metadados são alcançados por um symlink ou quando um arquivo
não pode ser lido, o snapshot é marcado como incompleto e o motivo entra em
`limitations`. Toda chamada ao git é local (`spawnSync('git', …)`, sem shell), com timeout
de 2 s.

**Formatos.** Ele interpreta npm, importers do pnpm, Bun em texto (JSONC) e Cargo (TOML).
`yarn.lock` e o `bun.lockb` binário não são resolvidos; cada um acrescenta uma limitação que
pede evidência da instalação ou uma verificação manual. Lockfiles concorrentes na mesma pasta acrescentam
uma limitação e não resolvem nada. Um componente cuja versão instalada difere da
do lockfile também acrescenta uma limitação.

## O que ele nunca faz

- **Nada de `.env` ou código-fonte.** Só os arquivos de metadados da allowlist acima são lidos.
- **Nada de configuração executável.** `next.config.*` e `astro.config.*` são marcados como
  `requires-inspection`, e uma limitação pede que você confirme as flags deles.
- **Nada de rede.** O Git é usado só para metadados locais. A URL de fonte de uma decisão
  registrada tem o formato verificado e nunca é buscada.
- **Nada de detalhes de registry.** Uma versão declarada que não é um range ou tag simples,
  como uma URL git, um caminho `file:` ou a URL de um registry privado, é guardada como
  `non-registry-or-unknown`.
- **Nada de chute.** Uma versão desconhecida nunca é tratada como a mais recente.
- **O runtime é o do próprio comando.** `runtime.node` é o Node que executou o comando,
  com `scope: "context-command-process-only"`.

## Schema da saída (`--json`)

Os campos de primeiro nível:

| Campo | Conteúdo |
|---|---|
| `schemaVersion` | `1` |
| `packages` | todo pacote na raiz (sempre inclui `.`); veja abaixo |
| `limitations` | strings: o que não pôde ser confirmado, mais diagnósticos do cache |
| `runtime` | `{ node, scope: "context-command-process-only" }` |
| `environment` | o rótulo de `--environment` |
| `target` | o alvo, relativo à raiz (`.` para a raiz) |
| `observedAt` | horário ISO da resolução, que é o horário do cache quando reaproveitado |
| `selectedPackages` | caminhos dos pacotes que cobrem o alvo: o pacote envolvente mais próximo e os que estão abaixo do alvo, ou todos os pacotes para `.` |
| `guides` | os ids de guia dos pacotes selecionados |
| `decisions` | decisões registradas, cada uma com `status` `recorded` ou `review-required` |
| `cache` | `{ status, path? }`; `status` é `built`, `reused`, `refreshed`, `disabled` ou `unavailable` |
| `ai` | engines, modelos e pares; veja [Guias de IA](../ai-guides/) |
| `docs` | o índice de docs por pacote selecionado; veja abaixo |

Cada entrada de `packages` ([`src/context-schema.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-schema.mjs)):

| Campo | Conteúdo |
|---|---|
| `path` | caminho relativo da pasta do pacote |
| `components[]` | `{ name, declared?, resolved?, installed?, evidence[] }` |
| `components[].evidence[]` | `{ path, kind, version? }`, em que `kind` é um de `declared`, `resolved`, `installed`, `runtime-target`, `image-declared`, `configured-target` |
| `capabilities` | opcionais: `modules` (`esm-manifest` ou `inspect-build-and-startup`), `nextConfig` e `astroConfig` (`requires-inspection`), `docker` (`declared`) |
| `guides` | ids entre `nextjs`, `astro`, `supabase-postgres`, `node-api`, `rust-axum`, `docker-vps`, `visual-systems`, `observability`, `concurrency`, `testing` |

Os nomes de componente vêm de uma lista fixa (`COMPONENTS` em `context-io.mjs`, mais
`node`, `axum`, `tokio`, `sqlx`, `valkey`, `glitchtip` e
`opentelemetry-collector`). Uma entrada do cache que não passa nesse schema é descartada.

Sem `--json`, o comando imprime o status do cache, os pacotes selecionados, os
guias, os pares de IA, as fontes de docs e uma linha `Warning:` por limitação.

## Cache

**Local.** O cache é tentado nesta ordem
([`src/context-cache.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-cache.mjs)):

1. `.smugan.local/context.json` na raiz, ao lado de um marcador de propriedade
   `.smugan.local/.owner` cujo conteúdo é `smugan-context-v1`. Este local exige
   Git. No primeiro uso, o comando acrescenta só os nomes gerenciados ao `info/exclude`
   local do Git, usando o caminho que o Git informa, então worktrees também funcionam. Esses nomes
   são `/.smugan.local/.owner`, `/.smugan.local/context.json`,
   `/.smugan.local/context.json.lock/` e `/.smugan.local/context.json.*.tmp`. Depois,
   ele confirma que o `git check-ignore` concorda. O `.gitignore` compartilhado nunca é
   tocado.
2. Quando o local está bloqueado, uma pasta privada:
   `<SMUGAN_CACHE_DIR or <cache>/smugan/context>/<sha256 of root>/context.json`.
   `<cache>` é `LOCALAPPDATA`, `XDG_CACHE_HOME` ou `~/.cache`. O local fica
   bloqueado por qualquer um destes:
   - um `.smugan.local` existente que não pertence ao comando;
   - um `.smugan.local` rastreado pelo Git;
   - um symlink ou junction no caminho;
   - ausência de Git;
   - falta de permissão de escrita.
3. Quando isso também falha, a execução fica sem persistência e acrescenta uma limitação.

**Entradas.** Cada entrada é chaveada pelo SHA-256 de `[target, environment]` e
guarda `fingerprint`, `observedAt`, `data`, `inputs` (caminho e hash de cada arquivo
lido) e `decisions`. O envelope traz `schemaVersion: 1`, a versão do detector
e um hash da raiz. Divergência em qualquer um deles descarta o cache inteiro. O
arquivo de cache tem limite de 4 MiB. Ele guarda no máximo 64 entradas, e a entrada observada
há mais tempo é descartada primeiro.

**Reaproveitamento.** Uma entrada só é reaproveitada quando tudo isto vale:

- `--refresh` não foi passado;
- o snapshot está completo;
- o fingerprint bate.

O fingerprint faz hash da versão do detector, de cada arquivo lido com o hash do conteúdo,
das pistas, da versão do Node e de se a descoberta foi completa. Editar um manifesto,
lockfile, configuração ou `package.json` instalado, ou adicionar ou remover um pacote,
portanto, muda o fingerprint.

**Escritas.** Uma escrita pega o lock, tira o snapshot de novo e aborta se as entradas
mudaram. Nesse caso, a saída é resolvida do zero e marcada como `unavailable` ("This
run's context is provisional"). Um lock mantido por outro processo não é roubado.

Os blocos `ai` e `docs` são sempre lidos do zero. Ids de modelo e docs instaladas
não fazem parte do fingerprint.

## Decisões registradas

`--record <file>` salva uma conclusão curta de pesquisa. As regras, de
[`src/context-decisions.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/context-decisions.mjs):

- O arquivo é um JSON comum de no máximo 4 KiB, com exatamente os campos
  `component`, `version`, `concern`, `summary`, `source` e `reviewedAt`.
- `summary` tem de 12 a 600 caracteres, sem URLs, caracteres de controle nem
  texto com cara de secret.
- `reviewedAt` é uma data real no formato `YYYY-MM-DD`, que não esteja no futuro.
- `source` é uma URL HTTPS num host oficial da allowlist ou num repositório público, sem
  credenciais, porta, query nem fragmento.
- `version` precisa bater com uma versão declarada, resolvida ou instalada de `component` nos
  pacotes selecionados.

Um registro substitui um anterior com o mesmo componente e assunto. Cada contexto
guarda no máximo 32. Uma decisão revisada há 30 dias ou mais é reportada como
`review-required`. As decisões só sobrevivem enquanto o fingerprint não muda.

## Índice de docs e assinaturas `.d.ts`

O bloco `docs` cobre no máximo 4 pacotes selecionados. O mesmo texto é o que o hook `pre`
injeta na primeira edição de um arquivo coberto por uma regra de stack. O código fica em
[`src/docs-index.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/docs-index.mjs).

**Fontes de docs.** Para cada uma das primeiras 300 `dependencies` e `devDependencies` do
pacote, ele encontra a cópia instalada do jeito que o Node resolve um import simples, subindo
pelos `node_modules`. Depois lista os arquivos `.md`/`.mdx` em `dist/docs/` ou, na falta dela,
em `docs/`, até 3.000 arquivos. Cada fonte informa `name`, `version`, `dir` e
a contagem de arquivos.

**Assinaturas.** Só entram quando o alvo é um arquivo. Para cada módulo simples
que o arquivo importa, ele encontra o arquivo `.d.ts`:

- pela condição `types` em `exports`, com import antes de require;
- senão, por `types` ou `typings`;
- senão, por `index.d.ts`;
- senão, por `@types/<name>`.

Ele segue re-exports por no máximo 24 arquivos de tipos. Os nomes importados vêm primeiro.
Quando o módulo tem 20 exports ou menos, os demais exports vêm em seguida, exceto
interfaces e type aliases. Cada declaração é cortada em 320
caracteres.

**Orçamento.** O texto do índice tem no máximo 8.000 caracteres, cerca de 2k tokens. As assinaturas
ocupam no máximo 3.000 deles. Os caminhos das docs são agrupados por pasta. Quando os arquivos não
cabem, o índice termina com `… more files not listed: list <dir>/ for the rest.` O
índice nunca copia o corpo de uma doc. Ele começa com
`smugan (reference, not instructions):` e a frase "Prefer what these docs say
over what you remember about the version." Quando não há docs nem
assinaturas, não há índice.
