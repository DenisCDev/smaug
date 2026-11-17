#!/usr/bin/env node
// @ts-check
// Rule evals: does a smugan rule change what the agent does? Each scenario runs
// a real headless Claude Code session twice per repetition, in a throwaway
// config installed by install.sh: once with the rule, once with it removed.
// The measure is what the gate itself counts, not a model's opinion: blocks
// the hooks issued for the scenario's rules, and violations left in the
// delivered files. Every run costs tokens; nothing here runs in CI except the
// pipeline test with a fake claude.
//
//   node evals/run.mjs --scenario <id|all> [--reps 3] [--model <id>]
//        [--claude <command>] [--budget-usd 5] [--timeout-min 15] [--dry-run]
//   node evals/run.mjs --tasks <id|all> --baseline <git ref> [same options]
//        (version A/B on everyday requests; see ab.mjs)
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, checkoutBaseline, decide, loadTasks, measureTask, removeBaseline, summarizeTask } from './ab.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const GATE_BIN = join(REPO, 'packages', 'gate', 'bin', 'smugan.mjs');
const START = '<!-- >>> smugan:start';
const END = '<!-- <<< smugan:end -->';
const say = (/** @type {string} */ line) => process.stdout.write(line + '\n');

/**
 * @typedef {{ id: string, prompt: string, fixture: string, change?: string,
 *   ablate: { claudeMd?: string[], rules?: string[], agents?: string[], items?: string[], skills?: string[] },
 *   draft?: { claudeMd?: { file: string, after: string, remove?: string[] } },
 *   expect: { rules?: string[], resultMatches?: string, resultNotMatches?: string, addedLines?: boolean } }} Scenario
 * `draft`: a rule not shipped yet, from evals/drafts, applied to the arm
 * with it only; `ablate` names its section, and the arm without it is the
 * installation as it ships.
 * @typedef {{ blocks: number, ruleBlocks: number, leftViolations: number, resultMatch: boolean | null,
 *   hookEventsSeen: boolean, costUsd: number | null, addedLines: number | null, error: string | null }} Measure
 */

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const args = { reps: '3', 'budget-usd': '5', 'timeout-min': '15', claude: 'claude' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'dry-run') args[key] = true;
    else args[key] = argv[++i] ?? '';
  }
  return args;
}

/** @returns {Scenario[]} */
export function loadScenarios(dir = join(HERE, 'scenarios')) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => /** @type {Scenario} */ ({ id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

/** Removes `## <Section>` blocks from the smugan block of CLAUDE.md. @param {string} text @param {string[]} sections */
export function dropSections(text, sections) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error('CLAUDE.md sem o bloco do smugan');
  const lines = text.slice(start, end).split(/\r?\n/);
  for (const section of sections) {
    if (!lines.some((l) => l.trim() === `## ${section}`)) throw new Error(`seção "## ${section}" não existe no CLAUDE.md`);
  }
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) dropping = sections.includes(heading[1]);
    if (!dropping) kept.push(line);
  }
  return text.slice(0, start) + kept.join('\n') + text.slice(end);
}

/**
 * Removes one item, the one whose bold label is `**<label>**`, with its
 * continuation lines: the arm without a single item of a prompt. The item is
 * a list entry, or a paragraph inside a step that opens with the label and
 * ends where the next bold paragraph or list entry starts.
 * @param {string} text @param {string} label
 */
export function dropItem(text, label) {
  const lines = text.split(/\r?\n/);
  const isEntry = (/** @type {string} */ l) => /^\s*(?:[-*]|\d+\.)\s/.test(l);
  const start = lines.findIndex((l) => (isEntry(l) && l.includes(`**${label}**`)) || l.trimStart().startsWith(`**${label}**`));
  if (start < 0) throw new Error(`item "**${label}**" não existe no arquivo`);
  const paragraph = !isEntry(lines[start]);
  const indent = /^\s*/.exec(lines[start])?.[0].length ?? 0;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const own = /^\s*/.exec(line)?.[0].length ?? 0;
    if (line.trim() === '') break;
    if (paragraph ? own < indent || isEntry(line) || line.trimStart().startsWith('**') : own <= indent) break;
    end++;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

function bashPath() {
  if (process.env.SMUGAN_EVAL_BASH) return process.env.SMUGAN_EVAL_BASH;
  return process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash';
}

/**
 * Inserts a `## ` section right after the section named `after`, inside the
 * smugan block when the text has one.
 * @param {string} text @param {string} section @param {string} after
 */
export function addSection(text, section, after) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  const [from, to] = start >= 0 && end > start ? [start, end] : [0, text.length];
  const lines = text.slice(from, to).split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === `## ${after}`);
  if (at < 0) throw new Error(`seção "## ${after}" não existe no CLAUDE.md`);
  let next = lines.findIndex((l, i) => i > at && /^## /.test(l));
  if (next < 0) next = lines.length;
  const draft = section.replace(/\r\n/g, '\n').trim().split('\n');
  return text.slice(0, from) + [...lines.slice(0, next), ...draft, '', ...lines.slice(next)].join('\n') + text.slice(to);
}

/**
 * A rule not shipped yet, as it would ship: the text it replaces removed (each
 * piece exactly once), its section added from evals/drafts.
 * @param {string} text @param {NonNullable<NonNullable<Scenario['draft']>['claudeMd']>} draft
 */
export function applyDraft(text, draft) {
  let out = text.replace(/\r\n/g, '\n');
  for (const piece of draft.remove ?? []) {
    const count = out.split(piece).length - 1;
    if (count !== 1) throw new Error(`rascunho ${draft.file}: o trecho a remover aparece ${count} vez(es) no CLAUDE.md: ${piece.slice(0, 60)}`);
    out = out.replace(piece, '');
  }
  return addSection(out, readFileSync(join(HERE, 'drafts', draft.file), 'utf8'), draft.after);
}

/** The `## ` headings a scenario's draft adds. @param {Scenario} scenario */
export function draftSections(scenario) {
  const file = scenario.draft?.claudeMd?.file;
  return file ? [...readFileSync(join(HERE, 'drafts', file), 'utf8').matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]) : [];
}

/**
 * Installs smugan from `root` into a fresh config dir, applies a draft (the
 * arm with a rule that does not ship yet), then removes what the arm ablates.
 * @param {string} configDir @param {Scenario['ablate'] | null} ablate @param {string} [root] checkout to install
 * @param {Scenario['draft']} [draft]
 */
export function prepareConfig(configDir, ablate, root = REPO, draft) {
  mkdirSync(configDir, { recursive: true });
  const install = spawnSync(bashPath(), ['--noprofile', '--norc', join(root, 'install.sh').replace(/\\/g, '/')], {
    // The arm's smugan command stays in its config dir, off the user's ~/.local/bin.
    // SMAUG_* reaches baselines installed from before the rename; the scenarios
    // were written for a pt-BR install, so both languages are pinned to it.
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, SMUGAN_BIN_DIR: join(configDir, 'bin'), SMAUG_BIN_DIR: join(configDir, 'bin'), SMUGAN_UI_LANG: 'pt-BR', SMUGAN_REPLY_LANG: 'pt-BR' },
  });
  if (install.status !== 0) throw new Error(`install.sh falhou: ${install.error?.message ?? install.stderr}`);
  if (draft?.claudeMd) {
    const file = join(configDir, 'CLAUDE.md');
    writeFileSync(file, applyDraft(readFileSync(file, 'utf8'), draft.claudeMd));
  }
  if (!ablate) return;
  if (ablate.claudeMd?.length) {
    const file = join(configDir, 'CLAUDE.md');
    writeFileSync(file, dropSections(readFileSync(file, 'utf8'), ablate.claudeMd));
  }
  // `<file under the config dir>#<bold label>`: the arm without one item of a prompt.
  for (const item of ablate.items ?? []) {
    const [path, label] = item.split('#');
    const file = join(configDir, path);
    if (!label || !existsSync(file)) throw new Error(`items "${item}": use <arquivo instalado>#<rótulo>, como agents/critic.md#Contract drift.`);
    writeFileSync(file, dropItem(readFileSync(file, 'utf8'), label));
  }
  for (const [dir, names] of /** @type {const} */ ([['rules', ablate.rules], ['agents', ablate.agents], ['skills', ablate.skills]])) {
    for (const name of names ?? []) {
      const target = join(configDir, dir, name);
      if (!existsSync(target)) throw new Error(`${dir}/${name} não existe na instalação`);
      rmSync(target, { recursive: true, force: true });
    }
  }
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=smugan-evals', '-c', 'user.email=evals@smugan.invalid', ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** @param {Scenario} scenario @param {string} projectDir */
export function prepareProject(scenario, projectDir) {
  cpSync(join(HERE, 'fixtures', scenario.fixture), projectDir, { recursive: true });
  git(projectDir, ['init', '-q']);
  git(projectDir, ['add', '-A']);
  git(projectDir, ['commit', '-qm', 'base']);
  // A review scenario starts from an uncommitted change the agent did not write.
  if (scenario.change) cpSync(join(HERE, 'fixtures', scenario.change), projectDir, { recursive: true });
}

/** Kills the session and everything it started. @param {import('node:child_process').ChildProcess} child */
function killTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000 });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * @param {string} command @param {string[]} args @param {{ cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number }} options
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
function runSession(command, args, { cwd, env, timeoutMs }) {
  const [bin, prefix] = command.endsWith('.mjs') ? [process.execPath, [command]] : [command, []];
  return new Promise((done) => {
    const child = spawn(bin, [...prefix, ...args], { cwd, env, detached: process.platform !== 'win32', windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
    const timer = setTimeout(() => { killTree(child); done({ status: null, stdout, stderr, timedOut: true }); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); done({ status: null, stdout, stderr: String(error), timedOut: false }); });
    child.on('close', (status) => { clearTimeout(timer); done({ status, stdout, stderr, timedOut: false }); });
  });
}

/**
 * Counts what the hooks did from the session's stream-json, the same event
 * shape the smugan bench reads: `system/hook_response` with an exit code.
 * @param {string} stream @param {string[]} rules
 */
export function measureStream(stream, rules) {
  let blocks = 0;
  let ruleBlocks = 0;
  let hookEventsSeen = false;
  /** @type {string | null} */ let result = null;
  /** @type {number | null} */ let costUsd = null;
  for (const line of stream.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    /** @type {any} */ let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // a torn line from a killed session carries no event
    }
    if (event.type === 'system' && event.subtype === 'hook_response') {
      hookEventsSeen = true;
      const text = `${event.stderr ?? ''}\n${event.stdout ?? ''}\n${event.output ?? ''}`;
      if (event.exit_code === 2 && /(?:smugan|smaug) (gate|stop|hook):/.test(text)) {
        blocks++;
        for (const m of text.matchAll(/\[([a-z][a-z0-9-]+)\]/g)) if (rules.includes(m[1])) ruleBlocks++;
      }
    }
    if (event.type === 'result') {
      result = typeof event.result === 'string' ? event.result : null;
      costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null;
    }
  }
  return { blocks, ruleBlocks, hookEventsSeen, result, costUsd };
}

/**
 * A response counts when it matches `resultMatches` and not `resultNotMatches`:
 * a pattern for "found it" alone also matches "there is no X". Unicode mode,
 * so `(?<!\p{L})` bounds words that carry accents.
 * @param {Scenario['expect']} expect @returns {{ test: (text: string) => boolean }}
 */
export function resultMatcher(expect) {
  const yes = new RegExp(expect.resultMatches ?? '', 'iu');
  const no = expect.resultNotMatches ? new RegExp(expect.resultNotMatches, 'iu') : null;
  return { test: (text) => yes.test(text) && !(no?.test(text) ?? false) };
}

/** @param {string} projectDir @param {string[]} rules */
function leftViolations(projectDir, rules) {
  if (!rules.length) return 0;
  // Same language the arms were installed with, not the developer's own install.
  const check = spawnSync(process.execPath, [GATE_BIN, 'check', '--json'], { cwd: projectDir, encoding: 'utf8', timeout: 120_000, env: { ...process.env, SMUGAN_UI_LANG: 'pt-BR' } });
  if (check.status !== 0 && check.status !== 1) throw new Error(`smugan check falhou: ${check.stderr}`);
  const report = JSON.parse(check.stdout);
  return report.violations.filter((/** @type {{ rule: string }} */ v) => rules.includes(v.rule)).length;
}

/**
 * @param {Scenario} scenario @param {'with' | 'without'} arm @param {number} rep @param {string} workDir
 * @param {Record<string, string | boolean>} args @returns {Promise<Measure>}
 */
export async function runOne(scenario, arm, rep, workDir, args) {
  const runDir = join(workDir, scenario.id, `${arm}-${rep}`);
  const configDir = join(runDir, 'config');
  const projectDir = join(runDir, 'project');
  const rules = scenario.expect.rules ?? [];
  try {
    // A draft lives only in the arm with it; the other arm is what ships today.
    const drafted = draftSections(scenario);
    if (arm === 'with') prepareConfig(configDir, null, REPO, scenario.draft);
    else prepareConfig(configDir, { ...scenario.ablate, claudeMd: (scenario.ablate.claudeMd ?? []).filter((s) => !drafted.includes(s)) });
    prepareProject(scenario, projectDir);
    const claudeArgs = ['-p', scenario.prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
      '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(args['budget-usd'])];
    if (args.model) claudeArgs.push('--model', String(args.model));
    const session = await runSession(String(args.claude), claudeArgs, {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, DISABLE_AUTOUPDATER: '1', SMUGAN_AI_GUIDES_DIR: join(runDir, 'ai-guides'), SMAUG_AI_GUIDES_DIR: join(runDir, 'ai-guides') },
      timeoutMs: Number(args['timeout-min']) * 60_000,
    });
    writeFileSync(join(runDir, 'stream.jsonl'), session.stdout);
    const measured = measureStream(session.stdout, rules);
    const pattern = scenario.expect.resultMatches ? resultMatcher(scenario.expect) : null;
    const error = session.timedOut ? 'prazo excedido' : session.status !== 0 ? `claude saiu com ${session.status}: ${session.stderr.slice(-300)}` : null;
    return {
      blocks: measured.blocks,
      ruleBlocks: measured.ruleBlocks,
      leftViolations: leftViolations(projectDir, rules),
      resultMatch: pattern ? pattern.test(measured.result ?? '') : null,
      hookEventsSeen: measured.hookEventsSeen,
      addedLines: scenario.expect.addedLines ? addedLines(projectDir) : null,
      costUsd: measured.costUsd,
      error,
    };
  } catch (error) {
    return { blocks: 0, ruleBlocks: 0, leftViolations: 0, resultMatch: null, hookEventsSeen: false, costUsd: null, addedLines: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One A/B session: install the arm's smugan, run the everyday request, then
 * measure the delivery (see ab.mjs).
 * @param {import('./ab.mjs').Task} task @param {'current' | 'base'} arm @param {number} rep @param {string} workDir
 * @param {Record<string, string | boolean>} args @param {string} root checkout the arm installs
 * @returns {Promise<import('./ab.mjs').TaskMeasure>}
 */
export async function runTask(task, arm, rep, workDir, args, root) {
  const runDir = join(workDir, task.id, `${arm}-${rep}`);
  const configDir = join(runDir, 'config');
  const projectDir = join(runDir, 'project');
  try {
    prepareConfig(configDir, null, root);
    const prompts = task.prompts ?? [String(task.prompt)];
    prepareProject({ id: task.id, prompt: prompts[0], fixture: task.fixture, change: task.change, ablate: {}, expect: {} }, projectDir);
    const guidesDir = join(runDir, 'ai-guides');
    mkdirSync(guidesDir, { recursive: true });
    if (task.guides) cpSync(join(HERE, 'fixtures', task.guides), guidesDir, { recursive: true });
    // Each request is its own session, as separate PRs are; a failed one ends the chain.
    let stream = '';
    /** @type {string | null} */
    let error = null;
    for (const [i, prompt] of prompts.entries()) {
      const claudeArgs = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
        '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(args['budget-usd'])];
      if (args.model) claudeArgs.push('--model', String(args.model));
      const session = await runSession(String(args.claude), claudeArgs, {
        cwd: projectDir,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, DISABLE_AUTOUPDATER: '1', SMUGAN_AI_GUIDES_DIR: guidesDir, SMAUG_AI_GUIDES_DIR: guidesDir },
        timeoutMs: Number(args['timeout-min']) * 60_000,
      });
      stream += session.stdout;
      writeFileSync(join(runDir, prompts.length > 1 ? `stream-${i + 1}.jsonl` : 'stream.jsonl'), session.stdout);
      const label = prompts.length > 1 ? `pedido ${i + 1}: ` : '';
      error = session.timedOut ? `${label}prazo excedido` : session.status !== 0 ? `${label}claude saiu com ${session.status}: ${session.stderr.slice(-300)}` : null;
      if (error) break;
    }
    return { ...(await measureTask(task, projectDir, stream, runDir)), error };
  } catch (error) {
    return { durationMs: null, costUsd: null, stops: 0, testsAdded: 0, escaped: null, networkCalls: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** @param {number | null} n */
const pct = (n) => (n === null ? '—' : `${Math.round(n * 100)}%`);

/** @param {Record<string, string | boolean>} args */
async function mainTasks(args) {
  const all = loadTasks();
  const wanted = String(args.tasks);
  const tasks = wanted === 'all' ? all : all.filter((t) => t.id === wanted);
  if (!tasks.length) {
    console.error(`evals: tarefa "${wanted}" não existe. Disponíveis: ${all.map((t) => t.id).join(', ')}, all`);
    process.exit(2);
  }
  if (typeof args.baseline !== 'string' || !args.baseline) {
    console.error('evals: --tasks compara duas versões do smugan; passe --baseline <ref do git>, por exemplo --baseline main.');
    process.exit(2);
  }
  const reps = Number(args.reps);
  if (args['dry-run']) {
    for (const t of tasks) say(`${t.id} (${t.level}): ${reps} repetição(ões) × este checkout e ${args.baseline}`);
    return;
  }
  if (args.claude === 'claude' && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.error('evals: cada sessão usa um CLAUDE_CONFIG_DIR próprio e não enxerga o login normal. Defina CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) ou ANTHROPIC_API_KEY.');
    process.exit(2);
  }
  const workDir = mkdtempSync(join(tmpdir(), 'smugan-ab-'));
  const outDir = join(HERE, 'results');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'ab-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  say(`Sessões e configs: ${workDir}\nResultados (atualizados a cada execução): ${outFile}\n`);
  const baseRoot = checkoutBaseline(String(args.baseline), join(workDir, 'baseline'));
  /** @type {{ task: import('./ab.mjs').Task, base: ReturnType<typeof summarizeTask>, current: ReturnType<typeof summarizeTask>, runs: Record<string, import('./ab.mjs').TaskMeasure[]> }[]} */
  const results = [];
  const save = (/** @type {boolean} */ complete) => writeFileSync(outFile, JSON.stringify({ args, workDir, complete, results }, null, 2));
  try {
    for (const task of tasks) {
      /** @type {Record<'current' | 'base', import('./ab.mjs').TaskMeasure[]>} */
      const arms = { current: [], base: [] };
      const entry = { task, base: summarizeTask([]), current: summarizeTask([]), runs: arms };
      results.push(entry);
      for (let rep = 1; rep <= reps; rep++) {
        for (const arm of /** @type {const} */ (['current', 'base'])) {
          const m = await runTask(task, arm, rep, workDir, args, arm === 'current' ? REPO : baseRoot);
          arms[arm].push(m);
          entry.base = summarizeTask(arms.base);
          entry.current = summarizeTask(arms.current);
          save(false);
          say(`${task.id} ${arm === 'current' ? 'atual' : 'base'} #${rep}: ${m.durationMs === null ? '—' : Math.round(m.durationMs / 1000) + ' s'}, paradas ${m.stops}, testes ${m.testsAdded}, defeito escapado ${m.escaped === null ? '—' : m.escaped ? 'sim' : 'não'}${m.networkCalls === null ? '' : `, chamadas de rede ${m.networkCalls}`}${m.error ? ` — erro: ${m.error}` : ''}`);
        }
      }
    }
  } finally {
    removeBaseline(baseRoot);
  }
  save(true);
  say(`\ntarefa | nível | braço | execuções | erros | tempo s | custo US$ | paradas | testes | escapados | rede`);
  for (const r of results) {
    for (const arm of /** @type {const} */ (['base', 'current'])) {
      const s = r[arm];
      say(`${r.task.id} | ${r.task.level} | ${arm === 'current' ? 'atual' : String(args.baseline)} | ${s.runs} | ${s.errors} | ${s.durationMs === null ? '—' : (s.durationMs / 1000).toFixed(0)} | ${fmt(s.costUsd)} | ${fmt(s.stops)} | ${fmt(s.testsAdded)} | ${pct(s.escapedRate)} | ${fmt(s.networkCalls)}`);
    }
  }
  say('\nRegra de decisão:');
  for (const d of decide(results)) say(`  ${d.ok ? '✓' : '✗'} ${d.target}: ${fmt(d.base)} → ${fmt(d.current)}`);
  say(`\nResultados: ${outFile}\nCompare só com 3 ou mais execuções válidas por braço. Se uma meta falhar, reverta só a peça responsável e meça de novo.`);
}

/** @param {Measure[]} runs */
export function summarize(runs) {
  const valid = runs.filter((r) => !r.error);
  const mean = (/** @type {(r: Measure) => number} */ pick) => (valid.length ? valid.reduce((s, r) => s + pick(r), 0) / valid.length : null);
  const matches = valid.filter((r) => r.resultMatch !== null);
  return {
    runs: runs.length,
    errors: runs.length - valid.length,
    ruleBlocks: mean((r) => r.ruleBlocks),
    leftViolations: mean((r) => r.leftViolations),
    resultMatchRate: matches.length ? matches.filter((r) => r.resultMatch).length / matches.length : null,
    hookEventsMissing: valid.filter((r) => !r.hookEventsSeen).length,
    costUsd: valid.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    addedLines: valid.some((r) => r.addedLines !== null) ? valid.reduce((s, r) => s + (r.addedLines ?? 0), 0) / valid.length : null,
  };
}

/** @param {number | null} n */
const fmt = (n) => (n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.tasks) return mainTasks(args);
  const all = loadScenarios();
  const wanted = String(args.scenario ?? '');
  const scenarios = wanted === 'all' ? all : all.filter((s) => s.id === wanted);
  if (!scenarios.length) {
    console.error(`evals: cenário "${wanted}" não existe. Disponíveis: ${all.map((s) => s.id).join(', ')}, all`);
    process.exit(2);
  }
  const reps = Number(args.reps);
  if (args['dry-run']) {
    for (const s of scenarios) say(`${s.id}: ${reps} repetição(ões) × com e sem ${JSON.stringify(s.ablate)}`);
    return;
  }
  if (args.claude === 'claude' && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.error('evals: cada sessão usa um CLAUDE_CONFIG_DIR próprio e não enxerga o login normal. Defina CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) ou ANTHROPIC_API_KEY.');
    process.exit(2);
  }
  const workDir = mkdtempSync(join(tmpdir(), 'smugan-evals-'));
  const outDir = join(HERE, 'results');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  // Written after every run: an interrupted batch still leaves the sessions it
  // already paid for, with their numbers and the folder of their streams.
  say(`Sessões e configs: ${workDir}\nResultados (atualizados a cada execução): ${outFile}\n`);
  /** @type {Record<string, { with: ReturnType<typeof summarize>, without: ReturnType<typeof summarize>, runs: Record<string, Measure[]> }>} */
  const results = {};
  const save = (/** @type {boolean} */ complete) => writeFileSync(outFile, JSON.stringify({ args, workDir, complete, results }, null, 2));
  for (const scenario of scenarios) {
    /** @type {Record<string, Measure[]>} */
    const arms = { with: [], without: [] };
    for (let rep = 1; rep <= reps; rep++) {
      for (const arm of /** @type {const} */ (['with', 'without'])) {
        const m = await runOne(scenario, arm, rep, workDir, args);
        arms[arm].push(m);
        results[scenario.id] = { with: summarize(arms.with), without: summarize(arms.without), runs: arms };
        save(false);
        say(`${scenario.id} ${arm} #${rep}: bloqueios das regras ${m.ruleBlocks}, violações restantes ${m.leftViolations}${m.addedLines === null ? '' : `, linhas adicionadas ${m.addedLines}`}${m.resultMatch === null ? '' : `, resposta esperada ${m.resultMatch ? 'sim' : 'não'}`}${m.error ? ` — erro: ${m.error}` : ''}`);
      }
    }
  }
  save(true);
  say('\ncenário | braço | execuções | erros | bloqueios das regras | violações restantes | resposta esperada | linhas adicionadas | custo US$');
  for (const [id, r] of Object.entries(results)) {
    for (const arm of /** @type {const} */ (['with', 'without'])) {
      const s = r[arm];
      say(`${id} | ${arm === 'with' ? 'com a regra' : 'sem a regra'} | ${s.runs} | ${s.errors} | ${fmt(s.ruleBlocks)} | ${fmt(s.leftViolations)} | ${s.resultMatchRate === null ? '—' : `${Math.round(s.resultMatchRate * 100)}%`} | ${fmt(s.addedLines)} | ${s.costUsd.toFixed(2)}`);
      if (s.hookEventsMissing) say(`  aviso: ${s.hookEventsMissing} execução(ões) sem eventos de hook no stream; os bloqueios delas não foram contados`);
    }
  }
  say(`\nResultados: ${outFile}\nSessões e configs: ${workDir}\nCompare os braços só com 3 ou mais execuções válidas em cada um, e quando os números não se sobrepõem.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
