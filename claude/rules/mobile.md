---
paths:
  - "**/app.json"
  - "**/app.config.{js,ts}"
  - "**/eas.json"
  - "**/*.kt"
  - "**/android/**"
  - "**/ios/**"
---

# Mobile (stub — expand when the first mobile project starts)

## Expo / React Native

- Preserve the existing workflow (managed/bare), navigation library and UI toolkit. Only a new project with no prior choice starts on Expo managed + expo-router; moving to bare when a native module forces it is a recorded decision.
- TypeScript strict when the project uses it; same global rules apply (no `any`, the project's schema validator — zod when installed — at boundaries, user-facing strings in the UI language).
- Follow the existing file-naming convention; with expo-router on a new project, folders kebab-case, components PascalCase.
- Env/config through the project's mechanism (with Expo, `app.config.ts` + `expo-constants`); secrets never in the bundle.
- Test on every platform the app targets before done: iOS simulator and/or Android emulator minimum.

## Kotlin (Android nativo)

- Preserve the existing language and UI toolkit (Views or Compose); a new project with no prior choice uses Kotlin and Jetpack Compose.
- Package naming: reverse-domain lowercase. Classes PascalCase, functions/vals camelCase.
- Strings in `res/values/strings.xml` (the UI language as default) — never hardcoded in composables.

## Shared

- User-facing text in the UI language with correct diacritics; dates/numbers via platform locale APIs with the app's locale.
- Accessibility from the start: content descriptions / accessibility labels on interactive elements.
