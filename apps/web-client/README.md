# Web client

See the [root README](../../README.md) for startup instructions.

## Request-body limits

API routes read request streams through `src/lib/http/request-body.ts`. Limits
apply to the complete UTF-8 body, including JSON syntax, before parsing or
forwarding. Content-Length can reject early, but streamed byte counting remains
mandatory when the header is absent or inaccurate. Oversized requests return
HTTP 413; malformed JSON or UTF-8 returns HTTP 400.

| Request | Maximum bytes |
| --- | ---: |
| Login/register | 16,384 |
| Project writes | 16,384 |
| MCP connection writes/probes/checks/discovery | 32,768 |
| Tool writes/executions | 70,000 |
| Agent/prompt configuration | 220,000 |
| Agent execution input | 70,000 |
| Refresh/logout/execution cancellation | 1,024 |

These transport caps complement backend field/schema validation; they do not
replace it. JSON escapes and whitespace count toward the cap. The reader retains
one bounded buffer and cancels the stream on overflow. HTTP/framework buffers
outside the handler remain the responsibility of the hosting stack.

For nginx deployments, include [the body-limit snippet](../../deploy/nginx/request-body-limits.conf)
inside the application's server block. Keep request buffering enabled (nginx's
default) to reject oversized requests before forwarding the complete body.
Other ingress providers should enforce a maximum of 220,000 bytes, with smaller
per-route limits where supported. Avoid overriding this limit in child locations.
Validate the configuration before reload and verify an over-limit request gets
413 at the deployed edge. The snippet is supplied for deployment; it has not been
installed or verified on a running ingress.

Run the focused regression suite after building:

```sh
pnpm build
pnpm test:request-body
```

The suite tests streamed reading and actual production Next.js route handlers.
It starts a private web server on port 3102 and a mock backend on port 3103;
it needs neither a database nor model credentials. Tests confirm oversized
requests are not forwarded to the backend. The full browser suite remains
`pnpm test:e2e` and has separate database prerequisites.

## Frontend resilience and security

The focused suite also covers caller cancellation, invalid response envelopes,
polling backoff/reconnect, CSP enforcement, operation recovery after reload,
paginated catalogs, and lazy trace payloads. It currently contains 42 tests.

Document requests receive a fresh CSP nonce, including Next.js hydration and the
theme initializer. Documents render dynamically and use no-store. Development
permits evaluation and localhost WebSockets; production does not. Inline styles
remain allowed for existing style props. Frame embedding is denied. Set
`APP_ORIGIN` to the HTTPS origin when building/running the deployment to enable
the configured HSTS header; verify headers and TLS at the deployed ingress.

Pending tool tests retain only a request UUID in tab-scoped sessionStorage,
scoped by authenticated user, project, and tool. Reopening or reloading performs
a read-only status lookup. Unknown outcomes block new tests until explicitly
acknowledged; storage failure also blocks submitting an untrackable operation.
Arguments and credentials are never stored in that recovery record.

Catalog endpoints accept optional search/summary parameters. Execution reads
support compact status/summary views and separate paginated span, span-payload,
and snapshot endpoints. Existing default backend representations remain
compatible. See the [audit remediation notes](../../docs/FRONTEND_AUDIT.md).

Validation on 8 October 2026: lint, typecheck, production build, 42 focused
regressions, 28 existing browser tests, and 36 related backend tests passed.
Database-backed checks used a disposable PostgreSQL container. Production
ingress headers and large-catalog latency still require deployment measurements.


## Architecture and bundle diagnostics

Feature controller hooks live with their views in `src/components/<feature>`.
Reusable browser lifecycles live in `src/hooks`; HTTP policy lives in `src/lib`.
See the [architecture reading guide](../../docs/FRONTEND_ARCHITECTURE.md) for
cross-references, dependency boundaries and examples of applying SOLID.

Run `pnpm analyze:routes` after a production build to compare manifest-referenced
CSS/client-module JS bytes and gzip totals. This measures build assets, not full
browser transfers or runtime latency. The [P3 report](../../docs/P3_REFACTOR.md)
records the baseline, results and remaining profiling work.
