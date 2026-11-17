---
paths:
  - "**/*.go"
  - "**/*.rs"
  - "**/*.py"
---

<!-- A rule earns its line only after a run proved its absence costly. -->

# Production survival and leverage

JS/TS are covered by the two global bullets in CLAUDE.md (deadline; bound I/O
before tuning numbers). This file is not globbed onto `*.ts`/`*.tsx` on
purpose: those files already share a 2–3 rule teach budget with nextjs,
testing, ux-flows and ui-ptbr (when installed), and a fourth rule on the first write defers
the one the file actually needed.

Feature-complete is not production-ready. Tests passing does not mean the
process survives a slow peer, a full pool, or a retry storm. These rules are
about containing failure and picking the intervention that actually moves
the system — not about a framework, a cloud, or one repo.

## Deadlines contain the crack

- Integration points (HTTP, DB, queue, mail, subprocess) fail. Every one of
  them hangs unless it has a deadline. A slow hang is worse than a fast error:
  the process looks up while every thread waits.
- Do not add retries, fallbacks, or a larger pool on a call that has no
  timeout. Retry without a bound is a load amplifier: the dependency is down,
  and now you are the DDoS.
- Returning a connection, cursor, or lock in `finally` / equivalent is part of
  the deadline. A path that can skip the release drains the pool and takes
  the next callers with it.

## Leverage — push the right place

People reach first for a number (cache size, pool size, timeout shaved by
50ms, one more replica). Those are the weakest interventions: they rarely
change *behavior*. Prefer, in this order:

1. A **bound** (timeout, max rows, max concurrency, max retries with a cap).
2. A **balancing loop** (fail fast, shed load, backpressure) so the system
   corrects instead of waiting forever.
3. **Information** that was missing (the slow call is visible; the error
   reaches the caller; the queue depth is observable).
4. Only then the number.

A micro-optimization in a hot loop is real when you have measured that loop.
It is not a substitute for a missing deadline on the call next to it.

## Delays and "make it faster"

- Shortening a delay (faster retry, tighter timeout, more parallelism) without
  looking at the loop can *amplify* oscillation: the system overshoots, then
  stampedes.
- Lengthening a buffer (bigger pool, unbounded queue) hides a leak until the
  buffer is the outage.
- Before changing performance, watch how the system already behaves: where it
  waits, where it retries, where the queue grows. Optimizing a part against
  the whole (one endpoint's p99 vs process availability) is a miss.

## What this is not

- Not a requirement to add a circuit-breaker library, a mesh, or chaos tests.
  A deadline and a bound are the default; extra machinery only when the call
  is known to fail in bursts and a timeout is not enough.
- Not a ban on retries. Retries are fine with a deadline, a cap, and backoff.
- Not stack-specific: the same crack is a `fetch` without a timeout, a gRPC
  call with no context deadline, a query with no `LIMIT` on a request path,
  or a worker that waits forever on a lock.
