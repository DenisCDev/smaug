#!/usr/bin/env node
// smugan-opencode installer core — idempotent. Installs the smugan passive layer
// for OpenCode into ~/.config/opencode/ (AGENTS.md managed block, rules/,
// agents/, skills/, plugins/ + the modules it loads).
// Single source of truth is the smugan checkout: the AGENTS.md body, the
// subagents and the /smugan skill are generated from it at install time, so
// re-running this after updating smugan re-syncs the steering. The only
// OpenCode-specific prose lives in opencode/AGENTS.opencode.md.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterAgent, installLanguage, installParts, installRules, installTree, retireSkill } from '../../shared/install-tree.mjs';

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
const fwd = (p) => p.replace(/\\/g, '/');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, '..'));
// adapters/opencode/ → the smugan repo root two levels up
const smuganDir = resolve(process.argv[3] || process.env.SMUGAN_DIR || join(root, '..', '..'));
const configDir = process.env.OPENCODE_CONFIG_DIR
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');
const src = (...p) => join(root, 'opencode', ...p);

function fail(message) {
  console.error('smugan-opencode install: ' + message);
  process.exit(1);
}

if (!existsSync(join(smuganDir, 'packages', 'gate', 'src', 'hook.mjs'))) {
  fail(
    'smugan repo not found at ' + smuganDir + '\n' +
    'Clone https://github.com/DenisCDev/smugan next to this repo, or set SMUGAN_DIR.',
  );
}
const pathsFile = join(configDir, 'hooks', 'smugan.paths.json');
const language = installLanguage(smuganDir, pathsFile, fail, 'smugan-opencode install');
const parts = installParts(smuganDir, language.previous, fail);
const retarget = (text) => language.apply(text.split('~/.claude/').join(fwd(configDir) + '/'));

const claudeMdPath = join(smuganDir, 'claude', 'CLAUDE.md');

/**
 * The installed AGENTS.md is smugan's CLAUDE.md with the Claude-only Stack rules
 * section swapped for the OpenCode tail. The anchors fail LOUD: installing
 * silently broken steering is worse than not installing.
 */
function transformAgentsMd(claudeMd, tail) {
  for (const anchor of ['\n## Stack rules', '\n## Definition of done']) {
    if (!claudeMd.includes(anchor)) {
      fail(
        'anchor "' + anchor.trim() + '" not found in ' + claudeMdPath + '\n' +
        'The smugan CLAUDE.md layout changed — update smugan-opencode before installing.',
      );
    }
  }
  const start = claudeMd.indexOf('\n## Stack rules');
  const next = claudeMd.indexOf('\n## ', start + 1);
  const body = (claudeMd.slice(0, start) + (next === -1 ? '' : claudeMd.slice(next)))
    .split('~/.claude/')
    .join('~/.config/opencode/');
  return body.trimEnd() + '\n\n' + tail.trim() + '\n';
}

/**
 * Claude agent frontmatter declares `tools: Read, Glob, ...`. OpenCode
 * deprecated that field in favour of `permission:`, and those tool names do not
 * exist there anyway. `edit: deny` carries the whole read-only invariant the
 * agent bodies already state.
 */
function toOpencodeAgent(md, file) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!fm) fail('agent ' + file + ' has no frontmatter — smugan changed shape, update smugan-opencode.');
  const front = fm[1]
    .split(/\r?\n/)
    .filter((line) => !/^tools:/.test(line))
    .join('\n')
    .trimEnd();
  return '---\n' + front + '\nmode: subagent\npermission:\n  edit: deny\n---' + md.slice(fm[0].length);
}

/**
 * The skill needs three changes: Claude paths, the `argument-hint` key (not in
 * OpenCode's frontmatter schema — an unknown key risks the skill being dropped),
 * and the scopes that key documented, which move into the body.
 */
function toOpencodeSkill(md) {
  const SCOPE_ANCHOR = '1. **Scope.**';
  if (!md.includes('argument-hint:')) fail('skill SKILL.md no longer declares argument-hint — update smugan-opencode.');
  if (!md.includes(SCOPE_ANCHOR)) fail('skill SKILL.md no longer has the "' + SCOPE_ANCHOR + '" anchor — update smugan-opencode.');
  return md
    .split('~/.claude/')
    .join('~/.config/opencode/')
    .replace(/^argument-hint:.*\r?\n/m, '')
    .replace(SCOPE_ANCHOR, SCOPE_ANCHOR + ' Scopes: `security | rls | ui | flows | dead-code | full` (default `full`).');
}

const done = [];

// 1. directories
for (const dir of ['rules', 'agents', join('skills', 'smugan'), 'hooks', 'plugins', 'smugan', 'bin']) {
  mkdirSync(join(configDir, dir), { recursive: true });
}

// 2. AGENTS.md — managed block between markers; never touches user content
const START = '<!-- >>> smugan:start — managed by smugan-opencode install.sh, do not edit inside -->';
const END = '<!-- <<< smugan:end -->';
const claudeMd = readFileSync(claudeMdPath, 'utf8').replace(BOM, '');
const tail = readFileSync(src('AGENTS.opencode.md'), 'utf8').replace(BOM, '');
const block = START + '\n\n' + parts.check(language.apply(transformAgentsMd(parts.steering(claudeMd), parts.tail(tail))), 'AGENTS.md').trim() + '\n\n' + END;
const agentsMdPath = join(configDir, 'AGENTS.md');
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

// 3. stack rules — byte-identical copies; the plugin reads their `paths:`
// frontmatter to inject them. They deliberately do NOT go into `instructions`,
// which would load all of them into every single turn.
installRules(join(smuganDir, 'claude', 'rules'), join(configDir, 'rules'), retarget, parts.rules(language.wanted), done);

// 4. subagents — the long "Use PROACTIVELY" description is what makes the main
// agent invoke them through the task tool, exactly as in Claude Code.
const agentsSrc = join(smuganDir, 'claude', 'agents');
for (const file of readdirSync(agentsSrc).filter(adapterAgent)) {
  if (!parts.on(file)) {
    rmSync(join(configDir, 'agents', file), { force: true });
    done.push('- agents/' + file + ' (disabled: SMUGAN_DISABLE)');
    continue;
  }
  const md = readFileSync(join(agentsSrc, file), 'utf8').replace(BOM, '');
  writeFileSync(join(configDir, 'agents', file), language.apply(toOpencodeAgent(md, file)));
  done.push('+ agents/' + file + ' (from smugan, tools → permission)');
}

// 5. /smugan skill
if (parts.on('smugan')) {
  const skillMd = readFileSync(join(smuganDir, 'claude', 'skills', 'smugan', 'SKILL.md'), 'utf8').replace(BOM, '');
  writeFileSync(join(configDir, 'skills', 'smugan', 'SKILL.md'), language.apply(toOpencodeSkill(skillMd)));
  done.push('+ skills/smugan/SKILL.md (from smugan, adapted)');
} else retireSkill(join(configDir, 'skills', 'smugan'), done, 'skills/smugan');
installTree(join(smuganDir, 'claude', 'skills', 'smugan-build'), join(configDir, 'skills', 'smugan-build'), retarget);
if (parts.on('smugan-build')) done.push('+ skills/smugan-build (guides included)');
else retireSkill(join(configDir, 'skills', 'smugan-build'), done, 'skills/smugan-build');

// 6. plugin + the modules it imports (../smugan/*.mjs resolves the same way in
// the repo and installed, so no path rewriting is needed)
copyFileSync(src('plugin', 'smugan.js'), join(configDir, 'plugins', 'smugan.js'));
done.push('+ plugins/smugan.js');
copyFileSync(src('bin', 'gate-runner.mjs'), join(configDir, 'bin', 'gate-runner.mjs'));
done.push('+ bin/gate-runner.mjs');
for (const file of readdirSync(src('smugan')).filter((f) => f.endsWith('.mjs'))) {
  copyFileSync(src('smugan', file), join(configDir, 'smugan', file));
  done.push('+ smugan/' + file);
}

// 7. paths file — where the gate engine lives, and which node runs it (the
// plugin runs under Bun, so it cannot use its own process.execPath)
const gateDir = fwd(join(smuganDir, 'packages', 'gate'));
writeFileSync(
  pathsFile,
  JSON.stringify({ gateDir, uiLanguage: language.lang.ui, replyLanguage: language.lang.reply, disable: parts.disabled, nodeBin: fwd(process.execPath), installedAt: new Date().toISOString() }, null, 2) + '\n',
);
done.push('+ hooks/smugan.paths.json → ' + gateDir);
done.push(language.summary);
done.push(parts.summary);

// 8. plugin settings — our own file, so opencode.json is never touched
// (plugins under <config>/plugins/ are auto-loaded, no config entry needed)
const settingsPath = join(configDir, 'smugan.opencode.json');
if (!existsSync(settingsPath)) {
  const { DEFAULTS } = await import('../opencode/smugan/config.mjs');
  writeFileSync(settingsPath, JSON.stringify(DEFAULTS, null, 2) + '\n');
  done.push('+ smugan.opencode.json (defaults)');
} else {
  done.push('= smugan.opencode.json (kept your settings)');
}

console.log('smugan-opencode installed into ' + configDir + '\n');
for (const line of done) console.log('  ' + line);
console.log('\nRestart OpenCode sessions to pick up the plugin.');
console.log('Verify: `opencode --log-level DEBUG` must start with no plugin error,');
console.log('and a write that violates a smugan rule must fail the tool call.');
console.log((parts.reviewers.length ? 'Reviewers: ' + parts.reviewers.map((r) => '@' + r).join(' and ') + '. ' : '') + (parts.on('smugan') ? 'Deep audit: the smugan skill.' : ''));
console.log('CLI: node ' + gateDir + '/bin/smugan.mjs check');
