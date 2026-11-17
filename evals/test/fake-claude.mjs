// Stands in for `claude -p` in the pipeline test. It follows the naming rule
// only when the installed CLAUDE.md still carries the Language section, and
// reports the hook block the way stream-json does, so the test proves the
// ablation reaches the session and the measure reads the block.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const claudeMd = readFileSync(join(process.env.CLAUDE_CONFIG_DIR ?? '', 'CLAUDE.md'), 'utf8');
const ruleLoaded = /^## Language\r?$/m.test(claudeMd);
const column = ruleLoaded ? 'full_name' : 'nome_completo';
const dir = join(process.cwd(), 'supabase', 'migrations');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, '0001_clients.sql'), `create table clients (\n  id uuid primary key,\n  ${column} text\n);\nalter table clients enable row level security;\n`);

const events = [{ type: 'system', subtype: 'init' }];
if (!ruleLoaded) {
  events.push({
    type: 'system', subtype: 'hook_response', hook_event: 'PreToolUse', exit_code: 2,
    stderr: 'smugan gate: blocked — this Write would introduce 1 violation in supabase/migrations/0001_clients.sql:\n  line 3  [db-naming]  Portuguese identifier "nome_completo"\n',
  });
}
events.push({ type: 'system', subtype: 'hook_response', hook_event: 'Stop', exit_code: 2, stderr: 'some other hook: blocked [db-naming]' });
events.push({ type: 'result', subtype: 'success', result: 'Criei a migration.', total_cost_usd: 0.01 });
process.stdout.write(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
