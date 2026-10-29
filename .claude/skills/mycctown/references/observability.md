# Observability — load-bearing details

Companion to `CLAUDE.md`. CLAUDE.md covers the three load-bearing facts
(Rust SDK has no structured Logs API yet, axum layer order, sourcemap debug
IDs are unique per build) — this file extends them with what the SDKs do
in practice and where to look first when something goes wrong.

## `debug.*` is the only sanctioned frontend logger

CLAUDE.md says "use `debug.*` instead of bare `console.*`". The reasons in
detail:

- `debug.log/warn(scope, …)` → `Sentry.logger.{info,warn}(…)` → GlitchTip
  Logs stream (no issue created). The console toggle controls whether the
  same call **also** echoes to the browser console.
- `debug.error(scope, err, …)`:
  1. always logs to console (regardless of toggle)
  2. captures via `Sentry.captureException(err)` if `err instanceof Error`,
     `Sentry.captureMessage(…)` otherwise — this creates an issue
  3. **also** calls `Sentry.logger.error(…)` so the call shows up in both the
     Issues stream and the Logs stream (for correlation with surrounding
     `debug.log` lines)
- The toggle states (`import.meta.env.DEV`, `VITE_DEBUG_LOGS=true`,
  `localStorage['mycctown.debug']='1'`, `?debug=1` in URL) compose with
  OR. The URL form auto-persists to localStorage on first load.

When you add new frontend instrumentation, **scope it** (`debug.log('asset',
…)`, `debug.warn('ws', …)`, `debug.error('api', …)`) — scope strings are
free-form but conventional ones (`asset`, `ws`, `api`, `org`, `auth`)
already exist. New scopes should be lowercase, single-word.

## Backend logging shape

The backend uses `tracing` everywhere. The relevant `sentry` integration
behaviours:

- `tracing::error!` → Sentry **event** (creates an issue in GlitchTip).
- `tracing::warn!` → Sentry **breadcrumb** (attached to the next event in
  the same scope).
- `tracing::info!` / `debug!` → also breadcrumbs (lower priority).

So the **issue / log priority** is determined entirely by the tracing macro
you pick. If you `error!` a recoverable condition you'll spam GlitchTip
Issues; if you `warn!` something fatal you'll lose the issue.

There is **no per-event `Sentry.logger.*` API** in the Rust SDK at this
crate version (0.48). Don't add `sentry-log` blindly — it forwards `log`
crate output as events, which would double-up with `tracing` for crates
that bridge to both.

## User + org context (both ends)

Issues without user/org context are a debugging dead-end. Both ends attach
the context as soon as auth resolves:

- **Backend**: in the `AuthUser` extractor (where the session cookie maps
  to a row in `users`), call `sentry::configure_scope(|scope| { scope.set_user(…) })`.
  That includes the user UUID + the CC user id. Subsequent
  `tracing::error!` events in the same request hub carry it.
- **Frontend**: `Sentry.setUser({ id, cc_user_id })` happens inside
  `useAuthStore.refresh()` after `/api/me` returns 200.
- **Org context**: only the frontend has a current-org concept (the backend
  scopes per-request via the org ID in the URL). `useOrgStore` calls
  `Sentry.setTag('org_id', …)` + `Sentry.setContext('org', { … })` on every
  successful org switch.

When you add a new long-lived frontend store that knows about identity
(e.g. a "current map" store), repeat this pattern — the issue spam on a
Sentry without context is real.

## Sourcemap upload — the failure mode you'll actually hit

CLAUDE.md states: build + upload must happen on the same machine that
ships the bundle. The way this fails in practice:

- You debug locally, `npm run build`, look at `dist/assets/*.js.map`, then
  push to git and let CC build prod. The prod sourcemap on GlitchTip has a
  different debug-id from the prod `.js` (uploaded by CC's hook with its
  own `SENTRY_AUTH_TOKEN`). Stack traces in prod stay minified.
- Symptom in GlitchTip: an issue with `index-XXX.js:line:col` where the
  line is in the bundled output. Source mapping silently fails.
- Fix: never upload from local `npm run build`. The sourcemap on
  `<your-glitchtip-host>` should be the one CC uploaded — verify by
  comparing debug-ids (search for the UUID inside the deployed `.js` and
  in GlitchTip's "Source Maps" tab).

The frontend's `vite.config.ts` is configured with `sourcemap: true` and
`@sentry/vite-plugin`. The plugin is a no-op unless `SENTRY_AUTH_TOKEN`,
`SENTRY_URL` and `SENTRY_ORG` are all set, so a missing CC env var doesn't
break the build — it just silently skips the upload. Check those are set on
`mycctown-frontend` / `mycctown-frontend-dev` if sourcemaps disappear.

## When things look broken

Quick triage table for "GlitchTip is empty / wrong / spammy":

| Symptom | First check |
|---|---|
| No events at all in prod | Frontend: `VITE_SENTRY_DSN` set on `mycctown-frontend`? Backend: `SENTRY_DSN` on `mycctown-backend`? `Sentry.init` runs early in `main.tsx` / `main.rs`? |
| Events but minified stack traces | Sourcemap upload skipped — see "Sourcemap upload" above. |
| Events lack user/org tags | The user/org context tagging path didn't run — `useAuthStore.refresh()` errored or org store didn't fire. Check the breadcrumbs. |
| Spam (10s of identical issues) | Probably a `tracing::error!` for a recoverable condition. Demote to `warn!` and confirm the surrounding code still surfaces real failures. |
| Frontend logs absent from Logs stream | `debug.*` not used (someone wrote `console.log` again) or the env var `VITE_DEBUG_LOGS` mismatch. |

## Where to defer to docs/

- Uptime monitor IDs, alert rules, GlitchTip API tokens: `docs/observability.md §Uptime monitors + alerts`.
- Full SDK init wiring (frontend `main.tsx`, backend `main.rs`):
  `docs/observability.md §SDK init`.
