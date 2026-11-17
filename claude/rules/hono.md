---
paths:
  - "**/src/**/routes/**"
  - "**/hono/**"
  - "**/*.hono.ts"
---

# Hono

Applies when `hono` is in `package.json` — confirm there before applying anything
below; the path globs are broad because Hono apps have no fixed layout.

## Version first — never assume

- Resolve the affected package with `smugan context --json <target-path>`, distinguishing declared/resolved/installed versions. Documentation reviewed 2026-10-02 for Hono 4: runtime and adapter versions are separate. Any uncovered version/configuration needs matching docs. Read `~/.claude/skills/smugan-build/references/node-api.md`; `src/index.ts` is as valid an entrypoint as a routes directory.

## Structure — the official anti-patterns are anti-patterns for a reason

- Compose related routes with sub-apps where useful and preserve path/param inference. Separate handlers are supported through `factory.createHandlers()` when that structure helps; do not add a controller layer merely by convention. [Official practices](https://hono.dev/docs/guides/best-practices).
- Separate the app from the runtime: the Hono app lives in a file that exports it (testable, importable); the entrypoint for Node/Bun/Workers/Lambda is a thin adapter importing it. Never bury `serve()` in the same file as the routes.
- Keep the chained form `app.get('/a', ...).post('/b', ...)` when the client uses RPC — the `AppType` export only carries routes the chain saw.

## Validation & types

- EVERY boundary validates with the project's Hono validator middleware (`@hono/zod-validator` when zod is installed: `zValidator('json' | 'query' | 'param' | 'header', schema)`). A handler reading `c.req.json()` without a validator is unvalidated external input — the same law as everywhere else in this config.
- Read validated data with `c.req.valid('json')`, never re-parse.
- Type the environment: `new Hono<{ Bindings: Env; Variables: Vars }>()`. Untyped `c.env` is `any` wearing a costume.
- When sharing a typed Hono RPC contract, export the chained route type and use `hc<AppType>(url)`. Other clients/protocols may use their appropriate HTTP contract; validate external responses at the boundary.

## Errors & middleware

- One `app.onError` at the root mapping known errors to responses; throw `HTTPException` from handlers, never return ad-hoc 500 JSON per route.
- Middleware order matters and is top-down: auth before handlers that need it, logging outermost. Scope middleware to the sub-app that needs it, not globally by reflex.
- `app.notFound` returns the API's standard error shape — the default text body is not an API response.

`app.request()` can verify routing, middleware and authorization, but transport
behavior (streaming, payload limits, abort and shutdown) needs the actual runtime
adapter. [Node adapter](https://hono.dev/docs/getting-started/nodejs).
