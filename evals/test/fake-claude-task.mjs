// Stands in for `claude -p` in the A/B pipeline test: it renames the store the
// way the trivial task asks, adds one test, and reports a Stop hold and a
// question the way stream-json does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'src', 'index.ts');
writeFileSync(file, readFileSync(file, 'utf8').replace("'Loja'", "'Loja do Bairro'"));
mkdirSync(join(process.cwd(), 'test'), { recursive: true });
writeFileSync(join(process.cwd(), 'test', 'name.test.mjs'), "import { test } from 'node:test';\ntest('name', () => {});\n");

const events = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] } },
  { type: 'system', subtype: 'hook_response', hook_event: 'Stop', exit_code: 2, stderr: 'smugan stop: this turn modified code but the Definition of Done fails (1 issue)' },
  { type: 'result', subtype: 'success', result: 'Troquei o nome.', duration_ms: 4200, total_cost_usd: 0.02 },
];
process.stdout.write(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
