---
id: supabase-postgres
reviewed_at: 2026-10-02
coverage: "supabase-js 2, version-matched SSR/CLI; PostgreSQL 16/17/18"
---

# Database and session boundaries

- Resolve JS SDK, SSR SDK and CLI independently. Supabase hosted is not one
  version inferred from the SDK; self-hosted components have separate images.
  PostgreSQL configuration is declared evidence, not a live server observation.
  Query server version only in an authorized environment when the decision needs
  it. Do not inspect env values for inventory. [Supabase components](https://supabase.com/docs/guides/self-hosting).
- For supported SDK/project setups use publishable keys in browsers and secret
  keys only in server administration paths. Legacy anon/service-role names must
  be interpreted correctly, not mechanically renamed during another task. RLS
  still protects browser data; a public key is not user authorization. Verify
  current key migration guidance rather than assuming a retirement date.
  [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
- SSR session clients are per request, with the installed SDK's cookie contract.
  Do not trust `getSession()` alone for sensitive server authorization; use the
  supported verified identity method (`getClaims()` or `getUser()` as appropriate)
  and authorize the resource. Preserve refresh cookies through proxy/response
  handling; never share refreshed sessions through CDN caches.
  [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- Separate GRANTs and RLS. Protect exposed tables, evaluate SELECT/INSERT/UPDATE/
  DELETE and storage policies against actual roles/tenants, including public
  catalogs. Owner/bypass roles cannot prove ordinary-user isolation. Do not impose
  `auth.uid()` on plain PostgreSQL or deny legitimate public reads. Use
  `(select auth.uid())` only where row-independent; it is not an index guarantee.
  [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
  [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- PostgreSQL 17 adds `transaction_timeout`; native `uuidv7()` is an 18 feature.
  Do not emit either into 16. Match extensions, migration syntax and connection
  limits to the target; applied migrations remain immutable. Generate the
  project's database types after schema changes. [17 release](https://www.postgresql.org/docs/17/release-17.html),
  [18 release](https://www.postgresql.org/docs/18/release-18.html).
- Choose direct/session/transaction pooling from process lifetime, network and
  driver requirements. Account for pool size × processes × replicas. Check
  prepared-statement/session-state restrictions on the actual pooler; do not
  mistake a reusable SQL pool for a reusable authenticated session client.
  [Connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

For integrity changes read [concurrency](concurrency.md). Verify policies on a
real isolated database with allowed and denied roles, cross-tenant access and
relevant write operations. Use the project's required pgTAP/migration checks;
a mocked SDK does not exercise RLS, and a successful owner query is insufficient.
[Database testing](https://supabase.com/docs/guides/local-development/testing/overview).
