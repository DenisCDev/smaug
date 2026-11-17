// The installer: it regenerates the steering from the smugan checkout, so a
// silent mistranslation here would ship broken rules to every session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, SMUGAN } from './helpers.mjs';

const INSTALL = join(ROOT, 'tools', 'install.mjs');

function install(configDir, smuganPath = SMUGAN, env = {}) {
  return spawnSync(process.execPath, [INSTALL, ROOT, smuganPath], {
    encoding: 'utf8',
    env: { ...process.env, OPENCODE_CONFIG_DIR: configDir, SMUGAN_UI_LANG: '', SMUGAN_REPLY_LANG: '', ...env },
  });
}

test('the installed AGENTS.md is generated from smugan CLAUDE.md, retargeted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-install-'));
  const res = install(dir);
  assert.equal(res.status, 0, res.stderr);

  const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /## Definition of done/);
  assert.match(agentsMd, /## OpenCode adaptations/);
  assert.ok(agentsMd.includes('~/.config/opencode/rules/'));
  assert.ok(!agentsMd.includes('~/.claude/'), 'every Claude path is retargeted');
  assert.ok(!/## Stack rules[\s\S]*path-scoped and load when you touch/.test(agentsMd), 'the Claude-only Stack rules section is replaced');
  // Claims rides in from claude/CLAUDE.md, Answers from this adapter's tail.
  // Twice would mean a rule that already propagates was re-added by hand.
  assert.equal((agentsMd.match(/^## Claims$/gm) ?? []).length, 1, 'the Claims rules reach the steering, once');
  assert.equal((agentsMd.match(/^## Answers$/gm) ?? []).length, 1, 'the answer-shape rules reach the steering, once');
  // Heading counts do NOT catch a rule re-added as a BULLET inside a section
  // that already exists — how the unfinished-work rule shipped twice in 0.15.0.
  assert.equal((agentsMd.match(/NOT DONE/g) ?? []).length, 1, 'the unfinished-work rule arrives once — it propagates from CLAUDE.md, do not repeat it in the tail');

  // reinstalling replaces the managed block instead of stacking copies
  assert.equal(install(dir).status, 0);
  const twice = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(twice.split('smugan:start').length - 1, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('agents become OpenCode subagents that cannot edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-agents-'));
  assert.equal(install(dir).status, 0);

  for (const name of ['critic', 'flow-critic']) {
    const md = readFileSync(join(dir, 'agents', name + '.md'), 'utf8');
    assert.match(md, new RegExp('name: ' + name));
    assert.match(md, /mode: subagent/);
    assert.match(md, /permission:\s*\n\s+edit: deny/);
    assert.ok(!/^tools:/m.test(md), 'the deprecated Claude tools field is gone');
    assert.match(md, /Use PROACTIVELY/, 'the description that drives automatic invocation survives');
  }
  rmSync(dir, { recursive: true, force: true });
});

test('the skill loses argument-hint but keeps its scopes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-skill-'));
  assert.equal(install(dir).status, 0);

  const skill = readFileSync(join(dir, 'skills', 'smugan', 'SKILL.md'), 'utf8');
  assert.ok(!/^argument-hint:/m.test(skill), 'an unknown frontmatter key can make OpenCode drop the skill');
  assert.match(skill, /Scopes: `security \| rls \| ui \| flows \| dead-code \| full`/);
  assert.ok(skill.includes('~/.config/opencode/hooks/smugan.paths.json'));
  assert.ok(!skill.includes('~/.claude/'));
  rmSync(dir, { recursive: true, force: true });
});

test('the plugin, its modules and the paths file are installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-files-'));
  assert.equal(install(dir).status, 0);

  for (const file of ['plugins/smugan.js', 'bin/gate-runner.mjs', 'smugan/gate.mjs', 'smugan/idle.mjs', 'smugan/rules.mjs', 'rules/testing.md']) {
    assert.ok(existsSync(join(dir, ...file.split('/'))), file + ' is missing');
  }
  const paths = JSON.parse(readFileSync(join(dir, 'hooks', 'smugan.paths.json'), 'utf8'));
  assert.match(paths.gateDir, /packages\/gate$/);
  assert.ok(existsSync(paths.nodeBin), 'the gate must run under node, not the plugin host runtime');

  const settings = JSON.parse(readFileSync(join(dir, 'smugan.opencode.json'), 'utf8'));
  assert.equal(settings.continue.layer, 'B');
  writeFileSync(join(dir, 'smugan.opencode.json'), JSON.stringify({ continue: { layer: 'A' } }));
  assert.equal(install(dir).status, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'smugan.opencode.json'), 'utf8')).continue.layer, 'A', 'reinstalling keeps your settings');
  rmSync(dir, { recursive: true, force: true });
});

test('a smugan CLAUDE.md without the expected anchors aborts the install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-anchor-'));
  const fake = mkdtempSync(join(tmpdir(), 'smugan-oc-fake-'));
  mkdirSync(join(fake, 'packages', 'gate', 'src'), { recursive: true });
  writeFileSync(join(fake, 'packages', 'gate', 'src', 'hook.mjs'), '');
  for (const file of ['language.cjs', 'profile.cjs', 'parts.cjs']) copyFileSync(join(SMUGAN, 'packages', 'gate', 'src', file), join(fake, 'packages', 'gate', 'src', file));
  mkdirSync(join(fake, 'claude'), { recursive: true });
  writeFileSync(join(fake, 'claude', 'CLAUDE.md'), '# Rules\n\n## Definition of done\n\n- checks.\n');

  const res = install(dir, fake);
  assert.notEqual(res.status, 0, 'better to fail loudly than to install broken steering');
  assert.match(res.stderr, /Stack rules/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('the install-time language choice reaches every installed file', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-oc-lang-'));
  const pt = { SMUGAN_UI_LANG: 'pt-BR', SMUGAN_REPLY_LANG: 'pt-BR' };
  const rule = join(home, 'rules', 'ui-ptbr.md');
  const paths = () => JSON.parse(readFileSync(join(home, 'hooks', 'smugan.paths.json'), 'utf8'));
  // No {{TOKEN}} may reach the host, in any markdown the installer wrote.
  const leftovers = () => [home].flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .filter((file) => /\{\{[A-Z_]+\}\}/.test(readFileSync(file, 'utf8'))));

  let res = install(home);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'a pt-BR UI rule is not installed while the UI language is off');
  assert.ok(!readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('NÃO FEITO'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], [null, null]);
  assert.match(res.stdout, /= UI language: off · reply language: off/);

  res = install(home, SMUGAN, pt);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'pt-BR as UI language installs its rule');
  assert.equal((readFileSync(join(home, 'AGENTS.md'), 'utf8').match(/NÃO FEITO/g) ?? []).length, 1);
  assert.ok(!readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('NOT DONE'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], ['pt-BR', 'pt-BR']);
  assert.match(res.stdout, /= UI language: pt-BR · reply language: pt-BR/);

  res = install(home);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'a plain reinstall keeps the previous choice');

  res = install(home, SMUGAN, { SMUGAN_UI_LANG: 'off' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'turning the UI language off removes the rule it installed');

  const clean = mkdtempSync(join(tmpdir(), 'smugan-oc-lang-'));
  res = install(clean, SMUGAN, { SMUGAN_UI_LANG: 'not a tag' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /SMUGAN_UI_LANG/);
  assert.deepEqual(readdirSync(clean), [], 'an invalid language aborts before any write');
  rmSync(home, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
});

test('SMUGAN_DISABLE keeps a reviewer and a rule out of the OpenCode install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-disable-'));
  try {
    const res = install(dir, SMUGAN, { SMUGAN_DISABLE: 'flow-critic,testing' });
    assert.equal(res.status, 0, res.stderr);
    const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.doesNotMatch(agentsMd, /flow-critic|`testing\.md`/);
    assert.match(agentsMd, /None of this replaces the `critic` review required/);
    assert.ok(!existsSync(join(dir, 'agents', 'flow-critic.md')));
    assert.ok(!existsSync(join(dir, 'rules', 'testing.md')));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'hooks', 'smugan.paths.json'), 'utf8')).disable, ['flow-critic', 'testing']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
