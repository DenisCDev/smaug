---
id: rust-axum
reviewed_at: 2026-10-02
coverage: "Axum 0.7/0.8 (0.8.9 docs), Tokio 1 and SQLx 0.8"
---

# Rust service boundaries

- Match Cargo's package-specific resolution, features and Rust toolchain.
  Axum 0.8 uses `/{param}` and `/{*rest}`; old colon/star route syntax is a
  construction error. Extractor trait changes also differ from 0.7; do not
  forward-port syntax unless upgrading is the task. [Axum 0.8.9](https://docs.rs/axum/0.8.9/axum/),
  [0.8 release](https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0).
- Body-consuming extractors come last and consume the body once. Use typed app
  state and explicit error responses; validate semantic input before effects.
  Preserve ownership/error types instead of translating TypeScript/Zod patterns
  literally. Do not leak SQL, connection strings or internal paths in responses.
  [Extractors](https://docs.rs/axum/0.8.9/axum/extract/index.html),
  [error handling](https://docs.rs/axum/0.8.9/axum/error_handling/index.html).
- Bound spawned tasks and blocking work. `spawn_blocking` is not a cancellation
  guarantee once its work starts; use an appropriate limited pool and cooperative
  cancellation where needed. Dropping a handle is not durable background work.
  Critical work after the response needs persisted intent/job state and
  idempotency. [Tokio spawn_blocking](https://docs.rs/tokio/1.53.1/tokio/task/fn.spawn_blocking.html),
  [shutdown](https://tokio.rs/tokio/topics/shutdown).
- SQLx pools can be shared; transactions that must be atomic use the same
  transaction/connection. Match Postgres/pooler capabilities and account for
  pool size across workers/replicas. A timeout may end waiting without proving a
  remote side effect did not commit. [SQLx 0.8 transactions](https://docs.rs/sqlx/0.8.6/sqlx/struct.Transaction.html),
  [pool](https://docs.rs/sqlx/0.8.6/sqlx/struct.Pool.html).

Read [concurrency](concurrency.md) for invariants and
[docker-vps](docker-vps.md) for proxy/signals. Run the project's Cargo checks,
then route and database integration tests where the change crosses those
boundaries. Graceful shutdown must stop admission and bound draining; prove
invalid input, authorization, timeout and cleanup relevant to the feature.
