// @ts-check
// smugan doctor against a real installation made by install.sh in a throwaway
// CLAUDE_CONFIG_DIR: green when the copies match the checkout, red with the
// file name when one drifts, and the end-to-end Write must come back blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../src/doctor.mjs';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(GATE, '..', '..');
const bash = process.env.SMUGAN_TEST_BASH
  || (process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash');
const hasBash = spawnSync(bash, ['-c', 'exit 0'], { timeout: 10_000 }).status === 0;
const skip = hasBash ? false : `bash not found at ${bash}`;

/** @param {string} claudeDir @param {Record<string, string>} [env] @param {string[]} [args] */
function install(claudeDir, env = {}, args = []) {
  return spawnSync(bash, ['--noprofile', '--norc', join(REPO, 'install.sh').replace(/\\/g, '/'), ...args], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, SMUGAN_BIN_DIR: join(claudeDir, 'bin'), ...env },
  });
}

/**
 * The smugan command goes to <claudeDir>/bin, never to the real ~/.local/bin;
 * runDoctor reads the same folder through SMUGAN_BIN_DIR while the body runs.
 * @param {(claudeDir: string, binDir: string) => void} body @param {Record<string, string>} [env]
 */
function withInstall(body, env = {}) {
  const claudeDir = mkdtempSync(join(tmpdir(), 'smugan-doctor-config-'));
  const previous = process.env.SMUGAN_BIN_DIR;
  try {
    const result = install(claudeDir, env);
    assert.equal(result.status, 0, result.stderr);
    process.env.SMUGAN_BIN_DIR = join(claudeDir, 'bin');
    body(claudeDir, join(claudeDir, 'bin'));
  } finally {
    if (previous === undefined) delete process.env.SMUGAN_BIN_DIR;
    else process.env.SMUGAN_BIN_DIR = previous;
    rmSync(claudeDir, { recursive: true, force: true });
  }
}

/** Runs body with `dir` first on the PATH. @param {string} dir @param {() => void} body */
function withPathFirst(dir, body) {
  const previous = process.env.PATH;
  process.env.PATH = dir + delimiter + (previous ?? '');
  try {
    body();
  } finally {
    process.env.PATH = previous;
  }
}

/** @param {ReturnType<typeof runDoctor>} lines */
const failures = (lines) => lines.filter((l) => l.level === 'fail').map((l) => l.text);

test('a fresh installation passes every check, including the end-to-end block', { skip }, () => {
  withInstall((claudeDir) => {
    const lines = runDoctor({ claudeDir, gateDir: GATE });
    assert.deepEqual(failures(lines), []);
    const texts = lines.map((l) => l.text).join('\n');
    assert.match(texts, /test write blocked by the installed hook/);
    assert.match(texts, /test end of turn completed/);
    assert.match(texts, /hooks point to this checkout/);
  });
});

test('a rule edited by hand is named as a stale copy', { skip }, () => {
  withInstall((claudeDir) => {
    appendFileSync(join(claudeDir, 'rules', 'testing.md'), '\n- local tweak\n');
    const fail = failures(runDoctor({ claudeDir, gateDir: GATE }));
    assert.equal(fail.length, 1);
    assert.match(fail[0], /rules\/testing\.md/);
    assert.match(fail[0], /install\.sh/);
  });
});

test('a missing Stop hook is a failure that names the event', { skip }, () => {
  withInstall((claudeDir) => {
    const file = join(claudeDir, 'settings.json');
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    delete settings.hooks.Stop;
    writeFileSync(file, JSON.stringify(settings));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /missing from settings\.json: Stop/);
  });
});

test('disableAllHooks in the user or project settings is a failure even though the launcher works', { skip }, () => {
  withInstall((claudeDir) => {
    const file = join(claudeDir, 'settings.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), disableAllHooks: true }));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /disableAllHooks.*turns off every hook/);
  });
  withInstall((claudeDir) => {
    const project = mkdtempSync(join(tmpdir(), 'smugan-doctor-project-'));
    try {
      mkdirSync(join(project, '.claude'));
      writeFileSync(join(project, '.claude', 'settings.local.json'), '{"disableAllHooks": true}');
      assert.match(failures(runDoctor({ claudeDir, gateDir: GATE, project })).join('\n'), /settings\.local\.json turns hooks off in sessions in this folder/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test('reviewers installed with SMUGAN_REVIEW_MODEL still count as up to date', { skip }, () => {
  withInstall((claudeDir) => {
    assert.match(readFileSync(join(claudeDir, 'agents', 'critic.md'), 'utf8'), /^model: sonnet$/m);
    assert.deepEqual(failures(runDoctor({ claudeDir, gateDir: GATE })), []);
  }, { SMUGAN_REVIEW_MODEL: 'sonnet' });
});

test('the minimo profile drops flow-critic everywhere, sticks on reinstall and still passes doctor', { skip }, () => {
  withInstall((claudeDir) => {
    const agents = join(claudeDir, 'agents');
    const check = () => {
      assert.ok(!existsSync(join(agents, 'flow-critic.md')));
      assert.match(readFileSync(join(agents, 'critic.md'), 'utf8'), /^model: haiku$/m);
      assert.doesNotMatch(readFileSync(join(agents, 'smugan-ai-research.md'), 'utf8'), /^model:/m, 'only the reviewers change model');
      assert.doesNotMatch(readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf8'), /flow-critic/);
      assert.equal(JSON.parse(readFileSync(join(claudeDir, 'hooks', 'smugan.paths.json'), 'utf8')).profile, 'minimo');
      assert.deepEqual(failures(runDoctor({ claudeDir, gateDir: GATE })), []);
    };
    check();
    const again = install(claudeDir);
    assert.equal(again.status, 0, again.stderr);
    check();
    writeFileSync(join(agents, 'flow-critic.md'), readFileSync(join(REPO, 'claude', 'agents', 'flow-critic.md')));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /agents\/flow-critic\.md \(not used by profile minimo\)/);
    const back = install(claudeDir, { SMUGAN_PROFILE: 'completo' });
    assert.equal(back.status, 0, back.stderr);
    assert.doesNotMatch(readFileSync(join(agents, 'critic.md'), 'utf8'), /^model:/m);
    assert.match(readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf8'), /plus the `flow-critic` subagent/);
  }, { SMUGAN_PROFILE: 'minimo' });
});

test('SMUGAN_DISABLE drops a reviewer, a skill and a rule everywhere, sticks on reinstall and passes doctor', { skip }, () => {
  withInstall((claudeDir) => {
    const paths = join(claudeDir, 'hooks', 'smugan.paths.json');
    const check = () => {
      assert.ok(!existsSync(join(claudeDir, 'agents', 'flow-critic.md')));
      assert.ok(!existsSync(join(claudeDir, 'rules', 'nextjs.md')));
      assert.ok(!existsSync(join(claudeDir, 'skills', 'smugan-build', 'SKILL.md')));
      assert.ok(existsSync(join(claudeDir, 'skills', 'smugan-build', 'references', 'nextjs.md')), 'the guides the rules link to stay');
      const claudeMd = readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf8');
      assert.doesNotMatch(claudeMd, /flow-critic|smugan-build|`nextjs\.md`/);
      assert.match(claudeMd, /launch the `critic` subagent\. Resolve/);
      assert.match(claudeMd, /Before technical changes, run `smugan context --json <target-path>`/);
      assert.deepEqual(JSON.parse(readFileSync(paths, 'utf8')).disable, ['flow-critic', 'nextjs', 'smugan-build']);
      const lines = runDoctor({ claudeDir, gateDir: GATE });
      assert.deepEqual(failures(lines), []);
      assert.match(lines.map((l) => l.text).join('\n'), /disabled in this installation: flow-critic, nextjs, smugan-build/);
    };
    check();
    const again = install(claudeDir);
    assert.equal(again.status, 0, again.stderr);
    check();
    const before = readFileSync(paths, 'utf8');
    const bad = install(claudeDir, { SMUGAN_DISABLE: 'critic,revisor' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /SMUGAN_DISABLE does not know revisor/);
    assert.equal(readFileSync(paths, 'utf8'), before, 'an unknown name fails before any write');
    assert.ok(existsSync(join(claudeDir, 'agents', 'critic.md')));
    writeFileSync(join(claudeDir, 'skills', 'smugan-build', 'SKILL.md'), readFileSync(join(REPO, 'claude', 'skills', 'smugan-build', 'SKILL.md')));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /skills\/smugan-build\/SKILL\.md \(disabled\)/);
    const cleared = install(claudeDir, { SMUGAN_DISABLE: 'none' });
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.ok(existsSync(join(claudeDir, 'agents', 'flow-critic.md')));
    assert.ok(existsSync(join(claudeDir, 'rules', 'nextjs.md')));
    assert.match(readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf8'), /plus the `flow-critic` subagent/);
    assert.deepEqual(failures(runDoctor({ claudeDir, gateDir: GATE })), []);
  }, { SMUGAN_DISABLE: 'smugan-build, flow-critic,NEXTJS' });
});

test('SMUGAN_REVIEW_MODEL wins over the profile, and an unknown profile changes nothing', { skip }, () => {
  withInstall((claudeDir) => {
    assert.match(readFileSync(join(claudeDir, 'agents', 'critic.md'), 'utf8'), /^model: opus$/m);
    assert.match(readFileSync(join(claudeDir, 'agents', 'flow-critic.md'), 'utf8'), /^model: opus$/m);
    const bad = install(claudeDir, { SMUGAN_PROFILE: 'barato' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /SMUGAN_PROFILE must be one of completo, economico, minimo/);
    assert.equal(JSON.parse(readFileSync(join(claudeDir, 'hooks', 'smugan.paths.json'), 'utf8')).profile, 'economico');
  }, { SMUGAN_PROFILE: 'economico', SMUGAN_REVIEW_MODEL: 'opus' });
});

test('install writes a smugan command that runs this checkout, and doctor follows the PATH', { skip }, () => {
  withInstall((claudeDir, binDir) => {
    const version = JSON.parse(readFileSync(join(GATE, 'package.json'), 'utf8')).version;
    const env = { ...process.env, PATH: binDir + delimiter + process.env.PATH };
    const viaBash = spawnSync(bash, ['--noprofile', '--norc', '-c', 'smugan version'], { encoding: 'utf8', timeout: 30_000, env });
    assert.equal(viaBash.stdout.trim(), `smugan ${version}`, viaBash.stderr);
    if (process.platform === 'win32') {
      const viaCmd = spawnSync('cmd.exe', ['/d', '/c', 'smugan version'], { encoding: 'utf8', timeout: 30_000, env, windowsHide: true });
      assert.equal(viaCmd.stdout.trim(), `smugan ${version}`, viaCmd.stderr);
    }
    const off = runDoctor({ claudeDir, gateDir: GATE }).find((l) => /smugan command|is not on the PATH/.test(l.text));
    assert.equal(off?.level, 'warn');
    assert.match(off?.text ?? '', /is not on the PATH/);
    withPathFirst(binDir, () => {
      const on = runDoctor({ claudeDir, gateDir: GATE }).find((l) => /smugan command/.test(l.text));
      assert.deepEqual(on, { level: 'ok', text: `smugan command on the PATH (${binDir.replace(/\\/g, '/')}) points to this checkout` });
    });
    const again = install(claudeDir);
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /was not written by Smugan/, 'a reinstall recognizes its own command');
  });
});

test('a smugan command the installer did not write is kept and named', { skip }, () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'smugan-doctor-config-'));
  try {
    const binDir = join(claudeDir, 'bin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'smugan'), '#!/bin/sh\necho mine\n');
    const result = install(claudeDir, { PATH: binDir + delimiter + process.env.PATH });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /bin\/smugan already exists and was not written by Smugan; left as it was\. To use Smugan's, rename or delete/);
    assert.match(result.stdout, /Check the installation: node ".*bin\/smugan\.mjs" doctor/, 'the hints never point at the foreign command');
    assert.equal(readFileSync(join(binDir, 'smugan'), 'utf8'), '#!/bin/sh\necho mine\n');
    const line = runDoctor({ claudeDir, gateDir: GATE, binDir }).find((l) => /bin\/smugan\b/.test(l.text));
    assert.equal(line?.level, 'warn');
    assert.match(line?.text ?? '', /was not written by Smugan's install\.sh/);
  } finally {
    rmSync(claudeDir, { recursive: true, force: true });
  }
});

test('no installation at all fails without throwing', () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'smugan-doctor-empty-'));
  try {
    const fail = failures(runDoctor({ claudeDir, gateDir: GATE }));
    assert.match(fail.join('\n'), /settings\.json does not exist/);
    assert.match(fail.join('\n'), /installed copies that differ/);
  } finally {
    rmSync(claudeDir, { recursive: true, force: true });
  }
});

test('an active smugan.local.json is named', () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'smugan-doctor-local-'));
  const project = mkdtempSync(join(tmpdir(), 'smugan-doctor-proj-'));
  try {
    writeFileSync(join(project, 'smugan.local.json'), '{}');
    const lines = runDoctor({ claudeDir, gateDir: GATE, project }).map((l) => l.text).join('\n');
    assert.match(lines, /personal layer active: .*smugan\.local\.json/);
  } finally {
    rmSync(claudeDir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a reviewer without the recorded model, or with another one, is a stale copy', { skip }, () => {
  withInstall((claudeDir) => {
    const critic = join(claudeDir, 'agents', 'critic.md');
    const installed = readFileSync(critic, 'utf8');
    assert.equal(JSON.parse(readFileSync(join(claudeDir, 'hooks', 'smugan.paths.json'), 'utf8')).reviewModel, 'sonnet');
    assert.match(installed, /\nmodel: sonnet\r?\n/);
    writeFileSync(critic, installed.replace(/\nmodel: sonnet(?=\r?\n)/, ''));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /agents\/critic\.md/);
    writeFileSync(critic, installed.replace('\nmodel: sonnet', '\nmodel: opus'));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /agents\/critic\.md/);
    writeFileSync(critic, installed);
    assert.deepEqual(failures(runDoctor({ claudeDir, gateDir: GATE })), []);
  }, { SMUGAN_PROFILE: 'economico' });
  withInstall((claudeDir) => {
    const critic = join(claudeDir, 'agents', 'critic.md');
    writeFileSync(critic, readFileSync(critic, 'utf8').replace(/^---(\r?\n)/, '---$1model: haiku$1'));
    assert.match(failures(runDoctor({ claudeDir, gateDir: GATE })).join('\n'), /agents\/critic\.md/, 'completo installs no model line');
  });
});

/** Every file under dir with its content, relative paths. @param {string} dir @returns {Record<string, string>} */
function snapshot(dir) {
  /** @type {Record<string, string>} */
  const out = {};
  const walk = (/** @type {string} */ at, /** @type {string} */ prefix) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(at, entry.name), prefix + entry.name + '/');
      else out[prefix + entry.name] = readFileSync(join(at, entry.name), 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

test('install.sh --uninstall removes exactly what the install wrote and keeps the rest', { skip }, () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'smugan-uninstall-'));
  const uninstall = () => install(claudeDir, {}, ['--uninstall']);
  try {
    const mine = { type: 'command', command: 'echo mine' };
    const user = {
      'CLAUDE.md': '# Minhas regras\n\nfique aqui\n',
      'settings.json': JSON.stringify({ theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }], Stop: [{ hooks: [mine] }] } }, null, 2) + '\n',
      'rules/mine.md': '# minha regra\n',
      'agents/mine.md': '---\nname: mine\n---\n',
      'skills/smugan/NOTES.md': 'anotação minha dentro da pasta da skill\n',
      'hooks/other.mjs': 'export {};\n',
      'bin/smugan': '#!/bin/sh\necho mine\n',
    };
    for (const [file, text] of Object.entries(user)) {
      mkdirSync(dirname(join(claudeDir, file)), { recursive: true });
      writeFileSync(join(claudeDir, file), text);
    }
    const before = snapshot(claudeDir);
    const result = install(claudeDir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(claudeDir, 'hooks', 'smugan.paths.json')));
    const removed = uninstall();
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /smugan removed from/);
    assert.deepEqual(snapshot(claudeDir), before);
    assert.match(uninstall().stdout, /nothing from smugan found/, 'a second run finds nothing to remove');

    assert.equal(install(claudeDir).status, 0);
    const settingsFile = join(claudeDir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, 'utf8')), outputStyle: 'Explanatory' }, null, 2) + '\n');
    assert.equal(uninstall().status, 0);
    assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).outputStyle, 'Explanatory', 'an output style the user chose stays');

    writeFileSync(settingsFile, '{ broken');
    assert.equal(install(claudeDir).status, 1);
    const broken = uninstall();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /not valid JSON.*Nothing was removed/);
    assert.ok(existsSync(join(claudeDir, 'hooks', 'smugan.paths.json')));
  } finally {
    rmSync(claudeDir, { recursive: true, force: true });
  }
});
