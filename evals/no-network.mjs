// @ts-check
// Preloaded into the agent's own test run (NODE_OPTIONS=--import) in the A/B
// tasks: every outgoing connection is recorded and refused, so a test that
// calls a real model shows up as a count instead of a bill.
import { appendFileSync } from 'node:fs';
import net from 'node:net';

const log = process.env.SMUGAN_EVAL_NET_LOG;

/** @param {string} what */
function refuse(what) {
  if (log) appendFileSync(log, what + '\n');
  return new Error('smugan evals: rede desligada nos testes desta tarefa');
}

globalThis.fetch = async (/** @type {string | URL | Request} */ input) => {
  throw refuse('fetch ' + (input instanceof Request ? input.url : String(input)));
};

// any: Socket#connect is overloaded, and the patch forwards whatever it got.
/** @type {any} */
const socket = net.Socket.prototype;
const connect = socket.connect;
socket.connect = function (/** @type {unknown[]} */ ...args) {
  const target = args[0];
  // Local IPC (the test runner, a named pipe) is not the network.
  if (typeof target === 'string' || (target && typeof target === 'object' && 'path' in target)) return connect.apply(this, args);
  this.destroy(refuse('connect'));
  return this;
};
