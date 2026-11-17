// @ts-check
// A server action that writes to the database but never revalidates ships a
// UI that lies: the mutation lands, every cached view keeps the old data.
// .rpc() counts as a write unless the function name says read (get_/list_/
// search_/count_/fetch_ prefixes) — a dynamic rpc name is never flagged.
import { stripCode } from '../strip.mjs';

const USE_SERVER_RE = /^\s*(['"])use server\1\s*;?\s*$/m;
const WRITE_RE = /\.from\s*\([^)]*\)\s*\.\s*(insert|update|upsert|delete)\s*\(/;
const RPC_RE = /\.rpc\s*\(/g;
const RPC_NAME_RE = /^\.rpc\s*\(\s*(['"`])([A-Za-z0-9_]+)\1/;
const READONLY_PREFIX_RE = /^(?:get|list|search|count|fetch)_/;
const REVALIDATE_RE = /\b(?:revalidatePath|revalidateTag|expirePath|expireTag)\s*\(/;
// Next 16's updateTag() and refresh() invalidate after a write, but both are
// ordinary names (a tag's own CRUD, a session refresh): they count only when
// the file imports them from next/cache — in code, not in a comment, on any
// of its import lines.
const NEXT_CACHE_IMPORT_RE = /\bimport\s*\{([^}]*)\}\s*from\s*['"]next\/cache['"]/g;
const NEXT_16_CALLS = /** @type {const} */ (['updateTag', 'refresh']);
const EXCLUDED_PATH_RE = /(^|\/)(scripts?|tests?|__tests__|e2e|bin)\/|\.(test|spec)\.|\.config\./;

export default {
  name: 'stale-mutation',
  /** @param {string} path */
  appliesTo(path) {
    return /\.(?:ts|tsx)$/.test(path) && !EXCLUDED_PATH_RE.test(path);
  },
  /** @param {{ content: string }} ctx */
  run({ content }) {
    if (!USE_SERVER_RE.test(content)) return [];
    const stripped = stripCode(content);
    if (REVALIDATE_RE.test(stripped)) return [];
    // Matched on the original text, where the module name survives; the names are
    // read from the stripped copy, so one commented out inside the braces drops.
    const fromNextCache = [...content.matchAll(NEXT_CACHE_IMPORT_RE)]
      .filter((m) => stripped[m.index] !== ' ')
      .map((m) => stripped.slice(m.index, m.index + m[0].length))
      .join(',');
    for (const name of NEXT_16_CALLS) {
      if (new RegExp(String.raw`\b${name}\b`).test(fromNextCache) && new RegExp(String.raw`(?<![\w$.])${name}\s*\(`).test(stripped)) return [];
    }

    const write = WRITE_RE.exec(stripped);
    if (write) {
      return [
        {
          line: stripped.slice(0, write.index).split('\n').length,
          message: `${write[1]}() in a server action with no revalidatePath()/revalidateTag() — the mutation lands but every cached view keeps showing stale data`,
        },
      ];
    }

    // stripCode preserves length, so the rpc name can be read from the
    // original content at the same offset (string contents are blanked in
    // the stripped copy).
    let m;
    while ((m = RPC_RE.exec(stripped)) !== null) {
      const name = RPC_NAME_RE.exec(content.slice(m.index))?.[2];
      if (!name || READONLY_PREFIX_RE.test(name)) continue;
      return [
        {
          line: stripped.slice(0, m.index).split('\n').length,
          message:
            `rpc("${name}") in a server action with no revalidatePath()/revalidateTag() — if it writes, revalidate the affected views; ` +
            'a read-only RPC can be suppressed with // smugan-ignore stale-mutation: <reason>',
        },
      ];
    }
    return [];
  },
};
