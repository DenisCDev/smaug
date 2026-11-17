import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLog } from '../opencode/smugan/log.mjs';

for (const method of ['info', 'error', 'toast']) {
  test(`${method} completes when the client stops responding`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let called = false;
    const send = () => {
      called = true;
      return new Promise(() => {});
    };
    const log = makeLog({ app: { log: send }, tui: { showToast: send } });
    const pending = log[method]('notification');
    assert.equal(called, true);
    t.mock.timers.tick(1000);
    await pending;
  });
}

test('a failed notification does not prevent later notifications', async () => {
  let calls = 0;
  const log = makeLog({ tui: { showToast: async () => {
    calls += 1;
    if (calls === 1) throw new Error('TUI unavailable');
  } } });
  await log.toast('first');
  await log.toast('second');
  assert.equal(calls, 2);
});

test('a rejection after the notification deadline remains handled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectRequest;
  const request = new Promise((resolve, reject) => { rejectRequest = reject; });
  const pending = makeLog({ tui: { showToast: () => request } }).toast('notification');
  t.mock.timers.tick(1000);
  await assert.doesNotReject(pending);
  rejectRequest(new Error('late notification failure'));
  await new Promise((resolve) => setImmediate(resolve));
});
