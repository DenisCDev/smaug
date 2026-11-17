---
id: observability
reviewed_at: 2026-10-02
coverage: "GlitchTip 6.2.6; Sentry JS 10/11 boundary; OTel SDK/Collector independently versioned"
---

# Telemetry: verify the signal, protocol and consumer

- Keep working error tracking. Add traces/metrics/logs to answer an operational
  question, with an explicit volume/retention budget. A Collector is optional;
  introduce it for routing, central redaction or delivery needs, not as a
  prerequisite for a small VPS. Preserve application capacity during outages.
- GlitchTip 6.2 introduced OTLP HTTP logs at `/v1/logs`; 6.2.6 routes/parser
  confirm JSON/protobuf. This does not prove native OTLP traces/metrics support.
  Sentry error/performance ingestion is another contract. The generic logs page
  contradicted this release at review: resolve conflicts with the effective tag
  and actual ingestion/query proof. [6.2 release](https://glitchtip.com/blog/2026-06-22-glitchtip-6-2-released/),
  [6.2.6 routes](https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/glitchtip/urls.py),
  [parser](https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/apps/event_ingest/otlp.py),
  [performance](https://glitchtip.com/documentation/performance/).
- UI URL, DSN, OTLP endpoint and administrative token are different. GlitchTip
  6.2.6 accepts ingest authentication including Bearer with the DSN public key;
  do not substitute an admin token or expose it in a bundle. HTTP acceptance is
  not proof of processing, query or alerts. Match sourcemaps/release to the built
  artifact. [Authentication](https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/apps/event_ingest/authentication.py),
  [ingestion](https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/apps/event_ingest/otlp_views.py),
  [CLI/sourcemaps](https://glitchtip.com/documentation/cli/).
- Resolve API, SDK, instrumentations, exporters and Collector separately.
  For example, `sdk-node@0.217.0` declares stable components 2.7.1 and API
  `>=1.3.0 <1.10.0`; do not align every package to one number. Check overrides
  against the resolved tree and integration. [Exact manifest](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/experimental/v0.217.0/experimental/packages/opentelemetry-sdk-node/package.json).
- Initialize before instrumented imports and identify the provider/context owner.
  Check compiled ESM/CJS and production command, not TypeScript syntax; OTel's
  documented ESM instrumentation requires its loader hook. Node/Bun recipes differ.
  Avoid overlapping SDK bootstraps and duplicate error/span capture.
  [Node SDK](https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html),
  [ESM setup](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/main/doc/esm-support.md).
- Sentry JS 11 changes provider ownership, span delivery and data collection.
  It replaces `sendDefaultPii` with more permissive `dataCollection` defaults
  and requires `--import` rather than `--require` preload even in CJS. Do not
  apply v11 to a v10 setup or assume GlitchTip compatibility from Sentry's
  compatibility claims. Verify the selected combination before upgrading.
  [11 migration](https://raw.githubusercontent.com/getsentry/sentry-javascript/11.0.0/MIGRATION.md).

## Data, context and delivery bounds

- Minimize before first export: exclude tokens, cookies, authorization, secret
  payloads and sensitive query parameters. Collector/server redaction is a
  second boundary. Hashing predictable identifiers is not guaranteed anonymity.
  [Sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/).
- Metrics need bounded dimensions such as route templates/method/result class,
  not arbitrary user/request/job IDs or concrete URL paths. Head sampling does
  not preserve every errored trace. Select a supported sampler and trust policy;
  tail sampling adds state/resource costs and cannot recover already dropped
  spans. [HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/),
  [sampling](https://opentelemetry.io/docs/concepts/sampling/).
- Trace headers/baggage are untrusted metadata, never tenant authorization.
  Baggage may reach third parties. Isolate per-request/job context and propagate
  bounded metadata; use span links where batching requires them. Do not leave
  an HTTP span open for a durable job's lifetime. [Baggage](https://opentelemetry.io/docs/concepts/signals/baggage/),
  [messaging](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/).
- If a Collector is needed, validate its version/distribution and active pipeline.
  Place memory limiting early, then appropriate filters/transforms and batching.
  `send_batch_size` triggers sending; `send_batch_max_size` is the cap. Bound
  export queues, concurrency, retries and timeouts; observe refusals/drops. WAL
  does not eliminate disk failure/fullness or retry-limit loss. [Memory limiter](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md),
  [batch](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/batchprocessor/README.md),
  [resiliency](https://opentelemetry.io/docs/collector/resiliency/).
- Collector server defaults became localhost in 0.110.0; bind intentionally for
  inter-container traffic without incidental public ports. During shutdown,
  drain work and await bounded SDK flush/close before container grace expires.
  Telemetry unavailability must not create unbounded application waiting.
  [Collector security](https://opentelemetry.io/docs/security/config-best-practices/).

## GlitchTip on the VPS

Current install docs require PostgreSQL 14+ and allow optional Valkey/Redis 7+;
`VALKEY_URL=""` uses PostgreSQL for tasks/cache/sessions. Select the mode supported
by the effective version; a component's memory estimate is not the VPS budget.
Read migrations even for patch releases: 6.2.5 discards uptime history and changes
schema; 6.2.6 changes ingest concurrency. Check custom images, restore backup and
schema-compatible rollout instead of assuming any minor update is harmless.
[Install](https://glitchtip.com/documentation/install/),
[6.2.6 changelog](https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/CHANGELOG).

Verify a synthetic event once in the correct project/release, queryability,
secret redaction, cross-request isolation and alerts when required. Exercise
backend outage and SIGTERM with bounded memory/queues/drain; one successful
signal does not certify another signal or protocol.
