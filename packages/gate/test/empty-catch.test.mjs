// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'empty-catch';

test('empty catch block is flagged, with and without a binding', () => {
  assert.equal(ofRule(run('src/a.ts', 'try { save(); } catch {}'), R).length, 1);
  assert.equal(ofRule(run('src/a.ts', 'try { save(); } catch (e) {}'), R).length, 1);
  assert.equal(ofRule(run('src/a.ts', 'try { save(); } catch (error: unknown) {\n}'), R).length, 1);
});

test('catch containing only comments is flagged', () => {
  const code = 'try { save(); } catch (e) {\n  // nothing to do\n  /* really */\n}';
  const v = ofRule(run('src/a.ts', code), R);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
});

test('catch with real handling passes', () => {
  for (const code of [
    'try { save(); } catch (e) { throw e; }',
    'try { save(); } catch { return null; }',
    'try { save(); } catch (e) { logger.error(e); }',
  ]) {
    assert.equal(ofRule(run('src/a.ts', code), R).length, 0, code);
  }
});

test('empty .catch() handlers are flagged once each', () => {
  for (const code of [
    'fetch(url).catch(() => {});',
    'fetch(url).catch(e => {});',
    'fetch(url).catch(function () {});',
    'fetch(url).catch(async () => {});',
  ]) {
    assert.equal(ofRule(run('src/a.ts', code), R).length, 1, code);
  }
});

test('.catch() with a real handler passes', () => {
  for (const code of [
    'fetch(url).catch(console.error);',
    'fetch(url).catch((e) => report(e));',
    'fetch(url).catch(function (e) { report(e); });',
  ]) {
    assert.equal(ofRule(run('src/a.ts', code), R).length, 0, code);
  }
});

test('non-empty nested braces are not mistaken for an empty body', () => {
  const code = 'try { save(); } catch (e) { if (retryable(e)) {} else { throw e; } }';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('catch inside strings and comments is ignored', () => {
  const code = "const s = 'catch {}'; // try { x } catch {}";
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('scripts, tests and config files are excluded', () => {
  const code = 'try { x(); } catch {}';
  assert.equal(ofRule(run('scripts/seed.ts', code), R).length, 0);
  assert.equal(ofRule(run('src/a.test.ts', code), R).length, 0);
  assert.equal(ofRule(run('next.config.mjs', code), R).length, 0);
});

test('smugan-ignore on the catch line suppresses with a written reason', () => {
  const code = 'try {\n  unlink(tmp);\n} catch { /* smugan-ignore empty-catch: cleanup is best-effort by design */ }';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});

test('a suppression written with the former name smaug-ignore still applies', () => {
  const code = 'try {\n  unlink(tmp);\n} catch { /* smaug-ignore empty-catch: cleanup is best-effort by design */ }';
  assert.equal(ofRule(run('src/a.ts', code), R).length, 0);
});
