// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractFile, contractRoot, validateContract } from '../src/contract.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'smugan.mjs');
const VALID = {
  request: 'deixa o usuário abrir uma das próprias notas pelo id',
  criteria: [
    { behavior: 'o dono vê a nota pelo id', verify: 'npm test -- notes' },
    { behavior: 'outro usuário recebe 404, não a nota', verify: 'teste notes.test.ts "outro usuário"' },
    { behavior: 'id inexistente recebe 404', verify: 'teste notes.test.ts "id inexistente"' },
  ],
  outOfScope: ['edição de notas'],
  decisions: [{ decision: '404 em vez de 403', reason: 'não revela que a nota existe' }],
};

/** @param {(dir: string, run: (...args: string[]) => import('node:child_process').SpawnSyncReturns<string>, cache: string) => void} body */
function withRepo(body) {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-contract-'));
  const cache = mkdtempSync(join(tmpdir(), 'smugan-contract-cache-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const run = (/** @type {string[]} */ ...args) => spawnSync(process.execPath, [BIN, 'contract', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, SMUGAN_CACHE_DIR: cache },
  });
  try {
    body(dir, run, cache);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
}

test('validateContract accepts the documented shape and starts every criterion pending', () => {
  const result = validateContract(VALID);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.criteria.map((c) => c.status), ['pending', 'pending', 'pending']);
});

test('validateContract rejects what the reviewers could not use', () => {
  const cases = [
    [{ ...VALID, request: '' }, /request/],
    [{ ...VALID, criteria: [] }, /3 to 6/],
    [{ ...VALID, criteria: VALID.criteria.slice(0, 2) }, /3 to 6/],
    [{ ...VALID, criteria: Array.from({ length: 7 }, () => VALID.criteria[0]) }, /3 to 6/],
    [{ ...VALID, criteria: [...VALID.criteria.slice(0, 2), { behavior: 'funciona' }] }, /verify/],
    [{ ...VALID, criteria: [...VALID.criteria.slice(0, 2), { ...VALID.criteria[0], status: 'done' }] }, /unknown field status/],
    [{ ...VALID, extra: true }, /unknown field: extra/],
    [{ ...VALID, decisions: [{ decision: 'x' }] }, /decisions/],
  ];
  for (const [input, message] of cases) {
    const result = validateContract(input);
    assert.equal(result.ok, false, String(message));
    if (!result.ok) assert.match(result.errors.join('\n'), /** @type {RegExp} */ (message));
  }
});

test('the CLI stores, shows, marks and clears the contract of the checkout', () => {
  withRepo((dir, run) => {
    assert.equal(run().status, 1, 'no contract yet');
    writeFileSync(join(dir, 'c.json'), JSON.stringify(VALID));
    const set = run('--set', 'c.json');
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /1\. \[pending\] o dono vê a nota pelo id/);
    const marked = run('--mark', '1', 'done', '--evidence', 'npm test -- notes → 3 passed');
    assert.equal(marked.status, 0, marked.stderr);
    assert.match(marked.stdout, /1\. \[done\][\s\S]*evidence: npm test -- notes → 3 passed/);
    const json = JSON.parse(run('--json').stdout);
    assert.equal(json.criteria[0].status, 'done');
    assert.equal(json.request, VALID.request);
    assert.equal(run('--mark', '9', 'done', '--evidence', 'x').status, 2, 'a criterion that does not exist');
    assert.equal(run('--mark', 'abc', 'done', '--evidence', 'x').status, 2, 'a criterion number that is not a number');
    assert.equal(run('--mark', '1', 'finished', '--evidence', 'x').status, 2, 'an unknown status');
    assert.equal(run('--evidence', 'x').status, 2, 'evidence without --mark');
    assert.equal(run('--set', 'c.json', '--clear').status, 2, 'two actions at once');
    const bareSet = run('--set');
    assert.equal(bareSet.status, 2, '--set without a file is a usage error, not "show"');
    assert.equal(bareSet.stdout, '');
    assert.equal(run('--mark', '1', 'done', '--evidence').status, 2, '--evidence without a value');
    assert.match(run('--clear').stdout, /removed the contract created .*1 of 3 criteria done/);
    assert.equal(run().status, 1);
  });
});

test('done and blocked need evidence; pending clears it', () => {
  withRepo((dir, run) => {
    writeFileSync(join(dir, 'c.json'), JSON.stringify(VALID));
    run('--set', 'c.json');
    const bare = run('--mark', '1', 'done');
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /requires --evidence/);
    assert.equal(run('--mark', '2', 'blocked').status, 2);
    run('--mark', '1', 'done', '--evidence', 'npm test → ok');
    assert.equal(run('--mark', '1', 'pending').status, 0);
    assert.equal(JSON.parse(run('--json').stdout).criteria[0].evidence, undefined);
  });
});

test('--set never replaces a contract with progress unless --replace is given', () => {
  withRepo((dir, run) => {
    writeFileSync(join(dir, 'c.json'), JSON.stringify(VALID));
    run('--set', 'c.json');
    run('--mark', '1', 'done', '--evidence', 'npm test → ok');
    const refused = run('--set', 'c.json');
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /there is already a contract created .*1 of 3 criteria done.*--replace/);
    assert.equal(JSON.parse(run('--json').stdout).criteria[0].status, 'done', 'the progress survived');
    const replaced = run('--set', 'c.json', '--replace');
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.match(replaced.stdout, /replaced the contract created .*1 of 3/);
    assert.equal(JSON.parse(run('--json').stdout).criteria[0].status, 'pending');
    assert.equal(run('--replace').status, 2, '--replace only goes with --set');
  });
});

test('--mark on a checkout that never had a contract says how to create one', () => {
  withRepo((_dir, run) => {
    const result = run('--mark', '1', 'done', '--evidence', 'x');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no contract for this checkout; create one with --set/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  });
});

test('an unreadable contract names its file and can still be replaced or removed', () => {
  withRepo((dir, run, cache) => {
    writeFileSync(join(dir, 'c.json'), JSON.stringify(VALID));
    const corrupt = () => {
      if (run().status === 1) run('--set', 'c.json');
      const [name] = readdirSync(join(cache, 'contracts')).filter((f) => f.endsWith('.json'));
      writeFileSync(join(cache, 'contracts', name), '{"request": "trunc');
    };
    corrupt();
    const shown = run();
    assert.equal(shown.status, 2);
    assert.match(shown.stderr, /is unreadable .*--set <contract\.json> --replace or remove it with --clear; file: .*contracts/);
    assert.equal(run('--set', 'c.json').status, 2, 'without --replace a broken contract is still not overwritten');
    const replaced = run('--set', 'c.json', '--replace');
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.match(replaced.stdout, /replaced the unreadable contract/);
    assert.equal(JSON.parse(run('--json').stdout).criteria.length, 3);
    corrupt();
    const cleared = run('--clear');
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.match(cleared.stdout, /removed the unreadable contract/);
    assert.equal(run().status, 1);
  });
});

test('a rejected contract changes nothing and names every problem', () => {
  withRepo((dir, run) => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ request: 'x', criteria: [{ behavior: 'y' }] }));
    const result = run('--set', 'bad.json');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /contract rejected[\s\S]*verify/);
    assert.equal(run().status, 1);
  });
});

test('each checkout keeps its own contract, also from a subfolder', () => {
  const cache = mkdtempSync(join(tmpdir(), 'smugan-contract-cache-'));
  const a = mkdtempSync(join(tmpdir(), 'smugan-contract-a-'));
  const b = mkdtempSync(join(tmpdir(), 'smugan-contract-b-'));
  const previous = process.env.SMUGAN_CACHE_DIR;
  process.env.SMUGAN_CACHE_DIR = cache;
  try {
    for (const dir of [a, b]) spawnSync('git', ['init', '-q'], { cwd: dir });
    assert.notEqual(contractFile(contractRoot(a)), contractFile(contractRoot(b)));
    const sub = join(a, 'src');
    mkdirSync(sub);
    assert.equal(contractFile(contractRoot(sub)), contractFile(contractRoot(a)));
    assert.equal(existsSync(join(a, '.smugan.local')), false, 'nothing is written inside the checkout');
  } finally {
    if (previous === undefined) delete process.env.SMUGAN_CACHE_DIR;
    else process.env.SMUGAN_CACHE_DIR = previous;
    for (const dir of [cache, a, b]) rmSync(dir, { recursive: true, force: true });
  }
});
