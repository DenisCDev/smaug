#!/usr/bin/env node
// smugan-grok installer core — idempotent. Installs the smugan passive layer for
// Grok Build into ~/.grok/ (AGENTS.md managed block, rules/, agents/, skills/,
// hooks/). Single source of truth is the smugan checkout: the AGENTS.md body,
// the subagents and the /smugan skill are generated/copied from it at install
// time, so re-running this after updating smugan re-syncs the steering — the
// only Grok-specific text lives in grok/AGENTS.grok.md.
// Fallback (SMUGAN_GROK_FALLBACK_SKILLS=1): if custom agents don't load in this
// Grok Build version, installs /critic + /flow-critic skills instead.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterAgent, installLanguage, installParts, installRules, installTree, retireSkill } from '../../shared/install-tree.mjs';

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
const fwd = (p) => p.replace(/\\/g, '/');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, '..'));
// adapters/grok/ → the smugan repo root two levels up
const smuganDir = resolve(process.argv[3] || process.env.SMUGAN_DIR || join(root, '..', '..'));
const grokDir = process.env.GROK_HOME || join(homedir(), '.grok');
const fallbackMode = process.env.SMUGAN_GROK_FALLBACK_SKILLS === '1';
const src = (...p) => join(root, 'grok', ...p);

function fail(message) {
  console.error('smugan-grok install: ' + message);
  process.exit(1);
}

if (!existsSync(join(smuganDir, 'packages', 'gate', 'src', 'hook.mjs'))) {
  fail(
    'smugan repo not found at ' + smuganDir + '\n' +
    'Clone https://github.com/DenisCDev/smugan next to this repo, or set SMUGAN_DIR.',
  );
}
const pathsFile = join(grokDir, 'hooks', 'smugan.paths.json');
const language = installLanguage(smuganDir, pathsFile, fail, 'smugan-grok install');
const parts = installParts(smuganDir, language.previous, fail);
const retarget = (text) => language.apply(text.split('~/.claude/').join(fwd(grokDir) + '/'));

// The generated AGENTS.md is the smugan CLAUDE.md with the Claude-only Stack
// rules section swapped for the Grok tail. Anchors fail LOUD: installing
// silently broken steering would be worse than not installing.
function transformAgentsMd(claudeMd, grokTail) {
  for (const anchor of ['\n## Stack rules', '\n## Definition of done']) {
    if (!claudeMd.includes(anchor)) {
      fail(
        'anchor "' + anchor.trim() + '" not found in ' + join(smuganDir, 'claude', 'CLAUDE.md') + '\n' +
        'The smugan CLAUDE.md layout changed — update smugan-grok before installing.',
      );
    }
  }
  const start = claudeMd.indexOf('\n## Stack rules');
  const next = claudeMd.indexOf('\n## ', start + 1);
  let body = claudeMd.slice(0, start) + (next === -1 ? '' : claudeMd.slice(next));
  body = body.split('~/.claude/').join('~/.grok/');
  let out = body.trimEnd() + '\n\n' + grokTail.trim() + '\n';
  if (fallbackMode && parts.reviewers.length) {
    const names = (/** @type {string} */ pre) => parts.reviewers.map((r) => '`' + pre + r + '`').join(' or ');
    out +=
      '\nSubagents are unavailable in this install: where the Definition of done says to ' +
      'launch the ' + names('') + ' subagent, run the ' + names('/') + ' skill instead.\n';
  }
  return out;
}

// Agent frontmatter declares Claude Code tool names (`tools: Read, Glob, ...`);
// Grok Build's native names are undocumented, and a tools list it cannot
// resolve could load the agent with no tools at all. Drop the line — the
// agent bodies already say read-only.
function stripToolsLine(md) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---/.exec(md);
  if (!fm) return md;
  return fm[0].replace(/^tools:.*\r?\n/m, '') + md.slice(fm[0].length);
}

const done = [];

// 1. directories
const dirs = ['rules', join('skills', 'smugan'), 'hooks', 'agents'];
if (fallbackMode) dirs.push(...parts.reviewers.map((r) => join('skills', r)));
for (const dir of dirs) mkdirSync(join(grokDir, dir), { recursive: true });

// 2. AGENTS.md — managed block between markers; never touches user content
const START = '<!-- >>> smugan:start — managed by smugan-grok install.sh, do not edit inside -->';
const END = '<!-- <<< smugan:end -->';
const claudeMd = readFileSync(join(smuganDir, 'claude', 'CLAUDE.md'), 'utf8').replace(BOM, '');
const grokTail = readFileSync(src('AGENTS.grok.md'), 'utf8').replace(BOM, '');
const block = START + '\n\n' + parts.check(language.apply(transformAgentsMd(parts.steering(claudeMd), parts.tail(grokTail))), 'AGENTS.md').trim() + '\n\n' + END;
const agentsMdPath = join(grokDir, 'AGENTS.md');
let agentsMd = existsSync(agentsMdPath) ? readFileSync(agentsMdPath, 'utf8').replace(BOM, '') : '';
if (agentsMd.includes(START) && agentsMd.includes(END)) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  agentsMd = agentsMd.replace(new RegExp(esc(START) + '[\\s\\S]*?' + esc(END)), block);
  done.push('~ AGENTS.md (managed block regenerated from smugan claude/CLAUDE.md)');
} else {
  agentsMd = agentsMd.trim() ? agentsMd.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  done.push('+ AGENTS.md (managed block generated from smugan claude/CLAUDE.md)');
}
writeFileSync(agentsMdPath, agentsMd.endsWith('\n') ? agentsMd : agentsMd + '\n');

// 3. stack rules — copied from the smugan repo (single source of truth)
installRules(join(smuganDir, 'claude', 'rules'), join(grokDir, 'rules'), retarget, parts.rules(language.wanted), done);

// 4. /smugan skill — the smugan source with its Claude paths rewritten
const skillMd = readFileSync(join(smuganDir, 'claude', 'skills', 'smugan', 'SKILL.md'), 'utf8')
  .replace(BOM, '')
  .split('~/.claude/')
  .join('~/.grok/');
if (parts.on('smugan')) {
  writeFileSync(join(grokDir, 'skills', 'smugan', 'SKILL.md'), language.apply(skillMd));
  done.push('+ skills/smugan/SKILL.md (from smugan, paths rewritten)');
} else retireSkill(join(grokDir, 'skills', 'smugan'), done, 'skills/smugan');
installTree(join(smuganDir, 'claude', 'skills', 'smugan-build'), join(grokDir, 'skills', 'smugan-build'), retarget);
if (parts.on('smugan-build')) done.push('+ skills/smugan-build (guides included)');
else retireSkill(join(grokDir, 'skills', 'smugan-build'), done, 'skills/smugan-build');

// 5. reviewers — subagents by default, skills in fallback mode. The removals
// keep an upgrade/reinstall from leaving both variants active at once (a skill
// with the same auto-trigger description would compete with the agent).
const agentsSrc = join(smuganDir, 'claude', 'agents');
const agentNames = readdirSync(agentsSrc).filter(adapterAgent);
// A reviewer turned off with SMUGAN_DISABLE ships in neither form.
for (const reviewer of ['critic', 'flow-critic'].filter((r) => !parts.on(r))) {
  rmSync(join(grokDir, 'agents', reviewer + '.md'), { force: true });
  rmSync(join(grokDir, 'skills', reviewer), { recursive: true, force: true });
  done.push('- ' + reviewer + ' (disabled: SMUGAN_DISABLE)');
}
if (fallbackMode) {
  for (const skill of parts.reviewers) {
    writeFileSync(join(grokDir, 'skills', skill, 'SKILL.md'), language.apply(readFileSync(src('skills', skill, 'SKILL.md'), 'utf8')));
    done.push('+ skills/' + skill + '/SKILL.md (fallback for subagents)');
  }
  for (const file of agentNames) {
    rmSync(join(grokDir, 'agents', file), { force: true });
  }
} else {
  for (const file of agentNames.filter(parts.on)) {
    const md = readFileSync(join(agentsSrc, file), 'utf8').replace(BOM, '');
    writeFileSync(join(grokDir, 'agents', file), language.apply(stripToolsLine(md)));
    done.push('+ agents/' + file + ' (from smugan, tools line dropped)');
  }
  for (const skill of ['critic', 'flow-critic']) {
    rmSync(join(grokDir, 'skills', skill), { recursive: true, force: true });
  }
}

// 6. hook launcher + rule-teach module
for (const file of ['smugan-hook.mjs', 'rule-teach.mjs']) {
  copyFileSync(src('hooks', file), join(grokDir, 'hooks', file));
  done.push('+ hooks/' + file);
}

// 7. paths file — the installed hook loads the gate engine from the smugan repo
const gateDir = fwd(join(smuganDir, 'packages', 'gate'));
writeFileSync(
  pathsFile,
  JSON.stringify({ gateDir, uiLanguage: language.lang.ui, replyLanguage: language.lang.reply, disable: parts.disabled, installedAt: new Date().toISOString() }, null, 2) + '\n',
);
done.push('+ hooks/smugan.paths.json → ' + gateDir);
done.push(language.summary);
done.push(parts.summary);

// 8. hook config — standalone JSON file, no settings merge needed in Grok Build
const hooksDir = fwd(join(grokDir, 'hooks'));
const fragment = readFileSync(src('hooks', 'hooks.json'), 'utf8').split('__HOOKS_DIR__').join(hooksDir);
writeFileSync(join(grokDir, 'hooks', 'smugan.json'), fragment);
done.push('+ hooks/smugan.json (PreToolUse/PostToolUse/Stop/SessionEnd)');

console.log('smugan-grok installed into ' + grokDir + (fallbackMode ? '  [fallback: skills instead of subagents]' : '') + '\n');
for (const line of done) console.log('  ' + line);
console.log('\nRestart Grok Build sessions to pick up the hooks.');
console.log('Verify with `grok inspect` or the /hooks tab: smugan on PreToolUse, PostToolUse, Stop, SessionEnd.');
if (!fallbackMode && parts.reviewers.length) {
  console.log('Check /agents lists ' + parts.reviewers.join(' and ') + ' — if it does not, re-run with SMUGAN_GROK_FALLBACK_SKILLS=1.');
}
if (parts.on('smugan')) console.log('Deep audit in a session: /smugan');
console.log('CLI: node ' + gateDir + '/bin/smugan.mjs check');
