import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'next/cache';

const calls = () => globalThis.__nextCacheCalls;

test('saving a post expires the posts tag so the author reads the new list in the same request', async () => {
  const { savePost } = await import('../app/posts/actions.ts');
  calls().length = 0;
  await savePost({ id: '1', title: 'Olá' });
  const immediate = calls().some(([fn, tag, profile]) =>
    tag === 'posts' && (fn === 'updateTag' || (fn === 'revalidateTag' && profile && typeof profile === 'object' && profile.expire === 0)));
  assert.ok(immediate, `expected updateTag('posts'); got ${JSON.stringify(calls())}`);
});

test('no call uses the single-argument revalidateTag that Next 16 deprecated', async () => {
  const { savePost } = await import('../app/posts/actions.ts');
  calls().length = 0;
  await savePost({ id: '2', title: 'Outro' });
  assert.ok(!calls().some(([fn, , profile]) => fn === 'revalidateTag' && profile === undefined), JSON.stringify(calls()));
});
