// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'stale-mutation';

const INSERT_ACTION = `'use server';
import { createClient } from '@/lib/supabase/server';
export async function addClient(data: FormData) {
  const supabase = await createClient();
  await supabase.from('clients').insert({ full_name: data.get('name') });
}`;

test('server action that inserts without revalidating is flagged', () => {
  const v = ofRule(run('src/app/clients/actions.ts', INSERT_ACTION), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 5);
});

test('revalidatePath after the write passes', () => {
  const code = `${INSERT_ACTION}\nimport { revalidatePath } from 'next/cache';\nrevalidatePath('/clients');`;
  assert.equal(ofRule(run('src/app/clients/actions.ts', code), R).length, 0);
});

test('revalidateTag and expirePath/expireTag also count as revalidation', () => {
  for (const call of ["revalidateTag('clients')", "expirePath('/clients')", "expireTag('clients')"]) {
    const code = `${INSERT_ACTION}\n${call};`;
    assert.equal(ofRule(run('src/app/a.ts', code), R).length, 0, call);
  }
});

/** @param {string} imports @param {string} call */
const withImport = (imports, call) => `${INSERT_ACTION.replace("'use server';", `'use server';\n${imports}`)}\n${call};`;

test("Next 16's updateTag() and refresh() from next/cache count as revalidation", () => {
  const updated = withImport("import { updateTag } from 'next/cache';", "updateTag('clients')");
  const refreshed = withImport("import { revalidatePath, refresh } from 'next/cache';", 'refresh()');
  const secondLine = withImport("import { unstable_cache } from 'next/cache';\nimport { updateTag } from 'next/cache';", "updateTag('clients')");
  assert.equal(ofRule(run('src/app/a.ts', updated), R).length, 0);
  assert.equal(ofRule(run('src/app/a.ts', refreshed), R).length, 0);
  assert.equal(ofRule(run('src/app/a.ts', secondLine), R).length, 0);
});

test('an updateTag() or refresh() that does not come from next/cache is not revalidation', () => {
  for (const code of [
    withImport("import { refresh } from './session';", 'refresh()'),
    withImport("import { updateTag } from '@/lib/tags-repo';", "await updateTag(id, 'news')"),
    withImport("// import { updateTag } from 'next/cache';\nimport { updateTag } from '@/lib/tags-repo';", "await updateTag(id, 'news')"),
    withImport("import {\n  unstable_cache,\n  // updateTag, -- clashes with our own helper\n} from 'next/cache';", "await updateTag(id, 'news')"),
    `${INSERT_ACTION}\nexport async function updateTag(id: string) { await supabase.from('tags').update({ id }); }`,
  ]) {
    assert.equal(ofRule(run('src/app/a.ts', code), R).length, 1, code);
  }
});

test('update and delete chains are flagged too', () => {
  const upd = `'use server';\nawait db.from('clients').update({ name }).eq('id', id);`;
  const del = `'use server';\nawait db.from('clients').delete().eq('id', id);`;
  assert.equal(ofRule(run('src/app/a.ts', upd), R).length, 1);
  assert.equal(ofRule(run('src/app/a.ts', del), R).length, 1);
});

test('multi-line chains are still caught', () => {
  const code = `'use server';
await supabase
  .from('appointments')
  .upsert({ id, status });`;
  const v = ofRule(run('src/app/a.ts', code), R);
  assert.equal(v.length, 1);
});

test('read-only server action passes', () => {
  const code = `'use server';\nconst { data } = await db.from('clients').select('*');`;
  assert.equal(ofRule(run('src/app/a.ts', code), R).length, 0);
});

test('db write without a use server directive is ignored', () => {
  const code = `await db.from('clients').insert({ a: 1 });`;
  assert.equal(ofRule(run('src/lib/db.ts', code), R).length, 0);
});

test('inline use server directive inside a function body counts', () => {
  const code = `export async function save(data: FormData) {
  'use server';
  await db.from('clients').insert({ a: 1 });
}`;
  assert.equal(ofRule(run('src/app/page.tsx', code), R).length, 1);
});

test("'use server' mentioned in a normal string does not trigger", () => {
  const code = `const directive = 'use server';\nawait db.from('clients').insert({ a: 1 });`;
  assert.equal(ofRule(run('src/lib/meta.ts', code), R).length, 0);
});

test('one finding per file even with several writes', () => {
  const code = `'use server';
await db.from('clients').insert({ a: 1 });
await db.from('clients').update({ a: 2 }).eq('id', 1);`;
  assert.equal(ofRule(run('src/app/a.ts', code), R).length, 1);
});

test('tests, scripts and non-TS files are excluded', () => {
  const code = `'use server';\nawait db.from('x').insert({ a: 1 });`;
  assert.equal(ofRule(run('src/app/a.test.ts', code), R).length, 0);
  assert.equal(ofRule(run('scripts/seed.ts', code), R).length, 0);
  assert.equal(ofRule(run('src/app/a.js', code), R).length, 0);
});

test('rpc call in a server action without revalidation is flagged', () => {
  const code = `'use server';\nawait supabase.rpc('increment_balance', { delta });`;
  const v = ofRule(run('src/app/a.ts', code), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /rpc\("increment_balance"\)/);
  assert.match(v[0].message, /smugan-ignore stale-mutation/);
});

test('read-only rpc prefixes are exempt', () => {
  for (const name of ['get_stats', 'list_clients', 'search_products', 'count_orders', 'fetch_profile']) {
    const code = `'use server';\nconst { data } = await supabase.rpc('${name}');`;
    assert.equal(ofRule(run('src/app/a.ts', code), R).length, 0, name);
  }
});

test('rpc with a dynamic name is never flagged', () => {
  const code = `'use server';\nawait supabase.rpc(fnName, args);`;
  assert.equal(ofRule(run('src/app/a.ts', code), R).length, 0);
});

test('rpc followed by revalidation passes', () => {
  const code = `'use server';\nawait supabase.rpc('increment_balance', { delta });\nrevalidatePath('/wallet');`;
  assert.equal(ofRule(run('src/app/a.ts', code), R).length, 0);
});

test('smugan-ignore suppresses with a written reason', () => {
  const code = `'use server';
// smugan-ignore stale-mutation: revalidation happens in the shared helper below
await db.from('clients').insert({ a: 1 });`;
  assert.equal(ofRule(run('src/app/a.ts', code), R).length, 0);
});
