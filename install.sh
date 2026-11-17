#!/usr/bin/env bash
# smugan installer — idempotent. Installs the passive layer into ~/.claude/
# (CLAUDE.md managed block, rules/, every skill in claude/skills, hooks/), merges the
# hooks into settings.json without destroying existing configuration, and puts the
# smugan command in ~/.local/bin (SMUGAN_BIN_DIR overrides the folder).
# Hooks point at THIS repo's gate: updating the repo updates enforcement.
# --uninstall removes exactly what this script writes and leaves the rest.
set -euo pipefail

MODE="${1:-install}"
if { [ "$MODE" != "install" ] && [ "$MODE" != "--uninstall" ]; } || [ "$#" -gt 1 ]; then
  echo "usage: install.sh [--uninstall]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "smugan install: node is required but was not found on PATH" >&2
  exit 1
fi

SMUGAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# On Git Bash/Cygwin, hand node a native path (D:/smugan, not /d/smugan).
if command -v cygpath >/dev/null 2>&1; then
  SMUGAN_ROOT="$(cygpath -m "$SMUGAN_ROOT")"
fi

node - "$SMUGAN_ROOT" "$MODE" <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
const fwd = (p) => p.replace(/\\/g, '/');
const smuganRoot = path.resolve(process.argv[2]);
const claudeDir = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const src = (...p) => path.join(smuganRoot, 'claude', ...p);
const done = [];
const START = '<!-- >>> smugan:start — managed by smugan install.sh, do not edit inside -->';
const END = '<!-- <<< smugan:end -->';
const SMUGAN_HOOK = /^node "[^"]*[/\\]smugan-hook\.mjs" (?:pre|post|stop|session|bash|sessionend)$/;
const LAUNCHER_MARK = 'smugan-cli-launcher';
const binDir = path.resolve(process.env.SMUGAN_BIN_DIR || path.join(os.homedir(), '.local', 'bin'));
const mdFiles = (dir) => fs.readdirSync(src(dir)).filter((f) => f.endsWith('.md'));
const skillNames = () => fs.readdirSync(src('skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
// A settings event's groups without smugan's commands; a group left empty goes.
const withoutSmugan = (groups) => (Array.isArray(groups) ? groups : []).flatMap((group) => {
  if (!Array.isArray(group?.hooks)) return [group];
  const hooks = group.hooks.filter((hook) => !SMUGAN_HOOK.test(hook?.command));
  if (hooks.length === group.hooks.length) return [group];
  return hooks.length ? [{ ...group, hooks }] : [];
});

if (process.argv[3] === '--uninstall') {
  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings = null;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(BOM, ''));
    } catch {
      console.error('smugan uninstall: ' + settingsPath + ' is not valid JSON — fix it and re-run. Nothing was removed.');
      process.exit(1);
    }
  }
  const remove = (file, label) => {
    if (!fs.existsSync(file)) return;
    fs.rmSync(file);
    done.push('- ' + label);
  };
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const text = fs.readFileSync(claudeMdPath, 'utf8').replace(BOM, '');
    const start = text.indexOf(START);
    const end = start < 0 ? -1 : text.indexOf(END, start);
    if (end >= 0) {
      const before = text.slice(0, start).trimEnd();
      const after = text.slice(end + END.length).trimStart();
      const rest = before + (before && after ? '\n\n' : '') + after;
      if (rest.trim()) fs.writeFileSync(claudeMdPath, rest.trimEnd() + '\n');
      else fs.rmSync(claudeMdPath);
      done.push('- CLAUDE.md (smugan block' + (rest.trim() ? '; the rest was kept)' : '; the file held only the block)'));
    }
  }
  for (const dir of ['rules', 'agents', 'output-styles']) {
    for (const file of mdFiles(dir)) remove(path.join(claudeDir, dir, file), dir + '/' + file);
  }
  // Only the files the install copies: anything else in a skill folder stays.
  // Returns how many entries went.
  const pruneSkill = (source, target) => {
    let gone = 0;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const to = path.join(target, entry.name);
      if (!fs.existsSync(to)) continue;
      if (entry.isDirectory()) gone += pruneSkill(path.join(source, entry.name), to);
      else if (fs.statSync(to).isFile()) {
        fs.rmSync(to);
        gone++;
      }
    }
    if (!fs.readdirSync(target).length) {
      fs.rmdirSync(target);
      gone++;
    }
    return gone;
  };
  for (const skill of skillNames()) {
    const target = path.join(claudeDir, 'skills', skill);
    if (!fs.existsSync(target) || !pruneSkill(src('skills', skill), target)) continue;
    done.push('- skills/' + skill + (fs.existsSync(target) ? ' (files not from smugan were kept)' : ''));
  }
  remove(path.join(claudeDir, 'hooks', 'smugan-hook.mjs'), 'hooks/smugan-hook.mjs');
  remove(path.join(claudeDir, 'hooks', 'smugan.paths.json'), 'hooks/smugan.paths.json');
  for (const name of ['smugan', 'smugan.cmd']) {
    const file = path.join(binDir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile() && fs.readFileSync(file, 'utf8').includes(LAUNCHER_MARK)) remove(file, fwd(file));
  }
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    let changed = false;
    if (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)) {
      for (const [event, groups] of Object.entries(settings.hooks)) {
        if (!Array.isArray(groups)) continue;
        const kept = withoutSmugan(groups);
        if (kept.length === groups.length && kept.every((group, i) => group === groups[i])) continue;
        changed = true;
        if (kept.length) settings.hooks[event] = kept;
        else delete settings.hooks[event];
      }
      if (changed && !Object.keys(settings.hooks).length) delete settings.hooks;
    }
    if (settings.outputStyle === 'Smugan') {
      delete settings.outputStyle;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      done.push('~ settings.json (smugan hooks removed' + (settings.outputStyle === undefined ? ')' : '; outputStyle "' + settings.outputStyle + '" kept)'));
    }
  }
  console.log('smugan removed from ' + claudeDir + '\n');
  for (const line of done.length ? done : ['= nothing from smugan found']) console.log('  ' + line);
  console.log('\nRestart Claude Code sessions to drop the hooks (hooks are read at startup).');
  process.exit(0);
}
// Languages start off (SMUGAN_UI_LANG / SMUGAN_REPLY_LANG, a tag or "off");
// a plain reinstall keeps what the previous install chose.
const { resolveLanguage, applyLanguage, ruleWanted } = require(path.join(smuganRoot, 'packages', 'gate', 'src', 'language.cjs'));
const pathsFile = path.join(claudeDir, 'hooks', 'smugan.paths.json');
let previousPaths = null;
if (fs.existsSync(pathsFile)) {
  try {
    previousPaths = JSON.parse(fs.readFileSync(pathsFile, 'utf8').replace(BOM, ''));
  } catch (error) {
    console.error('smugan install: ' + pathsFile + ' is not valid JSON (' + error.message + ') — languages fall back to the environment.');
  }
}
let lang;
try {
  lang = resolveLanguage(process.env, previousPaths);
} catch (error) {
  console.error('smugan install: ' + error.message);
  process.exit(1);
}
// Cost profile (SMUGAN_PROFILE: completo, economico, minimo), kept across
// reinstalls like the languages. Reviewers on a different model than the
// author is also an opt-in: LLM judges favor text that reads familiar to them
// (Wataoka et al., arXiv 2410.21819); the evidence for code is mixed, so the
// default stays the conversation's model. SMUGAN_REVIEW_MODEL wins over the
// profile. Both are validated before any write.
const profiles = require(path.join(smuganRoot, 'packages', 'gate', 'src', 'profile.cjs'));
let profile;
let reviewModel;
try {
  profile = profiles.resolveProfile(process.env.SMUGAN_PROFILE, previousPaths?.profile);
  reviewModel = profiles.reviewModel(profile, process.env.SMUGAN_REVIEW_MODEL);
} catch (error) {
  console.error('smugan install: ' + error.message);
  process.exit(1);
}
// Parts turned off (SMUGAN_DISABLE: a comma list of reviewers, skills and
// stack rules; "none" clears), kept across reinstalls like the profile.
const parts = require(path.join(smuganRoot, 'packages', 'gate', 'src', 'parts.cjs'));
let disabled;
try {
  disabled = parts.resolveDisable(process.env.SMUGAN_DISABLE, previousPaths?.disable, parts.knownParts(src()));
} catch (error) {
  console.error('smugan install: ' + error.message);
  process.exit(1);
}
const OFF = ' (disabled: SMUGAN_DISABLE)';
const rewritePaths = (md) => applyLanguage(md.replace(BOM, '').split('~/.claude/').join(fwd(claudeDir) + '/'), lang);

// A disabled skill loses its SKILL.md only: the stack rules and the audit read
// the guides under smugan-build/references, and without SKILL.md nothing
// offers the skill to the agent.
function copySkill(source, destination, entrypoint = true) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (!entrypoint && entry.name === 'SKILL.md') {
      fs.rmSync(to, { force: true });
    } else if (entry.isDirectory()) {
      copySkill(from, to);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.md')) fs.writeFileSync(to, rewritePaths(fs.readFileSync(from, 'utf8')));
      else fs.copyFileSync(from, to);
    } else {
      throw new Error('Unsupported skill entry: ' + from);
    }
  }
}

// 1. directories
for (const dir of ['rules', 'skills', 'hooks', 'agents', 'output-styles']) {
  fs.mkdirSync(path.join(claudeDir, dir), { recursive: true });
}

// 2. CLAUDE.md — managed block between markers; never touches user content
const block = START + '\n\n' + profiles.applyProfile(parts.steeringParts(rewritePaths(fs.readFileSync(src('CLAUDE.md'), 'utf8')), disabled), profile, disabled).trim() + '\n\n' + END;
const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
let claudeMd = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8').replace(BOM, '') : '';
if (claudeMd.includes(START) && claudeMd.includes(END)) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  claudeMd = claudeMd.replace(new RegExp(esc(START) + '[\\s\\S]*?' + esc(END)), block);
  done.push('~ CLAUDE.md (managed block updated)');
} else {
  claudeMd = claudeMd.trim() ? claudeMd.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  done.push('+ CLAUDE.md (managed block appended)');
}
fs.writeFileSync(claudeMdPath, claudeMd.endsWith('\n') ? claudeMd : claudeMd + '\n');

// 3. rules, skill, hook launcher
for (const file of mdFiles('rules')) {
  const target = path.join(claudeDir, 'rules', file);
  const off = disabled.includes(file.slice(0, -3));
  if (off || !ruleWanted(file, lang)) {
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      done.push('- rules/' + file + (off ? OFF : ' (removed: the UI language is not pt)'));
    }
    continue;
  }
  fs.writeFileSync(target, rewritePaths(fs.readFileSync(src('rules', file), 'utf8')));
  done.push('+ rules/' + file);
}
for (const skill of skillNames()) {
  const off = disabled.includes(skill);
  copySkill(src('skills', skill), path.join(claudeDir, 'skills', skill), !off);
  done.push(off ? '- skills/' + skill + '/SKILL.md' + OFF : '+ skills/' + skill + ' (full content)');
}
const REVIEWERS = new Set(['critic.md', 'flow-critic.md']);
for (const file of fs.readdirSync(src('agents')).filter((f) => f.endsWith('.md'))) {
  const target = path.join(claudeDir, 'agents', file);
  if (!profiles.agentWanted(file, profile, disabled)) {
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      done.push('- agents/' + file + (disabled.includes(file.slice(0, -3)) ? ' (disabled: SMUGAN_DISABLE)' : ' (removed: profile ' + profile + ')'));
    }
    continue;
  }
  const model = REVIEWERS.has(file) ? reviewModel : null;
  fs.writeFileSync(target, profiles.withModel(rewritePaths(fs.readFileSync(src('agents', file), 'utf8')), model));
  done.push('+ agents/' + file + (model ? ' (model: ' + model + ')' : ''));
}
for (const file of fs.readdirSync(src('output-styles')).filter((f) => f.endsWith('.md'))) {
  fs.writeFileSync(path.join(claudeDir, 'output-styles', file), rewritePaths(fs.readFileSync(src('output-styles', file), 'utf8')));
  done.push('+ output-styles/' + file);
}
fs.copyFileSync(src('hooks', 'smugan-hook.mjs'), path.join(claudeDir, 'hooks', 'smugan-hook.mjs'));
done.push('+ hooks/smugan-hook.mjs');

// 4. paths file — the installed hook loads the gate engine from this repo
const gateDir = fwd(path.join(smuganRoot, 'packages', 'gate'));
const gatePackage = path.join(gateDir, 'package.json');
const gateRequire = createRequire(gatePackage);
const dependencies = JSON.parse(fs.readFileSync(gatePackage, 'utf8').replace(BOM, '')).dependencies || {};
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
  done.push('! Context preparation unavailable: missing ' + missing.join(', ') + '.');
  done.push('  Install the dependencies: npm ci --ignore-scripts --prefix "' + gateDir + '"');
}
fs.writeFileSync(
  pathsFile,
  JSON.stringify({ gateDir, uiLanguage: lang.ui, replyLanguage: lang.reply, profile, reviewModel, disable: disabled, installedAt: new Date().toISOString() }, null, 2) + '\n',
);
done.push('+ hooks/smugan.paths.json → ' + gateDir);
done.push('= UI language: ' + (lang.ui ?? 'off') + ' · reply language: ' + (lang.reply ?? 'off') + ' (SMUGAN_UI_LANG / SMUGAN_REPLY_LANG)');
done.push('= profile: ' + profile + ' · reviewers: ' + (reviewModel ?? 'conversation model') + (profiles.usesFlowCritic(profile) ? '' : ', no flow-critic') + ' (SMUGAN_PROFILE)');
done.push('= disabled: ' + (disabled.length ? disabled.join(', ') : 'none') + ' (SMUGAN_DISABLE)');

// 4b. the smugan command, next to the claude that Claude Code's own installer
// puts in ~/.local/bin. A file there this installer did not write is kept.
const cli = fwd(path.join(gateDir, 'bin', 'smugan.mjs'));
const launchers = [['smugan', '#!/bin/sh\n# ' + LAUNCHER_MARK + ': written by smugan install.sh\nexec node "' + cli + '" "$@"\n']];
if (process.platform === 'win32') {
  launchers.push(['smugan.cmd', '@echo off\r\nrem ' + LAUNCHER_MARK + ': written by smugan install.sh\r\nnode "' + cli.replace(/\//g, '\\') + '" %*\r\n']);
}
fs.mkdirSync(binDir, { recursive: true });
let foreign = false;
for (const [name, body] of launchers) {
  const file = path.join(binDir, name);
  if (fs.existsSync(file) && !(fs.statSync(file).isFile() && fs.readFileSync(file, 'utf8').includes(LAUNCHER_MARK))) {
    done.push('! ' + fwd(file) + ' already exists and was not written by Smugan; left as it was. To use Smugan\'s, rename or delete that file and run install.sh again');
    foreign = true;
    continue;
  }
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
  done.push('+ ' + fwd(file) + ' (smugan command)');
}
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const onPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean).some((dir) => samePath(path.resolve(dir), binDir));
if (!onPath) done.push('! ' + fwd(binDir) + ' is not on the PATH; add the folder to call smugan directly');
const smuganCmd = onPath && !foreign ? 'smugan' : 'node "' + cli + '"';

// 5. settings.json — merge, never clobber. Old smugan entries are replaced.
const settingsPath = path.join(claudeDir, 'settings.json');
let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').replace(BOM, '');
  try {
    settings = JSON.parse(raw);
  } catch {
    console.error('smugan install: ' + settingsPath + ' is not valid JSON — fix it and re-run.');
    console.error('Nothing was changed in settings.json; the rest of the install completed.');
    process.exit(1);
  }
}
const hooksDir = fwd(path.join(claudeDir, 'hooks'));
const fragment = JSON.parse(
  fs.readFileSync(src('hooks', 'settings-fragment.json'), 'utf8').split('__HOOKS_DIR__').join(hooksDir),
);
settings.hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
for (const [event, groups] of Object.entries(fragment.hooks)) {
  settings.hooks[event] = [...withoutSmugan(settings.hooks[event]), ...groups];
}
// Output style: a DEFAULT, never an override. Absent field only — an existing
// value is the user's choice, and /config writes its own into the PROJECT's
// settings.local.json, which wins over this by precedence either way.
// settings.local.json is never touched here: it holds permission state this
// installer has no merge discipline for.
if (settings.outputStyle === undefined) {
  settings.outputStyle = 'Smugan';
  done.push('~ settings.json (outputStyle: Smugan — was unset)');
} else {
  done.push('= settings.json (outputStyle kept as "' + settings.outputStyle + '")');
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
done.push('~ settings.json (' + Object.keys(fragment.hooks).join('/') + ' hooks merged)');

console.log('smugan installed into ' + claudeDir + '\n');
for (const line of done) console.log('  ' + line);
console.log('\nRestart Claude Code sessions to pick up the hooks (hooks are read at startup).');
console.log('The Smugan output style applies after /clear or a new session; switch it in /config.');
console.log((disabled.includes('smugan') ? 'CLI: ' : 'Deep audit inside a session: /smugan — CLI: ') + smuganCmd + ' check');
console.log('Local context: ' + smuganCmd + ' context --json <project-path>');
console.log('Check the installation: ' + smuganCmd + ' doctor');
console.log('What the hooks did in the session: ' + smuganCmd + ' why');
NODE
