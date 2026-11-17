// Logging that can never take the session down. OpenCode swallows errors thrown
// from the `event` hook (`void hook.event(...)`), so an unguarded failure here
// would be invisible; and a client call itself can reject.
async function deliver(operation) {
  let timer;
  try {
    // A disconnected TUI must not prevent the idle decision from completing.
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, 1000); });
    await Promise.race([operation(), deadline]);
  } catch { /* smugan-ignore empty-catch: notifications and logging are best-effort */ }
  finally { clearTimeout(timer); }
}

export function makeLog(client) {
  return {
    async info(message, extra) {
      await deliver(() => client?.app?.log?.({ body: { service: 'smugan', level: 'info', message, extra } }));
    },
    async error(message, extra) {
      await deliver(() => client?.app?.log?.({ body: { service: 'smugan', level: 'error', message, extra } }));
    },
    async toast(message, variant = 'warning') {
      await deliver(() => client?.tui?.showToast?.({ body: { message, variant } }));
    },
  };
}
