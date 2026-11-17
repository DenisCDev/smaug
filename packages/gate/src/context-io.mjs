// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const DETECTOR_VERSION = 1;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SKIP = new Set(['.git', '.smugan.local', 'node_modules', '.next', '.astro', 'dist', 'build', 'out', 'coverage', 'target', '.turbo', '.vercel', '.cache', '.claude', '.codex', '.agents', 'vendor']);
export const COMPONENTS = [
  'next', 'astro', '@astrojs/node', '@astrojs/react', 'react', 'react-dom',
  'supabase', '@supabase/supabase-js', '@supabase/ssr', 'pg', 'postgres', 'express',
  '@nestjs/common', '@nestjs/core', '@nestjs/platform-express', '@nestjs/platform-fastify', '@nestjs/throttler',
  'fastify', 'hono', '@hono/node-server', 'redis', 'ioredis', 'bullmq', 'bull',
  'lucide-react', 'lucide-astro', '@lucide/astro', '@phosphor-icons/react', 'phosphor-react', 'iconoir-react',
  '@heroui/react', '@base-ui/react', '@base-ui-components/react', 'react-aria-components', 'radix-ui',
  'tailwindcss', '@pandacss/dev', 'gsap', '@gsap/react', 'motion', 'framer-motion', 'animejs',
  'three', '@react-three/fiber', '@react-three/drei', '@babylonjs/core', 'barba', '@barba/core',
  '@opentelemetry/api', '@opentelemetry/sdk-node', '@opentelemetry/core',
  '@opentelemetry/sdk-trace-node', '@opentelemetry/sdk-metrics', '@opentelemetry/resources',
  '@opentelemetry/exporter-trace-otlp-http', '@opentelemetry/exporter-trace-otlp-grpc', '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/exporter-metrics-otlp-http', '@opentelemetry/exporter-metrics-otlp-grpc', '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-logs-otlp-http', '@opentelemetry/exporter-logs-otlp-grpc', '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/auto-instrumentations-node', '@sentry/node', '@sentry/nextjs', '@sentry/bun', '@sentry/react',
];

/** @typedef {{path: string, hash: string, text: string, installed: boolean}} ContextInput */
/** @typedef {{root: string, target: string, files: Map<string, ContextInput>, hints: string[], limitations: string[], complete: boolean, fingerprint: string}} Snapshot */
/** @param {string} text */
export const hash = (text) => createHash('sha256').update(text).digest('hex');
/** @param {string} path */
export const forward = (path) => path.replace(/\\/g, '/');
/** @param {string} root @param {string} path */
export function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')));
}

/** All Git invocations are local metadata reads, without a shell or network.
 * @param {string} cwd @param {string[]} args */
export function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 2000, maxBuffer: 256 * 1024, windowsHide: true });
}

/** @param {string} directory */
function workspaceManifest(directory) {
  try {
    const manifest = join(directory, 'package.json');
    if (lstatSync(manifest).isSymbolicLink() || statSync(manifest).size > 256 * 1024) return false;
    const value = JSON.parse(readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(value.workspaces) || Array.isArray(value.workspaces?.packages);
  } catch { return false; } // Invalid or absent metadata cannot establish ownership.
}

/** @param {string} target */
export function locateProject(target) {
  let path = resolve(target);
  if (!existsSync(path)) throw new Error('Project path not found.');
  path = realpathSync.native(path);
  if (!statSync(path).isDirectory()) path = dirname(path);
  const found = git(path, ['rev-parse', '--show-toplevel']);
  if (found.status === 0 && found.stdout.trim()) return { root: realpathSync.native(found.stdout.trim()), target: path };
  let current = path;
  let nearest;
  let workspace;
  for (;;) {
    if (!nearest && (existsSync(join(current, 'package.json')) || existsSync(join(current, 'Cargo.toml')))) nearest = current;
    // A non-Git workspace may still own the lock used by its nested packages.
    if (workspaceManifest(current) || existsSync(join(current, 'pnpm-workspace.yaml'))
      || (existsSync(join(current, 'Cargo.lock')) && existsSync(join(current, 'Cargo.toml')))) workspace = current;
    const parent = dirname(current);
    if (parent === current) return { root: workspace ?? nearest ?? path, target: path };
    current = parent;
  }
}

/** Only allowlisted metadata is read; no env files or executable configuration loading.
 * @param {string} name @param {string} rel */
function candidate(name, rel) {
  return /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|bun\.lockb?|Cargo\.toml|Cargo\.lock|yarn\.lock|\.nvmrc|\.node-version)$/.test(name)
    || /^(next|astro)\.config\.(js|mjs|cjs|ts)$/.test(name)
    || /^Dockerfile(?:\.[\w-]+)?$/.test(name)
    || /^(?:(?:docker-)?compose(?:\.[\w-]+)?|[\w-]+\.compose)\.ya?ml$/.test(name)
    || /(?:^|\/)supabase\/config\.toml$/.test(rel);
}

/** @param {string} root @param {string} target @returns {Snapshot} */
export function takeSnapshot(root, target) {
  /** @type {Snapshot} */
  const result = { root, target, files: new Map(), hints: [], limitations: [], complete: true, fingerprint: '' };
  const deadline = Date.now() + 5000;
  let directories = 0;
  let entries = 0;
  let bytes = 0;
  /** @type {Set<string>} */
  const packageDirs = new Set();
  /** @param {string} reason */
  const limited = (reason) => { result.complete = false; if (!result.limitations.includes(reason)) result.limitations.push(reason); };
  /** @param {string} abs @param {boolean} [installed] */
  const read = (abs, installed = false) => {
    const rel = forward(relative(root, abs));
    if (result.files.has(rel)) return;
    // An unreadable nearer lock must still prevent resolution from another project.
    const unreadable = () => result.files.set(rel, { path: rel, hash: hash('unreadable'), text: '', installed });
    if (Date.now() > deadline || result.files.size >= 1024) { limited('Discovery cut short by the deadline or file count; partial context.'); return; }
    try {
      if (!inside(root, realpathSync(abs))) { limited('Metadata outside the root through a symlink; not read.'); unreadable(); return; }
      const stats = statSync(abs);
      if (!stats.isFile() || stats.size > MAX_FILE_BYTES || bytes + stats.size > 32 * 1024 * 1024) { limited('Metadata exceeded the read limit; version not confirmed.'); unreadable(); return; }
      const text = readFileSync(abs, 'utf8');
      bytes += stats.size;
      result.files.set(rel, { path: rel, hash: hash(text), text, installed });
    } catch { limited('Metadata inaccessible or changed while being read; partial context.'); unreadable(); }
  };
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (Date.now() > deadline || ++directories > 2048 || depth > 12) { limited('Discovery cut short by depth, directory count or deadline.'); return; }
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (++entries > 50_000 || Date.now() > deadline) { limited('Discovery cut short by entry count or deadline; partial context.'); return; }
        const abs = join(dir, entry.name);
        const rel = forward(relative(root, abs));
        if (entry.isDirectory() && !SKIP.has(entry.name)) walk(abs, depth + 1);
        else if (entry.isFile()) {
          if (candidate(entry.name, rel)) read(abs);
          if (entry.name === 'package.json') packageDirs.add(dir);
          if (entry.name.endsWith('.astro')) result.hints.push('astro');
          if (/\.(?:sql)$/.test(entry.name) && /(?:^|\/)migrations\//.test(rel)) result.hints.push('postgres');
        } else if (entry.isSymbolicLink() && candidate(entry.name, rel)) {
          limited('Manifest/configuration reached through a symlink needs an explicit check.');
          result.files.set(rel, { path: rel, hash: hash('symlink'), text: '', installed: false });
        }
      }
    } catch { limited('Directory inaccessible during discovery; partial context.'); }
  };
  walk(root, 0);
  // Warm runs still verify installed metadata; a lock hash does not prove installation.
  for (const dir of packageDirs) {
    let current = dir;
    for (;;) {
      if (existsSync(join(current, 'node_modules'))) {
        for (const name of COMPONENTS) {
          const file = join(current, 'node_modules', name, 'package.json');
          if (existsSync(file)) read(file, true);
        }
      }
      if (current === root) break;
      const parent = dirname(current);
      if (!inside(root, parent)) break;
      current = parent;
    }
  }
  result.hints = [...new Set(result.hints)].sort();
  const inputs = [...result.files.values()].map(({ path, hash: digest }) => [path, digest]).sort(([a], [b]) => a.localeCompare(b));
  result.fingerprint = hash(JSON.stringify({ detector: DETECTOR_VERSION, inputs, hints: result.hints, node: process.version, complete: result.complete }));
  return result;
}

/** A directory symlink/junction must not redirect a managed write.
 * @param {string} root @param {string} destination */
export function plainPath(root, destination) {
  if (!inside(root, destination)) return false;
  let current = destination;
  for (;;) {
    try { if (lstatSync(current).isSymbolicLink()) return false; }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') return false; }
    if (current === root) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
