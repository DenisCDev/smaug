// Inputs and what `smugan check` printed for each, verbatim (engine 0.21.0).
export type Sample = { id: string; file: string; before: string; after: string; beforeOut: string; afterOut: string };

export const samples: Sample[] = [
	{
		id: 'migration',
		file: 'supabase/migrations/0007_create_clientes.sql',
		before: `create table clientes (
  id uuid primary key,
  nome_completo text
);`,
		after: `create table clients (
  id uuid primary key,
  user_id uuid not null,
  full_name text
);
alter table clients enable row level security;
create policy clients_owner_select on clients
  for select to authenticated using ((select auth.uid()) = user_id);`,
		beforeOut: "supabase/migrations/0007_create_clientes.sql:1  [db-naming]  Portuguese identifier \"clientes\" (\"clientes\") — use English snake_case\nsupabase/migrations/0007_create_clientes.sql:1  [rls]  table \"clientes\" created without RLS — add \"alter table clientes enable row level security;\" plus per-operation policies in this migration\nsupabase/migrations/0007_create_clientes.sql:1  [rls-tests]  table \"clientes\" has no pgTAP RLS test in supabase/tests/ — instantiate table-rls.test.sql.template (anon denied, owner sees own rows, other user sees zero) and run \"supabase test db\"\nsupabase/migrations/0007_create_clientes.sql:1  [security-notes]  project has no SECURITY_NOTES.md — create it and describe table \"clientes\" in one plain-language line: who can read, who can write (template: smugan init)\nsupabase/migrations/0007_create_clientes.sql:3  [db-naming]  Portuguese identifier \"nome_completo\" (\"nome\") — use English snake_case\n\nsmugan: 5 violations in 1 file checked.\nFalse positive? Suppress with: // smugan-ignore <rule>: <reason (6+ chars)>",
		afterOut: "supabase/migrations/0007_create_clientes.sql:1  [rls-tests]  table \"clients\" has no pgTAP RLS test in supabase/tests/ — instantiate table-rls.test.sql.template (anon denied, owner sees own rows, other user sees zero) and run \"supabase test db\"\nsupabase/migrations/0007_create_clientes.sql:1  [security-notes]  project has no SECURITY_NOTES.md — create it and describe table \"clients\" in one plain-language line: who can read, who can write (template: smugan init)\n\nsmugan: 2 violations in 1 file checked.\nFalse positive? Suppress with: // smugan-ignore <rule>: <reason (6+ chars)>",
	},
	{
		id: 'fetch',
		file: 'src/prices.ts',
		before: `export async function loadPrices(url: string) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {}
}`,
		after: `export async function loadPrices(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(\`prices: HTTP \${res.status}\`);
  return await res.json();
}`,
		beforeOut: "src/prices.ts:3  [fetch-timeout]  server fetch() has no deadline — pass AbortSignal.timeout(...) or signal: so a hang dies fast; a slow peer is worse than a fast error\nsrc/prices.ts:5  [empty-catch]  empty catch swallows the error — handle it, rethrow, or log with context; never fail silently\n\nsmugan: 2 violations in 1 file checked.\nFalse positive? Suppress with: // smugan-ignore <rule>: <reason (6+ chars)>",
		afterOut: "smugan: clean (1 file checked)",
	},
	{
		id: 'test',
		file: 'test/cart.test.ts',
		before: `import { test, expect } from 'vitest';
import { total } from '../src/cart';

test.skip('applies the discount', () => {
  expect(total([10, 20], 0.1)).toBe(27);
});`,
		after: `import { test, expect } from 'vitest';
import { total } from '../src/cart';

test('applies the discount', () => {
  expect(total([10, 20], 0.1)).toBe(27);
});`,
		beforeOut: "test/cart.test.ts:4  [test-weakening]  test.skip disables the test — fix the code or delete the test deliberately; a skipped test hides the regression it was written to catch\n\nsmugan: 1 violation in 1 file checked.\nFalse positive? Suppress with: // smugan-ignore <rule>: <reason (6+ chars)>",
		afterOut: "smugan: clean (1 file checked)",
	},
	{
		id: 'secret',
		file: 'src/pay.ts',
		before:
			'const amount: any = req.body.amount;\n' +
			// An invented key, split so no scanner reads the repository as holding a credential.
			"const key = 'sk_" + "live_51HxQ2eKz8mN3pQ7rT9vW2yA4bC6dE8fG0hJ1kL';",
		after: `const amount = Body.parse(req.body).amount;
const key = env.STRIPE_SECRET_KEY;`,
		beforeOut: "src/pay.ts:1  [no-any]  `any` without justification — fix the type, or add \"// any: <reason>\" if it is truly unavoidable\nsrc/pay.ts:2  [secrets]  Stripe key in code\n\nsmugan: 2 violations in 1 file checked.\nFalse positive? Suppress with: // smugan-ignore <rule>: <reason (6+ chars)>",
		afterOut: "smugan: clean (1 file checked)",
	},
];
