// @ts-check
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { docsIndex } from './docs-index.mjs';
import { cacheLocation, publishCache, readCache } from './context-cache.mjs';
import { forward, hash, locateProject, takeSnapshot } from './context-io.mjs';
import { resolveContext } from './context-resolve.mjs';
import { withFileLock } from './file-state.mjs';
import { decisionStatus, observedDecision, readDecision } from './context-decisions.mjs';
import { detectAi } from './ai-detect.mjs';
import { guideState } from './ai-guides.mjs';

/** @param {import('./context-resolve.mjs').ResolvedContext} data @param {string} target */
function selectPackages(data, target) {
  const ancestors = data.packages.filter((pkg) => pkg.path === '.' || target === pkg.path || target.startsWith(pkg.path + '/'));
  const nearest = ancestors.sort((a, b) => b.path.length - a.path.length)[0]?.path ?? '.';
  return target === '.' ? data.packages : data.packages.filter((pkg) => pkg.path === nearest || pkg.path.startsWith(target + '/'));
}

/** @param {string[]} args */
export function runContext(args) {
  let target = '.';
  let hasTarget = false;
  let environment = 'local';
  let json = false;
  let disabled = false;
  let refresh = false;
  let recordFile;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--no-cache') disabled = true;
    else if (arg === '--refresh') refresh = true;
    else if (arg === '--record') {
      recordFile = args[++i];
      if (!recordFile || recordFile.startsWith('-')) throw new Error('--record requires the path to a research JSON.');
    }
    else if (arg === '--environment') {
      environment = args[++i] ?? '';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(environment)) throw new Error('Invalid environment: use a label of up to 64 letters, digits, _ or -.');
    } else if (arg.startsWith('-') || hasTarget) throw new Error('Usage: smugan context [target] [--json] [--environment label] [--refresh] [--no-cache]');
    else { target = arg; hasTarget = true; }
  }
  if (recordFile && disabled) throw new Error('--record cannot be combined with --no-cache.');
  const decision = recordFile ? readDecision(resolve(recordFile)) : undefined;
  const location = locateProject(resolve(target));
  const targetPath = forward(relative(location.root, location.target)) || '.';
  const key = hash(JSON.stringify([targetPath, environment]));
  const snapshot = takeSnapshot(location.root, location.target);
  /** @type {string[]} */
  const diagnostics = [];
  const file = disabled ? undefined : cacheLocation(location.root, diagnostics);
  const cache = file ? readCache(file, location.root, diagnostics) : undefined;
  const previous = cache?.entries[key];
  const reusable = !refresh && snapshot.complete && previous?.fingerprint === snapshot.fingerprint;
  let data = reusable ? previous.data : resolveContext(snapshot, environment);
  if (decision && !observedDecision(decision, { ...data, packages: selectPackages(data, targetPath) })) throw new Error('The decision\'s version was not observed in the selected package.');
  let decisions = previous?.fingerprint === snapshot.fingerprint ? previous.decisions ?? [] : [];
  let observedAt = reusable ? previous.observedAt : new Date().toISOString();
  let status = disabled ? 'disabled' : file ? (reusable ? 'reused' : refresh ? 'refreshed' : 'built') : 'unavailable';
  if (file && (!reusable || decision)) {
    try {
      withFileLock(file, () => {
        // Recheck after acquiring the lock: a second writer or editor may have
        // changed inputs while this process parsed its snapshot.
        const verified = takeSnapshot(location.root, location.target);
        if (!verified.complete || verified.fingerprint !== snapshot.fingerprint) throw new Error('Inputs changed');
        const latest = readCache(file, location.root, diagnostics);
        const existing = latest.entries[key];
        decisions = existing?.fingerprint === snapshot.fingerprint ? existing.decisions ?? [] : [];
        if (decision) {
          decisions = [...decisions.filter((item) => item.component !== decision.component || item.concern !== decision.concern), decision];
          if (decisions.length > 32) diagnostics.push('Limit of 32 decisions: the least recently updated record was removed to save the new one.');
          decisions = decisions.slice(-32);
        }
        observedAt = new Date().toISOString();
        latest.entries[key] = { fingerprint: snapshot.fingerprint, observedAt, data, decisions,
          inputs: [...snapshot.files.values()].map(({ path, hash }) => ({ path, hash })),
        };
        const ordered = Object.entries(latest.entries).sort(([, a], [, b]) => b.observedAt.localeCompare(a.observedAt));
        if (ordered.length > 64) diagnostics.push('Limit of 64 contexts: the least recently observed context was removed; it will be rebuilt when requested.');
        latest.entries = Object.fromEntries(ordered.slice(0, 64));
        publishCache(file, latest);
      });
    } catch {
      status = 'unavailable';
      diagnostics.push('Cache not published: input changed, a limit was reached or writing is unavailable. This run\'s context is provisional.');
      // Never report the old snapshot as current after detecting concurrent edits.
      data = resolveContext(takeSnapshot(location.root, location.target), environment);
      decisions = [];
    }
  }
  if (decision && (!file || status === 'unavailable')) throw new Error('Could not persist the decision; the record was not confirmed.');
  // Keep the repository inventory visible while routing only the affected package.
  const selected = selectPackages(data, targetPath);
  const result = {
    schemaVersion: 1, ...data, target: targetPath, observedAt, decisions: decisionStatus(decisions),
    selectedPackages: selected.map((pkg) => pkg.path),
    guides: [...new Set(selected.flatMap((pkg) => pkg.guides))],
    limitations: [...new Set([...data.limitations, ...diagnostics])],
    cache: { status, ...(file ? { path: file } : {}) },
    ai: aiBlock(location.root),
    docs: docsBlock(location.root, selected.map((pkg) => pkg.path), resolve(target)),
  };
  const docsLine = result.docs.length
    ? `Docs for the installed version: ${result.docs.flatMap((d) => d.sources.map((s) => `${s.name}${s.version ? '@' + s.version : ''} in ${s.dir} (${s.files} files)`)).join(', ') || 'type signatures only'}\n`
    : '';
  return json ? JSON.stringify(result, null, 2) + '\n'
    : `Smugan: context ${status}; environment ${environment}.\nPackages: ${result.selectedPackages.join(', ')}\nGuides: ${result.guides.join(', ') || 'none identified'}\n${result.ai.pairs.length ? `IA: ${result.ai.pairs.map((p) => `${p.key} (${p.guide.status})`).join(', ')}\n` : ''}${docsLine}${result.limitations.map((line) => 'Warning: ' + line).join('\n')}\n`;
}

// Each rendered index costs up to ~2k tokens of whoever reads the output.
const MAX_INDEXED_PACKAGES = 4;

/**
 * The docs the installed versions ship, per selected package, and, when the
 * target is a file, the signatures of what it imports. Read fresh like the AI
 * block: installed files are not what the context cache fingerprints.
 * @param {string} root @param {string[]} packages @param {string} target absolute
 */
function docsBlock(root, packages, target) {
  const file = existsSync(target) && statSync(target).isFile() ? target : null;
  const code = file ? readFileSync(file, 'utf8') : null;
  return packages.slice(0, MAX_INDEXED_PACKAGES).flatMap((path) => {
    const index = docsIndex(join(root, path), root, code, file ? dirname(file) : null);
    if (!index) return [];
    return [{
      path,
      sources: index.sources.map((s) => ({ name: s.name, version: s.version, dir: forward(relative(root, s.dir)), files: s.files.length })),
      index: index.text,
    }];
  });
}

/**
 * Engines, models and their guides, read fresh: model ids live in source
 * files the context cache does not fingerprint. Each pair points to its guide
 * in the user's guide folder; the checkout never holds a guide.
 * @param {string} root
 */
function aiBlock(root) {
  const usage = detectAi(root);
  return {
    engines: usage.engines,
    models: usage.models,
    runtimeModel: usage.runtime,
    pairs: usage.pairs.map((p) => {
      const state = guideState(p.key);
      return { ...p, guide: { status: state.status, path: forward(state.path), ...(state.guide ? { expiresAt: state.guide.expiresAt } : {}) } };
    }),
    truncated: usage.truncated,
  };
}
