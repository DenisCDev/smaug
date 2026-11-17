// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalReason } from '../src/risk.mjs';

test('migrations, SQL, auth, payments, env and manifests are critical', () => {
  const cases = {
    'supabase/migrations/0001_init.sql': 'migration',
    'db/migration/V2__add.java': 'migration',
    'scripts/backfill.sql': 'SQL',
    'middleware.ts': 'request middleware',
    'src/proxy.ts': 'request middleware',
    'src/lib/auth.ts': 'auth or permissions',
    'app/(auth)/login/page.tsx': 'auth or permissions',
    'src/hooks/useSession.ts': 'auth or permissions',
    'src/server/withAuth.ts': 'auth or permissions',
    'src/permissions/can-edit.ts': 'auth or permissions',
    'src/server/authorization.ts': 'auth or permissions',
    'src/lib/authentication.ts': 'auth or permissions',
    'src/lib/authorize.ts': 'auth or permissions',
    'src/lib/jwt.ts': 'auth or permissions',
    'src/lib/password.ts': 'auth or permissions',
    'src/auth/roles.ts': 'auth or permissions',
    'src/guards/admin.guard.ts': 'auth or permissions',
    'src/policies/note.policy.ts': 'auth or permissions',
    'src/middleware/requireUser.ts': 'request middleware',
    'app/api/webhooks/stripe/route.ts': 'payments or webhooks',
    'src/billing/invoice.ts': 'payments or webhooks',
    'src/env.ts': 'secrets or env',
    '.env.example': 'secrets or env',
    'package.json': 'dependencies',
    'crates/api/Cargo.toml': 'dependencies',
  };
  for (const [rel, reason] of Object.entries(cases)) assert.equal(criticalReason(rel), reason, rel);
});

test('ordinary code, look-alike names and prose are not critical', () => {
  for (const rel of [
    'src/components/Author.tsx',
    'src/lib/authors.ts',
    'src/lib/authorize-copy.md',
    'src/app/page.tsx',
    'src/utils/format-date.ts',
    'docs/auth.md',
    'README.md',
    'src/styles/main.css',
    'src/lib/sessionless.ts',
  ]) assert.equal(criticalReason(rel), null, rel);
});

test('Rust code is critical only when it has an unsafe block or item', () => {
  assert.equal(criticalReason('src/ffi.rs', 'pub unsafe fn raw(p: *const u8) -> u8 { *p }\n'), 'Rust unsafe');
  assert.equal(criticalReason('src/ffi.rs', 'fn read() { unsafe { libc::getpid(); } }\n'), 'Rust unsafe');
  assert.equal(criticalReason('src/lib.rs', '// no unsafe code here\nfn safe() {}\n'), null);
  assert.equal(criticalReason('src/lib.rs'), null, 'unknown content is judged by the path alone');
});

test('a name that opens with an acronym is split like any camelCase name', () => {
  for (const rel of ['src/JWTService.ts', 'src/RBACGuard.ts', 'src/APITokenStore.ts', 'src/HTTPSessionStore.java', 'src/SSOLogin.tsx', 'src/OAuth2Client.ts', 'src/MyJWT.ts']) {
    assert.equal(criticalReason(rel), 'auth or permissions', rel);
  }
  assert.equal(criticalReason('src/HTMLAuthorList.tsx'), null);
});
