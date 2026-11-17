// End-of-turn decision: run the smugan Definition of Done and, when the turn
// left work unfinished, resume the session.
//
// OpenCode has no blocking stop hook (issue #16626), so the DoD cannot hold the
// turn open the way it does in Claude Code — it can only speak on the next one.
// That same mechanism is the fix for the free-tier "it just stops": the agent
// loop breaks when an OpenAI-compatible provider reports finish "stop" after a
// tool call (#14972), when output hits the 32K cap (#17471), or when a small
// model declares itself done with open todos (#27560). A resume that carries
// the actual failures ends itself once they are fixed; a blind "continue" does
// not, which is why this never sends one.
import { runGate } from './gate.mjs';
import { fingerprint, madeProgress, todosOpen } from './state.mjs';

export const AUTO_MARK = '<!-- smugan-auto -->';

/**
 * Why this turn should resume, or null to stay quiet. Pure — no I/O, so the
 * whole decision table is testable without a gate or a client.
 */
export function layerB(state) {
  const a = state.assistant;
  if (!a) return null;
  // A hard API error is not an unfinished turn; resuming only burns quota.
  if (a.error && a.error.data && a.error.data.isRetryable === false) return null;
  if (a.finish === 'length') {
    return 'Your previous message was cut off at the model output limit — it did not finish. Continue exactly where it stopped.';
  }
  if (state.lastPart?.type === 'tool' && a.finish && a.finish !== 'tool-calls') {
    const named = state.lastPart.tool ? '`' + state.lastPart.tool + '`' : 'a tool';
    return `The turn ended right after ${named} ran, with no closing message — the agent loop broke, the work is not finished. Continue from that tool's result.`;
  }
  if (todosOpen(state.todos) && state.toolsSince > 0) {
    const open = state.todos
      .filter((t) => t && (t.status === 'pending' || t.status === 'in_progress'))
      .map((t) => '  - ' + (t.content ?? t.title ?? '(untitled)'))
      .join('\n');
    return 'The turn ended with open todos:\n' + open + '\nFinish them, or say plainly why they cannot be finished.';
  }
  return null;
}

/**
 * Anti-loop gates, applied after deciding to resume and before firing.
 * `maxPerSession` is the one that guarantees termination: a rate limit spread
 * over time still means "forever", and this runs unattended on a free quota.
 * Only a message from the user clears it.
 */
export function allowResume(state, cfg, reason, now) {
  const { maxSameReason, maxPerSession, throttleMs } = cfg.continue;
  if (state.activeTools > 0) return { ok: false, code: 'busy', text: 'a tool is still running' };
  if (now - state.lastContinueAt < throttleMs) return { ok: false, code: 'throttled', text: 'minimum interval between resumes' };
  if (state.resumes >= maxPerSession) {
    return { ok: false, code: 'session cap', text: 'resume limit for this session reached — send me a message to continue' };
  }
  if (madeProgress(state, reason)) state.sameReason = 0;
  if (state.sameReason >= maxSameReason) {
    return {
      ok: false,
      code: 'same reason cap',
      text: 'the same pending item repeated ' + maxSameReason + ' times — send me a message to continue',
    };
  }
  return { ok: true };
}

/**
 * Runs on session.idle. Returns a short string describing what it did, for the
 * tests and the log; every failure path is swallowed by the caller's try/catch.
 */
export async function onIdle({ sessionID, client, cfg, state, log, now = Date.now() }) {
  if (!cfg.dod.enabled) return 'disabled';
  if (state.aborted) return 'aborted';
  if (state.assistant?.error?.name === 'MessageAbortedError') {
    state.aborted = true;
    return 'aborted';
  }
  if (state.retryUntil > now) return 'retrying';
  if (state.assistant && state.evaluated === state.assistant.id) return 'already evaluated';

  if (state.isChild === undefined) {
    try {
      const res = await client.session.get({ path: { id: sessionID } });
      const info = res?.data ?? res;
      state.isChild = Boolean(info?.parentID);
    } catch {
      state.isChild = false;
    }
  }
  if (state.isChild) return 'child session';

  state.evaluated = state.assistant?.id ?? state.evaluated;

  const { exitCode, stderr, context, timedOut } = await runGate('stop', { session_id: sessionID }, { timeoutMs: cfg.dod.timeoutMs });
  // The check above can run for minutes (typecheck + tests). The user may have
  // started a new turn and pressed ESC in the meantime — resurrecting a session
  // they just killed is the one thing this must never do.
  if (state.aborted) return 'aborted';
  if (timedOut) {
    // Cut at our own deadline before it answered: nothing was verified, and
    // that is not a green turn. The turn's files stay recorded for the next check.
    const seconds = Math.round(cfg.dod.timeoutMs / 1000);
    await log.toast(`smugan: the end-of-turn checks did not finish in ${seconds} s, so this turn was not verified. Run the checks yourself; if they need longer, raise dod.timeoutMs in smugan.opencode.json.`);
    await log.info('DoD timed out', { sessionID, timeoutMs: cfg.dod.timeoutMs });
    return 'timed out';
  }
  let reason = null;
  if (exitCode === 2 && stderr) {
    reason = stderr.trim();
  } else if (stderr && stderr.trim()) {
    if (/blocked attempts? spent|not re-blocking/.test(stderr)) {
      await log.toast('smugan: the Definition of Done is still red and the attempt limit was reached — see what is still broken.');
      await log.info('DoD gave up after the block cap', { sessionID, stderr });
      return 'cap reached';
    }
    await log.toast(stderr.trim().slice(0, 400));
    await log.info('DoD result is unverified', { sessionID, stderr });
    return 'unverified';
  } else {
    // Warn mode: the DoD failed but holds nothing; an unfinished turn still resumes.
    if (context) {
      await log.toast(context.slice(0, 400));
      await log.info('DoD failed in warn mode', { sessionID, context });
    }
    if (cfg.continue.layer === 'B') reason = layerB(state);
  }
  if (!reason) {
    state.sameReason = 0;
    return 'clean';
  }

  const gate = allowResume(state, cfg, reason, now);
  if (!gate.ok) {
    if (gate.code === 'session cap' || gate.code === 'same reason cap') {
      await log.toast('smugan: stopped resuming the session (' + gate.text + '). Still missing:\n' + reason.slice(0, 400));
    }
    await log.info('resume suppressed: ' + gate.code, { sessionID });
    return 'suppressed: ' + gate.code;
  }

  state.sameReason += 1;
  state.resumes += 1;
  state.lastContinueAt = now;
  state.failures = fingerprint(reason);
  state.toolsSince = 0;

  const text = AUTO_MARK + '\nsmugan — Definition of Done (resume ' +
    state.resumes + '/' + cfg.continue.maxPerSession + '):\n\n' + reason +
    '\n\nFix this and finish the task. Do not reply to this message with an explanation alone.';
  const body = { parts: [{ type: 'text', text }] };
  if (state.assistant?.providerID && state.assistant?.modelID) {
    body.model = { providerID: state.assistant.providerID, modelID: state.assistant.modelID };
  }
  if (state.assistant?.mode) body.agent = state.assistant.mode;

  // promptAsync returns immediately; the blocking prompt() would hang here,
  // since this runs inside a fire-and-forget event handler of the same process.
  const send = client.session.promptAsync ?? client.session.prompt;
  await send.call(client.session, { path: { id: sessionID }, body });
  await log.info('resumed session', { sessionID, resume: state.resumes });
  return 'resumed';
}
