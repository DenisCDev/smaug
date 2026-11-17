// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'money-float';
const M = 'supabase/migrations/0001_orders.sql';

test('money-like column declared as real in create table is flagged', () => {
  const sql = 'create table orders (\n  id uuid primary key,\n  price real not null\n);';
  const v = ofRule(run(M, sql), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
  assert.match(v[0].message, /numeric\(12,2\)/);
});

test('every discouraged type is caught', () => {
  for (const type of ['real', 'float', 'float4', 'float8', 'float(24)', 'double precision', 'money']) {
    const sql = `create table t (total_amount ${type});`;
    assert.equal(ofRule(run(M, sql), R).length, 1, type);
  }
});

test('money-like names are matched as words of the name, case-insensitive', () => {
  const sql = 'create table t (\n  unit_price real,\n  "totalCost" float8,\n  service_fee double precision\n);';
  assert.equal(ofRule(run(M, sql), R).length, 3);
});

test('a name that merely contains the letters of a money word is not money', () => {
  const sql = 'create table reviews (\n  feedback_score real,\n  coffee_count float8,\n  feed_rate double precision,\n  load_balancer_weight real,\n  costume_scale real\n);';
  assert.deepEqual(ofRule(run(M, sql), R), []);
});

test('plural and fused forms of a money word still count', () => {
  const sql = 'create table t (\n  subtotal real,\n  fees float8,\n  "grandTotal" real,\n  net_salaries double precision,\n  unitprice real\n);';
  assert.deepEqual(ofRule(run(M, sql), R).map((v) => v.line), [2, 3, 4, 5, 6]);
});

test('numeric and integer cents pass', () => {
  const sql = 'create table t (price numeric(12,2), amount_cents integer, balance bigint);';
  assert.equal(ofRule(run(M, sql), R).length, 0);
});

test('float columns with non-money names pass', () => {
  const sql = 'create table t (weight real, latitude double precision);';
  assert.equal(ofRule(run(M, sql), R).length, 0);
});

test('add column with a float money column is flagged', () => {
  const sql = 'alter table orders add column if not exists shipping_cost real;\nalter table orders add discount_value float8;';
  assert.equal(ofRule(run(M, sql), R).length, 2);
});

test('add constraint is not mistaken for a column', () => {
  const sql = 'alter table orders add constraint price_positive check (price > 0);';
  assert.equal(ofRule(run(M, sql), R).length, 0);
});

test('table-level constraints inside create table are skipped', () => {
  const sql = 'create table t (\n  price numeric(12,2),\n  check (price > 0),\n  constraint fee_ok check (true)\n);';
  assert.equal(ofRule(run(M, sql), R).length, 0);
});

test('declarations inside comments and strings are ignored', () => {
  const sql = "-- create table t (price real);\ninsert into notes (body) values ('price real');";
  assert.equal(ofRule(run(M, sql), R).length, 0);
});

test('only migration paths are checked', () => {
  const sql = 'create table t (price real);';
  assert.equal(ofRule(run('queries/report.sql', sql), R).length, 0);
  assert.equal(ofRule(run('supabase/tests/001-t.sql', sql), R).length, 0);
});

test('smugan-ignore suppresses with a written reason', () => {
  const sql = '-- smugan-ignore money-float: sensor calibration value, not money\ncreate table t (reading_value real);';
  assert.equal(ofRule(run(M, sql), R).length, 0);
});

test('converting an existing money column to a float is flagged', () => {
  const sql = 'alter table orders alter column price type real;\nalter table orders alter "total_amount" set data type double precision using total_amount::float8;';
  const v = ofRule(run(M, sql), R);
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((x) => x.line), [1, 2]);
});

test('converting a money column to numeric passes', () => {
  assert.equal(ofRule(run(M, 'alter table orders alter column price type numeric(12,2) using price::numeric;'), R).length, 0);
});

test('columns of a quoted schema-qualified table (supabase db diff) are checked', () => {
  const sql = 'create table "public"."orders" (\n    "id" bigint,\n    "price" real\n);';
  const v = ofRule(run(M, sql), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
});
