// Antigravity tool call → the snake_case shape the smugan gate expects.
//
// This is the only part of the whole contract the platform does not document:
// the hook payload's `toolCall.args` field names. The agent engine is Windsurf's
// Cascade (the shipped build logs `cascade_manager.go`), whose file tools have
// historically used PascalCase — TargetFile, CodeContent, ReplacementChunks.
// So the rule here is: **the tool NAME never decides, the SHAPE decides**. An
// unknown name carrying a known shape is gated; a known name carrying an
// unknown shape degrades to "not ours" — never to a wrong verdict.
//
// Pure module: no I/O, no process state. Everything here is unit-testable.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

// Coalesce like ??, so an explicit null does not shadow a later candidate.
const pick = (...values) => values.find((v) => v !== undefined && v !== null);

const fold = (p) => {
  const normed = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normed.toLowerCase() : normed;
};

const str = (v) => (typeof v === 'string' && v ? v : undefined);

/**
 * Assistant state — Antigravity's own config and the Claude one — is not
 * project code. Boundary-safe: ~/.gemini must not swallow ~/.gemini-dev.
 */
export function isAssistantState(file) {
  const dirs = [
    process.env.SMUGAN_AGY_HOME,
    join(homedir(), '.gemini'),
    join(homedir(), '.antigravity'),
    process.env.APPDATA ? join(process.env.APPDATA, 'Antigravity') : null,
    process.env.CLAUDE_CONFIG_DIR,
    join(homedir(), '.claude'),
  ].filter(Boolean);
  const target = fold(file);
  return dirs.some((dir) => target.startsWith(fold(dir) + '/'));
}

const filePathOf = (a) => str(pick(
  a.TargetFile, a.targetFile, a.target_file,
  a.AbsolutePath, a.absolutePath, a.absolute_path,
  a.FilePath, a.filePath, a.file_path, a.filepath,
  a.Path, a.path,
));

const contentOf = (a) => pick(
  a.CodeContent, a.codeContent, a.code_content,
  a.Content, a.content,
  a.FileText, a.fileText, a.file_text,
  a.NewContent, a.newContent, a.new_content,
  a.Text, a.text,
);

const chunksOf = (a) => {
  const raw = pick(
    a.ReplacementChunks, a.replacementChunks, a.replacement_chunks,
    a.Chunks, a.chunks,
    a.Edits, a.edits,
    a.Replacements, a.replacements,
  );
  return Array.isArray(raw) ? raw : undefined;
};

const oldOf = (c) => pick(
  c.TargetContent, c.targetContent, c.target_content,
  c.OldString, c.oldString, c.old_string, c.old_str,
  c.Search, c.search,
);

const newOf = (c) => pick(
  c.ReplacementContent, c.replacementContent, c.replacement_content,
  c.NewString, c.newString, c.new_string, c.new_str,
  c.Replace, c.replace,
);

const allOf = (c) => pick(
  c.AllowMultiple, c.allowMultiple, c.allow_multiple,
  c.ReplaceAll, c.replaceAll, c.replace_all,
);

const toEdit = (c) => ({ old_string: oldOf(c), new_string: newOf(c), replace_all: allOf(c) });

/** conversationId is what the gate keys its per-turn marker on. */
export function sessionId(payload) {
  return String(pick(
    payload?.conversationId, payload?.conversation_id,
    payload?.sessionId, payload?.session_id,
  ) ?? '');
}

/** Absolute path, or undefined when we cannot resolve one honestly. */
function absolutize(file, payload) {
  if (isAbsolute(file)) return file;
  const raw = payload?.workspacePaths ?? payload?.workspace_paths;
  const roots = (Array.isArray(raw) ? raw : [raw]).map(str).filter(Boolean);
  if (roots.length === 0) return undefined; // never resolve against the hook's cwd
  // The field is plural: in a multi-root workspace, guessing the first root
  // would hand the gate a path that does not exist — no baseline, so legacy
  // code gets judged in full. Prefer the root where the file actually is.
  const found = roots.find((root) => existsSync(resolve(root, file)));
  if (found) return resolve(found, file);
  return roots.length === 1 ? resolve(roots[0], file) : undefined;
}

/** One args object → at most one gate call. */
function callFromArgs(args, payload) {
  const a = args ?? {};
  const raw = filePathOf(a);
  if (!raw) return null;
  // No blanket temp-dir exemption: a real project can live under /tmp, and the
  // gate already exempts its own scratchpad.
  const file = absolutize(raw, payload);
  if (!file || isAssistantState(file)) return null;

  const chunks = chunksOf(a);
  const content = contentOf(a);
  const flatOld = oldOf(a);

  // Shape decides. Order matters: chunks are the richest signal.
  if (chunks && chunks.length > 0) {
    const edits = chunks.map(toEdit);
    // A chunk whose replacement we could not name would be modelled as a pure
    // deletion — a wrong verdict from a half-known shape. Drop instead.
    if (edits.some((e) => typeof e.old_string !== 'string' || typeof e.new_string !== 'string')) return null;
    return { tool_name: 'MultiEdit', tool_input: { file_path: file, edits } };
  }
  if (typeof flatOld === 'string') {
    const replacement = newOf(a);
    if (typeof replacement !== 'string') return null;
    return {
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: flatOld, new_string: replacement, replace_all: allOf(a) },
    };
  }
  if (typeof content === 'string') {
    // Creating an empty file has nothing to judge; faking content: '' would
    // pollute the turn baseline with a file that never had that shape.
    const empty = pick(a.EmptyFile, a.emptyFile, a.empty_file);
    if (empty === true && !content) return null;
    return { tool_name: 'Write', tool_input: { file_path: file, content } };
  }
  return null;
}

/**
 * Every project file this call touches, regardless of whether we can model the
 * edit. The post event only needs the path — it records the file for the
 * end-of-turn check and runs the project's linters on it — so judging the shape
 * there would trade a whole Definition of Done for nothing. Dropping a shape is
 * right for `pre` (never guess a verdict) and wrong for `post`.
 * @returns {string[]}
 */
export function pathsOf(payload) {
  try {
    const args = payload?.toolCall?.args ?? payload?.toolCall?.arguments ?? payload?.tool_call?.args;
    if (!args || typeof args !== 'object') return [];
    const batch = chunksOf(args);
    const items = batch && batch.some((item) => item && filePathOf(item)) ? batch : [args];
    const out = [];
    for (const item of items) {
      const raw = item && filePathOf(item);
      if (!raw) continue;
      const file = absolutize(raw, payload);
      if (file && !isAssistantState(file) && !out.includes(file)) out.push(file);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Hook payload → gate calls. Empty array means "not a write we can judge".
 * @returns {{tool_name: string, tool_input: object}[]}
 */
export function normalize(payload) {
  try {
    const args = payload?.toolCall?.args ?? payload?.toolCall?.arguments ?? payload?.tool_call?.args;
    if (!args || typeof args !== 'object') return [];

    // multi_replace_file_content: a list whose items each carry their own path.
    // Entries for the SAME file must become ONE MultiEdit: the gate applies a
    // MultiEdit's edits in sequence, but judges separate calls against the file
    // on disk — which would score an intermediate state that never exists (an
    // import added by one chunk and first used by the next reads as dead).
    const batch = chunksOf(args);
    if (batch && batch.length > 0 && batch.some((item) => item && filePathOf(item))) {
      const byFile = new Map();
      for (const item of batch) {
        const call = callFromArgs(item, payload);
        if (!call) continue;
        const key = call.tool_input.file_path;
        const seen = byFile.get(key);

        // A whole-file write and edits for the same file in one batch: we cannot
        // model the combination faithfully in either order, and guessing would
        // mean judging content that is not what lands. Drop that file — a missed
        // check is recoverable, a wrong verdict on a legitimate write is not.
        if (call.tool_name === 'Write' || seen?.tool_name === 'Write') {
          byFile.set(key, seen ? null : call);
          continue;
        }
        const edits = call.tool_name === 'MultiEdit'
          ? call.tool_input.edits
          : [{ old_string: call.tool_input.old_string, new_string: call.tool_input.new_string, replace_all: call.tool_input.replace_all }];
        if (seen) seen.tool_input.edits.push(...edits);
        else byFile.set(key, { tool_name: 'MultiEdit', tool_input: { file_path: key, edits } });
      }
      return [...byFile.values()].filter(Boolean);
    }

    const single = callFromArgs(args, payload);
    return single ? [single] : [];
  } catch {
    return [];
  }
}
