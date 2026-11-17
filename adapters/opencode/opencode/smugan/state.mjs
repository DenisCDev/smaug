// Per-session state, in memory only. The plugin lives as long as the OpenCode
// process, and the one piece of state that must outlive it — the turn marker —
// already belongs to the gate. Keeping this off disk also removes the
// read-modify-write race a file-backed counter would need.
const sessions = new Map();

export function forSession(id) {
  let state = sessions.get(id);
  if (!state) {
    state = {
      isChild: undefined,      // cached client.session.get().parentID != null
      aborted: false,          // sticky: the user pressed ESC — never resume
      sameReason: 0,           // consecutive resumes for the same complaint
      resumes: 0,              // resumes this session; only the user clears it
      lastContinueAt: 0,
      evaluated: '',           // assistant message id already judged (idle fires more than once)
      assistant: null,         // {id, finish, error, modelID, providerID, mode}
      lastPart: null,          // {type, tool}
      todos: [],
      surfaced: new Set(),     // stack rules already injected this session
      warnings: [],            // warn-mode findings from pre, appended to the tool result
      toolsSince: 0,           // tool calls this turn — "did any work happen"
      activeTools: 0,
      retryUntil: 0,
      failures: '',            // fingerprint of the last resume reason
    };
    sessions.set(id, state);
  }
  return state;
}

export function dropSession(id) {
  sessions.delete(id);
}

export function clearAll() {
  sessions.clear();
}

/**
 * Fingerprint of a resume reason. Only the parts that change on their own
 * between identical runs are masked: the gate's attempt stamp ("attempt 2/3")
 * and the test runners' timings, which the failing-test output carries. Without
 * that, the same failure looks new every round and the same-complaint cap can
 * never bind. Nothing else is masked — two violations of one rule at different
 * lines are two different complaints, and collapsing those would end a
 * legitimate run early.
 */
export function fingerprint(reason) {
  return String(reason ?? '')
    .replace(/attempt \d+\s*\/\s*\d+/gi, 'attempt #')
    .replace(/duration_ms[:=]\s*[\d.]+/gi, 'duration_ms #')
    .replace(/\bduration\s+[\d.]+\s*m?s\b/gi, 'duration #')
    .replace(/\b\d+(?:\.\d+)?\s*ms\b/gi, '# ms')
    .trim();
}

/**
 * Progress means the reason to resume CHANGED — not that the model was busy.
 * Counting tool calls or output tokens as progress makes the cap unreachable:
 * every resumed turn does something.
 */
export function madeProgress(state, reason) {
  const print = fingerprint(reason);
  return Boolean(print) && print !== state.failures;
}

export function todosOpen(todos) {
  return (todos ?? []).some((t) => t && (t.status === 'pending' || t.status === 'in_progress'));
}
