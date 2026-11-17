#!/usr/bin/env node
// @ts-check
// smugan — quality gate and version-aware local project context.
// rev smg-chitwuhzyx
//
//   smugan check [paths...] [--json] [--warn]   run checks (default: whole project)
//   smugan hook <pre|post|stop>        Claude Code hook entry (JSON on stdin)
//   smugan init                        scaffold config + Tier 2 harness templates
//   smugan context | doctor | why | contract   see help()
//   smugan version | help
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPaths } from '../src/engine.mjs';
import { formatHuman, formatJson } from '../src/format.mjs';
import { runHook } from '../src/hook.mjs';
import { runInit } from '../src/init.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = (/** @type {string} */ s) => process.stdout.write(s);

// Outside a hook the CLI follows the Claude Code install's UI language, so a
// manual or audit `smugan check` judges strings the way the hooks do.
if (process.env.SMUGAN_UI_LANG === undefined) {
  const pathsFile = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'hooks', 'smugan.paths.json');
  if (existsSync(pathsFile)) {
    try {
      const installed = JSON.parse(readFileSync(pathsFile, 'utf8').replace(/^﻿/, ''));
      if (typeof installed.uiLanguage === 'string') process.env.SMUGAN_UI_LANG = installed.uiLanguage;
    } catch (error) {
      process.stderr.write(`smugan: ${pathsFile} is unreadable (${error instanceof Error ? error.message : String(error)}); the UI language stays off\n`);
    }
  }
}
const err = (/** @type {string} */ s) => process.stderr.write(s);

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';

switch (command) {
  case 'context':
    try {
      const { runContext } = await import('../src/context.mjs');
      out(runContext(argv.slice(1)));
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND');
      err(missing ? 'smugan: parsers unavailable; install the gate package dependencies with npm ci --ignore-scripts (in the Claude Code plugin, session start installs them).\n'
        : `smugan: ${error instanceof Error ? error.message : 'Failed to get local context.'}\n`);
      process.exitCode = 2;
    }
    break;
  case 'risk':
    try {
      const { runRisk } = await import('../src/risk.mjs');
      out(runRisk(argv.slice(1)));
    } catch (error) {
      err(`smugan: ${error instanceof Error ? error.message : 'failed to read the risk level.'}\n`);
      process.exitCode = 2;
    }
    break;
  case 'ai-guide':
    try {
      const { runAiGuide } = await import('../src/ai-guides.mjs');
      out(runAiGuide(argv.slice(1)));
    } catch (error) {
      err(`smugan: ${error instanceof Error ? error.message : 'AI guide failed.'}\n`);
      process.exitCode = 2;
    }
    break;
  case 'check':
    check(argv.slice(1));
    break;
  case 'contract':
    process.exitCode = await contract(argv.slice(1));
    break;
  case 'doctor': {
    const { formatDoctor, runDoctor } = await import('../src/doctor.mjs');
    const claudeDir = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
    const lines = runDoctor({ claudeDir, gateDir: join(HERE, '..') });
    out(argv.includes('--json') ? JSON.stringify({ claudeDir, lines }, null, 2) + '\n' : formatDoctor(lines, claudeDir));
    process.exitCode = lines.some((l) => l.level === 'fail') ? 1 : 0;
    break;
  }
  case 'why': {
    const { runWhy } = await import('../src/why.mjs');
    const { exitCode, output } = runWhy(argv.slice(1));
    (exitCode === 0 ? out : err)(output);
    process.exitCode = exitCode;
    break;
  }
  case 'hook':
    await hook(argv[1] === 'pre' || argv[1] === 'stop' ? argv[1] : 'post');
    break;
  case 'init':
    init();
    break;
  case 'version':
  case '--version':
  case '-v':
    out(version() + '\n');
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default:
    err(`smugan: unknown command "${command}"\n\n`);
    help();
    process.exit(2);
}

/** @param {string[]} args */
function check(args) {
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const cwd = process.cwd();

  try {
    /** @type {string[]} */
    const targets = [];
    for (const p of paths.length > 0 ? paths : ['.']) {
      const abs = resolve(cwd, p);
      if (!existsSync(abs)) {
        err(`smugan: path not found: ${p}\n`);
        process.exit(2);
      }
      targets.push(abs);
    }
    const result = checkPaths(targets, cwd);
    out(json ? formatJson(result) : formatHuman(result));
    for (const file of result.configErrors) err(`smugan: warning — could not use ${file} (invalid JSON or setting), ignoring that file\n`);
    // The config's "mode": "warn" never softens this: CI stays strict unless the
    // invocation itself opts out.
    process.exit(result.violations.length > 0 && !args.includes('--warn') ? 1 : 0);
  } catch (/** @type {any} */ error) {
    err(`smugan: internal error — ${error?.message ?? error}\n`);
    process.exit(2);
  }
}

/** @param {'pre' | 'post' | 'stop'} kind */
async function hook(kind) {
  const raw = await new Promise((resolvePromise) => {
    let data = '';
    const done = () => resolvePromise(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    setTimeout(done, 2000).unref();
  });
  try {
    const bom = new RegExp('^' + String.fromCharCode(0xfeff));
    const input = String(raw).replace(bom, '').trim();
    const { exitCode, stderr, stdout } = await runHook(kind, input ? JSON.parse(input) : {});
    if (stdout) out(stdout);
    if (stderr) err(stderr);
    process.exit(exitCode);
  } catch {
    process.exit(0); // fail open — smugan's own bugs never block the session
  }
}

/** @param {string[]} args @returns {Promise<number>} exit code */
async function contract(args) {
  const c = await import('../src/contract.mjs');
  let target = '.';
  /** @type {string | undefined} */ let set;
  /** @type {string[] | undefined} */ let mark;
  /** @type {string | undefined} */ let evidence;
  let clear = false;
  let replace = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // A flag missing its value must fail as usage, never fall through to "show".
    if (a === '--set') set = args[++i] ?? '';
    else if (a === '--mark') mark = [args[++i] ?? '', args[++i] ?? ''];
    else if (a === '--evidence') evidence = args[++i] ?? '';
    else if (a === '--clear') clear = true;
    else if (a === '--replace') replace = true;
    else if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      err(`smugan contract: unknown option ${a}\n`);
      return 2;
    } else target = a;
  }
  const actions = [set !== undefined, mark !== undefined, clear].filter(Boolean).length;
  if (actions > 1 || (set !== undefined && !set) || (mark && (!/^[1-9]\d*$/.test(mark[0] ?? '') || !mark[1]))
    || (evidence !== undefined && !mark) || (replace && set === undefined)) {
    err('smugan contract: usage — one action at a time: --set <contract.json> [--replace] | --mark <n> <pending|done|blocked> [--evidence "<text>"] | --clear | [--json]\n');
    return 2;
  }
  const root = c.contractRoot(target);
  try {
    if (set) {
      const checked = c.validateContract(c.readContractInput(set));
      if (!checked.ok) {
        err('smugan contract: contract rejected:\n' + checked.errors.map((e) => '  - ' + e).join('\n') + '\n');
        return 2;
      }
      const saved = c.saveContract(root, checked.value, { replace });
      if ('existing' in saved) {
        err(`smugan contract: there is already a ${c.contractSummary(saved.existing)}. Check with "smugan contract" whether it is finished; to replace it, repeat with --replace.\n`);
        return 2;
      }
      if (saved.replaced) out(`smugan contract: replaced the ${c.contractSummary(saved.replaced)}.\n\n`);
      if (saved.unreadable) out(`smugan contract: replaced the unreadable contract for ${root}.\n\n`);
      out(c.formatContract(saved.contract));
      return 0;
    }
    if (mark) {
      out(c.formatContract(c.markCriterion(root, Number(mark[0]), mark[1], evidence)));
      return 0;
    }
    if (clear) {
      const { contract: existing, unreadable } = c.readReplaceable(root);
      c.clearContract(root);
      out(existing ? `smugan contract: removed the ${c.contractSummary(existing)}.\n`
        : unreadable ? `smugan contract: removed the unreadable contract for ${root}.\n` : `smugan contract: there was no contract for ${root}.\n`);
      return 0;
    }
    const contract = c.readContract(root);
    if (!contract) {
      err(`smugan contract: no contract for ${root}.\n`);
      return 1;
    }
    out(json ? JSON.stringify(contract, null, 2) + '\n' : c.formatContract(contract));
    return 0;
  } catch (error) {
    err(`smugan contract: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

function init() {
  const lines = runInit(process.cwd(), join(HERE, '..'));
  out(lines.map((l) => '  ' + l).join('\n') + '\n');
  const added = (/** @type {string} */ file) => lines.includes(`+ ${file}`);
  const next = [
    added('supabase/tests/README.md') && 'read supabase/tests/README.md and describe your tables in SECURITY_NOTES.md',
    added('tests/app.context.md') && 'fill tests/app.context.md',
    added('docs/sentry-setup.md') && 'follow docs/sentry-setup.md',
  ].filter(Boolean);
  out(`\nsmugan: init complete.${next.length ? ' Next: ' + next.join('; ') + '.' : ''}\n`);
}

function version() {
  try {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
    return `smugan ${pkg.version}`;
  } catch {
    return 'smugan (unknown version)';
  }
}

function help() {
  out(`${version()} — passive quality gate for AI-generated code

usage:
  smugan context [target] [--json]   local versions and guides per package
      [--environment label] [--refresh] [--no-cache] [--record research.json]
  smugan check [paths...] [--json] [--warn]
                                     run checks (default: whole project from cwd); --warn exits 0 on violations
  smugan init                        scaffold config + Tier 2 harness (pgTAP, E2E,
                                    observability, SECURITY_NOTES, CI) — never overwrites
  smugan hook <pre|post|stop>        Claude Code hook entry (reads JSON on stdin)
  smugan risk [trivial|normal|critical|auto] [dir]
                                    force the checkout's risk level for 8 h (auto hands it back to the hook)
  smugan ai-guide [--write guide.md] [--project dir]
                                    the project's engine + model pairs and their guides; saves a researched guide
  smugan doctor [--json]             check the installation and pass a test event through the hook
  smugan why [--session id] [--json] what the hooks did in the most recent session
  smugan contract [target]           the checkout's acceptance contract (criteria and verification)
      [--set contract.json [--replace]] [--mark <n> <pending|done|blocked> [--evidence text]] [--clear] [--json]
  smugan version

exit codes: 0 clean · 1 violations found · 2 usage/internal error
checks: db-naming, rls, rls-tests, security-notes, ui-strings, no-any, secrets,
        console-log, dead-imports, stale-mutation, test-weakening, money-float,
        empty-catch, anon-grants, fetch-timeout, view-invoker, search-path,
        rls-policy
suppress a false positive: // smugan-ignore <rule>: <reason (6+ chars)>
`);
}
