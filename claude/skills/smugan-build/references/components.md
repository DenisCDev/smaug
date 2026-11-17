---
id: components
reviewed_at: 2026-10-02
coverage: "coss/Base UI 1; HeroUI 2/3; version-matched React Aria/Radix primitives"
---

# Functional components with a product-specific design

- Keep existing primitives that meet the contract. Evaluate a new base with an
  actual form, table, navigation and dialog before committing to it. Library
  accessibility does not certify the assembled page's labels, contrast, focus
  or motion. [React Aria quality](https://react-aria.adobe.com/quality).
- Library notes below apply only when the user asks to choose the base of a
  new project. coss ui combines Base UI and Tailwind 4 with editable source;
  copied code becomes the project's maintenance responsibility. Record origin/revision and local changes before
  updates; do not overwrite customization from a new registry copy. The coss
  monorepo marks `apps/ui` and `apps/origin` MIT, other directories AGPLv3.
  Verify the actual copied directory, not the monorepo name. Origin's older
  snapshot has limited maintenance. [Getting started](https://coss.com/ui/docs/get-started),
  [directory licensing/maintenance](https://github.com/cosscom/coss/blob/main/README.md).
- HeroUI 3 offers a cohesive packaged base using React 19, Tailwind 4 and React
  Aria Components, with CSS animation and compound parts. Do not carry the v2
  provider/Framer Motion recipe into v3 or remove Motion used elsewhere merely
  because HeroUI no longer needs it. Core licensing does not cover every Pro
  template. [v3 release](https://heroui.com/en/docs/react/releases/v3-0-0),
  [migration](https://heroui.com/en/docs/react/migration/full-migration),
  [core license](https://github.com/heroui-inc/heroui/blob/main/LICENSE).
- Base UI/React Aria are behavior foundations; they do not supply the requested
  art direction by themselves. Preserve Radix if suitable and check SSR/React
  compatibility. Park UI is more natural when Ark/Panda already fits than as a
  reason to add another styling system. [Base UI](https://base-ui.com/react/overview/about),
  [Radix SSR](https://www.radix-ui.com/primitives/docs/guides/server-side-rendering),
  [Park UI](https://park-ui.com/docs/introduction).
- Magic UI/Aceternity can supply selected marketing effects; a showcase snippet
  does not replace verified form/dialog behavior. Check the specific component's
  dependencies and open/Pro terms. In Astro, prefer native components for static
  sections; a React block can be a bounded island, not the whole page.
  [Magic UI](https://magicui.design/docs), [Aceternity license](https://ui.aceternity.com/licence).
- Animate according to the primitive's mounting, portal and focus contract.
  Adding exit animation must preserve Escape, focus return and blocked background
  interaction. SSR support does not mean every component is an RSC. Keep React
  callbacks/render props within an Astro island. [Base UI animation](https://base-ui.com/react/handbook/animation),
  [Astro framework boundary](https://docs.astro.build/en/guides/framework-components/).

Verify keyboard/mobile operation, validation, pending/success/error feedback,
empty states and reduced motion in the composed screen. Distinct typography,
rhythm and hierarchy matter more than whether the library is uncommon.
