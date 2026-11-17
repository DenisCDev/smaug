## What changes

<!-- The previous behavior and its consequence; the new behavior and why it is correct. -->
<!-- A big change (new check, new adapter, hook output, new dependency, breaking change): link the issue where the direction was agreed. -->

## How it was verified

<!-- Command and result, one per line. Say what did not run and why. -->

- [ ] `node --test` in `packages/gate`
- [ ] `node packages/gate/bin/smugan.mjs check`
- [ ] `node --test` in each affected adapter
- [ ] `node scripts/public-guard.mjs`
- [ ] `npm run build` in `site`, if the change touches `site/`
- [ ] A test that fails without the fix, or at the entry point of the new behavior
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`, if users notice the change
- [ ] The documentation site updated in English and in `pt-br/`, if users notice the change
