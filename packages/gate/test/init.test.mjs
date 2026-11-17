// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from '../src/init.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {(dir: string) => void} body */
function withProject(body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-init-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A project that declares every stack the scaffolding knows. @param {string} dir */
const fullStack = (dir) => writeFileSync(join(dir, 'package.json'), JSON.stringify({
  dependencies: { next: '15.1.0', '@supabase/supabase-js': '2.45.0', '@sentry/nextjs': '8.40.0' },
  devDependencies: { '@playwright/test': '1.49.0' },
}));

test('init scaffolds config and the Tier 2 harness for the stacks the project declares', () => {
  withProject((dir) => {
    fullStack(dir);
    const lines = runInit(dir, PKG_ROOT);
    assert.ok(lines.includes('+ smugan.config.json'));
    for (const expected of [
      'supabase/tests/000-setup.sql',
      'supabase/tests/001-rls-enabled.sql',
      'supabase/tests/table-rls.test.sql.template',
      'SECURITY_NOTES.md',
      'playwright.config.ts',
      'tests/app.context.md',
      'tests/e2e/smoke.spec.ts',
      'instrumentation.ts',
      'instrumentation-client.ts',
      'sentry.server.config.ts',
      'sentry.edge.config.ts',
      'docs/sentry-setup.md',
      '.github/workflows/smugan.yml',
    ]) {
      assert.ok(existsSync(join(dir, expected)), expected + ' created');
    }
    const config = JSON.parse(readFileSync(join(dir, 'smugan.config.json'), 'utf8'));
    // Left to detection, so the config never forces Supabase checks on another stack.
    for (const check of ['rls', 'rls-tests', 'security-notes', 'anon-grants']) assert.equal(config.checks[check], undefined, check);
    for (const check of ['stale-mutation', 'test-weakening', 'assertion-weakening', 'money-float', 'empty-catch', 'fetch-timeout']) {
      assert.equal(config.checks[check], true, check);
    }
    assert.equal(config.hook.stop.build, false, 'build stays opt-in');
  });
});

test('init adds no scaffolding for a stack the project does not declare', () => {
  withProject((dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { pg: '8.13.0', next: '15.1.0' } }));
    const lines = runInit(dir, PKG_ROOT);
    for (const absent of ['supabase/tests/000-setup.sql', 'SECURITY_NOTES.md', 'playwright.config.ts', 'tests/e2e/smoke.spec.ts', 'instrumentation.ts', 'docs/sentry-setup.md']) {
      assert.equal(existsSync(join(dir, absent)), false, absent);
    }
    assert.ok(existsSync(join(dir, '.github/workflows/smugan.yml')));
    assert.ok(lines.some((l) => l.startsWith('- ') && l.includes('playwright.config.ts') && l.includes('@playwright/test')), lines.join(' | '));
    assert.ok(lines.some((l) => l.startsWith('- ') && l.includes('instrumentation.ts') && l.includes('@sentry/nextjs')));
  });
});

test('init never overwrites existing files', () => {
  withProject((dir) => {
    fullStack(dir);
    writeFileSync(join(dir, 'SECURITY_NOTES.md'), 'conteudo do usuario\n');
    writeFileSync(join(dir, 'smugan.config.json'), '{"checks":{}}');
    const lines = runInit(dir, PKG_ROOT);
    assert.equal(readFileSync(join(dir, 'SECURITY_NOTES.md'), 'utf8'), 'conteudo do usuario\n');
    assert.equal(readFileSync(join(dir, 'smugan.config.json'), 'utf8'), '{"checks":{}}');
    assert.ok(lines.includes('= SECURITY_NOTES.md (exists, kept)'));
    assert.ok(lines.includes('= smugan.config.json (exists, kept)'));
  });
});

test('init is idempotent — second run copies nothing new', () => {
  withProject((dir) => {
    fullStack(dir);
    runInit(dir, PKG_ROOT);
    const second = runInit(dir, PKG_ROOT);
    assert.ok(second.every((line) => line.startsWith('=')), 'all entries are "exists, kept"');
  });
});

test('a project still on the former smaug.config.json keeps its settings and gets no second config', async () => {
  const { loadConfig } = await import('../src/config.mjs');
  withProject((dir) => {
    writeFileSync(join(dir, 'smaug.config.json'), JSON.stringify({ hook: { stop: { timeoutMs: 600000 } } }));
    const stop = loadConfig(dir).hook.stop;
    assert.ok(stop);
    assert.equal(stop.timeoutMs, 600000);
    assert.ok(runInit(dir, PKG_ROOT).includes('= smaug.config.json (exists, kept)'));
    assert.equal(existsSync(join(dir, 'smugan.config.json')), false);
  });
});

test('init lists smugan.local.json in .gitignore once, keeping what is there', () => {
  withProject((dir) => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules');
    assert.ok(runInit(dir, PKG_ROOT).includes('+ .gitignore: smugan.local.json'));
    assert.ok(runInit(dir, PKG_ROOT).includes('= .gitignore (smugan.local.json already listed)'));
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules\nsmugan.local.json\n');
  });
  withProject((dir) => {
    writeFileSync(join(dir, '.gitignore'), '/smugan.local.json\r\n');
    runInit(dir, PKG_ROOT);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '/smugan.local.json\r\n');
  });
  withProject((dir) => {
    runInit(dir, PKG_ROOT);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'smugan.local.json\n');
  });
});

test('init leaves ui-strings to the install language instead of turning it on', () => {
  withProject((dir) => {
    runInit(dir, PKG_ROOT);
    const config = JSON.parse(readFileSync(join(dir, 'smugan.config.json'), 'utf8'));
    assert.equal('ui-strings' in config.checks, false);
  });
});
