// @ts-check
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENTS } from './context-io.mjs';
import { loadParsers } from './deps.mjs';

const { parseDocument, parseToml, parseJsonc } = loadParsers(fileURLToPath(new URL('..', import.meta.url)));

/** @typedef {{path: string, kind: string, version?: string}} Evidence */
/** @typedef {{name: string, declared?: string, resolved?: string, installed?: string, evidence: Evidence[]}} Component */
/** @typedef {{path: string, components: Component[], capabilities: Record<string, string>, guides: string[]}} PackageContext */
/** @typedef {{packages: PackageContext[], guides: string[], limitations: string[], runtime: {node: string, scope: string}, environment: string}} ResolvedContext */

/** @param {unknown} value @returns {Record<string, unknown>} */
export const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
/** @param {unknown} value */
const string = (value) => typeof value === 'string' ? value : '';
/** @param {unknown} value */
export const version = (value) => typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value) ? value : undefined;
/** Never retain registry credentials, private URLs or local dependency paths.
 * @param {unknown} value */
export function declaration(value) {
  const text = typeof value === 'number' ? String(value) : string(value);
  return /^[\d\s.vxX*^~<>=|+,-]+$/.test(text) || /^[~^=]?\d+\.\d+\.\d+-[\w.-]+(?:\+[\w.-]+)?$/.test(text) || /^(?:latest|next|canary|beta|workspace:[*^~])$/.test(text) ? text.slice(0,120) : 'non-registry-or-unknown';
}

/** @param {import('./context-io.mjs').Snapshot} snapshot */
export function parseInputs(snapshot) {
  /** @type {Map<string, Record<string, unknown>>} */
  const parsed = new Map();
  const limitations = [...snapshot.limitations];
  for (const input of snapshot.files.values()) {
    const name = posix.basename(input.path);
    if (/^(?:Dockerfile|next\.config|astro\.config|yarn\.lock|bun\.lockb|\.nvmrc|\.node-version)/.test(name)) continue;
    try {
      const text = input.text.replace(/^\uFEFF/, '');
      /** @type {unknown} */
      let value;
      if (name.endsWith('.json')) value = JSON.parse(text);
      else if (name === 'bun.lock') {
        /** @type {import('jsonc-parser').ParseError[]} */
        const errors = [];
        value = parseJsonc(text, errors, { allowTrailingComma: true });
        if (errors.length) throw new Error('Invalid JSONC');
      } else if (name.endsWith('.toml') || name === 'Cargo.lock') value = parseToml(text);
      else if (/\.ya?ml$/.test(name)) {
        const doc = parseDocument(text, { uniqueKeys: true });
        if (doc.errors.length) throw new Error('Invalid YAML');
        value = doc.toJS({ maxAliasCount: 20 });
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected metadata object');
      parsed.set(input.path, object(value));
    } catch { limitations.push(`Invalid metadata or unsupported format: ${input.path}; no version was inferred.`); }
  }
  return { parsed, limitations };
}

/** @param {string} dir */
function ancestors(dir) {
  const dirs = [dir];
  while (dir !== '.') { dir = posix.dirname(dir); dirs.push(dir); }
  return dirs;
}
/** @param {string} dir @param {string} name */
const at = (dir, name) => dir === '.' ? name : dir + '/' + name;

/** @param {Record<string, unknown>} manifest */
function dependencies(manifest) {
  return { ...object(manifest.peerDependencies), ...object(manifest.devDependencies), ...object(manifest.dependencies), ...object(manifest.optionalDependencies) };
}

/** @param {string} dir @param {string} name @param {unknown} declared @param {Map<string, Record<string, unknown>>} parsed @param {import('./context-io.mjs').Snapshot} snapshot */
function lockedVersion(dir, name, declared, parsed, snapshot) {
  if (!snapshot.complete) return { limitation: `Partial discovery; resolution unproven for ${name} in ${dir}.` };
  for (const lockDir of ancestors(dir)) {
    const locks = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'yarn.lock'].filter((file) => snapshot.files.has(at(lockDir, file)));
    if (!locks.length) continue;
    const distinct = locks.filter((file) => file !== 'package-lock.json' || !locks.includes('npm-shrinkwrap.json'));
    if (distinct.length > 1) return { limitation: `Competing lockfiles in ${lockDir}; select the package manager in effect.` };
    const file = distinct[0];
    const path = at(lockDir, file);
    const lock = parsed.get(path);
    if (!lock) return { limitation: `Invalid or unsupported lockfile at ${path}; no ancestor lockfile was used.` };
    const rel = posix.relative(lockDir, dir) || '.';
    /** @type {string | undefined} */
    let resolved;
    if (file.endsWith('.json')) {
      if (![2, 3].includes(Number(lock.lockfileVersion))) return { limitation: `${path}: npm format without a proven manifest edge; check manually.` };
      const packages = object(lock.packages);
      const owner = object(packages[rel === '.' ? '' : rel]);
      if (dependencies(owner)[name] !== declared || declaration(declared) === 'non-registry-or-unknown') {
        return { limitation: `Manifest and lockfile diverge, or the edge for ${name} is missing in ${path}.` };
      }
      for (const parent of ancestors(rel)) {
        const entry = object(packages[at(parent, `node_modules/${name}`)]);
        if (!Object.keys(entry).length) continue;
        if (entry.link === true) break;
        if (entry.name && entry.name !== name) break;
        resolved = version(entry.version);
        break;
      }
    } else if (file === 'pnpm-lock.yaml') {
      if (!['5.3', '5.4', '6', '6.0', '9', '9.0'].includes(String(lock.lockfileVersion))) {
        return { limitation: `${path}: pnpm lockfile format version not covered; check manually.` };
      }
      const importers = object(lock.importers);
      const importer = Object.keys(importers).length ? object(importers[rel]) : (rel === '.' ? lock : {});
      const entries = dependencies(importer);
      const entry = object(entries[name]);
      const specifier = entry.specifier ?? object(importer.specifiers)[name];
      if (specifier !== declared || declaration(declared) === 'non-registry-or-unknown') {
        return { limitation: `Manifest and importer diverge, or the edge for ${name} is missing in ${path}.` };
      }
      const value = typeof entries[name] === 'string' ? entries[name] : entry.version;
      resolved = version(string(value).split('(')[0]);
    } else {
      const owner = object(object(lock.workspaces)[rel === '.' ? '' : rel]);
      if (lock.lockfileVersion !== 1 || dependencies(owner)[name] !== declared || declaration(declared) === 'non-registry-or-unknown') {
        return { limitation: `Manifest and workspace diverge, or the edge for ${name} is missing in ${path}.` };
      }
      // Bun's package table can contain several resolutions. Do not assign one
      // version to a workspace unless the table is unambiguous for this name.
      const candidates = Object.values(object(lock.packages)).flatMap((entry) => {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].startsWith(name + '@')) return [];
        const found = version(entry[0].slice(name.length + 1));
        return found ? [found] : [];
      });
      const unique = [...new Set(candidates)];
      if (unique.length === 1) resolved = unique[0];
    }
    return resolved ? { resolved, path } : { limitation: `Resolution unproven for ${name} in ${path}.` };
  }
  return { limitation: `No compatible lockfile for ${name} in ${dir}.` };
}

/** @param {string} dir @param {string} name @param {Map<string, Record<string, unknown>>} parsed @param {import('./context-io.mjs').Snapshot} snapshot */
function installedVersion(dir, name, parsed, snapshot) {
  if (!snapshot.complete) return undefined;
  for (const parent of ancestors(dir)) {
    const path = at(parent, `node_modules/${name}/package.json`);
    const pkg = parsed.get(path);
    if (snapshot.files.has(path)) return pkg?.name === name && version(pkg.version) ? { version: version(pkg.version), path } : undefined;
  }
  return undefined;
}

/** @param {Component[]} components @param {string} name @param {unknown} value @param {Evidence} evidence */
function addDeclaration(components, name, value, evidence) {
  if (components.some((entry) => entry.name === name && entry.declared === declaration(value))) return;
  components.push({ name, declared: declaration(value), evidence: [evidence] });
}

/** @param {string} dir @param {Record<string, unknown>} manifest @param {Map<string, Record<string, unknown>>} parsed @param {string[]} limitations @param {import('./context-io.mjs').Snapshot} snapshot */
function nodePackage(dir, manifest, parsed, limitations, snapshot) {
  /** @type {PackageContext} */
  const result = { path: dir, components: [], capabilities: {}, guides: [] };
  const deps = dependencies(manifest);
  for (const name of COMPONENTS) {
    if (!(name in deps)) continue;
    /** @type {Component} */
    const component = { name, declared: declaration(deps[name]), evidence: [{ path: at(dir, 'package.json'), kind: 'declared' }] };
    const locked = lockedVersion(dir, name, deps[name], parsed, snapshot);
    if (locked.resolved && locked.path) { component.resolved = locked.resolved; component.evidence.push({ path: locked.path, kind: 'resolved', version: locked.resolved }); }
    else if (locked.limitation) limitations.push(locked.limitation);
    const installed = installedVersion(dir, name, parsed, snapshot);
    if (installed?.version) { component.installed = installed.version; component.evidence.push({ path: installed.path, kind: 'installed', version: installed.version }); }
    if (component.installed && component.resolved && component.installed !== component.resolved) limitations.push(`Installed version diverges from the lockfile: ${dir} / ${name}.`);
    result.components.push(component);
  }
  const engine = object(manifest.engines).node;
  if (engine) addDeclaration(result.components, 'node', engine, { path: at(dir, 'package.json'), kind: 'runtime-target' });
  result.capabilities.modules = manifest.type === 'module' ? 'esm-manifest' : 'inspect-build-and-startup';
  return result;
}

/** A deliberately small subset; unsupported Cargo ranges remain unknown.
 * @param {unknown} declared @param {string} resolved */
function cargoCompatible(declared, resolved) {
  if (typeof declared !== 'string') return false;
  const requirement = /^(\^|~|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(declared.trim());
  if (!requirement || resolved.includes('-')) return false;
  const candidate = resolved.split('+')[0].split('.').map(Number);
  const minimum = requirement.slice(2).map((part) => Number(part ?? 0));
  if (requirement[1] === '=') return requirement[4] !== undefined && candidate.every((part, index) => part === minimum[index]);
  const count = requirement[4] !== undefined ? 3 : requirement[3] !== undefined ? 2 : 1;
  const firstNonzero = minimum.findIndex((part) => part !== 0);
  const caretBoundary = firstNonzero < 0 ? count - 1 : Math.min(firstNonzero, count - 1);
  const boundary = requirement[1] === '~' ? Math.min(count - 1, 1) : caretBoundary;
  const maximum = minimum.map((part, index) => index < boundary ? part : index === boundary ? part + 1 : 0);
  const compare = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return compare(candidate, minimum) >= 0 && compare(candidate, maximum) < 0;
}

/** @param {string} dir @param {Record<string, unknown>} manifest @param {Map<string, Record<string, unknown>>} parsed @param {string[]} limitations @param {import('./context-io.mjs').Snapshot} snapshot */
function rustPackage(dir, manifest, parsed, limitations, snapshot) {
  /** @type {PackageContext} */
  const result = { path: dir, components: [], capabilities: {}, guides: [] };
  const deps = { ...object(manifest.dependencies), ...object(manifest['dev-dependencies']) };
  for (const target of Object.values(object(manifest.target))) Object.assign(deps, object(object(target).dependencies));
  const lockDir = ancestors(dir).find((parent) => snapshot.files.has(at(parent, 'Cargo.lock')));
  const lockPath = lockDir === undefined ? undefined : at(lockDir, 'Cargo.lock');
  const lock = lockPath ? parsed.get(lockPath) : undefined;
  const rows = Array.isArray(lock?.package) ? lock.package.map(object) : [];
  const workspaceDir = ancestors(dir).find((parent) => Object.keys(object(parsed.get(at(parent, 'Cargo.toml'))?.workspace)).length);
  const workspace = object(workspaceDir === undefined ? undefined : parsed.get(at(workspaceDir, 'Cargo.toml'))?.workspace);
  const packageVersion = object(object(manifest.package).version).workspace === true ? object(workspace.package).version : object(manifest.package).version;
  const owners = rows.filter((row) => row.name === object(manifest.package).name && row.version === packageVersion && row.source === undefined);
  const owner = owners.length === 1 ? owners[0] : undefined;
  for (const [alias, dep] of Object.entries(deps)) {
    let effective = dep;
    if (object(dep).workspace === true) {
      const inherited = object(workspace.dependencies)[alias];
      effective = typeof inherited === 'string' ? { version: inherited, ...object(dep) } : { ...object(inherited), ...object(dep) };
    }
    const name = string(object(effective).package) || alias;
    if (!['axum', 'sqlx', 'tokio'].includes(name)) continue;
    const declared = typeof effective === 'string' ? effective : object(effective).version;
    const edges = Array.isArray(owner?.dependencies) ? owner.dependencies.filter((value) => typeof value === 'string' && (value === name || value.startsWith(name + ' '))) : [];
    const edge = edges.length === 1 ? edges[0] : undefined;
    const edgeVersion = typeof edge === 'string' ? version(edge.split(' ')[1]) : undefined;
    const edgeSource = typeof edge === 'string' ? /\((.+)\)$/.exec(edge)?.[1] : undefined;
    const matches = rows.filter((row) => row.name === name && (!edgeVersion || row.version === edgeVersion) && (!edgeSource || row.source === edgeSource));
    const candidate = edge && matches.length === 1 ? version(matches[0].version) : undefined;
    const customSource = object(effective).git || object(effective).path || object(effective).registry;
    const resolved = snapshot.complete && candidate && !customSource && cargoCompatible(declared, candidate) ? candidate : undefined;
    /** @type {Component} */
    const component = { name, declared: declaration(declared), evidence: [{ path: at(dir, 'Cargo.toml'), kind: 'declared' }] };
    if (resolved && lockPath) { component.resolved = resolved; component.evidence.push({ path: lockPath, kind: 'resolved', version: resolved }); }
    else limitations.push(`Cargo resolution unproven for ${name} in ${dir}.`);
    result.components.push(component);
  }
  return result;
}

/** @param {PackageContext} pkg */
export function guideIds(pkg) {
  const names = new Set(pkg.components.filter((entry) => entry.declared !== 'non-registry-or-unknown' || entry.resolved || entry.installed).map((entry) => entry.name));
  const any = (/** @type {string[]} */ list) => list.some((name) => names.has(name));
  const guides = [];
  if (names.has('next')) guides.push('nextjs');
  if (names.has('astro') || pkg.capabilities.astroConfig) guides.push('astro');
  if (any(['supabase', '@supabase/supabase-js', '@supabase/ssr', 'postgres', 'pg', 'sqlx'])) guides.push('supabase-postgres');
  if (any(['node', 'express', 'hono', '@hono/node-server', '@nestjs/common', '@nestjs/core', '@nestjs/platform-express', '@nestjs/platform-fastify', 'fastify'])) guides.push('node-api');
  if (any(['axum', 'tokio', 'sqlx'])) guides.push('rust-axum');
  if (pkg.capabilities.docker) guides.push('docker-vps');
  if (pkg.components.some(({ name }) => /lucide|phosphor|iconoir|heroui|base-ui|react-aria|radix|gsap|motion|anime|three|babylon|barba/.test(name))) guides.push('visual-systems');
  if (pkg.components.some(({ name }) => /opentelemetry|sentry|glitchtip/.test(name))) guides.push('observability');
  if (any(['redis', 'ioredis', 'valkey', 'bullmq', 'bull', 'node', 'express', 'hono', '@nestjs/core', 'axum', 'tokio'])) guides.push('concurrency');
  return [...new Set(guides)];
}

/** @param {string} image @param {PackageContext} pkg @param {string} path */
function imageComponent(image, pkg, path) {
  const withoutDigest = image.split('@')[0];
  const leaf = withoutDigest.split('/').at(-1) ?? '';
  const [name, tag] = leaf.split(':');
  const canonical = name.includes('opentelemetry-collector') ? 'opentelemetry-collector' : name;
  if (!['node', 'postgres', 'redis', 'valkey', 'glitchtip', 'opentelemetry-collector'].includes(canonical)) return;
  const declared = tag?.match(/^v?(\d+(?:\.\d+){0,2})\b/)?.[1] ?? 'unknown';
  addDeclaration(pkg.components, canonical, declared, { path, kind: 'image-declared' });
}

/** @param {import('./context-io.mjs').Snapshot} snapshot @param {string} environment @returns {ResolvedContext} */
export function resolveContext(snapshot, environment) {
  const { parsed, limitations } = parseInputs(snapshot);
  /** @type {PackageContext[]} */
  const packages = [];
  for (const [path, manifest] of parsed) {
    if (snapshot.files.get(path)?.installed) continue;
    const dir = dirname(path).replace(/\\/g, '/');
    if (posix.basename(path) === 'package.json') packages.push(nodePackage(dir, manifest, parsed, limitations, snapshot));
    if (posix.basename(path) === 'Cargo.toml') packages.push(rustPackage(dir, manifest, parsed, limitations, snapshot));
  }
  if (!packages.some((pkg) => pkg.path === '.')) packages.push({ path: '.', components: [], capabilities: {}, guides: [] });
  for (const input of snapshot.files.values()) {
    if (input.installed) continue;
    const directory = posix.dirname(input.path);
    const pkg = packages.filter((entry) => entry.path === '.' || directory === entry.path || directory.startsWith(entry.path + '/')).sort((a,b) => b.path.length - a.path.length)[0];
    if (/next\.config\./.test(input.path)) { pkg.capabilities.nextConfig = 'requires-inspection'; limitations.push(`${input.path}: executable configuration was not evaluated; confirm flags before applying conditional APIs.`); }
    if (/astro\.config\./.test(input.path)) pkg.capabilities.astroConfig = 'requires-inspection';
    if (/Dockerfile/.test(posix.basename(input.path))) {
      pkg.capabilities.docker = 'declared';
      for (const line of input.text.split(/\r?\n/)) {
        const match = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line);
        if (match) imageComponent(match[1], pkg, input.path);
      }
    }
    const config = parsed.get(input.path) ?? {};
    if (/compose.*\.ya?ml$/.test(input.path)) {
      pkg.capabilities.docker = 'declared';
      for (const service of Object.values(object(config.services))) imageComponent(string(object(service).image), pkg, input.path);
    }
    if (/supabase\/config\.toml$/.test(input.path)) {
      const major = object(config.db).major_version;
      if (typeof major === 'number') addDeclaration(pkg.components, 'postgres', major, { path: input.path, kind: 'configured-target' });
    }
    if (/\.(?:nvmrc|node-version)$/.test(input.path)) addDeclaration(pkg.components, 'node', input.text.trim().replace(/^v/, ''), { path: input.path, kind: 'runtime-target' });
    if (posix.basename(input.path) === 'yarn.lock') limitations.push(`${input.path}: Yarn format not resolved yet; use installed evidence or check manually.`);
    if (posix.basename(input.path) === 'bun.lockb') limitations.push(`${input.path}: binary Bun format not resolved; use installed evidence or check manually.`);
  }
  for (const pkg of packages) pkg.guides = guideIds(pkg);
  return { packages, guides: [...new Set(packages.flatMap((pkg) => pkg.guides))], limitations: [...new Set(limitations)], runtime: { node: process.versions.node, scope: 'context-command-process-only' }, environment };
}
