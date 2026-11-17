// @ts-check
// Three levels, decided by the hook from the path, never by the model, so a
// session cannot talk its own change down: critical where a defect is
// expensive (data, money, access, secrets, supply chain), trivial where a
// change cannot alter behavior (styles, assets, translations, prose), normal
// for the rest. A turn takes the highest level of its files. Over-inclusion
// costs an extra Stop hold or a test run; under-inclusion costs a missed
// review, so a critical match on any segment is enough.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkoutStateFile, contractRoot } from './contract.mjs';
import { hasCode, withFileLock, writeAtomicJson } from './file-state.mjs';

// Names match as whole words of the path: segment, file name or a camelCase
// part, so `withAuth.ts` and `(auth)/` count and `author.ts` does not.
const B = String.raw`[\/._()\[\]-]`;
const word = (/** @type {string} */ names) => new RegExp(`(?:^|${B})(?:${names})(?:${B}|$)`);

/** @type {[RegExp, string][]} */
const CRITICAL_PATHS = [
  [/(?:^|\/)migrations?\//, 'migration'],
  [/\.sql$/, 'SQL'],
  [/(?:^|\/)(?:middleware|proxy)(?:\.[cm]?[jt]sx?$|\/)/, 'request middleware'],
  [word('auth(?:n|z|entication|enticate[ds]?|enticator|orization|orize[ds]?|orizer)?|oauth2?|session|sessions|login|logout|signin|sign-in|signup|sign-up'
    + '|password|passwords|credential|credentials|jwt|token|tokens|permission|permissions|role|roles|rbac|acl|guard|guards|policy|policies'), 'auth or permissions'],
  [word('payment|payments|billing|checkout|stripe|invoice|invoices|subscription|subscriptions|webhook|webhooks'), 'payments or webhooks'],
  [/(?:^|\/)(?:\.env(?:\.[\w.-]+)?|env\.[cm]?[jt]s|secrets?(?:\.[\w-]+)*)$/, 'secrets or env'],
  [/(?:^|\/)(?:package\.json|cargo\.toml)$/, 'dependencies'],
];

const PROSE_RE = /\.(?:md|markdown|txt|rst|adoc)$/i;
const RUST_UNSAFE_RE = /\bunsafe\s*(?:\{|fn\b|impl\b|trait\b|extern\b)/;

/**
 * Why a file is critical, or null when it is not. Prose never is: editing it
 * changes no behavior.
 * @param {string} rel forward-slash path relative to the project root
 * @param {string | null} [content] the file's content, when known
 * @returns {string | null}
 */
export function criticalReason(rel, content = null) {
  if (PROSE_RE.test(rel)) return null;
  // An acronym ends where the next word starts: JWTService is jwt-service, while OAuth stays oauth.
  const path = rel.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  for (const [pattern, reason] of CRITICAL_PATHS) if (pattern.test(path)) return reason;
  if (content !== null && path.endsWith('.rs') && RUST_UNSAFE_RE.test(content)) return 'Rust unsafe';
  return null;
}

/** @typedef {'trivial' | 'normal' | 'critical'} Level */
/** @type {Level[]} */
export const LEVELS = ['trivial', 'normal', 'critical'];

// Files that cannot change what the code does: prose, styles, images and
// fonts, translation catalogs and editor or ignore files.
const TRIVIAL_RE = new RegExp([
  String.raw`\.(?:md|markdown|txt|rst|adoc)$`,
  String.raw`\.(?:css|scss|sass|less|styl|pcss)$`,
  String.raw`\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot)$`,
  String.raw`\.(?:po|pot)$`,
  String.raw`(?:^|/)(?:locales?|i18n|lang|translations|messages)/(?:[^/]+/)*[^/]+\.(?:json|ya?ml)$`,
  String.raw`(?:^|/)(?:\.editorconfig|\.prettierrc(?:\.(?:json|ya?ml))?|\.prettierignore|\.gitignore|\.gitattributes)$`,
].join('|'), 'i');

const fwd = (/** @type {string} */ p) => p.replace(/\\/g, '/');

/** @param {string} rel @param {string | null} [content] @returns {Level} */
export function fileLevel(rel, content = null) {
  if (criticalReason(rel, content)) return 'critical';
  return TRIVIAL_RE.test(rel) ? 'trivial' : 'normal';
}

/** @param {Level} a @param {Level} b */
export const higher = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

// --- the user's override: `smugan risk <level>` for one checkout, for a while ---

const OVERRIDE_HOURS = 8;

/** @param {string} root checkout root */
const overrideFile = (root) => checkoutStateFile('risk', root);

/**
 * The level the user forced for the checkout that holds `dir`, or null. Edits
 * call this on every write, so without any override on disk it costs one
 * directory check, not a git call.
 * @param {string} dir @param {Date} [now]
 * @returns {{ level: Level, expiresAt: string, root: string } | null}
 */
export function riskOverride(dir, now = new Date()) {
  const folder = dirname(overrideFile(dir));
  let names;
  try {
    names = readdirSync(folder);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  // Expired overrides are deleted here, so a past `smugan risk` stops costing
  // a git call per edit once it lapses.
  let live = 0;
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const path = join(folder, name);
    /** @type {any} JSON written by runRisk; checked field by field */
    let entry = null;
    try {
      entry = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      if (!hasCode(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error;
    }
    const lapsed = !entry || typeof entry.expiresAt !== 'string' || Date.parse(entry.expiresAt) <= now.getTime();
    if (lapsed) rmSync(path, { force: true });
    else if (LEVELS.includes(entry.level)) live++;
  }
  if (live === 0) return null;
  const root = contractRoot(dir);
  const file = overrideFile(root);
  /** @type {any} JSON written by setRiskOverride; checked field by field */
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (hasCode(error, 'ENOENT') || error instanceof SyntaxError) return null;
    throw error;
  }
  if (!LEVELS.includes(data?.level) || typeof data.expiresAt !== 'string' || Date.parse(data.expiresAt) <= now.getTime()) return null;
  return { level: data.level, expiresAt: data.expiresAt, root };
}

/** Whether the user cleared the checkout's forced level with `smugan risk auto`. @param {string} root checkout root */
export function riskCleared(root) {
  try {
    return JSON.parse(readFileSync(overrideFile(root), 'utf8'))?.level === 'auto';
  } catch (error) {
    if (hasCode(error, 'ENOENT') || error instanceof SyntaxError) return false;
    throw error;
  }
}

/** `smugan risk [trivial|normal|critical|auto] [dir]` @param {string[]} args */
export function runRisk(args) {
  const usage = 'Usage: smugan risk [trivial|normal|critical|auto] [dir]';
  const [first, second] = args;
  const word = first?.toLowerCase();
  const level = word && (LEVELS.includes(/** @type {Level} */ (word)) || word === 'auto') ? word : null;
  // A word that is neither a level nor an existing folder is a mistyped
  // level ("crítico", "critica"), never a folder to report on.
  if (first && !level && (args.length > 1 || first.startsWith('-') || !existsSync(first))) {
    throw new Error(`unknown level "${first}". ${usage}`);
  }
  const target = (level ? second : first) ?? '.';
  if (target.startsWith('-') || args.length > 2) throw new Error(usage);
  const root = contractRoot(target);
  const file = overrideFile(root);
  if (level === 'auto') {
    // A record that the user cleared it, so the Stop tells this apart from
    // a forced level that vanished. It lapses like any override.
    mkdirSync(dirname(file), { recursive: true });
    withFileLock(file, () => writeAtomicJson(file, { level: 'auto', expiresAt: new Date(Date.now() + OVERRIDE_HOURS * 3_600_000).toISOString(), setAt: new Date().toISOString() }));
    return `smugan: the level for ${fwd(root)} is decided by the hook again, file by file.\n`;
  }
  if (level) {
    const expiresAt = new Date(Date.now() + OVERRIDE_HOURS * 3_600_000).toISOString();
    mkdirSync(dirname(file), { recursive: true });
    withFileLock(file, () => writeAtomicJson(file, { level, expiresAt, setAt: new Date().toISOString() }));
    return `smugan: level ${level} forced on ${fwd(root)} until ${expiresAt.slice(0, 16).replace('T', ' ')} UTC. Downgrading a critical file is reported at every end of turn. Return to automatic with: smugan risk auto\n`;
  }
  const current = existsSync(file) ? riskOverride(root) : null;
  return current
    ? `smugan: level ${current.level} forced on ${fwd(root)} until ${current.expiresAt.slice(0, 16).replace('T', ' ')} UTC.\n`
    : `smugan: no level forced on ${fwd(root)}; the hook decides file by file (trivial, normal or critical).\n`;
}

// --- only the user lowers a level ---

/** The folder that holds every forced level. */
export function riskOverrideDir() {
  return dirname(overrideFile('.'));
}

/**
 * Why a shell command may lower the risk level, or null. Any command that
 * names smugan and `risk` together with `trivial`, `normal` or `auto` (quoted,
 * through a variable, anywhere in it), any call to runRisk, and any command
 * that names the forced-level folder or the smugan cache folder above it by
 * their exact path. Other ways to delete that folder are not guessed from the
 * text, which refused ordinary commands; the Stop notices a forced level that
 * vanished instead. Raising (`smugan risk critical`) and reading
 * (`smugan risk`) stay free.
 * @param {string} command
 */
export function lowersRisk(command) {
  const text = fwd(command).toLowerCase();
  // A path as Windows, Git Bash (/c/...) or a shell under the home (~/...) writes it.
  const names = (/** @type {string} */ path) => {
    const p = fwd(path).toLowerCase();
    const home = fwd(homedir()).toLowerCase();
    const spellings = [p, p.replace(/^([a-z]):\//, '/$1/'), ...(p.startsWith(home + '/') ? ['~' + p.slice(home.length), '$home' + p.slice(home.length)] : [])];
    return spellings.some((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])').test(text));
  };
  if (names(riskOverrideDir()) || /smugan\/+risk(?![\w.-])/.test(text)) return 'it names the folder where forced levels are kept';
  if (names(dirname(riskOverrideDir()))) return 'it names the smugan cache folder that holds forced levels';
  if (/\brunrisk\b/.test(text)) return 'it calls runRisk directly';
  if (/smugan|risk\.mjs/.test(text) && /\brisk\b/.test(text) && /\b(?:trivial|normal|auto)\b/.test(text)) return 'it may lower the level with smugan risk';
  return null;
}
