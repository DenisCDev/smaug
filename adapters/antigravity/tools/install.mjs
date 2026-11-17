#!/usr/bin/env node
// smugan-antigravity installer core — idempotent. Installs the smugan passive
// layer for Google Antigravity into ~/.gemini/ (steering, hooks on both
// surfaces, subagents, skill).
// Single source of truth is this checkout: the steering is generated from
// claude/CLAUDE.md at install time. Stack rules and skill references are copied
// with host paths; rerun the installer after updating the checkout.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterAgent, installLanguage, installParts, installRules, installTree, retireSkill } from '../../shared/install-tree.mjs';

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
const fwd = (p) => p.replace(/\\/g, '/');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, '..'));
// adapters/antigravity/ → the smugan repo root two levels up
const smuganDir = resolve(process.argv[3] || process.env.SMUGAN_DIR || join(root, '..', '..'));
const geminiDir = process.env.SMUGAN_AGY_HOME || join(homedir(), '.gemini');
const src = (...p) => join(root, 'antigravity', ...p);

// A tool name Antigravity does not know HANGS the subagent process, so the
// list a subagent may declare is validated against what the platform documents.
const KNOWN_TOOLS = new Set([
  'run_command', 'view_file', 'write_to_file', 'replace_file_content',
  'multi_replace_file_content', 'list_dir', 'find_by_name', 'grep_search',
  'search_web', 'read_url_content', 'manage_task', 'schedule',
  'list_permissions', 'ask_permission', 'invoke_subagent', 'define_subagent',
  'send_message', 'manage_subagents', 'ask_question', 'generate_image',
]);
const REVIEWER_TOOLS = ['view_file', 'list_dir', 'find_by_name', 'grep_search', 'run_command'];

// Rules and workflows are capped per file by the platform; steering past that
// is silently truncated, which is worse than not installing it.
const RULE_CHAR_LIMIT = 12000;
const RULE_CHAR_WARN = 8000;

function fail(message) {
  console.error('smugan-antigravity install: ' + message);
  process.exit(1);
}

const claudeMdPath = join(smuganDir, 'claude', 'CLAUDE.md');
if (!existsSync(join(smuganDir, 'packages', 'gate', 'src', 'hook.mjs'))) {
  fail('smugan repo not found at ' + smuganDir + '\nSet SMUGAN_DIR to the checkout root.');
}
const hooksDir = join(geminiDir, 'smugan', 'hooks');
const pathsFile = join(hooksDir, 'smugan.paths.json');
const language = installLanguage(smuganDir, pathsFile, fail, 'smugan-antigravity install');
const parts = installParts(smuganDir, language.previous, fail);
for (const tool of REVIEWER_TOOLS) {
  if (!KNOWN_TOOLS.has(tool)) fail('reviewer tool "' + tool + '" is not a known Antigravity tool — it would hang the subagent.');
}

/**
 * The installed steering is smugan's CLAUDE.md with the Claude-only Stack rules
 * section swapped for the Antigravity tail, and the reviewer bullets rewritten
 * for this host. Every anchor fails LOUD: on a platform where prose adherence
 * is already shaky, silently broken steering is worse than none.
 */
function transformSteering(claudeMd, tail) {
  for (const anchor of ['\n## Stack rules', '\n## Definition of done']) {
    if (!claudeMd.includes(anchor)) {
      fail('anchor "' + anchor.trim() + '" not found in ' + claudeMdPath +
        '\nThe smugan CLAUDE.md layout changed — update smugan-antigravity before installing.');
    }
  }

  const start = claudeMd.indexOf('\n## Stack rules');
  const next = claudeMd.indexOf('\n## ', start + 1);
  let body = claudeMd.slice(0, start) + (next === -1 ? '' : claudeMd.slice(next));
  body = body.split('~/.claude/').join('~/.gemini/');

  // The Definition of done already reserves the reviewers for critical
  // changes, which also suits a free tier that meters "work done"; only the
  // way to call them differs on this host. Each phrase must occur exactly
  // once: a reworded or wrapped bullet fails the install loudly instead of
  // leaving Claude Code wording in the steering.
  // A reviewer turned off with SMUGAN_DISABLE is already gone from the bullet.
  const phrases = parts.on('critic')
    ? [['launch the `critic` subagent', 'call `invoke_subagent` with `critic`'], ['the `flow-critic` subagent', '`invoke_subagent` with `flow-critic`']]
    : [['launch the `flow-critic` subagent', 'call `invoke_subagent` with `flow-critic`']];
  for (const [phrase, replacement] of phrases.filter(([phrase]) => parts.reviewers.some((r) => phrase.includes('`' + r + '`')))) {
    if (body.split(phrase).length !== 2) {
      fail('the reviewer bullet in "## Definition of done" no longer says "' + phrase + '" exactly once in ' +
        claudeMdPath + '\nUpdate smugan-antigravity before installing.');
    }
    body = body.replace(phrase, replacement);
  }

  return body.trimEnd() + '\n\n' + tail.trim() + '\n';
}

/**
 * Claude agent frontmatter declares Claude tool names. Rebuild it for
 * Antigravity: its own tool names and subagent mode. The description already
 * says which changes call for the reviewer.
 */
function toAntigravityAgent(md, file) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!fm) fail('agent ' + file + ' has no frontmatter — smugan changed shape, update smugan-antigravity.');
  const lines = fm[1].split(/\r?\n/);

  const nameLine = lines.find((l) => /^name:\s*\S/.test(l));
  if (!nameLine) fail('agent ' + file + ' has no name in its frontmatter.');
  const descStart = lines.findIndex((l) => /^description:/.test(l));
  if (descStart === -1) fail('agent ' + file + ' has no description — it is what drives delegation.');

  const desc = [lines[descStart]];
  for (const line of lines.slice(descStart + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    desc.push(line);
  }

  const front = [
    nameLine,
    ...desc,
    'tools: [' + REVIEWER_TOOLS.join(', ') + ']',
    'model: inherit',
    'commandExecutionPolicy: auto',
    'subagent: true',
  ].join('\n');
  return '---\n' + front + '\n---' + md.slice(fm[0].length);
}

/** The skill needs Antigravity's frontmatter shape and this host's paths. */
function toAntigravitySkill(md, rulesPath) {
  const SCOPE_ANCHOR = '1. **Scope.**';
  if (!md.includes('argument-hint:')) fail('skill SKILL.md no longer declares argument-hint — update smugan-antigravity.');
  if (!md.includes(SCOPE_ANCHOR)) fail('skill SKILL.md no longer has the "' + SCOPE_ANCHOR + '" anchor — update smugan-antigravity.');
  return md
    .split('~/.claude/rules/').join(fwd(rulesPath) + '/')
    .split('~/.claude/hooks/smugan.paths.json').join(fwd(join(geminiDir, 'smugan', 'hooks', 'smugan.paths.json')))
    .split('~/.claude/').join('~/.gemini/')
    .replace(/^argument-hint:.*\r?\n/m, '')
    .replace(SCOPE_ANCHOR, SCOPE_ANCHOR + ' Scopes: `security | rls | ui | flows | dead-code | full` (default `full`).');
}

/**
 * AGENTS.md is the neutral name and does not collide with the Gemini CLI, which
 * also writes GEMINI.md. Only builds older than 1.20.3 miss it.
 */
function steeringFileName() {
  try {
    const version = String(execFileSync('agy', ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (m) {
      const [major, minor, patch] = m.slice(1).map(Number);
      const older = major < 1 || (major === 1 && (minor < 20 || (minor === 20 && patch < 3)));
      if (older) return 'GEMINI.md';
    }
  } catch { /* smugan-ignore empty-catch: agy not on PATH — assume a current build */ }
  return 'AGENTS.md';
}

/**
 * hooks.json is a map of hook-name → config. Reading is separated from writing
 * so BOTH surfaces can be validated before anything lands: aborting halfway
 * would leave one surface hooked and the other not, while claiming nothing was
 * written.
 */
function readHooks(file) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8').replace(BOM, '').trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('existing ' + file + ' is not valid JSON — fix or move it; nothing was written.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('existing ' + file + ' is not a hook map — fix or move it; nothing was written.');
  }
  return parsed;
}

function writeHooks(file, existing, block) {
  mkdirSync(dirname(file), { recursive: true });
  existing.smugan = block.smugan;
  writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
}

const done = [];

// 0. Everything that can refuse the install is checked BEFORE the first write:
// a failure halfway through would leave one surface hooked and the other not,
// while the message claims nothing was written.
const agentsSrc = join(smuganDir, 'claude', 'agents');
const skillSrc = join(smuganDir, 'claude', 'skills', 'smugan', 'SKILL.md');
for (const required of [claudeMdPath, agentsSrc, skillSrc, join(smuganDir, 'claude', 'skills', 'smugan-build'), join(smuganDir, 'claude', 'rules')]) {
  if (!existsSync(required)) fail('missing in the smugan checkout: ' + required + '\nNothing was written.');
}
const hookTargets = [join(geminiDir, 'config', 'hooks.json'), join(geminiDir, 'antigravity-cli', 'hooks.json')]
  .map((file) => {
    const dir = dirname(file);
    if (existsSync(dir) && !statSync(dir).isDirectory()) {
      fail(dir + ' exists but is not a directory — fix or move it; nothing was written.');
    }
    if (existsSync(file) && !statSync(file).isFile()) {
      fail(file + ' exists but is not a file — fix or move it; nothing was written.');
    }
    return { file, existing: readHooks(file) };
  });

// 1. directories
for (const dir of [hooksDir, join(geminiDir, 'config', 'agents'), join(geminiDir, 'config', 'skills', 'smugan')]) {
  mkdirSync(dir, { recursive: true });
}

// 2. steering — managed block, so a GEMINI.md shared with the Gemini CLI survives
const START = '<!-- >>> smugan:start — managed by smugan-antigravity install.sh, do not edit inside -->';
const END = '<!-- <<< smugan:end -->';
// claude/CLAUDE.md sits outside this adapter's eol=lf attributes, so a Windows
// checkout hands it over as CRLF: every \r counted against the steering budget.
const claudeMd = readFileSync(claudeMdPath, 'utf8').replace(BOM, '').replace(/\r\n/g, '\n');
const tail = readFileSync(src('AGENTS.antigravity.md'), 'utf8').replace(BOM, '');
const block = START + '\n\n' + parts.check(language.apply(transformSteering(parts.steering(claudeMd), parts.tail(tail))), steeringFileName()).trim() + '\n\n' + END;
const steeringPath = join(geminiDir, steeringFileName());
let steering = existsSync(steeringPath) ? readFileSync(steeringPath, 'utf8').replace(BOM, '') : '';
if (steering.includes(START) && steering.includes(END)) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  steering = steering.replace(new RegExp(esc(START) + '[\\s\\S]*?' + esc(END)), block);
  done.push('~ ' + steeringFileName() + ' (managed block regenerated from smugan claude/CLAUDE.md)');
} else {
  steering = steering.trim() ? steering.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  done.push('+ ' + steeringFileName() + ' (managed block generated from smugan claude/CLAUDE.md)');
}
if (!steering.endsWith('\n')) steering += '\n';
if (steering.length > RULE_CHAR_LIMIT) {
  fail(steeringPath + ' would be ' + steering.length + ' characters; Antigravity caps rule files at ' +
    RULE_CHAR_LIMIT + ' and truncates silently past it. Shorten the steering before installing.');
}
writeFileSync(steeringPath, steering);
if (steering.length > RULE_CHAR_WARN) {
  done.push('! ' + steeringFileName() + ' is ' + steering.length + ' chars (limit ' + RULE_CHAR_LIMIT +
    ') — short steering is followed, long steering is not.');
}

// 3. subagents — the long description is what drives delegation
for (const file of readdirSync(agentsSrc).filter(adapterAgent)) {
  if (!parts.on(file)) {
    rmSync(join(geminiDir, 'config', 'agents', file), { force: true });
    done.push('- config/agents/' + file + ' (disabled: SMUGAN_DISABLE)');
    continue;
  }
  const md = readFileSync(join(agentsSrc, file), 'utf8').replace(BOM, '');
  writeFileSync(join(geminiDir, 'config', 'agents', file), language.apply(toAntigravityAgent(md, file)));
  done.push('+ config/agents/' + file);
}

// 4. skill
const rulesPath = join(geminiDir, 'config', 'rules');
const retarget = (text) => language.apply(text.split('~/.claude/hooks/').join(fwd(hooksDir) + '/')
  .split('~/.claude/').join(fwd(join(geminiDir, 'config')) + '/'));
installRules(join(smuganDir, 'claude', 'rules'), rulesPath, retarget, parts.rules(language.wanted), done, 'config/rules/');
installTree(join(smuganDir, 'claude', 'skills', 'smugan-build'), join(geminiDir, 'config', 'skills', 'smugan-build'), retarget);
if (!parts.on('smugan-build')) retireSkill(join(geminiDir, 'config', 'skills', 'smugan-build'), done, 'config/skills/smugan-build');
if (parts.on('smugan')) {
  const skillMd = readFileSync(skillSrc, 'utf8').replace(BOM, '');
  writeFileSync(join(geminiDir, 'config', 'skills', 'smugan', 'SKILL.md'), language.apply(toAntigravitySkill(skillMd, rulesPath)));
  done.push('+ config/skills/smugan/SKILL.md');
} else retireSkill(join(geminiDir, 'config', 'skills', 'smugan'), done, 'config/skills/smugan');

// 5. the hook and the modules it imports
for (const file of ['smugan-hook.mjs', 'normalize.mjs', 'rule-teach.mjs']) {
  copyFileSync(src('hooks', file), join(hooksDir, file));
  done.push('+ smugan/hooks/' + file);
}

// 6. paths file — the engine, installed rules, and which node runs the hook
const gateDir = fwd(join(smuganDir, 'packages', 'gate'));
writeFileSync(
  pathsFile,
  JSON.stringify({ gateDir, uiLanguage: language.lang.ui, replyLanguage: language.lang.reply, disable: parts.disabled, rulesDir: fwd(rulesPath), nodeBin: fwd(process.execPath), installedAt: new Date().toISOString() }, null, 2) + '\n',
);
done.push('+ smugan/hooks/smugan.paths.json → ' + gateDir);
done.push(language.summary);
done.push(parts.summary);

// 7. hooks on both surfaces — one launcher on disk, two registrations. An
// absolute node path matters: a relative command exits 127, and node may not be
// on the hook subprocess's PATH.
const hookBlock = JSON.parse(
  readFileSync(src('hooks', 'hooks.json'), 'utf8')
    .split('__NODE__').join(fwd(process.execPath))
    .split('__HOOKS_DIR__').join(fwd(hooksDir)),
);
for (const { file, existing } of hookTargets) {
  writeHooks(file, existing, hookBlock);
  done.push('~ ' + file.slice(geminiDir.length + 1).replace(/\\/g, '/') + ' (smugan entry merged)');
}

console.log('smugan-antigravity installed into ' + geminiDir + '\n');
for (const line of done) console.log('  ' + line);
console.log('\nRestart Antigravity sessions to pick up the hooks.');
console.log('Verify: a write that violates a smugan rule must fail the tool call,');
console.log('and after any write <tmpdir>/smugan-turn-<conversationId>.json must exist.');
console.log((parts.reviewers.length ? 'Reviewers: invoke_subagent with ' + parts.reviewers.join(' / ') + '. ' : '') + (parts.on('smugan') ? 'Deep audit: the smugan skill.' : ''));
console.log('CLI: node ' + gateDir + '/bin/smugan.mjs check');
