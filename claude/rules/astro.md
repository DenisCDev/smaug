---
paths:
  - "**/*.astro"
  - "**/astro.config.*"
---

# Astro

Confirm the affected package and versions with `smugan context --json <target-path>`
before choosing framework APIs. Documentation reviewed 2026-10-02 for Astro
4/5/6/7; integrations and adapters have their own compatibility. Read only the
relevant sections of `~/.claude/skills/smugan-build/references/astro.md`.

- Preserve static HTML when sufficient; hydrate only needed interaction. React
  islands do not turn the app into Next or require whole-page hydration.
- A static page can call an authorized API/Supabase from the browser. SSR,
  server islands and server Actions need their corresponding adapter/runtime;
  authentication alone does not require `output: 'server'`.
- Match content loaders, rendering configuration and route caching to version;
  `output: 'hybrid'` belongs to 4, not 5+. Never enable a newer feature by memory.
- Validate and authorize server operations; protect private session responses
  from shared caches and secrets from `PUBLIC_` output.
- Check `.astro` with the project's Astro-aware command, normally `astro check`,
  plus build and relevant integration behavior. `tsc`/build alone do not prove it.
- Navigation/motion must follow the chosen MPA/ClientRouter lifecycle and clean
  up page-owned resources. Read `~/.claude/skills/smugan-build/references/motion.md`
  only when touching those concerns.
