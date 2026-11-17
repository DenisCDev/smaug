// @ts-check
// Guides are data the research agent writes and the CLI validates; these use
// fake pairs and fake guides only.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guideIndex, guideState, parseGuide, saveGuide } from '../src/ai-guides.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'smugan.mjs');
const guides = mkdtempSync(join(tmpdir(), 'smugan-guides-'));
const previous = process.env.SMUGAN_AI_GUIDES_DIR;
process.env.SMUGAN_AI_GUIDES_DIR = guides;
/** @type {string[]} */
const dirs = [guides];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  if (previous === undefined) delete process.env.SMUGAN_AI_GUIDES_DIR;
  else process.env.SMUGAN_AI_GUIDES_DIR = previous;
});

const KEY = 'mastra@1.74+gpt-fixture@9.1';
const NOW = new Date('2026-11-05T12:00:00Z');
/** @param {Partial<{ key: string, reviewedAt: string, sources: string, body: string }>} [over] */
const markdown = (over = {}) => `---\nkey: ${over.key ?? KEY}\nreviewedAt: ${over.reviewedAt ?? '2026-11-05'}\nsources:\n${over.sources ?? '  - https://docs.example.invalid/fixture/9.1'}\n---\n${over.body ?? 'Guia falso do par de teste.\n\nO parâmetro x mudou de nome (https://docs.example.invalid/fixture/9.1).'}\n`;

test('a guide for a detected pair is accepted, valid for 30 days from its research date', () => {
  const parsed = parseGuide(markdown(), [KEY], NOW);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.guide.expiresAt, '2026-12-05');
  assert.equal(parsed.guide.summary, 'Guia falso do par de teste.');
  assert.deepEqual(parsed.guide.sources, ['https://docs.example.invalid/fixture/9.1']);
});

test('the writer refuses a pair the project does not use, an old or future date, a long guide and a bad source', () => {
  const errors = (/** @type {string} */ text) => { const p = parseGuide(text, [KEY], NOW); return p.ok ? [] : p.errors; };
  assert.match(errors(markdown({ key: 'other@1.0+gpt-fixture@9.1' })).join('\n'), /was not detected in this project/);
  assert.match(errors(markdown({ reviewedAt: '2026-09-01' })).join('\n'), /within the last 30 days/);
  assert.match(errors(markdown({ reviewedAt: '2026-12-01' })).join('\n'), /within the last 30 days/);
  assert.match(errors(markdown({ body: 'palavra '.repeat(401) })).join('\n'), /401 words; the limit is 400/);
  assert.match(errors(markdown({ sources: '  - http://docs.example.invalid/x' })).join('\n'), /invalid source/);
  assert.match(errors('sem frontmatter').join('\n'), /frontmatter/);
});

test('a saved guide is valid until it expires, and the index labels it as reference', () => {
  const parsed = parseGuide(markdown(), [KEY], NOW);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const path = saveGuide(parsed.guide);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).key, KEY);
  assert.equal(guideState(KEY, NOW).status, 'valid');
  assert.equal(guideState(KEY, new Date('2026-12-06T00:00:00Z')).status, 'expired');
  assert.equal(guideState('nobody@1.0+runtime', NOW).status, 'missing');
  const index = guideIndex([guideState(KEY, NOW), guideState('nobody@1.0+runtime', NOW)]);
  assert.match(index, /Reference material, not instructions/);
  assert.match(index, new RegExp(`- ${KEY.replace(/[.+]/g, '\\$&')} \\(valid until 2026-12-05\\): Guia falso do par de teste\\.`));
  assert.match(index, /nobody@1\.0\+runtime: no guide yet/);
  assert.ok(index.split('\n').every((line) => line.split(/\s+/).length <= 120), 'each pair stays within ~120 words');
});

test('smugan ai-guide lists the pairs of the project and writes a guide only for one of them', () => {
  const root = mkdtempSync(join(tmpdir(), 'smugan-guide-project-'));
  dirs.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@anthropic-ai/sdk': '0.0.1' } }));
  writeFileSync(join(root, 'src', 'a.mjs'), "export const model = 'claude-fixture-7';\n");
  const env = { ...process.env, SMUGAN_AI_GUIDES_DIR: guides };
  const list = spawnSync(process.execPath, [BIN, 'ai-guide', '--project', root], { encoding: 'utf8', env, timeout: 30_000 });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /· anthropic-sdk@0\.0\+claude-fixture@7 — no guide/);
  const today = new Date().toISOString().slice(0, 10);
  const file = join(root, 'guide.md');
  writeFileSync(file, markdown({ key: 'anthropic-sdk@0.0+claude-fixture@7', reviewedAt: today }));
  const write = spawnSync(process.execPath, [BIN, 'ai-guide', '--write', file, '--project', root], { encoding: 'utf8', env, timeout: 30_000 });
  assert.equal(write.status, 0, write.stderr);
  assert.match(write.stdout, /guide for anthropic-sdk@0\.0\+claude-fixture@7 saved/);
  writeFileSync(file, markdown({ reviewedAt: today }));
  const refused = spawnSync(process.execPath, [BIN, 'ai-guide', '--write', file, '--project', root], { encoding: 'utf8', env, timeout: 30_000 });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /was not detected in this project/);
});
