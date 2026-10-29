# Webhooks — load-bearing details

Companion to `CLAUDE.md`. CLAUDE.md owns the sticky-failed-window rule
(extending lifecycle events). This file extends it with the receiver shape,
the dedup logic, the routing check, and the two-site rule when adding a
new event.

## Token shape + lifecycle

The webhook URL token is **48 hex characters**, generated with
`openssl rand -hex 24` (24 bytes → 48 hex chars). One token per `(user, org)`
row in `webhook_configs`. Tokens are **opaque** — CC never sees the user/org
identity, only the path it's asked to POST to.

Recovery story when a token leaks or is suspected compromised:

1. `DELETE FROM webhook_configs WHERE user_id = … AND cc_org_id = …;`
2. The user re-opens the app → the frontend hits `GET /api/orgs/:id/map`
   → backend notices the missing config and provisions a fresh token +
   re-registers it with CC's webhook API.
3. The old URL starts returning 401 immediately (token lookup fails).

## No HMAC — auth is the secret URL

CC does not sign deliveries. The auth surface for the receiver is:

- **TLS** (the URL is `https://`, no plaintext token in flight).
- **Opaque token** in the URL path (`/webhooks/cc/:token`).
- **Routing check** at `backend/src/webhooks/receiver.rs`: every received
  envelope's `routing.owner_id` must match the `cc_org_id` of the
  `webhook_configs` row found by token. A token issued for org A must
  reject events for org B (this is a misconfiguration on CC's side, but
  we double-check anyway).

If you ever see an envelope cross between orgs, the receiver returns 401
silently — log line `webhook routing mismatch token=<prefix> expected_org=… got_org=…`.

## Dedup window (60 s, capacity 10 k)

CC sends duplicates within ~100–300 ms (their delivery infra). The receiver
keys deduplication on:

```
event_type | resource_id | deployment_id | YYYYMMDDHHMMSS
```

(see `backend/src/webhooks/receiver.rs:91`). Entries TTL at 60 s; the map
caps at ~10 k entries (eviction is FIFO if breached — defensive, never
seen in the wild).

`record(dedup_key)` returns `false` if it's a duplicate. The receiver
**still returns 204** in that case (line 110ish) — returning 4xx makes CC
retry indefinitely.

## Adding a new CC event — the two sites you must update

This is the most common forgotten step. Adding support for a new event
type (e.g. `LOAD_BALANCERS_UPDATE`) requires changes in **two** places:

1. `backend/src/webhooks/event.rs::to_frames()` (line 97) — add a match
   arm that translates the parsed envelope into one or more `WsFrame`
   variants. This is what feeds the org's `broadcast::Sender<WsFrame>`.
2. `frontend/src/types/ws.ts` — add the matching variant to the
   discriminated `WsFrame` union.
3. (Likely also) `frontend/src/stores/useOrgStore.ts` (or whatever consumes
   the WS frame) — handle the new variant.

Common breakage pattern: the backend emits a frame for a new event but the
frontend doesn't know how to parse it, so the WS message is silently
dropped (TS type guard fails at runtime, the unknown branch is logged via
`debug.warn('ws', …)`).

## Lifecycle events that clear `failed_apps`

CLAUDE.md describes the sticky failed window. When you add a new lifecycle
event, decide whether it counts as "user signalled they fixed it":

| Event | Clears `failed_apps`? | Why |
|---|---|---|
| `DEPLOYMENT_FAIL` | No, **adds** to it | The original sticky-fail trigger. |
| `DEPLOYMENT_SUCCESS` | Yes | The build passed. |
| `APPLICATION_REDEPLOY` | Yes | User explicitly re-tried. |
| `APPLICATION_CREATION` | Yes | User created a new app — slate clean. |
| `APPLICATION_DELETION` | Yes | App is gone, no point keeping it red. |
| `APPLICATION_STOP` | Yes | User stopped — building should not be red. |
| `GIT_PUSH` | Yes | User pushed new code; failure was on prior commit. |
| `LOAD_BALANCERS_UPDATE` | (TBD) | Doesn't change deploy state — leave alone. |

The clearing logic lives in `webhooks/receiver.rs::handle` (or a helper it
calls). If you add a new event and skip wiring it, the building will stay
red even after the user fixed the issue — no error, just a confused user.

## What CC webhooks **don't** cover

- **Addon health.** No `addon_started` / `addon_failed` / `addon_metric`
  webhooks. We poll every 30 s in `backend/src/ws/poller.rs::tick_addons` to
  derive presence/healthy. Missing an addon from the list = unhealthy.
- **Granular Cellar / Materia / Pulsar events.** These addons might publish
  their own events to a topic somewhere — we don't ingest any of that.
- **Inter-org events.** Webhooks scoped to one org. If a user is in 5 orgs
  they have 5 distinct tokens (5 rows in `webhook_configs`).

## Where to defer to docs/

- Confirmed event catalog with payload shapes + the "expected but unseen"
  list: `docs/webhooks.md §Event catalog`.
- The local `webhook_sniffer` companion (capture and replay payloads):
  `docs/webhooks.md §Sniffer`.
