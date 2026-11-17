---
title: Contrato de aceite
description: O formato do arquivo de contrato de aceite, suas regras de validação, onde ele é armazenado e a semântica de smugan contract --set, --replace, --mark e --clear.
---

Um contrato de aceite registra o que uma mudança precisa fazer. Ele é escrito a partir
do pedido, antes de existir qualquer código, para que os revisores julguem o diff
contra ele. Cada checkout tem um contrato, armazenado fora do checkout. O código fica em
[`packages/gate/src/contract.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/contract.mjs),
e o comando, em
[`packages/gate/bin/smugan.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/bin/smugan.mjs).

## Comandos

```bash
smugan contract [folder] --set contract.json [--replace]
smugan contract [folder] --mark <n> <pending|done|blocked> [--evidence "<text>"]
smugan contract [folder] [--json]
smugan contract [folder] --clear
```

`folder` tem `.` como padrão. O comando executa uma ação por vez. Estes casos são
erros de uso, com código de saída 2:

- duas ações ao mesmo tempo;
- `--set` sem arquivo;
- `--mark` sem um inteiro positivo e um status;
- `--evidence` sem `--mark`;
- `--replace` sem `--set`;
- uma opção desconhecida.

Sem ação, o comando imprime o contrato, ou o JSON bruto com `--json`. Ele sai com 1
quando não há contrato.

## Formato de entrada (`--set`)

O arquivo de entrada precisa ser um arquivo regular de no máximo 64 KiB contendo JSON.
Um BOM no início é aceito. Só estes campos são permitidos. Qualquer outra chave, no
nível superior ou dentro de um critério ou decisão, é rejeitada:

| Campo | Obrigatório | Regra |
|---|---|---|
| `request` | sim | uma string não vazia, de até 4.000 caracteres: o pedido citado |
| `criteria` | sim | de 3 a 6 objetos, cada um com exatamente `behavior` e `verify` |
| `criteria[].behavior` | sim | uma string não vazia, de até 600 caracteres: o comportamento observável |
| `criteria[].verify` | sim | uma string não vazia, de até 600 caracteres: o comando, teste ou observação que o comprova |
| `outOfScope` | não | até 6 strings não vazias, de até 300 caracteres cada |
| `decisions` | não | até 6 objetos com exatamente `decision` e `reason`, cada um uma string não vazia de até 300 caracteres |

Um contrato rejeitado lista todos os problemas e sai com 2. Menos de 3 critérios são
rejeitados com "a request that fits in fewer needs no contract".

Exemplo:

```json
{
  "request": "Reject expired sessions before any protected mutation.",
  "criteria": [
    { "behavior": "A mutation with an expired session returns 401.", "verify": "npm test -- session-expiry" },
    { "behavior": "A valid session still mutates.", "verify": "npm test -- session-valid" },
    { "behavior": "Reads are unaffected.", "verify": "npm test -- read-paths" }
  ],
  "outOfScope": ["Refresh-token rotation"],
  "decisions": [{ "decision": "Use 401, not 403", "reason": "The client already re-authenticates on 401" }]
}
```

## Formato armazenado

Ao salvar, as strings passam por trim e cada critério recebe `"status": "pending"`. O
arquivo armazenado acrescenta os seguintes campos:

| Campo | Significado |
|---|---|
| `version` | sempre `1` |
| `root` | o checkout ao qual o contrato pertence |
| `createdAt`, `updatedAt` | timestamps ISO |
| `criteria[].status` | `pending`, `done` ou `blocked` |
| `criteria[].evidence` | presente depois de `--mark … --evidence` |

## Local de armazenamento

O contrato pertence ao checkout: o topo do repositório Git de `folder`
(`git rev-parse --show-toplevel`), ou a própria pasta fora de um repositório. Ele é
armazenado em:

```
<cache>/smugan/contracts/<hash>.json
```

`<cache>` é `LOCALAPPDATA`, `XDG_CACHE_HOME` ou `~/.cache`, nessa ordem. Quando
`SMUGAN_CACHE_DIR` está definida, o arquivo é `SMUGAN_CACHE_DIR/contracts/<hash>.json`.
`<hash>` são os primeiros 32 caracteres hexadecimais do SHA-256 do caminho do checkout
em minúsculas e com barras normais. A pasta é criada com modo `0700`. As gravações usam
um lock e um rename atômico. Como o arquivo fica fora do checkout, ele nunca aparece no
`git status` nem em um commit.

## Semântica das ações

### `--set`

O `--set` valida o arquivo de entrada. Quando não existe contrato, ele salva o contrato
e o imprime. Quando já existe um, recusa com saída 2 e mostra um resumo do contrato
existente: a idade dele, quantos critérios estão concluídos e o início do pedido. O
contrato existente nunca é sobrescrito em silêncio, para que o progresso de outra
sessão no mesmo checkout não se perca.

### `--replace`

O `--replace` só é válido com `--set`. Ele sobrescreve o contrato existente e informa o
que substituiu. Também funciona quando o arquivo armazenado não é JSON válido e, nesse
caso, informa que substituiu um contrato ilegível.

### `--mark <n> <status>`

O `--mark` define o status do critério `n`, contando a partir de 1.

- `done` e `blocked` exigem `--evidence`. A evidência tem de 1 a 600 caracteres: o que
  você viu, como o comando e o resultado dele, ou o motivo pelo qual o critério está
  bloqueado.
- `pending` sem `--evidence` remove qualquer evidência anterior.
- O `--mark` falha quando não há contrato ou não há critério `n`, e quando o status não
  é um dos três.
- `updatedAt` é atualizado a cada marcação.

### `--clear`

O `--clear` apaga o arquivo do contrato e diz o que removeu: o resumo, "the unreadable
contract", ou que não havia nenhum. Assim como o `--replace`, funciona com um arquivo
que não é JSON válido.

### Arquivo ilegível

Um arquivo de contrato que existe mas não pode ser interpretado gera um erro. O erro
nomeia o arquivo e as duas saídas: `--set <file> --replace` e `--clear`.

## Como os hooks usam isso

- **`pre`.** Na primeira edição de um arquivo crítico na sessão, por projeto, o hook
  consulta o contrato. Sem contrato, o lembrete sugere
  `smugan contract --set <file.json>`. Quando todos os critérios estão `done`, ele pede
  que você confirme que o contrato é trabalho concluído antes de substituí-lo. Um
  critério `blocked` conta como trabalho em andamento. Um contrato ilegível recebe um
  lembrete próprio. O lembrete nunca bloqueia a edição. Veja
  [Hooks](../hooks/#pre-pretooluse-para-write-edit-e-multiedit).
- **`stop`.** A verificação `exploration-residue` usa o contrato para definir o escopo
  do turno: o `request`, o `behavior` e o `verify` de cada critério e cada decisão. Ela
  só usa o contrato quando algum critério não está `done`. Os pedidos recentes do
  usuário, lidos do transcript, também contam para o escopo.
