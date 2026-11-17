---
title: Guias de IA
description: Como o smugan detecta os motores e modelos de IA que um projeto usa, forma pares motor + modelo, o formato do signatures.json e como os guias de cada par são validados e armazenados.
---

O Smugan detecta quais motores e modelos de IA um projeto usa e associa um guia curto
a cada par motor + modelo. O próprio Smugan não traz guias, versões nem práticas.
Cada guia é pesquisado para um par que o repositório de fato usa, na primeira vez em
que esse par aparece sem guia. A detecção fica em
[`packages/gate/src/ai-detect.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-detect.mjs),
e os guias são tratados em
[`packages/gate/src/ai-guides.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-guides.mjs).

## `signatures.json`

Tudo o que o detector sabe está em
[`packages/gate/src/ai/signatures.json`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai/signatures.json).
Adicionar um motor ou um padrão de modelo é só acrescentar uma entrada ali, sem mudar
código.

```json
{
  "engines": [
    { "id": "anthropic-sdk", "npm": ["@anthropic-ai/sdk"], "pypi": ["anthropic"], "imports": ["@anthropic-ai/sdk", "anthropic"] },
    { "id": "hermes-agent", "files": [".hermes.md", "HERMES.md"], "images": ["nousresearch/hermes-agent"] }
  ],
  "models": [
    { "pattern": "claude-[a-z0-9.-]*[0-9][a-z0-9.-]*" }
  ],
  "runtimeModel": "(?:process\\.env|import\\.meta\\.env|os\\.environ|os\\.getenv|env::var|Deno\\.env\\.get)[^\\n]{0,60}MODEL"
}
```

Os campos de uma entrada de motor:

| Campo | Significado |
|---|---|
| `id` | o id do motor usado nas chaves dos pares |
| `npm` | nomes de pacote procurados nos campos de dependência do `package.json` |
| `pypi` | nomes de distribuição procurados em `pyproject.toml` e `requirements*.txt`, comparados após a normalização da PEP 503 |
| `imports` | nomes de módulo casados em `import`, `from`, `require(` e `import(` de JS/TS, e em `import x` / `from x import` de Python |
| `files` | nomes de arquivos marcadores; um arquivo com esse nome em qualquer ponto da varredura registra o motor |
| `images` | nomes de imagens de contêiner casados em Dockerfiles e arquivos compose, com uma `:tag` opcional usada como versão |

Os demais campos de nível superior:

- `models[].pattern` é uma expressão regular para o id de um modelo. Um id só é
  casado como string entre aspas (`'…'`, `"…"` ou `` `…` ``), opcionalmente precedido
  de um prefixo `provider/`.
- `runtimeModel` é uma expressão regular que indica que o modelo vem do ambiente.

O arquivo distribuído lista estes motores: `anthropic-sdk`, `openai-sdk`, `vercel-ai`,
`mastra`, `langchain` e `hermes-agent`. Ele tem padrões de modelo para `claude-`,
`gpt-`, `gemini-`, `grok-` e `hermes-`.

## Detecção

A detecção lê apenas o disco. Ela não usa a rede, não executa a configuração do
projeto e não abre arquivos `.env`.

**Varredura.** A varredura do projeto é em largura. Ela pula pastas cujo nome começa
com `.` e estas pastas:

- `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.turbo`, `coverage`,
  `target`, `vendor`
- `.venv`, `venv`, `__pycache__`
- `fixtures`, `__fixtures__`, `test`, `tests`, `__tests__`, `e2e`
- `docs`, `doc`, `examples`, `example`, `samples`, `sample`, `benchmarks`,
  `benchmark`
- `.smugan.local`

Ela também pula arquivos `.env*`, lockfiles e caminhos de teste.

**Limites.**

| Limite | Valor |
|---|---|
| entradas de diretório | 8.000 |
| arquivos de código lidos | 800 |
| profundidade | 10 |
| tamanho por arquivo | 256 KiB |

Quando o limite de entradas ou de arquivos interrompe a varredura, o resultado traz
`truncated: true`.

**Versões dos motores.** Um motor fica com a primeira versão encontrada para ele. Uma
fonte posterior só a substitui quando o motor ainda não tem versão. Os arquivos
`package.json` são lidos durante a varredura, e os manifestos Python e os arquivos
Docker, depois dela. As fontes são:

- para uma dependência npm, `node_modules/<name>/package.json` na pasta do pacote ou
  na raiz e, na falta dele, o primeiro número do intervalo declarado;
- a versão em um requirement Python;
- a tag de uma imagem.

Sem nenhuma delas, a versão é `null`. A chave de um par usa só `major.minor`, ou
`unknown` quando não há versão.

**Ids de modelo.** Vêm de arquivos de código: `.js`/`.ts` e suas variantes, `.py`,
`.rs`, `.go`, `.java`, `.kt`, `.rb`, `.php`, `.json`, `.yaml`/`.yml` e `.toml`. Cada
id vira `family@version` apenas pelo seu formato. Uma data de snapshot no final é
descartada, o primeiro número é a versão e o resto é a família. Por exemplo,
`claude-sonnet-4-5-20250929` vira `claude-sonnet@4.5`. Um arquivo que casa com
`runtimeModel` define `runtimeModel: true` na saída.

## Pares

O detector forma pares com estas regras:

- **Um modelo ao lado de um motor.** Um modelo forma par com cada motor conhecido que o
  mesmo arquivo importa. A chave é `<engine>@<major.minor>+<family>@<version>`, por
  exemplo `anthropic-sdk@0.6+claude-sonnet@4.5`.
- **Um único motor.** Quando nenhum motor é importado junto do modelo e o projeto tem
  exatamente um motor, o modelo forma par com esse motor.
- **Nenhum motor.** Caso contrário, o modelo fica sozinho, com a chave
  `<family>@<version>`.
- **Um motor sem modelo.** Esse motor recebe um par de runtime:
  `<engine>@<major.minor>+runtime`.

Os modelos são ordenados pela frequência com que aparecem, do mais usado para o menos
usado. O bloco `ai` de `smugan context --json` lista `engines`, `models`,
`runtimeModel`, `truncated` e os `pairs`. Cada par tem `key`, `engine` (ou `null`),
`model` e `guide: { status, path, expiresAt? }`.

## Guias

### Armazenamento

Há um arquivo JSON por par, em `~/.smugan/ai-guides/<key>.json`.
`SMUGAN_AI_GUIDES_DIR` substitui a pasta. No nome do arquivo, os caracteres da chave
fora de `[a-z0-9.@-]` viram `_`. O checkout nunca guarda um guia, apenas aponta para o
caminho dele. As gravações usam um lock e um rename atômico.

### Estado

Um guia está em um de três estados:

- `valid`, quando a `key` do arquivo confere e `expiresAt` está no futuro;
- `expired`, quando a data já passou;
- `missing`, quando o arquivo não existe, não é JSON válido, tem outra chave ou não
  tem `expiresAt`.

### Gravando um guia

```bash
smugan ai-guide [--project <dir>]                   # list the project's pairs and each guide's state
smugan ai-guide --write <guide.md> [--project <dir>] # validate and save a researched guide
```

A entrada é Markdown com frontmatter:

```markdown
---
key: anthropic-sdk@0.6+claude-sonnet@4.5
reviewedAt: 2026-11-10
sources:
  - https://docs.example.com/models
---
First paragraph: the summary, at most 60 words.

Rest of the guide.
```

O `--write` rejeita o guia, listando todos os problemas, quando qualquer uma destas
condições vale:

- falta o frontmatter;
- `key` está malformada ou não é um par detectado no projeto;
- `reviewedAt` não está no formato `YYYY-MM-DD`, está mais de um dia no futuro ou tem
  mais de 30 dias;
- `sources` está vazio, ou uma fonte não é uma URL `https:` ou carrega credenciais;
- o corpo está vazio ou tem mais de 400 palavras;
- o primeiro parágrafo tem mais de 60 palavras.

Um guia salvo armazena `key`, `reviewedAt`, `expiresAt`, `sources`, `summary` (o
primeiro parágrafo) e `body`. `expiresAt` é `reviewedAt` mais 30 dias. A validade do
guia conta a partir da data da pesquisa, não da data em que foi salvo.

## Como os hooks usam isso

- **`session`.** Quando `detectAi` encontra pares, o hook devolve um índice de até 6
  pares. Um guia válido mostra seu resumo e caminho. Um ausente ou expirado avisa que a
  pesquisa será pedida quando um turno editar código que o usa. As regras de teste de
  LLM vêm logo após o índice. Ambos são rotulados como referência, não como
  instruções.
- **`pre`.** Quando uma edição importa um motor ou escreve um id de modelo que esta
  sessão ainda não viu, o hook varre o projeto. Para cada par que o arquivo usa sem um
  guia válido, ele pede uma delegação ao subagente `smugan-ai-research`, com a chave e
  o caminho do projeto. Ele pede uma vez por sessão.

O subagente `smugan-ai-research` salva o guia com `smugan ai-guide --write`.
Veja [Hooks](../hooks/).
