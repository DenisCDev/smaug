// @ts-check
import { COMPONENTS } from './context-io.mjs';
import { declaration } from './context-resolve.mjs';

const GUIDES = new Set(['nextjs', 'astro', 'supabase-postgres', 'node-api', 'rust-axum', 'docker-vps', 'visual-systems', 'observability', 'concurrency', 'testing']);
const NAMES = new Set([...COMPONENTS, 'node', 'axum', 'tokio', 'sqlx', 'valkey', 'glitchtip', 'opentelemetry-collector']);
/** @param {unknown} value @param {string[]} allowed @param {string[]} [required] */
export function fields(value, allowed, required = allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}
/** @param {unknown} value @param {number} max */
const text = (value, max) => typeof value === 'string' && value.length <= max;
/** @param {unknown} value */
const version = (value) => typeof value === 'string' && value.length <= 120 && /^\d+(?:\.\d+){0,2}(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value);
/** @param {unknown} value */
const path = (value) => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[:\\\x00-\x1f]/.test(value) && !value.startsWith('/') && !value.split('/').includes('..');
/** @param {unknown} value */
const guides = (value) => Array.isArray(value) && value.length <= GUIDES.size && value.every((id) => GUIDES.has(id));

/** @param {unknown} value @returns {value is import('./context-resolve.mjs').ResolvedContext} */
export function validData(value) {
  if (!fields(value, ['packages', 'guides', 'limitations', 'runtime', 'environment'])) return false;
  const data = /** @type {import('./context-resolve.mjs').ResolvedContext} */ (value);
  return Array.isArray(data.packages) && data.packages.length <= 1024 && data.packages.every((pkg) =>
    fields(pkg, ['path', 'components', 'capabilities', 'guides']) && path(pkg.path) && guides(pkg.guides)
    && fields(pkg.capabilities, ['modules', 'nextConfig', 'astroConfig', 'docker'], [])
    && Object.entries(pkg.capabilities).every(([key, val]) => key === 'modules' ? ['esm-manifest', 'inspect-build-and-startup'].includes(val)
      : key === 'docker' ? val === 'declared' : val === 'requires-inspection')
    && Array.isArray(pkg.components) && pkg.components.length <= 128 && pkg.components.every((component) =>
      fields(component, ['name', 'declared', 'resolved', 'installed', 'evidence'], ['name', 'evidence']) && NAMES.has(component.name)
      && (component.declared === undefined || text(component.declared, 120) && declaration(component.declared) === component.declared)
      && [component.resolved, component.installed].every((v) => v === undefined || version(v))
      && Array.isArray(component.evidence) && component.evidence.length <= 16 && component.evidence.every((entry) =>
        fields(entry, ['path', 'kind', 'version'], ['path', 'kind']) && path(entry.path)
        && ['declared', 'resolved', 'installed', 'runtime-target', 'image-declared', 'configured-target'].includes(entry.kind)
        && (entry.version === undefined || version(entry.version)))))
    && guides(data.guides) && Array.isArray(data.limitations) && data.limitations.length <= 4096 && data.limitations.every((v) => text(v, 2048))
    && typeof data.environment === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(data.environment)
    && fields(data.runtime, ['node', 'scope']) && version(data.runtime.node) && data.runtime.scope === 'context-command-process-only';
}
