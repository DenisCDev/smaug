---
id: icons
reviewed_at: 2026-10-02
coverage: "Lucide 0/1; Phosphor React 2.1.x; Iconoir 7.11+ React 19 support"
---

# Icons without unnecessary client code

- Keep the existing family unless the design needs another vocabulary. Phosphor's
  six weights can support a more expressive new product; Lucide fits a restrained
  style; Iconoir offers another linear drawing style. None is universally better.
  Use consistent scale/stroke/weight and explicit imports for known icons.
- Lucide v1 removes brand icons; do not assume old brand exports survive.
  Current Astro docs use `@lucide/astro` for inline SVG; select the package name
  that matches the version, without adding React hydration for static icons.
  Runtime name lookup can load/build more code: use it only when content needs
  dynamic selection. [Migration](https://lucide.dev/guide/react/migration),
  [Astro](https://lucide.dev/guide/astro),
  [dynamic imports](https://lucide.dev/guide/react/advanced/dynamic-icon-component).
- Phosphor `@phosphor-icons/react/ssr` alias arrived in 2.1.10; `Icon` suffixed
  names are recommended since 2.1.8. Check exports before generating imports.
  SSR components do not rely on Context; pass required visual props explicitly.
  `phosphor-react` is the older package. Mirror directional meanings for RTL
  where appropriate, not all symbols. [README](https://github.com/phosphor-icons/react/blob/master/README.md),
  [releases](https://github.com/phosphor-icons/react/releases).
- Iconoir's React 19 support arrived in 7.11.0; the family name alone does not
  prove compatibility. [Releases](https://github.com/iconoir-icons/iconoir/releases).
- Decorative icons should not repeat accessible text. An icon-only button needs
  an accessible name on the control, visible focus and keyboard operation.
  Meaningful status cannot depend only on color or an ambiguous symbol.
  [Lucide accessibility](https://github.com/lucide-icons/lucide/blob/main/docs/how-to/accessibility.md).

Verify the import/export and SSR output, accessible control name and interaction.
Check actual artifact licensing: Lucide ISC with Feather attribution;
Phosphor/Iconoir MIT; brand marks may have separate conditions.
[Lucide license](https://lucide.dev/license),
[Phosphor license](https://github.com/phosphor-icons/react/blob/master/LICENSE),
[Iconoir manifest](https://github.com/iconoir-icons/iconoir/blob/main/package.json).
