---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# UI em pt-BR

- Placeholders, aria-labels, empty states and error messages are user-facing strings too. An error says what happened and what to do next, never a raw error object, stack trace or English library message.
- Dates, numbers and currency go through `Intl` with `pt-BR` (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`), never hand-built `dd/mm/yyyy` or `R$` strings. Store and transport UTC/ISO 8601; format only at render.
- Accessibility floor: a visible `<label>` (or aria-label) per input; real `<button>`/`<a href>`, never a clickable `<div>`; visible focus and keyboard reach in a logical order; text contrast ≥ 4.5:1 and never color alone; `alt` in pt-BR (`alt=""` when decorative) and `aria-label` on icon-only buttons; one `<h1>`, ordered headings, `<main>/<nav>/<footer>` landmarks.
