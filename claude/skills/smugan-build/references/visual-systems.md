---
id: visual-systems
reviewed_at: 2026-10-02
coverage: "Select the specific library, rendering mode, peers and browser target below"
---

# Visual direction before library selection

Preserve a working existing stack and its installed libraries. Only when the
user asks to choose the base of a new project: a React/Tailwind system may
evaluate coss ui/Base UI, Phosphor and Motion in one realistic screen; a landing
may evaluate Astro components and GSAP for coordinated sequences; Three only
when the experience benefits from 3D. These are examples to evaluate, not
endorsements; each one adopted is a new dependency.

Define typography, spacing/density, hierarchy, surfaces, color and motion intent
from the product. Obscurity and a library preset do not create an original
design. Frequent system actions should remain direct; expressive landing motion
can be substantial while content, controls and navigation remain usable.

Read only the needed reference:

- [Icons](icons.md): Lucide, Phosphor, Iconoir; exports, SSR and accessible controls.
- [Components](components.md): coss/Base UI, HeroUI and existing primitives;
  editable source, licenses, portals and focus.
- [Motion/navigation](motion.md): GSAP, Motion, Anime.js, Astro and Next transitions;
  lifecycle, interruption and reduced motion.
- [3D](three.md): Three, React Three Fiber/Drei and Babylon; peers, GPU fallback
  and resource ownership.

Verify a representative screen/flow with real density, mobile sizes, the UI language,
keyboard and loading/error/empty states. Capture useful visual evidence; it
does not replace functional assertions. Measure loaded JS and relevant
LCP/CLS/INP/frame cost before claiming performance gains. Do not create unit
tests for every icon/keyframe; select evidence by [risk and fidelity](testing.md).
