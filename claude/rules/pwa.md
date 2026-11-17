---
paths:
  - "**/manifest.{json,ts,webmanifest}"
  - "**/sw.{js,ts}"
  - "**/service-worker*.{js,ts}"
  - "**/serwist*"
  - "**/workbox*"
---

# PWA

## Manifest

- Complete `manifest.json` (or `manifest.ts`): `name`, `short_name`, `description` (in the UI language), `start_url`, `display: standalone`, `theme_color`, `background_color`, `icons`.
- Icons: at least 192x192 and 512x512, plus a `maskable` variant. iOS: `apple-touch-icon` 180x180.
- Link the manifest through the framework's head mechanism (the Metadata API when Next), not a hand-written tag where one exists.

## Service worker

- Explicit cache strategy per asset class — decide and write it down as comments in the SW:
  - Static assets (JS/CSS/fonts/icons): cache-first with versioned cache name.
  - Pages/HTML: network-first with cache fallback.
  - API data: network-only (or stale-while-revalidate ONLY when staleness is acceptable — say so).
- Bump the cache version on deploy; delete stale caches in `activate`.
- Never cache authenticated API responses or anything with personal data.

## Offline

- Provide an offline fallback page (in the UI language) and precache it.
- Anything writable offline needs an explicit sync/replay decision — no silent data loss.

## Acceptance

- Verify installability: manifest parses with the required fields and icons, service worker registered and controlling the page, served over HTTPS (or localhost), offline navigation returns the fallback. Check it in the browser DevTools Application panel.
- Test install + offline on a real device (or emulated mobile) before calling it done.
