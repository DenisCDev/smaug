---
paths:
  - "**/vercel.json"
  - "**/next.config.*"
  - "**/.env.example"
  - "**/.env.local"
---

# Vercel

## Environments

- Env vars set per environment (Development / Preview / Production) in the Vercel dashboard or `vercel env` — never a single value shared across all three when they differ (DB URLs, keys).
- When Next, `NEXT_PUBLIC_*` (or the framework's public prefix) is shipped to the browser: never a secret, never `service_role`.
- Local dev reads `.env.local`; keep `.env.example` in sync in the same commit.

## Runtime

- Choose the runtime consciously per route: Edge for light, latency-sensitive, no-Node-API work; Node for anything using Node built-ins, heavy compute, or long connections. State the choice (`export const runtime`) only when diverging from the default.
- Know the limits: Edge has no fs/net Node APIs; serverless functions have execution time limits — no long-running work in request handlers.

## Deploys

- Preview deploy per branch/PR is the review artifact: check it before merging.
- Production deploys from `main` only.

## Build

- Zero build warnings. A warning in the project's build (`next build` when Next) is a task, not noise.
- Never set `ignoreBuildErrors` or `ignoreDuringBuilds` to hide failures.
