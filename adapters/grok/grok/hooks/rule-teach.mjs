// smugan-grok rule-teach — the Grok Build stand-in for Claude Code's path-scoped
// rule loading. The platform cannot inject context when a file is touched, so
// the one blocking channel (PreToolUse deny) teaches instead: the first edit in
// a session of a file matching stack rules not yet read is denied ONCE, naming
// the rule files to read. All matching rules are surfaced in a single deny (a
// .tsx file matches three) and recorded BEFORE denying — steering, not police:
// a rule never blocks twice, even if the model skips the reading.
// Fails open: any internal error means "do not interfere".
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

function rulesMarkerPath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe ? join(tmpdir(), 'smugan-grok-rules-' + safe + '.json') : null;
}

// Frontmatter `paths:` block only — the shapes the smugan rules actually use.
function parseRulePaths(mdText) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(mdText.replace(/^\uFEFF/, ''));
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

/** First session edit of a file matching unread stack rules → deny reason; null = do not interfere. */
export function ruleTeach(absFile, sessionId, grokHome) {
  try {
    if (process.env.SMUGAN_TEACH === '0') return null;
    const marker = rulesMarkerPath(sessionId);
    if (!marker) return null;
    const file = fold(absFile);
    // Throwaway scripts under the temp dir are scratch — they don't teach.
    if (file.startsWith(fold(tmpdir()) + '/')) return null;

    const rulesDir = join(grokHome, 'rules');
    let entries;
    try {
      entries = readdirSync(rulesDir).filter((f) => f.endsWith('.md'));
    } catch {
      return null;
    }
    let surfaced = [];
    try {
      const state = JSON.parse(readFileSync(marker, 'utf8'));
      if (Array.isArray(state.surfaced)) surfaced = state.surfaced;
    } catch { /* smugan-ignore empty-catch: no marker yet — first teach of the session */ }

    const hits = [];
    for (const entry of entries) {
      const rule = entry.slice(0, -3);
      if (surfaced.includes(rule)) continue;
      const globs = parseRulePaths(readFileSync(join(rulesDir, entry), 'utf8'));
      if (globs.some((g) => globToRegExp(g).test(file))) hits.push(rule);
    }
    if (hits.length === 0) return null;

    writeFileSync(marker, JSON.stringify({ surfaced: [...surfaced, ...hits] }));
    return (
      'smugan rules: this file matches stack rule' + (hits.length === 1 ? '' : 's') +
      ' you have not read this session. Read:\n' +
      hits.map((rule) => '  - ' + join(rulesDir, rule + '.md')).join('\n') +
      '\nthen retry this exact edit. This block fires once per rule per session — the rules keep applying after it.\n'
    );
  } catch {
    return null;
  }
}
