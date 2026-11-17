// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeContent } from '../src/engine.mjs';
import { testConfig, ofRule } from './helpers.mjs';

const R = 'rls-tests';
const MIG = 'supabase/migrations/0001_init.sql';

/** @param {(dir: string, cfg: ReturnType<typeof testConfig>) => void} body */
function withProject(body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-rlstests-'));
  try {
    body(dir, testConfig({ root: dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('table without a pgTAP test file is flagged', () => {
  withProject((dir, cfg) => {
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 1);
    assert.match(v[0].message, /notes/);
    assert.match(v[0].message, /pgTAP/);
  });
});

test('table mentioned in a test file passes', () => {
  withProject((dir, cfg) => {
    mkdirSync(join(dir, 'supabase', 'tests'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'tests', '100-notes.test.sql'), 'select results_eq($$ select count(*) from notes $$, $$ values (0::bigint) $$, 1);');
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 0);
  });
});

test('mention of another table does not cover this one', () => {
  withProject((dir, cfg) => {
    mkdirSync(join(dir, 'supabase', 'tests'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'tests', '100-other.test.sql'), '-- covers notes_archive only\nselect 1 from notes_archive;');
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 1);
  });
});

test('exempt option skips a table', () => {
  withProject((dir, cfg) => {
    cfg.checks = { 'rls-tests': { exempt: ['reference_data'] } };
    const v = ofRule(analyzeContent(MIG, 'create table reference_data (id int);', cfg), R);
    assert.equal(v.length, 0);
  });
});

test('custom tests dir option is honored', () => {
  withProject((dir, cfg) => {
    cfg.checks = { 'rls-tests': { dir: 'db/tests' } };
    mkdirSync(join(dir, 'db', 'tests'), { recursive: true });
    writeFileSync(join(dir, 'db', 'tests', 'notes.sql'), 'select 1 from notes;');
    const v = ofRule(analyzeContent(MIG, 'create table notes (id uuid);', cfg), R);
    assert.equal(v.length, 0);
  });
});

test('platform schemas and temp tables are skipped', () => {
  withProject((dir, cfg) => {
    const sql = 'create table auth.mirror (id uuid);\ncreate temp table scratch (id int);';
    assert.equal(ofRule(analyzeContent(MIG, sql, cfg), R).length, 0);
  });
});

test('only applies to migration paths', () => {
  withProject((dir, cfg) => {
    assert.equal(ofRule(analyzeContent('db/seed.sql', 'create table notes (id uuid);', cfg), R).length, 0);
  });
});

test('smugan-ignore suppresses with a reason', () => {
  withProject((dir, cfg) => {
    const sql = '-- smugan-ignore rls-tests: covered by external harness in infra repo\ncreate table notes (id uuid);';
    assert.equal(ofRule(analyzeContent(MIG, sql, cfg), R).length, 0);
  });
});
