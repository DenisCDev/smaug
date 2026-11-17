---
id: nextjs
reviewed_at: 2026-10-02
coverage: "Next 15.x and 16.x; router, minor and cache configuration must match"
---

# Next: select the rendering and cache contract

- Confirm Next/React versions, App versus Pages Router and `cacheComponents`
  configuration. Read installed docs in `node_modules/next/dist/docs/` when
  present (bundled since 16.2). A computed config is unknown until evidenced;
  do not evaluate it merely for inventory. [Official local-doc guidance](https://nextjs.org/docs/app/guides/ai-agents).
- Next 15 introduced async request APIs; await on the server and unwrap promise
  props with React `use` in synchronous Client Components where supported.
  Next 16 removes sync compatibility. Next 15 changed default caching for fetch and GET handlers;
  that does not mean every route/cache layer is disabled. In 16,
  `cacheComponents: true` opts into a distinct model with `use cache`, cache
  profiles and Suspense. With it off, follow the existing rendering/cache model;
  do not enable it as an incidental fix. [15 migration](https://nextjs.org/docs/app/guides/upgrading/version-15),
  [16 migration](https://nextjs.org/docs/app/guides/upgrading/version-16),
  [cache models](https://nextjs.org/docs/app/getting-started/caching).
- In 16, select `revalidateTag(tag, profile)` for the intended freshness;
  `updateTag` provides read-your-writes in Server Actions. Check which route/tag
  or client cache actually exists rather than appending meaningless invalidation.
  Proxy, lint and bundler changes also belong to the version's migration, not
  an automatic rewrite of an unrelated feature. [16 migration](https://nextjs.org/docs/app/guides/upgrading/version-16).
- Keep browser behavior in small Client boundaries. A Server Component may
  render a Server element and pass it as `children`/a slot to a Client Component.
  This differs from passing an arbitrary function or importing server code into
  the client module graph. Follow React's serialization contract, including
  supported Server Function references. [Composition](https://nextjs.org/docs/app/getting-started/server-and-client-components#interleaving-server-and-client-components).
- Validate and authorize every mutation and resource access on the server.
  Choose Actions for app UI mutations where appropriate; Route Handlers remain
  valid HTTP boundaries. Private responses/session refresh must not enter shared
  caches. Read [supabase-postgres](supabase-postgres.md) for Supabase cookies and
  [docker-vps](docker-vps.md) for standalone assets, streaming and replicas.

Verify the affected route's initial HTML, loading/error states, authenticated
mutation and visible persisted result. Test cross-user cache isolation when
personalized data changes. A dev server does not prove the production artifact.
