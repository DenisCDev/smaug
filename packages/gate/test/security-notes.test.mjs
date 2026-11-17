// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeContent } from '../src/engine.mjs';
import { testConfig, ofRule } from './helpers.mjs';

const R = 'security-notes';
const MIG = 'supabase/migrations/0001_init.sql';

/** @param {(dir: string, cfg: ReturnType<typeof testConfig>) => void} body */
function withProject(body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-secnotes-'));
  try {
    body(dir, testConfig({ root: dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('missing SECURITY_NOTES.md is flagged', () => {
  withProject((dir, cfg) => {
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 1);
    assert.match(v[0].message, /no SECURITY_NOTES\.md/);
  });
});

test('table not described in the notes is flagged', () => {
  withProject((dir, cfg) => {
    writeFileSync(join(dir, 'SECURITY_NOTES.md'), '- Tabela `patients`: usuário logado lê só o que é dele.\n');
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 1);
    assert.match(v[0].message, /not described/);
  });
});

test('described table passes', () => {
  withProject((dir, cfg) => {
    writeFileSync(join(dir, 'SECURITY_NOTES.md'), '- Tabela `notes`: visitante não lê nada; usuário logado lê/edita só o que é dele.\n');
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 0);
  });
});

test('custom file option is honored', () => {
  withProject((dir, cfg) => {
    cfg.checks = { 'security-notes': { file: 'docs/SECURITY.md' } };
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 1);
    assert.match(v[0].message, /docs\/SECURITY\.md/);
  });
});

test('exempt option skips a table', () => {
  withProject((dir, cfg) => {
    cfg.checks = { 'security-notes': { exempt: ['migrations_meta'] } };
    assert.equal(ofRule(analyzeContent(MIG, 'create table migrations_meta (id int);', cfg), R).length, 0);
  });
});

test('non-migration sql is not checked', () => {
  withProject((dir, cfg) => {
    assert.equal(ofRule(analyzeContent('db/seed.sql', 'create table notes (id uuid);', cfg), R).length, 0);
  });
});
