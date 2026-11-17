---
title: Configuração
description: smugan.config.json e smugan.local.json — cada chave, seu tipo e valor padrão, como as camadas se combinam e o que acontece com um arquivo inválido.
---

A configuração é carregada por `loadConfig` em [`packages/gate/src/config.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/config.mjs). O mesmo carregador atende `smugan check`, os hooks, `smugan doctor` e `smugan why`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `smugan.config.json` | configuração compartilhada do projeto, versionada |
| `smaug.config.json` | o nome antigo do projeto; lido quando `smugan.config.json` não existe na mesma pasta |
| `smugan.local.json` | camada pessoal ao lado do arquivo compartilhado; suas chaves prevalecem. O `smugan init` o adiciona ao `.gitignore` |

Um BOM UTF-8 no início de um arquivo é removido antes do parsing.

## Busca e raiz do projeto

O carregador sobe a partir da pasta inicial (a pasta do arquivo analisado, ou o diretório atual no caso da CLI). Em cada pasta, procura um arquivo compartilhado (`smugan.config.json`, depois `smaug.config.json`) e um `smugan.local.json`.

- A primeira pasta que contém qualquer um dos arquivos encerra a subida e passa a ser a raiz do projeto. As duas camadas são lidas apenas dessa pasta.
- Se nenhuma pasta contém algum deles, valem os padrões, com raiz na pasta mais próxima que tenha `.git`; sem ela, na mais próxima com `package.json`; sem nenhuma das duas, na pasta inicial.

Os caminhos relativos na configuração e nas verificações (`migrations/`, `supabase/tests`, ...) são relativos a essa raiz.

## Chaves

| Chave | Tipo | Padrão | Efeito |
|---|---|---|---|
| `mode` | `"block"` ou `"warn"` | `"block"` | `warn` faz os hooks mostrarem as violações sem bloquear nem segurar o fim do turno. `smugan check` continua saindo com `1` quando há violações ([`smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs)) |
| `disable` | array de strings | `[]` | partes que este projeto desliga (um revisor, uma skill ou uma regra de stack); os hooks deixam de mencioná-las. Nomes que o checkout não conhece são descartados ([`parts.cjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/parts.cjs)) |
| `ignore` | array de globs | `[]` | somado à lista fixa de ignorados abaixo. Os globs aceitam `*`, `**` e `?` |
| `checks` | objeto | `{}` | configurações por regra, veja [Verificações](#verificações) |
| `hook.eslint` | booleano | `true` | o hook post roda o ESLint do projeto no arquivo gravado |
| `hook.typecheck` | booleano | `true` | checagem de tipos dos arquivos TypeScript tocados (veja no README do gate quando ela roda no `post` ou no fim do turno) |
| `hook.timeoutMs` | número (ms) | `30000` | prazo de cada execução do ESLint, e do `tsc` quando ele roda no `post` |
| `hook.stop` | objeto ou `false` | objeto abaixo | `false` desliga toda a verificação de fim de turno para os arquivos do projeto |
| `hook.stop.smugan` | booleano | `true` | reanalisa os arquivos tocados com as regras do Smugan no fim do turno |
| `hook.stop.typecheck` | booleano | `true` | roda o script `typecheck` ou `type-check` |
| `hook.stop.tests` | booleano | `true` | roda os testes relacionados |
| `hook.stop.shell` | booleano | `true` | também verifica os arquivos que um comando de shell alterou durante o turno; use `false` quando pessoas editam o repositório enquanto o agente trabalha |
| `hook.stop.timeoutMs` | número (ms) | `120000` | prazo de cada script de fim de turno |

Os efeitos das chaves `hook.*` estão descritos no [README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#configuration) e são aplicados em [`hook.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/hook.mjs).

`hook.stop.build` não é lido. O `smugan.config.json` gravado por `smugan init` contém `"build": false`; o `smugan doctor` avisa quando ele está `true`, porque o fim do turno não roda mais o build ([`doctor.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/doctor.mjs)).

### Verificações

`checks.<rule>` aceita:

- `false`: a regra fica desligada.
- um objeto: a regra fica ligada, com opções. As opções de cada regra estão listadas no [README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#configuration) e na página [Verificações](/pt-br/reference/checks/).
- qualquer outro valor, ou ausência: o padrão da regra.

Padrões quando a regra não aparece em `checks` (`checkEnabled` em `config.mjs`):

| Regras | Padrão |
|---|---|
| `ui-strings` | ligada só quando `SMUGAN_UI_LANG` é uma tag de português (`pt`, `pt-BR`, ...) |
| `rls`, `rls-tests`, `security-notes`, `anon-grants`, `view-invoker`, `search-path`, `rls-policy` | ligadas só onde o projeto, ou o pacote dono do arquivo verificado, usa Supabase |
| todas as outras regras | ligadas |

Definir explicitamente uma regra de Supabase ou `ui-strings` (como `true` ou um objeto) a liga independentemente da detecção.

### Ignorados fixos

Nunca verificados, seja qual for a configuração (`DEFAULT_IGNORE` em `config.mjs`):

`**/node_modules/**`, `**/.git/**`, `**/.next/**`, `**/dist/**`, `**/build/**`, `**/out/**`, `**/coverage/**`, `**/.vercel/**`, `**/.turbo/**`, `**/.expo/**`, `**/.venv/**`, `**/venv/**`, `**/site-packages/**`, `**/__pycache__/**`, `**/.terraform/**`, `**/*.min.*`, `**/*.gen.*`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock`, `**/database.types.ts`, `**/.env`, `**/.env.local`, `**/.env.*.local`.

Também são ignorados: os artefatos do cache de contexto, e uma pasta `vendor` preenchida por um gerenciador de pacotes, reconhecida por um destes itens dentro dela: `autoload.php`, `modules.txt`, `bundle/ruby`, `bundle/jruby` ou `bundle/truffleruby`. Uma pasta que apenas se chama `vendor` é verificada.

## Regras de combinação

Primeiro são montados os padrões, depois aplicado o arquivo compartilhado e, por fim, o `smugan.local.json`. Cada camada é aplicada chave por chave (`applyLayer`):

| Chave | Regra |
|---|---|
| `mode` | substituído quando a camada o define |
| `disable` | união de todas as camadas, sem duplicatas |
| `ignore` | união de todas as camadas, sem duplicatas; um valor que não seja array é ignorado |
| `checks` | por regra: quando o valor existente e o novo são ambos objetos, são combinados de forma rasa; caso contrário, o novo valor substitui o antigo. Um `checks` que não seja objeto é ignorado |
| `hook` (exceto `stop`) | combinação rasa; as chaves da camada substituem as existentes |
| `hook.stop` | `false` o substitui por `false`. Um objeto é combinado de forma rasa sobre o `stop` atual, ou sobre o `stop` padrão quando uma camada anterior o definiu como `false` |

Exemplo: o arquivo compartilhado desliga `console-log` e isenta uma tabela de `rls`; a camada pessoal coloca apenas os hooks em modo de aviso.

```json title="smugan.config.json"
{
  "ignore": ["generated/**"],
  "checks": { "console-log": false, "rls": { "exempt": ["reference_data"] } },
  "hook": { "stop": { "tests": true, "timeoutMs": 120000 } }
}
```

```json title="smugan.local.json"
{ "mode": "warn", "hook": { "stop": { "shell": false } } }
```

Resultado: `mode` é `warn`; `hook.stop` mantém `tests: true` e `timeoutMs: 120000` e ganha `shell: false`; `checks` e `ignore` vêm do arquivo compartilhado.

## Arquivos inválidos

Uma camada é descartada por inteiro quando:

- não é JSON válido;
- `mode` está presente e não é `"block"` nem `"warn"`;
- `disable` está presente e não é um array de strings.

Todos os campos são validados antes de qualquer um ser aplicado, então uma camada descartada não muda nada. A outra camada continua sendo aplicada, e a raiz continua sendo a pasta onde os arquivos foram encontrados. Só o primeiro arquivo quebrado é registrado.

- `smugan check` imprime `smugan: warning — could not use <file> (invalid JSON or setting), ignoring that file` no stderr e roda normalmente.
- Os hooks seguem sem mensagem ([README do gate](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#configuration)).

Tipos errados nas outras chaves não são rejeitados: um `ignore` que não seja array ou um `checks` que não seja objeto é ignorado, e os valores de `hook` são combinados como vieram.

## Inspecionando a configuração ativa

O `smugan doctor` informa, para a pasta atual, quando o modo de aviso está ativo, quando há uma camada `smugan.local.json` em uso e quando `"stop": {"build": true}` está definido. Veja [doctor e why](/pt-br/reference/doctor-and-why/).
