---
id: docker-vps
reviewed_at: 2026-10-02
coverage: "Docker Engine/Compose by installed version; Next 15/16 and Astro Node/static integrations"
---

# Deploy the artifact and verify the operating contract

- Start from the existing topology. Several containers on one VPS do not remove
  host failure. Choose restart/recovery and acceptable downtime/data loss before
  adding replicas, Redis or orchestration. Compose does not itself prove rolling
  update or rollback behavior. [Compose production](https://docs.docker.com/compose/how-tos/production/).
- Build from locks, use compatible architecture/libc/native dependencies and
  keep only runtime necessities. Pin release/digest for reproducibility, with
  conscious security updates. Build secrets use secret/SSH mounts, not ARG/ENV
  or files left in layers. Runtime file secrets need host protection and app
  support; do not assume `_FILE` variables exist. [Build practices](https://docs.docker.com/build/building/best-practices/),
  [build secrets](https://docs.docker.com/build/building/secrets/),
  [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/).
- Publish only required ingress. Keep database, Redis and telemetry receivers
  on appropriate private networks. UFW alone does not prove Docker-published
  ports are blocked. Check Engine version and IPv4/IPv6: before 28.0.0, localhost
  published ports had same-L2 exposure caveats. Reduce privileges/capabilities
  and writes where compatible; do not mount the Docker socket into the app.
  [Firewall](https://docs.docker.com/engine/network/packet-filtering-firewalls/),
  [port publishing](https://docs.docker.com/engine/network/port-publishing/),
  [security](https://docs.docker.com/engine/security/).
- Set measured CPU/memory/concurrency budgets with host/database headroom and
  verify effective limits. Rotate logs: default `json-file` has no default
  rotation. Budget disk for volumes, telemetry and builds; never delete data
  volumes automatically to free space. [Resources](https://docs.docker.com/engine/containers/resource_constraints/),
  [logging](https://docs.docker.com/engine/logging/configure/).
- `depends_on` orders startup; `service_healthy` can wait for readiness, but
  neither replaces runtime recovery. `unhealthy` alone is not a Compose/Engine
  promise to restart. Deliver SIGTERM to the app and budget all drain/flush
  work within `stop_grace_period`. [Startup](https://docs.docker.com/compose/how-tos/startup-order/),
  [restart](https://docs.docker.com/engine/containers/start-containers-automatically/),
  [stop grace](https://docs.docker.com/reference/compose-file/services/#stop_grace_period).

## Framework and proxy integration

- Next standalone output needs `public` and `.next/static` copied/served when
  a CDN is not responsible. Across replicas, use coherent artifacts, Server
  Action encryption keys and cache invalidation; do not introduce shared cache
  infrastructure for a single instance without need. [Standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
  [self-hosting](https://nextjs.org/docs/app/guides/self-hosting).
- Astro static output needs no production Node process. SSR Node standalone
  versus middleware modes differ in server/assets responsibility. Test the
  selected adapter, correct base/paths and private cookie/cache behavior.
  [Astro Node](https://docs.astro.build/en/guides/integrations-guide/node/).
- Streaming/SSE requires proxy-appropriate buffering/timeouts and cancellation.
  Nginx buffers by default; Caddy has different controls. Change the relevant
  route rather than disable buffering for unrelated services that need it.
  Test first-event arrival and client disconnect through the real proxy.
  [Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering),
  [Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).

Persistent volumes are not backups. Keep recoverable copies outside the VPS's
failure domain, verify restore and check schema compatibility before image
rollback. [Volumes](https://docs.docker.com/engine/storage/volumes/),
[Postgres backup](https://www.postgresql.org/docs/18/backup.html).

Validate configuration without dumping interpolated secrets, for example
`docker compose config --quiet` when supported. Then exercise the built artifact
in a disposable topology: assets/deep links, readiness, signals, private ports,
limits and recovery as relevant. Syntax validation alone proves none of these.
[Compose config](https://docs.docker.com/reference/cli/docker/compose/config/).
