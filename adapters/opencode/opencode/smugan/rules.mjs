// Path-scoped stack rules for OpenCode. Claude Code loads a rule when you touch
// a matching file; OpenCode has no such mechanism, but tool.execute.after can
// append to what the model reads — so the rule text rides along with the write
// that triggered it. Once per rule per session: steering, not nagging.
// Fails open: any internal error means "inject nothing".
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './config.mjs';

export const RULES_DIR = join(ROOT, 'rules');

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

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
 * Rule texts to append for this file, or [] to stay quiet.
 * `surfaced` is the session's Set of already-injected rule names and is
 * updated here — a rule is spent whether or not the model reads it.
 */
export function rulesFor(file, surfaced, maxPerInjection = 2, dir = RULES_DIR) {
  try {
    let entries;
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }
    const target = fold(file);
    const out = [];
    for (const entry of entries) {
      if (out.length >= maxPerInjection) break;
      const name = entry.slice(0, -3);
      if (surfaced.has(name)) continue;
      const text = readFileSync(join(dir, entry), 'utf8');
      if (!parseRulePaths(text).some((g) => globToRegExp(g).test(target))) continue;
      surfaced.add(name);
      out.push(
        `smugan rule \`${name}\` (applies to this file — read it as part of your instructions):\n\n` +
        text.trim() + '\n',
      );
    }
    return out;
  } catch {
    return [];
  }
}
