# Observability — GlitchTip + MCP

myCCtown ships errors, traces, and structured logs to a self-hosted
GlitchTip instance at <https://<your-glitchtip-host>>. The same
GlitchTip server exposes an MCP (Model Context Protocol) endpoint
that Claude Code queries directly during dev sessions — `list_issues`,
`get_latest_event`, `list_transaction_groups`, `detect_n_plus_one`,
`list_logs`, `list_monitors`, etc.

## Stack at a glance

| Concern | Backend (Rust) | Frontend (React) |
|---|---|---|
| SDK | `sentry 0.48` + `sentry-tower 0.48` | `@sentry/react 10` + `@sentry/vite-plugin` |
| Init site | `main.rs` (before `tracing` init) | `main.tsx` (before `createRoot`) |
| Errors | `tracing::error!` → events via `sentry::integrations::tracing::layer()` | `Sentry.captureException` via `debug.error` |
| Breadcrumbs | `tracing::info!` / `tracing::warn!` | auto (fetch + history) |
| Transactions | `sentry-tower::NewSentryLayer` + `SentryHttpLayer.enable_transaction()` | `Sentry.browserTracingIntegration()` |
| Structured Logs | **not supported** by `sentry` crate 0.48 (see §[Backend Logs API status](#backend-logs-api-status)) | `enableLogs: true` + `Sentry.logger.{info,warn,error}` via `debug.ts` |
| User context | `sentry::configure_scope().set_user` in `AuthUser` extractor | `Sentry.setUser` in `useAuthStore.refresh` |
| Org context | (URL captured by sentry-tower transaction) | `Sentry.getIsolationScope().setTag('org_id')` + `setContext('org', …)` in `useOrgStore` |
| ErrorBoundary | n/a | `Sentry.ErrorBoundary` wraps `<App/>` |
| Sourcemaps | n/a | `@sentry/vite-plugin` (gated on `SENTRY_AUTH_TOKEN`) |

## GlitchTip projects

Org slug `<org-slug>`. Two projects:

| Project | id | DSN env var (CC) | Sample rates |
|---|---|---|---|
| `mycctown-backend` | 1 | `SENTRY_DSN` | traces 0.1 |
| `mycctown-frontend` | 2 | `VITE_SENTRY_DSN` (build-time) | traces 0.2, logs 1.0 |

Both DSNs are also in the local `.env` files (gitignored). Init is a
no-op when the DSN is unset, so dev without GlitchTip works unchanged.

## Backend init (`main.rs`)

Sentry init runs **before** tracing so the tracing→Sentry layer has a
hub to send to. The `_sentry_guard` lives for the whole `main`
function — `drop` flushes pending events.

```rust
let _sentry_guard = config.sentry_dsn.as_ref().map(|dsn| {
    sentry::init((dsn.as_str(), sentry::ClientOptions {
        release: sentry::release_name!(),
        environment: Some(config.sentry_environment.clone().into()),
        traces_sample_rate: config.sentry_traces_sample_rate,
        attach_stacktrace: true,
        ..Default::default()
    }))
});

tracing_subscriber::registry()
    .with(env_filter)
    .with(fmt_layer)
    .with(sentry::integrations::tracing::layer())
    .init();
```

The router wraps:

```rust
.layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
.layer(sentry_tower::NewSentryLayer::<Request>::new_from_top());
```

**Order is load-bearing.** Axum applies layers innermost-first, so
`SentryHttpLayer` must come **before** `NewSentryLayer` in the
`.layer()` chain — reversing them leaks the per-request hub
(per the `sentry-tower` docs).

User context is set in `AuthUser::from_request_parts`
(`backend/src/auth/middleware.rs`):

```rust
sentry::configure_scope(|scope| {
    scope.set_user(Some(sentry::User {
        id: Some(user.id.to_string()),
        email: user.email.clone(),
        username: user.name.clone(),
        ..Default::default()
    }));
});
```

`NewSentryLayer` creates a fresh hub per request, so this assignment
is request-scoped and doesn't leak across users.

## Frontend init (`main.tsx`)

```tsx
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'development',
  release: import.meta.env.VITE_SENTRY_RELEASE,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.2,
  enableLogs: true,
});
Sentry.getGlobalScope().setAttributes({ service: 'mycctown-frontend', release });
```

`<App/>` is wrapped in `<Sentry.ErrorBoundary>` so React render crashes
also reach GlitchTip.

`frontend/src/utils/debug.ts` is the **single instrumentation
surface** — don't use bare `console.*` in new code:

| Call | Effect |
|---|---|
| `debug.log(scope, …)` | `console.debug` (if enabled) + `Sentry.logger.info` |
| `debug.warn(scope, …)` | `console.warn` (if enabled) + `Sentry.logger.warn` |
| `debug.error(scope, …)` | `console.error` always + `Sentry.captureException` (if `Error` in args) or `captureMessage` + `Sentry.logger.error` |

User context is set in `useAuthStore.refresh()` after `fetchMe`
succeeds (`Sentry.setUser({ id, email })`); cleared in `logout()`.

Org context is set in `useOrgStore` via a `tagCurrentOrg(orgId, orgs)`
helper:

```ts
const scope = Sentry.getIsolationScope();
scope.setTag('org_id', orgId ?? undefined);
scope.setContext('org', orgId ? { id, name } : null);
```

Called from `loadOrgs`, `selectOrg`, and `reset` — every event after
an org switch carries the right tag.

## Sourcemaps

`vite.config.ts` reads `SENTRY_AUTH_TOKEN`, `SENTRY_URL`, `SENTRY_ORG`
(and optionally `SENTRY_PROJECT`, default `mycctown-frontend`) via
`loadEnv`, and only adds `sentryVitePlugin` when the token, URL and org
are all present. Local dev without them = plugin is a no-op, no upload
attempted.

`build.sourcemap` is `'hidden'`: `.map` files are produced (and
uploaded to GlitchTip at build time) but **not referenced from the
served bundle**, so browsers don't fetch them and clients can't
deobfuscate.

The plugin assigns a **UUID debug ID** per build, embedded in both
`.js` and `.js.map`. GlitchTip indexes the artifact bundle by debug
ID; on a prod error, the SDK sends events with the same debug ID,
GlitchTip looks it up, and stack traces resolve to TS source files.

**Debug IDs are unique per build run.** A sourcemap uploaded from
local `npm run build` does NOT match the production bundle (different
build → different debug ID). The deployed sourcemap must be uploaded
by the same build hook that produced the deployed bundle. On Clever
Cloud, that means `SENTRY_AUTH_TOKEN`, `SENTRY_URL` and `SENTRY_ORG` are set on the frontend app and
the CC build hook does the upload during deploy.

## Uptime monitors + alerts

Created on 2026-04-29 via the GlitchTip API (the MCP only exposes
`list_*`, not `create_*`):

| id | Type | URL | Interval | Project |
|---|---|---|---|---|
| 1 | Ping | `https://mycctown-backend.cleverapps.io/health` | 60 s | `mycctown-backend` |
| 2 | Ping | `https://mycctown.cleverapps.io/` | 60 s | `mycctown-frontend` |

Plus 4 alerts (one per project × pattern), email recipient:

- "Any new issue" — 1 event / 1 min
- "Issue rate spike" — 10 events / 5 min

Inspect via `list_monitors(organization_slug='<org-slug>')` and
`list_alerts(organization_slug='<org-slug>')` from a Claude session.

## MCP from Claude Code

The GlitchTip server has the built-in MCP enabled
(`GLITCHTIP_ENABLE_MCP=True` on the GlitchTip container). Add it once
in Claude Code:

```bash
claude mcp add --transport http glitchtip https://<your-glitchtip-host>/mcp
```

OAuth 2.0 dynamic client registration handles the auth flow on first
use. Available tools (`mcp__glitchtip__*`):

`list_organizations`, `list_projects`, `list_issues`, `get_issue`,
`get_latest_event`, `get_event`, `update_issue`,
`list_transaction_groups`, `get_transaction_group`,
`get_transaction_trend`, `list_transaction_spans`, `list_span_groups`,
`detect_n_plus_one`, `list_logs`, `get_log`, `list_alerts`,
`list_monitors`.

Typical debug loop:

1. User reports a regression.
2. `list_issues(query='is:unresolved', start='now-1h', environment='production')` finds candidates.
3. `get_latest_event(issue_id=…)` returns the full payload — stack trace, breadcrumbs, user, tags, env.
4. Fix in code, ask user to retest.
5. `update_issue(status='resolved')` once the user confirms.

## Backend Logs API status

The `sentry` crate 0.48 does **not** expose GlitchTip's structured
Logs stream as a separate channel. There's no `sentry::logger::info`
or `enable_logs: true` in `ClientOptions`. The crate's `logger_*!`
macros exist but they emit standard Sentry **events**, not Logs.

Today's setup uses `sentry::integrations::tracing::layer()`:

- `tracing::error!` → Sentry event (= GlitchTip issue)
- `tracing::warn!` / `tracing::info!` → breadcrumbs attached to the next error in the same hub

When the crate adds a real Logs API (Python and JS already have it),
revisit this. Until then:

- Don't pull in `sentry-log` blindly — it would forward `log` crate
  output as events, which doubles up with `tracing` and inflates the
  issue count.
- Use `tracing::error!` with structured fields when you want a backend
  failure to land in GlitchTip. Use `tracing::info!`/`warn!` freely
  for breadcrumb context (only attached if an error fires within the
  same request hub).

## Scrubbing / PII

GlitchTip strips IPs by default (`scrubIPAddresses: true` on all
projects). On our side:

- `auth/oauth.rs` logs missing field names + HTTP status codes only,
  never response bodies (which can contain tokens).
- `tracing::error!("Internal error: {err:#}")` in `error.rs` includes
  the full anyhow chain — fine for our errors but **don't add
  `tracing::error!("token={…}")`** or any line that pushes a secret
  through.
- `setUser({ id, email, username })` includes the email. CC user IDs
  are opaque UUIDs (not PII on their own). If we ever need stricter
  scrubbing, add a `before_send` hook on the SDK side.

## Sample rates today

- Backend traces: **0.1** (10% of HTTP requests get a transaction).
- Frontend traces: **0.2** (20% of pageloads get a transaction).
- Frontend logs: **1.0** (every `debug.*` call sends a log).

To temporarily bump rates for an active debug push:

```bash
# Backend — runtime, restart picks it up
clever env set --alias mycctown-backend SENTRY_TRACES_SAMPLE_RATE 1.0
clever restart --alias mycctown-backend

# Frontend — build-time, needs a rebuild deploy
# (edit main.tsx tracesSampleRate, or split into VITE_SENTRY_TRACES_SAMPLE_RATE)
```

Don't leave them at 1.0 long term — GlitchTip transaction stream cost
scales linearly.
