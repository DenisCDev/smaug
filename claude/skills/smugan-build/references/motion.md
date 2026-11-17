---
id: motion
reviewed_at: 2026-10-02
coverage: "GSAP 3 (matchMedia 3.11+); version-matched Motion; Anime 3/4; Astro/Next router and React peers"
---

# Motion owns a lifecycle, not just an effect

- Use CSS/WAAPI for states they express clearly. GSAP suits coordinated timelines,
  scroll and SVG sequences; Motion suits React layout/gesture/presence. Anime.js
  is a valid existing framework-independent choice. Avoid a second engine for
  behavior the current one already handles. One element/property has one active
  animation owner; do not let engines compete for its transform.
- GSAP: scope timelines/ScrollTriggers to the feature and revert on teardown.
  In React, use supported `useGSAP`/`contextSafe` for delayed handlers; manually
  added listeners still need removal. `matchMedia` (3.11+) helps responsive and
  reduced-motion variants. Never globally kill another feature's triggers.
  [React](https://gsap.com/resources/React/),
  [matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/).
- Motion: use `MotionConfig reducedMotion="user"`/`useReducedMotion` where
  appropriate; `useAnimate` provides scope/cleanup. Choose LazyMotion/features
  from measured bundle needs. Motion JS can serve Astro without React.
  Anime 4's imports/scope/revert are not Anime 3's API. [Motion accessibility](https://motion.dev/docs/react-accessibility),
  [useAnimate](https://motion.dev/docs/react-use-animate),
  [JS](https://motion.dev/docs/quick-start), [Anime scopes](https://animejs.com/documentation/scope/).
- Astro: native cross-document transitions preserve MPA navigation. Choose
  `ClientRouter` explicitly for persistence/control; initialize on appropriate
  lifecycle events such as `astro:page-load` and clean page-owned resources before
  swap. Its reduced-motion behavior does not automatically fix custom GSAP/Three
  effects. Do not stack Barba or another router without a concrete need.
  [Astro transitions](https://docs.astro.build/en/guides/view-transitions/).
- React 19.3 stabilizes `ViewTransition`; earlier versions need their own evidence.
  Current Next 16.3.8 docs show App Router usage without an extra flag; do not
  copy a canary/experimental recipe into older Next/React, or assume Pages Router
  has the same contract. Never freeze the router or retain stale route trees to
  simulate support. [React 19.3](https://react.dev/blog/2026/09/09/react-19-3),
  [Next transitions](https://nextjs.org/docs/app/guides/view-transitions).

Verify repeated navigation/back/forward, interruption, deep links/hashes,
scroll/focus/title, network failure and reduced motion. Content must remain
visible and controls usable without animation/browser support. Do not delay
every action solely to display an effect or promise frame rates without measuring.
[Performance](https://motion.dev/docs/performance).

GSAP is commercially usable under its own license, not MIT. Motion/Anime core
are MIT; paid extras/templates have separate terms. Check the artifact and use.
[GSAP license](https://gsap.com/community/standard-license/),
[Motion license](https://raw.githubusercontent.com/motiondivision/motion/main/LICENSE.md),
[Anime license](https://raw.githubusercontent.com/juliangarnier/anime/master/LICENSE.md).
