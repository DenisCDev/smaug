// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLanguage, resolveLanguage, ruleWanted } from '../src/language.cjs';

const TEXT = 'a\n- strings: {{UI_LANGUAGE}}.\n- prose in {{REPLY_LANGUAGE}}.\n**{{NOT_DONE}}**\nb';

test('both languages start off: their lines disappear and the rule for pt-BR UIs is not shipped', () => {
  const lang = resolveLanguage({}, null);
  assert.deepEqual(lang, { ui: null, reply: null });
  assert.equal(applyLanguage(TEXT, lang), 'a\n**NOT DONE**\nb');
  assert.equal(ruleWanted('ui-ptbr.md', lang), false);
  assert.equal(ruleWanted('nextjs.md', lang), true);
});

test('any language tag can be chosen, and pt-BR brings its rule and the Portuguese block title', () => {
  assert.equal(applyLanguage(TEXT, resolveLanguage({ SMUGAN_UI_LANG: 'es', SMUGAN_REPLY_LANG: 'en' })), 'a\n- strings: es.\n- prose in en.\n**NOT DONE**\nb');
  const pt = resolveLanguage({ SMUGAN_UI_LANG: 'pt-BR', SMUGAN_REPLY_LANG: 'pt-BR' });
  assert.equal(applyLanguage(TEXT, pt), 'a\n- strings: pt-BR.\n- prose in pt-BR.\n**NÃO FEITO**\nb');
  assert.equal(ruleWanted('ui-ptbr.md', pt), true);
});

test('a reinstall keeps the previous choice, "off" turns it off, and a bad value fails loud', () => {
  const previous = { uiLanguage: 'pt-BR', replyLanguage: 'pt-BR' };
  assert.deepEqual(resolveLanguage({}, previous), { ui: 'pt-BR', reply: 'pt-BR' });
  assert.deepEqual(resolveLanguage({ SMUGAN_UI_LANG: 'off' }, previous), { ui: null, reply: 'pt-BR' });
  assert.throws(() => resolveLanguage({ SMUGAN_UI_LANG: 'português' }, null), /must be a language code/);
});
