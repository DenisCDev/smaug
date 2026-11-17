// What `smugan check` reported on popular open-source repositories, at the commit linked,
// after reading each finding and leaving out test fixtures and code marked as intentional.
// The gate messages are verbatim; snippets are trimmed ("..." marks a cut).
export type Catch = { repo: string; rule: string; path: string; line: number; permalink: string; gate: string; snippet: string };

export const catches: Catch[] = [
	{
		repo: 'vercel/commerce',
		rule: 'fetch-timeout',
		path: 'lib/shopify/index.ts',
		line: 85,
		permalink: 'https://github.com/vercel/commerce/blob/f7521d57d29f0eb3d23c1399cf9bb299d61fcd21/lib/shopify/index.ts#L85',
		gate: 'server fetch() has no deadline — pass AbortSignal.timeout(...) or signal: so a hang dies fast; a slow peer is worse than a fast error',
		snippet: 'const result = await fetch(endpoint, {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "X-Shopify-Storefront-Access-Token": key,',
	},
	{
		repo: 'documenso/documenso',
		rule: 'fetch-timeout',
		path: 'packages/lib/server-only/captcha/verify-captcha.ts',
		line: 59,
		permalink: 'https://github.com/documenso/documenso/blob/209d454491eb30f1b91e01ae6a48316a81716257/packages/lib/server-only/captcha/verify-captcha.ts#L59',
		gate: 'server fetch() has no deadline — pass AbortSignal.timeout(...) or signal: so a hang dies fast; a slow peer is worse than a fast error',
		snippet: "try {\n  response = await fetch(TURNSTILE_VERIFY_URL, {\n    method: 'POST',\n    headers: {\n      'Content-Type': 'application/x-www-form-urlencoded',",
	},
	{
		repo: 'documenso/documenso',
		rule: 'empty-catch',
		path: 'packages/lib/server-only/team/delete-team-email.ts',
		line: 99,
		permalink: 'https://github.com/documenso/documenso/blob/209d454491eb30f1b91e01ae6a48316a81716257/packages/lib/server-only/team/delete-team-email.ts#L99',
		gate: 'empty catch swallows the error — handle it, rethrow, or log with context; never fail silently',
		snippet: "} catch (e) {\n  // Todo: Teams - Alert us.\n  // We don't want to prevent a user from revoking access because an email could not be sent.\n}",
	},
	{
		repo: 'vercel/ai-chatbot',
		rule: 'test-weakening',
		path: 'tests/e2e/chat.test.ts',
		line: 27,
		permalink: 'https://github.com/vercel/ai-chatbot/blob/a8989b522fa3672a2ae52f053105e40993b36ca1/tests/e2e/chat.test.ts#L27',
		gate: 'test body has no assertion (no expect/assert) — a test that asserts nothing proves nothing; assert real behavior, or suppress if the assertions live in an imported helper',
		snippet: 'test("can stop generation with stop button", async ({ page }) => {\n  ...\n  await stopButton.click({ timeout: 5000 }).catch(() => {\n    // Generation may have finished before we could click\n  });',
	},
];
