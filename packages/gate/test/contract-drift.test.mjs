// @ts-check
// Contract drift: a function that existed when the turn started and now
// answers bad input or a failure with a quiet default. New functions, shapes
// that were already there and UI components (for the catch item) never count.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driftCounts, driftFindings, introducedDrift } from '../src/contract-drift.mjs';
import { runHook } from '../src/hook.mjs';

const BEFORE = `export function couponPercent(code) {
  const percent = COUPONS[code.trim().toUpperCase()];
  if (percent === undefined) throw new CouponError('cupom inválido');
  return percent;
}

export async function loadOrders(userId, opts) {
  const res = await fetch('/orders/' + userId, { signal: AbortSignal.timeout(5000) });
  return res.json();
}
`;

/** @param {string} after */
const introduced = (after, rel = 'src/coupons.mjs') => introducedDrift(rel, after, ['couponPercent', 'loadOrders'], driftCounts(driftFindings(rel, BEFORE)));

test('a catch that answers a failure with a default in an existing function is drift', () => {
  const after = BEFORE.replace("  const res = await fetch('/orders/' + userId, { signal: AbortSignal.timeout(5000) });\n  return res.json();",
    "  try {\n    const res = await fetch('/orders/' + userId, { signal: AbortSignal.timeout(5000) });\n    return res.json();\n  } catch (error) {\n    console.error('orders', error);\n    return [];\n  }");
  const found = introduced(after);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /^loadOrders\(\): new catch answers the failure with `return \[\];`/);
  assert.equal(found[0].line, 11);
});

test('a fallback on a parameter or a response field in an existing function is drift', () => {
  const after = BEFORE
    .replace('  const percent = COUPONS[code.trim().toUpperCase()];', "  const percent = COUPONS[(code ?? '').trim().toUpperCase()];")
    .replace('  return res.json();', '  const data = await res.json();\n  return data.orders || [];');
  assert.deepEqual(introduced(after).map((d) => d.message.split(' — ')[0]), [
    "couponPercent(): new fallback `code ?? ''`",
    'loadOrders(): new fallback `data.orders || []`',
  ]);
});

test('a new guard that returns null, [] or undefined in an existing function is drift', () => {
  const after = BEFORE.replace('export function couponPercent(code) {\n', 'export function couponPercent(code) {\n  if (!code) return null;\n');
  const found = introduced(after);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /new guard `if \(!code\) return null;` — .* quietly yields null/);
});

test('a rethrow, a typed error result, a new function and a shape already there are not drift', () => {
  const after = BEFORE.replace('  return res.json();', "  try {\n    return await res.json();\n  } catch (error) {\n    throw new Error('orders: invalid JSON', { cause: error });\n  }")
    + "\nexport function fresh(input) {\n  if (!input) return null;\n  return input.value ?? 0;\n}\n";
  assert.deepEqual(introduced(after), []);
  const already = BEFORE.replace('  return percent;', '  if (!code) return null;\n  return percent;');
  assert.deepEqual(introducedDrift('src/coupons.mjs', already, ['couponPercent'], driftCounts(driftFindings('src/coupons.mjs', already))), []);
});

test('an optional list walked as empty, or an optional object spread as empty, is not drift', () => {
  const after = BEFORE.replace('  return res.json();', [
    '  for (const tag of opts.tags ?? []) url.searchParams.append("tag", tag);',
    '  const kept = (opts.ids ?? []).filter(Boolean);',
    '  const headers = { ...(opts.headers ?? {}) };',
    '  return [...(opts.extra ?? []), kept, headers, res.json()];',
  ].join('\n'));
  assert.deepEqual(introduced(after), []);
  const still = BEFORE.replace('  return res.json();', '  const rows = opts.rows ?? [];\n  return rows;');
  assert.deepEqual(introduced(still).map((d) => d.message.split(' — ')[0]), ['loadOrders(): new fallback `opts.rows ?? []`'], 'a default the caller then receives still counts');
});

test('a guard inside a callback belongs to the callback, and a component may render a fallback', () => {
  const callback = BEFORE.replace('  return percent;', '  return [percent].filter((p) => { if (!p) return; return p > 0; })[0];');
  assert.deepEqual(introduced(callback), []);
  const ui = "export function Orders({ userId }) {\n  try {\n    return render(userId);\n  } catch {\n    return null;\n  }\n}\n";
  assert.deepEqual(introducedDrift('src/components/Orders.tsx', ui, ['Orders'], []).filter((d) => d.key.startsWith('catch')), []);
});

/** @type {string[]} */
const cleanup = [];
after(() => { for (const p of cleanup) rmSync(p, { recursive: true, force: true }); });

test('the Stop lists drift a turn introduced into an existing function once, and honors smugan-ignore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-drift-'));
  cleanup.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"name":"shop","private":true}');
  mkdirSync(join(dir, 'src'));
  const file = join(dir, 'src', 'coupons.mjs');
  writeFileSync(file, BEFORE);
  const id = `smugandrifttest${process.pid}`;
  cleanup.push(...['smugan-turn-', 'smugan-session-', 'smugan-events-', 'smugan-report-', 'smugan-stopdebt-'].map((p) => join(tmpdir(), p + id + '.json')));
  const edit = { old_string: 'export function couponPercent(code) {\n', new_string: 'export function couponPercent(code) {\n  if (!code) return null;\n' };
  const pre = await runHook('pre', { tool_name: 'Edit', session_id: id, tool_input: { file_path: file, ...edit } });
  assert.equal(pre.exitCode, 0, 'drift never blocks the edit itself');
  writeFileSync(file, BEFORE.replace(edit.old_string, edit.new_string));
  await runHook('post', { tool_name: 'Edit', session_id: id, tool_input: { file_path: file } });
  const held = await runHook('stop', { session_id: id });
  assert.equal(held.exitCode, 2);
  assert.match(held.stderr, /src\/coupons\.mjs:2 {2}\[contract-drift\] {2}couponPercent\(\): new guard/);
  assert.match(held.stderr, /listed once/);
  const next = await runHook('stop', { session_id: id });
  assert.equal(next.exitCode, 0, 'listed once');

  const id2 = id + 'b';
  cleanup.push(...['smugan-turn-', 'smugan-session-', 'smugan-events-', 'smugan-report-', 'smugan-stopdebt-'].map((p) => join(tmpdir(), p + id2 + '.json')));
  writeFileSync(file, BEFORE);
  const ignored = { old_string: edit.old_string, new_string: 'export function couponPercent(code) {\n  // smugan-ignore contract-drift: blank coupon field means no coupon\n  if (!code) return null;\n' };
  await runHook('pre', { tool_name: 'Edit', session_id: id2, tool_input: { file_path: file, ...ignored } });
  writeFileSync(file, BEFORE.replace(ignored.old_string, ignored.new_string));
  await runHook('post', { tool_name: 'Edit', session_id: id2, tool_input: { file_path: file } });
  const passed = await runHook('stop', { session_id: id2 });
  assert.equal(passed.exitCode, 0, passed.stderr);
});

test('a component file is never drift: defaults and null renders are how it shows absent props', () => {
  const ui = "export function Banner({ message, title }) {\n  if (!message) return null;\n  return title ?? 'Sem título';\n}\n";
  assert.deepEqual(introducedDrift('components/banner.tsx', ui, ['Banner'], []), []);
  assert.deepEqual(introducedDrift('src/ui/banner.ts', ui, ['Banner'], []), []);
});

test('an early return that hands back a value is not a guard that yields undefined', () => {
  for (const guard of ['  if (cache.has(code)) return cache.get(code);', "  if (code === 'FRETE') return 0;", '  if (cache.has(code)) return cache.get(code)']) {
    const after = BEFORE.replace('export function couponPercent(code) {\n', `export function couponPercent(code) {\n${guard}\n`);
    assert.deepEqual(introduced(after), [], guard);
  }
  for (const guard of ['  if (!code) return;', '  if (!code) return', '  if (!code) { return }']) {
    const after = BEFORE.replace('export function couponPercent(code) {\n', `export function couponPercent(code) {\n${guard}\n`);
    assert.equal(introduced(after).length, 1, guard);
  }
});

test('a bare return in a function that returns nothing is not drift, whatever its callbacks return', () => {
  const before = 'export function drain(queue, users) {\n  users.filter((user) => {\n    return user.active;\n  });\n  queue.flush();\n}\n';
  const after = before.replace('  users.filter', '  if (queue.closed) return;\n  users.filter');
  assert.deepEqual(introducedDrift('src/queue.mjs', after, ['drain'], driftCounts(driftFindings('src/queue.mjs', before))), []);
});

test('drift is still found after code that used to derail the reading of the file', () => {
  // A quote inside a regex inside a template expression blanked everything after it.
  const csv = 'export function toCsvCell(value) {\n  return `"${String(value).replace(/"/g, \'""\')}"`;\n}\n\n';
  const caught = (csv + BEFORE).replace('  return res.json();', "  try {\n    return await res.json();\n  } catch (error) {\n    console.error('orders', error);\n    return [];\n  }");
  const found = introducedDrift('src/coupons.mjs', caught, ['toCsvCell', 'couponPercent', 'loadOrders'], driftCounts(driftFindings('src/coupons.mjs', csv + BEFORE)));
  assert.deepEqual(found.map((d) => d.message.split(' — ')[0]), ['loadOrders(): new catch answers the failure with `return [];`']);

  // An object type as the return type was taken for the body.
  const typed = 'export function parsePrice(input: string): { ok: boolean; cents: number } {\n  const cents = Math.round(Number(input) * 100);\n  return { ok: Number.isFinite(cents), cents };\n}\n';
  const guarded = typed.replace('  const cents', '  if (!input) return null;\n  const cents');
  assert.equal(introducedDrift('src/price.ts', guarded, ['parsePrice'], driftCounts(driftFindings('src/price.ts', typed))).length, 1);

  // A call on its own line inside a condition was taken for a method that owned the block.
  const condition = 'export function couponRate(code, cart) {\n  if (\n    isBlank(code) ||\n    cart.items.length === 0\n  ) {\n    throw new Error("no coupon");\n  }\n  return RATES[code];\n}\n';
  const softened = condition.replace('    throw new Error("no coupon");', '    return cart.defaultRate ?? 0;');
  assert.deepEqual(introducedDrift('src/rate.mjs', softened, ['couponRate'], driftCounts(driftFindings('src/rate.mjs', condition))).map((d) => d.message.split(' — ')[0]), ['couponRate(): new fallback `cart.defaultRate ?? 0`']);
});

test('an empty answer cast to the return type is still a guard that yields it', () => {
  for (const guard of ['  if (!code) return [] as number[];', '  if (!code) return null as unknown as number;', '  if (!code) return null!;', '  if (!code) { return undefined as never; }']) {
    const after = BEFORE.replace('export function couponPercent(code) {\n', `export function couponPercent(code) {\n${guard}\n`);
    assert.equal(introduced(after).length, 1, guard);
  }
});

test('a .catch callback that hands back an object, or a block that only logs, is drift like a catch block', () => {
  const messages = (/** @type {string} */ replacement) => introduced(BEFORE.replace('  return res.json();', replacement)).map((d) => d.message.split(' — ')[0]);
  assert.deepEqual(messages('  return res.json().catch(() => ({}));'), ['loadOrders(): new .catch answers the rejection with `({})`']);
  assert.deepEqual(messages('  return res.json().catch((error) => {\n    console.error(error);\n    return null;\n  });'), ['loadOrders(): new .catch answers the rejection with `return null;`']);
  assert.deepEqual(messages('  return res.json().catch((error) => {\n    console.error(error);\n  });'), ['loadOrders(): new .catch only logs and carries on']);
  assert.deepEqual(messages('  return res.json().catch(() => {});'), ['loadOrders(): new .catch ignores the rejection']);
  assert.deepEqual(messages('  return res.json().catch((_error) => { /* nothing to do */ });'), ['loadOrders(): new .catch ignores the rejection']);
  assert.deepEqual(messages("  return res.json().catch((error) => {\n    throw new Error('orders: invalid JSON', { cause: error });\n  });"), []);
  assert.deepEqual(messages('  return res.json().catch((error) => {\n    return { ok: false, error };\n  });'), [], 'a result that carries the error is an answer the caller can read');
});

test('drift is found in functions and over parameters the finder used to miss', () => {
  /** @param {string} rel @param {string} before @param {string} now @param {string[]} names */
  const drift = (rel, before, now, names) => introducedDrift(rel, now, names, driftCounts(driftFindings(rel, before))).map((d) => d.message.split(' — ')[0]);
  const lambda = 'exports.handler = async (event) => {\n  return run(event.body);\n};\n';
  assert.deepEqual(drift('src/handler.js', lambda, lambda.replace('  return run(event.body);', '  if (!event.body) return null;\n  return run(event.body);'), ['handler']),
    ['handler(): new guard `if (!event.body) return null;`']);
  const controller = "export class Orders {\n  async list(@Query('limit') limit: number) {\n    return this.repo.list(limit);\n  }\n}\n";
  assert.deepEqual(drift('src/orders.controller.ts', controller, controller.replace('list(limit)', 'list(limit ?? 20)'), ['list']), ['list(): new fallback `limit ?? 20`']);
  const wrapped = 'export function total(\n  items,\n  coupon,\n) {\n  return sum(items, coupon);\n}\n';
  assert.deepEqual(drift('src/total.js', wrapped, wrapped.replace('sum(items, coupon)', 'sum(items ?? [], coupon)'), ['total']), ['total(): new fallback `items ?? []`']);
});
