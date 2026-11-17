// smugan-codex rule-teach — the Codex stand-in for Claude Code's path-scoped
// rule loading. Codex is the one ported host that can inject context WITHOUT
// blocking (PreToolUse additionalContext), so unlike the Grok port this never
// denies: the first patch in a session touching files that match unread stack
// rules gets the rule paths injected into context, once per rule per session.
// Fails open: any internal error means "do not interfere".
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const FRAMEWORK_PACKAGES = new Map([
  ['nextjs', 'next'], ['astro', 'astro'], ['hono', 'hono'],
  ['nest', '@nestjs/core'], ['express', 'express'],
]);

// A nested package is a boundary even when it does not use its parent's stack.
// Config modules are never imported merely to identify a framework.
function nearestPackage(file) {
  let dir = dirname(file);
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if (statSync(manifest).size > 256 * 1024) return null;
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }));
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function frameworkMatches(rule, file, dependencies) {
  if (!/\.(?:[cm]?[jt]sx?|astro|json)$/.test(file)) return false;
  if (dependencies !== null) return dependencies.has(FRAMEWORK_PACKAGES.get(rule));
  // Strong file evidence only when no readable manifest is available. Generic
  // TSX and routes/ directories do not establish which framework owns a file.
  return rule === 'astro' ? file.endsWith('.astro') || /^astro\.config\./.test(basename(file))
    : rule === 'nextjs' && /^next\.config\./.test(basename(file));
}

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

function rulesMarkerPath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe ? join(tmpdir(), 'smugan-codex-rules-' + safe + '.json') : null;
}

// Frontmatter `paths:` block only — the shapes the smugan rules actually use.
function parseRulePaths(mdText) {
  const stripped = mdText.replace(new RegExp('^' + String.fromCharCode(0xfeff)), '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(stripped);
  if (!fm) return [];
  const lines = fm[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^paths:\s*$/.test(line));
  if (start === -1) return [];
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+["']?([^"']+?)["']?\s*$/.exec(line);
    if (!item) break;
    globs.push(item[1]);
  }
  return globs;
}

const escapeLiteral = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Covers what the rule globs use (**/, *, ?, {a,b}); anchored, and matched
// against the full folded path — every real pattern starts with **/.
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { i++; re += '(?:.*/)?'; }
        else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += '(?:' + pattern.slice(i + 1, end).split(',').map(escapeLiteral).join('|') + ')';
      i = end;
    } else {
      re += escapeLiteral(c);
    }
  }
  return new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
}

/**
 * Unread stack rules matching any of the touched files → context text to
 * inject; null = nothing new to teach. Rules are recorded as surfaced BEFORE
 * returning, so a rule is injected once per session no matter how many files
 * match it afterwards.
 * @param {string[]} absFiles @param {unknown} sessionId @param {string} codexHome
 * @param {(file: string) => boolean} [wanted] which rule files may be taught —
 *   the Claude Code plugin reads the checkout's rules, language-specific ones included
 */
export function ruleTeach(absFiles, sessionId, codexHome, wanted = () => true) {
  try {
    if (process.env.SMUGAN_TEACH === '0') return null;
    const marker = rulesMarkerPath(sessionId);
    if (!marker) return null;
    const scratch = fold(tmpdir()) + '/';
    const files = absFiles.map(fold).filter((f) => !f.startsWith(scratch));
    if (files.length === 0) return null;

    const rulesDir = join(codexHome, 'rules');
    let entries;
    try {
      entries = readdirSync(rulesDir).filter((f) => f.endsWith('.md') && wanted(f));
    } catch {
      return null;
    }
    let surfaced = [];
    try {
      const state = JSON.parse(readFileSync(marker, 'utf8'));
      if (Array.isArray(state.surfaced)) surfaced = state.surfaced;
    } catch { /* smugan-ignore empty-catch: no marker yet — first teach of the session */ }

    const hits = [];
    const packages = new Map(files.map((file) => [file, nearestPackage(file)]));
    for (const entry of entries) {
      const rule = entry.slice(0, -3);
      if (surfaced.includes(rule)) continue;
      const globs = parseRulePaths(readFileSync(join(rulesDir, entry), 'utf8'));
      const matches = FRAMEWORK_PACKAGES.has(rule)
        ? files.some((file) => frameworkMatches(rule, file, packages.get(file)))
        : globs.some((g) => files.some((file) => globToRegExp(g).test(file)));
      if (matches) hits.push(rule);
    }
    if (hits.length === 0) return null;

    writeFileSync(marker, JSON.stringify({ surfaced: [...surfaced, ...hits] }));
    return (
      'smugan rules: the files you are editing match stack rule' + (hits.length === 1 ? '' : 's') +
      ' you have not read this session. Read and apply:\n' +
      hits.map((rule) => '  - ' + join(rulesDir, rule + '.md')).join('\n') +
      '\nThis note appears once per rule per session — the rules keep applying after it.\n'
    );
  } catch {
    return null;
  }
}
