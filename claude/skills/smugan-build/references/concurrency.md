---
id: concurrency
reviewed_at: 2026-10-02
coverage: "Node API availability; PostgreSQL 16/17/18; Redis 7/8 and version-matched clients/queues"
---

# Async work: bounded execution and explicit invariants

- Name what cannot happen: duplicate reservation, lost edit, negative balance,
  repeated charge or committed data without required delivery. An event loop,
  `await` or process-local mutex does not coordinate other connections/replicas.
- Bound variable-sized tasks before starting them. `Promise.all` suits a small
  bounded independent set; rejecting one promise does not cancel its siblings.
  Decide whether to cancel, drain or keep partial results, and handle every
  relevant failure. `Promise.race` with a timer only bounds waiting unless the
  underlying operation also supports cancellation. [Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all),
  [AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal).
- Match APIs to runtime: Node `AbortSignal.timeout` arrived in 16.14/17.3 and
  `any` in 18.17/20.3. Availability is not an endorsement of an unsupported
  runtime. Streams need backpressure and producer cleanup; CPU-heavy `async`
  work still blocks and may need a bounded worker pool. [Node globals](https://nodejs.org/api/globals.html),
  [streams](https://nodejs.org/api/stream.html), [workers](https://nodejs.org/api/worker_threads.html).
- Retry only suitable transient failures with a total deadline, attempt limit
  and jitter; account for retries in other layers. An unknown outcome after
  timeout may have committed. Critical post-response work needs durable intent
  and idempotent consumption, not a floating promise. Worker reconnection may
  intentionally persist while the process lives; HTTP producers should fail
  promptly. Do not blindly replace BullMQ Worker ioredis requirements such as
  `maxRetriesPerRequest: null` with request-client settings.
  [BullMQ production](https://docs.bullmq.io/guide/going-to-production).

## Decide integrity at the data boundary

- Prefer constraints, atomic conditional updates and checked affected-row counts
  over check-then-write. Optimistic revision predicates make lost edits explicit.
  Use a short same-connection transaction for indivisible changes; choose locks
  or isolation for the invariant, not SERIALIZABLE everywhere. Acquire locks in
  consistent order and bound waiting. [Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html),
  [isolation](https://www.postgresql.org/docs/18/transaction-iso.html),
  [locks](https://www.postgresql.org/docs/18/explicit-locking.html).
- For serialization failure, retry the whole transaction including decisions;
  do not blindly retry permanent uniqueness conflicts. Scope idempotency keys
  and check payload equivalence, in-flight state and unknown outcomes. Use an
  outbox only when post-commit delivery needs that guarantee; consumers still
  tolerate duplicates. A queue/lock does not promise exactly-once effects.
  [Transaction retries](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html),
  [outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html),
  [idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs).

## Redis: distinguish cache from necessary state

- Resolve server Redis/Valkey separately from the client. Define TTL, tenant
  scope, invalidation and failure behavior. Eviction policy is instance-wide:
  key prefixes do not protect queues/sessions. BullMQ requires `noeviction`;
  it may reject writes under pressure. Separate incompatible workloads when
  needed; size memory/persistence from their loss tolerance. RDB/AOF/replication
  differ, and `WAIT` does not make Redis strongly consistent or replace backup.
  [Eviction](https://redis.io/docs/latest/develop/reference/eviction/),
  [persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/),
  [replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/).
- Prefer existing atomic commands. Bounded Lua/Functions can coordinate multiple
  operations but block the server while running. Functions require Redis 7+.
  Pipelining batches network traffic, not atomicity. `MULTI/EXEC` lacks SQL-style
  rollback; isolate `WATCH`'s connection from concurrent flows. `SCAN` may repeat
  results and is not a snapshot; `COUNT` is a hint, not a strict work bound.
  [Programmability](https://redis.io/docs/latest/develop/programmability/),
  [transactions](https://redis.io/docs/latest/develop/using-commands/transactions/),
  [SCAN](https://redis.io/docs/latest/commands/scan/).
- A needed lease uses unique ownership, expiry and atomic compare-and-delete;
  Redis 8.4+ adds `DELEX ... IFEQ`, earlier versions need a supported alternative
  such as Lua. Never separate GET and DEL. An expired owner may resume writing;
  critical resources may require fencing enforced at that resource. Do not
  invent distributed locking just to avoid a database constraint.
  [Locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/),
  [DELEX](https://redis.io/docs/latest/commands/delex/).
- Keep Redis off public/browser networks and use appropriate ACL/TLS. Local
  rate limits do not aggregate across replicas; define behavior if shared state
  fails. Server licensing is versioned: <=7.2 BSD, 7.4 RSAL/SSPL, >=8.0 adds AGPL;
  a client's license does not establish the server's. [Security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/),
  [Nest rate limits](https://docs.nestjs.com/security/rate-limiting),
  [Redis licenses](https://redis.io/legal/licenses/).

Verify real overlap with barriers/distinct connections, not arbitrary sleeps
or `Promise.all` alone: contested final item, stale revision, lost response after
commit, worker crash before ack, expired owner, already-aborted signal or slow
consumer as relevant. Assert invariant/state, bounded work and cleanup.
