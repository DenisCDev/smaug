// Installer integration tests: run the real installer against a temp
// CODEX_HOME + skills dir and assert the layout Codex will actually read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = join(ROOT, 'tools', 'install.mjs');
const SMUGAN = resolve(ROOT, '..', '..');

function runInstall(home, skills, smuganPath = SMUGAN, env = {}) {
  return spawnSync(process.execPath, [INSTALL, ROOT, smuganPath], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: home, SMUGAN_CODEX_SKILLS_DIR: skills, SMUGAN_UI_LANG: '', SMUGAN_REPLY_LANG: '', ...env },
  });
}

test('install generates AGENTS.md, rules, agents TOML, skill, hooks', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-install-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-skills-'));
  const res = runInstall(home, skills);
  assert.equal(res.status, 0, res.stderr);

  const agentsMd = readFileSync(join(home, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /## Codex adaptations/);
  assert.match(agentsMd, /## Definition of done/);
  assert.ok(agentsMd.includes(home.replace(/\\/g, '/') + '/rules/'));
  assert.ok(!agentsMd.includes('~/.claude/'), 'every Claude path is rewritten');
  const gitSection = /^## Git\r?\n[\s\S]*?(?=\r?\n## Definition of done)/m;
  const sourceMd = readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8');
  const sourceGit = sourceMd.match(gitSection)?.[0];
  const installedGit = agentsMd.match(gitSection)?.[0];
  assert.ok(sourceGit, 'source contains Git guidance');
  assert.ok(installedGit, 'installed steering contains Git guidance');
  assert.equal(installedGit, sourceGit, 'Git guidance reaches the steering unchanged');
  const preparation = /^## Development preparation\r?\n[\s\S]*?(?=\r?\n## )/m;
  assert.ok(sourceMd.match(preparation), 'source contains development preparation');
  assert.equal(agentsMd.match(preparation)?.[0], sourceMd.match(preparation)?.[0], 'version preparation is shared by both hosts');
  assert.match(agentsMd, /Distinguish declared, lockfile-resolved, installed, runtime and deployed versions/);
  // Claims rides in from claude/CLAUDE.md, Answers from this adapter's tail.
  assert.equal((agentsMd.match(/^## Claims$/gm) ?? []).length, 1, 'Claims reaches the steering, once');
  assert.equal((agentsMd.match(/^## Answers$/gm) ?? []).length, 1, 'Answers reaches the steering, once');
  assert.equal((agentsMd.match(/NOT DONE/g) ?? []).length, 1, 'the unfinished-work rule arrives once');

  const critic = readFileSync(join(home, 'agents', 'critic.toml'), 'utf8');
  assert.match(critic, /^name = "critic"$/m);
  assert.match(critic, /^sandbox_mode = "read-only"$/m);
  assert.match(critic, /^description = "Hostile reviewer/m, 'the folded YAML description is unfolded');
  assert.match(critic, /developer_instructions = """\n/);
  assert.ok(existsSync(join(home, 'agents', 'flow-critic.toml')));

  const skill = readFileSync(join(skills, 'smugan', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(home.replace(/\\/g, '/') + '/hooks/smugan.paths.json'));
  assert.ok(!skill.includes('~/.claude/'));
  const sourceSkill = readFileSync(join(SMUGAN, 'claude', 'skills', 'smugan', 'SKILL.md'), 'utf8').replace(/^\uFEFF/, '');
  assert.equal(skill, sourceSkill.split('~/.claude/skills/').join(skills.replace(/\\/g, '/') + '/').split('~/.claude/').join(home.replace(/\\/g, '/') + '/'), 'audit scope is preserved');
  const buildSkill = readFileSync(join(skills, 'smugan-build', 'SKILL.md'), 'utf8');
  assert.match(buildSkill, /name: smugan-build/);
  assert.ok(buildSkill.includes(home.replace(/\\/g, '/') + '/hooks/smugan.paths.json'));
  assert.ok(!buildSkill.includes('~/.claude/'));
  assert.ok(!buildSkill.includes('disable-model-invocation: true'), 'development skill allows discovery');
  assert.match(readFileSync(join(skills, 'smugan-build', 'agents', 'openai.yaml'), 'utf8'), /allow_implicit_invocation: true/);
  for (const reference of buildSkill.matchAll(/\]\((references\/[^)]+)\)/g)) {
    assert.ok(existsSync(join(skills, 'smugan-build', reference[1])), 'linked reference installed: ' + reference[1]);
  }
  // ui-ptbr.md ships only with a pt UI language; the language test covers it.
  for (const file of readdirSync(join(SMUGAN, 'claude', 'rules')).filter((name) => name.endsWith('.md') && name !== 'ui-ptbr.md')) {
    const sourceRule = readFileSync(join(SMUGAN, 'claude', 'rules', file), 'utf8');
    const installedRule = readFileSync(join(home, 'rules', file), 'utf8');
    assert.ok(!installedRule.includes('~/.claude/'), 'rule has no Claude-only paths: ' + file);
    for (const reference of sourceRule.matchAll(/~\/\.claude\/skills\/([^`\s]+)/g)) {
      const installedReference = join(skills, reference[1]);
      assert.ok(installedRule.includes(installedReference.replace(/\\/g, '/')), 'rule uses the configured skills root: ' + file);
      assert.ok(existsSync(installedReference), 'rule reference exists in the isolated installation: ' + reference[1]);
    }
  }

  assert.ok(existsSync(join(home, 'rules', 'supabase.md')));
  assert.ok(existsSync(join(home, 'hooks', 'smugan-hook.mjs')));
  assert.ok(existsSync(join(home, 'hooks', 'rule-teach.mjs')));
  const paths = JSON.parse(readFileSync(join(home, 'hooks', 'smugan.paths.json'), 'utf8'));
  assert.ok(paths.gateDir.endsWith('packages/gate'));

  const hooks = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionEnd', 'Stop']);
  assert.equal(hooks.hooks.PreToolUse[0].matcher, '^apply_patch$');
  assert.match(res.stdout, /\/hooks/, 'the trust step is said out loud');

  rmSync(home, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

test('reinstall is idempotent and BYTE-STABLE where Codex trust-hashes it', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-stable-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-skills2-'));
  assert.equal(runInstall(home, skills).status, 0);
  const firstHooks = readFileSync(join(home, 'hooks.json'), 'utf8');
  const firstAgents = readFileSync(join(home, 'AGENTS.md'), 'utf8');

  assert.equal(runInstall(home, skills).status, 0);
  // Trust covers the hook identity: a reinstall that changed a byte here would
  // flip the hooks to "modified" and silently disarm the gate.
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), firstHooks);
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), firstAgents);
  assert.equal(firstAgents.split('smugan:start').length - 1, 1, 'managed block never stacks');

  rmSync(home, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

test('user content in AGENTS.md and foreign hooks in hooks.json survive', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-user-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-skills3-'));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'AGENTS.md'), '# My own notes\n\nKeep me.\n');
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }] },
  }));

  assert.equal(runInstall(home, skills).status, 0);
  const agentsMd = readFileSync(join(home, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /Keep me\./);
  const hooks = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.PreToolUse.length, 2, 'foreign group + smugan group');
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, 'my-own-hook.sh');

  rmSync(home, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

test('invalid hooks.json aborts loudly instead of destroying it', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-badjson-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-skills4-'));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'hooks.json'), '{ not json');
  const res = runInstall(home, skills);
  assert.notEqual(res.status, 0);
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), '{ not json', 'untouched');
  rmSync(home, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

test('hooks = false under [features] is warned about, config.toml never written', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-flag-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-skills5-'));
  mkdirSync(home, { recursive: true });
  const toml = '[features]\nhooks = false\n';
  writeFileSync(join(home, 'config.toml'), toml);
  const res = runInstall(home, skills);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /INERT/);
  assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), toml, 'read-only');
  rmSync(home, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

test('install fails loud when the CLAUDE.md anchor is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-doctored-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-skills6-'));
  const fake = mkdtempSync(join(tmpdir(), 'smugan-cdx-fake-'));
  mkdirSync(join(fake, 'packages', 'gate', 'src'), { recursive: true });
  writeFileSync(join(fake, 'packages', 'gate', 'src', 'hook.mjs'), '');
  for (const file of ['language.cjs', 'profile.cjs', 'parts.cjs']) copyFileSync(join(SMUGAN, 'packages', 'gate', 'src', file), join(fake, 'packages', 'gate', 'src', file));
  mkdirSync(join(fake, 'claude'), { recursive: true });
  writeFileSync(join(fake, 'claude', 'CLAUDE.md'), '# Rules\n\n## Definition of done\n\n- checks.\n');
  const res = runInstall(home, skills, fake);
  assert.notEqual(res.status, 0, 'a missing anchor must abort the install');
  assert.match(res.stderr, /Stack rules/);
  rmSync(home, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

function installationFixture(t) {
  const fixture = mkdtempSync(join(tmpdir(), 'smugan-install-tree-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const source = join(fixture, 'source');
  cpSync(join(SMUGAN, 'claude'), join(source, 'claude'), { recursive: true });
  cpSync(join(SMUGAN, 'install.sh'), join(source, 'install.sh'));
  mkdirSync(join(source, 'packages', 'gate', 'src'), { recursive: true });
  writeFileSync(join(source, 'packages', 'gate', 'src', 'hook.mjs'), '');
  for (const file of ['language.cjs', 'profile.cjs', 'parts.cjs']) copyFileSync(join(SMUGAN, 'packages', 'gate', 'src', file), join(source, 'packages', 'gate', 'src', file));
  writeFileSync(join(source, 'packages', 'gate', 'package.json'), JSON.stringify({
    dependencies: { '@smugan-fixture/missing-parser': '1.0.0' },
  }));
  const sourceGuide = join(source, 'claude', 'skills', 'smugan-build', 'references', 'nested', 'guide.md');
  mkdirSync(dirname(sourceGuide), { recursive: true });
  writeFileSync(sourceGuide, 'Version one: ~/.claude/rules/testing.md\n');
  writeFileSync(join(dirname(sourceGuide), 'sample.json'), '{"example":true}\n');
  const sourceRules = join(source, 'claude', 'CLAUDE.md');
  writeFileSync(sourceRules, readFileSync(sourceRules, 'utf8') + '\n- Version first fixture: verify the exact runtime before selecting APIs.\n');
  const home = join(fixture, 'home');
  mkdirSync(home);
  return { source, sourceGuide, home };
}

function runClaudeInstall(source, home, config) {
  const bash = process.env.SMUGAN_TEST_BASH || (process.platform === 'win32'
    ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe')
    : 'bash');
  return spawnSync(bash, ['--noprofile', '--norc', join(source, 'install.sh').replace(/\\/g, '/')], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, SMUGAN_UI_LANG: '', SMUGAN_REPLY_LANG: '' },
  });
}

for (const host of ['codex', 'claude']) {
  test(host + ' installs and refreshes complete skills without deleting user files', (t) => {
    const { source, sourceGuide, home } = installationFixture(t);
    const config = join(home, host === 'codex' ? '.codex' : 'custom claude config');
    const skills = host === 'codex' ? join(home, '.agents', 'skills') : join(config, 'skills');
    const run = () => host === 'codex' ? runInstall(config, skills, source) : runClaudeInstall(source, home, config);
    mkdirSync(config, { recursive: true });
    const steeringFile = join(config, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
    const settingsFile = join(config, host === 'codex' ? 'hooks.json' : 'settings.json');
    writeFileSync(steeringFile, '# User instructions\nKeep this text.\n');
    writeFileSync(settingsFile, JSON.stringify({
      outputStyle: 'Personal',
      hooks: { PreToolUse: [{
        matcher: 'Bash',
        description: 'Personal observer for smugan-hook.mjs',
        hooks: [
          { type: 'command', command: 'personal-hook' },
          { type: 'command', command: 'node "/previous/hooks/smugan-hook.mjs" pre' },
        ],
      }] },
    }));
    const installedGuide = join(skills, 'smugan-build', 'references', 'nested', 'guide.md');
    mkdirSync(dirname(installedGuide), { recursive: true });
    const userFile = join(dirname(installedGuide), 'my-notes.md');
    writeFileSync(userFile, 'User reference.\n');
    mkdirSync(join(skills, 'personal-skill'), { recursive: true });
    writeFileSync(join(skills, 'personal-skill', 'SKILL.md'), '# Personal skill\n');

    let result = run();
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const rulesPath = config.replace(/\\/g, '/') + '/rules/';
    assert.equal(readFileSync(installedGuide, 'utf8'), 'Version one: ' + rulesPath + 'testing.md\n');
    assert.deepEqual(JSON.parse(readFileSync(join(dirname(installedGuide), 'sample.json'), 'utf8')), { example: true });
    const initialSettings = readFileSync(settingsFile, 'utf8');
    assert.deepEqual(JSON.parse(initialSettings).hooks.PreToolUse[0], {
      matcher: 'Bash',
      description: 'Personal observer for smugan-hook.mjs',
      hooks: [{ type: 'command', command: 'personal-hook' }],
    }, 'a mixed group keeps its foreign hook and metadata');
    const initialSteering = readFileSync(steeringFile, 'utf8');
    assert.ok(initialSteering.includes(rulesPath), 'global instructions use the actual configuration root');
    for (const skill of ['smugan', 'smugan-build']) {
      const skillText = readFileSync(join(skills, skill, 'SKILL.md'), 'utf8');
      const pathsFile = join(config, 'hooks', 'smugan.paths.json');
      assert.ok(skillText.includes(pathsFile.replace(/\\/g, '/')), 'skill fallback reaches its installed hook metadata');
      assert.ok(existsSync(pathsFile));
      assert.ok(!skillText.includes('~/.claude/'), 'custom installation has no default Claude fallback');
    }
    for (const file of readdirSync(join(source, 'claude', 'rules')).filter((name) => name.endsWith('.md') && name !== 'ui-ptbr.md')) {
      const sourceRule = readFileSync(join(source, 'claude', 'rules', file), 'utf8');
      const installedRule = readFileSync(join(config, 'rules', file), 'utf8');
      for (const reference of sourceRule.matchAll(/~\/\.claude\/skills\/([^`\s]+)/g)) {
        const installedReference = join(skills, reference[1]);
        assert.ok(installedRule.includes(installedReference.replace(/\\/g, '/')), 'rule uses custom installation paths: ' + file);
        assert.ok(existsSync(installedReference), 'custom rule reference exists: ' + reference[1]);
      }
    }
    if (host === 'claude') assert.ok(!existsSync(join(home, '.claude')), 'the default Claude directory remains untouched');
    assert.match(initialSteering, /Keep this text\./);
    assert.match(initialSteering, /Version first fixture: verify the exact runtime before selecting APIs\./);
    assert.match(result.stdout, /Context preparation unavailable/);
    assert.match(result.stdout, /npm ci --ignore-scripts --prefix/);
    assert.ok(!existsSync(join(source, 'packages', 'gate', 'node_modules')), 'installer does not download dependencies');

    writeFileSync(sourceGuide, 'Version two: ~/.claude/rules/testing.md\n');
    const personalPolicy = 'interface:\n  display_name: "My build helper"\npolicy:\n  allow_implicit_invocation: false\n';
    if (host === 'codex') writeFileSync(join(skills, 'smugan-build', 'agents', 'openai.yaml'), personalPolicy);
    result = run();
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.match(readFileSync(installedGuide, 'utf8'), /Version two:/);
    assert.equal(readFileSync(userFile, 'utf8'), 'User reference.\n');
    assert.equal(readFileSync(join(skills, 'personal-skill', 'SKILL.md'), 'utf8'), '# Personal skill\n');
    assert.equal(readFileSync(settingsFile, 'utf8'), initialSettings, 'reinstall keeps foreign hooks and output style stable');
    assert.equal(readFileSync(steeringFile, 'utf8'), initialSteering, 'managed guidance is not duplicated');
    if (host === 'codex') assert.equal(readFileSync(join(skills, 'smugan-build', 'agents', 'openai.yaml'), 'utf8'), personalPolicy, 'existing skill metadata and invocation preferences survive');
  });
}

test('the install-time language choice reaches every installed file', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-lang-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-lang-skills-'));
  const pt = { SMUGAN_UI_LANG: 'pt-BR', SMUGAN_REPLY_LANG: 'pt-BR' };
  const rule = join(home, 'rules', 'ui-ptbr.md');
  const paths = () => JSON.parse(readFileSync(join(home, 'hooks', 'smugan.paths.json'), 'utf8'));
  // No {{TOKEN}} may reach the host, in any markdown the installer wrote.
  const leftovers = () => [home, skills].flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .filter((file) => /\{\{[A-Z_]+\}\}/.test(readFileSync(file, 'utf8'))));

  let res = runInstall(home, skills);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'a pt-BR UI rule is not installed while the UI language is off');
  assert.ok(!readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('NÃO FEITO'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], [null, null]);
  assert.match(res.stdout, /= UI language: off · reply language: off/);

  res = runInstall(home, skills, SMUGAN, pt);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'pt-BR as UI language installs its rule');
  assert.equal((readFileSync(join(home, 'AGENTS.md'), 'utf8').match(/NÃO FEITO/g) ?? []).length, 1);
  assert.ok(!readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('NOT DONE'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], ['pt-BR', 'pt-BR']);
  assert.match(res.stdout, /= UI language: pt-BR · reply language: pt-BR/);

  res = runInstall(home, skills);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'a plain reinstall keeps the previous choice');

  res = runInstall(home, skills, SMUGAN, { SMUGAN_UI_LANG: 'off' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'turning the UI language off removes the rule it installed');

  const clean = mkdtempSync(join(tmpdir(), 'smugan-cdx-lang-'));
  res = runInstall(clean, join(clean, 'skills'), SMUGAN, { SMUGAN_UI_LANG: 'not a tag' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /SMUGAN_UI_LANG/);
  assert.deepEqual(readdirSync(clean), [], 'an invalid language aborts before any write');
  rmSync(home, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

test('SMUGAN_DISABLE keeps a reviewer, a skill and a rule out of the Codex install, and a reinstall keeps it', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-cdx-disable-'));
  const skills = mkdtempSync(join(tmpdir(), 'smugan-cdx-disable-skills-'));
  try {
    const check = () => {
      const agentsMd = readFileSync(join(home, 'AGENTS.md'), 'utf8');
      assert.doesNotMatch(agentsMd, /`critic`|run the critic|smugan-build|`supabase\.md`/);
      assert.match(agentsMd, /launch the `flow-critic` subagent when users see the change/);
      assert.match(agentsMd, /None of this replaces the `flow-critic` review required/);
      assert.ok(!existsSync(join(home, 'agents', 'critic.toml')));
      assert.ok(existsSync(join(home, 'agents', 'flow-critic.toml')));
      assert.ok(!existsSync(join(home, 'rules', 'supabase.md')));
      assert.ok(!existsSync(join(skills, 'smugan-build', 'SKILL.md')));
      assert.ok(existsSync(join(skills, 'smugan-build', 'references', 'supabase-postgres.md')));
      assert.deepEqual(JSON.parse(readFileSync(join(home, 'hooks', 'smugan.paths.json'), 'utf8')).disable, ['critic', 'smugan-build', 'supabase']);
    };
    const first = runInstall(home, skills, SMUGAN, { SMUGAN_DISABLE: 'critic,smugan-build,supabase' });
    assert.equal(first.status, 0, first.stderr);
    check();
    const again = runInstall(home, skills, SMUGAN, { SMUGAN_DISABLE: '' });
    assert.equal(again.status, 0, again.stderr);
    check();
    const bad = runInstall(home, skills, SMUGAN, { SMUGAN_DISABLE: 'nope' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /SMUGAN_DISABLE does not know nope/);
    const cleared = runInstall(home, skills, SMUGAN, { SMUGAN_DISABLE: 'none' });
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.ok(existsSync(join(home, 'agents', 'critic.toml')));
    assert.ok(existsSync(join(skills, 'smugan-build', 'SKILL.md')));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(skills, { recursive: true, force: true });
  }
});
