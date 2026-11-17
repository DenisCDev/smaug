// @ts-check
// The Claude Code plugin: the checkout is the plugin root, its manifest points
// at claude/, and the launcher runs with "plugin" to deliver what a plugin
// cannot ship as files — the steering in CLAUDE.md and the stack rules.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LAUNCHER = join(ROOT, 'claude', 'hooks', 'smugan-hook.mjs');
/** @param {string} path */
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const manifest = json('.claude-plugin/plugin.json');
// A Claude config with no global install, so the machine's own never mutes the plugin.
const noInstall = mkdtempSync(join(tmpdir(), 'smugan-plugin-config-'));
after(() => rmSync(noInstall, { recursive: true, force: true }));

/** @param {string} kind @param {unknown} payload @param {Record<string, string>} [env] */
function run(kind, payload, env = {}) {
  const result = spawnSync(process.execPath, [LAUNCHER, kind, 'plugin'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: noInstall, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_OPTION_UI_LANGUAGE: 'off', CLAUDE_PLUGIN_OPTION_REPLY_LANGUAGE: 'off', ...env },
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

test('the manifest names only existing files inside the checkout, and the marketplace lists it', () => {
  const paths = [manifest.skills, ...manifest.agents, manifest.outputStyles, manifest.hooks];
  for (const path of paths) {
    assert.match(path, /^\.\/(?!.*\.\.)/, path);
    assert.ok(existsSync(join(ROOT, path)), path);
  }
  assert.deepEqual(manifest.agents.map((/** @type {string} */ a) => a.split('/').pop()).sort(), readdirSync(join(ROOT, 'claude', 'agents')).filter((f) => f.endsWith('.md')).sort());
  assert.deepEqual(Object.keys(manifest.userConfig).sort(), ['disable', 'profile', 'reply_language', 'ui_language']);
  assert.deepEqual(manifest.userConfig.profile.options, ['completo', 'economico', 'minimo']);
  const market = json('.claude-plugin/marketplace.json');
  assert.deepEqual(market.plugins.map((/** @type {any} */ p) => [p.name, p.source]), [[manifest.name, './']]);
});

test('the plugin version follows the gate, so a release reaches plugin users', () => {
  // With a version set, Claude Code updates an installed plugin only when it changes.
  assert.equal(manifest.version, json('packages/gate/package.json').version);
});

test('the plugin icon is a square PNG the plugin directory accepts', () => {
  assert.match(manifest.icon, /^\.\/(?!.*\.\.).*\.png$/);
  const png = readFileSync(join(ROOT, manifest.icon));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.equal(width, height);
  assert.ok(width >= 512 && width <= 2048 && png.length < 2 * 1024 * 1024, `${width}px, ${png.length} bytes`);
});

test('the plugin hooks run every event the install registers, through the same launcher', () => {
  /** @param {any} file */
  const commands = (file) => Object.entries(file.hooks).flatMap(([event, groups]) =>
    /** @type {any[]} */ (groups).flatMap((g) => g.hooks.map((/** @type {any} */ h) => `${event} ${g.matcher ?? ''} ${h.command}`)));
  const installed = commands(json('claude/hooks/settings-fragment.json'))
    .map((c) => c.replace('node "__HOOKS_DIR__/smugan-hook.mjs" ', 'node "${CLAUDE_PLUGIN_ROOT}/claude/hooks/smugan-hook.mjs" ') + ' plugin');
  const plugin = commands(json(manifest.hooks));
  for (const command of installed) assert.ok(plugin.includes(command), command);
  assert.ok(plugin.includes('SessionStart startup|clear|compact node "${CLAUDE_PLUGIN_ROOT}/claude/hooks/smugan-hook.mjs" steer plugin'));
});

test('no language token reaches the model from a file the plugin ships as is', () => {
  const raw = ['skills', 'agents', 'output-styles', 'rules'].flatMap((dir) => walk(join(ROOT, 'claude', dir)));
  for (const file of raw.filter((f) => f.endsWith('.md'))) assert.doesNotMatch(readFileSync(file, 'utf8'), /\{\{[A-Z_]+\}\}/, file);
});

test('SessionStart delivers CLAUDE.md in the plugin languages, pointed at the checkout', () => {
  const { status, stdout } = run('steer', {}, { CLAUDE_PLUGIN_OPTION_UI_LANGUAGE: 'pt-BR', CLAUDE_PLUGIN_OPTION_REPLY_LANGUAGE: 'pt-BR' });
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  const context = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(out.systemMessage, undefined);
  assert.match(context, /## Definition of done/);
  assert.match(context, /All user-facing strings: pt-BR/);
  assert.match(context, /Replies to the user: pt-BR/);
  assert.match(context, /NÃO FEITO/);
  assert.ok(context.includes(ROOT.replace(/\\/g, '/') + '/claude/rules/'), 'rules point at the checkout');
  assert.doesNotMatch(context, /\{\{|~\/\.claude\/rules/);
  assert.ok(context.length <= 10_000, 'Claude Code moves a longer string to a file the model is never told to read');
});

test('with the languages off, their lines leave the steering instead of carrying a token', () => {
  const context = JSON.parse(run('steer', {}).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(context, /\{\{|user-facing strings:|Replies to the user/);
  assert.match(context, /NOT DONE/);
  const bad = JSON.parse(run('steer', {}, { CLAUDE_PLUGIN_OPTION_UI_LANGUAGE: 'português' }).stdout);
  assert.match(bad.systemMessage, /ui_language/);
  assert.doesNotMatch(bad.hookSpecificOutput.additionalContext, /\{\{/);
});

test('the profile shapes the steering: minimo never names flow-critic, economico names the model to pass', () => {
  /** @param {Record<string, string>} env */
  const steer = (env) => JSON.parse(run('steer', {}, env).stdout);
  const full = steer({}).hookSpecificOutput.additionalContext;
  assert.match(full, /plus the `flow-critic` subagent/);
  assert.doesNotMatch(full, /Cost profile/);
  const minimo = steer({ CLAUDE_PLUGIN_OPTION_PROFILE: 'minimo' }).hookSpecificOutput.additionalContext;
  assert.match(minimo, /launch the `critic` subagent\. Resolve each finding/);
  assert.match(minimo, /model: "haiku"/);
  assert.doesNotMatch(minimo.replace(/.*Not used in this install: `smugan:flow-critic`.*/, ''), /flow-critic/);
  const economico = steer({ CLAUDE_PLUGIN_OPTION_PROFILE: 'economico' }).hookSpecificOutput.additionalContext;
  assert.match(economico, /model: "sonnet"/);
  assert.match(economico, /plus the `flow-critic` subagent/);
  assert.match(steer({ CLAUDE_PLUGIN_OPTION_PROFILE: 'economico', SMUGAN_REVIEW_MODEL: 'opus' }).hookSpecificOutput.additionalContext, /model: "opus"/);
  assert.match(steer({ CLAUDE_PLUGIN_OPTION_PROFILE: 'barato' }).systemMessage, /profile must be completo, economico or minimo/);
});

test('each reviewer dispatch is held to the profile', () => {
  /** @param {string} profile @param {Record<string, unknown>} input @param {Record<string, string>} [env] */
  const dispatch = (profile, input, env = {}) => {
    const { status, stdout } = run('agent', { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x', ...input } }, { CLAUDE_PLUGIN_OPTION_PROFILE: profile, ...env });
    assert.equal(status, 0);
    return stdout ? JSON.parse(stdout).hookSpecificOutput : null;
  };
  const flow = dispatch('minimo', { subagent_type: 'smugan:flow-critic', model: 'haiku' });
  assert.equal(flow?.permissionDecision, 'deny');
  assert.match(flow?.permissionDecisionReason ?? '', /does not use flow-critic/);
  assert.match(dispatch('minimo', { subagent_type: 'smugan:critic' })?.permissionDecisionReason ?? '', /model: "haiku"/);
  assert.equal(dispatch('minimo', { subagent_type: 'smugan:critic', model: 'haiku' }), null);
  assert.equal(dispatch('economico', { subagent_type: 'smugan:flow-critic', model: 'sonnet' }), null);
  assert.equal(dispatch('economico', { subagent_type: 'smugan:critic', model: 'sonnet' }, { SMUGAN_REVIEW_MODEL: 'opus' })?.permissionDecision, 'deny');
  assert.equal(dispatch('completo', { subagent_type: 'smugan:flow-critic' }), null);
  assert.equal(dispatch('minimo', { subagent_type: 'Explore' }), null, 'other agents are not the profile’s business');
});

test('completo denies an explicit reviewer model, and the unprefixed names are held to the profile too', () => {
  /** @param {string} profile @param {Record<string, unknown>} input */
  const dispatch = (profile, input) => {
    const { stdout } = run('agent', { hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { prompt: 'x', ...input } }, { CLAUDE_PLUGIN_OPTION_PROFILE: profile });
    return stdout ? JSON.parse(stdout).hookSpecificOutput : null;
  };
  for (const name of ['smugan:critic', 'critic', 'flow-critic']) {
    const denied = dispatch('completo', { subagent_type: name, model: 'haiku' });
    assert.equal(denied?.permissionDecision, 'deny', name);
    assert.match(denied?.permissionDecisionReason ?? '', /conversation's model.*without the model parameter/, name);
    assert.equal(dispatch('completo', { subagent_type: name }), null, name);
  }
  assert.equal(dispatch('completo', { subagent_type: 'critic', model: 'inherit' }), null);
  assert.match(dispatch('minimo', { subagent_type: 'critic' })?.permissionDecisionReason ?? '', /model: "haiku"/);
  assert.match(dispatch('minimo', { subagent_type: 'flow-critic', model: 'haiku' })?.permissionDecisionReason ?? '', /does not use flow-critic/);
});

// The taught file lives outside the child's temp dir: scratch never teaches.
const proj = mkdtempSync(join(tmpdir(), 'smugan-plugin-proj-'));
const childTmp = mkdtempSync(join(tmpdir(), 'smugan-plugin-tmp-'));
const tmpEnv = { TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp };
writeFileSync(join(proj, 'smugan.config.json'), '{}');
mkdirSync(join(proj, 'src'), { recursive: true });
after(() => {
  rmSync(proj, { recursive: true, force: true });
  rmSync(childTmp, { recursive: true, force: true });
});
/** @param {string} session @param {string} file */
const write = (session, file) => ({ session_id: session, cwd: proj, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(proj, file), content: 'export const ok = 1;\n' } });

test('the first edit of a file a stack rule covers names the rule, once per session', () => {
  const session = 'plg' + randomUUID().slice(0, 8);
  const first = run('pre', write(session, 'src/foo.test.ts'), tmpEnv);
  assert.equal(first.status, 0);
  const context = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
  assert.ok(context.includes(join(ROOT, 'claude', 'rules', 'testing.md')), context);
  assert.equal(run('pre', write(session, 'src/bar.test.ts'), tmpEnv).stdout, '', 'a taught rule is not repeated');
});

test('ui-ptbr is taught and ui-strings runs only when ui_language is Portuguese', () => {
  const component = 'export function A() {\n  return <button>Salvar configurações</button>;\n}\n';
  writeFileSync(join(proj, 'src', 'a.tsx'), component);
  /** @param {string} ui */
  const pre = (ui) => run('pre', { ...write('plg' + randomUUID().slice(0, 8), 'src/a.tsx'), tool_input: { file_path: join(proj, 'src', 'a.tsx'), content: component.replace('Salvar configurações', 'Salvar configuracoes') } }, { ...tmpEnv, CLAUDE_PLUGIN_OPTION_UI_LANGUAGE: ui });
  const off = pre('off');
  assert.doesNotMatch(off.stdout + off.stderr, /ui-ptbr|ui-strings/);
  const pt = pre('pt-BR');
  assert.match(pt.stdout + pt.stderr, /ui-ptbr\.md/);
  assert.match(pt.stdout + pt.stderr, /ui-strings/);
});

test('a fail-open notice from the engine survives a rule being taught on the same edit', () => {
  const fake = mkdtempSync(join(tmpdir(), 'smugan-plugin-gate-'));
  after(() => rmSync(fake, { recursive: true, force: true }));
  mkdirSync(join(fake, 'src'));
  for (const file of ['language.cjs', 'profile.cjs']) writeFileSync(join(fake, 'src', file), readFileSync(join(ROOT, 'packages', 'gate', 'src', file)));
  writeFileSync(join(fake, 'src', 'hook.mjs'), "export async function runHook() { return { exitCode: 0, stderr: '', stdout: JSON.stringify({ systemMessage: 'smugan: gate unavailable' }) }; }\n");
  const out = JSON.parse(run('pre', write('plg' + randomUUID().slice(0, 8), 'src/notice.test.ts'), { ...tmpEnv, SMUGAN_GATE_DIR: fake }).stdout);
  assert.equal(out.systemMessage, 'smugan: gate unavailable');
  assert.match(out.hookSpecificOutput.additionalContext, /testing\.md/);
});

test('the disable option and a project\'s "disable" keep parts out of the steering, the teaching and the dispatches', () => {
  const context = JSON.parse(run('steer', {}, { CLAUDE_PLUGIN_OPTION_DISABLE: 'critic,smugan-build' }).stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /launch the `flow-critic` subagent when users see the change/);
  assert.match(context, /Not used in this install: `smugan:critic`, `smugan:smugan-build`\. Do not launch or invoke them; the review is `smugan:flow-critic`\./);
  assert.doesNotMatch(context.replace(/.*Not used in this install.*/, ''), /`critic`|smugan-build|run the critic/);
  const bad = JSON.parse(run('steer', {}, { CLAUDE_PLUGIN_OPTION_DISABLE: 'critc' }).stdout);
  assert.match(bad.systemMessage, /SMUGAN_DISABLE does not know critc/);
  assert.match(bad.hookSpecificOutput.additionalContext, /plus the `flow-critic` subagent/);

  const dir = mkdtempSync(join(tmpdir(), 'smugan-plugin-disable-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'smugan.config.json'), JSON.stringify({ disable: ['flow-critic', 'testing', 'smugan-finish'] }));
  const project = JSON.parse(run('steer', { cwd: dir }).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(project.replace(/.*Not used in this install.*/, ''), /flow-critic|smugan-finish|`testing\.md`/);
  /** @param {string} tool @param {Record<string, unknown>} input */
  const decide = (tool, input) => {
    const { stdout } = run('agent', { cwd: dir, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
    return stdout ? JSON.parse(stdout).hookSpecificOutput.permissionDecision : null;
  };
  assert.equal(decide('Agent', { subagent_type: 'smugan:flow-critic', prompt: 'x' }), 'deny');
  assert.equal(decide('Skill', { skill: 'smugan:smugan-finish' }), 'deny');
  assert.equal(decide('Skill', { skill: 'smugan:smugan-build' }), null);
  assert.equal(decide('Agent', { subagent_type: 'smugan:critic', prompt: 'x' }), null);
  mkdirSync(join(dir, 'src'));
  const taught = run('pre', { session_id: 'plg' + randomUUID().slice(0, 8), cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'off.test.ts'), content: 'export const ok = 1;\n' } }, tmpEnv);
  assert.doesNotMatch(taught.stdout, /testing\.md/, 'a rule the project turns off is not taught');
});

test('warn mode: the launcher hands a post finding to the model as PostToolUse context, exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-plugin-warn-'));
  try {
    writeFileSync(join(dir, 'smugan.config.json'), '{"mode":"warn"}');
    mkdirSync(join(dir, 'node_modules', 'eslint', 'bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'eslint', 'bin', 'eslint.js'), 'console.log(JSON.stringify([{ filePath: "a.js", messages: [{ ruleId: "fake-rule", message: "fake-eslint: boom", line: 1 }] }])); process.exit(1);');
    writeFileSync(join(dir, '.eslintrc.json'), '{}');
    const file = join(dir, 'a.js');
    writeFileSync(file, 'export const a = 1;\n');
    const result = run('post', { tool_name: 'Write', session_id: 'smuganpluginwarn' + process.pid, tool_input: { file_path: file } });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(output.hookSpecificOutput.additionalContext, /warn mode, nothing blocked[\s\S]*fake-eslint: boom/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(tmpdir(), 'smugan-turn-smuganpluginwarn' + process.pid + '.json'), { force: true });
  }
});

test('with the global install active, every plugin hook stays out and SessionStart says how to switch', () => {
  const byPaths = mkdtempSync(join(tmpdir(), 'smugan-plugin-global-'));
  const bySettings = mkdtempSync(join(tmpdir(), 'smugan-plugin-global-'));
  after(() => [byPaths, bySettings].forEach((d) => rmSync(d, { recursive: true, force: true })));
  mkdirSync(join(byPaths, 'hooks'));
  writeFileSync(join(byPaths, 'hooks', 'smugan.paths.json'), '{}');
  writeFileSync(join(bySettings, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "C:/x/.claude/hooks/smugan-hook.mjs" stop' }] }] } }));
  const session = 'plg' + randomUUID().slice(0, 8);
  const migration = { session_id: session, cwd: proj, tool_name: 'Write', tool_input: { file_path: join(proj, 'supabase', 'migrations', '0001_x.sql'), content: 'create table clientes (id uuid primary key);\n' } };
  /** @type {[string, unknown][]} */
  const events = [['session', {}], ['pre', migration], ['post', migration], ['bash', { tool_name: 'Bash', tool_input: { command: 'git status' } }], ['stop', { session_id: session }], ['agent', { tool_name: 'Agent', tool_input: { subagent_type: 'smugan:flow-critic' } }]];
  for (const config of [byPaths, bySettings]) {
    const env = { ...tmpEnv, CLAUDE_CONFIG_DIR: config, CLAUDE_PLUGIN_OPTION_PROFILE: 'minimo' };
    const steer = run('steer', {}, env);
    assert.equal(steer.status, 0);
    const out = JSON.parse(steer.stdout);
    assert.match(out.systemMessage, /global install .* is active.*\.\/install\.sh --uninstall/);
    assert.equal(out.hookSpecificOutput, undefined, 'no second copy of the steering');
    for (const [kind, payload] of events) {
      const result = run(kind, payload, env);
      assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', ''], kind);
    }
  }
  assert.equal(run('pre', migration, tmpEnv).status, 2, 'without the global install the same write is blocked');
});
