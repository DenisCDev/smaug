// @ts-check
// Acceptance contract for one checkout: what the change must do, written from
// the request before any code exists, so the reviewers judge the diff against
// it instead of reconstructing the intent from the code they are judging.
// Stored outside the checkout: it never shows up in git status or a commit.
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { git, hash } from './context-io.mjs';
import { hasCode, withFileLock, writeAtomicJson } from './file-state.mjs';

const STATUSES = new Set(['pending', 'done', 'blocked']);
const LIMITS = { request: 4000, text: 600, item: 300, minCriteria: 3, criteria: 6, list: 6 };

/** @typedef {{ behavior: string, verify: string, status: string, evidence?: string }} Criterion */
/** @typedef {{ version: 1, root: string, createdAt: string, updatedAt: string, request: string,
 *   criteria: Criterion[], outOfScope: string[], decisions: { decision: string, reason: string }[] }} Contract */

/** The checkout the contract belongs to: the Git top level, else the folder itself. @param {string} target */
export function contractRoot(target) {
  const dir = resolve(target);
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  return top.status === 0 && top.stdout.trim() ? resolve(top.stdout.trim()) : dir;
}

/** @param {string} root */
export function contractFile(root) {
  return checkoutStateFile('contracts', root);
}

/** Per-checkout state kept outside the checkout, one folder per kind. @param {string} kind @param {string} root */
export function checkoutStateFile(kind, root) {
  const base = process.env.SMUGAN_CACHE_DIR
    ? join(resolve(process.env.SMUGAN_CACHE_DIR), kind)
    : join(process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'smugan', kind);
  return join(base, hash(root.replace(/\\/g, '/').toLowerCase()).slice(0, 32) + '.json');
}

/** @param {unknown} value @param {number} max */
const text = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

/**
 * @param {unknown} input
 * @returns {{ ok: true, value: Omit<Contract, 'version' | 'root' | 'createdAt' | 'updatedAt'> } | { ok: false, errors: string[] }}
 */
export function validateContract(input) {
  /** @type {string[]} */
  const errors = [];
  const data = /** @type {Record<string, any>} */ (input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  const known = new Set(['request', 'criteria', 'outOfScope', 'decisions']);
  for (const key of Object.keys(data)) if (!known.has(key)) errors.push(`unknown field: ${key}`);
  if (!text(data.request, LIMITS.request)) errors.push(`"request" must be the quoted request, up to ${LIMITS.request} characters`);
  const criteria = Array.isArray(data.criteria) ? data.criteria : [];
  if (criteria.length < LIMITS.minCriteria || criteria.length > LIMITS.criteria) {
    errors.push(`"criteria" must have ${LIMITS.minCriteria} to ${LIMITS.criteria} criteria; a request that fits in fewer needs no contract`);
  }
  criteria.forEach((c, i) => {
    if (!c || typeof c !== 'object') return errors.push(`criterion ${i + 1} must be an object`);
    if (!text(c.behavior, LIMITS.text)) errors.push(`criterion ${i + 1}: "behavior" is the observable behavior, up to ${LIMITS.text} characters`);
    if (!text(c.verify, LIMITS.text)) errors.push(`criterion ${i + 1}: "verify" is the command, test or observation that proves the criterion`);
    for (const key of Object.keys(c)) if (key !== 'behavior' && key !== 'verify') errors.push(`criterion ${i + 1}: unknown field ${key}`);
  });
  const outOfScope = data.outOfScope ?? [];
  if (!Array.isArray(outOfScope) || outOfScope.length > LIMITS.list || !outOfScope.every((o) => text(o, LIMITS.item))) {
    errors.push(`"outOfScope" is a list of up to ${LIMITS.list} short items`);
  }
  const decisions = data.decisions ?? [];
  if (!Array.isArray(decisions) || decisions.length > LIMITS.list
    || !decisions.every((d) => d && typeof d === 'object' && text(d.decision, LIMITS.item) && text(d.reason, LIMITS.item)
      && Object.keys(d).every((k) => k === 'decision' || k === 'reason'))) {
    errors.push(`"decisions" is a list of up to ${LIMITS.list} items with "decision" and "reason"`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      request: data.request.trim(),
      criteria: criteria.map((c) => ({ behavior: c.behavior.trim(), verify: c.verify.trim(), status: 'pending' })),
      outOfScope: outOfScope.map((/** @type {string} */ o) => o.trim()),
      decisions: decisions.map((/** @type {{ decision: string, reason: string }} */ d) => ({ decision: d.decision.trim(), reason: d.reason.trim() })),
    },
  };
}

/** @param {string} root @returns {Contract | null} */
export function readContract(root) {
  const file = contractFile(root);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    // Named with its file and both ways out, so nobody is left with a contract
    // that no command can show, replace or remove.
    throw Object.assign(new Error(`the contract for ${root} is unreadable (${error instanceof Error ? error.message : String(error)}): replace it with --set <contract.json> --replace or remove it with --clear; file: ${file}`), { code: UNREADABLE });
  }
}

/** Error code of a contract file that exists but is not JSON. */
export const UNREADABLE = 'SMUGAN_CONTRACT_UNREADABLE';

/** For --replace and --clear, which must work on a broken file. @param {string} root @returns {{ contract: Contract | null, unreadable: boolean }} */
export function readReplaceable(root) {
  try {
    return { contract: readContract(root), unreadable: false };
  } catch (error) {
    if (!hasCode(error, UNREADABLE)) throw error;
    return { contract: null, unreadable: true };
  }
}

/**
 * One contract per checkout, so a second session or a new task never erases
 * the progress of the first in silence: replacing takes an explicit flag.
 * @param {string} root @param {Omit<Contract, 'version' | 'root' | 'createdAt' | 'updatedAt'>} value
 * @param {{ replace?: boolean }} [options]
 * @returns {{ file: string, contract: Contract, replaced: Contract | null, unreadable: boolean } | { file: string, existing: Contract }}
 */
export function saveContract(root, value, { replace = false } = {}) {
  const file = contractFile(root);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return withFileLock(file, () => {
    const { contract: existing, unreadable } = replace ? readReplaceable(root) : { contract: readContract(root), unreadable: false };
    if (existing && !replace) return { file, existing };
    const now = new Date().toISOString();
    /** @type {Contract} */
    const contract = { version: 1, root, createdAt: now, updatedAt: now, ...value };
    writeAtomicJson(file, contract);
    return { file, contract, replaced: existing, unreadable };
  });
}

/** @param {string} root @param {number} index 1-based @param {string} status @param {string | undefined} evidence */
export function markCriterion(root, index, status, evidence) {
  if (!STATUSES.has(status)) throw new Error(`invalid status: use ${[...STATUSES].join(', ')}`);
  if (status !== 'pending' && evidence === undefined) {
    throw new Error(`"${status}" requires --evidence with what you saw: the command and its result, or the reason it is blocked`);
  }
  if (evidence !== undefined && !text(evidence, LIMITS.text)) throw new Error(`the evidence must have 1 to ${LIMITS.text} characters`);
  const file = contractFile(root);
  if (!existsSync(file)) throw new Error('no contract for this checkout; create one with --set <contract.json>');
  return withFileLock(file, () => {
    const contract = readContract(root);
    if (!contract) throw new Error('no contract for this checkout; create one with --set <contract.json>');
    const criterion = contract.criteria[index - 1];
    if (!criterion) throw new Error(`the contract has ${contract.criteria.length} criteria; there is no criterion ${index}`);
    criterion.status = status;
    if (evidence !== undefined) criterion.evidence = evidence.trim();
    else delete criterion.evidence;
    contract.updatedAt = new Date().toISOString();
    writeAtomicJson(file, contract);
    return contract;
  });
}

/** @param {string} root @returns {boolean} whether a contract existed */
export function clearContract(root) {
  try {
    unlinkSync(contractFile(root));
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

/** @param {string} iso */
function age(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

const LABEL = { pending: 'pending', done: 'done', blocked: 'blocked' };

/** @param {Contract} contract */
export function contractSummary(contract) {
  const done = contract.criteria.filter((c) => c.status === 'done').length;
  return `contract created ${age(contract.createdAt)}, ${done} of ${contract.criteria.length} criteria done, for the request "${contract.request.slice(0, 120)}${contract.request.length > 120 ? '…' : ''}"`;
}

/** @param {Contract} contract */
export function formatContract(contract) {
  const lines = [`Contract for ${contract.root} (created ${age(contract.createdAt)}, updated ${age(contract.updatedAt)})`, '', 'Request:', contract.request, '', 'Criteria:'];
  contract.criteria.forEach((c, i) => {
    lines.push(`${i + 1}. [${LABEL[/** @type {keyof typeof LABEL} */ (c.status)] ?? c.status}] ${c.behavior}`, `   verify: ${c.verify}`);
    if (c.evidence) lines.push(`   evidence: ${c.evidence}`);
  });
  if (contract.outOfScope.length) lines.push('', 'Out of scope:', ...contract.outOfScope.map((o) => `- ${o}`));
  if (contract.decisions.length) lines.push('', 'Decisions made without asking:', ...contract.decisions.map((d) => `- ${d.decision} — ${d.reason}`));
  return lines.join('\n') + '\n';
}

/** @param {string} file */
export function readContractInput(file) {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 64 * 1024) throw new Error(`invalid contract file: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}
