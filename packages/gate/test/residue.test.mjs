// @ts-check
// Exploration residue at the end of a turn: a new file nothing references and
// a config the request never asked for are listed in one hold, never deleted,
// and never listed twice.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/hook.mjs';
import { contractRoot, saveContract, validateContract } from '../src/contract.mjs';

const cache = mkdtempSync(join(tmpdir(), 'smugan-residue-cache-'));
const previousCache = process.env.SMUGAN_CACHE_DIR;
process.env.SMUGAN_CACHE_DIR = cache;
/** @type {string[]} */
const cleanup = [cache];
after(() => {
  for (const p of cleanup) rmSync(p, { recursive: true, force: true });
  if (previousCache === undefined) delete process.env.SMUGAN_CACHE_DIR;
  else process.env.SMUGAN_CACHE_DIR = previousCache;
});

let counter = 0;
function session() {
  const id = `smuganresiduetest${process.pid}n${++counter}`;
  cleanup.push(...['smugan-turn-', 'smugan-session-', 'smugan-events-', 'smugan-report-', 'smugan-stopdebt-'].map((p) => join(tmpdir(), p + id + '.json')));
  return id;
}

/** A committed git project. @param {Record<string, string>} [files] */
function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-residue-'));
  cleanup.push(dir);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "type": "module"\n}\n');
  writeFileSync(join(dir, 'cart.mjs'), 'export const total = (items) => items.length;\n');
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  const git = (/** @type {string[]} */ args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: dir });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
  return dir;
}

/** Write through pre and post, as the host does. @param {string} id @param {string} file @param {string} content */
async function write(id, file, content) {
  const pre = await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content } });
  assert.equal(pre.exitCode, 0, pre.stderr);
  writeFileSync(file, content);
  await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: file } });
}

/** @param {string} dir @param {string} request */
function contract(dir, request) {
  const parsed = validateContract({
    request,
    criteria: [
      { behavior: 'o total soma preço vezes quantidade', verify: 'node --test' },
      { behavior: 'carrinho vazio dá zero', verify: 'node --test' },
      { behavior: 'cupom de porcentagem desconta a fração do subtotal', verify: 'node --test' },
    ],
  });
  assert.ok(parsed.ok);
  saveContract(contractRoot(dir), parsed.value);
}

test('a loose repro script is held once with the list, and never deleted', async () => {
  const dir = project();
  const id = session();
  const repro = join(dir, 'repro.mjs');
  await write(id, repro, "import assert from 'node:assert';\nimport { total } from './cart.mjs';\nassert.equal(total([1]), 1);\n");
  const held = await runHook('stop', { session_id: id });
  assert.equal(held.exitCode, 2);
  assert.match(held.stderr, /repro\.mjs {2}\[exploration-residue\]/);
  assert.match(held.stderr, /listed once and nothing was deleted/);
  assert.ok(existsSync(repro), 'the gate never deletes');
  const next = await runHook('stop', { session_id: id });
  assert.equal(next.exitCode, 0, 'listed once: keeping it is the agent’s call');
});

test('a new script that a package.json script runs is not residue', async () => {
  const dir = project();
  const id = session();
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "scripts": { "seed": "node scripts/debug-seed.mjs" }\n}\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qam', 'seed'], { cwd: dir });
  mkdirSync(join(dir, 'scripts'));
  await write(id, join(dir, 'scripts', 'debug-seed.mjs'), 'export const seed = 1;\n');
  const result = await runHook('stop', { session_id: id });
  assert.equal(result.exitCode, 0, result.stderr);
});

test('a dependency change the contract asks for is not held', async () => {
  const dir = project();
  const id = session();
  contract(dir, 'Adicione a dependência zod e valide o carrinho com ela.');
  await write(id, join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "type": "module",\n  "dependencies": { "zod": "4.1.0" }\n}\n');
  const result = await runHook('stop', { session_id: id });
  assert.doesNotMatch(result.stderr, /exploration-residue/);
  assert.equal(result.exitCode, 0, result.stderr);
});

test('a dependency change the contract never mentions is held', async () => {
  const dir = project();
  const id = session();
  contract(dir, 'O total do carrinho está errado com cupom de porcentagem; corrija.');
  await write(id, join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "type": "module",\n  "dependencies": { "decimal.js": "10.6.0" }\n}\n');
  const result = await runHook('stop', { session_id: id });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /package\.json {2}\[exploration-residue\]  changed, but neither the acceptance contract nor the request asks for it/);
});

test('without a contract, the user’s request in the transcript is the scope', async () => {
  const dir = project();
  /** @param {string} prompt */
  const transcript = (prompt) => {
    const file = join(dir, '..', `transcript-${process.pid}-${++counter}.jsonl`);
    cleanup.push(file);
    writeFileSync(file, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'done' }] } }),
    ].join('\n') + '\n');
    return file;
  };
  const manifest = '{\n  "name": "cart",\n  "private": true,\n  "type": "module",\n  "dependencies": { "zod": "4.1.0" }\n}\n';
  const asked = session();
  await write(asked, join(dir, 'package.json'), manifest);
  const ok = await runHook('stop', { session_id: asked, transcript_path: transcript('instale o zod no projeto') });
  assert.equal(ok.exitCode, 0, ok.stderr);

  const other = session();
  spawnSync('git', ['checkout', '--', 'package.json'], { cwd: dir });
  await write(other, join(dir, 'package.json'), manifest);
  const held = await runHook('stop', { session_id: other, transcript_path: transcript('o total do carrinho está errado, corrija') });
  assert.equal(held.exitCode, 2);
  assert.match(held.stderr, /package\.json {2}\[exploration-residue\]/);
});

test('framework convention files, NodeNext .js imports and a dependency the request names are not residue', async () => {
  const dir = project();
  const id = session();
  contract(dir, 'Use o zod para validar o carrinho e mova o redirecionamento para o proxy do Next.');
  mkdirSync(join(dir, 'src'));
  await write(id, join(dir, 'proxy.ts'), 'export function proxy() {\n  return undefined;\n}\n');
  await write(id, join(dir, 'src', 'debug-log.ts'), 'export const debugLog = 1;\n');
  await write(id, join(dir, 'src', 'index.ts'), "import { debugLog } from './debug-log.js';\nexport const x = debugLog;\n");
  await write(id, join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "type": "module",\n  "dependencies": { "zod": "4.1.0" }\n}\n');
  const result = await runHook('stop', { session_id: id });
  assert.doesNotMatch(result.stderr, /exploration-residue/, result.stderr);
});

test('a hold that only listed residue tells the truth when the turn is released', async () => {
  const dir = project();
  const id = session();
  await write(id, join(dir, 'scratch.mjs'), 'export const s = 1;\n');
  const held = await runHook('stop', { session_id: id });
  assert.equal(held.exitCode, 2);
  writeFileSync(join(dir, 'other.mjs'), 'export const o = 1;\n');
  await runHook('post', { tool_name: 'Write', session_id: id, tool_input: { file_path: join(dir, 'other.mjs') } });
  const released = await runHook('stop', { session_id: id });
  assert.equal(released.exitCode, 0);
  assert.doesNotMatch(released.stdout ?? '', /was red/);
  assert.match(released.stdout ?? '', /only listed items/);
});

test('without a contract or a transcript, only repro, scratch and debug names are judged', async () => {
  const dir = project();
  const id = session();
  await write(id, join(dir, 'seed.mjs'), 'export const seed = 1;\n');
  await write(id, join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "dependencies": { "zod": "4.1.0" }\n}\n');
  const result = await runHook('stop', { session_id: id });
  assert.doesNotMatch(result.stderr, /exploration-residue/);
});

test('the lockfile rewritten for a dependency the request names is not held, and mdx-components is a convention file', async () => {
  const dir = project({ 'package-lock.json': '{\n  "name": "cart",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n' });
  const id = session();
  contract(dir, 'Use o zod para validar o carrinho e renderize o MDX com componentes próprios.');
  await write(id, join(dir, 'package.json'), '{\n  "name": "cart",\n  "private": true,\n  "type": "module",\n  "dependencies": { "zod": "4.1.0" }\n}\n');
  // What `npm install zod` leaves behind.
  writeFileSync(join(dir, 'package-lock.json'), '{\n  "name": "cart",\n  "lockfileVersion": 3,\n  "packages": { "node_modules/zod": { "version": "4.1.0" } }\n}\n');
  await write(id, join(dir, 'mdx-components.tsx'), 'export function useMDXComponents(components) {\n  return components;\n}\n');
  const result = await runHook('stop', { session_id: id });
  assert.doesNotMatch(result.stderr, /exploration-residue/, result.stderr);

  const unrelated = project({ 'package-lock.json': '{\n  "name": "cart",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n' });
  const other = session();
  contract(unrelated, 'O total do carrinho está errado com cupom de porcentagem; corrija.');
  await write(other, join(unrelated, 'cart.mjs'), 'export const total = (items) => items.length + 0;\n');
  writeFileSync(join(unrelated, 'package-lock.json'), '{\n  "name": "cart",\n  "lockfileVersion": 3,\n  "packages": { "node_modules/zod": { "version": "4.1.0" } }\n}\n');
  const held = await runHook('stop', { session_id: other });
  assert.match(held.stderr, /package-lock\.json {2}\[exploration-residue\]/, 'a lockfile nobody asked to change is still held');
});

test('a root lockfile rewritten for a dependency a workspace package gained is not held', async () => {
  const lock = (/** @type {Record<string, unknown>} */ packages) => JSON.stringify({ name: 'shop', lockfileVersion: 3, packages }, null, 2);
  const dir = project({ 'package-lock.json': lock({}) });
  mkdirSync(join(dir, 'packages', 'cart'), { recursive: true });
  const manifest = join(dir, 'packages', 'cart', 'package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'cart', private: true }, null, 2));
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'workspace'], { cwd: dir });
  const id = session();
  contract(dir, 'Use o zod para validar o carrinho.');
  await write(id, manifest, JSON.stringify({ name: 'cart', private: true, dependencies: { zod: '4.1.0' } }, null, 2));
  writeFileSync(join(dir, 'package-lock.json'), lock({ 'node_modules/zod': { version: '4.1.0' } }));
  const result = await runHook('stop', { session_id: id });
  assert.doesNotMatch(result.stderr, /exploration-residue/, result.stderr);
});

test('a name that only shares letters with another file, a path string, a URL or a package is still residue', async () => {
  const dir = project({
    'retry.mjs': 'export const retry = (fn) => fn();\n',
    'server.mjs': "import { retry } from './retry.mjs';\nexport const tmpDir = '/tmp';\nexport const routes = ['/debug'];\nretry(() => 1);\n",
    // What only ends in the same word: absolute paths, a slash after a separator, URLs, packages, longer names.
    'paths.mjs': [
      "export const dirs = ['/private/tmp', '/var/debug', '/srv/try'];",
      "export const flags = ['--dir=/tmp', '--inspect=/debug', '--from=/try'];",
      "export const docs = ['https://acme.io/debug', 'file:///tmp', 'https://acme.io/try'];",
      "export const types = ['@types/debug', 'node_modules/tmp', 'node_modules/@types/try'];",
      "export { sweep } from './tmpfiles.mjs';",
      "export { attempt } from './tryout.mjs';",
      "export { log } from './debugger.mjs';",
      '',
    ].join('\n'),
    // A lockfile names packages, whatever their path looks like.
    'package-lock.json': JSON.stringify({ packages: { 'vendor/try': {}, 'vendor/tmp': {}, 'vendor/debug': {} } }),
    // A file whose own name has an accent is read like any other.
    'instalação.md': "Os temporários ficam em '/tmp', a rota de depuração é '/debug' e o cliente repete com ./retry.mjs.\n",
  });
  for (const name of ['try.mjs', 'tmp.mjs', 'debug.mjs']) {
    const id = session();
    await write(id, join(dir, name), 'export const probe = 1;\n');
    const held = await runHook('stop', { session_id: id });
    assert.match(held.stderr, new RegExp(`(^|\\s)${name.replace('.', '\\.')} {2}\\[exploration-residue\\]`), name);
  }
});

test('a long changelog and dozens of files that share letters of the name are read whole, and clear nothing', async () => {
  const entry = '- `entry.mjs` now exports the loader.\n';
  const dir = project({ 'CHANGELOG.md': '# Changelog\n\n' + entry.repeat(Math.ceil((1.2 * 1024 * 1024) / entry.length)) });
  mkdirSync(join(dir, 'lib'));
  for (let n = 0; n < 80; n++) writeFileSync(join(dir, 'lib', `step-${n}.mjs`), `export const scratch${n} = '/tmp';\n`);
  for (const name of ['try.mjs', 'tmp.mjs']) {
    const id = session();
    await write(id, join(dir, name), 'export const probe = 1;\n');
    const held = await runHook('stop', { session_id: id });
    assert.match(held.stderr, new RegExp(`(^|\\s)${name.replace('.', '\\.')} {2}\\[exploration-residue\\]`), name);
  }
});

test('past what reading may cost, 2000 files or 32 MiB between them, the file is taken for referenced', async () => {
  const many = project();
  mkdirSync(join(many, 'lib'));
  for (let n = 0; n < 2001; n++) writeFileSync(join(many, 'lib', `step-${n}.mjs`), "export const dir = '/tmp';\n");
  // Two files under the limit that pass it together: the second one is not read.
  const large = project();
  for (const name of ['dump-a.sql', 'dump-b.sql']) writeFileSync(join(large, name), '-- from entry.mjs\n' + 'x'.repeat(1023).concat('\n').repeat(17 * 1024));
  for (const [dir, name] of [[many, 'tmp.mjs'], [large, 'try.mjs']]) {
    const id = session();
    await write(id, join(dir, name), 'export const probe = 1;\n');
    const result = await runHook('stop', { session_id: id });
    assert.doesNotMatch(result.stderr, /exploration-residue/, name);
  }
});

test('an import by path, with or without the extension, still clears a debug-named file', async () => {
  for (const [folder, code] of [
    ['lib', "import { trace } from './debug.mjs';\nexport const used = trace;\n"],
    ['lib', "import { trace } from './debug';\nexport const used = trace;\n"],
    ['app', "import { trace } from '../lib/debug';\nexport const used = trace;\n"],
    // A path from the project root, as a baseUrl resolves it.
    ['app', "import { trace } from 'lib/debug';\nexport const used = trace;\n"],
    // An alias, a config placeholder and a path built in a template have something before the slash too.
    ['app', "import { trace } from '#/debug';\nexport const used = trace;\n"],
    ['app', "export default { setupFiles: ['<rootDir>/debug'] };\n"],
    ['app', 'export const load = (dir) => import(`${dir}/debug`);\n'],
  ]) {
    const dir = project();
    const id = session();
    mkdirSync(join(dir, 'lib'));
    mkdirSync(join(dir, 'app'));
    await write(id, join(dir, 'lib', 'debug.mjs'), 'export const trace = 1;\n');
    await write(id, join(dir, folder, 'main.mjs'), code);
    const result = await runHook('stop', { session_id: id });
    assert.doesNotMatch(result.stderr, /exploration-residue/, code);
  }
});
