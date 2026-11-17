#!/usr/bin/env node
// smugan-opencode gate runner — the child process that actually runs the gate.
// The plugin cannot import the engine directly: the gate is synchronous
// (execSync for typecheck/tests, up to 120s per script) and would freeze
// OpenCode's event loop, and the plugin runs under Bun while the gate hands
// process.execPath to tsc/eslint/vitest — those need node.
// Contract: {kind, input} JSON on stdin → {exitCode, stderr} JSON on stdout.
// Always exits 0; an internal smugan failure must never break a tool call.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOM = /^\uFEFF/;

function gateDir() {
  if (process.env.SMUGAN_GATE_DIR) return process.env.SMUGAN_GATE_DIR;
  try {
    const paths = JSON.parse(
      readFileSync(join(HERE, '..', 'hooks', 'smugan.paths.json'), 'utf8').replace(BOM, ''),
    );
    // The install's UI language decides which language-specific checks run.
    if (process.env.SMUGAN_UI_LANG === undefined && typeof paths.uiLanguage === 'string') process.env.SMUGAN_UI_LANG = paths.uiLanguage;
    // The install's SMUGAN_DISABLE list keeps the gate's reminders off disabled reviewers.
    if (process.env.SMUGAN_DISABLE === undefined && Array.isArray(paths.disable)) process.env.SMUGAN_DISABLE = paths.disable.join(',');
    if (paths.gateDir && existsSync(paths.gateDir)) return paths.gateDir;
  } catch { /* smugan-ignore empty-catch: no paths file — fall back to the in-repo layout */ }
  // Running straight from the repo (adapters/opencode/opencode/bin/), not installed.
  const inRepo = join(HERE, '..', '..', '..', '..', 'packages', 'gate');
  return existsSync(inRepo) ? inRepo : null;
}

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = '';
    const done = () => resolvePromise(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    // Windows shells can swallow stdin EOF for spawned processes — never hang.
    setTimeout(done, 2000).unref();
  });
}

const ok = () => process.stdout.write(JSON.stringify({ exitCode: 0, stderr: '' }));

try {
  const raw = (await readStdin()).replace(BOM, '').trim();
  const { kind, input } = raw ? JSON.parse(raw) : {};
  const dir = kind && input ? gateDir() : null;
  if (!dir) {
    ok();
    process.exit(0);
  }
  const { runHook } = await import(pathToFileURL(join(dir, 'src', 'hook.mjs')).href);
  const { exitCode, stderr, context, warned } = await runHook(kind, input);
  // Warn mode's findings; the other context (hints) is Claude Code's alone.
  process.stdout.write(JSON.stringify({ exitCode, stderr, ...(warned && context ? { context } : {}) }));
  process.exit(0);
} catch {
  ok();
  process.exit(0);
}
