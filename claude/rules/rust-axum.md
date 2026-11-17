---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
---

# Rust / Axum

The Axum sections apply when `axum` is in `Cargo.toml` — confirm there first.
The general Rust rules apply to any `.rs` file.

## Version first — never assume

- Resolve the package-specific Cargo dependencies/features and toolchain with `smugan context --json <target-path>` plus relevant artifacts. Lock resolution is not a runtime observation. Documentation reviewed 2026-10-02 for Axum 0.7/0.8 (0.8.9 docs); any uncovered version/configuration needs matching evidence. Read `~/.claude/skills/smugan-build/references/rust-axum.md` for Tokio/SQLx integration and official sources.

## Per-version deltas

**Axum 0.8** (jan/2025 →):
- Path syntax is `/{param}` and `/{*rest}`. The 0.7 forms `/:param` and `/*rest` PANIC at router construction on 0.8 — this is the first thing to check when porting snippets from memory or old posts.
- Custom extractors implement `FromRequestParts`/`FromRequest` WITHOUT `#[async_trait]` (native async traits).
- `Option<T>` as extractor requires `T: OptionalFromRequestParts` — a rejection is no longer silently swallowed into `None`. If you meant "ignore failures", say so explicitly with `Result<T, T::Rejection>`.

**Axum 0.7**:
- Path syntax `/:param` / `/*rest`; custom extractors still need `#[async_trait]`; `Option<T>` swallows rejections. Do not "fix" these forward unless the upgrade is the task.

## Handlers & state

- Extractor order in handler signatures: consuming-the-body extractors (`Json`, `Form`, `Bytes`, `String`) come LAST — at most one, since the body is consumed once. `Path`/`State`/`Query`/headers first.
- Shared app state via `State<AppState>` with appropriate Clone/Arc ownership; sub-state via `FromRef`. Prefer its compile-time state contract when it fits; missing `Extension` values are a runtime rejection. Keep request-specific mutable state isolated.
- Validate external input at the boundary: derive `Deserialize` narrowly (unknown fields rejected where the contract demands it) and validate semantic rules before touching anything — the same boundary law as zod on TypeScript projects.

## Errors

- One error enum per app/crate implementing `IntoResponse`, mapping each variant to status + safe body. Handlers return `Result<_, AppError>` — never `.unwrap()`/`.expect()` on request-path code; a panic in a handler is a 500 with a stack trace in the logs and nothing actionable for the client.
- `?` everything internal into the error enum via `From` (`thiserror` when the crate already uses it). Swallowing an error into a default value needs a written reason on the same line.
- Never leak internals in error bodies (SQL, paths, connection strings). Log the cause server-side with the project's logger (`tracing` when present); return the sanitized message.

## Async discipline

- No blocking calls in handlers (`std::fs`, `reqwest::blocking`, heavy CPU): use `tokio::fs`, async clients, or `spawn_blocking`. One blocked worker thread stalls every request sharing it.
- Long-running work needs an explicit response/lifecycle contract. Critical work that must survive response/crash/deploy requires durable intent/jobs and idempotency; a detached task alone is insufficient. Bound concurrency and cancellation, including blocking work that cannot be aborted once started.
- Middleware as `tower` layers: prefer those already in `Cargo.toml` (`tower-http`'s `TraceLayer`, `TimeoutLayer`, `CorsLayer` when present) over hand-rolled ones; adding `tower-http` is a new dependency.
