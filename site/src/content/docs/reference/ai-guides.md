---
title: AI guides
description: How smugan detects the AI engines and models a project uses, forms engine + model pairs, the signatures.json format, and how pair guides are validated and stored.
---

Smugan detects which AI engines and models a project uses, and keys a short guide to
each engine + model pair. Smugan itself ships no guides, versions or practices.
Each guide is researched for a pair the repository actually uses, the first time that
pair has none. Detection is in
[`packages/gate/src/ai-detect.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-detect.mjs),
and guides are handled in
[`packages/gate/src/ai-guides.mjs`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai-guides.mjs).

## `signatures.json`

Everything the detector knows is in
[`packages/gate/src/ai/signatures.json`](https://github.com/DenisCDev/smugan/blob/main/packages/gate/src/ai/signatures.json).
Adding an engine or a model pattern means adding an entry there, with no code change.

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

The fields of an engine entry:

| Field | Meaning |
|---|---|
| `id` | the engine id used in pair keys |
| `npm` | package names looked up in `package.json` dependency fields |
| `pypi` | distribution names looked up in `pyproject.toml` and `requirements*.txt`, compared after PEP 503 normalization |
| `imports` | module names matched in JS/TS `import`, `from`, `require(` and `import(`, and in Python `import x` / `from x import` |
| `files` | marker file names; a file with that name anywhere in the walk registers the engine |
| `images` | container image names matched in Dockerfiles and compose files, with an optional `:tag` used as the version |

The other top-level fields:

- `models[].pattern` is a regular expression for a model id. An id is matched only
  as a quoted string (`'…'`, `"…"` or `` `…` ``), optionally behind a `provider/`
  prefix.
- `runtimeModel` is a regular expression that marks the model as coming from the
  environment.

The shipped file lists these engines: `anthropic-sdk`, `openai-sdk`, `vercel-ai`,
`mastra`, `langchain` and `hermes-agent`. It has model patterns for `claude-`,
`gpt-`, `gemini-`, `grok-` and `hermes-`.

## Detection

Detection reads only the disk. It does not use the network, run project
configuration or open `.env` files.

**Walk.** The project walk is breadth-first. It skips folders whose name starts with
`.`, and these folders:

- `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.turbo`, `coverage`,
  `target`, `vendor`
- `.venv`, `venv`, `__pycache__`
- `fixtures`, `__fixtures__`, `test`, `tests`, `__tests__`, `e2e`
- `docs`, `doc`, `examples`, `example`, `samples`, `sample`, `benchmarks`,
  `benchmark`
- `.smugan.local`

It also skips `.env*` files, lockfiles and test paths.

**Limits.**

| Limit | Value |
|---|---|
| directory entries | 8,000 |
| code files read | 800 |
| depth | 10 |
| size per file | 256 KiB |

When the entry or file limit stops the walk, the result has `truncated: true`.

**Engine versions.** An engine keeps the first version found for it. A later source
replaces it only when the engine has no version yet. `package.json` files are read
during the walk, and Python manifests and Docker files after it. The sources are:

- for an npm dependency, `node_modules/<name>/package.json` in the package folder or
  at the root, and otherwise the first number in the declared range;
- the version in a Python requirement;
- an image tag.

Without any of these, the version is `null`. A pair key uses only `major.minor`, or
`unknown` when there is no version.

**Model ids.** These come from code files: `.js`/`.ts` and their variants, `.py`,
`.rs`, `.go`, `.java`, `.kt`, `.rb`, `.php`, `.json`, `.yaml`/`.yml` and `.toml`. Each
id becomes `family@version` by its shape alone. A trailing snapshot date is dropped,
the first number is the version, and the rest is the family. For example,
`claude-sonnet-4-5-20250929` becomes `claude-sonnet@4.5`. A file that matches
`runtimeModel` sets `runtimeModel: true` in the output.

## Pairs

The detector forms pairs with these rules:

- **A model next to an engine.** A model pairs with each known engine that the same
  file imports. The key is `<engine>@<major.minor>+<family>@<version>`, for example
  `anthropic-sdk@0.6+claude-sonnet@4.5`.
- **A single engine.** When no engine is imported next to the model and the project
  has exactly one engine, the model pairs with that engine.
- **No engine.** Otherwise the model stands alone, with the key `<family>@<version>`.
- **An engine with no model.** Such an engine gets a runtime pair:
  `<engine>@<major.minor>+runtime`.

Models are ordered by how often they appear, most used first. The `ai` block of
`smugan context --json` lists `engines`, `models`, `runtimeModel`, `truncated` and the
`pairs`. Each pair has `key`, `engine` (or `null`), `model` and
`guide: { status, path, expiresAt? }`.

## Guides

### Storage

There is one JSON file per pair, at
`~/.smugan/ai-guides/<key>.json`. `SMUGAN_AI_GUIDES_DIR` overrides the folder. In the
file name, characters outside `[a-z0-9.@-]` in the key become `_`. The checkout never
holds a guide, only points to its path. Writes take a lock and use an atomic rename.

### State

A guide has one of three states:

- `valid`, when the file's `key` matches and `expiresAt` is in the future;
- `expired`, when the date has passed;
- `missing`, when the file is absent, is not valid JSON, has a different key, or has
  no `expiresAt`.

### Writing a guide

```bash
smugan ai-guide [--project <dir>]                   # list the project's pairs and each guide's state
smugan ai-guide --write <guide.md> [--project <dir>] # validate and save a researched guide
```

The input is Markdown with frontmatter:

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

`--write` rejects the guide, listing every problem, when any of these holds:

- the frontmatter is missing;
- `key` is malformed, or is not a pair detected in the project;
- `reviewedAt` is not `YYYY-MM-DD`, is more than one day in the future, or is older
  than 30 days;
- `sources` is empty, or a source is not an `https:` URL or carries credentials;
- the body is empty or has more than 400 words;
- the first paragraph has more than 60 words.

A saved guide stores `key`, `reviewedAt`, `expiresAt`, `sources`, `summary` (the
first paragraph) and `body`. `expiresAt` is `reviewedAt` plus 30 days. The guide's
validity runs from the research date, not from the date it was saved.

## How the hooks use it

- **`session`.** When `detectAi` finds pairs, the hook returns an index of up to 6
  pairs. A valid guide shows its summary and path. A missing or expired one says the
  research is requested when a turn edits code that uses it. The LLM testing rules
  follow the index. Both are labeled as reference, not instructions.
- **`pre`.** When an edit imports an engine or writes a model id that this session
  has not seen, the hook scans the project. For each pair the file uses without a
  valid guide, it asks for a delegation to the `smugan-ai-research` subagent, with
  the key and the project path. It asks once per session.

The `smugan-ai-research` subagent saves the guide with `smugan ai-guide --write`.
See [Hooks](../hooks/).
