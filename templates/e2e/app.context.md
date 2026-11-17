# App context for E2E tests

Read this before writing or running any E2E test, and keep it updated — it is
the source of truth that grounds tests in the real application.

## Environment

- Local URL: http://localhost:3000 (dev server: `npm run dev`)
- Preview URL: <fill in per PR when relevant>

## Test auth

- Test user: `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` in `.env.local` (never commit values)
- Login flow: <route, fields, expected redirect after login>

## Locator conventions

- Prefer role-based locators: `getByRole('button', { name: 'Salvar' })` — accessible names are pt-BR.
- `getByTestId` only when role/name is ambiguous; add the `data-testid` to the component in the same change.
- Locators come from the RUNNING app's DOM — open the page and inspect it. Never invent selectors from memory.

## Critical flows (E2E required before "done")

1. Auth: signup / login / logout
2. <main CRUD of this app>
3. <payment, if the app charges money>
