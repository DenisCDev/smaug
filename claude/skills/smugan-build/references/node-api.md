---
id: node-api
reviewed_at: 2026-10-02
coverage: "Supported Node runtime; Express 4/5, Nest 11/12 migration boundaries, Hono 4"
---

# APIs: runtime and adapter before framework recipes

- Resolve the executing runtime, ESM/CJS build, framework and HTTP adapter.
  Node support status changes independently of npm compatibility: review the
  support table for upgrade decisions. Bun and Workers require their own runtime
  evidence, even when an API resembles Node. [Node releases](https://nodejs.org/en/about/previous-releases).
- Express 5 forwards rejections from returned handler promises; Express 4 needs
  compatible explicit forwarding. Neither makes a detached promise safe. Match
  route syntax/query parsing to the major. Configure `trust proxy` from the real
  proxy chain, not arbitrary forwarded headers. [Express 5 migration](https://expressjs.com/en/guide/migrating-5/),
  [proxy trust](https://expressjs.com/en/guide/behind-proxies/).
- For Nest, resolve core/common/platform together and inspect Express/Fastify.
  The current migration URL may describe a newer major: the 11 guide covers
  Node >=20, Express 5/Fastify 5, route/query and Keyv cache changes; the general
  guide now describes 12. Do not silently upgrade. Preserve the project's Zod
  boundary contract through a compatible pipe; TypeScript DTOs alone do not
  validate and two divergent schemas add risk. [Nest 11](https://docs.nestjs.com/v11/migration-guide),
  [current migration](https://docs.nestjs.com/migration-guide),
  [validation](https://docs.nestjs.com/v11/techniques/validation).
- Keep request/tenant mutable state out of shared Nest singletons. Request scope
  has a cost and propagates through dependencies; use it where the lifecycle
  requires it. Guards must cover the real transport/resource, including hybrid
  apps; a global HTTP guard does not establish every transport's coverage.
  [Scopes](https://docs.nestjs.com/fundamentals/injection-scopes),
  [guards](https://docs.nestjs.com/guards).
- Hono 4: compose sub-app routes and preserve RPC inference when exporting a
  chained route type. `createHandlers()` is supported when separating handlers
  helps. Validate boundaries with the project's compatible Zod integration,
  consume validated values and scope middleware deliberately. `hc` is useful
  for a shared typed API, not mandatory for every consumer/protocol.
  [Hono practices](https://hono.dev/docs/guides/best-practices),
  [RPC](https://hono.dev/docs/guides/rpc).
- Hono `app.request()` tests routing/middleware without a socket; it cannot prove
  Node/Bun/Workers adapter streaming, abort or payload behavior. Separate runtime
  startup where it enables these tests. [Node adapter](https://hono.dev/docs/getting-started/nodejs).

Apply [concurrency](concurrency.md) for work bounds, durable jobs and Redis;
[supabase-postgres](supabase-postgres.md) for sessions/pools;
[observability](observability.md) for preload and trace context. Verify denied
authorization, invalid input and async failure through the real HTTP boundary;
exercise the production adapter when transport behavior matters. Shutdown stops
admission, drains with a deadline, then closes resources. Nest hooks must be
enabled for signals; request-scoped providers do not receive them, and
`app.close()` does not terminate remaining jobs/timers. [Lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events).
