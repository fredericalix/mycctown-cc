# Clever Cloud Notification Webhooks

Webhooks give myCCtown sub-second lifecycle updates (deploys, stops,
fails, addon create/delete). Without them, we'd still work — the
backend polls the CC API every 10 s — but a deploy that takes 6 s
would flash blue-green-blue in the UI as CC's lifecycle state lags
behind the deployment result.

This doc has three parts:

1. The catalog of events CC posts (observed empirically via the
   [mycctown-sniffer](https://github.com/fredericalix/mycctown-sniffer)
   companion app).
2. How our receiver (`backend/src/webhooks/`) handles them.
3. How an org admin sets up a hook.

## 1. Transport

- **URL** an org admin pastes into CC console:
  `https://mycctown-backend.cleverapps.io/webhooks/cc/<48-hex-token>`
- **Method** — `POST application/json; charset=utf-8`
- **Auth** — the opaque token in the URL, **nothing else**. CC does
  not sign deliveries (no HMAC header). Headers observed: `Forwarded`,
  `Sozu-Id`, `Traceparent`, `Content-Type`.
- **TLS** — required by CC (`cleverapps.io` is HTTPS by default).
- **Retries** — CC behaviour undocumented; assume exponential retry on
  non-2xx. Our receiver is idempotent: always `204`, even on
  malformed payloads, so CC never queues redelivery for reasons we
  caused.

## 2. Envelope

```json
{
  "event": "<TYPE>",
  "date": "2026-04-18T14:05:27.195",
  "authorId": "user_<uuid>",
  "data":   { /* flat summary: appId or id + ownerId + … */ },
  "application":      { "id", "name", "ownerId", "instanceType" },
  "deployment":       { "id", "state", "action" },
  "deploymentRequest":{ "zone", "cause", "fqdns[]", "commit", "emails[]" },
  "deploymentResult": { "flavor", "duration", "instances", "instanceIds[]" },
  "addon":            { "id", "ownerId", "provider" },
  "user":             { /* CLEVER_TOOLS_REQUEST only */ }
}
```

Top-level blocks are only present where relevant. `data` echoes the
essentials as a flat dict — handy for a first-pass filter. Dates are
ISO strings **without timezone** (UTC implicit).

### Routing key

Always the owner of the **resource**, never the author:

- For `APPLICATION_*` + `GIT_PUSH` + `DEPLOYMENT_*` events →
  `application.ownerId`
- For `ADDON_*` events → `addon.ownerId`

Format is `user_<uuid>` (personal) or `orga_<uuid>` (org). Our
receiver validates that this owner matches the `cc_org_id` in the
`webhook_configs` row that owns the token — a webhook registered on
org A must not accept events for org B.

## 3. Event catalog (observed)

Confirmed on ≥94 events across two orgs (see
`mycctown-sniffer/docs/cc-webhook-catalog.md` for raw samples).

### 3.1 Apps — lifecycle

| Event | Payload highlights | Maps to |
|---|---|---|
| `APPLICATION_CREATION` | `application.{id,name,ownerId,instanceType}`. **No `deploymentRequest`.** | `AppStatus { state: "CREATED" }` → stage_B |
| `APPLICATION_DELETION` | idem; usually followed by cascade `ADDON_DELETION` deliveries | `AppRemoved { app_id }` |

### 3.2 Apps — deployment

| Event | Payload highlights | Maps to |
|---|---|---|
| `APPLICATION_REDEPLOY` | `deploymentRequest.{zone,cause,fqdns[],commit,emails[]}` | `AppStatus { state: "DEPLOYING" }` |
| `GIT_PUSH` | idem, `cause = "Git"` | `AppStatus { state: "DEPLOYING" }` (transient) |
| `APPLICATION_STOP` | `deploymentRequest.{zone,cause,fqdns[],emails[]}` | `AppStatus { state: "STOPPED" }` |
| `DEPLOYMENT_SUCCESS` | `deployment.{id,state:"OK",action:"DEPLOY"}` + `deploymentResult.{flavor,duration,instances,instanceIds[]}` + `data.{commitId,deploymentTime}` | `AppStatus { state: "UP", last_deploy: <date> }` |
| `DEPLOYMENT_FAIL` | `deployment.{state:"FAIL",action:"DEPLOY"}` + `deploymentResult.instances = 0, instanceIds = []` | `AppStatus { state: "FAIL", last_deploy: <date> }` + `failed_apps` entry |

`deployment.action` values observed: `DEPLOY` only. `UNDEPLOY` /
`RESTART` are plausible but not yet seen — the receiver accepts any
string and only special-cases `OK` / `FAIL` via the mapping above.

### 3.3 Addons

| Event | Payload highlights | Maps to |
|---|---|---|
| `ADDON_CREATION` | `addon.{id,ownerId,provider}`. **No** `state`/`plan`. | `AddonAdded { addon_id, provider }` |
| `ADDON_DELETION` | idem, id is the only guaranteed field | `AddonRemoved { addon_id }` |

There is **no addon runtime event** on CC — no "addon started/stopped/
healthy/unhealthy" notifications. We still poll the addon list every
30 s (`tick_addons`) to derive a healthy/unhealthy signal from list
membership.

### 3.4 Bruit

| Event | What we do |
|---|---|
| `CLEVER_TOOLS_REQUEST` | Ignore. Fires on every `clever` CLI call, not useful for visualisation. |

### 3.5 Expected but unseen

- `APPLICATION_START` / `APPLICATION_DEPLOY` — likely from the
  "Start" button on a stopped app. Our samples only saw
  `APPLICATION_REDEPLOY`.
- `APPLICATION_SCALE` — flavor or instance-count change.
- `DEPLOYMENT_CANCEL`, `DEPLOYMENT_IN_PROGRESS` — intermediate states.
- `NETWORK_GROUP_*` — network-group actions, mentioned in CC docs.

Receiver handles all of them by logging `warn!("unhandled CC webhook
event type: {event}")` and returning `204`.

## 4. Receiver internals

`backend/src/webhooks/receiver.rs:handle()` steps:

```
POST /webhooks/cc/:token
├── webhook_configs::find_by_token(token) → (user_id, cc_org_id)   401 on miss
├── serde_json::from_str::<WebhookEnvelope>(body)                   warn + 204 on parse error
├── dedup_cache.record((event, resource_id, deployment_id?, date))  204 if duplicate
├── envelope.routing() → { owner_id, resource_id, … }               204 if unroutable
├── owner_id matches cfg.cc_org_id                                  warn + 204 on mismatch
├── update AppState.failed_apps (insert on FAIL, remove on others)
├── envelope.to_frames(now) → Vec<WsFrame>
└── for each frame: ws_bus.get(org_id)?.tx.send(frame)              log push N/M
```

### Deduplication

CC occasionally sends two or three copies of the same event within
100-300 ms. `DedupCache` is a `DashMap<String, Instant>` keyed by
`event|resource_id|deployment_id|date`, with a 60 s TTL. Memory is
capped at 10 000 entries, GC'd lazily on insertion.

### Sticky failed

When a `DEPLOYMENT_FAIL` arrives, the `app_id` is inserted into
`AppState.failed_apps: DashMap<String, Instant>`. The 10 s status
poller checks this before emitting `AppStatus` for an app:

```rust
if let Some(failed_at) = state.failed_apps.get(&app.id) {
    if failed_at.elapsed() < FAILED_STICKY_WINDOW /* 10 min */ {
        continue;  // skip emission — don't overwrite red with CC's raw state
    }
    state.failed_apps.remove(&app.id);
}
```

Cleared by any lifecycle event that signals the user took action:
`DEPLOYMENT_SUCCESS`, `APPLICATION_REDEPLOY`, `APPLICATION_CREATION`,
`APPLICATION_STOP`, `APPLICATION_DELETION`, `GIT_PUSH`.

Without this, CC's `state` field (which doesn't reflect deployment
failures) would flip the building from red back to `deploying` or
`running` on the next 10 s tick.

## 5. Manual setup flow

myCCtown does NOT auto-register webhooks on the user's behalf. We
looked at it, but users have varying roles on their orgs — `developer`
users often don't have permission to create notification hooks, and
failing silently was worse than asking clearly.

The flow instead:

1. User clicks **⚡ Realtime setup** in the topbar (while viewing an org).
2. Modal (`components/layout/WebhookSetupModal.tsx`) fetches
   `GET /api/orgs/:id/webhook-setup`. If `USE_WEBHOOKS=false` or no
   `WEBHOOKS_PUBLIC_URL`, `enabled: false` → the modal explains status
   updates still come from polling, no setup needed.
3. Otherwise backend `insert_if_absent`s a row in `webhook_configs`
   with a fresh 48-hex token, and the response is:

   ```json
   {
     "enabled": true,
     "url": "https://mycctown-backend.cleverapps.io/webhooks/cc/<token>",
     "events": ["APPLICATION_CREATION", "APPLICATION_REDEPLOY", …],
     "console_url": "https://console.clever-cloud.com/organisations/orga_…/notifications",
     "configured": false
   }
   ```

4. User copies the URL, clicks the `console_url` link, opens
   *Notifications → Create webhook*, pastes the URL, checks the
   events, saves.

Subsequent deploys trigger webhooks → our receiver → WS frames →
scene updates in <2 s.

### Token rotation

Lost-token recovery:

```sql
-- get the current token
SELECT token FROM webhook_configs WHERE user_id = $1 AND cc_org_id = $2;

-- rotate: delete → insert_if_absent on next GET /api/orgs/:id/map
DELETE FROM webhook_configs WHERE user_id = $1 AND cc_org_id = $2;
```

The old token becomes a 401 on the receiver, and the user just needs
to re-run the setup flow with the new URL.

### Per-user tokens in a multi-member org

Two users of the same org each generate their own webhook row and
their own URL. Both URLs can coexist as two "myCCtown" hooks in CC
Notifications — the receiver routes each delivery to the right
`OrgBus` based on which token was hit. They see the same live updates
in their respective frontends.

## 6. Sniffer companion

`mycctown-sniffer/` (separate repo) is a minimal Go app that captures
webhook deliveries verbatim into PostgreSQL for offline analysis.
We used it to build the catalog above and we keep it running in prod
to catch new CC event types as they appear
(`NETWORK_GROUP_*`, `APPLICATION_SCALE`, …).

When you notice a new event on the sniffer that myCCtown doesn't
handle yet, follow [backend.md#handle-a-new-cc-webhook-event-type](backend.md).
