// @ts-check
'use strict';
// Parts a user can turn off (SMUGAN_DISABLE at install time, the plugin's
// disable option, "disable" in a project's config layers): a reviewer, a
// skill or a stack rule. A disabled part is not installed, and no installed
// text tells the agent to use it. The reviewers' wording lives with the cost
// profile (profile.cjs), which already drops flow-critic under minimo.

const { readdirSync } = require('node:fs');
const { join } = require('node:path');

const REVIEWERS = ['critic', 'flow-critic'];
const SKILLS = ['smugan', 'smugan-build', 'smugan-finish'];

/**
 * Every name the list accepts: the reviewers, the skills and the stack rules
 * shipped in this checkout's claude/ folder.
 * @param {string} claudeDir @returns {string[]}
 */
function knownParts(claudeDir) {
  /** @type {string[]} */
  let files = [];
  try {
    files = readdirSync(join(claudeDir, 'rules'));
  } catch (error) {
    // A checkout without rules ships no rule to turn off; the installers
    // report what else is missing.
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  return [...REVIEWERS, ...SKILLS, ...files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))];
}

/**
 * The environment wins; "none" clears; otherwise the previous install's list
 * is kept (minus names this checkout no longer ships). Unknown names throw, so
 * the installer fails before writing anything.
 * @param {string | undefined} value @param {unknown} previous @param {string[]} known
 * @returns {string[]}
 */
function resolveDisable(value, previous, known) {
  const raw = (value ?? '').trim();
  if (!raw) return Array.isArray(previous) ? [...new Set(previous.filter((n) => typeof n === 'string' && known.includes(n)))].sort() : [];
  if (raw.toLowerCase() === 'none') return [];
  const names = [...new Set(raw.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean))];
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) throw new Error(`SMUGAN_DISABLE does not know ${unknown.join(', ')}. Valid names: ${known.join(', ')} (or "none" to clear the list)`);
  return names.sort();
}

/**
 * A project's "disable" list, kept to names this checkout knows: the hooks
 * cannot fail a session over a typo.
 * @param {unknown} list @param {string[]} known @returns {string[]}
 */
const knownOnly = (list, known) => (Array.isArray(list) ? list.filter((n) => typeof n === 'string' && known.includes(n)) : []);

/** @param {string} text @param {string} from @param {string} to @param {string} where */
function replaceOnce(text, from, to, where) {
  if (text.split(from).length !== 2) throw new Error(`${where} no longer says "${from}" exactly once`);
  return text.replace(from, () => to);
}

const BUILD_CLAUSE = 'use `smugan-build` and `smugan context --json <target-path>`';
const TAIL_BUILD = /Use `smugan-build` before technical changes[^.]*\.\s*/;
const TAIL_REVIEWS = /^- None of this replaces the `critic`\/`flow-critic` reviews (.*)$/m;

/** @param {string} text @param {string[]} disabled */
function withoutRuleNames(text, disabled) {
  return disabled.reduce((out, name) => out.split('`' + name + '.md`, ').join(''), text);
}

/**
 * claude/CLAUDE.md without the skills and rules that are off. Reviewers are
 * profile.applyProfile's job. Phrases must occur exactly once, so a reworded
 * line fails the install instead of leaving the instruction behind.
 * @param {string} text @param {string[]} disabled
 */
function steeringParts(text, disabled) {
  let out = withoutRuleNames(text, disabled);
  if (disabled.includes('smugan-build')) out = replaceOnce(out, BUILD_CLAUSE, 'run `smugan context --json <target-path>`', 'CLAUDE.md');
  return out;
}

/**
 * An adapter's AGENTS tail without the parts that are off.
 * @param {string} text @param {string[]} disabled
 */
function tailParts(text, disabled) {
  let out = withoutRuleNames(text, disabled);
  if (disabled.includes('smugan-build')) out = out.replace(TAIL_BUILD, '');
  const on = REVIEWERS.filter((r) => !disabled.includes(r));
  if (on.length === 0) out = out.replace(new RegExp(TAIL_REVIEWS.source + '\\r?\\n?', 'm'), '');
  else if (on.length === 1) out = out.replace(TAIL_REVIEWS, (_, rest) => `- None of this replaces the \`${on[0]}\` review ${rest}`);
  return out;
}

/**
 * Mentions of disabled parts still left in steering text; an installer fails
 * when this is not empty. The audit skill shares its name with the smugan
 * command, so it is not searched.
 * @param {string} text @param {string[]} disabled @returns {string[]}
 */
function leftovers(text, disabled) {
  return disabled.filter((name) => {
    if (name === 'smugan') return false;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = REVIEWERS.includes(name) || SKILLS.includes(name)
      ? new RegExp('`(?:smugan:|/)?' + esc + '`|run the ' + esc + '\\?')
      : new RegExp('`' + esc + '\\.md`');
    return pattern.test(text);
  });
}

module.exports = { REVIEWERS, SKILLS, knownParts, resolveDisable, knownOnly, steeringParts, tailParts, leftovers };
