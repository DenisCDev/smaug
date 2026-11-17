// @ts-check
// The detector reads names off disk and nothing else. Every id below is made
// up: the detector must work from signatures alone, never from knowledge of
// a real engine or model.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectAi, importedEngines, majorMinor, modelKey, modelLiterals } from '../src/ai-detect.mjs';

/** @type {string[]} */
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** @param {Record<string, string>} files */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'smugan-ai-'));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

test('modelKey splits family and version by shape alone', () => {
  assert.deepEqual(modelKey('claude-fixture-2-1'), { family: 'claude-fixture', version: '2.1' });
  assert.deepEqual(modelKey('claude-3-5-fixture-20240101'), { family: 'claude-fixture', version: '3.5' }, 'a snapshot date is dropped');
  assert.deepEqual(modelKey('gpt-9.1-fixture'), { family: 'gpt-fixture', version: '9.1' });
  assert.deepEqual(modelKey('gpt-8o-mini'), { family: 'gpt-mini', version: '8o' });
  assert.deepEqual(modelKey('grok-9'), { family: 'grok', version: '9' });
  assert.equal(majorMinor('^1.74.3'), '1.74');
  assert.equal(majorMinor('3'), '3.0');
  assert.equal(majorMinor(null), 'unknown');
});

test('imports and literals are recognized in JS, TS and Python, and look-alikes are not', () => {
  assert.deepEqual(importedEngines("import Anthropic from '@anthropic-ai/sdk';"), ['anthropic-sdk']);
  assert.deepEqual(importedEngines("const { streamText } = require('ai');\nimport { x } from \"@mastra/core/agent\";"), ['vercel-ai', 'mastra']);
  assert.deepEqual(importedEngines('from anthropic import Anthropic\n'), ['anthropic-sdk']);
  assert.deepEqual(importedEngines('import openai\n'), ['openai-sdk']);
  assert.deepEqual(importedEngines("import x from 'ai-utils';\nimport y from 'openai-edge';\nconst ai = 1;"), []);
  assert.deepEqual(modelLiterals("model: 'acme/gpt-9.1-fixture',\nother: \"claude-code\", word: 'gpt'").map((m) => m), [{ id: 'gpt-9.1-fixture', line: 1 }]);
});

test('an engine takes its installed version, and its models make the pairs', () => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { '@mastra/core': '^1.2.0' } }),
    'node_modules/@mastra/core/package.json': JSON.stringify({ version: '1.74.0' }),
    'src/agent.ts': "export const agent = { model: 'acme/gpt-9.1-fixture' };\nexport const backup = 'gpt-9.1-fixture';\n",
  });
  const usage = detectAi(root);
  assert.deepEqual(usage.engines, [{ id: 'mastra', version: '1.74.0', source: 'node_modules/@mastra/core/package.json' }]);
  assert.deepEqual(usage.models.map((m) => [m.family, m.version, m.count, m.at]), [['gpt-fixture', '9.1', 2, 'src/agent.ts:1']]);
  assert.deepEqual(usage.pairs, [{ key: 'mastra@1.74+gpt-fixture@9.1', engine: 'mastra', model: 'gpt-fixture@9.1' }]);
});

test('markers, pinned images and Python manifests count; a model only from env is runtime', () => {
  const marker = detectAi(project({ '.hermes.md': '# contexto\n', 'src/run.mjs': 'export const x = 1;\n' }));
  assert.deepEqual(marker.pairs.map((p) => p.key), ['hermes-agent@unknown+runtime']);
  const image = detectAi(project({ 'deploy/Dockerfile.executor': 'FROM nousresearch/hermes-agent:v0.1.2\n' }));
  assert.deepEqual(image.engines.map((e) => [e.id, e.version, e.source]), [['hermes-agent', '0.1.2', 'deploy/Dockerfile.executor']]);
  const python = detectAi(project({ 'requirements.txt': 'anthropic==0.9.1\nanthropic-tools==1\n', 'app/main.py': 'import os\nmodel = os.environ["LLM_MODEL"]\n' }));
  assert.equal(python.runtime, true);
  assert.deepEqual(python.pairs.map((p) => p.key), ['anthropic-sdk@0.9+runtime']);
});

test('a model without a known engine gets a model-only pair', () => {
  const usage = detectAi(project({ 'src/x.mjs': "export const model = 'grok-9';\n" }));
  assert.deepEqual(usage.pairs, [{ key: 'grok@9', engine: null, model: 'grok@9' }]);
});

test('tests, fixtures, docs, prose, dependencies and env files are never read', () => {
  const usage = detectAi(project({
    'package.json': JSON.stringify({ name: 'plain' }),
    'src/index.mjs': 'export const name = "loja";\n',
    'tests/model.test.mjs': "const m = 'claude-fixture-1';\n",
    'src/model.test.ts': "const m = 'claude-fixture-1';\n",
    'fixtures/data.json': '{"model":"claude-fixture-1"}',
    'docs/guide.mjs': "export const m = 'claude-fixture-1';\n",
    'README.md': 'Usa `claude-fixture-1`.\n',
    'node_modules/x/index.js': "module.exports = 'claude-fixture-1';\n",
    '.env': 'LLM_MODEL="claude-fixture-1"\n',
    'config/prod.env': 'MODEL="claude-fixture-1"\n',
  }));
  assert.deepEqual({ engines: usage.engines, models: usage.models, pairs: usage.pairs }, { engines: [], models: [], pairs: [] });
});

test('a project without AI, including look-alike names, has no pairs', () => {
  const usage = detectAi(project({
    'package.json': JSON.stringify({ dependencies: { 'hermes-parser': '0.25.1', 'ai-utils': '1.0.0' } }),
    'src/a.ts': "export const tool = 'claude-code';\nexport const word = 'gpt';\nexport const ai = { aiEnabled: false };\n",
  }));
  assert.deepEqual(usage.pairs, []);
});

test('dated snapshots keep the family and version of the model', () => {
  assert.deepEqual(modelKey('gpt-9-2030-08-07'), { family: 'gpt', version: '9' });
  assert.deepEqual(modelKey('gpt-8o-2030-08-06'), { family: 'gpt', version: '8o' });
  assert.deepEqual(modelKey('grok-9-0709'), { family: 'grok', version: '9' });
});

test('a model pairs only with the engines imported next to it', () => {
  const usage = detectAi(project({
    'package.json': JSON.stringify({ dependencies: { openai: '9.1.0', '@anthropic-ai/sdk': '0.9.0' } }),
    'src/a.mjs': "import OpenAI from 'openai';\nexport const m = 'gpt-9.1-fixture';\n",
    'src/b.mjs': "import Anthropic from '@anthropic-ai/sdk';\nexport const m = 'claude-fixture-7';\n",
  }));
  assert.deepEqual(usage.pairs.map((p) => p.key).sort(), ['anthropic-sdk@0.9+claude-fixture@7', 'openai-sdk@9.1+gpt-fixture@9.1']);
});

test('a pyproject mentions an SDK in prose without depending on it', () => {
  const usage = detectAi(project({ 'pyproject.toml': '[project]\nname = "bench"\ndescription = "Comparable to the openai tiktoken tokenizer"\ndependencies = ["regex>=2023"]\n' }));
  assert.deepEqual(usage.engines, []);
  const real = detectAi(project({ 'pyproject.toml': '[project]\ndependencies = ["openai>=9.1", "regex"]\n' }));
  assert.deepEqual(real.engines.map((e) => [e.id, e.version]), [['openai-sdk', '9.1']]);
});

test('manifests are read before source files, so the file cap never hides an SDK', () => {
  /** @type {Record<string, string>} */
  const files = { 'package.json': JSON.stringify({ workspaces: ['apps/*', 'packages/*'] }), 'packages/llm/package.json': JSON.stringify({ dependencies: { '@anthropic-ai/sdk': '0.9.0' } }) };
  for (let i = 0; i < 850; i++) files[`apps/web/src/f${i}.ts`] = `export const v${i} = ${i};\n`;
  const usage = detectAi(project(files));
  assert.equal(usage.truncated, true);
  assert.deepEqual(usage.pairs.map((p) => p.key), ['anthropic-sdk@0.9+runtime']);
});

test('more snapshot shapes keep one family per model', () => {
  assert.deepEqual(modelKey('gemini-9.5-flash-preview-04-17'), { family: 'gemini-flash-preview', version: '9.5' });
  assert.deepEqual(modelKey('gpt-9-0125-preview'), { family: 'gpt-preview', version: '9' });
  assert.deepEqual(modelKey('gpt-9-32k'), { family: 'gpt-32k', version: '9' });
});

test('pyproject strings that start with an SDK name are not dependencies; Poetry tables are', () => {
  for (const text of [
    '[project]\ndescription = "OpenAI compatible tokenizer, no SDK"\ndependencies = ["regex"]\n',
    '[project]\nkeywords = ["tokenizer", "openai", "anthropic"]\ndependencies = ["regex"]\n',
  ]) assert.deepEqual(detectAi(project({ 'pyproject.toml': text })).engines, [], text);
  const poetry = detectAi(project({ 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.12"\nopenai = { version = "^9.40", extras = ["datalib"] }\n' }));
  assert.deepEqual(poetry.engines.map((e) => [e.id, e.version]), [['openai-sdk', '9.40']]);
  const groups = detectAi(project({ 'pyproject.toml': '[project.optional-dependencies]\nllm = ["Anthropic[bedrock]>=0.9"]\n' }));
  assert.deepEqual(groups.engines.map((e) => [e.id, e.version]), [['anthropic-sdk', '0.9']]);
});

test('a shallow workspace manifest is read even when a deep folder exhausts the entry cap', () => {
  /** @type {Record<string, string>} */
  const files = { 'package.json': JSON.stringify({ workspaces: ['apps/*', 'packages/*'] }), 'packages/llm/package.json': JSON.stringify({ dependencies: { '@anthropic-ai/sdk': '0.9.0' } }) };
  for (let i = 0; i < 8100; i++) files[`apps/web/public/icons/i${i}.svg`] = '';
  const usage = detectAi(project(files));
  assert.equal(usage.truncated, true);
  assert.deepEqual(usage.pairs.map((p) => p.key), ['anthropic-sdk@0.9+runtime']);
});
