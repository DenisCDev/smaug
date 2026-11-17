// @ts-check
// The index of the docs the installed versions ship, and the signatures of
// what a file imports: built from node_modules only, capped near 2k tokens,
// and given to the model once per session and package, on the first edit of a
// file a stack rule covers.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { docsIndex, MAX_INDEX_CHARS } from '../src/docs-index.mjs';
import { runHook } from '../src/hook.mjs';
import { runContext } from '../src/context.mjs';

/** @type {string[]} */
const cleanup = [];
after(() => { for (const p of cleanup) rmSync(p, { recursive: true, force: true }); });

/** @param {string} root @param {Record<string, string>} files */
function put(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

function nextProject() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-docs-'));
  cleanup.push(dir);
  put(dir, {
    'package.json': JSON.stringify({ name: 'blog', private: true, dependencies: { next: '16.2.0', 'no-docs': '1.0.0' } }),
    'node_modules/next/package.json': JSON.stringify({ name: 'next', version: '16.2.0' }),
    'node_modules/next/dist/docs/01-app/01-getting-started/01-installation.mdx': '# Installation\n',
    'node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.mdx': '# updateTag\n',
    'node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.mdx': '# revalidateTag\n',
    'node_modules/next/cache.d.ts': [
      "export { unstable_cache } from './dist/server/unstable-cache';",
      '/** Expires the tag and reads fresh data in the same request. */',
      'export declare function updateTag(tag: string): void;',
      "export declare function revalidateTag(tag: string, profile: 'max' | { expire?: number }): undefined;",
      '',
    ].join('\n'),
    'node_modules/next/dist/server/unstable-cache.d.ts': 'export declare function unstable_cache<T>(cb: T, keyParts?: string[]): T;\n',
    'node_modules/no-docs/package.json': JSON.stringify({ name: 'no-docs', version: '1.0.0' }),
  });
  return dir;
}

test('the index lists the shipped doc files and the signatures of the imported module, imported names first', () => {
  const dir = nextProject();
  const index = docsIndex(dir, dir, "import { revalidateTag } from 'next/cache';\n", join(dir, 'app'));
  assert.ok(index);
  assert.deepEqual(index.sources.map((s) => [s.name, s.version]), [['next', '16.2.0']]);
  const text = index.text;
  assert.match(text, /Prefer what these docs say over what you remember about the version\./);
  assert.match(text, /Docs of next@16\.2\.0 in node_modules\/next\/dist\/docs\//);
  assert.match(text, /01-app\/03-api-reference\/04-functions\/: revalidateTag\.mdx, updateTag\.mdx/);
  const signatures = text.slice(text.indexOf('next/cache'));
  assert.ok(signatures.indexOf('revalidateTag(') < signatures.indexOf('updateTag('), 'the imported name comes first');
  assert.match(text, /export declare function updateTag\(tag: string\): void;/);
  assert.match(text, /export declare function unstable_cache<T>\(cb: T, keyParts\?: string\[\]\): T;/, 'a re-export is followed to its declaration');
  assert.doesNotMatch(text, /Expires the tag/, 'doc comments are not copied');
  assert.doesNotMatch(text, /# updateTag/, 'doc bodies are never copied');
});

test('a package with thousands of doc files stays within the ~2k-token cap and says where the rest is', () => {
  const dir = nextProject();
  /** @type {Record<string, string>} */
  const many = {};
  for (let i = 0; i < 400; i++) for (let j = 0; j < 8; j++) many[`node_modules/next/dist/docs/section-${String(i).padStart(3, '0')}/page-with-a-long-name-${j}.mdx`] = '#\n';
  put(dir, many);
  const index = docsIndex(dir, dir);
  assert.ok(index);
  assert.ok(index.text.length <= MAX_INDEX_CHARS, `${index.text.length} chars`);
  assert.match(index.text, /more files not listed: list node_modules\/next\/dist\/docs\//);
});

test('a project with no shipped docs and no typed imports has no index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-docs-'));
  cleanup.push(dir);
  put(dir, { 'package.json': '{"name":"plain","private":true}' });
  assert.equal(docsIndex(dir, dir, "import x from 'missing';\n"), null);
});

let counter = 0;
const session = () => {
  const id = `smugandocstest${process.pid}n${++counter}`;
  cleanup.push(...['smugan-turn-', 'smugan-session-', 'smugan-events-'].map((p) => join(tmpdir(), p + id + '.json')));
  return id;
};
/** @param {string} sessionId @param {string} file @param {string} content */
const write = (sessionId, file, content) => runHook('pre', { tool_name: 'Write', session_id: sessionId, tool_input: { file_path: file, content } });

test('the first edit of a stack-rule file gets the index once per session and package', async () => {
  const dir = nextProject();
  const id = session();
  const first = await write(id, join(dir, 'app', 'posts', 'actions.ts'), "import { revalidateTag } from 'next/cache';\nexport const save = () => revalidateTag('posts', 'max');\n");
  assert.equal(first.exitCode, 0, first.stderr);
  assert.match(first.context ?? '', /Prefer what these docs say/);
  assert.match(first.context ?? '', /updateTag\(tag: string\)/);
  const second = await write(id, join(dir, 'app', 'page.tsx'), "import { updateTag } from 'next/cache';\nexport default function Page() { updateTag('x'); return null; }\n");
  assert.doesNotMatch(second.context ?? '', /Prefer what these docs say/, 'once per session and package');
});

test('a file no stack rule covers gets no index', async () => {
  const dir = nextProject();
  const result = await write(session(), join(dir, 'lib', 'format.mjs'), "import { updateTag } from 'next/cache';\nexport const a = () => updateTag('x');\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(result.context ?? '', /Prefer what these docs say/);
});

test('smugan context --json reports the docs of the installed versions and the file imports', () => {
  const dir = nextProject();
  put(dir, { 'app/posts/actions.ts': "import { revalidateTag } from 'next/cache';\n" });
  const out = JSON.parse(runContext([join(dir, 'app', 'posts', 'actions.ts'), '--json', '--no-cache']));
  assert.deepEqual(out.docs.map((/** @type {any} */ d) => d.sources), [[{ name: 'next', version: '16.2.0', dir: 'node_modules/next/dist/docs', files: 3 }]]);
  assert.match(out.docs[0].index, /revalidateTag\(tag: string, profile: 'max'/);
});

test('a declaration file with a comment inside its export list, and a manifest with a byte order mark, are read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-docs-'));
  cleanup.push(dir);
  put(dir, {
    // PowerShell 5.1 writes the mark; Node's own JSON loading accepts it.
    'package.json': String.fromCharCode(0xfeff) + JSON.stringify({ name: 'app', private: true, dependencies: { lib: '1.0.0' } }),
    'node_modules/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', types: 'index.d.ts' }),
    'node_modules/lib/docs/guide.md': '# Guide\n',
    // What tsc --declaration emits for a commented export.
    'node_modules/lib/index.d.ts': 'declare function parse(input: string): number;\ndeclare function format(value: number): string;\nexport { parse, \n/** @deprecated use formatAsync */\nformat, };\n',
  });
  const index = docsIndex(dir, dir, "import { parse } from 'lib';\n", join(dir, 'src'));
  assert.ok(index);
  assert.deepEqual(index.sources.map((s) => s.name), ['lib'], 'the dependency declared in the manifest with the mark');
  assert.match(index.text, /declare function parse\(input: string\): number/);
});
