---
title: Como o engine funciona
description: Como o smugan analisa um arquivo, apaga comentários e strings antes de casar padrões, aplica supressões e separa as violações que uma mudança introduziu das que já existiam.
---

O engine de regras fica em [`packages/gate/src/engine.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/engine.mjs). Ele tem dois pontos de entrada:

- `analyzeContent(relPath, content, config)` julga o texto de um arquivo e retorna suas violações.
- `checkPaths(targets, cwd)` percorre arquivos e pastas para o comando `smugan check` e chama `analyzeContent` em cada arquivo.

Os hooks chamam `analyzeContent` diretamente, no texto que o arquivo teria depois de uma edição e no texto que ele tinha antes. O engine não lê histórico do git e não faz ideia do que seja um turno. Quem decide o que conta como novo é o hook (veja [Violações introduzidas vs. preexistentes](#violações-introduzidas-vs-preexistentes)).

## Análise de um arquivo

O `analyzeContent` faz o seguinte, nesta ordem:

1. **Artefatos de contexto são pulados.** Um caminho que o `isContextArtifact` reconhece não retorna violações.
2. **O texto é normalizado.** Ele remove um BOM inicial e transforma `\r\n` em `\n`. Sem este passo, a mesma violação lida de um checkout com autocrlf e de uma baseline do HEAD no git teria duas mensagens diferentes, e a comparação antes/depois deixaria de compensar a dívida antiga.
3. **Toda verificação aplicável roda.** A lista de verificações é `CHECKS` em [`checks/index.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/checks/index.mjs), com 18 regras. Uma verificação só roda quando:
   - seu `appliesTo(path)` aceita o caminho (cada verificação filtra por extensão e pasta), e
   - `checkEnabled(config, name, path)` em [`config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs) a permite. `checks.<rule>: false` desliga uma regra. As sete regras de Supabase (`rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`, `search-path`, `rls-policy`) vêm ligadas por padrão só onde o arquivo pertence a um projeto Supabase. A `ui-strings` vem ligada por padrão só quando `SMUGAN_UI_LANG` é uma tag `pt`.

   Cada verificação recebe `{ path, content, lines, config, options }`, em que `options` é o objeto em `checks.<rule>` na configuração. Ela retorna achados `{ line, message }`. O engine acrescenta `file`, `rule` e `severity: 'error'` a cada um.
4. **As supressões são aplicadas.** O `parseSuppressions` lê comentários `smugan-ignore` das linhas normalizadas (regras abaixo). Uma supressão com motivo curto demais gera a própria violação `smugan-ignore`, e essa violação não pode ser suprimida.

`await-in-loop` não está em `CHECKS`. O hook `pre` a chama separadamente, só num turno crítico. Os detectores de fim de turno (contract drift, clones, resíduos, enfraquecimento de asserções) vivem em módulos próprios e chamam o `parseSuppressions` por conta própria onde o respeitam. Veja [Detectores de fim de turno](/pt-br/reference/end-of-turn-detectors/).

## Apagando comentários e strings

A maioria das verificações casa expressões regulares. Para que elas não casem dentro de comentários ou do conteúdo de strings, as verificações primeiro passam o texto por [`strip.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/strip.mjs):

- **`stripCode`** (JS/TS) troca por espaços os comentários, o conteúdo de strings, os corpos de regex e o texto de template literals. Mantém o comprimento e todas as quebras de linha, então um offset ou número de linha na cópia limpa é o mesmo no original. O código dentro de `${…}` é mantido e varrido do mesmo jeito. Outros comportamentos:
  - A `/` que abre uma regex é diferenciada da divisão pelo caractere significativo anterior, mais uma lista de palavras-chave (`return`, `typeof`, `case`, …). Depois de um operador pós-fixo (`i++ / 2`, `price! / 100`) ou de uma tag JSX de fechamento, `/` nunca é regex.
  - Um apóstrofo colado a uma palavra (texto JSX como `You're`) não abre string, a menos que a palavra seja uma palavra-chave como `from` ou `import`.
- **`stripSql`** apaga comentários `--`, comentários `/* … */` e o conteúdo de strings `'…'` (com escapes `''`). Mantém os corpos entre dollar quotes, porque eles guardam DDL que as regras de SQL precisam ler.

Como a cópia preserva os offsets, uma verificação pode achar uma construção no texto limpo e depois ler o original na mesma posição. A `stale-mutation` lê um `.rpc('name')` assim, a `rls-policy` lê `user_metadata` dentro de uma string e a `test-weakening` compara os dois lados de um `expect(…)`.

Duas verificações leem o texto cru de propósito:

- `secrets` varre toda linha crua, comentários incluídos, então uma chave esquecida num comentário continua sendo apontada.
- O parser de `smugan-ignore` casa linhas cruas, e é por isso que uma supressão funciona igualmente em comentários `//`, `--`, `/* */` e `<!-- -->`.

Os helpers de SQL compartilhados ficam em [`sql-util.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/sql-util.mjs):

| Helper | O que faz |
|---|---|
| `QUALIFIED_NAME` | Aceita partes simples ou entre aspas duplas, então `"public"."notes"` vindo do `supabase db diff` é lido como a tabela `notes` |
| `normalizeIdent` | Assume `public` como schema padrão |
| `PLATFORM_SCHEMAS` | `auth`, `storage`, `extensions`, `realtime`, `vault`, `pg_catalog` |
| `userTables` | As tabelas não temporárias que um arquivo cria fora desses schemas |
| `isMigrationPath` | Verdadeiro para um arquivo `.sql` dentro de uma pasta `migration/` ou `migrations/` |
| `statementHeader` | O texto de um statement até o `;`, sem os corpos entre dollar quotes |

## Supressões

A sintaxe, de `SUPPRESS_RE` e `parseSuppressions`:

```
smugan-ignore <rule>[,<rule>…]: <reason>
smugan-ignore-file <rule>[,<rule>…]: <reason>
```

- **Lista de regras.** Letras minúsculas, dígitos, `-`, `*` e vírgulas, sem espaços. `*` casa com todas as regras. Se a lista não tiver esse formato, ou se faltar os dois-pontos, o comentário nem é lido como supressão.
- **Motivo.** É cortado num `*/` ou `-->` final e passa por trim. Precisa ter pelo menos 6 caracteres. Um mais curto não suprime nada e é reportado como violação `smugan-ignore`: `suppression without a real reason — use "smugan-ignore <rule>: <reason with 6+ chars>"`.
- **Alcance.** `smugan-ignore` cobre a própria linha e a seguinte. Uma linha em branco no meio quebra o vínculo. `smugan-ignore-file` cobre o arquivo inteiro, esteja onde estiver.
- **Uma por linha.** Só a primeira supressão de uma linha é lida.
- **Nome antigo.** `smaug-ignore`, o nome anterior do projeto, é aceito da mesma forma.

Supressões valem só para achados de regras. Uma falha de typecheck, de teste ou do ESLint não é uma linha de regra, e o hook não sugere `smugan-ignore` para ela.

## Percorrendo uma árvore (`smugan check`)

O `checkPaths` visita cada alvo. Uma pasta é percorrida recursivamente.

- **Pastas puladas.** Nunca desce em `node_modules`, `.git`, `.next`, `dist`, `build`, `out`, `coverage`, `.vercel`, `.turbo`, `.expo`, `.claude`, `.venv`, `venv`, `site-packages`, `__pycache__` ou `.terraform`.
- **Caminhos ignorados.** Os globs `ignore` da configuração e a lista fixa `DEFAULT_IGNORE` também se aplicam. Essa lista inclui lockfiles, `*.min.*`, `*.gen.*`, `database.types.ts`, `.env`, `.env.local`, `.env.*.local` e uma pasta `vendor` preenchida por um gerenciador de pacotes.
- **Quais arquivos são lidos.** Um arquivo só é lido quando o `appliesTo` de ao menos uma verificação o aceita e ele tem no máximo 1 MiB (`MAX_FILE_BYTES`).
- **Configuração por arquivo.** Cada arquivo é julgado com a configuração encontrada subindo a partir da própria pasta. A pasta dessa configuração é a raiz à qual os caminhos das regras e os globs de ignore são relativos. Uma pasta sem configuração, `.git` ou `package.json` próprios herda a configuração da pasta pai.

O [`format.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/format.mjs) imprime o resultado, ordenado por arquivo, linha e regra. Há dois formatos:

- Texto para humanos: `file:line  [rule]  message`, mais um rodapé que explica como suprimir.
- `--json`: `{ ok, filesChecked, violations }`.

O `smugan check` sai com `1` quando encontra violações, `0` com `--warn` ou numa execução limpa, e `2` num erro de uso ou interno ([`bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs)). Ele lista todas as violações dos arquivos que lê e não compara com nenhuma baseline.

## Violações introduzidas vs. preexistentes

Os hooks bloqueiam só o que uma mudança acrescenta. A comparação fica em [`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs):

- **Identidade.** O `countViolations` transforma uma lista de violações numa contagem por `rule|message`. O número da linha não faz parte da chave, então uma violação que só mudou de lugar não é nova.
- **Comparação.** O `freshAgainst(baseline, violations)` desconta cada contagem da baseline das violações atuais. O que sobra é novo: uma segunda violação idêntica conta como nova mesmo que já houvesse uma.

**Antes de uma escrita (`pre`).**

1. O hook monta o texto que o arquivo teria depois da edição. Um `Write` fornece o conteúdo inteiro. `Edit` e `MultiEdit` substituem `old_string` por `new_string` no arquivo atual.
2. Ele analisa o arquivo atual e o resultado, e bloqueia com exit code `2` nas violações novas.
3. Se um `old_string` não casa, ou o arquivo passa de 1 MiB, não há o que julgar e a escrita passa.
4. Um arquivo novo não tem "antes", então toda violação nele conta.
5. `dead-imports` não é julgado em `Edit` nem `MultiEdit`, só em `Write`. Uma mudança feita em várias etapas passa legitimamente por um import não usado.

**Primeiro toque do turno.** Na primeira vez que um turno toca um arquivo, o `recordBaseline` guarda as contagens de antes no estado do turno. Para um arquivo de código, ele também guarda:

- os nomes das funções que o arquivo já tem,
- as formas de contract-drift que ele já tem,
- para um arquivo de teste, seu perfil de asserções e as contagens de testes.

Vale o primeiro toque: edições posteriores no mesmo turno não mexem na baseline.

**Fim do turno (`stop`).** O hook analisa de novo todo arquivo tocado e compara com uma baseline, escolhida nesta ordem:

1. A baseline do primeiro toque, quando existe.
2. Para um arquivo que um comando de shell alterou, a versão de antes do primeiro commit do turno nele.
3. Caso contrário, a versão commitada no HEAD do git (`freshVsHead`). As baselines do HEAD ficam em cache por sha do blob.
4. Um arquivo fora do git recebe a verificação completa.

Ele reporta no máximo 20 violações por arquivo.

**Modo warn.** Com `"mode": "warn"` na configuração, os dois hooks reportam os mesmos achados sem bloquear.
