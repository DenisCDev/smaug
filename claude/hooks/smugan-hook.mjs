#!/usr/bin/env node
// smugan hook entry — thin launcher installed at ~/.claude/hooks/.
// Loads the gate engine from the smugan repo (path written by install.sh into
// smugan.paths.json next to this file) and runs pre/post/stop enforcement.
// The Claude Code plugin runs this same file from the checkout with a second
// argument, "plugin": there is no install step, so the languages come from the
// plugin's options and the steering and stack rules, which a plugin cannot
// ship, arrive as context.
// Fails open: an internal smugan error must never block the session.
// rev smg-chitwuhzyx — a gate that guesses is a gate that lies.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2];
const KIND = ARG === 'pre' || ARG === 'stop' || ARG === 'session' || ARG === 'bash' || ARG === 'steer' || ARG === 'agent' || ARG === 'deps' ? ARG : 'post';
const PLUGIN = process.argv[3] === 'plugin';
// post carries context only in warn mode: the findings that would have blocked.
const CONTEXT_EVENT = { pre: 'PreToolUse', post: 'PostToolUse', session: 'SessionStart', steer: 'SessionStart' };
const BOM = /^﻿/;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function gateDir() {
  if (process.env.SMUGAN_GATE_DIR) return process.env.SMUGAN_GATE_DIR;
  try {
    const paths = JSON.parse(
      readFileSync(join(HERE, 'smugan.paths.json'), 'utf8').replace(BOM, ''),
    );
    // The install's UI language decides which language-specific checks run.
    if (process.env.SMUGAN_UI_LANG === undefined && typeof paths.uiLanguage === 'string') process.env.SMUGAN_UI_LANG = paths.uiLanguage;
    if (process.env.SMUGAN_PROFILE === undefined && typeof paths.profile === 'string') process.env.SMUGAN_PROFILE = paths.profile;
    if (process.env.SMUGAN_DISABLE === undefined && Array.isArray(paths.disable)) process.env.SMUGAN_DISABLE = paths.disable.join(',');
    if (paths.gateDir && existsSync(paths.gateDir)) return paths.gateDir;
  } catch { /* smugan-ignore empty-catch: no paths file — fall back to the repo-relative layout */ }
  const local = join(HERE, '..', '..', 'packages', 'gate');
  return existsSync(local) ? local : null;
}

/**
 * The install.sh copy in the user's Claude config: its paths file, or its hook
 * commands in settings.json. With it active, the plugin would run every hook a
 * second time and send its own steering beside the managed CLAUDE.md block.
 * @returns {string | null} the config folder that holds it
 */
function globalInstall() {
  const dir = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  if (existsSync(join(dir, 'hooks', 'smugan.paths.json'))) return dir;
  /** @type {any} JSON from settings.json, read only for its hook commands */
  let settings;
  try {
    settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8').replace(BOM, ''));
  } catch (error) {
    // No settings, or settings Claude Code itself reports as broken: no install to defer to.
    if (/** @type {any} */ (error)?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
  const hooks = settings?.hooks && typeof settings.hooks === 'object' ? Object.values(settings.hooks).flat() : [];
  const installed = hooks.some((group) => Array.isArray(group?.hooks) && group.hooks.some((/** @type {any} */ hook) => /^node "[^"]*[/\\]smugan-hook\.mjs" \w+$/.test(String(hook?.command ?? ''))));
  return installed ? dir : null;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    // Windows shells can swallow stdin EOF for hook processes — never hang the session.
    setTimeout(done, 2000).unref();
  });
}

// Models the Agent tool's model parameter accepts; plugin agent files are
// static, so the reviewer's model travels with each dispatch.
const AGENT_MODELS = new Set(['sonnet', 'opus', 'haiku', 'fable']);

/**
 * The plugin's ui_language, reply_language, profile and disable options, which
 * Claude Code hands every plugin hook as CLAUDE_PLUGIN_OPTION_*. They set
 * SMUGAN_UI_LANG, SMUGAN_PROFILE and SMUGAN_DISABLE for the engine the way
 * smugan.paths.json does for an install.
 * @param {string} dir
 */
async function pluginLanguage(dir) {
  const language = (await import(pathToFileURL(join(dir, 'src', 'language.cjs')).href)).default;
  const profiles = (await import(pathToFileURL(join(dir, 'src', 'profile.cjs')).href)).default;
  // From the checkout, like the rule teaching: the plugin is always one.
  const engine = join(resolve(HERE, '..', '..'), 'packages', 'gate', 'src');
  const parts = (await import(pathToFileURL(join(engine, 'parts.cjs')).href)).default;
  const { loadConfig } = await import(pathToFileURL(join(engine, 'config.mjs')).href);
  const known = parts.knownParts(join(HERE, '..'));
  let lang = { ui: null, reply: null };
  /** @type {string[]} */
  const warnings = [];
  try {
    lang = language.resolveLanguage({
      SMUGAN_UI_LANG: process.env.CLAUDE_PLUGIN_OPTION_UI_LANGUAGE,
      SMUGAN_REPLY_LANG: process.env.CLAUDE_PLUGIN_OPTION_REPLY_LANGUAGE,
    }, null);
  } catch {
    warnings.push('ui_language and reply_language must be a language code (pt-BR, en, es…) or "off"; both are off for this session.');
  }
  let profile = 'completo';
  try {
    profile = profiles.resolveProfile(process.env.CLAUDE_PLUGIN_OPTION_PROFILE, null);
  } catch {
    warnings.push('profile must be completo, economico or minimo; this session uses completo.');
  }
  /** @type {string[]} */
  let installed = [];
  try {
    installed = parts.resolveDisable(process.env.CLAUDE_PLUGIN_OPTION_DISABLE, null, known);
  } catch (error) {
    warnings.push(`disable: ${error instanceof Error ? error.message : String(error)}; nothing is disabled in this session.`);
  }
  let model = profiles.reviewModel(profile, undefined);
  const override = (process.env.SMUGAN_REVIEW_MODEL ?? '').trim();
  if (override === 'inherit') model = null;
  else if (AGENT_MODELS.has(override)) model = override;
  else if (override) warnings.push(`SMUGAN_REVIEW_MODEL=${override} does not apply to the plugin, which only passes sonnet, opus, haiku, fable or inherit when launching a reviewer; the profile's model applies.`);
  process.env.SMUGAN_UI_LANG = lang.ui ?? '';
  process.env.SMUGAN_PROFILE = profile;
  process.env.SMUGAN_DISABLE = installed.join(',');
  /**
   * The option's list plus the project's "disable" (config layers found from
   * cwd), kept to names this checkout ships.
   * @param {unknown} cwd @returns {string[]}
   */
  const disabledAt = (cwd) => {
    const project = typeof cwd === 'string' && cwd ? parts.knownOnly(loadConfig(cwd).disable, known) : [];
    return [...new Set([...installed, ...project])].sort();
  };
  return { language, lang, profiles, profile, model, warnings, parts, disabledAt };
}

/**
 * Enforces the profile and the disabled parts on each dispatch of a smugan
 * reviewer or skill: a plugin ships every agent and skill, so a disabled one is
 * refused here; flow-critic is refused under minimo, and a reviewer launched
 * with a model other than the profile's is refused with the parameter to use.
 * The unprefixed name counts too: it reaches the same plugin agent.
 * @param {any} input @param {{ profiles: any, profile: string, model: string | null, disabledAt: (cwd: unknown) => string[] }} plugin
 * @returns {string | null} the reason to deny, or null to let it run
 */
function reviewerGuard(input, { profiles, profile, model, disabledAt }) {
  const disabled = disabledAt(input?.cwd);
  if (input?.tool_name === 'Skill') {
    const skill = String(input?.tool_input?.skill ?? '').replace(/^\//, '');
    return skill.startsWith('smugan:') && disabled.includes(skill.slice('smugan:'.length))
      ? `smugan: the skill ${skill} is disabled (disable). Do not use it; continue without it.`
      : null;
  }
  const name = String(input?.tool_input?.subagent_type ?? '');
  const reviewer = name.replace(/^smugan:/, '');
  if (reviewer !== 'critic' && reviewer !== 'flow-critic') return null;
  if (disabled.includes(reviewer)) {
    return `smugan: the reviewer ${name} is disabled (disable). Do not launch it.`;
  }
  if (reviewer === 'flow-critic' && !profiles.usesFlowCritic(profile)) {
    return `smugan: profile ${profile} does not use flow-critic. Do not launch it; smugan:critic is the review for this change.`;
  }
  const asked = input?.tool_input?.model;
  if (model && asked !== model) {
    return `smugan: profile ${profile} runs the reviewers on ${model}. Launch ${name} again with model: "${model}".`;
  }
  if (!model && asked !== undefined && asked !== 'inherit') {
    return `smugan: in this session the reviewers run on the conversation's model, not on ${String(asked)}. Launch ${name} again without the model parameter.`;
  }
  return null;
}

/**
 * CLAUDE.md as install.sh would write it, pointed at this checkout, plus what
 * changes when smugan runs as a plugin.
 * @param {{ language: any, lang: { ui: string | null, reply: string | null } }} plugin
 * @param {string[]} disabled the option's list plus the session folder's
 */
function steering({ language, lang, profiles, profile, model, parts }, disabled) {
  const root = resolve(HERE, '..', '..').replace(/\\/g, '/');
  const claudeMd = readFileSync(join(root, 'claude', 'CLAUDE.md'), 'utf8').replace(BOM, '').replace(/\r\n/g, '\n');
  const text = parts.steeringParts(language.applyLanguage(claudeMd.split('~/.claude/').join(root + '/claude/'), lang), disabled);
  const rules = profiles.applyProfile(text, profile, disabled).trim();
  const on = profiles.reviewers(profile, disabled);
  // The plugin's agent and skill listings are static: a disabled one still
  // shows there, so the steering says once not to use it.
  const off = [...parts.REVIEWERS.filter((/** @type {string} */ r) => !on.includes(r)), ...parts.SKILLS.filter((/** @type {string} */ s) => disabled.includes(s))];
  const code = (/** @type {string} */ n) => '`smugan:' + n + '`';
  const examples = ['smugan-build', on[0]].filter((n) => n && !disabled.includes(n)).map(code);
  return rules + '\n\n## Plugin install\n\n' + [
    `- smugan runs as a Claude Code plugin from \`${root}\`; its skills and agents carry the \`smugan:\` prefix${examples.length ? ' (' + examples.join(', ') + ')' : ''}.`,
    `- Where its skills, agents and rules say \`~/.claude/\`, read \`${root}/claude/\`. Where they take \`gateDir\` from \`smugan.paths.json\`, use \`${root}/packages/gate\`: the plugin writes no such file.`,
    '- Stack rules do not load by themselves here: the first edit of a matching file names the rule to read.',
    ...(model && on.length ? [`- Cost profile ${profile}: launch every smugan reviewer with the Agent tool's \`model: "${model}"\`.`] : []),
    ...(off.length ? ['- Not used in this install: ' + off.map(code).join(', ') + '. Do not launch or invoke ' + (off.length === 1 ? 'it' : 'them') + (on.length ? '; the review is ' + on.map(code).join(' and ') : '') + '.'] : []),
    `- Without \`smugan\` on PATH, run \`node "${root}/packages/gate/bin/smugan.mjs" <command>\`` +
      (lang.ui ? ` with \`SMUGAN_UI_LANG=${lang.ui}\` in its environment.` : '.'),
  ].join('\n') + '\n';
}

/**
 * Claude Code loads a rule from ~/.claude/rules when a matching file is
 * touched; a plugin has no rules folder, so the first edit of a matching file
 * names the rule, once per rule per session — the Codex port's mechanism.
 * @param {any} input @param {{ language: any, lang: { ui: string | null } }} plugin
 */
async function teachRules(input, { language, lang, disabledAt }) {
  const file = input?.tool_input?.file_path;
  if (!EDIT_TOOLS.has(input?.tool_name) || typeof file !== 'string') return null;
  const root = resolve(HERE, '..', '..');
  const { ruleTeach } = await import(pathToFileURL(join(root, 'adapters', 'codex', 'codex', 'hooks', 'rule-teach.mjs')).href);
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const disabled = disabledAt(cwd);
  return ruleTeach([resolve(cwd, file)], input.session_id, join(root, 'claude'), (rule) => language.ruleWanted(rule, lang) && !disabled.includes(rule.slice(0, -3)));
}

try {
  const global = PLUGIN ? globalInstall() : null;
  if (global) {
    if (KIND === 'steer') {
      const note = `smugan: the global install (install.sh) at ${global.replace(/\\/g, '/')} is active: the plugin's hooks do not act in this session, but its smugan:* skills and agents stay listed and do not follow the profile. Use only one of the two. To keep only the plugin, run ./install.sh --uninstall in the Smugan checkout; to keep only the global install, disable the plugin (claude plugin disable smugan@smugan).`;
      process.stdout.write(JSON.stringify({ systemMessage: note }) + '\n');
    }
    process.exit(0);
  }
  const dir = gateDir();
  if (!dir) throw new Error('Gate engine unavailable');
  if (KIND === 'deps') {
    // The plugin cache has no node_modules, and smugan context needs three parsers.
    const { installPluginDeps } = await import(pathToFileURL(join(dir, 'src', 'deps.mjs')).href);
    const warning = PLUGIN ? installPluginDeps(dir, process.env.CLAUDE_PLUGIN_DATA) : null;
    if (warning) process.stdout.write(JSON.stringify({ systemMessage: 'smugan: ' + warning }) + '\n');
    process.exit(0);
  }
  const plugin = PLUGIN ? await pluginLanguage(dir) : null;
  if (KIND === 'steer') {
    if (!plugin) process.exit(0);
    const warning = plugin.warnings.length ? { systemMessage: 'smugan: ' + plugin.warnings.join(' ') } : {};
    const event = JSON.parse((await readStdin()).replace(BOM, '').trim() || '{}');
    process.stdout.write(JSON.stringify({ ...warning, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: steering(plugin, plugin.disabledAt(event?.cwd)) } }) + '\n');
    process.exit(0);
  }
  if (KIND === 'agent') {
    const reason = plugin ? reviewerGuard(JSON.parse((await readStdin()).replace(BOM, '').trim() || '{}'), plugin) : null;
    if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) + '\n');
    process.exit(0);
  }
  const { runHook } = await import(pathToFileURL(join(dir, 'src', 'hook.mjs')).href);
  const raw = (await readStdin()).replace(BOM, '').trim();
  const input = raw ? JSON.parse(raw) : {};
  let { exitCode, stderr, stdout, context } = await runHook(KIND, input);
  const taught = plugin && KIND === 'pre' ? await teachRules(input, plugin) : null;
  if (taught && exitCode === 0) context = [context, taught].filter(Boolean).join('\n\n');
  else if (taught) stderr = (stderr ?? '').trimEnd() + '\n\n' + taught;
  // Non-empty stdout on a Stop block keeps Claude Code from demoting the
  // exit-2 hold to "hook script appears to be missing" (its heuristic needs
  // an empty stdout to fire).
  const event = CONTEXT_EVENT[/** @type {keyof typeof CONTEXT_EVENT} */ (KIND)];
  if (context && event && exitCode === 0) {
    // A fail-open notice rides in stdout; context must not silence it.
    const notice = stdout ? JSON.parse(stdout).systemMessage : undefined;
    process.stdout.write(JSON.stringify({ ...(notice ? { systemMessage: notice } : {}), hookSpecificOutput: { hookEventName: event, additionalContext: context } }) + '\n');
  } else if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
} catch {
  process.stdout.write(JSON.stringify({ systemMessage: 'smugan: gate unavailable — the engine could not finish this event. The check did not pass. Check the installation and run the checks again.' }) + '\n');
  process.exit(0);
}
