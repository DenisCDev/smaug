// @ts-check
'use strict';
// Cost profile chosen at install time (SMUGAN_PROFILE) or as a plugin option.
// It only decides which model the reviewers run on and whether flow-critic is
// used (a reviewer turned off with SMUGAN_DISABLE is dropped here too); the
// gate, the rules and the critic's checklist stay the same.

/** @typedef {'completo' | 'economico' | 'minimo'} Profile */

/** @type {Record<Profile, string | null>} */
const PROFILE_MODEL = { completo: null, economico: 'sonnet', minimo: 'haiku' };
const PROFILES = /** @type {Profile[]} */ (Object.keys(PROFILE_MODEL));
const MODEL = /^[A-Za-z][\w.-]*(?:\[1m\])?$/;

/** @param {unknown} value @returns {value is Profile} */
const isProfile = (value) => typeof value === 'string' && Object.hasOwn(PROFILE_MODEL, value);

/**
 * The environment wins; otherwise the previous install's choice is kept.
 * @param {string | undefined} value @param {unknown} [previous] @returns {Profile}
 */
function resolveProfile(value, previous) {
  const chosen = (value ?? '').trim().toLowerCase();
  if (!chosen) return isProfile(previous) ? previous : 'completo';
  if (!isProfile(chosen)) throw new Error(`SMUGAN_PROFILE must be one of ${PROFILES.join(', ')}`);
  return chosen;
}

/**
 * SMUGAN_REVIEW_MODEL, when set, wins over the profile. null means the
 * reviewers inherit the conversation's model.
 * @param {Profile} profile @param {string | undefined} override @returns {string | null}
 */
function reviewModel(profile, override) {
  const explicit = (override ?? '').trim();
  if (!explicit) return PROFILE_MODEL[profile];
  if (!MODEL.test(explicit)) throw new Error('SMUGAN_REVIEW_MODEL must be a model alias (sonnet, opus, haiku, fable, inherit) or a full model ID.');
  return explicit;
}

/**
 * A reviewer turned off with SMUGAN_DISABLE is gone whatever the profile.
 * @param {Profile} profile @param {readonly string[]} [disabled]
 */
const usesFlowCritic = (profile, disabled = []) => profile !== 'minimo' && !disabled.includes('flow-critic');

/** @param {Profile} profile @param {readonly string[]} [disabled] @returns {string[]} */
const reviewers = (profile, disabled = []) => ['critic', ...(usesFlowCritic(profile, disabled) ? ['flow-critic'] : [])].filter((r) => !disabled.includes(r));

/** @param {string} file @param {Profile} profile @param {readonly string[]} [disabled] */
const agentWanted = (file, profile, disabled = []) => {
  const name = file.replace(/\.md$/, '');
  return name !== 'critic' && name !== 'flow-critic' ? true : reviewers(profile, disabled).includes(name);
};

const FLOW_CRITIC_CLAUSE = ', plus the `flow-critic` subagent when users see the change';
const CRITIC_CLAUSE = 'the `critic` subagent' + FLOW_CRITIC_CLAUSE;
const REVIEW_BULLETS = ['- Critical change, or an ordinary one over ~300 changed lines:', '- Brief a reviewer ', '- Without subagents, offer the required review'];

/** @param {string} text @param {string} from @param {string} to */
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('CLAUDE.md no longer says "' + from + '" exactly once');
  return text.replace(from, () => to);
}

/**
 * CLAUDE.md for the profile and the reviewers left on: under minimo (or with
 * flow-critic disabled) the Definition of done stops naming flow-critic; with
 * critic disabled it names flow-critic alone; with both off the review bullets
 * go. Each phrase must occur exactly once, so a reworded bullet fails loudly
 * instead of leaving the instruction behind.
 * @param {string} text @param {Profile} profile @param {readonly string[]} [disabled]
 */
function applyProfile(text, profile, disabled = []) {
  const on = reviewers(profile, disabled);
  if (on.length === 2) return text;
  if (on.length === 1 && on[0] === 'critic') return replaceOnce(text, FLOW_CRITIC_CLAUSE, '');
  if (on.length === 1) return replaceOnce(replaceOnce(text, CRITIC_CLAUSE, 'the `flow-critic` subagent when users see the change'), '("run the critic?")', '("run the flow-critic?")');
  const lines = text.split('\n');
  for (const bullet of REVIEW_BULLETS) {
    if (lines.filter((l) => l.startsWith(bullet)).length !== 1) throw new Error('CLAUDE.md no longer has one bullet starting "' + bullet + '"');
  }
  return lines.filter((l) => !REVIEW_BULLETS.some((b) => l.startsWith(b))).join('\n');
}

/**
 * The reviewer agent file with the model line the install writes.
 * @param {string} agent @param {string | null} model
 */
function withModel(agent, model) {
  if (!model) return agent;
  const frontmatter = /^---\r?\n[\s\S]*?(?=\r?\n---\r?\n)/;
  const match = agent.match(frontmatter);
  if (!match || /^model:/m.test(match[0])) throw new Error('Unexpected agent frontmatter; cannot apply the reviewer model.');
  return agent.replace(frontmatter, (fm) => fm + '\nmodel: ' + model);
}

module.exports = { PROFILES, resolveProfile, reviewModel, usesFlowCritic, reviewers, agentWanted, applyProfile, withModel };
