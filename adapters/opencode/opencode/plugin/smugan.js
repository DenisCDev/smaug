// smugan — passive quality layer for OpenCode.
//
// IMPORTANT: this file must export exactly ONE value, and it must be a
// function. OpenCode's plugin loader iterates every export of the module and
// throws TypeError("Plugin export is not a function") on anything else — which
// takes down every plugin, not just this one. Helpers live in ../smugan/*.mjs,
// outside the plugins directory, where the loader never looks.
//
// What it does, mapped to the Claude Code hooks it replaces:
//   tool.execute.before  → PreToolUse: a violating write dies before it lands
//   tool.execute.after   → PostToolUse: project eslint/tsc and the matching
//                          stack rule ride back inside the tool result
//   session.idle         → Stop: the mechanical Definition of Done, which also
//                          resumes turns that ended unfinished (see idle.mjs)
import { loadConfig } from '../smugan/config.mjs';
import { normalize, runGate } from '../smugan/gate.mjs';
import { rulesFor } from '../smugan/rules.mjs';
import { AUTO_MARK, onIdle } from '../smugan/idle.mjs';
import { dropSession, forSession } from '../smugan/state.mjs';
import { makeLog } from '../smugan/log.mjs';

// `directory` is the session's folder: the one OpenCode reads a relative path from.
export const smugan = async ({ client, directory }) => {
  const cfg = loadConfig();
  const log = makeLog(client);

  return {
    // A violating write never reaches disk: the thrown message becomes the
    // tool's error, which is what the model reads and acts on.
    'tool.execute.before': async ({ tool, sessionID }, output) => {
      if (!cfg.gate.enabled) return;
      let calls;
      try {
        calls = await normalize(tool, output?.args, directory);
      } catch {
        return;
      }
      if (calls.length === 0) return;
      const state = forSession(sessionID);
      state.activeTools += 1;
      try {
        for (const call of calls) {
          const { exitCode, stderr, context } = await runGate('pre', { ...call, session_id: sessionID }, { timeoutMs: 30000 });
          if (exitCode === 2 && stderr) throw new Error(stderr);
          if (context) state.warnings.push(context);
        }
      } finally {
        state.activeTools = Math.max(0, state.activeTools - 1);
      }
    },

    // Whatever we append here is read by the model as part of the tool result —
    // the OpenCode equivalent of feeding stderr back from PostToolUse.
    'tool.execute.after': async ({ tool, sessionID, args }, output) => {
      let calls = [];
      try {
        calls = await normalize(tool, args, directory);
      } catch { /* smugan-ignore empty-catch: an unparseable call is simply not ours */ }
      const state = forSession(sessionID);
      state.toolsSince += 1;
      if (calls.length === 0) return;

      const extra = state.warnings.splice(0);
      for (const call of calls) {
        if (cfg.gate.enabled) {
          const { exitCode, stderr, context } = await runGate('post', { ...call, session_id: sessionID }, { timeoutMs: 120000 });
          if (exitCode === 2 && stderr) extra.push(stderr.trim());
          if (context) extra.push(context);
        }
        if (cfg.rules.enabled) {
          extra.push(...rulesFor(call.tool_input.file_path, state.surfaced, cfg.rules.maxPerInjection));
        }
      }
      if (extra.length > 0 && typeof output?.output === 'string') {
        output.output += '\n\n' + extra.join('\n\n');
      }
    },

    // The user speaking clears a previous abort and re-arms the resume budget;
    // our own resume must do neither, or the session cap would never bind.
    'chat.message': async ({ sessionID }, output) => {
      const state = forSession(sessionID);
      const text = (output?.parts ?? [])
        .filter((p) => p?.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n');
      if (text.includes(AUTO_MARK)) return;
      state.aborted = false;
      state.sameReason = 0;
      state.resumes = 0;
    },

    // Works around opencode issue #31042: the title agent is pinned to a
    // hardcoded free model and, once its quota trips, blocks the session's
    // thread for ~90s. Point it at a different model so it stops competing.
    // The runtime spreads this value into a real model record (reading .id,
    // .providerID, .api), so only a model the provider actually offers may be
    // handed over — anything invented would be truthy and would silently
    // disable OpenCode's own fallback.
    'experimental.provider.small_model': async (input, output) => {
      const pick = cfg.smallModel;
      if (typeof pick !== 'string' || !pick.includes('/')) return;
      const slash = pick.indexOf('/');
      const provider = input?.provider;
      if (!provider || provider.id !== pick.slice(0, slash)) return;
      const model = provider.models?.[pick.slice(slash + 1)];
      if (model) output.model = model;
    },

    event: async ({ event }) => {
      // Errors thrown here are swallowed by OpenCode (`void hook.event(...)`),
      // so nothing may escape: a silent failure would be undebuggable.
      try {
        const type = event?.type;
        const props = event?.properties ?? {};
        if (type === 'message.updated') {
          const info = props.info;
          if (info?.role !== 'assistant' || !info.sessionID) return;
          const state = forSession(info.sessionID);
          state.assistant = {
            id: info.id,
            finish: info.finish,
            error: info.error,
            modelID: info.modelID,
            providerID: info.providerID,
            mode: info.mode,
          };
          if (info.error?.name === 'MessageAbortedError') state.aborted = true;
          return;
        }
        if (type === 'message.part.updated') {
          const part = props.part;
          if (!part?.sessionID) return;
          forSession(part.sessionID).lastPart = { type: part.type, tool: part.tool };
          return;
        }
        if (type === 'todo.updated') {
          if (props.sessionID) forSession(props.sessionID).todos = props.todos ?? [];
          return;
        }
        if (type === 'session.status') {
          if (!props.sessionID) return;
          const state = forSession(props.sessionID);
          // While the runtime is backing off a rate limit it is not stalled —
          // resuming would only pile another request onto the same quota.
          state.retryUntil = props.status?.type === 'retry' ? Date.now() + 120000 : 0;
          return;
        }
        if (type === 'session.error') {
          if (props.error?.name === 'MessageAbortedError' && props.sessionID) {
            forSession(props.sessionID).aborted = true;
          }
          return;
        }
        if (type === 'session.deleted') {
          if (props.info?.id) dropSession(props.info.id);
          return;
        }
        if (type === 'session.idle') {
          const sessionID = props.sessionID;
          if (!sessionID) return;
          await onIdle({ sessionID, client, cfg, state: forSession(sessionID), log });
        }
      } catch (error) {
        await log.error('event handler failed', { message: String(error?.message ?? error) });
      }
    },
  };
};
