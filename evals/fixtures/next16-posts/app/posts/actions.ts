'use server';

import { addPost, type Post } from './store';

export async function savePost(post: Post): Promise<void> {
  addPost(post);
}
