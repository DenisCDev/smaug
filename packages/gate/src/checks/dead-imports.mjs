// @ts-check
// An imported binding never referenced in the file is dead weight.
// Single-file analysis: precise for unused imports, no project graph needed.
import { stripCode } from '../strip.mjs';

const IMPORT_RE = /^[ \t]*import\s+(?:type\s+)?([^'";]+?)\s+from\s+['"][^'"]+['"]/gm;

/** @param {string} clause @returns {string[]} */
function bindings(clause) {
  const names = [];
  let rest = clause.trim();
  if (!rest.startsWith('{') && !rest.startsWith('*')) {
    const def = rest.match(/^([A-Za-z_$][\w$]*)/);
    if (def) {
      names.push(def[1]);
      rest = rest.slice(def[1].length).replace(/^\s*,\s*/, '');
    }
  }
  const ns = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (ns) names.push(ns[1]);
  const braces = rest.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const cleaned = part.trim().replace(/^type\s+/, '');
      if (!cleaned) continue;
      const renamed = cleaned.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.push(renamed ? renamed[1] : cleaned.split(/\s+/)[0]);
    }
  }
  return names.filter(Boolean);
}

/** @param {string} name */
function escapeRe(name) {
  return name.replace(/\$/g, '\\$');
}

export default {
  name: 'dead-imports',
  /** @param {string} path */
  appliesTo(path) {
    return /\.(?:ts|tsx|js|jsx|mjs|mts|cts)$/.test(path) && !/\.d\.(?:ts|mts|cts)$/.test(path);
  },
  /** @param {{ content: string }} ctx */
  run({ content }) {
    const stripped = stripCode(content);
    /** @type {{ name: string, line: number }[]} */
    const imports = [];
    let body = stripped;
    let m;
    while ((m = IMPORT_RE.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split('\n').length;
      for (const name of bindings(m[1])) imports.push({ name, line });
      // blank the import statement itself so the binding search skips it
      body = body.slice(0, m.index) + ' '.repeat(m[0].length) + body.slice(m.index + m[0].length);
    }
    IMPORT_RE.lastIndex = 0;

    const violations = [];
    for (const { name, line } of imports) {
      // `$` is an identifier character that \b does not see: `$`, `component$`.
      // For a name ending in `$`, the `${` that opens a template expression is not a use.
      const end = name.endsWith('$') ? '(?![\\w${])' : '(?![\\w$])';
      const used = new RegExp('(?<![\\w$])' + escapeRe(name) + end).test(body);
      if (!used) {
        violations.push({ line, message: `unused import "${name}" — remove it` });
      }
    }
    return violations;
  },
};
