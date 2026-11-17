// @ts-check
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));

/** Copy managed resources without removing unrelated files. Markdown paths are
 * rewritten for the receiving host, including references below the entrypoint.
 * @param {string} source @param {string} destination @param {(text: string) => string} transform */
export function installTree(source, destination, transform) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) installTree(from, to, transform);
    else if (entry.isFile() && entry.name.endsWith('.md')) writeFileSync(to, transform(readFileSync(from, 'utf8')));
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error('Unsupported managed resource entry');
  }
}

/** Agents only Claude Code can use: the smugan message that asks for them
 * reaches the model as PreToolUse additionalContext, which only the Claude
 * Code launcher delivers. Adapters install every other agent.
 * @param {string} file */
export function adapterAgent(file) {
  return file.endsWith('.md') && file !== 'smugan-ai-research.md';
}

/** The install-time language choice, resolved the way install.sh does it: the
 * environment wins, otherwise the host's previous smugan.paths.json is kept.
 * @param {string} smuganDir @param {string} pathsFile
 * @param {(message: string) => never} fail @param {string} name */
export function installLanguage(smuganDir, pathsFile, fail, name) {
  const { resolveLanguage, applyLanguage, ruleWanted } = createRequire(import.meta.url)(join(smuganDir, 'packages', 'gate', 'src', 'language.cjs'));
  let previous = null;
  if (existsSync(pathsFile)) {
    try {
      previous = JSON.parse(readFileSync(pathsFile, 'utf8').replace(BOM, ''));
    } catch (error) {
      console.error(name + ': ' + pathsFile + ' is not valid JSON (' + /** @type {Error} */ (error).message + ') — languages fall back to the environment.');
    }
  }
  /** @type {{ ui: string | null, reply: string | null }} */
  let lang;
  try {
    lang = resolveLanguage(process.env, previous);
  } catch (error) {
    return fail(/** @type {Error} */ (error).message);
  }
  return {
    lang,
    previous,
    /** @param {string} text */
    apply: (text) => applyLanguage(text, lang),
    /** @param {string} file */
    wanted: (file) => ruleWanted(file, lang),
    summary: '= UI language: ' + (lang.ui ?? 'off') + ' · reply language: ' + (lang.reply ?? 'off') + ' (SMUGAN_UI_LANG / SMUGAN_REPLY_LANG)',
  };
}

/** The install-time SMUGAN_DISABLE list, resolved the way install.sh does it
 * and validated before any write. Adapters have no cost profile, so only the
 * list decides which reviewers stay.
 * @param {string} smuganDir @param {any} previous the host's previous smugan.paths.json
 * @param {(message: string) => never} fail */
export function installParts(smuganDir, previous, fail) {
  const load = createRequire(import.meta.url);
  const parts = load(join(smuganDir, 'packages', 'gate', 'src', 'parts.cjs'));
  const profiles = load(join(smuganDir, 'packages', 'gate', 'src', 'profile.cjs'));
  /** @type {string[]} */
  let disabled;
  try {
    disabled = parts.resolveDisable(process.env.SMUGAN_DISABLE, previous?.disable, parts.knownParts(join(smuganDir, 'claude')));
  } catch (error) {
    return fail(/** @type {Error} */ (error).message);
  }
  /** @param {string} name */
  const on = (name) => !disabled.includes(name.replace(/\.md$/, ''));
  return {
    disabled,
    on,
    reviewers: /** @type {string[]} */ (profiles.reviewers('completo', disabled)),
    /** claude/CLAUDE.md without the parts that are off, before any host rewrite. @param {string} text */
    steering: (text) => profiles.applyProfile(parts.steeringParts(text, disabled), 'completo', disabled),
    /** @param {string} text */
    tail: (text) => parts.tailParts(text, disabled),
    /** Fails the install when generated steering still names a disabled part.
     * @param {string} text @param {string} where */
    check: (text, where) => {
      const left = parts.leftovers(text, disabled);
      if (left.length) fail(where + ' still names ' + left.join(', ') + ' after SMUGAN_DISABLE — update the adapter before installing.');
      return text;
    },
    /** A rule verdict for installRules: the language's, unless the rule is off.
     * @param {(file: string) => boolean} languageWanted */
    rules: (languageWanted) => (/** @type {string} */ file) => (on(file) ? languageWanted(file) : 'disabled: SMUGAN_DISABLE'),
    summary: '= disabled: ' + (disabled.length ? disabled.join(', ') : 'none') + ' (SMUGAN_DISABLE)',
  };
}

/** A disabled skill loses its SKILL.md only: the stack rules link to the guides
 * beside it, and without SKILL.md nothing offers the skill to the agent.
 * @param {string} skillDir @param {string[]} done @param {string} label */
export function retireSkill(skillDir, done, label) {
  const entry = join(skillDir, 'SKILL.md');
  if (existsSync(entry)) rmSync(entry);
  done.push('- ' + label + '/SKILL.md (disabled: SMUGAN_DISABLE)');
}

/** Rules for a language that is off, or turned off with SMUGAN_DISABLE, are
 * removed, not left stale from an earlier install that had them on.
 * @param {string} source @param {string} destination @param {(text: string) => string} transform
 * @param {(file: string) => boolean | string} wanted true, or false / the reason it is not installed
 * @param {string[]} done @param {string} [label] */
export function installRules(source, destination, transform, wanted, done, label = 'rules/') {
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(source).filter((f) => f.endsWith('.md'))) {
    const target = join(destination, file);
    const verdict = wanted(file);
    if (verdict !== true) {
      if (existsSync(target)) {
        rmSync(target);
        done.push('- ' + label + file + ' (' + (typeof verdict === 'string' ? verdict : 'removed: the UI language is not pt') + ')');
      }
      continue;
    }
    writeFileSync(target, transform(readFileSync(join(source, file), 'utf8')));
    done.push('+ ' + label + file);
  }
}
