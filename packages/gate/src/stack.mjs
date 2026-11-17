// @ts-check
// What the project itself declares, so checks and scaffolding that only make
// sense on one stack (Supabase RLS, Playwright, Sentry for Next) stay off
// where that stack is absent instead of demanding it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// Keyed by root and package.json mtime: the OpenCode plugin is long-lived.
/** @type {Map<string, { stamp: number, names: Set<string> }>} */
const cache = new Map();

/** Dependency names declared in the root package.json. @param {string} root */
export function declaredDeps(root) {
  const file = join(root, 'package.json');
  const stamp = existsSync(file) ? statSync(file).mtimeMs : -1;
  const cached = cache.get(root);
  if (cached?.stamp === stamp) return cached.names;
  /** @type {Set<string>} */
  const names = new Set();
  if (stamp !== -1) {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        if (pkg?.[field] && typeof pkg[field] === 'object') for (const name of Object.keys(pkg[field])) names.add(name);
      }
    } catch (error) {
      // A broken package.json declares nothing; the project's own tooling reports it.
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  cache.set(root, { stamp, names });
  return names;
}

/** @param {string} root */
export function isSupabaseProject(root) {
  if (existsSync(join(root, 'supabase', 'config.toml'))) return true;
  return [...declaredDeps(root)].some((name) => name === 'supabase' || name.startsWith('@supabase/'));
}

/**
 * Supabase for one file: a supabase/migrations path is the Supabase CLI's own
 * layout, and in a monorepo the evidence may sit in the file's package rather
 * than at the root, so every folder from the file up to the root counts.
 * @param {string} root @param {string} relPath forward-slash, relative to root
 */
export function isSupabaseAt(root, relPath) {
  if (/(^|\/)supabase\/migrations?\//.test(relPath)) return true;
  const top = resolve(root);
  for (let dir = dirname(resolve(top, relPath)); ; dir = dirname(dir)) {
    if (isSupabaseProject(dir)) return true;
    if (dir === top || relative(top, dir).startsWith('..') || dirname(dir) === dir) return false;
  }
}
