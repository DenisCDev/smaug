import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNote } from '../src/auth/notes.ts';

const db = { notes: [{ id: 'n1', ownerId: 'u1', body: 'mercado' }] };

test('the owner opens their note', () => {
  assert.equal(getNote(db, 'u1', 'n1')?.body, 'mercado');
});

test('another user and an unknown id get nothing', () => {
  assert.equal(getNote(db, 'u2', 'n1'), null);
  assert.equal(getNote(db, 'u1', 'nx'), null);
});
