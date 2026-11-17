// smugan-opencode configuration. Defaults live here; a user file at
// <config>/smugan.opencode.json (written by the installer) overrides them, and
// env vars override that for one-off debugging.
// Resolved relative to this module, so it works both in the repo checkout
// (opencode/smugan/ → opencode/) and installed (<config>/smugan/ → <config>/).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
const BOM = /^\uFEFF/;

export const DEFAULTS = {
  gate: { enabled: true },
  rules: { enabled: true, maxPerInjection: 2 },
  // One end-of-turn check may spend the gate's 120 s on the typecheck and
  // another 120 s on the tests: the wait covers both, as Claude Code's 300 s does.
  dod: { enabled: true, timeoutMs: 300000 },
  // layer A: only a red Definition of Done resumes the session.
  // layer B: A, plus turns that ended with no sign of completion.
  // maxPerSession is the terminal one: after it, only a message from the user
  // restarts the machinery. A rate limit alone is not enough — spread over
  // time it still means "forever", and this runs unattended on a free quota.
  continue: { layer: 'B', maxSameReason: 3, maxPerSession: 5, throttleMs: 5000 },
  // Works around the hardcoded title-agent model (opencode issue #31042): point
  // it at a different free model so it stops burning the main model's quota.
  smallModel: 'opencode/big-pickle',
};

function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === null || value === undefined) continue;
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key] ?? {}, value)
      : value;
  }
  return out;
}

export function loadConfig() {
  let cfg = DEFAULTS;
  try {
    const file = join(ROOT, 'smugan.opencode.json');
    if (existsSync(file)) cfg = merge(DEFAULTS, JSON.parse(readFileSync(file, 'utf8').replace(BOM, '')));
  } catch { /* smugan-ignore empty-catch: a malformed user config must not disable the layer — defaults stand */ }

  if (process.env.SMUGAN_OC_DISABLE === '1') {
    cfg = merge(cfg, { gate: { enabled: false }, rules: { enabled: false }, dod: { enabled: false } });
  }
  const layer = process.env.SMUGAN_OC_LAYER;
  if (layer === 'A' || layer === 'B') cfg = merge(cfg, { continue: { layer } });
  else if (layer === 'off') cfg = merge(cfg, { dod: { enabled: false } });
  if (process.env.SMUGAN_TEACH === '0') cfg = merge(cfg, { rules: { enabled: false } });
  return cfg;
}
