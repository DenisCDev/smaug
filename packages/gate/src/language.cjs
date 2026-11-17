// @ts-check
'use strict';
// Language choices made at install time. Both start off: with no UI language no
// rule dictates the language of a project's strings, and with no reply language
// the agent answers in the language the user writes in. CommonJS so install.sh,
// which runs as a CommonJS script, and the ESM installers share one copy.

/** @typedef {{ ui: string | null, reply: string | null }} Language */

const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** @param {string} name @param {string | undefined} value @param {unknown} previous @returns {string | null} */
function pick(name, value, previous) {
  if (value === undefined || value.trim() === '') return typeof previous === 'string' && TAG.test(previous) ? previous : null;
  const tag = value.trim();
  if (tag.toLowerCase() === 'off') return null;
  if (!TAG.test(tag)) throw new Error(`${name} must be a language code (pt-BR, en, es…) or "off"`);
  return tag;
}

/**
 * The environment wins; otherwise the previous install's choice is kept, so a
 * plain reinstall never switches a language back off.
 * @param {Record<string, string | undefined>} env
 * @param {{ uiLanguage?: unknown, replyLanguage?: unknown } | null} [previous]
 * @returns {Language}
 */
function resolveLanguage(env, previous) {
  return {
    ui: pick('SMUGAN_UI_LANG', env.SMUGAN_UI_LANG, previous?.uiLanguage),
    reply: pick('SMUGAN_REPLY_LANG', env.SMUGAN_REPLY_LANG, previous?.replyLanguage),
  };
}

/** @param {string | null | undefined} tag */
const isPortuguese = (tag) => !!tag && /^pt(?:-|$)/i.test(tag);

/**
 * A line carrying a language token is dropped when that language is off;
 * otherwise the token becomes the configured tag.
 * @param {string} text @param {Language} lang
 */
function applyLanguage(text, lang) {
  return text
    .split('\n')
    .filter((line) => !(line.includes('{{UI_LANGUAGE}}') && !lang.ui) && !(line.includes('{{REPLY_LANGUAGE}}') && !lang.reply))
    .join('\n')
    .split('{{UI_LANGUAGE}}').join(lang.ui ?? '')
    .split('{{REPLY_LANGUAGE}}').join(lang.reply ?? '')
    .split('{{NOT_DONE}}').join(isPortuguese(lang.reply) ? 'NÃO FEITO' : 'NOT DONE');
}

/** Rules written for one UI language ship only when that language is chosen. */
const LANGUAGE_RULES = new Set(['ui-ptbr.md']);

/** @param {string} file @param {Language} lang */
function ruleWanted(file, lang) {
  return !LANGUAGE_RULES.has(file) || isPortuguese(lang.ui);
}

module.exports = { resolveLanguage, applyLanguage, ruleWanted, isPortuguese, LANGUAGE_RULES };
