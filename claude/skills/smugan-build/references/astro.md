---
id: astro
reviewed_at: 2026-10-02
coverage: "Astro 4/5/6/7; integrations and adapter versions resolved separately"
---

# Astro: ship HTML first and hydrate the behavior

- Astro 4 has `output: 'hybrid'`; 5 folds that mode into `static` with an adapter
  for on-demand routes. Content loaders arrived in 5; live collections in 6.
  The 7 migration documents Vite 8, Rust compiler and stable route caching.
  Verify the exact minor/adapter before using these features; none is a reason
  for an incidental upgrade. [5 migration](https://docs.astro.build/en/guides/upgrade-to/v5/),
  [content API/version history](https://docs.astro.build/en/reference/modules/astro-content/),
  [7 migration](https://docs.astro.build/en/guides/upgrade-to/v7/).
- Public build-time content can stay prerendered. A static page can query an API
  or Supabase from a script/island with authorization enforced by the backend/RLS.
  This does not require an Astro server. Request-rendered private content,
  server islands or server Actions require the supported server/adapter contract.
  Do not add React or `output: 'server'` solely because authentication exists.
  [Rendering](https://docs.astro.build/en/guides/on-demand-rendering/),
  [client data](https://docs.astro.build/en/guides/data-fetching/).
- Choose `client:load` for immediately interactive controls; `idle`/`visible`
  when deferred interaction is acceptable. `client:only` omits SSR and needs a
  reason/fallback. Callbacks/render props stay inside their framework island;
  do not pass them as serialized props from Astro. [Directives](https://docs.astro.build/en/reference/directives-reference/),
  [framework components](https://docs.astro.build/en/guides/framework-components/).
- Use content schemas/loaders for repeated structured content, not every static
  paragraph. Define build-time versus per-request freshness. `astro:assets`
  helps when transformation is needed; `public/` assets are unprocessed and an
  already optimized external image may use `img`. Set dimensions and useful alt
  text. [Collections](https://v6.docs.astro.build/en/guides/content-collections/),
  [images](https://docs.astro.build/en/guides/images/).
- Actions are public endpoints: validate and authorize their resource/operation.
  Keep secrets out of `PUBLIC_` values and sanitize untrusted `set:html` input.
  For SSR, session clients/cookies belong to the request; personalized responses
  stay out of shared cache. [Actions](https://docs.astro.build/en/guides/actions/),
  [environment](https://docs.astro.build/en/guides/environment-variables/),
  [Supabase](https://docs.astro.build/en/guides/backend/supabase/).
- Static deploys need the configured output, correct base/site, assets and 404s;
  no persistent Node process is required. Node adapter standalone and middleware
  modes have different server/assets contracts. Read [docker-vps](docker-vps.md)
  only for that topology and [motion](motion.md) when changing navigation.
  [Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/).

Run the project's Astro-aware check (normally `astro check`) and build: `tsc`
alone does not check `.astro`, and build is not typecheck. Verify initial HTML,
the affected island/route, missing route and relevant failure in the built app.
[TypeScript checks](https://docs.astro.build/en/guides/typescript/).
