---
title: Detectores de fim de turno
description: O que os detectores contract-drift, clone, exploration-residue e assertion-weakening do hook stop encontram, seus limites e quais deles seguram o turno uma única vez ou toda vez.
---

Esses quatro detectores precisam saber o que o turno fez, por isso rodam apenas no hook `stop`, no fim de um turno. O `smugan check` nunca os executa. Eles são ligados em [`packages/gate/src/hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs), depois que os arquivos tocados são analisados de novo.

**Pré-requisitos.** Para os arquivos de um projeto, cada detector precisa de todas estas condições:

- `hook.stop` não é `false`,
- `hook.stop.smugan` não é `false`,
- o arquivo não está em um glob de `ignore`,
- a regra não foi desligada com `"checks": { "<rule>": false }`.

## Listado uma vez vs. bloqueante

Todo achado entra no relatório de fim de turno. Um relatório com qualquer achado segura o turno: o hook sai com `2` e o agente precisa responder. Quantas vezes um achado pode segurar o turno depende do detector.

| Detector | Comportamento |
|---|---|
| `contract-drift` | Listado uma vez |
| `clone` | Listado uma vez |
| `exploration-residue` | Listado uma vez |
| `assertion-weakening`, testes removidos e arquivos de teste apagados | Listado uma vez |
| `assertion-weakening`, asserções perdidas em um teste que ainda existe | Bloqueia como uma violação do gate |

**Listado uma vez.** Quando uma retenção inclui um achado "listado uma vez", a chave dele é guardada no estado do turno (`state.shown`). Os fins seguintes do mesmo turno o pulam. O agente pode ter um motivo que o gate não enxerga. Nada é apagado nem restaurado.

**Bloqueante.** Um achado de asserção perdida conta contra o orçamento de retenções do turno em todo fim de turno, como uma violação do gate.

**Orçamento de retenções.** Um turno tem direito a 1 retenção, ou 2 quando tocou um arquivo crítico (`ROUTINE_STOP_BLOCKS`, `MAX_STOP_BLOCKS`). Quando o orçamento acaba e a última retenção continha apenas itens "listados uma vez", o turno termina com uma nota de que todas as verificações estavam verdes.

No modo de aviso (`"mode": "warn"`), o mesmo relatório é mostrado sem segurar o turno.

## `contract-drift`

Fonte: [`contract-drift.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/contract-drift.mjs)

**O que detecta.** Uma função que já existia quando o turno tocou o arquivo dela pela primeira vez e que agora responde a uma entrada ruim ou a uma falha com um valor padrão silencioso. Só contam as construções que o turno adicionou. São quatro formatos:

- **Um bloco `catch` que engole a falha.** Suas instruções apenas registram log (`console.*`, `logger.*`, `log.*`, `this.logger.*`, `Sentry.*`, `captureException`, `reportError`), fazem `continue` ou `return` sem usar a variável do erro, e ele não tem `throw`.
- **Um callback `.catch(…)` que engole a rejeição.** O callback está vazio, apenas registra log ou retorna um literal que não usa o erro (`.catch(() => [])`, `.catch(() => ({}))`).
- **Um fallback para um literal.** `?? literal` ou `|| literal` sobre um destes:
  - um parâmetro da função (opcionalmente via `.field` ou `[index]`), ou
  - um campo de `res`, `resp`, `response`, `data`, `json`, `body`, `payload` ou `result`.

  Os literais são números, strings, `[]`, `{}`, `null`, `undefined`, `true` e `false`.
- **Um novo guard.** `if (…) return null`, `return undefined` ou `return []`, também com cast (`return [] as Item[]`, `return null!`). Um `return` sem valor só conta quando a função retorna um valor em outro ponto.

Exemplo, de [`test/contract-drift.test.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/test/contract-drift.test.mjs). Esta função existente:

```js
export async function loadOrders(userId, opts) {
  const res = await fetch('/orders/' + userId, { signal: AbortSignal.timeout(5000) });
  return res.json();
}
```

ganha `try { … } catch (error) { console.error('orders', error); return []; }` e é reportada como:

```
loadOrders(): new catch answers the failure with `return [];` — callers that saw the error now get a normal-looking value
```

**Não é drift:**

- Um rethrow (`throw new Error(…, { cause: error })`).
- Uma função nova: ela define o próprio contrato.
- Um formato que já estava na função no primeiro toque.
- `?? []` que depois é percorrido como lista (`for … of`, spread, `.map`/`.filter`/`.length`/…).
- Um spread `?? {}`.
- Uma construção dentro de uma função aninhada ou callback. Ela pertence àquela função, que é julgada por conta própria se já existia.

**Limites:**

- **Caminhos excluídos:** arquivos de script, teste, e2e, bin e config, `.d.ts`, e arquivos de UI (`.jsx`/`.tsx`, pastas `component/`, `components/`, `ui/`).
- **Quais funções são julgadas.** Só arquivos cujos nomes de função e formatos de drift o hook `pre` registrou no primeiro toque. Um arquivo criado no turno, ou alterado fora de `Write`/`Edit` sem primeiro toque registrado, não é julgado.
- **Como as funções são encontradas.** Por texto ([`functions.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/functions.mjs)): declarações, expressões de função e arrow functions atribuídas a um nome, propriedade ou campo de classe, o export default anônimo e métodos. Arrow functions com corpo de expressão não têm bloco e ficam de fora.
- **O que cancela.** Os formatos são indexados como `kind|function|shape`, sem números de linha, e contados. O mesmo formato aparecendo de novo em uma função que já o tinha é cancelado uma vez para cada ocorrência anterior.
- **Teto:** no máximo 10 achados por arquivo por fim de turno.

**Suprima** com `smugan-ignore contract-drift: <reason>` na linha reportada ou na linha acima.

## `clone`

Fonte: [`clones.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/clones.mjs)

**O que detecta.** Uma função escrita pelo turno que é idêntica a outra função do repositório, a menos de nomes e literais (clones tipo 1 e tipo 2). Uma função conta como escrita pelo turno quando:

- está em um arquivo criado no turno, ou
- o arquivo não tinha uma função com aquele nome no primeiro toque.

**Como os corpos são comparados:**

1. O corpo é extraído do código já limpo (stripped) e tokenizado.
2. Palavras-chave e pontuação são mantidas como estão.
3. Os identificadores são renomeados na ordem da primeira aparição (`$0`, `$1`, …).
4. Números viram `N` e strings viram `S`.
5. A sequência de tokens recebe um hash (SHA-256, primeiros 20 caracteres hexadecimais).

Só contam corpos com pelo menos 60 tokens. A configuração do projeto pode mudar isso com `"checks": { "clone": { "minTokens": n } }`. Duas funções novas que copiam uma à outra são reportadas uma vez.

A mensagem indica a função a reaproveitar. Neste exemplo os caminhos são inventados, e as duas funções são as fixtures `FORMAT` e `RENAMED` de [`test/clones.test.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/test/clones.test.mjs):

```
src/money.mjs:1  [clone]  `moneyLabel` repeats `formatCents` up to names and literals — reuse `formatCents` at src/format.mjs:1, or extract what differs into a parameter
```

**Limites:**

- **Caminhos excluídos:** `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `.next`, `.d.ts`, `.min.`, `.gen.`, pastas de teste e fixtures (`test/`, `tests/`, `__tests__/`, `e2e/`, `fixture/`, `fixtures/`) e arquivos `.test.`/`.spec.`.
- **Só clones exatos.** Um clone semântico (mesmo comportamento, código diferente) não é detectado.
- **Índice do repositório.** Os arquivos vêm de `git ls-files -co --exclude-standard`, com timeout de 2 s e buffer de saída de 16 MB.
  - No máximo 5.000 arquivos de código são indexados.
  - Arquivos maiores que 512 KiB entram na lista sem funções.
  - Quando a listagem falha, não há com o que comparar.
- **Orçamento de tempo.** O índice fica em cache na pasta temporária do sistema como `smugan-clones-<hash>.json`, indexado por arquivo pelo tamanho, mtime e `minTokens`. Cada fim de turno gasta no máximo 500 ms lendo arquivos alterados, sempre ao menos um, e continua no fim de turno seguinte.
  - Um índice incompleto é registrado como `clone-index-partial`, que o `smugan why` mostra.
  - Um clone de uma função ainda não indexada passa despercebido até o índice alcançá-la.
- **Pré-requisito:** um arquivo sem snapshot de primeiro toque que não foi criado no turno não é julgado.

**Suprima** com `smugan-ignore clone: <reason>` na linha da nova função ou na linha acima.

## `exploration-residue`

Fonte: [`residue.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/residue.mjs)

**O que detecta.** Dois tipos de sobra.

**1. Um script novo que nada referencia.** Vale para um arquivo criado no turno que atende a todas estas condições:

- Tem uma destas extensões: `.js`, `.cjs`, `.mjs`, `.ts`, `.cts`, `.mts`, `.tsx`, `.jsx`, `.py`, `.sh`, `.ps1`, `.rb`.
- Não é um caminho de teste, um nome de config (`*.config.*`, `.xxxrc`, `eslint.*`, `prettier.*`) nem um arquivo de convenção de framework (`middleware`, `proxy`, `instrumentation`, `instrumentation-client`, `mdx-components`, `sentry.*`, `*-env.d`, `global.d`, `env.d`).
- É uma destas opções:
  - tem nome de exploração (`repro`, `reproduce`, `scratch`, `debug`, `tmp`, `temp`, `try`, `playground` ou `poc`, seguido de `-`, `_`, `.`, um dígito ou nada), ou
  - está solto na raiz do projeto, quando o escopo do turno é conhecido.
- O escopo não o menciona.
- Nenhum outro arquivo o referencia.

Como uma referência é encontrada:

1. `git grep -l -z -F --untracked` lista os arquivos candidatos. Os termos de busca são o nome do arquivo e as formas `/stem'`, `/stem"`, `` /stem` `` e `/stem.`. Lockfiles nunca são candidatos.
2. Cada candidato é lido por inteiro. Ele referencia o script quando contém:
   - o nome completo do arquivo, ou
   - um caminho terminado no stem, escrito como um import ou uma config o escreveria (`./tmp`, `../lib/tmp.js`, `@/tmp`).

   Um caminho absoluto (`'/tmp'`), uma URL ou um caminho de pacote (`@types/tmp`, `node_modules/tmp`) não conta.

**2. Uma mudança de config que o escopo não pede.** Vale para um arquivo tocado de um destes tipos:

| Tipo | Arquivos | Palavras do escopo que a liberam (trecho) |
|---|---|---|
| Manifesto | `package.json` | `depend`, `package`, `instal`, `version`, `upgrade`, `npm`, `pnpm`, `yarn`, `bun`, `lockfile` |
| Lockfile | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb` | as mesmas do manifesto |
| Config TS/JS | `tsconfig*.json`, `jsconfig*.json` | `tsconfig`, `typescript`, `compil`, `strict`, `alias` |
| Config de build/lint/teste | `.config.*` de `vite`, `vitest`, `webpack`, `rollup`, `next`, `nuxt`, `astro`, `svelte`, `tsup`, `esbuild`, `babel`, `jest`, `playwright`, `tailwind`, `postcss`, `eslint`, `prettier` ou `rspack`; `.babelrc`, `.swcrc`, `turbo.json`, `.eslintrc*` | `build`, `bundl`, `config`, `lint` e os nomes das ferramentas |

As listas de palavras são expressões regulares, casadas sem diferenciar maiúsculas de minúsculas. A lista do manifesto também tem radicais em português (`pacote`, `bibliotec`, `versão`, `atualiz`). As listas completas são `DEPENDENCY_WORDS` e `CONFIG_KINDS`.

- **Como um lockfile conta como alterado.** O turno não o edita diretamente, então ele conta quando seu mtime é igual ou posterior ao início do turno e o `git status --porcelain` o mostra.
- **O que mais libera uma mudança.** O escopo mencionar o arquivo, ou mencionar uma dependência que o manifesto adicionou ou alterou em relação ao HEAD (`use zod`). Para um lockfile, são comparados os manifestos ao lado dele e os que o turno tocou.

**O escopo** é montado em `turnScope`:

- o [contrato de aceite](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#acceptance-contract) ativo, quando algum dos critérios dele não está `done`, e
- os três últimos pedidos da pessoa, lidos dos últimos 512 KiB do transcript.

Sem nenhum dos dois, o escopo é desconhecido. Aí só os scripts com nome de exploração são julgados, e as mudanças de config não são julgadas.

**Limites:**

- **Quando o `git grep` não consegue responder.** Se ele falha, excede o timeout de 2 s ou o buffer de saída de 256 KB do helper de git, ou se mais de 2.000 arquivos candidatos casam, o script conta como referenciado.
- **Orçamento de leitura.** Os candidatos são lidos até 32 MiB no total. Um candidato que não cabe no que sobrou também conta como referência.
- **Os caminhos não são resolvidos.** Um import de um arquivo com o mesmo nome em outra pasta ainda libera o script.
- **Supressão.** Um comentário `smugan-ignore` não se aplica. Um caminho nos globs de `ignore` do projeto nunca é listado, e `"checks": { "exploration-residue": false }` desliga o detector.

A mensagem para um script é `new file that no import, test, script or config references — delete it if the task does not need it, or say why it stays`. Para uma config, é `changed, but neither the acceptance contract nor the request asks for it — revert it if the task does not need it, or say why it changed`.

## `assertion-weakening`

Fontes: [`assertion-weakening.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/assertion-weakening.mjs), usando o leitor de blocos de teste de [`checks/test-weakening.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/test-weakening.mjs)

**Quando roda.** Só quando o mesmo turno também tocou um arquivo de produção, ou seja, um que não é prosa nem caminho de teste. Editar apenas testes é tratado como uma tarefa à parte.

**Base de comparação.** Cada arquivo de teste tocado é comparado com uma destas referências, em ordem de preferência:

1. o perfil de asserções e as contagens de testes que o hook `pre` guardou no primeiro toque do turno,
2. para um arquivo que um comando de shell alterou, a versão dele antes do primeiro commit do turno nesse arquivo,
3. o HEAD do git.

**O que conta como asserção forte:**

- Um `expect(…)` (também `expect.soft`, `expect.poll`) cujo primeiro matcher depois das palavras de encadeamento não é fraco. As palavras de encadeamento são `not`, `to`, `be`, `resolves` e similares.
  - Matchers fracos: `toBeDefined`, `toBeTruthy`, `toBeFalsy`, `ok`, `exist`.
  - Fracos só depois de `not`: `toBeNull`, `toBeUndefined`, `null`, `undefined`.
- Um `assert.<method>(…)` que não seja o `assert(…)` puro, `assert.ok` ou `assert.strict`.

**Asserções perdidas (bloqueia).** Para cada título literal de teste presente antes e agora, uma queda nas asserções fortes é reportada na linha do teste, no máximo 20 por arquivo:

```
test "<title>" lost 1 strong assertion(s) this turn (2 → 1) while production code changed — …
```

Regras para os títulos:

- Um título declarado mais de uma vez no arquivo é pulado.
- Um título calculado (uma variável, um template com `${…}`) é pulado.
- Os títulos são comparados pelos primeiros 200 caracteres.

**Testes removidos (listado uma vez).** Um arquivo é verificado quanto a remoções quando atende a todas estas condições:

- declara menos testes do que no início,
- não tem mais testes de tabela ou sem título do que antes, e
- tem menos asserções fortes no total.

Então todo título que tinha asserções fortes e agora é declarado menos vezes é listado. As regras de contagem:

- **Testes movidos.** Um título que outro arquivo de teste do turno ganhou compensa uma remoção: o teste foi movido.
- **Tabelas e títulos calculados.** São contados sem nome.
- **Arquivos de teste apagados.** Um arquivo de teste apagado durante o turno, por um comando ou por um commit do turno, é listado da mesma forma. Uma supressão não o cobre.
- **Mensagem.** No máximo cinco títulos são nomeados, seguidos de `and N more`.

**Falhas de detecção aceitas:**

- Um teste renomeado.
- Testes agrupados em uma tabela `it.each` ou em um loop.
- Um valor esperado alterado: uma mudança de comportamento legítima tem a mesma cara.
- Asserções perdidas sob um título repetido em vários blocos `describe`.
- Asserções que ficam em helpers.

**Suprima:**

- Asserções perdidas: `smugan-ignore assertion-weakening: <reason>` na linha reportada ou na linha acima.
- Testes removidos: uma supressão na linha 1 do arquivo, ou `smugan-ignore-file assertion-weakening: <reason>`.
