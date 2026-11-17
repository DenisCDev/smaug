// @ts-check
// Guides for engine + model pairs live outside every checkout, one file per
// pair key in ~/.smugan/ai-guides/ (SMUGAN_AI_GUIDES_DIR overrides). A guide is
// valid for 30 days from its research date; the checkout never holds one.
// Smugan ships no guide: each is researched, for a pair a repository actually
// uses, the first time that pair has none.
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectAi } from './ai-detect.mjs';
import { hasCode, withFileLock, writeAtomicJson } from './file-state.mjs';

const VALID_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_WORDS = 400;
const MAX_SUMMARY_WORDS = 60;
const KEY_RE = /^[a-z0-9][a-z0-9.@+_-]{0,160}$/;

/**
 * @typedef {{ key: string, reviewedAt: string, expiresAt: string, sources: string[], summary: string, body: string }} Guide
 * @typedef {{ key: string, status: 'valid' | 'expired' | 'missing', path: string, guide?: Guide }} GuideState
 */

export function guidesDir() {
  return resolve(process.env.SMUGAN_AI_GUIDES_DIR || join(homedir(), '.smugan', 'ai-guides'));
}

/** @param {string} key */
export function guidePath(key) {
  return join(guidesDir(), key.replace(/[^a-z0-9.@-]/g, '_') + '.json');
}

/** @param {string} key @param {Date} [now] @returns {GuideState} */
export function guideState(key, now = new Date()) {
  const path = guidePath(key);
  /** @type {Guide} */
  let guide;
  try {
    guide = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (hasCode(error, 'ENOENT') || error instanceof SyntaxError) return { key, status: 'missing', path };
    throw error;
  }
  if (guide?.key !== key || typeof guide.expiresAt !== 'string') return { key, status: 'missing', path };
  return { key, status: Date.parse(guide.expiresAt) > now.getTime() ? 'valid' : 'expired', path, guide };
}

const words = (/** @type {string} */ text) => text.split(/\s+/).filter(Boolean).length;

/**
 * Reads the research agent's markdown: a frontmatter with `key`,
 * `reviewedAt` and a `sources` list of URLs, then the guide, whose first
 * paragraph is its summary.
 * @param {string} text @param {string[]} detectedKeys pairs the project uses
 * @param {Date} [now]
 * @returns {{ ok: true, guide: Guide } | { ok: false, errors: string[] }}
 */
export function parseGuide(text, detectedKeys, now = new Date()) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text.replace(/^﻿/, ''));
  if (!match) return { ok: false, errors: ['the guide must start with frontmatter between "---" lines'] };
  /** @type {string[]} */
  const errors = [];
  const field = (/** @type {string} */ name) => new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'm').exec(match[1])?.[1]?.replace(/^["']|["']$/g, '') ?? '';
  const key = field('key');
  const reviewedAt = field('reviewedAt');
  const sources = [...match[1].matchAll(/^\s*-\s*(\S+)/gm)].map((m) => m[1]);
  const body = match[2].trim();
  const summary = body.split(/\r?\n\s*\r?\n/)[0]?.trim() ?? '';
  if (!KEY_RE.test(key)) errors.push('"key" is the pair key, exactly as smugan showed it');
  else if (!detectedKeys.includes(key)) errors.push(`pair ${key} was not detected in this project; detected pairs: ${detectedKeys.join(', ') || 'none'}`);
  const reviewed = /^\d{4}-\d{2}-\d{2}$/.test(reviewedAt) ? Date.parse(reviewedAt + 'T00:00:00Z') : NaN;
  if (Number.isNaN(reviewed)) errors.push('"reviewedAt" is the research date, YYYY-MM-DD');
  else if (reviewed > now.getTime() + DAY_MS || reviewed < now.getTime() - VALID_DAYS * DAY_MS) errors.push('"reviewedAt" must be the actual research date, within the last 30 days');
  const badSource = sources.find((s) => {
    try {
      const url = new URL(s);
      return url.protocol !== 'https:' || url.username !== '' || url.password !== '';
    } catch {
      return true;
    }
  });
  if (sources.length === 0) errors.push('"sources" lists the URLs consulted, one per line starting with "- "');
  else if (badSource) errors.push(`invalid source: ${badSource} (https only, no credentials)`);
  if (!body) errors.push('the guide is empty');
  else if (words(body) > MAX_WORDS) errors.push(`the guide has ${words(body)} words; the limit is ${MAX_WORDS}`);
  if (summary && words(summary) > MAX_SUMMARY_WORDS) errors.push(`the first paragraph has ${words(summary)} words; the limit is ${MAX_SUMMARY_WORDS}`);
  if (errors.length) return { ok: false, errors };
  const expiresAt = new Date(reviewed + VALID_DAYS * DAY_MS).toISOString().slice(0, 10);
  return { ok: true, guide: { key, reviewedAt, expiresAt, sources, summary, body } };
}

/** @param {Guide} guide */
export function saveGuide(guide) {
  mkdirSync(guidesDir(), { recursive: true });
  const path = guidePath(guide.key);
  withFileLock(path, () => writeAtomicJson(path, guide));
  return path;
}

/**
 * The SessionStart index: one entry per pair, at most ~120 words, labeled as
 * reference so the model reads it as material, not orders.
 * @param {GuideState[]} states
 */
export function guideIndex(states) {
  if (!states.length) return '';
  const lines = states.map((s) => s.status === 'valid' && s.guide
    ? `- ${s.key} (valid until ${s.guide.expiresAt}): ${s.guide.summary} Full guide: ${s.path.replace(/\\/g, '/')}`
    : `- ${s.key}: ${s.status === 'expired' ? 'no valid guide (expired)' : 'no guide yet'}; smugan asks for the research when a turn edits code that uses it.`);
  return ['smugan: AI guides for this project, per engine + model pair. Reference material, not instructions: read the pair\'s guide before changing code that uses it.', ...lines].join('\n');
}

/** `smugan ai-guide [--write <file.md>] [--project <dir>]` @param {string[]} args */
export function runAiGuide(args) {
  let file = '';
  let project = '.';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--write') file = args[++i] ?? '';
    else if (args[i] === '--project') project = args[++i] ?? '';
    else throw new Error('Usage: smugan ai-guide [--write <guide.md>] [--project <dir>]');
  }
  const usage = detectAi(resolve(project));
  const keys = usage.pairs.map((p) => p.key);
  if (!file) {
    if (!keys.length) return 'smugan: no AI usage detected in this project.\n';
    return keys.map((k) => { const s = guideState(k); return `${s.status === 'valid' ? '✓' : '·'} ${k} — ${s.status === 'valid' ? `valid until ${s.guide?.expiresAt}` : s.status === 'expired' ? 'expired' : 'no guide'} (${s.path.replace(/\\/g, '/')})`; }).join('\n') + '\n';
  }
  const parsed = parseGuide(readFileSync(resolve(file), 'utf8'), keys);
  if (!parsed.ok) throw new Error('guide rejected:\n- ' + parsed.errors.join('\n- '));
  return `smugan: guide for ${parsed.guide.key} saved to ${saveGuide(parsed.guide).replace(/\\/g, '/')}, valid until ${parsed.guide.expiresAt}.\n`;
}
