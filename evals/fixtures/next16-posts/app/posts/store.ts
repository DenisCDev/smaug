import { cacheTag } from 'next/cache';

export type Post = { id: string; title: string };

const posts: Post[] = [];

export function addPost(post: Post): void {
  posts.push(post);
}

export async function getPosts(): Promise<Post[]> {
  'use cache';
  cacheTag('posts');
  return [...posts];
}
