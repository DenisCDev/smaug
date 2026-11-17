// Shared test scaffolding. The plugin is a plain ESM module, so the tests load
// the real thing and drive its hooks with a fake client — while the gate runs
// for real, in the child process it always uses.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SMUGAN = resolve(ROOT, '..', '..');
export const GATE = join(SMUGAN, 'packages', 'gate');
// import() needs a file:// URL: a bare Windows path is read as the "d:" scheme.
export const PLUGIN = pathToFileURL(join(ROOT, 'opencode', 'plugin', 'smugan.js')).href;

export function fakeClient({ session = { id: 'ses_test' }, messages = [] } = {}) {
  const calls = { prompts: [], logs: [], toasts: [], aborts: [] };
  return {
    calls,
    session: {
      get: async () => ({ data: session }),
      messages: async () => ({ data: messages }),
      promptAsync: async (req) => { calls.prompts.push(req); },
      abort: async (req) => { calls.aborts.push(req); },
    },
    app: { log: async (req) => { calls.logs.push(req); } },
    tui: { showToast: async (req) => { calls.toasts.push(req); } },
  };
}

/** A throwaway project with a smugan config, outside any git repo. */
export function makeProject(config = '{}') {
  const dir = mkdtempSync(join(tmpdir(), 'smugan-oc-proj-'));
  writeFileSync(join(dir, 'smugan.config.json'), config);
  mkdirSync(join(dir, 'src'), { recursive: true });
  return dir;
}

export const idle = (sessionID) => ({ type: 'session.idle', properties: { sessionID } });

export const assistantMessage = (sessionID, info = {}) => ({
  type: 'message.updated',
  properties: {
    info: {
      id: info.id ?? 'msg_1',
      sessionID,
      role: 'assistant',
      finish: 'stop',
      modelID: 'deepseek-v4-flash-free',
      providerID: 'opencode',
      mode: 'build',
      ...info,
    },
  },
});
