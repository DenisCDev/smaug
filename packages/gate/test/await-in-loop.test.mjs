// @ts-check
// An awaited database call or fetch inside a loop, judged only in a critical
// turn and only when the edit adds it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import check from '../src/checks/await-in-loop.mjs';
import { runHook } from '../src/hook.mjs';

const lines = (/** @type {string} */ content) => check.run({ content }).map((f) => f.line);

test('a database call awaited per item of a loop or a map callback is N+1', () => {
  assert.deepEqual(lines('for (const inv of invoices) {\n  inv.items = await db.items.findMany({ where: { invoiceId: inv.id } });\n}\n'), [2]);
  assert.deepEqual(lines('const out = await Promise.all(invoices.map(async (inv) => ({\n  ...inv,\n  items: await prisma.item.findMany({ where: { invoiceId: inv.id } }),\n})));\n'), [3]);
  assert.deepEqual(lines("for (let i = 0; i < ids.length; i++) {\n  const { data } = await supabase.from('items').select('*').eq('id', ids[i]);\n}\n"), [2]);
  assert.deepEqual(lines('ids.forEach(async (id) => {\n  await fetch(`/api/${id}`);\n});\n'), [2]);
});

test('retry, polling and pagination loops, and storage transfers, repeat one call by design', () => {
  assert.deepEqual(lines('for (let attempt = 0; attempt < 3; attempt++) {\n  res = await fetch(url);\n  if (res.ok) break;\n}\n'), []);
  assert.deepEqual(lines('while (!done) {\n  done = (await fetch(statusUrl).then((r) => r.json())).done;\n}\nfor (;;) {\n  const { rows } = await db.query(sql, [cursor]);\n  if (!rows.length) break;\n}\n'), []);
  assert.deepEqual(lines("for (const file of files) {\n  await supabase.storage.from('pages').upload(file.name, file);\n}\n"), []);
  assert.deepEqual(lines('for (const part of parts) {\n  chunks.push(await fetch(part.url, { signal }));\n}\n'), [], 'a sequential download is deliberate');
});

test('concurrent fetch fan-out, streams, one query and other awaits are not', () => {
  assert.deepEqual(lines('await Promise.all(urls.map(async (u) => (await fetch(u)).json()));\n'), []);
  assert.deepEqual(lines('for await (const chunk of stream) {\n  await db.chunks.create({ data: chunk });\n}\n'), []);
  assert.deepEqual(lines('const rows = await db.items.findMany({ where: { invoiceId: { in: ids } } });\nfor (const r of rows) total += r.price;\n'), []);
  assert.deepEqual(lines('for (const attempt of [1, 2, 3]) {\n  await sleep(attempt * 100);\n}\n'), []);
});

/** @type {string[]} */
const cleanup = [];
after(() => { for (const p of cleanup) rmSync(p, { recursive: true, force: true }); });

let counter = 0;
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-n1-'));
  cleanup.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"name":"shop","private":true}');
  mkdirSync(join(dir, 'src', 'billing'), { recursive: true });
  const id = `smugann1test${process.pid}n${++counter}`;
  cleanup.push(...['smugan-turn-', 'smugan-session-', 'smugan-events-'].map((p) => join(tmpdir(), p + id + '.json')));
  return { dir, id };
}
const LOOP = "import { db } from '../db.mjs';\nexport async function listInvoices(customerId) {\n  const invoices = await db.invoices.findMany({ where: { customerId } });\n  for (const inv of invoices) inv.items = await db.items.findMany({ where: { invoiceId: inv.id } });\n  return invoices;\n}\n";

test('a critical file that gains an N+1 is blocked; an ordinary turn never runs the check', async () => {
  const { dir, id } = setup();
  const blocked = await runHook('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: join(dir, 'src', 'billing', 'invoices.mjs'), content: LOOP } });
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.stderr, /line 4 {2}\[await-in-loop\] {2}awaited database call inside a loop runs one query per item \(N\+1\)/);
  const other = setup();
  const ordinary = await runHook('pre', { tool_name: 'Write', session_id: other.id, tool_input: { file_path: join(other.dir, 'src', 'report.mjs'), content: LOOP } });
  assert.equal(ordinary.exitCode, 0, ordinary.stderr);
});

test('a loop that was already there, or one with a reason, does not block', async () => {
  const { dir, id } = setup();
  const file = join(dir, 'src', 'billing', 'invoices.mjs');
  writeFileSync(file, LOOP);
  const edit = await runHook('pre', { tool_name: 'Edit', session_id: id, tool_input: { file_path: file, old_string: '  return invoices;', new_string: '  return invoices.slice(0, 50);' } });
  assert.equal(edit.exitCode, 0, edit.stderr);
  const reasoned = LOOP.replace('  for (const inv', '  // smugan-ignore await-in-loop: at most 3 invoices per customer\n  for (const inv');
  const fresh = setup();
  const result = await runHook('pre', { tool_name: 'Write', session_id: fresh.id, tool_input: { file_path: join(fresh.dir, 'src', 'billing', 'invoices.mjs'), content: reasoned } });
  assert.equal(result.exitCode, 0, result.stderr);
});

test('an SDK client in a loop is not a query; client.query still is', () => {
  assert.deepEqual(lines('for (const doc of docs) {\n  out.push(await client.messages.create({ model, messages: [doc] }));\n  await client.send(new PutObjectCommand(doc));\n}\n'), []);
  assert.deepEqual(lines('for (const id of ids) {\n  rows.push(await client.query("select 1 where id = $1", [id]));\n}\n'), [2]);
});
