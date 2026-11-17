// @ts-check
// Version A/B: the same everyday coding request, run against this checkout and
// against an earlier ref of smugan, both installed by their own install.sh into
// throwaway configs. Nothing here calls /smugan: the prompts are ordinary
// requests, so the arms measure the passive layer. Each task carries a hidden
// suite the agent never sees; it is copied in only after the session ends.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const NO_NETWORK = pathToFileURL(join(HERE, 'no-network.mjs')).href;

/**
 * @typedef {'trivial' | 'normal' | 'critical' | 'llm'} Level
 * `guides`: a fixture folder of fake AI guides seeded into the run's own
 * guide cache, so no session researches or touches the user's real one.
 * `prompts`: requests run as separate sessions, in order, on the same project
 * (a chained PR1 → PR2, a multi-turn feature); `prompt` is the one-request form.
 * @typedef {{ id: string, level: Level, prompt?: string, prompts?: string[], fixture: string, change?: string,
 *   hidden: string, check: string, agentTests?: string, guides?: string }} Task
 * @typedef {{ durationMs: number | null, costUsd: number | null, stops: number, testsAdded: number,
 *   escaped: boolean | null, networkCalls: number | null, error: string | null }} TaskMeasure
 */

const LEVELS = new Set(['trivial', 'normal', 'critical', 'llm']);

/** @returns {Task[]} */
export function loadTasks(dir = join(HERE, 'tasks')) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const task = /** @type {Task} */ ({ id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) });
    const prompts = task.prompts ?? (task.prompt ? [task.prompt] : []);
    if (!LEVELS.has(task.level) || !prompts.length || !prompts.every((p) => typeof p === 'string' && p) || !task.fixture || !task.hidden || !task.check) {
      throw new Error(`tarefa ${task.id}: level, prompt (ou prompts), fixture, hidden e check são obrigatórios`);
    }
    return task;
  });
}

/**
 * A detached worktree of `ref`, sharing this checkout's gate dependencies.
 * @param {string} ref @param {string} dir
 */
export function checkoutBaseline(ref, dir) {
  const add = spawnSync('git', ['-C', REPO, 'worktree', 'add', '--detach', dir, ref], { encoding: 'utf8', timeout: 60_000 });
  if (add.status !== 0) throw new Error(`git worktree add ${ref}: ${add.stderr}`);
  const deps = join(REPO, 'packages', 'gate', 'node_modules');
  if (existsSync(deps)) symlinkSync(deps, join(dir, 'packages', 'gate', 'node_modules'), 'junction');
  return dir;
}

/** @param {string} dir */
export function removeBaseline(dir) {
  spawnSync('git', ['-C', REPO, 'worktree', 'remove', '--force', dir], { timeout: 60_000 });
}

/**
 * Holds and questions are the interruptions the user feels: Stop holds that
 * kept the turn open, and questions the session asked.
 * @param {string} stream
 */
export function measureTaskStream(stream) {
  let stops = 0;
  /** @type {number | null} */ let durationMs = null;
  /** @type {number | null} */ let costUsd = null;
  for (const line of stream.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    /** @type {any} */ let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // a torn line from a killed session carries no event
    }
    if (event.type === 'system' && event.subtype === 'hook_response' && event.exit_code === 2 && /(?:smugan|smaug) stop:/.test(`${event.stderr ?? ''}${event.stdout ?? ''}`)) stops++;
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      stops += event.message.content.filter((/** @type {any} */ c) => c?.type === 'tool_use' && c.name === 'AskUserQuestion').length;
    }
    // A chained task runs one session per request: each ends with its own result.
    if (event.type === 'result') {
      if (typeof event.duration_ms === 'number') durationMs = (durationMs ?? 0) + event.duration_ms;
      if (typeof event.total_cost_usd === 'number') costUsd = (costUsd ?? 0) + event.total_cost_usd;
    }
  }
  return { stops, durationMs, costUsd };
}

const TEST_FILE_RE = /(?:^|\/)(?:tests?|__tests__|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py|rs)$|(?:^|\/)test_[^/]+\.py$/;
const TEST_CASE_RE = /^\+\s*(?:(?:it|test)(?:\.\w+)?\s*\(|#\[(?:tokio::)?test\]|def test_)/;

/**
 * Lines the session added, tests and code alike, against the base commit:
 * the size SlopCodeBench and TRIM measure.
 * @param {string} projectDir
 */
export function addedLines(projectDir) {
  const run = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  run(['add', '-A']);
  const stat = run(['diff', '--cached', '--numstat', '--no-color']);
  if (stat.status !== 0) throw new Error(`git diff: ${stat.stderr}`);
  return stat.stdout.split('\n').reduce((sum, line) => sum + (Number(line.split('\t')[0]) || 0), 0);
}

/** Test cases the session added, from the project's diff against its base commit. @param {string} projectDir */
export function countTestsAdded(projectDir) {
  const run = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  run(['add', '-A']);
  const diff = run(['diff', '--cached', '--unified=0', '--no-color']);
  if (diff.status !== 0) throw new Error(`git diff: ${diff.stderr}`);
  let file = '';
  let count = 0;
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ (?:b\/)?/, '');
    else if (TEST_FILE_RE.test(file) && TEST_CASE_RE.test(line)) count++;
  }
  return count;
}

/**
 * @param {string} command @param {string} cwd @param {NodeJS.ProcessEnv} env @param {number} timeoutMs
 * @returns {Promise<number | null>} exit status, null on timeout
 */
function runCommand(command, cwd, env, timeoutMs) {
  // An inherited NODE_TEST_CONTEXT makes a child `node --test` skip every file
  // and exit 0: a hidden suite would pass without running.
  const clean = { ...env };
  delete clean.NODE_TEST_CONTEXT;
  return new Promise((done) => {
    const child = spawn(command, { cwd, env: clean, shell: true, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(null); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); done(1); });
    child.on('close', (status) => { clearTimeout(timer); done(status); });
  });
}

/**
 * Network attempts made by the agent's own tests: a test that calls a real
 * model trips the preload, which records the attempt and refuses it.
 * @param {string} command @param {string} projectDir @param {string} logFile
 */
export async function countNetworkCalls(command, projectDir, logFile) {
  rmSync(logFile, { force: true });
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${NO_NETWORK}`.trim(), SMUGAN_EVAL_NET_LOG: logFile };
  await runCommand(command, projectDir, env, 120_000);
  return existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0;
}

/**
 * Copies the hidden suite in and runs it: a failure is a defect the session
 * shipped as done.
 * @param {Task} task @param {string} projectDir
 */
export async function hiddenSuiteFails(task, projectDir) {
  cpSync(join(HERE, 'fixtures', task.hidden), projectDir, { recursive: true });
  const status = await runCommand(task.check, projectDir, { ...process.env }, 120_000);
  return status !== 0;
}

/**
 * Measures one finished session's project. Order matters: tests added and
 * network calls come from the delivery alone, before the hidden suite lands.
 * @param {Task} task @param {string} projectDir @param {string} stream @param {string} runDir
 * @returns {Promise<Omit<TaskMeasure, 'error'>>}
 */
export async function measureTask(task, projectDir, stream, runDir) {
  const { stops, durationMs, costUsd } = measureTaskStream(stream);
  const testsAdded = countTestsAdded(projectDir);
  const networkCalls = task.agentTests ? await countNetworkCalls(task.agentTests, projectDir, join(runDir, 'network.log')) : null;
  const escaped = await hiddenSuiteFails(task, projectDir);
  return { durationMs, costUsd, stops, testsAdded, escaped, networkCalls };
}

/** @param {TaskMeasure[]} runs */
export function summarizeTask(runs) {
  const valid = runs.filter((r) => !r.error);
  const mean = (/** @type {(r: TaskMeasure) => number | null} */ pick) => {
    const values = valid.map(pick).filter((v) => typeof v === 'number');
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  return {
    runs: runs.length,
    errors: runs.length - valid.length,
    durationMs: mean((r) => r.durationMs),
    costUsd: mean((r) => r.costUsd),
    stops: mean((r) => r.stops),
    testsAdded: mean((r) => r.testsAdded),
    escapedRate: mean((r) => (r.escaped === null ? null : r.escaped ? 1 : 0)),
    networkCalls: mean((r) => r.networkCalls),
  };
}

/**
 * The decision rule: each target, the baseline and current numbers, and
 * whether it holds. A target with no data on either side is not met.
 * @param {{ task: Task, base: ReturnType<typeof summarizeTask>, current: ReturnType<typeof summarizeTask> }[]} results
 */
export function decide(results) {
  /** @param {(r: (typeof results)[number]) => boolean} filter @param {'base' | 'current'} arm @param {keyof ReturnType<typeof summarizeTask>} key */
  const total = (filter, arm, key) => {
    const values = results.filter(filter).map((r) => r[arm][key]);
    return values.length && values.every((v) => typeof v === 'number') ? values.reduce((s, v) => s + /** @type {number} */ (v), 0) : null;
  };
  /** @param {number | null} base @param {number | null} current @param {number} drop */
  const cut = (base, current, drop) => base !== null && current !== null && (base === 0 ? current === 0 : current <= base * (1 - drop));
  const all = () => true;
  const llm = (/** @type {(typeof results)[number]} */ r) => r.task.level === 'llm';
  const critical = (/** @type {(typeof results)[number]} */ r) => r.task.level === 'critical';
  const other = (/** @type {(typeof results)[number]} */ r) => r.task.level === 'trivial' || r.task.level === 'normal';
  /** @type {{ target: string, base: number | null, current: number | null, ok: boolean }[]} */
  const rows = [];
  const row = (/** @type {string} */ target, /** @type {number | null} */ base, /** @type {number | null} */ current, /** @type {boolean} */ ok) => rows.push({ target, base, current, ok });
  for (const [key, label, drop] of /** @type {const} */ ([['durationMs', 'tempo de parede', 0.25], ['costUsd', 'custo', 0.25], ['stops', 'paradas', 0.5]])) {
    const base = total(all, 'base', key);
    const current = total(all, 'current', key);
    row(`${label}: queda de ${drop * 100}% ou mais`, base, current, cut(base, current, drop));
  }
  const llmBase = total(llm, 'base', 'testsAdded');
  const llmCurrent = total(llm, 'current', 'testsAdded');
  row('testes nas tarefas com LLM: queda de 50% ou mais', llmBase, llmCurrent, cut(llmBase, llmCurrent, 0.5));
  const calls = total(llm, 'current', 'networkCalls');
  row('chamadas de rede dos testes nas tarefas com LLM: zero', total(llm, 'base', 'networkCalls'), calls, calls === 0);
  const critBase = total(critical, 'base', 'escapedRate');
  const critCurrent = total(critical, 'current', 'escapedRate');
  row('defeitos escapados no crítico: sem piora', critBase, critCurrent, critBase !== null && critCurrent !== null && critCurrent <= critBase);
  const otherBase = total(other, 'base', 'escapedRate');
  const otherCurrent = total(other, 'current', 'escapedRate');
  const otherCount = results.filter(other).length || 1;
  row('defeitos escapados no trivial e no normal: até +1 em 20', otherBase, otherCurrent,
    otherBase !== null && otherCurrent !== null && (otherCurrent - otherBase) / otherCount <= 0.05);
  return rows;
}
