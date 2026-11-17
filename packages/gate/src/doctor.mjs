// @ts-check
// `smugan doctor`: proves the installed Claude Code chain works, without a
// session and without tokens. Every line says what was checked and, when it
// fails, the command that fixes it. Ends with a synthetic Write through the
// installed launcher, which must come back blocked.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';
import { hasCode } from './file-state.mjs';
import { loadConfig } from './config.mjs';
import { applyLanguage, resolveLanguage, ruleWanted } from './language.cjs';
import { agentWanted, applyProfile, resolveProfile, reviewModel, withModel } from './profile.cjs';
import { REVIEWERS, knownParts, resolveDisable, steeringParts } from './parts.cjs';

const START = '<!-- >>> smugan:start';
const END = '<!-- <<< smugan:end -->';
const HOOKS = /** @type {const} */ ([['SessionStart', 'session'], ['PreToolUse', 'bash'], ['PreToolUse', 'pre'], ['PostToolUse', 'post'], ['Stop', 'stop']]);

/** @typedef {{ level: 'ok' | 'warn' | 'fail', text: string }} Line */

/** @param {string} p */
const fwd = (p) => p.replace(/\\/g, '/');
/** @param {string} text */
const lf = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/** @param {string} file */
function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/** @param {string} dir @returns {string[]} paths relative to dir */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path).map((p) => join(entry.name, p)));
    else if (entry.isFile()) out.push(entry.name);
  }
  return out;
}

/**
 * Installed copies against this checkout, rewritten exactly as install.sh
 * rewrites them. A difference means the files were edited by hand or the
 * checkout moved on without a reinstall: `git pull` refreshes the engine,
 * never these copies.
 * @param {string} repo @param {string} claudeDir
 */
function staleCopies(repo, claudeDir) {
  // The languages the install chose shape the copies, so they are compared with them applied.
  const pathsText = readText(join(claudeDir, 'hooks', 'smugan.paths.json'));
  /** @type {{ uiLanguage?: unknown, replyLanguage?: unknown, profile?: unknown, reviewModel?: unknown, disable?: unknown } | null} */
  let installed = null;
  try {
    installed = pathsText ? JSON.parse(pathsText.replace(/^﻿/, '')) : null;
  } catch {
    installed = null; // a broken paths file is reported by the hook check below
  }
  const lang = resolveLanguage({}, installed);
  const profile = resolveProfile(undefined, installed?.profile);
  const disabled = resolveDisable(undefined, installed?.disable, knownParts(join(repo, 'claude')));
  // The model the install wrote into the reviewers; an install older than the
  // record is held to its profile's model.
  const recorded = installed?.reviewModel;
  const model = typeof recorded === 'string' || recorded === null ? recorded : reviewModel(profile, undefined);
  const rewrite = (/** @type {string} */ md) => applyLanguage(lf(md).split('~/.claude/').join(fwd(claudeDir) + '/'), lang);
  /** @type {string[]} */
  const stale = [];
  /** @param {string} source @param {string} installed @param {(text: string) => string} [shape] */
  const compare = (source, installed, shape = (t) => t) => {
    const target = join(claudeDir, installed);
    const expected = source.endsWith('.md') ? shape(rewrite(readFileSync(source, 'utf8'))) : lf(readFileSync(source, 'utf8'));
    const actual = readText(target);
    if (actual === null || lf(actual) !== expected) stale.push(fwd(installed));
  };
  for (const dir of ['rules', 'agents', 'output-styles']) {
    for (const file of readdirSync(join(repo, 'claude', dir)).filter((f) => f.endsWith('.md'))) {
      if (dir === 'rules' && disabled.includes(file.slice(0, -3))) {
        if (existsSync(join(claudeDir, dir, file))) stale.push(`${dir}/${file} (disabled)`);
        continue;
      }
      if (dir === 'rules' && !ruleWanted(file, lang)) continue;
      if (dir === 'agents' && !agentWanted(file, profile, disabled)) {
        const why = disabled.includes(file.slice(0, -3)) ? 'disabled' : `not used by profile ${profile}`;
        if (existsSync(join(claudeDir, dir, file))) stale.push(`${dir}/${file} (${why})`);
        continue;
      }
      // The profile or SMUGAN_REVIEW_MODEL adds a model line to the installed reviewers.
      const reviewer = dir === 'agents' && REVIEWERS.includes(file.slice(0, -3));
      compare(join(repo, 'claude', dir, file), join(dir, file), (t) => (reviewer ? withModel(t, model) : t));
    }
  }
  for (const skill of readdirSync(join(repo, 'claude', 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const root = join(repo, 'claude', 'skills', skill.name);
    for (const file of walk(root)) {
      // A disabled skill keeps its guides and loses only its SKILL.md.
      if (file === 'SKILL.md' && disabled.includes(skill.name)) {
        if (existsSync(join(claudeDir, 'skills', skill.name, file))) stale.push(`skills/${skill.name}/SKILL.md (disabled)`);
      } else compare(join(root, file), join('skills', skill.name, file));
    }
  }
  compare(join(repo, 'claude', 'hooks', 'smugan-hook.mjs'), join('hooks', 'smugan-hook.mjs'));
  const claudeMd = readText(join(claudeDir, 'CLAUDE.md'));
  const start = claudeMd === null ? -1 : claudeMd.indexOf(START);
  const end = claudeMd === null ? -1 : claudeMd.indexOf(END);
  const block = start >= 0 && end > start && claudeMd !== null ? lf(claudeMd.slice(claudeMd.indexOf('\n', start) + 1, end)).trim() : null;
  if (block !== applyProfile(steeringParts(rewrite(readFileSync(join(repo, 'claude', 'CLAUDE.md'), 'utf8')), disabled), profile, disabled).trim()) stale.unshift('CLAUDE.md (smugan block)');
  return { stale, disabled };
}

function gitBash() {
  const configured = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (configured && existsSync(configured) && /^(bash|sh)(\.exe)?$/i.test(basename(configured))) return configured;
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const candidates = where.status === 0 ? where.stdout.split(/\r?\n/).filter(Boolean).map((git) => resolve(dirname(git), '..', 'bin', 'bash.exe')) : [];
  candidates.push(join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe'));
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * The installed launcher, fed the same JSON Claude Code would send. The
 * synthetic project pins its root with an empty .git directory.
 * @param {string} launcher
 */
function endToEnd(launcher) {
  const id = `smugan-doctor-${process.pid}-${Date.now()}`;
  const dir = mkdtempSync(join(tmpdir(), 'smugan-doctor-'));
  /** @param {string} kind @param {unknown} event */
  const run = (kind, event) => spawnSync(process.execPath, [launcher, kind], { input: JSON.stringify(event), encoding: 'utf8', timeout: 30_000, windowsHide: true });
  try {
    mkdirSync(join(dir, '.git'));
    const file = join(dir, 'supabase', 'migrations', '0001_doctor.sql');
    const pre = run('pre', { tool_name: 'Write', session_id: id, tool_input: { file_path: file, content: 'create table clientes (\n  id uuid primary key,\n  nome_completo text\n);\n' } });
    const stop = run('stop', { session_id: id });
    return {
      pre: pre.status === 2 && /smugan gate: blocked/.test(pre.stderr ?? ''),
      preDetail: pre.error ? pre.error.message : `exit ${pre.status}${pre.stderr ? `: ${pre.stderr.split('\n')[0]}` : ''}`,
      stop: stop.status === 0,
      stopDetail: stop.error ? stop.error.message : `exit ${stop.status}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const prefix of ['smugan-turn-', 'smugan-report-', 'smugan-events-', 'smugan-stopdebt-', 'smugan-session-']) {
      try {
        unlinkSync(join(tmpdir(), prefix + id + '.json'));
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
    }
  }
}

/**
 * The smugan command that skills, agents and the README call, written by
 * install.sh to binDir. Without it on the PATH every call costs the agent a
 * failed try before the fallback through smugan.paths.json.
 * @param {string} gateDir @param {string} binDir @param {string} reinstall
 * @returns {Line}
 */
function cliCommand(gateDir, binDir, reinstall) {
  const same = (/** @type {string} */ a, /** @type {string} */ b) => relative(resolve(a), resolve(b)) === '';
  const names = process.platform === 'win32' ? ['smugan', 'smugan.cmd'] : ['smugan'];
  for (const name of names) {
    const file = join(binDir, name);
    const text = readText(file);
    if (text === null) return { level: 'warn', text: `smugan command missing at ${fwd(file)}${reinstall}` };
    if (!text.includes('smugan-cli-launcher')) return { level: 'warn', text: `${fwd(file)} was not written by Smugan's install.sh; agents do not reach this checkout through it. Rename or delete that file and run install.sh again` };
    const target = /node "([^"]+)"/.exec(text)?.[1];
    if (!target || !same(target, join(gateDir, 'bin', 'smugan.mjs'))) return { level: 'warn', text: `the command ${fwd(file)} uses ${target ? fwd(target) : 'another engine'}, not this checkout${reinstall}` };
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const at = dirs.findIndex((dir) => same(dir, binDir));
  if (at < 0) return { level: 'warn', text: `${fwd(binDir)} is not on the PATH: agents fall back to the path in smugan.paths.json; add the folder to the PATH` };
  const shadow = dirs.slice(0, at).flatMap((dir) => names.map((name) => join(dir, name))).find((file) => existsSync(file));
  if (shadow) return { level: 'warn', text: `the PATH finds ${fwd(shadow)} before the Smugan command in ${fwd(binDir)}` };
  return { level: 'ok', text: `smugan command on the PATH (${fwd(binDir)}) points to this checkout` };
}

/**
 * Project settings that switch hooks off for sessions started in this folder.
 * `disableAllHooks` is honored from any settings file; `allowManagedHooksOnly`
 * only from managed settings, which `/status` shows and this check cannot read.
 * @param {string} project @returns {string[]}
 */
function projectHooksOff(project) {
  return ['settings.json', 'settings.local.json'].map((name) => join(project, '.claude', name)).filter((file) => {
    const text = readText(file);
    if (text === null) return false;
    try {
      return JSON.parse(text.replace(/^﻿/, '')).disableAllHooks === true;
    } catch {
      return false; // Claude Code itself reports an unreadable settings file
    }
  });
}

/**
 * @param {{ claudeDir?: string, gateDir: string, project?: string, binDir?: string }} options
 * @returns {Line[]}
 */
export function runDoctor({
  claudeDir = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')),
  gateDir,
  project = process.cwd(),
  binDir = resolve(process.env.SMUGAN_BIN_DIR || join(homedir(), '.local', 'bin')),
}) {
  /** @type {Line[]} */
  const lines = [];
  const ok = (/** @type {string} */ text) => lines.push({ level: 'ok', text });
  const warn = (/** @type {string} */ text) => lines.push({ level: 'warn', text });
  const fail = (/** @type {string} */ text) => lines.push({ level: 'fail', text });
  const repo = resolve(gateDir, '..', '..');
  const reinstall = existsSync(join(repo, 'install.sh')) ? ` — run ${fwd(join(repo, 'install.sh'))}` : ' — run install.sh from the Smugan checkout';

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node}: Smugan requires Node 22 or newer`);

  /** @type {any} JSON from settings.json, shape checked field by field below */
  let settings = null;
  const settingsText = readText(join(claudeDir, 'settings.json'));
  if (settingsText === null) fail(`${fwd(join(claudeDir, 'settings.json'))} does not exist${reinstall}`);
  else {
    try {
      settings = JSON.parse(settingsText.replace(/^\uFEFF/, ''));
    } catch {
      fail(`${fwd(join(claudeDir, 'settings.json'))} is not valid JSON; fix the file and run install.sh again`);
    }
  }

  /** @type {string | null} */
  let launcher = null;
  if (settings) {
    const missing = [];
    for (const [event, kind] of HOOKS) {
      const groups = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
      const found = groups.flatMap((/** @type {any} */ g) => (Array.isArray(g?.hooks) ? g.hooks.map((/** @type {any} */ h) => ({ g, h })) : []))
        .map((/** @type {any} */ { g, h }) => ({ g, match: /^node "([^"]*[/\\]smugan-hook\.mjs)" (pre|post|stop|session|bash)$/.exec(String(h?.command ?? '')) }))
        .find((/** @type {any} */ x) => x.match && x.match[2] === kind);
      if (!found?.match) missing.push(event);
      else {
        launcher ??= found.match[1];
        if ((kind === 'pre' || kind === 'post') && !/\bWrite\b/.test(found.g.matcher ?? '')) warn(`the Smugan ${event} hook does not watch Write (matcher "${found.g.matcher ?? ''}")`);
      }
    }
    if (missing.length) fail(`Smugan hooks missing from settings.json: ${missing.join(', ')}${reinstall}`);
    else ok('SessionStart, PreToolUse (Bash and writes), PostToolUse and Stop hooks registered in settings.json');
    for (const file of projectHooksOff(project)) fail(`"disableAllHooks": true in ${fwd(file)} turns hooks off in sessions in this folder; remove the key`);
    if (settings.disableAllHooks === true) fail(`"disableAllHooks": true in ${fwd(join(claudeDir, 'settings.json'))} turns off every hook, Smugan's included; remove the key`);
    ok(`output style: ${settings.outputStyle ?? 'Claude Code default'}`);
  }

  if (launcher) {
    if (!existsSync(launcher)) {
      fail(`the launcher ${fwd(launcher)} does not exist${reinstall}`);
      launcher = null;
    } else {
      const paths = readText(join(dirname(launcher), 'smugan.paths.json'));
      /** @type {string | null} */
      let installedGate = null;
      try {
        installedGate = paths ? JSON.parse(paths.replace(/^\uFEFF/, '')).gateDir : null;
      } catch {
        installedGate = null;
      }
      if (process.env.SMUGAN_GATE_DIR) warn(`SMUGAN_GATE_DIR is set: the hooks use ${fwd(process.env.SMUGAN_GATE_DIR)}`);
      if (!installedGate || !existsSync(installedGate)) fail(`smugan.paths.json does not point to an existing engine${reinstall}`);
      else if (relative(resolve(installedGate), resolve(gateDir)) !== '') warn(`the hooks use the engine at ${fwd(installedGate)}, not this checkout's (${fwd(gateDir)})`);
      else ok(`hooks point to this checkout: ${fwd(gateDir)}`);
    }
  }

  lines.push(cliCommand(gateDir, binDir, reinstall));

  if (existsSync(join(repo, 'claude', 'CLAUDE.md'))) {
    const { stale, disabled } = staleCopies(repo, claudeDir);
    if (disabled.length) ok(`disabled in this installation: ${disabled.join(', ')} (SMUGAN_DISABLE)`);
    if (stale.length) fail(`installed copies that differ from this checkout (${stale.length}): ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? '…' : ''}${reinstall}`);
    else ok('rules, agents, skills, output style and CLAUDE.md block match this checkout');
  } else {
    warn('engine outside a Smugan checkout: the installed copies were not compared');
  }

  const pkg = JSON.parse(readFileSync(join(gateDir, 'package.json'), 'utf8'));
  const requireGate = createRequire(join(gateDir, 'package.json'));
  const parsers = Object.keys(pkg.dependencies ?? {}).filter((dep) => {
    try {
      requireGate.resolve(dep);
      return false;
    } catch (error) {
      if (hasCode(error, 'MODULE_NOT_FOUND')) return true;
      throw error;
    }
  });
  if (parsers.length) warn(`smugan context unavailable: missing ${parsers.join(', ')} — run npm ci --ignore-scripts --prefix "${fwd(gateDir)}"`);
  else ok('smugan context parsers installed');

  if (process.platform === 'win32') {
    const bash = gitBash();
    if (bash) ok(`Git Bash: ${fwd(bash)}`);
    else warn('Git Bash not found: Claude Code runs the hooks in PowerShell; install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH');
  }

  // 0.20 dropped the build from the Stop; an old opt-in would otherwise go quiet.
  const projectConfig = loadConfig(project);
  if (projectConfig.mode === 'warn') warn(`warn mode active in ${fwd(projectConfig.root)}: the hooks show violations without blocking or holding the end of turn; smugan check still exits 1`);
  if (projectConfig.localConfig) ok(`personal layer active: ${fwd(projectConfig.localConfig)} overrides the project configuration`);
  if (projectConfig.hook.stop && /** @type {Record<string, unknown>} */ (projectConfig.hook.stop).build === true) {
    warn(`"stop": {"build": true} in ${fwd(join(projectConfig.root, 'smugan.config.json'))} no longer has any effect: the end of turn does not run the build; run it in CI or on request`);
  }

  if (launcher) {
    const e2e = endToEnd(launcher);
    if (e2e.pre) ok('test write blocked by the installed hook (migration with a Portuguese name and no RLS)');
    else fail(`the installed hook did not block the test write (${e2e.preDetail})${reinstall}`);
    if (e2e.stop) ok('test end of turn completed by the installed hook');
    else fail(`the end-of-turn hook failed the test (${e2e.stopDetail})${reinstall}`);
  }
  return lines;
}

/** @param {Line[]} lines @param {string} claudeDir */
export function formatDoctor(lines, claudeDir) {
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  const failures = lines.filter((l) => l.level === 'fail').length;
  const warnings = lines.filter((l) => l.level === 'warn').length;
  const summary = failures ? `${failures} installation problem(s); each ✗ line carries the fix.`
    : warnings ? `Installation working, with ${warnings} warning(s).` : 'Installation working.';
  return [`smugan doctor — ${fwd(claudeDir)}`, ...lines.map((l) => `  ${mark[l.level]} ${l.text}`), '', summary].join('\n') + '\n';
}
