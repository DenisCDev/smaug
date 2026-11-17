// @ts-check
// The eval pipeline end to end with a fake claude: real install.sh into a
// throwaway config, real ablation, real fixture project, real `smugan check`.
// Only the model is fake, so this costs no tokens and runs in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSection, applyDraft, draftSections, dropItem, dropSections, loadScenarios, measureStream, prepareConfig, resultMatcher, runOne, runTask, summarize } from '../run.mjs';
import { checkoutBaseline, countNetworkCalls, countTestsAdded, decide, loadTasks, measureTaskStream, removeBaseline, summarizeTask } from '../ab.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const bash = process.env.SMUGAN_EVAL_BASH
  || (process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash');
const hasBash = spawnSync(bash, ['-c', 'exit 0'], { timeout: 10_000 }).status === 0;

const BLOCK = '<!-- >>> smugan:start — managed -->\n\n# Rules\n\n## Code\n\n- small\n\n## Language\n\n- English SQL\n\n## Errors\n\n- deadlines\n\n<!-- <<< smugan:end -->\n';

test('dropSections removes only the named sections of the smugan block', () => {
  const out = dropSections('mine\n' + BLOCK, ['Language']);
  assert.match(out, /^mine\n/);
  assert.match(out, /## Code/);
  assert.match(out, /## Errors/);
  assert.doesNotMatch(out, /## Language|English SQL/);
  assert.throws(() => dropSections(BLOCK, ['Nope']), /não existe/);
});

test('a draft section lands after its anchor, and the gotchas draft keeps CLAUDE.md within 61 lines', () => {
  const out = addSection(BLOCK, '## Draft\n\n- new rule\n', 'Code');
  assert.match(out, /## Code\n\n- small\n\n## Draft\n\n- new rule\n\n## Language/);
  assert.throws(() => addSection(BLOCK, '## Draft\n', 'Nope'), /não existe/);
  const scenario = loadScenarios().find((s) => s.id === 'claude-md-gotchas');
  assert.ok(scenario?.draft?.claudeMd);
  assert.deepEqual(draftSections(scenario), ['Gotchas']);
  const claudeMd = readFileSync(join(HERE, '..', '..', 'claude', 'CLAUDE.md'), 'utf8');
  const promoted = applyDraft(claudeMd, scenario.draft.claudeMd);
  assert.match(promoted, /## Code\n[\s\S]*## Gotchas\n\n- Leave out unless needed: try\/catch[\s\S]*## Development preparation/);
  assert.doesNotMatch(promoted, /No over-engineering|Comments only for non-obvious WHY/, 'the generic phrasing it replaces is gone');
  const lines = promoted.split('\n').filter((l) => l.trim()).length;
  assert.ok(lines <= 61, `${lines} lines with text`);
});

test('measureStream counts smugan blocks of the scenario rules only', () => {
  const stream = [
    { type: 'system', subtype: 'hook_response', exit_code: 2, stderr: 'smugan gate: blocked — x\n  line 1  [db-naming]  a\n  line 2  [rls]  b' },
    { type: 'system', subtype: 'hook_response', exit_code: 0, stdout: 'smugan gate: blocked [db-naming]' },
    { type: 'system', subtype: 'hook_response', exit_code: 2, stderr: 'other tool [db-naming]' },
    { type: 'result', result: 'feito', total_cost_usd: 0.5 },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n{"torn';
  assert.deepEqual(measureStream(stream, ['db-naming']), { blocks: 1, ruleBlocks: 1, hookEventsSeen: true, result: 'feito', costUsd: 0.5 });
  assert.equal(measureStream('{"type":"result","result":"x"}', ['db-naming']).hookEventsSeen, false);
});

test('every shipped scenario names its fixture, an ablation and something to measure', () => {
  for (const s of loadScenarios()) {
    assert.ok(s.prompt && s.fixture, s.id);
    assert.ok(Object.values(s.ablate).some((v) => Array.isArray(v) && v.length), `${s.id}: ablate is empty`);
    assert.ok(s.expect.rules?.length || s.expect.resultMatches || s.expect.addedLines, `${s.id}: nothing to measure`);
  }
});

test('the IDOR scenario credits a review only when it flags the missing ownership check', () => {
  const scenario = loadScenarios().find((s) => s.id === 'critic-idor');
  assert.ok(scenario);
  const matcher = resultMatcher(scenario.expect);
  for (const miss of [
    'VERDICT: APPROVED. getNote retorna a nota pelo id; Note tem ownerId e body.',
    'Aprovado: getNote filtra por ownerId e devolve null quando não acha.',
    'VERDICT: APPROVED — the change adds getNote(db, userId, id) next to listNotes.',
    'VERDICT: APPROVED. A checagem roda no servidor e getNote compara ownerId.',
    'VERDICT: APPROVED. getNote sempre confere ownerId.',
    'VERDICT: APPROVED — não há IDOR: o ownerId é comparado.',
    'O consumidor da API recebe a nota; nada a apontar.',
  ]) assert.equal(matcher.test(miss), false, miss);
  for (const hit of [
    'VERDICT: REJECTED\nHIGH src/notes.ts:16 — getNote não verifica ownerId: qualquer usuário consegue abrir a nota de outro.',
    'getNote ignora o dono da nota.',
    'the userId parameter is never used, so any user can read another user\'s note',
    'IDOR in getNote',
    'Não aprovaria: qualquer usuário pode abrir notas de outros pelo id.',
  ]) assert.equal(matcher.test(hit), true, hit);
});

test('every shipped ablation applies to a real installation and every fixture exists', { skip: hasBash ? false : `bash não encontrado em ${bash}` }, () => {
  const workDir = mkdtempSync(join(tmpdir(), 'smugan-evals-ablate-'));
  try {
    for (const s of loadScenarios()) {
      assert.doesNotThrow(() => prepareConfig(join(workDir, s.id), s.ablate, undefined, s.draft), s.id);
      for (const dir of [s.fixture, s.change].filter(Boolean)) assert.ok(existsSync(join(HERE, '..', 'fixtures', /** @type {string} */ (dir))), `${s.id}: fixture ${dir}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the pipeline measures the arm with the rule against the arm without it', { skip: hasBash ? false : `bash não encontrado em ${bash}` }, async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'smugan-evals-test-'));
  try {
    const scenario = { id: 'naming', prompt: 'crie a migration', fixture: 'supabase-app', ablate: { claudeMd: ['Language'] }, expect: { rules: ['db-naming'] } };
    const args = { claude: join(HERE, 'fake-claude.mjs'), 'budget-usd': '1', 'timeout-min': '2' };
    const withRule = await runOne(scenario, 'with', 1, workDir, args);
    const withoutRule = await runOne(scenario, 'without', 1, workDir, args);
    assert.equal(withRule.error, null);
    assert.equal(withoutRule.error, null);
    assert.equal(withRule.ruleBlocks, 0);
    assert.equal(withRule.leftViolations, 0);
    assert.equal(withoutRule.ruleBlocks, 1, 'only the smugan block counts, not the other exit-2 hook');
    assert.equal(withoutRule.leftViolations, 1, 'smugan check finds the Portuguese column left in the delivery');
    const summary = summarize([withoutRule]);
    assert.equal(summary.ruleBlocks, 1);
    assert.equal(summary.costUsd, 0.01);
  } finally {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// --- version A/B on everyday requests (ab.mjs) ---

test('every shipped A/B task loads, and its fixture and hidden suite exist', () => {
  const tasks = loadTasks();
  assert.ok(tasks.some((t) => t.level === 'llm'), 'at least one task with LLM code');
  for (const t of tasks) {
    for (const dir of [t.fixture, t.change, t.hidden, t.guides].filter(Boolean)) assert.ok(existsSync(join(HERE, '..', 'fixtures', /** @type {string} */ (dir))), `${t.id}: fixture ${dir}`);
  }
});

test('the fake guides of the LLM tasks cover every pair the detector finds in their fixture', async () => {
  const { detectAi } = await import('../../packages/gate/src/ai-detect.mjs');
  const { guideState } = await import('../../packages/gate/src/ai-guides.mjs');
  const previous = process.env.SMUGAN_AI_GUIDES_DIR;
  try {
    for (const t of loadTasks().filter((task) => task.guides)) {
      process.env.SMUGAN_AI_GUIDES_DIR = join(HERE, '..', 'fixtures', /** @type {string} */ (t.guides));
      const pairs = detectAi(join(HERE, '..', 'fixtures', t.fixture)).pairs;
      assert.ok(pairs.length > 0, `${t.id}: the fixture uses an LLM`);
      for (const p of pairs) assert.equal(guideState(p.key).status, 'valid', `${t.id}: ${p.key} would send the session researching`);
    }
  } finally {
    if (previous === undefined) delete process.env.SMUGAN_AI_GUIDES_DIR;
    else process.env.SMUGAN_AI_GUIDES_DIR = previous;
  }
});

test('measureTaskStream counts Stop holds and questions as stops, with time and cost', () => {
  const stream = [
    { type: 'system', subtype: 'hook_response', exit_code: 2, stderr: 'smugan stop: this turn modified code' },
    { type: 'system', subtype: 'hook_response', exit_code: 2, stderr: 'smugan gate: blocked — x' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion' }, { type: 'tool_use', name: 'Edit' }] } },
    { type: 'result', duration_ms: 1500, total_cost_usd: 0.3 },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.deepEqual(measureTaskStream(stream), { stops: 2, durationMs: 1500, costUsd: 0.3 });
});

test('a chained task adds up the time and cost of each session', () => {
  const stream = [{ type: 'result', duration_ms: 1500, total_cost_usd: 0.25 }, { type: 'result', duration_ms: 500, total_cost_usd: 0.5 }]
    .map((e) => JSON.stringify(e)).join('\n');
  assert.deepEqual(measureTaskStream(stream), { stops: 0, durationMs: 2000, costUsd: 0.75 });
});

test('dropItem removes one labeled list item with its continuation lines, and refuses a missing label', () => {
  const text = 'intro\n\n   1. **Keep.** first\n      more of first\n   2. **Drop me.** second\n      more of second\n   3. **Also keep.** third\n\n## Next\n';
  const out = dropItem(text, 'Drop me.');
  assert.match(out, /\*\*Keep\.\*\* first\n {6}more of first\n {3}3\. \*\*Also keep\.\*\*/);
  assert.doesNotMatch(out, /Drop me|more of second/);
  assert.throws(() => dropItem(text, 'Nope.'), /não existe/);
});

test('the performance scenarios credit a query budget and a measured before/after, not their absence', () => {
  /** @param {string} id */
  const matcher = (id) => {
    const scenario = loadScenarios().find((s) => s.id === id);
    assert.ok(scenario, id);
    return resultMatcher(scenario.expect);
  };
  const budget = matcher('build-query-budget');
  for (const hit of ['O teste garante no máximo 2 consultas para 200 faturas.', 'listInvoices makes at most 2 queries regardless of the invoice count.', 'Verificado: 2 queries para 500 faturas.'])
    assert.equal(budget.test(hit), true, hit);
  for (const miss of ['Criei listInvoices e o teste passa.', 'Faz uma consulta por fatura, o que é ok para poucos itens.'])
    assert.equal(budget.test(miss), false, miss);
  const loop = matcher('build-measured-loop');
  for (const hit of ['Medi com 300 mil pedidos: 4200 ms → 85 ms.', 'Before: 3.1 s, after: dropped to 40 ms.'])
    assert.equal(loop.test(hit), true, hit);
  for (const miss of ['Troquei o filter por um Map; deve ficar O(n).', 'Ficou mais rápido, mas não medi: era 2 s para 1 s pela leitura do código.'])
    assert.equal(loop.test(miss), false, miss);
});

test('the executable-verify scenario credits a report whose every verify is a command', () => {
  const scenario = loadScenarios().find((s) => s.id === 'critic-executable-verify');
  assert.ok(scenario);
  const matcher = resultMatcher(scenario.expect);
  for (const hit of [
    'VERDICT: REJECTED\n1. CRITICAL src/notes.ts:9 — sem checar o dono\n   verify: `node --test test/notes.test.mjs`',
    'VERDICT: REJECTED\n1. CRITICAL src/notes.ts:9 — IDOR\n   verify: curl -s localhost:3000/notes/2 -H "x-user: 1"',
  ]) assert.equal(matcher.test(hit), true, hit);
  for (const miss of [
    'VERDICT: REJECTED\n1. CRITICAL src/notes.ts:9 — IDOR\n   verify: `node --test`\n2. LOW src/notes.ts:3 — nome confuso\n   verify: leia a função e compare com o pedido',
    'VERDICT: REJECTED\n1. HIGH src/notes.ts:9 — IDOR, sem verify',
  ]) assert.equal(matcher.test(miss), false, miss);
});

test('the residue scenario credits a review that names the leftover script or the unasked dependency', () => {
  const scenario = loadScenarios().find((s) => s.id === 'critic-residue');
  assert.ok(scenario);
  const matcher = resultMatcher(scenario.expect);
  for (const hit of [
    'VERDICT: APPROVED\n1. MEDIUM repro.mjs:1 — script de reprodução que nada referencia.\n   verify: git status --porcelain',
    'VERDICT: REJECTED\n1. MEDIUM package.json:9 — decimal.js entrou em devDependencies sem o pedido citar.',
  ]) assert.equal(matcher.test(hit), true, hit);
  for (const miss of ['VERDICT: APPROVED. A correção do cupom está certa.', 'VERDICT: APPROVED. Não há resíduo; repro.mjs é parte do pedido.'])
    assert.equal(matcher.test(miss), false, miss);
});

test('dropItem also removes a bold paragraph inside a step, up to the next bold paragraph or entry', () => {
  const text = '3. **Verify.** run tests\n   **Prove the test can fail.** keep\n   this too\n   **Drop me.** gone\n   gone too\n4. **Attack.** next\n';
  const out = dropItem(text, 'Drop me.');
  assert.equal(out, '3. **Verify.** run tests\n   **Prove the test can fail.** keep\n   this too\n4. **Attack.** next\n');
});

test('the probe scenario ablates only its rule from the shipped critic', () => {
  const scenario = loadScenarios().find((s) => s.id === 'critic-probe-can-fail');
  assert.ok(scenario);
  const critic = readFileSync(join(HERE, '..', '..', 'claude', 'agents', 'critic.md'), 'utf8');
  const [path, label] = (scenario.ablate.items ?? [])[0].split('#');
  assert.equal(path, 'agents/critic.md');
  const out = dropItem(critic, label);
  assert.doesNotMatch(out, /Prove your probe can fail|it never closes a claim/);
  assert.match(out, /list it as not executed in `tested:`\.\n4\. \*\*Attack, in this order:\*\*/);
});

test('the probe scenario credits a review only when it finds the unconstructed formatter', () => {
  const scenario = loadScenarios().find((s) => s.id === 'critic-probe-can-fail');
  assert.ok(scenario);
  const matcher = resultMatcher(scenario.expect);
  for (const hit of [
    'VERDICT: REJECTED\n1. HIGH src/prices.mjs:22 — warm() guarda Object.create(PriceFormatter.prototype) em pt-br e build() grava em pt-BR.',
    "VERDICT: REJECTED\n1. HIGH src/prices.mjs:34 — getFormatter('pt-br') devolve um formatter que não foi construído; totalLine lança.",
    "VERDICT: REJECTED\n1. HIGH src/checkout.mjs:9 — TypeError: Cannot read properties of undefined (reading 'format').",
  ]) assert.equal(matcher.test(hit), true, hit);
  for (const miss of [
    'VERDICT: APPROVED. Um formatter por locale, reaproveitado; instanceof PriceFormatter confirmado.',
    'VERDICT: REJECTED\n1. MEDIUM src/prices.mjs:20 — warm() roda duas vezes se boot() for chamado de novo.',
  ]) assert.equal(matcher.test(miss), false, miss);
});

test('the contract-drift scenario credits a review only when it flags unknown codes no longer failing', () => {
  const scenario = loadScenarios().find((s) => s.id === 'critic-contract-drift');
  assert.ok(scenario);
  const matcher = resultMatcher(scenario.expect);
  for (const miss of [
    'VERDICT: APPROVED. O cupom vazio agora funciona.',
    'VERDICT: REJECTED\n1. HIGH src/coupons.mjs:7 — falta teste para o cupom vazio.',
  ]) assert.equal(matcher.test(miss), false, miss);
  for (const hit of [
    'VERDICT: REJECTED\n1. HIGH src/coupons.mjs:8 — um código inválido como XYZ agora dá desconto zero em silêncio.',
    'VERDICT: REJECTED\n1. HIGH src/coupons.mjs:8 — unknown coupon codes no longer throw; the checkout accepts them.',
    'VERDICT: REJECTED\n1. HIGH src/coupons.mjs:7 — CouponError deixou de ser lançado para código desconhecido.',
  ]) assert.equal(matcher.test(hit), true, hit);
});

test('countTestsAdded counts new test cases in test files only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-ab-diff-'));
  try {
    const git = (/** @type {string[]} */ ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { cwd: dir, timeout: 15_000 });
    git('init', '-q');
    writeFileSync(join(dir, 'a.test.mjs'), "test('old', () => {});\n");
    git('add', '-A');
    git('commit', '-qm', 'base');
    writeFileSync(join(dir, 'a.test.mjs'), "test('old', () => {});\ntest('new', () => {});\nit.each([1])('table', () => {});\n");
    writeFileSync(join(dir, 'helper.mjs'), "test('not a test file', () => {});\n");
    assert.equal(countTestsAdded(dir), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('countNetworkCalls sees a test that reaches the network and refuses the call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-ab-net-'));
  try {
    writeFileSync(join(dir, 'calls.test.mjs'), "import { test } from 'node:test';\ntest('real call', async () => { await fetch('https://api.example.invalid/v1').catch(() => {}); });\n");
    assert.equal(await countNetworkCalls('node --test', dir, join(dir, 'net.log')), 1);
    rmSync(join(dir, 'calls.test.mjs'));
    writeFileSync(join(dir, 'pure.test.mjs'), "import { test } from 'node:test';\ntest('pure', () => {});\n");
    assert.equal(await countNetworkCalls('node --test', dir, join(dir, 'net.log')), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('decide applies the targets per level and fails a target with no data', () => {
  const s = (/** @type {Partial<ReturnType<typeof summarizeTask>>} */ v) => ({ ...summarizeTask([]), runs: 3, errors: 0, ...v });
  const rows = decide([
    { task: /** @type {any} test double: only level is read */ ({ level: 'normal' }), base: s({ durationMs: 100, costUsd: 1, stops: 4, testsAdded: 3, escapedRate: 0 }), current: s({ durationMs: 70, costUsd: 0.7, stops: 1, testsAdded: 1, escapedRate: 0 }) },
    { task: /** @type {any} test double: only level is read */ ({ level: 'critical' }), base: s({ durationMs: 100, costUsd: 1, stops: 2, testsAdded: 2, escapedRate: 0 }), current: s({ durationMs: 80, costUsd: 0.8, stops: 1, testsAdded: 2, escapedRate: 1 / 3 }) },
    { task: /** @type {any} test double: only level is read */ ({ level: 'llm' }), base: s({ durationMs: 100, costUsd: 1, stops: 2, testsAdded: 6, escapedRate: 0, networkCalls: 2 }), current: s({ durationMs: 60, costUsd: 0.6, stops: 0, testsAdded: 2, escapedRate: 0, networkCalls: 0 }) },
  ]);
  const ok = Object.fromEntries(rows.map((r) => [r.target.split(':')[0], r.ok]));
  assert.equal(ok['tempo de parede'], true);
  assert.equal(ok['paradas'], true);
  assert.equal(ok['testes nas tarefas com LLM'], true);
  assert.equal(ok['chamadas de rede dos testes nas tarefas com LLM'], true);
  assert.equal(ok['defeitos escapados no crítico'], false, 'one escaped critical defect fails the rule');
  assert.equal(ok['defeitos escapados no trivial e no normal'], true);
  assert.equal(decide([]).every((r) => !r.ok), true, 'no data never passes a target');
});

test('the A/B pipeline runs a task against this checkout and against a git ref', { skip: hasBash ? false : `bash não encontrado em ${bash}` }, async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'smugan-ab-test-'));
  const baseRoot = checkoutBaseline('HEAD', join(workDir, 'baseline'));
  try {
    const task = loadTasks().find((t) => t.id === 'trivial-copy');
    assert.ok(task);
    const args = { claude: join(HERE, 'fake-claude-task.mjs'), 'budget-usd': '1', 'timeout-min': '2' };
    for (const [arm, root] of /** @type {const} */ ([['current', join(HERE, '..', '..')], ['base', baseRoot]])) {
      const m = await runTask(task, arm, 1, workDir, args, root);
      assert.equal(m.error, null, arm);
      assert.deepEqual({ stops: m.stops, testsAdded: m.testsAdded, escaped: m.escaped, durationMs: m.durationMs }, { stops: 2, testsAdded: 1, escaped: false, durationMs: 4200 }, arm);
      const paths = JSON.parse(readFileSync(join(workDir, task.id, `${arm}-1`, 'config', 'hooks', 'smugan.paths.json'), 'utf8'));
      assert.equal(resolve(paths.gateDir), resolve(root, 'packages', 'gate'), `${arm} installs its own checkout`);
    }
  } finally {
    removeBaseline(baseRoot);
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
