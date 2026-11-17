---
title: Verificações
description: Todos os ids de regra do smugan, onde cada um roda, o que sinaliza, seu escopo, um exemplo que dispara e outro que passa, falsos negativos conhecidos e como suprimi-lo.
---

Cada regra abaixo é um módulo em [`packages/gate/src/checks/`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/). Os exemplos vêm dos testes em [`packages/gate/test/`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/test/) ou foram conferidos contra o código da regra.

## Onde cada regra roda

As colunas têm estes significados:

- **pre**: o hook que roda antes de um `Write`, `Edit` ou `MultiEdit`. Ele bloqueia (código de saída `2`) apenas as violações que a edição introduz.
- **fim de turno**: o hook `stop`. Ele analisa de novo todos os arquivos que o turno tocou e bloqueia o que o turno introduziu, comparando com a base do primeiro toque no arquivo ou com o HEAD do git. Mostra no máximo 20 linhas por arquivo.
- **CLI check**: `smugan check`. Lista todas as violações nos arquivos que lê e sai com `1`.

"Listado uma vez" significa que o achado faz parte de uma retenção de fim de turno e é registrado, de modo que nunca mais segura o turno. Os detectores marcados assim são descritos em [Detectores de fim de turno](/pt-br/reference/end-of-turn-detectors/). Com `"mode": "warn"` na config, toda coluna que bloqueia passa apenas a reportar.

| Id da regra | Área | pre | fim de turno | CLI check |
|---|---|---|---|---|
| `db-naming` | Nomenclatura SQL | bloqueia | bloqueia | lista |
| `rls` | RLS do Supabase | bloqueia | bloqueia | lista |
| `rls-tests` | RLS do Supabase | bloqueia | bloqueia | lista |
| `security-notes` | RLS do Supabase | bloqueia | bloqueia | lista |
| `rls-policy` | RLS do Supabase | bloqueia | bloqueia | lista |
| `view-invoker` | RLS do Supabase | bloqueia | bloqueia | lista |
| `search-path` | Funções do Supabase | bloqueia | bloqueia | lista |
| `anon-grants` | Grants do Supabase | bloqueia | bloqueia | lista |
| `money-float` | Tipos SQL | bloqueia | bloqueia | lista |
| `ui-strings` | Textos de UI (pt-BR) | bloqueia | bloqueia | lista |
| `no-any` | TypeScript | bloqueia | bloqueia | lista |
| `secrets` | Segredos | bloqueia | bloqueia | lista |
| `console-log` | Resíduo de debug | bloqueia | bloqueia | lista |
| `dead-imports` | Código morto | bloqueia só em `Write` | bloqueia | lista |
| `stale-mutation` | Server actions do Next.js | bloqueia | bloqueia | lista |
| `empty-catch` | Tratamento de erros | bloqueia | bloqueia | lista |
| `fetch-timeout` | Chamadas de saída | bloqueia | bloqueia | lista |
| `test-weakening` | Testes | bloqueia | bloqueia | lista |
| `await-in-loop` | Consultas N+1 | bloqueia, só em turno crítico | — | — |
| `assertion-weakening` | Testes | — | asserções perdidas bloqueiam; testes removidos são listados uma vez | — |
| `contract-drift` | Contrato de erro/entrada | — | listado uma vez | — |
| `clone` | Duplicação | — | listado uma vez | — |
| `exploration-residue` | Arquivos esquecidos | — | listado uma vez | — |
| `smugan-ignore` | Supressões | bloqueia | bloqueia | lista |

As 18 primeiras regras são a lista `CHECKS` em [`checks/index.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/index.mjs). O hook pula `dead-imports` em `Edit` e `MultiEdit` porque uma mudança feita em várias etapas passa por um import não usado. O fim de turno verifica o estado final no lugar disso ([`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs), `preHook`).

## Ligando e desligando regras

A lógica é `checkEnabled` em [`config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs).

- **Qualquer regra.** `"checks": { "<rule>": false }` a desliga. Um objeto passa opções a ela e a mantém ligada.
- **Regras de Supabase.** `rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`, `search-path` e `rls-policy` vêm ligadas por padrão apenas para uma migration que pertence ao Supabase:
  - uma sob `supabase/migrations/`, ou
  - uma em que alguma pasta, do arquivo até a raiz do projeto, tem `supabase/config.toml` ou uma dependência `supabase` / `@supabase/*` no `package.json` ([`stack.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/stack.mjs)).

  Um projeto Postgres puro liga uma delas com `true`.
- **`ui-strings`.** Vem ligada por padrão apenas quando a variável de ambiente `SMUGAN_UI_LANG` é uma tag `pt` (`pt`, `pt-BR`, …). Definir a regra em `checks` sobrepõe isso.

## Suprimindo um achado

```
// smugan-ignore <rule>: <reason of 6+ characters>
// smugan-ignore-file <rule>: <reason of 6+ characters>
```

É assim que `parseSuppressions` em [`engine.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/engine.mjs) as lê:

- **Alcance.** `smugan-ignore` cobre a própria linha e a linha seguinte. Uma linha em branco no meio quebra o vínculo. `smugan-ignore-file` cobre o arquivo inteiro.
- **Regras.** Várias regras vão separadas por vírgula, sem espaços (`console-log,empty-catch`). `*` casa com todas as regras.
- **Dois-pontos.** Obrigatórios. Um comentário sem eles não é lido como supressão.
- **Motivo.** Cortado em um `*/` ou `-->` final e depois aparado. Menos de 6 caracteres não suprime nada e é reportado como violação de [`smugan-ignore`](#smugan-ignore).
- **Estilo de comentário.** O parser lê o texto bruto, então a mesma sintaxe funciona em comentários `//`, `--`, `/* */` e `<!-- -->`.
- **Nome antigo.** `smaug-ignore` também é aceito.

---

## `db-naming`

Fonte: [`checks/db-naming.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/db-naming.mjs)

**Sinaliza** um identificador declarado em DDL que:

- tem um caractere não ASCII,
- tem uma palavra de uma lista fixa de palavras inequivocamente portuguesas (`nome`, `usuario`, `pedidos`, `valor`, …), ou
- tem letra maiúscula (não é snake_case).

Ela lê os nomes em `create table` (inclusive temporary e unlogged) e na lista de colunas dessa tabela, `add column`, `rename … to`, `rename to`, `create index`, `function`, `procedure`, `type`, `view`, `materialized view`, `schema`, `sequence`, `trigger` e `policy`. Nomes de policy pulam a verificação de maiúsculas, porque muitas vezes são frases.

**Escopo:** todo arquivo `.sql`, migration ou não. Comentários e conteúdo de strings são apagados antes.

**Opções:** `allow`, uma lista de identificadores aceitos como estão.

```sql
-- flagged: "nome" is Portuguese
create table patients (
  id uuid primary key,
  nome_completo text
);
-- flagged: not snake_case
create table events (createdAt timestamptz);
```

```sql
-- passes
create table patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null
);
```

**Falsos negativos conhecidos:**

- Palavras portuguesas fora da lista. Palavras que também existem em inglês (`data`, `total`, `status`, `local`, `agenda`) ficam de fora de propósito.
- Identificadores escritos em formas de DDL que os padrões não cobrem.
- Identificadores declarados fora de arquivos `.sql` (schemas de ORM).

## `rls`

Fonte: [`checks/rls.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/rls.mjs)

**Sinaliza:**

- Um `create table` sem `alter table … enable row level security` para essa tabela no mesmo arquivo.
- Um `alter table … disable row level security`, a menos que uma destas condições valha:
  - o mesmo arquivo o habilita de novo mais adiante (fora de uma seção down),
  - o arquivo apaga a tabela,
  - a tabela está em um schema da plataforma,
  - ele está em uma migration down. Isto é, um arquivo `*.down.sql`, o `down.sql` do Diesel, ou a seção down depois de um marcador do goose (`-- +goose Down`), do dbmate (`-- migrate:down`) ou do sql-migrate (`-- +migrate Down`).

**Escopo:** arquivos `.sql` de migration (pasta `migration/` ou `migrations/`), em projetos Supabase por padrão. Tabelas temporárias e os schemas `auth`, `storage`, `extensions`, `realtime`, `vault` e `pg_catalog` são pulados.

**Opções:** `exempt`, uma lista de nomes de tabela.

```sql
-- flagged
create table notes (id uuid primary key);
```

```sql
-- passes
create table notes (id uuid primary key);
alter table notes enable row level security;
create policy "own rows" on notes for select using (auth.uid() = user_id);
```

**Falsos negativos conhecidos:**

- A instrução enable é casada só pelo nome da tabela, sem o schema: `alter table public.notes enable …` também libera `create table private.notes`.
- DDL montada dentro de uma string (`execute 'create table …'`) é apagada e não é lida.
- Só o mesmo arquivo é lido: RLS habilitada em uma migration posterior não libera o achado.

## `rls-tests`

Fonte: [`checks/rls-tests.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/rls-tests.mjs)

**Sinaliza** uma tabela criada em uma migration cujo nome não aparece, como palavra inteira, em nenhum arquivo `.sql` da pasta de testes pgTAP. A verificação só prova que um teste existe. É o `supabase test db` que prova que ele passa.

**Escopo:** arquivos `.sql` de migration, em projetos Supabase por padrão. Mesmo filtro de tabelas do `rls`.

**Opções:** `exempt`; `dir`, a pasta de testes (padrão `supabase/tests`).

```sql
-- flagged when no .sql file under supabase/tests/ mentions notes
create table notes (id uuid);
```

Isto passa assim que um arquivo como `supabase/tests/100-notes.test.sql` menciona a tabela:

```sql
select results_eq($$ select count(*) from notes $$, $$ values (0::bigint) $$, 1);
```

**Falsos negativos conhecidos:** os arquivos de teste são lidos brutos, então qualquer menção da tabela como palavra inteira, inclusive em um comentário, conta como teste. `notes_archive` não conta para `notes`.

## `security-notes`

Fonte: [`checks/security-notes.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/security-notes.mjs)

**Sinaliza:**

- Uma tabela criada em uma migration cujo nome não aparece, como palavra inteira, no arquivo de notas do projeto.
- Todas essas tabelas, quando o arquivo de notas não existe.

**Escopo:** arquivos `.sql` de migration, em projetos Supabase por padrão.

**Opções:** `exempt`; `file` (padrão `SECURITY_NOTES.md`, relativo à raiz do projeto).

```sql
-- flagged when SECURITY_NOTES.md does not mention notes
create table notes (id uuid);
```

Isto passa assim que o `SECURITY_NOTES.md` tem uma linha sobre a tabela:

```md
- Tabela `notes`: visitante não lê nada; usuário logado lê/edita só o que é dele.
```

**Falsos negativos conhecidos:** qualquer menção do nome como palavra inteira conta como descrição. A verificação não julga o que a linha diz.

## `rls-policy`

Fonte: [`checks/rls-policy.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/rls-policy.mjs)

**Sinaliza um `create policy` que:**

- **Libera escrita em todas as linhas.** A policy é permissive, para `update`, `delete` ou `all` (o padrão), e o `using` dela é `(true)` ou `(1=1)` depois de removidos os espaços e os parênteses externos. É pulada quando todos os papéis da lista `to` são papéis de servidor (`service_role`, `postgres`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user`).
- **Lê `user_metadata` ou `raw_user_meta_data`** na expressão `using` ou `with check`, qualquer que seja o comando. O usuário pode editar esses metadados via `auth.updateUser()`.

**Escopo:** arquivos `.sql` de migration, em projetos Supabase por padrão.

```sql
-- flagged: every role can update and delete every row
create policy "allow all" on notes for all using (true) with check (true);
-- flagged: access decided by metadata the user edits
create policy notes_admin on notes for select to authenticated
  using (((select auth.jwt()) -> 'user_metadata' ->> 'is_admin')::bool);
```

```sql
-- passes
create policy notes_delete on notes for delete using (auth.uid() = user_id);
create policy notes_admin on notes for select
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
```

**Falsos negativos conhecidos, por design:**

- Uma policy de `select` ou `insert` aberta a todos. Um catálogo público ou um formulário de contato fica a cargo do teste pgTAP da tabela.
- Uma policy sem `using`, que o PostgreSQL trata como não mostrando nenhuma linha.
- Uma policy `as restrictive`.
- Um `using` sempre verdadeiro escrito de outra forma que não `true` ou `1=1` (por exemplo `auth.role() = 'authenticated'`).

## `view-invoker`

Fonte: [`checks/view-invoker.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/view-invoker.mjs)

**Sinaliza** uma view criada no schema `public` (um nome sem qualificação conta como `public`) sem `security_invoker`. Sem ela, a view lê suas tabelas com os direitos do dono, então a RLS dessas tabelas não se aplica a quem chama. Qualquer uma destas a libera:

- `security_invoker` nas opções da própria view. Um `security_invoker` sem valor conta como verdadeiro; `false`, `off`, `0` ou `no` não.
- Um `alter view … set (security_invoker = …)` posterior no mesmo arquivo. Um `alter` que vem antes de um `create or replace` não conta, porque o `create or replace` redefine a view.

**Escopo:** arquivos `.sql` de migration, em projetos Supabase por padrão. Views temporárias são puladas. Materialized views não casam com o padrão.

```sql
-- flagged
create view public.profile_names as select id, full_name from profiles;
```

```sql
-- passes
create view profile_names with (security_invoker = true) as select id from profiles;
```

**Falsos negativos conhecidos:** views em schemas que não sejam `public` não são julgadas, mesmo quando a API expõe esse schema.

## `search-path`

Fonte: [`checks/search-path.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/search-path.mjs)

**Sinaliza** um `create function` ou `create procedure` cujo cabeçalho (a instrução sem o corpo entre dollar quotes) diz `security definer` e não tem `set search_path`. Um `alter function … set search_path` posterior no mesmo arquivo o libera. Um colocado antes de um `create or replace`, não.

**Escopo:** arquivos `.sql` de migration, em projetos Supabase por padrão. Rotinas em schemas da plataforma são puladas.

```sql
-- flagged
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer as $$ begin return new; end; $$;
```

```sql
-- passes
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$ begin return new; end; $$;
```

**Falsos negativos conhecidos:** um `search_path` fixado que ainda inclui um schema em que quem chama pode escrever é aceito. A verificação só procura a cláusula.

## `anon-grants`

Fonte: [`checks/anon-grants.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/anon-grants.mjs)

**Sinaliza** um `GRANT` de nível superior, ou `ALTER DEFAULT PRIVILEGES … GRANT`, para `anon` ou `authenticated` em um schema que não seja `public`, `graphql_public` ou um schema da plataforma. Os schemas são lidos de:

- listas `on schema …` / `in schema …`, e
- nomes de objeto qualificados (`app_private.accounts`).

Argumentos entre parênteses (assinaturas de função) são ignorados. Um objeto sem qualificação conta como `public`.

**Escopo:** arquivos `.sql` de migration, em projetos Supabase por padrão.

```sql
-- flagged
GRANT SELECT ON ALL TABLES IN SCHEMA app_private TO anon;
```

```sql
-- passes
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA app_private TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM anon, authenticated;
```

**Falsos negativos conhecidos:**

- Grants para outros papéis que a API usa não são julgados.
- Um grant dentro de uma string (`execute '…'`) é apagado.

Um schema não público que deve ser um catálogo público leva um `smugan-ignore` com o motivo.

## `money-float`

Fonte: [`checks/money-float.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/money-float.mjs)

**Sinaliza** uma coluna com nome de valor monetário declarada como `real`, `float`, `float(n)`, `float4`, `float8`, `double precision` ou `money`. A coluna pode ser declarada em um `create table`, um `add column` ou uma conversão `alter column … type`.

Como o nome é julgado:

- Ele é dividido em palavras (camelCase também).
- Conta uma palavra que termina em `price`, `amount`, `total`, `cost`, `value`, `balance`, `payment` ou `revenue` (no plural ou não), ou em `salary`/`salaries`. Então `unit_price`, `subtotal` e `unitprice` contam.
- `fee` e `fees` só contam como palavra inteira: `feedback_score` e `coffee_count` passam.

**Escopo:** arquivos `.sql` de migration. Esta não é uma regra de Supabase: ela roda em qualquer projeto.

```sql
-- flagged
create table orders (id uuid primary key, price real not null);
alter table orders add column if not exists shipping_cost real;
```

```sql
-- passes
create table t (price numeric(12,2), amount_cents integer, balance bigint);
```

**Falsos negativos conhecidos:**

- Palavras monetárias fora da lista (`discount`, `tax`).
- Colunas de `create temp table` ou `create unlogged table`, que o padrão desta regra não casa.

## `ui-strings`

Fonte: [`checks/ui-strings.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/ui-strings.mjs)

**Sinaliza duas coisas.** As duas verificações são calibradas para reportar poucos falsos positivos, ao custo de deixar passar alguns casos.

- **Inglês na UI.** Uma palavra de um vocabulário fixo em inglês (`Save`, `Cancel`, `Submit`, `Loading`, `password`, …) em texto JSX ou em um atributo `placeholder`, `title`, `alt`, `aria-label`, `aria-description` ou `label`. Palavras comuns em UIs brasileiras (`download`, `login`, `email`, `dashboard`, …) ficam fora do vocabulário.
- **Acentos faltando.** Uma palavra em pt-BR escrita sem acento ou cedilha (`nao` → `não`, `configuracao` → `configuração`, …). Ela é procurada nos mesmos lugares e também em literais de string que contêm espaços.

**Escopo:**

- Só arquivos `.tsx` e `.jsx`.
- Desligada por padrão, a menos que `SMUGAN_UI_LANG` seja uma tag `pt` ou o projeto defina a regra em `checks`.
- Não são analisados: atributos de código (`className`, `id`, `href`, `type`, `name`, `value`, …), texto com URLs, `@`, chaves ou outros caracteres de código, e literais de uma única palavra (muitas vezes valores de enum).

**Opções:** `english: false` e `accents: false` desligam cada uma das metades.

```tsx
// flagged
export default function P() { return <button>Save</button>; }
// flagged twice: "Configuracao" and "invalida"
<p>Configuracao invalida</p>
```

```tsx
// passes
export default function P() { return <button>Salvar</button>; }
```

**Falsos negativos conhecidos:**

- Palavras em inglês fora do vocabulário.
- Inglês em literais de string comuns: para inglês, só o texto JSX e os atributos acima são lidos.
- Textos em arquivos `.ts`/`.js`.

## `no-any`

Fonte: [`checks/no-any.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/no-any.mjs)

**Sinaliza, sem justificativa:**

- `any` em posição de tipo. Isso cobre anotações, `as any`, posições de genéricos e tuplas (`Record<string, any>`, `[any, string]`), `any[]`, membros de união e interseção, o retorno de um tipo de função, e aliases de tipo ou valores padrão (`type X = any`, `<T = any>`).
- O cast duplo `as unknown as`.

`keyof any`, `T extends any` e um valor chamado `any` seguido de `.` ou `(` passam.

**O que conta como justificativa:**

- Um comentário que casa com `any: <reason>`, com pelo menos 6 caracteres depois dos dois-pontos. Ele pode estar na mesma linha ou em qualquer ponto do bloco contíguo de linhas de comentário logo acima (linhas em branco são permitidas). Pela forma como esse casamento funciona, um comentário `smugan-ignore no-any: …` acima da linha também o satisfaz.
- Um `eslint-disable…` para `no-explicit-any` com `-- <reason>`. `-line` cobre a própria linha e `-next-line`, a linha de baixo.

**Também sinaliza** `@ts-nocheck` e `@ts-ignore` no início de um comentário, a menos que a diretiva venha seguida de um motivo de pelo menos 6 caracteres. `@ts-expect-error` passa sem motivo, porque falha sozinho quando o erro some.

**Escopo:** `.ts`, `.tsx`, `.mts`, `.cts`, exceto arquivos de declaração (`.d.ts`, `.d.mts`, `.d.cts`).

```ts
// flagged
const x: any = load();
const user = payload as unknown as User;
```

```ts
// passes
// any: third-party SDK returns untyped payloads
const x: any = sdk.load();
```

**Falsos negativos conhecidos:**

- `any` implícito: nenhum `any` é escrito, então não há o que casar.
- `any` em arquivos `.js`.
- Escapes do sistema de tipos além das diretivas listadas e do cast duplo.

## `secrets`

Fonte: [`checks/secrets.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/secrets.mjs)

**Sinaliza, linha a linha, no texto bruto (comentários incluídos):**

- **Formatos de chave:**
  - blocos de chave privada;
  - ids de access key da AWS;
  - chaves de API do Google;
  - chaves secretas `sk-…`;
  - tokens clássicos e fine-grained do GitHub;
  - tokens do Slack com ids de tamanho real;
  - chaves `sk_`/`rk_` do Stripe;
  - segredos de webhook `whsec_`, a menos que o base64 decodifique para texto legível;
  - JWTs fixos no código;
  - `sb_secret_…`.
- **Literais com cara de segredo.** Um literal de 16+ caracteres atribuído a um nome que contenha `secret`, `password`, `passwd`, `token`, `api_key`/`apikey`, `private_key` ou `service_role`. Ele precisa parecer uma chave (ter dígitos, ou 24+ caracteres) e não casar com um padrão de placeholder (`process.env`, `example`, `your-`, `xxx`, `changeme`, `<…>`, `${`, …).
- **URLs de banco com senha para um host remoto.** Placeholders, variáveis, expressões e interpolações passam, assim como hosts locais (sem ponto, loopback, faixas privadas, `.local`, `.internal`, `.test`, `example.*`). A [seção Checks](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#checks) do README tem as regras completas de parsing.
- **Chaves de admin em código cliente.** `service_role` ou `sb_secret_` atrás de `NEXT_PUBLIC_*`, ou em um módulo `"use client"`.
- **Arquivos de env de exemplo.** Em `.env.example`, `.env.sample`, `.env.template` e `.env.dist`, um valor que parece um segredo real, ou uma URL de banco com senha real em qualquer linha, inclusive comentada.

**Escopo:**

- JS/TS, JSON, YAML, TOML, SQL, Python, Go, Rust, Ruby, PHP, Java, Kotlin, C#, Swift, Dart, shell, PowerShell, Astro, Vue, Svelte, Terraform, Prisma, Dockerfiles/Containerfiles e os arquivos de env de exemplo.
- Arquivos de prosa não são lidos.
- `.env`, `.env.local` e `.env.*.local` estão na lista padrão de ignorados.

```ts
// flagged
const apiKey = "a1b2c3d4e5f6g7h8i9j0";
```

```ts
// passes
const apiKey = process.env.API_KEY;
```

**Falsos negativos conhecidos:**

- Um segredo dividido entre literais (`"AKIA" + "…"`), que nenhuma linha contém inteiro.
- Um segredo atribuído a um nome fora da lista.
- Uma senha passada como propriedade da URL ou parâmetro de query (`;password=…`, `?password=…`).

## `console-log`

Fonte: [`checks/console-log.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/console-log.mjs)

**Sinaliza** chamadas a `console.log`, `console.debug`, `console.info`, `console.table`, `console.dir` e `console.trace`. `console.warn` e `console.error` passam.

**Escopo:** arquivos de código JS/TS (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`), exceto:

- pastas `script/`, `scripts/`, `test/`, `tests/`, `__tests__/`, `e2e/`, `bin/`, `tool/` e `tools/`,
- arquivos `.test.` e `.spec.`,
- arquivos `.config.`.

```ts
console.log(user); // flagged
```

**Correção:** apague a chamada, ou direcione a saída pelo logger do projeto. A mensagem deliberadamente não sugere trocá-la por `warn` ou `error`.

**Falsos negativos conhecidos:** uma chamada por um alias (`const { log } = console; log(x)`) ou por acesso com colchetes não é casada.

## `dead-imports`

Fonte: [`checks/dead-imports.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/dead-imports.mjs)

**Sinaliza** um binding importado (default, nomeado, renomeado ou namespace, `import type` incluído) cujo nome nunca mais aparece no arquivo fora de comentários e strings. Imports de efeito colateral (`import './x.css'`) nunca são sinalizados.

**Escopo:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts`, `.cts`, exceto arquivos de declaração. No hook `pre`, vale apenas para `Write`.

```ts
// flagged: useEffect is never used
import { useState, useEffect } from 'react';
export const n = useState(0);
```

```ts
// passes
import { join as joinPath } from 'node:path';
export const p = joinPath('a', 'b');
```

**Falsos negativos conhecidos:**

- A análise cobre um arquivo e casa por nome, então qualquer ocorrência conta como uso. Isso inclui uma propriedade com o mesmo nome (`obj.helper` mantém `import { helper }` vivo).
- `import x = require(…)` não é lido.

## `stale-mutation`

Fonte: [`checks/stale-mutation.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/stale-mutation.mjs)

**Sinaliza** um arquivo com uma linha de diretiva `'use server'` que grava no banco mas não tem revalidação de cache em lugar nenhum.

- **Gravações:** `.from(…).insert/update/upsert/delete(…)`, ou `.rpc('name')` com nome literal que não começa com `get_`, `list_`, `search_`, `count_` ou `fetch_`.
- **Revalidação:** `revalidatePath`, `revalidateTag`, `expirePath` ou `expireTag`, ou `updateTag()` / `refresh()` quando importados de `next/cache`.

Ela reporta apenas a primeira gravação.

**Escopo:** `.ts` e `.tsx`, exceto caminhos de script, teste, e2e, bin e config.

```ts
// flagged
'use server';
export async function addClient(name: string) {
  await supabase.from('clients').insert({ name });
}
```

```ts
// passes
'use server';
import { revalidatePath } from 'next/cache';
export async function addClient(name: string) {
  await supabase.from('clients').insert({ name });
  revalidatePath('/clients');
}
```

**Falsos negativos conhecidos:**

- Qualquer chamada de revalidação em qualquer ponto do arquivo libera todas as gravações dele.
- Gravações por outros clientes (o `create` de um ORM) não são casadas.
- Um `.rpc` com nome dinâmico nunca é sinalizado.

Uma RPC somente leitura cujo nome não deixa isso claro leva `smugan-ignore stale-mutation: <reason>`.

## `empty-catch`

Fonte: [`checks/empty-catch.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/empty-catch.mjs)

**Sinaliza:**

- Um bloco `catch` vazio ou só com comentários.
- Um handler `.catch(() => {})` vazio, em forma de arrow ou `function`.

**Escopo:** arquivos de código JS/TS, exceto caminhos de script, teste, e2e, bin e config.

```ts
try { save(); } catch (e) {}      // flagged
fetch(url).catch(() => {});        // flagged
```

```ts
try { save(); } catch (e) { throw e; }   // passes
fetch(url).catch((e) => report(e));      // passes
```

**Falsos negativos conhecidos, por design:**

- Um `catch` cujo corpo tem instruções que ignoram o erro. Isso exige julgamento e fica a cargo do revisor.
- Um handler com corpo de expressão (`.catch(() => null)`).

O detector de fim de turno [`contract-drift`](/pt-br/reference/end-of-turn-detectors/#contract-drift) cobre alguns desses casos dentro de funções que já existiam.

## `fetch-timeout`

Fonte: [`checks/fetch-timeout.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/fetch-timeout.mjs)

**Sinaliza** uma chamada `fetch(…)` ou `globalThis.fetch(…)` sem prazo. Uma chamada tem prazo quando menciona `AbortSignal`/`AbortController`, ou quando seu objeto de opções inline tem a chave `signal`. Uma chave `timeout:` só conta em dois casos:

- `fetch` é importado ou requerido de uma biblioteca que não seja `undici` (por exemplo node-fetch 2), ou
- a chamada é `$fetch`.

Em qualquer outro caso, a mensagem diz que a opção `timeout:` é ignorada. Uma declaração chamada `fetch` (`function fetch(`, o método `fetch(request) { … }` de um Worker, uma assinatura de membro tipada) não é uma chamada.

**Escopo:** arquivos de código JS/TS sem diretiva `"use client"` (comentários iniciais são pulados), exceto caminhos de script, teste, e2e, bin e config.

```ts
await fetch("https://example.com");           // flagged
await fetch(url, { timeout: 5_000 });          // flagged: the platform fetch ignores timeout:
```

```ts
await fetch(url, { signal: AbortSignal.timeout(3_000) });   // passes
```

**Falsos negativos conhecidos:**

- Wrappers (`api.get()`, `client.fetch()`).
- `window.fetch` e `self.fetch`.
- Qualquer chamada precedida de `.`.

**Falso positivo conhecido:** opções passadas como variável (`fetch(url, init)`) não são lidas, então a chamada é sinalizada mesmo quando `init` traz um signal.

## `test-weakening`

Fonte: [`checks/test-weakening.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/test-weakening.mjs)

**Sinaliza, em arquivos de teste:**

- **Testes desativados ou focados:**
  - modificadores em `describe`/`it`/`test`, inclusive atrás de outro modificador (`it.concurrent.fails`): `.skip`, `.only`, `.todo` e `.fixme`;
  - os aliases `xit`, `xdescribe`, `xtest`, `fit` e `fdescribe`;
  - uma opção `skip`, `only`, `todo` ou `fails` definida como `true` ou como uma string (`test('x', { skip: true }, fn)`);
  - `testInfo.skip/fixme/fail()` e `test.info().skip/fixme/fail()`.
- **Testes marcados como falha esperada:** `.fail`, `.fails` e `.failing`.
- **Um bloco `it`/`test` sem asserção.** O bloco vai até onde começa o próximo teste ou describe. Contam como asserção: `expect`, `assert`, `expectTypeOf`, `assertType`, `.should` e `cy.`.
- **Uma asserção entre constantes iguais** (`expect(true).toBe(true)`, `assert.equal(1, 1)`, `expect(true).toBeTruthy()`). Pulada em um arquivo que conta suas asserções (`t.plan`, `plan: n`, `expect.assertions`, `expect.hasAssertions`).
- **`process.exit()` ou `process.exit(0)`.**

**Escopo:** arquivos de código JS/TS cujo caminho tem `.test.` ou `.spec.`, ou fica sob `test/`, `tests/`, `__tests__/` ou `e2e/`.

```ts
it.only('adds', () => { expect(add(1, 2)).toBe(3); });   // flagged: focused
it('adds', () => { expect(1).toBe(1); });                 // flagged: constant compared with itself
```

```ts
it('adds', () => { expect(add(1, 2)).toBe(3); });         // passes
```

**Falsos negativos conhecidos:**

- Um teste que faz asserções apenas sobre um mock.
- Uma asserção removida de um teste existente. Isso exige a versão do início do turno, então quem cobre é o detector de fim de turno [`assertion-weakening`](/pt-br/reference/end-of-turn-detectors/#assertion-weakening).

**Falso positivo conhecido, aceito:** um teste cujas asserções ficam todas em um helper importado é sinalizado. Suprima com um motivo.

## `await-in-loop`

Fonte: [`checks/await-in-loop.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/await-in-loop.mjs)

**Sinaliza:**

- Um `await` em um cliente de banco dentro de uma iteração sobre uma coleção. A iteração é um `for…of`, um `for…in`, um loop por índice limitado por `.length`, ou um callback async de `forEach`/`map`/`flatMap`. Os clientes são `supabase`, `db`, `prisma`, `knex`, `sql`, `tx`, `trx`, `drizzle`, `pg`, `database`, `repo` e `repository`. `client`, `pool`, `conn` e `connection` só contam com `.query(`/`.execute(`.
- Um `await fetch(` dentro de um callback de `forEach`.

**Quando roda:** apenas no hook `pre`, e apenas em turno crítico. Um turno crítico significa que:

- o nível de risco foi forçado para `critical`,
- o arquivo editado é crítico, ou
- outro arquivo crítico já foi tocado no turno ([`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs), `turnIsCritical`).

Só bloqueiam os loops que a edição adiciona. O `smugan check` e o fim de turno não rodam esta regra.

**Escopo:** arquivos de código JS/TS, exceto caminhos de script, teste, e2e, bin, seed, migration e config.

```ts
// flagged
for (const inv of invoices) {
  inv.items = await db.items.findMany({ where: { invoiceId: inv.id } });
}
```

```ts
// passes: one query
const rows = await db.items.findMany({ where: { invoiceId: { in: ids } } });
```

**Falsos negativos conhecidos, por design:**

- Loops `while`, loops `for (;;)` e loops de retry.
- Loops `for await`.
- Transferências de `.storage`.
- `await fetch` em um loop `for`.
- Clientes de SDK (`client.messages.create`).

---

## `assertion-weakening`

Só no fim de turno, quando o mesmo turno alterou código de produção. Tem duas partes:

- Um teste preexistente que perdeu asserções fortes **bloqueia**, como uma violação do gate.
- Um teste removido, ou um arquivo de teste apagado, é **listado uma vez**.

Detalhes e limites: [Detectores de fim de turno](/pt-br/reference/end-of-turn-detectors/#assertion-weakening).

Como suprimir:

- **Asserções perdidas.** `smugan-ignore assertion-weakening: <reason>` na linha do teste ou acima dela.
- **Testes removidos.** Uma supressão na linha 1 ou um `smugan-ignore-file`. Um arquivo apagado não tem mais nenhuma linha para carregá-la.

## `contract-drift`

Fim de turno, listado uma vez. Sinaliza um valor padrão silencioso adicionado a uma função que existia no primeiro toque do turno. Suprima com `smugan-ignore contract-drift: <reason>` na linha reportada ou acima dela. Veja [Detectores de fim de turno](/pt-br/reference/end-of-turn-detectors/#contract-drift).

## `clone`

Fim de turno, listado uma vez. Sinaliza uma função nova idêntica a outra do repositório, a menos de nomes e literais. Suprima com `smugan-ignore clone: <reason>` na linha da nova função ou acima dela. Opção: `minTokens` (padrão 60). Veja [Detectores de fim de turno](/pt-br/reference/end-of-turn-detectors/#clone).

## `exploration-residue`

Fim de turno, listado uma vez. Sinaliza um script novo que nada referencia e uma mudança de config ou de lockfile que o pedido não menciona. Um comentário `smugan-ignore` não o cobre. Os globs de `ignore` do projeto e `checks["exploration-residue"]: false`, sim. Veja [Detectores de fim de turno](/pt-br/reference/end-of-turn-detectors/#exploration-residue).

## `smugan-ignore`

Fonte: [`engine.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/engine.mjs), `parseSuppressions`

**Sinaliza** um comentário `smugan-ignore` ou `smugan-ignore-file` cujo motivo tem menos de 6 caracteres. Esta violação não pode ser suprimida.

```ts
// smugan-ignore console-log: short      ← flagged, and the next line is still flagged
console.log(1);
```

```ts
// smugan-ignore console-log: startup banner for operators   ← passes
console.log(1);
```
