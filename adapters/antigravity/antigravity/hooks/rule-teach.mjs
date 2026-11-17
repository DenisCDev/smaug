// Stack rules for Antigravity. Claude Code loads a rule when you touch a
// matching file; here the only channel the platform guarantees reaches the
// model is a PreToolUse deny, so the first edit of a governed file is denied
// ONCE — carrying the rule's FULL TEXT inline.
//
// Inline text, not a path: reading a file outside the workspace can trip the
// permission system, and "go read this file" is exactly the instruction style
// the platform's own bug thread (172904) shows the agent narrating instead of
// following. Text that is already in the message cannot be skipped.
//
// Read the installed host-adapted rules named in the paths file. Reinstallation
// updates them; they are injected selectively, not as Always On context.
// Fails open: any internal error means "do not interfere".
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAX_RULES_PER_DENY = 3;
const MAX_DENY_CHARS = 12000;

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

function rulesMarkerPath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe ? join(tmpdir(), 'smugan-agy-rules-' + safe + '.json') : null;
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

// Covers what the rule globs use (**/, *, ?, {a,b}); anchored, matched against
// the full folded path — every real pattern starts with **/.
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
 * Deny reason carrying every matching unread rule, or null to stay quiet.
 * Rules are marked as surfaced BEFORE the deny is returned: one block per rule
 * per session, whether or not the model actually reads it.
 */
export function ruleTeach(absFile, sessionId, rulesDir) {
  try {
    if (process.env.SMUGAN_TEACH === '0') return null;
    const marker = rulesMarkerPath(sessionId);
    if (!marker || !rulesDir) return null;

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

    const target = fold(absFile);
    const hits = [];
    for (const entry of entries) {
      if (hits.length >= MAX_RULES_PER_DENY) break;
      const name = entry.slice(0, -3);
      if (surfaced.includes(name)) continue;
      const text = readFileSync(join(rulesDir, entry), 'utf8');
      if (!parseRulePaths(text).some((g) => globToRegExp(g).test(target))) continue;
      hits.push({ name, text: text.trim() });
    }
    if (hits.length === 0) return null;

    let reason =
      'smugan rules: this file is governed by stack rule' + (hits.length === 1 ? '' : 's') +
      ' you have not been given yet this session. They are below in full — apply them, then retry this exact edit.\n' +
      'This fires once per rule per session and does not repeat.\n';
    const kept = [];
    for (const hit of hits) {
      const block = '\n--- rule: ' + hit.name + ' ---\n' + hit.text + '\n';
      if (reason.length + block.length > MAX_DENY_CHARS) break;
      reason += block;
      kept.push(hit.name);
    }
    if (kept.length === 0) return null;

    writeFileSync(marker, JSON.stringify({ surfaced: [...surfaced, ...kept] }));
    return reason;
  } catch {
    return null;
  }
}
