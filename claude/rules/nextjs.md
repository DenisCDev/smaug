---
paths:
  - "**/app/**/*.{ts,tsx}"
  - "**/next.config.*"
  - "**/middleware.ts"
  - "**/proxy.ts"
---

# Next.js (App Router)

Apply only to a package that uses Next; matching `app/` or TSX alone is not
evidence. Pages Router needs its own version-matched contract. For conditional
guidance and integrations read `~/.claude/skills/smugan-build/references/nextjs.md`.

## Version first — never assume

- Resolve the target package with `smugan context --json <target-path>`. Manifest ranges, lockfile resolution, installed metadata and runtime evidence are different; report unknowns. Confirm router and `cacheComponents` configuration before choosing a cache model.
- Documentation reviewed 2026-10-02 for Next 15/16. Read compatible official docs for any uncovered version/configuration, older or newer. On 16.2+, prefer the version-matched docs in `node_modules/next/dist/docs/` when available. [Official guidance](https://nextjs.org/docs/app/guides/ai-agents).

## Per-version deltas — what changes how you write code

**Next.js 16.x**:
- `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` have async contracts; sync compatibility was removed. Await on the server; synchronous Client Components unwrap promise props with the supported React `use` pattern rather than becoming async components. Use the installed Next type-generation command for `PageProps`, `LayoutProps` and `RouteContext`.
- Cache Components is an opt-in model selected by `cacheComponents: true`, with `'use cache'`, `cacheLife`/`cacheTag` and Suspense boundaries. With it disabled, apply the existing rendering/cache model. Do not assume every Next 16 response is uncached, enable this flag incidentally or remove route settings without confirming the active model. [Cache models](https://nextjs.org/docs/app/getting-started/caching).
- `revalidateTag(tag)` single-arg is deprecated: pass a profile — `revalidateTag('posts', 'max')`. For read-your-writes in Server Actions use `updateTag(tag)`; to refresh the client router from an action, `refresh()`.
- `middleware.ts` is deprecated → `proxy.ts` with exported `proxy()`, Node.js runtime only (no edge). Config flags renamed (`skipProxyUrlNormalize`).
- Turbopack is the default for dev AND build; a custom `webpack` config fails the build (migrate it, or opt out with `--webpack`). `next lint` was removed — run ESLint/Biome directly; `next build` no longer lints.
- Parallel route slots REQUIRE `default.js` — the build fails without them.
- `next/image` defaults hardened: `minimumCacheTTL` 4h, `qualities` `[75]`, local images with query string need `images.localPatterns.search`, redirects capped at 3, `images.domains` deprecated → `remotePatterns`.

Source for these migration deltas: [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16). Check the installed minor before applying a delta.

**Next.js 15.x**:
- Async request APIs introduced WITH a sync-compat shim: awaiting is correct, sync access warns. Write the awaited form so the 16 upgrade is a no-op; the codemod is `next-async-request-api`.
- `fetch` responses and GET Route Handlers are no longer cached by default; client page-segment cache defaults also changed, while layouts and back/forward behavior have their own contract. Opt in deliberately and inspect all relevant layers rather than declaring the route uncached.
- Experimental PPR/configuration is not the v16 Cache Components contract. Match the selected release/channel instead of mixing recipes. [Next 15 migration](https://nextjs.org/docs/app/guides/upgrading/version-15).

**Next.js 14.x**:
- Consult the versioned 14 docs: request APIs and cache defaults differ from 15/16. Dynamic APIs and route configuration affect caching; do not mechanically invert every option. [Next 14 caching](https://nextjs.org/docs/14/app/building-your-application/caching).

## Components

- Server Component by default. Add `"use client"` ONLY when the file needs event handlers, hooks, or browser APIs — and push the directive to the smallest leaf possible.
- Server-rendered elements may be passed to Client Components as `children` or slots. Arbitrary functions/component constructors are not ordinary serializable props; supported Server Function references have their own contract. Do not import server-only modules into the client graph. [Supported composition](https://nextjs.org/docs/app/getting-started/server-and-client-components#interleaving-server-and-client-components).
- One component = one responsibility. Name by function, not by looks: `SubmitButton`, not `BlueButton`.
- Follow the existing naming convention; for a new project, components PascalCase and routes, folders and non-component files kebab-case.
- Follow the existing folder layout; for a new project, folder-by-feature (`features/patients/patient-form.tsx`), not folder-by-type (`components/forms/`).

## Data

- Fetch data on the server (Server Components or route loaders). Client-side fetching only for truly dynamic, post-interaction data.
- Prefer Server Actions for app UI mutations when they fit; Route Handlers are valid HTTP boundaries for APIs, webhooks and other consumers. Choose the contract the feature needs.
- Every Server Action validates input with the project's schema validator (zod when installed) and authorizes the operation/resource before effects. Return typed expected failures; do not expose raw internal errors across the boundary.
- Never fetch in `useEffect` what the server could have rendered.
- Parallelize small bounded independent I/O when appropriate; large batches need concurrency limits before work starts. `Promise.all` does not cancel siblings on failure. Avoid unnecessary N+1 queries using supported joins/batching without removing authorization or limits.

## Cache & revalidation

- After mutation, update/invalidate the affected caches that actually exist using the installed version's API and required freshness. Verify the visible persisted result; blindly adding revalidation to uncached data is not proof.
- Wrap dynamic parts in `<Suspense>` so the static shell streams; a slow await without a boundary blocks the whole route.
- Client caches obey the same law: a React Query/SWR mutation invalidates its affected keys in the same change, never "later".

## UX boundaries

- Every route segment with async data gets `loading.tsx` (or Suspense) and `error.tsx`.
- Use the Metadata API (`generateMetadata` / `metadata` export) on every page. No hand-written `<head>` tags.
- Images via `next/image`, never `<img>`. Fonts via `next/font`, never `<link>` to Google Fonts.

## Discipline

- No `dangerouslySetInnerHTML` without sanitization and a written reason.
- Respect `exhaustive-deps`; never silence it — restructure instead.
- Redirects and notFound via `redirect()` / `notFound()`, not manual response hacking.
