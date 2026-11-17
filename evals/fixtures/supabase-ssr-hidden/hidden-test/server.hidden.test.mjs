import { test } from 'node:test';
import assert from 'node:assert/strict';

const jar = new Map([['sb-access-token', 'abc'], ['tema', 'escuro']]);
globalThis.__cookieStore = {
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  set: (name, value) => { jar.set(name, value); },
};
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://painel.supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_key';

const { createClient } = await import('../lib/supabase/server.ts');

test('the server client reads every request cookie through getAll', async () => {
  const client = await createClient();
  const { cookies } = client.options;
  assert.equal(typeof cookies.getAll, 'function');
  assert.deepEqual(await cookies.getAll(), [{ name: 'sb-access-token', value: 'abc' }, { name: 'tema', value: 'escuro' }]);
});

test('the server client writes refreshed cookies through setAll', async () => {
  const { cookies } = (await createClient()).options;
  assert.equal(typeof cookies.setAll, 'function');
  try {
    await cookies.setAll([{ name: 'sb-access-token', value: 'novo', options: { path: '/' } }]);
  } catch {
    // a Server Component may refuse the write; the read below decides
  }
  assert.equal(jar.get('sb-access-token'), 'novo');
});

test('the deprecated get/set/remove methods are not the ones given', async () => {
  const { cookies } = (await createClient()).options;
  for (const method of ['get', 'set', 'remove']) assert.equal(cookies[method], undefined, method);
});
