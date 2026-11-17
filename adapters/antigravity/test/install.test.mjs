// The installer regenerates the steering from this checkout, so a silent
// mistranslation here would ship broken rules to every session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, readdirSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SMUGAN = resolve(ROOT, '..', '..');
const INSTALL = join(ROOT, 'tools', 'install.mjs');

// The platform documents these; anything else hangs a subagent that declares it.
const KNOWN_TOOLS = new Set([
  'run_command', 'view_file', 'write_to_file', 'replace_file_content',
  'multi_replace_file_content', 'list_dir', 'find_by_name', 'grep_search',
  'search_web', 'read_url_content', 'manage_task', 'schedule',
  'list_permissions', 'ask_permission', 'invoke_subagent', 'define_subagent',
  'send_message', 'manage_subagents', 'ask_question', 'generate_image',
]);

function install(home, smuganPath = SMUGAN, env = {}) {
  return spawnSync(process.execPath, [INSTALL, ROOT, smuganPath], {
    encoding: 'utf8',
    env: { ...process.env, SMUGAN_AGY_HOME: home, SMUGAN_UI_LANG: '', SMUGAN_REPLY_LANG: '', ...env },
  });
}

const fresh = () => mkdtempSync(join(tmpdir(), 'smugan-agy-home-'));

/** A checkout shaped like smugan's, so a test can vary exactly one thing. */
function fakeCheckout(prefix, claudeMd) {
  const fake = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(fake, 'packages', 'gate', 'src'), { recursive: true });
  writeFileSync(join(fake, 'packages', 'gate', 'src', 'hook.mjs'), '');
  for (const file of ['language.cjs', 'profile.cjs', 'parts.cjs']) copyFileSync(join(SMUGAN, 'packages', 'gate', 'src', file), join(fake, 'packages', 'gate', 'src', file));
  mkdirSync(join(fake, 'claude', 'agents'), { recursive: true });
  mkdirSync(join(fake, 'claude', 'rules'), { recursive: true });
  mkdirSync(join(fake, 'claude', 'skills', 'smugan'), { recursive: true });
  for (const file of ['critic.md', 'flow-critic.md']) {
    copyFileSync(join(SMUGAN, 'claude', 'agents', file), join(fake, 'claude', 'agents', file));
  }
  copyFileSync(join(SMUGAN, 'claude', 'skills', 'smugan', 'SKILL.md'), join(fake, 'claude', 'skills', 'smugan', 'SKILL.md'));
  cpSync(join(SMUGAN, 'claude', 'skills', 'smugan-build'), join(fake, 'claude', 'skills', 'smugan-build'), { recursive: true });
  writeFileSync(join(fake, 'claude', 'CLAUDE.md'), claudeMd);
  return fake;
}
const steeringOf = (home) => (existsSync(join(home, 'AGENTS.md'))
  ? readFileSync(join(home, 'AGENTS.md'), 'utf8')
  : readFileSync(join(home, 'GEMINI.md'), 'utf8'));

test('the steering is generated from smugan CLAUDE.md and retargeted', () => {
  const home = fresh();
  const res = install(home);
  assert.equal(res.status, 0, res.stderr);

  const steering = steeringOf(home);
  assert.match(steering, /## Definition of done/);
  assert.match(steering, /## Antigravity adaptations/);
  assert.ok(!steering.includes('~/.claude/'), 'every Claude path is retargeted');
  assert.ok(!/path-scoped and load when you touch/.test(steering), 'the Claude-only Stack rules section is replaced');
  // Sections that must survive the transform, each exactly once: Claims rides
  // in from claude/CLAUDE.md, Answers from this adapter's tail. Twice would
  // mean someone re-added a rule that already propagates.
  assert.equal((steering.match(/^## Claims$/gm) ?? []).length, 1, 'the Claims rules reach the steering, once');
  assert.equal((steering.match(/^## Answers$/gm) ?? []).length, 1, 'the answer-shape rules reach the steering, once');
  // Heading counts do NOT catch a rule re-added as a BULLET inside a section
  // that already exists — which is how the unfinished-work rule shipped twice
  // during 0.15.0. Count the rule's own marker, not its container.
  assert.equal((steering.match(/NOT DONE/g) ?? []).length, 1, 'the unfinished-work rule arrives once — it propagates from CLAUDE.md, do not repeat it in the tail');
  assert.ok(steering.length <= 12000, 'the platform truncates rule files past 12000 characters');
  // The installer only prints "!" past 8000, so without this the warn band is
  // unenforced and steering grows until it silently nears the hard cap.
  assert.ok(steering.length <= 8000, `steering is ${steering.length} chars — past the 8000 warn band, shorten it before adding more`);
  rmSync(home, { recursive: true, force: true });
});

test('the reviewer bullet calls the reviewers the way this host does', () => {
  const home = fresh();
  assert.equal(install(home).status, 0);
  const steering = steeringOf(home);

  assert.match(steering, /Critical change, or an ordinary one over ~300 changed lines/, 'reviewers stay reserved for risk');
  assert.match(steering, /call `invoke_subagent` with `critic`, plus `invoke_subagent` with `flow-critic`/);
  assert.match(steering, /the mechanical gate is the review/);
  assert.ok(!/launch the `critic` subagent/.test(steering), 'the Claude Code wording is gone');
  rmSync(home, { recursive: true, force: true });
});

test('reinstalling replaces the managed block instead of stacking copies', () => {
  const home = fresh();
  assert.equal(install(home).status, 0);
  writeFileSync(join(home, 'AGENTS.md'), 'meu texto pessoal\n\n' + steeringOf(home));
  assert.equal(install(home).status, 0);

  const steering = steeringOf(home);
  assert.equal(steering.split('smugan:start').length - 1, 1);
  assert.match(steering, /meu texto pessoal/, 'content outside the block is never touched');
  rmSync(home, { recursive: true, force: true });
});

test('subagents get Antigravity tool names, and only real ones', () => {
  const home = fresh();
  assert.equal(install(home).status, 0);

  for (const name of ['critic', 'flow-critic']) {
    const md = readFileSync(join(home, 'config', 'agents', name + '.md'), 'utf8');
    assert.match(md, new RegExp('name: ' + name));
    assert.match(md, /subagent: true/);
    assert.match(md, /model: inherit/);
    assert.match(md, /Use PROACTIVELY/, 'the description that drives delegation survives');
    assert.match(md, /before declaring\s+done\s+a critical change/, 'and it says when to spend the quota');

    const tools = /^tools: \[(.+)\]$/m.exec(md);
    assert.ok(tools, name + ' must declare tools');
    for (const tool of tools[1].split(',').map((t) => t.trim())) {
      assert.ok(KNOWN_TOOLS.has(tool), tool + ' is not a real Antigravity tool — it would hang the subagent');
    }
    assert.ok(!/^tools: Read/m.test(md), 'the Claude tool list is gone');
  }
  rmSync(home, { recursive: true, force: true });
});

test('the skill loses argument-hint and points at this checkout', () => {
  const home = fresh();
  assert.equal(install(home).status, 0);

  const skill = readFileSync(join(home, 'config', 'skills', 'smugan', 'SKILL.md'), 'utf8');
  assert.ok(!/^argument-hint:/m.test(skill), 'an unknown frontmatter key risks the skill being dropped');
  assert.match(skill, /Scopes: `security \| rls \| ui \| flows \| dead-code \| full`/);
  assert.ok(!skill.includes('~/.claude/'));
  assert.ok(skill.includes('config/rules'), 'the rules path points at the host-adapted installed rules');
  rmSync(home, { recursive: true, force: true });
});

test('both surfaces are registered and point at the same launcher', () => {
  const home = fresh();
  assert.equal(install(home).status, 0);

  const ide = JSON.parse(readFileSync(join(home, 'config', 'hooks.json'), 'utf8'));
  const cli = JSON.parse(readFileSync(join(home, 'antigravity-cli', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(ide.smugan).sort(), ['PostToolUse', 'PreToolUse', 'Stop', 'enabled'].sort());
  assert.deepEqual(ide.smugan, cli.smugan, 'one launcher on disk, two registrations');

  const command = ide.smugan.PreToolUse[0].hooks[0].command;
  assert.match(command, /smugan-hook\.mjs" pre$/);
  assert.ok(command.includes(home.replace(/\\/g, '/')), 'absolute path — a relative command exits 127');
  assert.ok(ide.smugan.Stop[0].hooks[0].timeout >= 300, 'the end-of-turn check runs typecheck and tests');
  assert.ok(ide.smugan.PreToolUse[0].hooks[0].timeout > 0, 'timeout 0 kills the subprocess instantly');

  for (const file of ['smugan-hook.mjs', 'normalize.mjs', 'rule-teach.mjs', 'smugan.paths.json']) {
    assert.ok(existsSync(join(home, 'smugan', 'hooks', file)), file + ' is missing');
  }
  const paths = JSON.parse(readFileSync(join(home, 'smugan', 'hooks', 'smugan.paths.json'), 'utf8'));
  assert.match(paths.gateDir, /packages\/gate$/);
  assert.match(paths.rulesDir, /config\/rules$/, 'installed rules resolve the same host skill references');
  assert.ok(existsSync(join(paths.rulesDir, 'nextjs.md')));
  assert.ok(existsSync(join(home, 'config', 'skills', 'smugan-build', 'references', 'nextjs.md')));
  assert.ok(existsSync(paths.nodeBin));
  rmSync(home, { recursive: true, force: true });
});

test('an existing hook from someone else is preserved', () => {
  const home = fresh();
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(join(home, 'config', 'hooks.json'), JSON.stringify({ 'their-hook': { enabled: true } }));

  assert.equal(install(home).status, 0);
  const merged = JSON.parse(readFileSync(join(home, 'config', 'hooks.json'), 'utf8'));
  assert.deepEqual(merged['their-hook'], { enabled: true });
  assert.ok(merged.smugan);
  rmSync(home, { recursive: true, force: true });
});

test('a malformed hooks.json aborts the install without touching it', () => {
  const home = fresh();
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(join(home, 'config', 'hooks.json'), '{ this is not json');

  const res = install(home);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /not valid JSON/);
  assert.equal(readFileSync(join(home, 'config', 'hooks.json'), 'utf8'), '{ this is not json');
  rmSync(home, { recursive: true, force: true });
});

test('a malformed SECOND surface aborts before anything at all is written', () => {
  const home = fresh();
  mkdirSync(join(home, 'antigravity-cli'), { recursive: true });
  writeFileSync(join(home, 'antigravity-cli', 'hooks.json'), '{ broken');

  const res = install(home);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /not valid JSON/);
  // "nothing was written" has to be literally true, or one surface ends up
  // hooked and the other not.
  assert.ok(!existsSync(join(home, 'AGENTS.md')), 'no steering');
  assert.ok(!existsSync(join(home, 'config', 'hooks.json')), 'no half-installed first surface');
  assert.ok(!existsSync(join(home, 'smugan', 'hooks', 'smugan-hook.mjs')), 'no launcher');
  rmSync(home, { recursive: true, force: true });
});

test('a rule the user added to the Definition of done survives the rewrite', () => {
  const home = fresh();
  const fake = mkdtempSync(join(tmpdir(), 'smugan-agy-extra-'));
  mkdirSync(join(fake, 'packages', 'gate', 'src'), { recursive: true });
  writeFileSync(join(fake, 'packages', 'gate', 'src', 'hook.mjs'), '');
  for (const file of ['language.cjs', 'profile.cjs', 'parts.cjs']) copyFileSync(join(SMUGAN, 'packages', 'gate', 'src', file), join(fake, 'packages', 'gate', 'src', file));
  mkdirSync(join(fake, 'claude', 'agents'), { recursive: true });
  mkdirSync(join(fake, 'claude', 'rules'), { recursive: true });
  mkdirSync(join(fake, 'claude', 'skills', 'smugan'), { recursive: true });
  for (const file of ['critic.md', 'flow-critic.md']) {
    copyFileSync(join(SMUGAN, 'claude', 'agents', file), join(fake, 'claude', 'agents', file));
  }
  copyFileSync(join(SMUGAN, 'claude', 'skills', 'smugan', 'SKILL.md'), join(fake, 'claude', 'skills', 'smugan', 'SKILL.md'));

  const claudeMd = readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8');
  const flowBullet = /^- Critical change, or an ordinary one over.*\r?\n/m.exec(claudeMd);
  cpSync(join(SMUGAN, 'claude', 'skills', 'smugan-build'), join(fake, 'claude', 'skills', 'smugan-build'), { recursive: true });
  assert.ok(flowBullet, 'the flow-critic bullet must exist to place a rule after it');
  const mine = '- MINHA REGRA: nunca declarar pronto sem rodar o E2E de pagamento.\n';
  writeFileSync(join(fake, 'claude', 'CLAUDE.md'), claudeMd.replace(flowBullet[0], flowBullet[0] + mine));

  const res = install(home, fake);
  assert.equal(res.status, 0, res.stderr);
  assert.match(steeringOf(home), /MINHA REGRA/, 'the rewrite must consume only its own bullet');
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('a CLAUDE.md missing its anchors aborts the install', () => {
  const home = fresh();
  const fake = fakeCheckout('smugan-agy-fake-', '# Rules\n\n## Definition of done\n\n- checks.\n');

  const res = install(home, fake);
  assert.notEqual(res.status, 0, 'better to fail loudly than to install broken steering');
  assert.match(res.stderr, /Stack rules/);
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('a reviewer phrase wrapped onto a second line aborts instead of keeping Claude Code wording', () => {
  const home = fresh();
  const real = readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8');
  assert.ok(real.includes('launch the `critic` subagent'), 'the phrase must exist to wrap it');
  const fake = fakeCheckout('smugan-agy-wrap-', real.replace('launch the `critic` subagent', 'launch the `critic`\n  subagent'));

  const res = install(home, fake);
  assert.notEqual(res.status, 0, 'the steering would keep a reviewer this host cannot launch that way');
  assert.match(res.stderr, /no longer says "launch the `critic` subagent" exactly once/);
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('a CRLF checkout of CLAUDE.md produces the same steering as an LF one', () => {
  const real = readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');
  const steerings = ['\n', '\r\n'].map((eol) => {
    const home = fresh();
    const fake = fakeCheckout('smugan-agy-eol-', real.split('\n').join(eol));
    const res = install(home, fake);
    assert.equal(res.status, 0, res.stderr);
    const steering = steeringOf(home);
    rmSync(home, { recursive: true, force: true });
    rmSync(fake, { recursive: true, force: true });
    return steering;
  });
  assert.ok(!steerings[1].includes('\r'), 'no carriage return reaches the steering');
  assert.equal(steerings[1], steerings[0]);
});

test('the gotchas draft measured in evals/ would still fit the steering if it ships', async () => {
  const { applyDraft, loadScenarios } = await import(pathToFileURL(join(SMUGAN, 'evals', 'run.mjs')).href);
  const { draft } = loadScenarios().find((/** @type {{ id: string }} */ s) => s.id === 'claude-md-gotchas');
  const home = fresh();
  const fake = fakeCheckout('smugan-agy-draft-', applyDraft(readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8'), draft.claudeMd));
  const res = install(home, fake);
  assert.equal(res.status, 0, res.stderr);
  const steering = steeringOf(home);
  assert.match(steering, /## Gotchas/);
  assert.ok(steering.length <= 8000, `steering with the draft is ${steering.length} chars`);
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('steering over the platform cap aborts instead of being truncated', () => {
  const home = fresh();
  const real = readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8');
  const fake = fakeCheckout('smugan-agy-big-', real.replace('## Code', '## Code\n\n' + 'x'.repeat(13000)));

  const res = install(home, fake);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /12000/);
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('a hook target of the wrong type aborts before writing anything', () => {
  const home = fresh();
  // The CLI surface exists, but as a file — writing into it would throw halfway
  // through, after the first surface was already hooked.
  writeFileSync(join(home, 'antigravity-cli'), 'not a directory');

  const res = install(home);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /not a directory/);
  assert.ok(!existsSync(join(home, 'AGENTS.md')), 'no steering');
  assert.ok(!existsSync(join(home, 'config', 'hooks.json')), 'and no half-hooked first surface');
  rmSync(home, { recursive: true, force: true });
});

test('an incomplete smugan checkout aborts before writing anything', () => {
  const home = fresh();
  const fake = fakeCheckout('smugan-agy-partial-', readFileSync(join(SMUGAN, 'claude', 'CLAUDE.md'), 'utf8'));
  rmSync(join(fake, 'claude', 'agents'), { recursive: true, force: true });

  const res = install(home, fake);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /missing in the smugan checkout/);
  assert.ok(!existsSync(join(home, 'AGENTS.md')), 'no steering was written');
  assert.ok(!existsSync(join(home, 'smugan', 'hooks', 'smugan-hook.mjs')), 'and no launcher');
  rmSync(home, { recursive: true, force: true });
  rmSync(fake, { recursive: true, force: true });
});

test('the install-time language choice reaches every installed file', () => {
  const home = mkdtempSync(join(tmpdir(), 'smugan-agy-lang-'));
  const pt = { SMUGAN_UI_LANG: 'pt-BR', SMUGAN_REPLY_LANG: 'pt-BR' };
  const rule = join(home, 'config', 'rules', 'ui-ptbr.md');
  const paths = () => JSON.parse(readFileSync(join(home, 'smugan', 'hooks', 'smugan.paths.json'), 'utf8'));
  // No {{TOKEN}} may reach the host, in any markdown the installer wrote.
  const leftovers = () => [home].flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .filter((file) => /\{\{[A-Z_]+\}\}/.test(readFileSync(file, 'utf8'))));

  let res = install(home);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'a pt-BR UI rule is not installed while the UI language is off');
  assert.ok(!steeringOf(home).includes('NÃO FEITO'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], [null, null]);
  assert.match(res.stdout, /= UI language: off · reply language: off/);

  res = install(home, SMUGAN, pt);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'pt-BR as UI language installs its rule');
  assert.equal((steeringOf(home).match(/NÃO FEITO/g) ?? []).length, 1);
  assert.ok(!steeringOf(home).includes('NOT DONE'));
  assert.deepEqual(leftovers(), []);
  assert.deepEqual([paths().uiLanguage, paths().replyLanguage], ['pt-BR', 'pt-BR']);
  assert.match(res.stdout, /= UI language: pt-BR · reply language: pt-BR/);

  res = install(home);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(rule), 'a plain reinstall keeps the previous choice');

  res = install(home, SMUGAN, { SMUGAN_UI_LANG: 'off' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(rule), 'turning the UI language off removes the rule it installed');

  const clean = mkdtempSync(join(tmpdir(), 'smugan-agy-lang-'));
  res = install(clean, SMUGAN, { SMUGAN_UI_LANG: 'not a tag' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /SMUGAN_UI_LANG/);
  assert.deepEqual(readdirSync(clean), [], 'an invalid language aborts before any write');
  rmSync(home, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
});

test('SMUGAN_DISABLE rewrites the reviewer bullet for the one left and drops the disabled parts', () => {
  const home = fresh();
  try {
    const res = install(home, SMUGAN, { SMUGAN_DISABLE: 'critic,smugan' });
    assert.equal(res.status, 0, res.stderr);
    const steering = steeringOf(home);
    assert.match(steering, /call `invoke_subagent` with `flow-critic` when users see the change/);
    assert.doesNotMatch(steering, /`critic`|run the critic/);
    assert.ok(!existsSync(join(home, 'config', 'agents', 'critic.md')));
    assert.ok(existsSync(join(home, 'config', 'agents', 'flow-critic.md')));
    assert.ok(!existsSync(join(home, 'config', 'skills', 'smugan', 'SKILL.md')));
    const both = install(home, SMUGAN, { SMUGAN_DISABLE: 'critic,flow-critic' });
    assert.equal(both.status, 0, both.stderr);
    assert.doesNotMatch(steeringOf(home), /invoke_subagent|critic`|Brief a reviewer/);
    assert.ok(existsSync(join(home, 'config', 'skills', 'smugan', 'SKILL.md')), 'a skill no longer listed comes back');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
