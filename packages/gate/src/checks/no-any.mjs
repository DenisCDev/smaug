// @ts-check
// `any` disables the type system — and so does the `as unknown as` double
// cast, the classic bypass. Every use needs a written justification: an
// `any: <reason>` comment on the same line or in the comment block directly
// above, or the tool-native eslint-disable for no-explicit-any WITH a reason
// (the `-- description` convention) — the same route the post-hook already
// recommends, so the two layers stop disagreeing about what counts.
import { stripCode } from '../strip.mjs';

// Every type position: annotation, `as any`, any generic or tuple slot
// (`Record<string, any>`, `[any, string]`), a union or intersection member, a
// function type's return and a type alias or default (`type X = any`,
// `<T = any>`). `keyof any` and `T extends any` never weaken a type, so they
// stay clean; a following `.` or `(` means a value named `any`, not the type.
// A middle slot counts only when a `>` or `]` closes it before any brace or
// paren, which keeps `import { all, any, race }` and call arguments out.
const ANY_RE = new RegExp([
  String.raw`:\s*any\b`,
  String.raw`\bas\s+any\b`,
  String.raw`<\s*any\s*[>,)\]]`,
  String.raw`\[\s*any\s*[,\]]`,
  String.raw`,\s*any\s*[>\]]`,
  String.raw`,\s*any\s*,(?=[^{}()]*[>\]])`,
  String.raw`\bany\s*\[\]`,
  String.raw`(?<![|&])[|&]\s*any\b(?!\s*[.(])`,
  String.raw`=>\s*any\b(?!\s*[.(])`,
  String.raw`(?<![=!<>+\-*/%&|^?])=(?![=>])\s*any\b(?!\s*[.(])`,
].join('|'));
const DOUBLE_CAST_RE = /\bas\s+unknown\s+as\b/;
const JUSTIFIED_RE = /(\/\/|\/\*).*\bany\b\s*:\s*\S.{5,}/i;
const JSDOC_JUSTIFIED_RE = /^\s*\*.*\bany\b\s*:\s*\S.{5,}/i;
// Same-line vs previous-line variants follow eslint's own semantics: -line
// governs its own line, -next-line the one below (and the plain block form
// governs from where it stands). A reason after `--` is still required.
const ESLINT_SAMELINE_RE = /eslint-disable(?:-line)?\s[^\n]*no-explicit-any[^\n]*--\s*\S.{5,}/i;
const ESLINT_PREVLINE_RE = /eslint-disable(?:-next-line)?\s[^\n]*no-explicit-any[^\n]*--\s*\S.{5,}/i;
// `*/` counts as comment-only ONLY when alone: "*/ doRealWork();" is code, and
// treating it as comment let a justification cover an `any` past real code.
const COMMENT_ONLY_RE = /^\s*(?:\/\/|\/\*|\*\/\s*$|\*(?!\/))/;
// The other off switches: `@ts-nocheck` for a whole file and `@ts-ignore` for
// whatever the next line gets wrong, now or later. TypeScript obeys them only
// when they open the comment, so a mention in prose is not one. With `any`
// held, they were the cheapest way past a type error; `@ts-expect-error` stays
// free, because it fails by itself once the error is gone.
const TS_DIRECTIVE_RE = /^\s*\{?\s*(?:\/\/+|\/\*+|\*+)\s*@ts-(ignore|nocheck)\b(.*)$/;
const TS_DIRECTIVE_MESSAGES = {
  nocheck: '`@ts-nocheck` turns type checking off for the whole file — fix the errors, or write why on the same line ("// @ts-nocheck <reason>")',
  ignore: '`@ts-ignore` hides every type error on the next line, including ones added later — fix the type, or use "// @ts-expect-error <reason>", which fails once the error is gone',
};

/** @param {string} line */
function justifies(line) {
  return JUSTIFIED_RE.test(line) || JSDOC_JUSTIFIED_RE.test(line);
}

/**
 * The justification may sit anywhere in the contiguous comment block (blank
 * lines allowed) directly above the flagged line — demanding the line
 * IMMEDIATELY above produced placement-retry loops in production while the
 * justification sat two lines up (production app, jul-ago/2026, 8 blocks).
 * @param {string[]} lines @param {number} i index of the flagged line
 */
function justifiedAbove(lines, i) {
  for (let j = i - 1; j >= 0; j--) {
    const line = lines[j] ?? '';
    if (line.trim() === '') continue;
    if (!COMMENT_ONLY_RE.test(line)) return false;
    if (justifies(line)) return true;
  }
  return false;
}

export default {
  name: 'no-any',
  /** @param {string} path */
  appliesTo(path) {
    return /\.(?:ts|tsx|mts|cts)$/.test(path) && !/\.d\.(?:ts|mts|cts)$/.test(path);
  },
  /** @param {{ content: string, lines: string[] }} ctx */
  run({ content, lines }) {
    const stripped = stripCode(content).split('\n');
    const violations = [];
    for (let i = 0; i < stripped.length; i++) {
      // A whole-line comment leaves nothing in the stripped copy but JSX braces.
      const directive = /^[\s{}]*$/.test(stripped[i]) ? TS_DIRECTIVE_RE.exec(lines[i]) : null;
      if (directive) {
        const reason = directive[2].replace(/\*\/.*$/, '').replace(/^[\s:-]+/, '').trim();
        if (reason.length < 6) violations.push({ line: i + 1, message: TS_DIRECTIVE_MESSAGES[/** @type {'ignore' | 'nocheck'} */ (directive[1])] });
        continue;
      }
      const doubleCast = DOUBLE_CAST_RE.test(stripped[i]);
      if (!doubleCast && !ANY_RE.test(stripped[i])) continue;
      const here = lines[i] ?? '';
      const above = lines[i - 1] ?? '';
      if (justifies(here) || justifiedAbove(lines, i)) continue;
      if (ESLINT_SAMELINE_RE.test(here) || ESLINT_PREVLINE_RE.test(above)) continue;
      violations.push({
        line: i + 1,
        message: doubleCast
          ? '`as unknown as` double cast defeats the type system like `any` — fix the type, or add "// any: <reason>" if it is truly unavoidable'
          : '`any` without justification — fix the type, or add "// any: <reason>" if it is truly unavoidable',
      });
    }
    return violations;
  },
};
