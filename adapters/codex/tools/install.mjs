#!/usr/bin/env node
// smugan-codex installer core — idempotent. Installs the smugan passive layer
// for OpenAI Codex (CLI and app share ~/.codex and the same hooks) into:
//   ~/.codex/AGENTS.md        managed block generated from smugan claude/CLAUDE.md
//   ~/.codex/rules/           stack rules (copied from the smugan checkout)
//   ~/.codex/agents/*.toml    critic/flow-critic subagents (generated from md)
//   ~/.codex/hooks/           launcher + rule-teach + smugan.paths.json
//   ~/.codex/hooks.json       merged, never clobbered
//   ~/.agents/skills/smugan*/ audit/build skills with their references
// Single source of truth is the smugan checkout: re-running after updating
// smugan re-syncs everything; the only Codex-specific text is AGENTS.codex.md.
//
// Two Codex-specific care points:
//   - TRUST: Codex refuses hooks whose identity (command + timeout + matcher)
//    it has not approved, and a CHANGED identity silently disarms them
//    (codex-rs/hooks/src/engine/discovery.rs). The generated hook group is
//    byte-stable across reinstalls of the same layout, and the final message
//    always says how to (re)trust.
//   - config.toml is READ, never written: hooks ship enabled on current Codex
//    (features/src/lib.rs: default_enabled true); if the user disabled them,
//    that is their call — the installer warns and moves on.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterAgent, installLanguage, installParts, installRules, retireSkill } from '../../shared/install-tree.mjs';

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
const fwd = (p) => p.replace(/\\/g, '/');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, '..'));
// adapters/codex/ → the smugan repo root two levels up
const smuganDir = resolve(process.argv[3] || process.env.SMUGAN_DIR || join(root, '..', '..'));
const codexDir = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const skillsDir = resolve(process.env.SMUGAN_CODEX_SKILLS_DIR || join(homedir(), '.agents', 'skills'));
const src = (...p) => join(root, 'codex', ...p);
const rewritePaths = (md) => language.apply(md.replace(BOM, '')
  .split('~/.claude/skills/').join(fwd(skillsDir) + '/')
  .split('~/.claude/').join(fwd(codexDir) + '/')
  .split('~/.codex/').join(fwd(codexDir) + '/'));

function fail(message) {
  console.error('smugan-codex install: ' + message);
  process.exit(1);
}

if (!existsSync(join(smuganDir, 'packages', 'gate', 'src', 'hook.mjs'))) {
  fail(
    'smugan repo not found at ' + smuganDir + '\n' +
    'Clone https://github.com/DenisCDev/smugan next to this repo, or set SMUGAN_DIR.',
  );
}
const pathsFile = join(codexDir, 'hooks', 'smugan.paths.json');
const language = installLanguage(smuganDir, pathsFile, fail, 'smugan-codex install');
const parts = installParts(smuganDir, language.previous, fail);

// Only the host's rule-loading paragraph changes; version guidance remains
// common to both hosts. Anchors fail LOUD: installing
// silently broken steering would be worse than not installing.
function transformAgentsMd(claudeMd, codexTail) {
  for (const anchor of ['\n## Stack rules', '\n## Definition of done']) {
    if (!claudeMd.includes(anchor)) {
      fail(
        'anchor "' + anchor.trim() + '" not found in ' + join(smuganDir, 'claude', 'CLAUDE.md') + '\n' +
        'The smugan CLAUDE.md layout changed — update smugan-codex before installing.',
      );
    }
  }
  const codexStack = /(?:^|\n)## Stack rules\r?\n([\s\S]*?)(?=\r?\n## |$)/.exec(codexTail);
  const loadingRule = /^- Stack rules live in .*$/m;
  if (!codexStack || !loadingRule.test(claudeMd)) {
    fail('Stack rules loading paragraph missing — update the adapter before installing.');
  }
  const body = claudeMd.replace(loadingRule, codexStack[1].trim());
  return rewritePaths(body.trimEnd() + '\n\n' + codexTail.replace(codexStack[0], '').trim() + '\n');
}

function copySkill(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      copySkill(from, to);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.md')) {
        writeFileSync(to, rewritePaths(readFileSync(from, 'utf8')));
      } else {
        copyFileSync(from, to);
      }
    } else {
      fail('Unsupported skill entry: ' + from);
    }
  }
}

// --- agent markdown → Codex agent-role TOML ---
// Same shape Codex's own migrator emits (external-agent-migration/src/
// subagents.rs render_agent_toml): name, description, developer_instructions,
// sandbox_mode. Covers the YAML the smugan agents actually use: plain scalars
// and `key: >` folded blocks.

function parseFrontmatter(md) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md.replace(BOM, ''));
  if (!fm) return { fields: {}, body: md };
  const fields = {};
  const lines = fm[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] === '>' || m[2] === '>-') {
      const folded = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        folded.push(lines[++i].trim());
      }
      fields[m[1]] = folded.join(' ');
    } else {
      fields[m[1]] = m[2].trim();
    }
  }
  return { fields, body: md.slice(fm[0].length) };
}

const tomlString = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const tomlMultiline = (s) => '"""\n' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '\n"""';

function agentToml(md) {
  const { fields, body } = parseFrontmatter(md);
  if (!fields.name || !fields.description) return null;
  return [
    'name = ' + tomlString(fields.name),
    'description = ' + tomlString(fields.description),
    // Both reviewers are read-only by contract; Codex maps that to a sandbox.
    'sandbox_mode = "read-only"',
    'developer_instructions = ' + tomlMultiline(body.trim()),
    '',
  ].join('\n');
}

const done = [];
const warnings = [];

// 1. directories
for (const dir of ['rules', 'hooks', 'agents']) {
  mkdirSync(join(codexDir, dir), { recursive: true });
}

// 2. AGENTS.md — managed block between markers; never touches user content
const START = '<!-- >>> smugan:start — managed by smugan-codex install.sh, do not edit inside -->';
const END = '<!-- <<< smugan:end -->';
const claudeMd = readFileSync(join(smuganDir, 'claude', 'CLAUDE.md'), 'utf8').replace(BOM, '');
const codexTail = readFileSync(src('AGENTS.codex.md'), 'utf8').replace(BOM, '');
const block = START + '\n\n' + parts.check(transformAgentsMd(parts.steering(claudeMd), parts.tail(codexTail)), 'AGENTS.md').trim() + '\n\n' + END;
const agentsMdPath = join(codexDir, 'AGENTS.md');
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
installRules(join(smuganDir, 'claude', 'rules'), join(codexDir, 'rules'), rewritePaths, parts.rules(language.wanted), done);

// 4. Complete skill trees; merge owned files without deleting user additions.
// ~/.agents/skills is Codex's current user-skill root; ~/.codex/skills is the
// deprecated one (codex-rs/ext/skills/src/host_roots.rs).
for (const skill of ['smugan', 'smugan-build']) {
  copySkill(join(smuganDir, 'claude', 'skills', skill), join(skillsDir, skill));
  if (parts.on(skill)) done.push('+ ' + fwd(join(skillsDir, skill)) + ' (full content, paths adapted)');
  else retireSkill(join(skillsDir, skill), done, fwd(join(skillsDir, skill)));
}
const buildAgentsDir = join(skillsDir, 'smugan-build', 'agents');
const buildPolicy = join(buildAgentsDir, 'openai.yaml');
if (parts.on('smugan-build') && !existsSync(buildPolicy)) {
  mkdirSync(buildAgentsDir, { recursive: true });
  writeFileSync(buildPolicy, 'policy:\n  allow_implicit_invocation: true\n');
}

// 5. subagents — generated as Codex agent-role TOML
const agentsSrc = join(smuganDir, 'claude', 'agents');
for (const file of readdirSync(agentsSrc).filter(adapterAgent)) {
  if (!parts.on(file)) {
    rmSync(join(codexDir, 'agents', file.replace(/\.md$/, '.toml')), { force: true });
    done.push('- agents/' + file.replace(/\.md$/, '.toml') + ' (disabled: SMUGAN_DISABLE)');
    continue;
  }
  const toml = agentToml(rewritePaths(readFileSync(join(agentsSrc, file), 'utf8')));
  if (!toml) {
    warnings.push('! agents/' + file + ' skipped: no name/description in frontmatter');
    continue;
  }
  const target = file.replace(/\.md$/, '.toml');
  writeFileSync(join(codexDir, 'agents', target), toml);
  done.push('+ agents/' + target + ' (generated from smugan ' + file + ')');
}

// 6. hook launcher + rule-teach module
for (const file of ['smugan-hook.mjs', 'rule-teach.mjs']) {
  copyFileSync(src('hooks', file), join(codexDir, 'hooks', file));
  done.push('+ hooks/' + file);
}

// 7. paths file — the installed hook loads the gate engine from the smugan repo
const gateDir = fwd(join(smuganDir, 'packages', 'gate'));
const gatePackage = join(gateDir, 'package.json');
const gateRequire = createRequire(gatePackage);
const dependencies = JSON.parse(readFileSync(gatePackage, 'utf8').replace(BOM, '')).dependencies || {};
const missing = Object.keys(dependencies).filter((dependency) => {
  try {
    gateRequire.resolve(dependency);
    return false;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return true;
  }
});
if (missing.length) {
  warnings.push('! Context preparation unavailable: missing ' + missing.join(', ') + '.');
  warnings.push('  Install the dependencies: npm ci --ignore-scripts --prefix "' + gateDir + '"');
}
writeFileSync(
  pathsFile,
  JSON.stringify({ gateDir, uiLanguage: language.lang.ui, replyLanguage: language.lang.reply, disable: parts.disabled, installedAt: new Date().toISOString() }, null, 2) + '\n',
);
done.push('+ hooks/smugan.paths.json → ' + gateDir);
done.push(language.summary);
done.push(parts.summary);

// 8. hooks.json — merge, never clobber. Old smugan groups are replaced by the
// fresh ones; the generated groups are BYTE-STABLE for a given install layout,
// because Codex's trust hash covers the hook identity and a gratuitous change
// here would silently disarm the gate until the user re-trusts it.
const hooksPath = join(codexDir, 'hooks.json');
let hooksFile = { hooks: {} };
if (existsSync(hooksPath)) {
  try {
    hooksFile = JSON.parse(readFileSync(hooksPath, 'utf8').replace(BOM, ''));
  } catch {
    fail(hooksPath + ' is not valid JSON — fix it and re-run. Nothing was changed in hooks.json.');
  }
}
// Array.isArray: named props set on an array are dropped by JSON.stringify —
// the merge would print success while writing no smugan groups.
if (!hooksFile.hooks || typeof hooksFile.hooks !== 'object' || Array.isArray(hooksFile.hooks)) hooksFile.hooks = {};
const hooksDir = fwd(join(codexDir, 'hooks'));
const fragment = JSON.parse(
  readFileSync(src('hooks', 'hooks.json'), 'utf8').split('__HOOKS_DIR__').join(hooksDir),
);
for (const [event, groups] of Object.entries(fragment.hooks)) {
  const existing = Array.isArray(hooksFile.hooks[event]) ? hooksFile.hooks[event] : [];
  const kept = existing.flatMap((group) => {
    if (!Array.isArray(group?.hooks)) return [group];
    const hooks = group.hooks.filter((hook) => !/^node "[^"]*[/\\]smugan-hook\.mjs" (?:pre|post|stop|sessionend)$/.test(hook?.command));
    if (hooks.length === group.hooks.length) return [group];
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  hooksFile.hooks[event] = [...kept, ...groups];
}
writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n');
done.push('~ hooks.json (' + Object.keys(fragment.hooks).join('/') + ' groups merged)');

// 9. config.toml — READ ONLY: hooks ship enabled on current Codex; warn if the
// user turned them off, because then everything above is inert.
const configPath = join(codexDir, 'config.toml');
if (existsSync(configPath)) {
  let table = '';
  for (const line of readFileSync(configPath, 'utf8').replace(BOM, '').split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) { table = header[1].trim(); continue; }
    if (table === 'features' && /^\s*(?:codex_)?hooks\s*=\s*false\b/.test(line)) {
      warnings.push(
        '! config.toml has hooks = false under [features] — the smugan gate stays INERT until you remove it.',
      );
    }
  }
}

console.log('smugan-codex installed into ' + codexDir + '\n');
for (const line of done) console.log('  ' + line);
for (const line of warnings) console.log('  ' + line);
console.log('\nWHAT IS STILL MANUAL — Codex refuses untrusted hooks:');
console.log('  1. Restart Codex sessions (hooks are read at startup).');
console.log('  2. Run /hooks inside Codex and TRUST the four smugan hooks');
console.log('     (PreToolUse, PostToolUse, Stop, SessionEnd). Until then the gate does not run.');
console.log('  After a smugan update that changes the hook command, /hooks will show them as');
console.log('  "modified" — trust them again, or the gate is silently off.');
console.log('\n' + (parts.on('smugan') ? 'Deep audit in a session: $smugan — ' : '') + 'CLI: node ' + gateDir + '/bin/smugan.mjs check');
console.log('Local context: node "' + gateDir + '/bin/smugan.mjs" context --json <project-path>');
