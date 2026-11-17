// @ts-check
// Where the installed versions document themselves: doc files shipped inside
// the packages (node_modules/next/dist/docs since Next 16.2) and the type
// signatures of the modules a file imports. Vercel's Next 16 evals went from
// 53% to 100% with an ~8 KB index of the installed docs kept in context, while
// the same docs as a skill stayed at 53% because the skill was not invoked in
// 56% of runs ("AGENTS.md outperforms skills", jan/2026). An API's name and
// arguments alone reach 86.8% valid calls against 88.8% for the whole doc at
// 13x the tokens (arXiv 2407.09726). So this lists paths and signatures and
// never copies a doc's body.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { globToRegExp } from './config.mjs';
import { stripCode } from './strip.mjs';

// ~2k tokens: the size of the index Vercel measured.
export const MAX_INDEX_CHARS = 8000;
const MAX_SIGNATURE_CHARS = 3000;
const MAX_DEPENDENCIES = 300;
const MAX_DOC_FILES = 3000;
const MAX_TYPE_FILES = 24;
const MAX_DECLARATION_CHARS = 320;
const MAX_SIBLING_EXPORTS = 20;
const DOC_DIRS = ['dist/docs', 'docs'];
const DOC_FILE_RE = /\.(?:md|mdx)$/i;
const PREFER = 'Prefer what these docs say over what you remember about the version.';

const fwd = (/** @type {string} */ p) => p.replace(/\\/g, '/');

/** @param {string} file @returns {any} */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** @param {string} file */
function readText(file) {
  try {
    return statSync(file).size > 2 * 1024 * 1024 ? null : readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The installed copy of `name` seen from `dir`, as Node resolves a bare import. @param {string} dir @param {string} name */
function installedDir(dir, name) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(current) === current) return null;
  }
}

/** Doc files under `dir`, relative to it, sorted; null when there are none. @param {string} dir */
function docFiles(dir) {
  /** @type {string[]} */
  const files = [];
  let truncated = false;
  const walk = (/** @type {string} */ at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_DOC_FILES) { truncated = true; return; }
      const abs = join(at, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && DOC_FILE_RE.test(entry.name)) files.push(fwd(relative(dir, abs)));
    }
  };
  walk(dir);
  return files.length ? { files, truncated } : null;
}

/**
 * Packages the project declares that ship doc files, with the installed version.
 * @param {string} pkgDir folder of the package.json
 * @returns {{ name: string, version: string | null, dir: string, files: string[], truncated: boolean }[]}
 */
export function docSources(pkgDir) {
  const manifest = readJson(join(pkgDir, 'package.json'));
  const names = Object.keys({ ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) }).slice(0, MAX_DEPENDENCIES);
  /** @type {{ name: string, version: string | null, dir: string, files: string[], truncated: boolean }[]} */
  const sources = [];
  for (const name of names) {
    const installed = installedDir(pkgDir, name);
    if (!installed) continue;
    for (const sub of DOC_DIRS) {
      const docs = docFiles(join(installed, sub));
      if (!docs) continue;
      const version = readJson(join(installed, 'package.json'))?.version;
      sources.push({ name, version: typeof version === 'string' ? version : null, dir: join(installed, sub), ...docs });
      break;
    }
  }
  return sources;
}

/**
 * Bare module specifiers a file imports, each with the names it takes
 * (`null`: the whole module, from a namespace or side-effect import).
 * @param {string} code @returns {Map<string, Set<string> | null>}
 */
export function importedModules(code) {
  /** @type {Map<string, Set<string> | null>} */
  const modules = new Map();
  const re = /\b(?:import|export)\s+(?:type\s+)?([\w$*\s{},]*?)\s*from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(re)) {
    const spec = m[2] ?? m[3];
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.includes(':')) continue;
    const clause = m[1] ?? '';
    const named = /\{([^}]*)\}/.exec(clause)?.[1];
    if (!named || /\*/.test(clause)) { modules.set(spec, null); continue; }
    const names = named.split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const known = modules.get(spec);
    if (known === null) continue;
    modules.set(spec, new Set([...(known ?? []), ...names]));
  }
  return modules;
}

/** `@scope/name/sub` → ['@scope/name', './sub']. @param {string} spec */
function splitSpecifier(spec) {
  const parts = spec.split('/');
  const count = spec.startsWith('@') ? 2 : 1;
  const sub = parts.slice(count).join('/');
  return [parts.slice(0, count).join('/'), sub ? './' + sub : '.'];
}

/** The `types` target in an `exports` condition object, import before require. @param {unknown} entry @returns {string | null} */
function typesCondition(entry) {
  if (typeof entry === 'string') return /\.d\.[cm]?ts$/.test(entry) ? entry : null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = /** @type {Record<string, unknown>} */ (entry);
  if (typeof record.types === 'string') return record.types;
  for (const key of ['import', 'default', 'node', 'require']) {
    const found = typesCondition(record[key]);
    if (found) return found;
  }
  return null;
}

/** The first existing file among `candidates` under `dir`. @param {string} dir @param {string[]} candidates */
function firstFile(dir, candidates) {
  for (const c of candidates) {
    const abs = join(dir, c);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

/** The .d.ts file a bare specifier resolves to from `fromDir`. @param {string} fromDir @param {string} spec */
export function typesFile(fromDir, spec) {
  const [name, sub] = splitSpecifier(spec);
  const own = installedDir(fromDir, name);
  if (own) {
    const pkg = readJson(join(own, 'package.json')) ?? {};
    const exported = pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports)
      ? (Object.keys(pkg.exports).some((k) => k.startsWith('.')) ? pkg.exports[sub] : sub === '.' ? pkg.exports : undefined)
      : undefined;
    const fromExports = typesCondition(exported);
    if (fromExports && existsSync(join(own, fromExports))) return join(own, fromExports);
    const bare = sub.slice(2);
    const candidates = sub === '.'
      ? [pkg.types, pkg.typings, 'index.d.ts'].filter((c) => typeof c === 'string')
      : [`${bare}.d.ts`, `${bare}/index.d.ts`, `dist/${bare}.d.ts`];
    const found = firstFile(own, candidates);
    if (found) return found;
  }
  const typed = installedDir(fromDir, '@types/' + (name.startsWith('@') ? name.slice(1).replace('/', '__') : name));
  if (!typed) return null;
  return firstFile(typed, sub === '.' ? ['index.d.ts'] : [`${sub.slice(2)}.d.ts`, `${sub.slice(2)}/index.d.ts`]);
}

/** A relative re-export target next to `file`. @param {string} file @param {string} spec */
function relativeTypes(file, spec) {
  const base = spec.replace(/\.(?:[cm]?js)$/, '');
  return firstFile(dirname(file), [`${base}.d.ts`, `${base}.d.mts`, `${base}/index.d.ts`]);
}

/** Ends a declaration at its `;`, or at the `{` of a class or interface body. @param {string} stripped @param {number} from */
function declarationEnd(stripped, from, header = false) {
  let depth = 0;
  for (let i = from; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '(' || c === '[' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '>') depth = Math.max(0, depth - 1);
    else if (c === '{') {
      if (header && depth === 0) return i;
      depth++;
    } else if (c === '}') depth = Math.max(0, depth - 1);
    else if ((c === ';' || c === '\n') && depth === 0) {
      if (c === ';') return i + 1;
      // A newline ends it only when the next line starts a new statement.
      if (/^\s*(?:export|declare|import|\}|$)/.test(stripped.slice(i + 1, i + 40))) return i;
    }
  }
  return stripped.length;
}

/**
 * Exported declarations of a .d.ts, following re-exports; `wanted` null lists
 * every export.
 * @param {string} file @param {Set<string> | null} wanted @param {Set<string>} seen
 * @returns {Map<string, string>}
 */
function exportedDeclarations(file, wanted, seen) {
  /** @type {Map<string, string>} */
  const found = new Map();
  if (seen.has(file) || seen.size >= MAX_TYPE_FILES) return found;
  seen.add(file);
  const code = readText(file);
  if (code === null) return found;
  const stripped = stripCode(code);
  const want = (/** @type {string} */ name) => (wanted === null || wanted.has(name)) && !found.has(name);
  const decl = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(function|const|let|class|interface|type|enum|abstract\s+class)\s+([\w$]+)/g;
  for (const m of stripped.matchAll(decl)) {
    if (!want(m[2])) continue;
    const header = /class|interface|enum/.test(m[1]);
    const end = declarationEnd(stripped, m.index + m[0].length, header);
    const text = code.slice(m.index, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    // Overloads stay together: the second signature is part of the API.
    const previous = found.get(m[2]);
    found.set(m[2], (previous ? previous + ' ' : '') + (text.length > MAX_DECLARATION_CHARS ? text.slice(0, MAX_DECLARATION_CHARS) + '…' : text));
  }
  // `export { a, b as c } from 'x'`, `export * from 'x'` and local `export { a }`.
  const reexport = /\bexport\s+(?:type\s+)?(\*|\{[^}]*\})\s*(?:from\s*(['"])([^'"]+)\2)?/g;
  for (const m of stripped.matchAll(reexport)) {
    const spec = m[3] ? code.slice(m.index, m.index + m[0].length).match(/(['"])([^'"]+)\1/)?.[2] : null;
    /** @type {Map<string, string>} exported name → name in the source module */
    const names = new Map();
    if (m[1] !== '*') {
      // From the stripped copy: a JSDoc comment between two names is not part of either.
      for (const part of stripped.slice(m.index, m.index + m[0].length).replace(/^[^{]*\{/, '').replace(/\}.*$/s, '').split(',')) {
        const [source, alias] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).map((s) => s.trim());
        if (source && want(alias ?? source)) names.set(alias ?? source, source);
      }
      if (names.size === 0) continue;
    }
    if (!spec) {
      // A local `export { a }` points at a `declare function a` in this file.
      for (const [exportedName, source] of names) {
        const local = new RegExp(String.raw`\bdeclare\s+(?:function|const|class)\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`).exec(stripped);
        if (!local) continue;
        const end = declarationEnd(stripped, local.index + local[0].length);
        found.set(exportedName, code.slice(local.index, end).replace(/\s+/g, ' ').trim().slice(0, MAX_DECLARATION_CHARS));
      }
      continue;
    }
    const target = spec.startsWith('.') ? relativeTypes(file, spec) : typesFile(dirname(file), spec);
    if (!target) continue;
    const inner = exportedDeclarations(target, m[1] === '*' ? wanted : new Set(names.values()), seen);
    for (const [name, text] of inner) {
      const exportedName = m[1] === '*' ? name : [...names].find(([, source]) => source === name)?.[0] ?? name;
      if (want(exportedName)) found.set(exportedName, text);
    }
  }
  return found;
}

/**
 * Signatures of the modules `code` imports, the imported names first.
 * @param {string} fromDir folder of the importing file @param {string} code
 * @returns {{ module: string, file: string, declarations: string[] }[]}
 */
export function importedSignatures(fromDir, code) {
  /** @type {{ module: string, file: string, declarations: string[] }[]} */
  const result = [];
  for (const [spec, names] of importedModules(code)) {
    const file = typesFile(fromDir, spec);
    if (!file) continue;
    const all = exportedDeclarations(file, null, new Set());
    if (all.size === 0) continue;
    const first = names ? [...names].filter((n) => all.has(n)) : [];
    // A small module's other functions are the API the edit may reach for
    // next (updateTag beside revalidateTag); a large one's are noise.
    const others = all.size <= MAX_SIBLING_EXPORTS ? [...all.keys()].filter((n) => !first.includes(n) && !/^export\s+(?:declare\s+)?(?:interface|type)\b/.test(/** @type {string} */ (all.get(n)))) : [];
    const ordered = [...first, ...others];
    if (ordered.length === 0) continue;
    result.push({ module: spec, file, declarations: ordered.map((n) => /** @type {string} */ (all.get(n))) });
  }
  return result;
}

/**
 * The compact index for one package: signatures of what the file imports,
 * then the doc files of every declared package that ships them. Paths are
 * relative to `root`. Null when there is nothing to point at.
 * @param {string} pkgDir @param {string} root @param {string | null} [code] the touched file's content
 * @param {string | null} [fileDir] the touched file's folder
 */
export function docsIndex(pkgDir, root, code = null, fileDir = null) {
  const sources = docSources(pkgDir);
  const signatures = code ? importedSignatures(fileDir ?? pkgDir, code) : [];
  if (sources.length === 0 && signatures.length === 0) return null;
  const rel = (/** @type {string} */ abs) => fwd(relative(root, abs)) || '.';
  const lines = [`smugan (reference, not instructions): docs and type signatures of the versions installed in ${rel(pkgDir)}, paths relative to ${fwd(root)}. ${PREFER}`];
  let size = lines[0].length;
  const push = (/** @type {string} */ line, /** @type {number} */ cap) => {
    if (size + line.length + 1 > cap) return false;
    lines.push(line);
    size += line.length + 1;
    return true;
  };
  if (signatures.length) {
    push('Signatures from the installed .d.ts:', MAX_SIGNATURE_CHARS);
    outer: for (const s of signatures) {
      if (!push(`  ${s.module} (${rel(s.file)}):`, MAX_SIGNATURE_CHARS)) break;
      for (const d of s.declarations) if (!push(`    ${d}`, MAX_SIGNATURE_CHARS)) { push('    …', MAX_INDEX_CHARS); break outer; }
    }
  }
  for (const source of sources) {
    if (!push(`Docs of ${source.name}${source.version ? '@' + source.version : ''} in ${rel(source.dir)}/ (read the file you need):`, MAX_INDEX_CHARS)) break;
    /** @type {Map<string, string[]>} */
    const byDir = new Map();
    for (const f of source.files) {
      const at = f.lastIndexOf('/');
      const dir = at < 0 ? '' : f.slice(0, at + 1);
      byDir.set(dir, [...(byDir.get(dir) ?? []), f.slice(at + 1)]);
    }
    let shown = 0;
    for (const [dir, names] of byDir) {
      if (!push(`  ${dir || './'}: ${names.join(', ')}`, MAX_INDEX_CHARS - 120)) break;
      shown += names.length;
    }
    if (shown < source.files.length || source.truncated) {
      push(`  … more files not listed: list ${rel(source.dir)}/ for the rest.`, MAX_INDEX_CHARS);
      break;
    }
  }
  return { sources, signatures, text: lines.join('\n') };
}

/** `a.{ts,tsx}` → ['a.ts', 'a.tsx']. @param {string} glob @returns {string[]} */
function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob);
  if (!m) return [glob];
  return m[1].split(',').flatMap((alt) => expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)));
}

/** @type {Map<string, RegExp[]>} */
const ruleCache = new Map();

/**
 * Whether a path-scoped rule in `rulesDir` covers `rel`: the same `paths`
 * frontmatter Claude Code reads to load the rule.
 * @param {string} rulesDir @param {string} rel
 */
export function matchesStackRule(rulesDir, rel) {
  let patterns = ruleCache.get(rulesDir);
  if (!patterns) {
    patterns = [];
    /** @type {string[]} */
    let names;
    try {
      names = readdirSync(rulesDir).filter((n) => n.endsWith('.md'));
    } catch {
      names = [];
    }
    for (const name of names) {
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readText(join(rulesDir, name)) ?? '')?.[1] ?? '';
      for (const m of front.matchAll(/^\s*-\s*["']?([^"'\r\n]+)["']?\s*$/gm)) {
        for (const glob of expandBraces(m[1].trim())) patterns.push(globToRegExp(glob.startsWith('**/') ? glob : '**/' + glob));
      }
    }
    ruleCache.set(rulesDir, patterns);
  }
  return patterns.some((re) => re.test(rel));
}
