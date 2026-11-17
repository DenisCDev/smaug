// @ts-check
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { plainPath } from './context-io.mjs';

export const OWNER = 'smugan-context-v1\n';
/** @param {string} directory */
export function ownedDirectory(directory) {
  try {
    const marker = join(directory, '.owner');
    return !lstatSync(directory).isSymbolicLink() && !lstatSync(marker).isSymbolicLink()
      && lstatSync(marker).size === OWNER.length && readFileSync(marker, 'utf8') === OWNER;
  } catch { return false; } // An unreadable marker grants no ownership.
}

/** Skip only generated artifacts, never application files in a colliding directory.
 * @param {string} root @param {string} path */
export function isContextArtifact(root, path) {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!/^\.smugan\.local\/(?:\.owner|context\.json(?:\.[\da-f-]+\.tmp)?|context\.json\.lock(?:\/.*)?)$/.test(rel)) return false;
  const directory = join(root, '.smugan.local');
  return existsSync(directory) && plainPath(root, resolve(root, rel)) && ownedDirectory(directory);
}
