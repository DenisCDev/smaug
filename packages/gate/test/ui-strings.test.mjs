// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'ui-strings';

// The check only runs for a pt UI language; the launcher exports the install's choice.
process.env.SMUGAN_UI_LANG = 'pt-BR';

test('with no pt UI language chosen the check stays off unless the project turns it on', () => {
  const page = 'export default function P() { return <button>Save</button>; }';
  process.env.SMUGAN_UI_LANG = 'en';
  try {
    assert.equal(ofRule(run('src/app/page.tsx', page), R).length, 0);
    assert.equal(ofRule(run('src/app/page.tsx', page, { [R]: true }), R).length, 1);
  } finally {
    process.env.SMUGAN_UI_LANG = 'pt-BR';
  }
});

test('English word in JSX text is flagged', () => {
  const v = ofRule(run('src/app/page.tsx', 'export default function P() { return <button>Save</button>; }'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /"Save"/);
});

test('pt-BR JSX text passes', () => {
  const v = ofRule(run('src/app/page.tsx', 'export default function P() { return <button>Salvar</button>; }'), R);
  assert.equal(v.length, 0);
});

test('English placeholder attribute is flagged', () => {
  const jsx = '<input placeholder="Enter your password" />';
  const v = ofRule(run('src/f.tsx', jsx), R);
  assert.equal(v.length, 1);
});

test('missing accents in JSX text are flagged with the fix', () => {
  const jsx = '<p>Configuracao invalida</p>';
  const v = ofRule(run('src/f.tsx', jsx), R);
  assert.equal(v.length, 2);
  assert.match(v[0].message, /configuração/);
});

test('missing accent in a prose string literal is flagged', () => {
  const code = "const msg = 'Sessao expirada, tente novamente';";
  const v = ofRule(run('src/f.tsx', code), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /sessão/);
});

test('single-word literals are not scanned (enum/status values)', () => {
  const code = "const status = 'concluido';";
  assert.equal(ofRule(run('src/f.tsx', code), R).length, 0);
});

test('className and other code attributes are not scanned', () => {
  const jsx = '<div className="botao cartao-header">Olá</div>';
  assert.equal(ofRule(run('src/f.tsx', jsx), R).length, 0);
});

test('path-like strings are not scanned', () => {
  const code = "import x from './usuario-utils';";
  assert.equal(ofRule(run('src/f.tsx', code), R).length, 0);
});

test('urls in JSX are not flagged', () => {
  const jsx = '<a>https://example.com/save</a>';
  assert.equal(ofRule(run('src/f.tsx', jsx), R).length, 0);
});

test('only applies to .tsx/.jsx', () => {
  assert.equal(ofRule(run('src/f.ts', "const t = 'Save changes';"), R).length, 0);
});

test('sub-checks can be disabled independently', () => {
  const jsx = '<p>Save</p>';
  assert.equal(ofRule(run('src/f.tsx', jsx, { 'ui-strings': { english: false } }), R).length, 0);
});

// Regression (watson, jul/2026): a span between two generics captured a type
// signature as "JSX text" and flagged "hide" inside it — 20 immortal findings
// on a file whose diff was 12 lines.
test('type annotations between generics are not UI text', () => {
  const code = 'function bind(cb: Handler<Item>, hide?: boolean): Promise<void> { return run(cb, hide); }\n';
  assert.equal(ofRule(run('src/chat-screen.tsx', code), R).length, 0);
});

test('arrow-function bodies after => are not UI text', () => {
  const code = 'const order = (a: number, hide: number) => a - hide < 0 ? first : second;\n';
  assert.equal(ofRule(run('src/sort.tsx', code), R).length, 0);
});

test('real JSX text with a flagged English word still blocks', () => {
  const v = ofRule(run('src/app/page.tsx', '<button>Hide</button>'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /"Hide"/);
});

test('non-optional params between generics are not UI text either', () => {
  const code = 'function bind(cb: Handler<Item>, hide: boolean): Promise<void> { return run(cb, hide); }\n';
  assert.equal(ofRule(run('src/chat-screen.tsx', code), R).length, 0);
});
