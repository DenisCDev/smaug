// @ts-check
// Which AI engines and models a project uses, from what is on disk only: no
// network, no executing project config, no .env. Every engine and model the
// detector knows is an entry in ai/signatures.json; adding one never needs a
// code change here. The detector knows names, never versions or practices:
// those come from the guide researched for the pair it finds.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestPath } from './checks/test-weakening.mjs';
import { hasCode } from './file-state.mjs';

/** @type {((text: string) => Record<string, unknown>) | null | undefined} */
let parseToml;
/** The gate's TOML parser, or null on an install without its dependencies. */
function tomlParser() {
  if (parseToml !== undefined) return parseToml;
  try {
    parseToml = createRequire(import.meta.url)('smol-toml').parse;
  } catch (error) {
    if (!hasCode(error, 'MODULE_NOT_FOUND')) throw error;
    parseToml = null;
  }
  return parseToml ?? null;
}

const SIGNATURES_FILE = join(dirname(fileURLToPath(import.meta.url)), 'ai', 'signatures.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo', 'coverage', 'target', 'vendor',
  '.venv', 'venv', '__pycache__', 'fixtures', '__fixtures__', 'test', 'tests', '__tests__', 'e2e', 'docs', 'doc', '.smugan.local',
  'examples', 'example', 'samples', 'sample', 'benchmarks', 'benchmark']);
const CODE_RE = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|rb|php|json|ya?ml|toml)$/i;
const LOCK_RE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock)$/i;
const ENV_RE = /(?:^|\/)\.env(?:\.[^/]*)?$|\.env$/i;
const DOCKER_RE = /(?:^|\/)(?:Dockerfile[^/]*|[^/]*\.dockerfile|(?:docker-)?compose[^/]*\.ya?ml)$/i;
// SessionStart waits for the scan: the entry and file caps keep a large
// monorepo to well under a second, and a capped scan says so (`truncated`).
const MAX_ENTRIES = 8000;
const MAX_FILES = 800;
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 10;

/**
 * @typedef {{ id: string, npm?: string[], pypi?: string[], imports?: string[], files?: string[], images?: string[] }} EngineSignature
 * @typedef {{ pattern: string }} ModelSignature
 * @typedef {{ engines: EngineSignature[], models: ModelSignature[], runtimeModel: string }} Signatures
 * @typedef {{ id: string, version: string | null, source: string }} Engine
 * @typedef {{ id: string, family: string, version: string, count: number, at: string }} Model
 * @typedef {{ key: string, engine: string | null, model: string }} Pair
 * `pairs` puts the most used models first; `truncated` means the file cap
 * stopped the walk before the end.
 * @typedef {{ engines: Engine[], models: Model[], runtime: boolean, pairs: Pair[], truncated: boolean }} AiUsage
 */

/** @type {Signatures | null} */
let signatures = null;
/** @returns {Signatures} */
export function loadSignatures() {
  signatures ??= /** @type {Signatures} */ (JSON.parse(readFileSync(SIGNATURES_FILE, 'utf8')));
  return signatures;
}

const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** @type {{ re: RegExp, prefixes: string[] } | null} */
let modelMatcher = null;
/** Literal model ids in source text: quoted, optionally behind a `provider/` prefix. */
function modelRegex() {
  if (!modelMatcher) {
    const patterns = loadSignatures().models.map((m) => m.pattern);
    modelMatcher = {
      re: new RegExp(`(['"\`])(?:[\\w.-]+/)?(${patterns.map((p) => `(?:${p})`).join('|')})\\1`, 'g'),
      // A file with none of the patterns' literal prefixes cannot match: skip the regex.
      prefixes: patterns.map((p) => /^[a-z0-9-]*/i.exec(p)?.[0] ?? '').filter(Boolean).map((p) => p.toLowerCase()),
    };
  }
  modelMatcher.re.lastIndex = 0;
  return modelMatcher;
}

/**
 * `family@version` of a model id, by shape alone: a trailing snapshot date is
 * dropped, the first number (with one `.` or `-` part and an optional letter
 * like `4o`) is the version, and the rest is the family.
 * @param {string} id @returns {{ family: string, version: string }}
 */
export function modelKey(id) {
  // Snapshot dates: -20240101 and -2025-08-07 at the end, -04-17 after a
  // word, and four-digit -0709 / -0125 anywhere.
  const base = id.toLowerCase()
    .replace(/-\d{4}-\d{2}-\d{2}$|-\d{6,8}$/, '')
    .replace(/(-[a-z]+)-\d{2}-\d{2}$/, '$1')
    .replace(/-\d{4}(?=-|$)/g, '');
  const match = /(?<![a-z0-9])(\d+(?:[.-]\d{1,2}(?![\da-z]))?)([a-z](?=-|$))?/.exec(base);
  if (!match) return { family: base, version: 'unknown' };
  const family = (base.slice(0, match.index) + base.slice(match.index + match[0].length)).replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return { family, version: match[1].replace('-', '.') + (match[2] ?? '') };
}

/** PEP 503 normalized distribution name. @param {string} name */
const pypiName = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** @param {string} line PEP 508 requirement @param {Map<string, string>} into */
function addRequirement(line, into) {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;#]*)/.exec(line);
  if (match) into.set(pypiName(match[1]), match[2].trim());
}

/** Declared dependencies of a requirements file. @param {string} text */
function requirementLines(text) {
  /** @type {Map<string, string>} */
  const deps = new Map();
  for (const line of text.split(/\r?\n/)) if (!/^\s*(?:#|-)/.test(line)) addRequirement(line, deps);
  return deps;
}

/**
 * Declared dependencies of a pyproject.toml, from its dependency tables only
 * (PEP 621, PEP 735 groups, Poetry): a description or keyword that names an
 * SDK is not a dependency.
 * @param {string} text
 */
function pyprojectDependencies(text) {
  /** @type {Map<string, string>} */
  const deps = new Map();
  const parse = tomlParser();
  /** @type {Record<string, any>} TOML is untyped data; each field is checked before use */
  let doc;
  try {
    doc = parse ? parse(text) : {};
  } catch {
    return deps; // an unparseable pyproject declares nothing the detector can trust
  }
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const tables = (/** @type {unknown} */ v) => (v && typeof v === 'object' ? Object.values(v) : []);
  for (const req of [...list(doc.project?.dependencies), ...tables(doc.project?.['optional-dependencies']).flatMap(list), ...tables(doc['dependency-groups']).flatMap(list)]) {
    addRequirement(req, deps);
  }
  const poetry = doc.tool?.poetry;
  for (const table of [poetry?.dependencies, poetry?.['dev-dependencies'], ...tables(poetry?.group).map((g) => g?.dependencies)]) {
    if (!table || typeof table !== 'object') continue;
    for (const [name, value] of Object.entries(table)) {
      deps.set(pypiName(name), typeof value === 'string' ? value : typeof value?.version === 'string' ? value.version : '');
    }
  }
  return deps;
}

/** `major.minor` of a version string, or `unknown`. @param {string | null} version */
export function majorMinor(version) {
  const match = version ? /(\d+)(?:\.(\d+))?/.exec(version) : null;
  return match ? `${match[1]}.${match[2] ?? '0'}` : 'unknown';
}

/** @type {{ id: string, patterns: RegExp[] }[] | null} */
let importMatchers = null;
/** Engine ids whose SDK the text imports (JS/TS import or require, Python import). @param {string} text */
export function importedEngines(text) {
  importMatchers ??= loadSignatures().engines.map((engine) => ({
    id: engine.id,
    patterns: (engine.imports ?? []).flatMap((name) => {
      const n = escape(name);
      return [
        new RegExp(`(?:\\bfrom\\s+|\\brequire\\(\\s*|\\bimport\\(\\s*|^\\s*import\\s+)['"]${n}(?:/[^'"]*)?['"]`, 'm'),
        new RegExp(`^\\s*(?:from\\s+${n}(?:\\.[\\w.]+)?\\s+import|import\\s+${n}\\b)`, 'm'),
      ];
    }),
  }));
  return importMatchers.filter((m) => m.patterns.some((p) => p.test(text))).map((m) => m.id);
}

/** Literal model ids in a text, with their line. @param {string} text @returns {{ id: string, line: number }[]} */
export function modelLiterals(text) {
  /** @type {{ id: string, line: number }[]} */
  const out = [];
  const { re, prefixes } = modelRegex();
  const lower = text.toLowerCase();
  if (prefixes.length && !prefixes.some((p) => lower.includes(p))) return out;
  for (const match of text.matchAll(re)) {
    out.push({ id: match[2].toLowerCase(), line: text.slice(0, match.index).split('\n').length });
  }
  return out;
}

/** @param {string} file */
function readSmall(file) {
  try {
    const stats = lstatSync(file);
    return stats.isFile() && stats.size <= MAX_BYTES ? readFileSync(file, 'utf8') : null;
  } catch {
    return null; // vanished or unreadable: nothing to detect in it
  }
}

/** @param {string} file */
function installedVersion(file) {
  const text = readSmall(file);
  if (text === null) return null;
  try {
    const version = JSON.parse(text).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null; // a broken manifest in node_modules says nothing about the version
  }
}

/**
 * Walks the project, bounded, and reports engines, models and the pairs a
 * guide is keyed by. Prose, tests, fixtures, docs, dependencies and env files
 * are never read.
 * @param {string} root @returns {AiUsage}
 */
export function detectAi(root) {
  const sig = loadSignatures();
  /** @type {Map<string, Engine>} */
  const engines = new Map();
  /** @type {Map<string, Model>} */
  const models = new Map();
  let runtime = false;
  let visited = 0;
  let seen = 0;
  let truncated = false;
  const runtimeRe = new RegExp(sig.runtimeModel);
  const markers = new Map(sig.engines.flatMap((e) => (e.files ?? []).map((f) => [f, e.id])));

  /** @param {string} id @param {string | null} version @param {string} source */
  const addEngine = (id, version, source) => {
    const known = engines.get(id);
    if (!known || (!known.version && version)) engines.set(id, { id, version, source });
  };

  /** @param {string} dir @param {string} rel */
  const manifest = (dir, rel) => {
    const text = readSmall(join(dir, 'package.json'));
    if (text === null) return;
    /** @type {Record<string, unknown>} */
    let pkg;
    try {
      pkg = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      return; // the project's own tooling reports a broken package.json
    }
    const deps = Object.assign({}, ...['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .map((k) => (pkg[k] && typeof pkg[k] === 'object' ? pkg[k] : {})));
    for (const engine of sig.engines) {
      for (const name of engine.npm ?? []) {
        if (typeof deps[name] !== 'string') continue;
        const installedFile = [join(dir, 'node_modules', name, 'package.json'), join(root, 'node_modules', name, 'package.json')].find((f) => existsSync(f));
        const installed = installedFile ? installedVersion(installedFile) : null;
        const declared = /\d+(?:\.\d+){0,2}/.exec(deps[name])?.[0] ?? null;
        addEngine(engine.id, installed ?? declared, installed && installedFile ? relative(root, installedFile).replace(/\\/g, '/') : join(rel, 'package.json').replace(/\\/g, '/'));
      }
    }
  };

  /** @param {string} text @param {string} rel */
  const python = (text, rel) => {
    /** name → version spec (or '') of every declared dependency */
    const deps = /requirements[^/]*\.txt$/i.test(rel) ? requirementLines(text) : pyprojectDependencies(text);
    for (const engine of sig.engines) {
      for (const name of engine.pypi ?? []) {
        const spec = deps.get(pypiName(name));
        if (spec !== undefined) addEngine(engine.id, /[0-9][\w.]*/.exec(spec)?.[0] ?? null, rel);
      }
    }
  };

  /** @param {string} text @param {string} rel */
  const docker = (text, rel) => {
    for (const engine of sig.engines) {
      for (const image of engine.images ?? []) {
        const match = new RegExp(`${escape(image)}(?::v?([0-9][\\w.-]*))?`, 'i').exec(text);
        if (match) addEngine(engine.id, match[1] ?? null, rel);
      }
    }
  };

  /** Files found by the walk, read after it: manifests first, then code. @type {{ abs: string, rel: string, kind: 'docker' | 'python' | 'code' }[]} */
  const queue = [];
  // Breadth first: every shallow folder (where workspace manifests live) is
  // listed before any deep one, so the entry cap cuts the deepest folders.
  /** @type {[string, number][]} */
  const folders = [[root, 0]];
  for (let next = 0; next < folders.length && !truncated; next++) {
    const [dir, depth] = folders[next];
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // an unreadable folder holds nothing the detector can use
    }
    const relDir = relative(root, dir).replace(/\\/g, '/');
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) manifest(dir, relDir);
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) { truncated = true; break; }
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.') && depth < MAX_DEPTH) folders.push([join(dir, entry.name), depth + 1]);
        continue;
      }
      if (!entry.isFile()) continue;
      const marker = markers.get(entry.name);
      if (marker) addEngine(marker, null, rel);
      if (ENV_RE.test(rel) || LOCK_RE.test(rel) || isTestPath(rel)) continue;
      const kind = DOCKER_RE.test(rel) ? 'docker' : /(?:^|\/)(?:pyproject\.toml|requirements[^/]*\.txt)$/i.test(rel) ? 'python' : CODE_RE.test(rel) ? 'code' : null;
      if (kind) queue.push({ abs: join(dir, entry.name), rel, kind });
    }
  }

  /** Engines imported next to each model id. @type {Map<string, Set<string>>} */
  const nextTo = new Map();
  for (const { abs, rel, kind } of [...queue.filter((q) => q.kind !== 'code'), ...queue.filter((q) => q.kind === 'code')]) {
    if (kind === 'code' && visited >= MAX_FILES) { truncated = true; break; }
    if (kind === 'code') visited++;
    const text = readSmall(abs);
    if (text === null) continue;
    if (kind === 'docker') { docker(text, rel); continue; }
    if (kind === 'python') { python(text, rel); continue; }
    if (!runtime && runtimeRe.test(text)) runtime = true;
    const literals = modelLiterals(text);
    if (!literals.length) continue;
    const imported = importedEngines(text);
    for (const { id, line } of literals) {
      const known = models.get(id);
      if (known) known.count++;
      else models.set(id, { id, ...modelKey(id), count: 1, at: `${rel}:${line}` });
      const near = nextTo.get(id) ?? new Set();
      for (const e of imported) near.add(e);
      nextTo.set(id, near);
    }
  }

  const engineList = [...engines.values()].sort((a, b) => a.id.localeCompare(b.id));
  const engineKey = (/** @type {Engine} */ e) => `${e.id}@${majorMinor(e.version)}`;
  /** @type {Map<string, Model>} */
  const byKey = new Map();
  /** @type {Map<string, Set<string>>} */
  const enginesOf = new Map();
  for (const m of [...models.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))) {
    const key = `${m.family}@${m.version}`;
    const known = byKey.get(key);
    if (known) known.count += m.count;
    else byKey.set(key, { ...m });
    const set = enginesOf.get(key) ?? new Set();
    for (const e of nextTo.get(m.id) ?? []) if (engines.has(e)) set.add(e);
    enginesOf.set(key, set);
  }
  const modelList = [...byKey.values()];
  // A model pairs with the engines imported in the same file; with a single
  // engine in the project, with that one; otherwise it stands alone. An
  // engine no model pairs with gets a runtime pair.
  /** @type {Pair[]} */
  const pairs = [];
  const paired = new Set();
  for (const m of modelList) {
    const model = `${m.family}@${m.version}`;
    const near = [...(enginesOf.get(model) ?? [])];
    const with_ = near.length ? near : engineList.length === 1 ? [engineList[0].id] : [];
    if (!with_.length) pairs.push({ key: model, engine: null, model });
    for (const id of with_.sort()) {
      const e = /** @type {Engine} */ (engines.get(id));
      pairs.push({ key: `${engineKey(e)}+${model}`, engine: id, model });
      paired.add(id);
    }
  }
  for (const e of engineList) if (!paired.has(e.id)) pairs.push({ key: `${engineKey(e)}+runtime`, engine: e.id, model: 'runtime' });
  return { engines: engineList, models: modelList, runtime, pairs, truncated };
}
