// @ts-check
import { lstatSync, readFileSync } from 'node:fs';

/** @typedef {{component: string, version: string, concern: string, summary: string, source: string, reviewedAt: string}} Decision */
const HOSTS = new Set([
  'nodejs.org', 'nextjs.org', 'react.dev', 'astro.build', 'docs.astro.build',
  'supabase.com', 'www.postgresql.org', 'expressjs.com', 'docs.nestjs.com', 'hono.dev',
  'redis.io', 'docs.bullmq.io', 'docs.docker.com', 'glitchtip.com', 'opentelemetry.io',
  'docs.sentry.io', 'lucide.dev', 'phosphoricons.com', 'iconoir.com', 'base-ui.com',
  'coss.com', 'www.heroui.com', 'heroui.com', 'motion.dev', 'gsap.com', 'animejs.com',
  'threejs.org', 'r3f.docs.pmnd.rs', 'drei.docs.pmnd.rs', 'doc.babylonjs.com',
  'docs.rs', 'tokio.rs', 'doc.rust-lang.org', 'developer.mozilla.org',
  'playwright.dev', 'vitest.dev',
]);
const PUBLIC_REPOSITORIES = new Set([
  'cosscom/coss', 'heroui-inc/heroui', 'motiondivision/motion', 'juliangarnier/anime',
  'open-telemetry/opentelemetry-js', 'open-telemetry/opentelemetry-collector',
  'getsentry/sentry-javascript', 'phosphor-icons/react', 'iconoir-icons/iconoir',
  'lucide-icons/lucide', 'pmndrs/drei', 'mrdoob/three.js', 'pmndrs/react-three-fiber',
  'BabylonJS/Babylon.js', 'vercel/next.js', 'withastro/astro', 'supabase/supabase',
  'nodejs/node', 'nestjs/nest', 'honojs/hono', 'redis/redis', 'taskforcesh/bullmq',
]);

/** Validate a deliberately small record, not arbitrary memory or approval.
 * Public sources are allowlisted; URLs are never fetched by this command.
 * @param {unknown} value @returns {value is Decision} */
export function validDecision(value) {
  if (!value || typeof value !== 'object') return false;
  const record = /** @type {Record<string, unknown>} */ (value);
  const fields = ['component', 'version', 'concern', 'summary', 'source', 'reviewedAt'];
  if (Object.keys(record).length !== fields.length || fields.some((field) => typeof record[field] !== 'string')) return false;
  const item = /** @type {Decision} */ (value);
  if (!/^[a-z@][a-z\d@/_.-]{0,79}$/.test(item.component) || !/^\d+(?:\.\d+){0,2}(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(item.version)
    || !/^[a-z][a-z\d-]{0,39}$/.test(item.concern) || item.summary.length < 12 || item.summary.length > 600
    || /[\r\n\x00-\x1f]|https?:|(?:password|token|secret|dsn)\s*[:=]|\b(?:sk-|ghp_|github_pat_|sb_secret_)[\w-]+/i.test(item.summary)
    || !/^\d{4}-\d{2}-\d{2}$/.test(item.reviewedAt)) return false;
  const date = Date.parse(item.reviewedAt + 'T00:00:00Z');
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== item.reviewedAt || date > Date.now()) return false;
  try {
    const url = new URL(item.source);
    const repo = url.pathname.split('/').slice(1, 3).join('/');
    const publicRepository = ['github.com', 'raw.githubusercontent.com'].includes(url.hostname) && PUBLIC_REPOSITORIES.has(repo)
      || url.hostname === 'gitlab.com' && repo === 'glitchtip/glitchtip-backend';
    const versionedDocs = /^v\d+\.docs\.astro\.build$/.test(url.hostname);
    return item.source.length <= 500 && url.protocol === 'https:' && (HOSTS.has(url.hostname) || publicRepository || versionedDocs)
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch { return false; }
}

/** @param {string} file @returns {Decision} */
export function readDecision(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('The research record must be a regular JSON file of up to 4 KiB.');
  let value;
  // PowerShell 5.1 writes UTF-8 with a byte order mark.
  try { value = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch { throw new Error('Invalid research JSON.'); }
  if (!validDecision(value)) throw new Error('Invalid research record: check the six fields, an allowed public source, the date and that it holds no secrets.');
  return value;
}

/** @param {Decision} decision @param {import('./context-resolve.mjs').ResolvedContext} data */
export function observedDecision(decision, data) {
  return data.packages.some((pkg) => pkg.components.some((component) => component.name === decision.component
    && [component.installed, component.resolved, component.declared].includes(decision.version)));
}

/** @param {Decision[]} decisions */
export function decisionStatus(decisions) {
  return decisions.map((decision) => ({ ...decision,
    status: Date.now() - Date.parse(decision.reviewedAt + 'T00:00:00Z') >= 30 * 86400_000 ? 'review-required' : 'recorded',
  }));
}
