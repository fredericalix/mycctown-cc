# Backend (Rust)

`backend/` is an axum 0.8 service that wraps Clever Cloud OAuth, speaks
to the CC REST API on behalf of the logged-in user, serves a WebSocket
per org, and ingests webhook deliveries from CC.

## Stack

| Purpose | Crate |
|---|---|
| HTTP framework | `axum = { version = "0.8", features = ["ws", "macros"] }` |
| Async runtime | `tokio` (full features) |
| Database | `sqlx = { version = "0.8", features = ["runtime-tokio", "tls-rustls", "postgres", "uuid", "chrono", "migrate", "json"] }` |
| Sessions | `tower-sessions` + `tower-sessions-sqlx-store` (Postgres backend) |
| OAuth 1.0a signing | `hmac` + `sha1` |
| Payload crypto | `aes-gcm` (256-bit GCM) |
| Cache | `dashmap` |
| Error monitoring | `sentry 0.48` + `sentry-tower 0.48` (init in `main.rs` before tracing; see [observability.md](observability.md)) |

## Module map

```
src/
├── main.rs          # Router composition + middleware layering
├── config.rs        # `Config::from_env()` — all env vars
├── state.rs         # `AppState` shared across handlers
├── error.rs         # `AppError` + `impl IntoResponse`
├── api/
│   ├── mod.rs
│   ├── cc_client.rs   # Signed HTTP client for Clever Cloud's v2 API
│   ├── routes.rs      # /api/me, /api/orgs, /api/orgs/:id/apps, …
│   └── map_routes.rs  # /api/orgs/:id/map (GET/PUT)
├── auth/
│   ├── oauth.rs       # OAuth 1.0a HMAC-SHA1 signatures
│   ├── encryption.rs  # AES-GCM encrypt/decrypt helpers
│   ├── middleware.rs  # `AuthUser` extractor (from session)
│   └── routes.rs      # /auth/login, /auth/callback, /auth/logout
├── db/
│   ├── users.rs           # users (CC uuid → encrypted tokens)
│   ├── maps.rs            # maps (cells_json JSONB, version)
│   ├── warp10_tokens.rs   # 4.5 d cache of Warp10 read tokens
│   └── webhook_configs.rs # per-(user, org) webhook tokens
├── webhooks/
│   ├── event.rs       # CC payload structs + event → WsFrame mapping
│   ├── receiver.rs    # POST /webhooks/cc/:token handler + dedup cache
│   └── routes.rs      # Router for the receiver
├── ws/
│   ├── frame.rs       # `WsFrame` enum (serde tag="type")
│   ├── routes.rs      # /ws/orgs/:id/stream WebSocket handler
│   ├── poller.rs      # tick_status / tick_metrics / tick_addons
│   └── mod.rs         # `OrgBus` / `OrgChannel`
└── metrics/
    ├── tokens.rs         # Cached Warp10 read token (self-heals on decrypt fail)
    ├── warp10_client.rs  # HTTP client for `/api/v0/exec`
    └── templates.rs      # WarpScript snippets + result parsers
```

## Request flow

```
Incoming HTTP                                                   AppState
──────────────                                                  ────────
POST /webhooks/cc/:token                                       db: PgPool
 → webhooks::routes::router()   ← mounted OUTSIDE session      http_client
   → receiver::handle()                                        config
     → webhook_configs::find_by_token                          ws_bus
     → envelope.to_frames()                                    webhook_dedup
     → AppState.failed_apps update                             failed_apps
     → OrgChannel.tx.send(WsFrame)

GET /api/orgs
 → api::routes::router()         ← inside session layer
   → AuthUser extractor          ← reads tower-sessions
   → AuthUser::decrypt_cc_tokens
   → CcClient::new + list_orgs

GET /ws/orgs/:id/stream
 → ws::routes::router()          ← inside session layer
   → AuthUser extractor
   → maps::user_has_map          ← 403 if none
   → ensure_channel              ← spawns poller if missing
   → WebSocketUpgrade::on_upgrade
```

Middleware layering (see `main.rs`):

```rust
let mut app = Router::new()
    .route("/health", get(health))
    .merge(auth::routes::router())
    .merge(api::routes::router())
    .merge(api::map_routes::router())
    .merge(ws::routes::router());
// ↑ all these routes use AuthUser + session cookie

let mut app = app
    .layer(session_layer)                   // applies ABOVE only
    .merge(webhooks::routes::router())      // DOES NOT inherit session_layer
    .layer(TraceLayer::new_for_http());
```

Merging a router after `.layer()` means the session middleware is not
applied to the merged routes — so CC webhook POSTs (no cookie) don't
trigger a session cookie write on every delivery.

## Poller

`ws::poller::run(state, cc_org_id, owner_user_id, tx, …)` — one tokio
task per org, spawned lazily by `ensure_channel`.

Three interval ticks compete via `tokio::select!`:

| Tick | Default interval | Env var | What it does |
|---|---|---|---|
| `status_tick` | 10 s | `WS_POLL_STATUS_SECS` | `GET /v2/organisations/:id/applications` → emit `AppStatus` per mapped app |
| `metrics_tick` | 15 s | `WS_POLL_METRICS_SECS` | `ensure_token` → batched Warp10 CPU/RAM queries (see below) → emit `AppMetrics` + `AddonMetrics` |
| `addon_tick` | 30 s | *(hardcoded)* | `GET /v2/organisations/:id/addons` → emit `AddonStatus` per mapped addon |

### Batched addon metrics

`tick_metrics` resolves each mapped `addon_id` to its provider
`real_id` (e.g. `postgresql_<uuid>`, `elasticsearch_<uuid>`,
`redis_<uuid>`) via `list_addons`. Then it **chunks those real ids in
groups of `ADDON_BATCH_SIZE = 5`** and dispatches one WarpScript per
chunk concurrently with `futures_util::future::join_all`.

Motivation: a single 60-FETCH WarpScript (≈30 addons × 2 metrics)
exceeds the 30 s `reqwest` timeout on CC's Warp10 — every tick blew
up and the org saw 0 metrics forever. With 5-addon chunks each
subquery returns in 6-9 s and the wall time of the tick is the
slowest chunk, not the sum.

Partial failures are tolerated: if chunk #3 times out, the other 5
chunks still emit their metrics. The summary log reports
`chunks_failed` separately.

### Metrics template

`backend/src/metrics/templates.rs::cpu_ram_last_script` is
deliberately small now:

```
[ '<token>' 'cpu.usage_user' { 'app_id' '<id>' } NOW 5 m ] FETCH
MERGE 'cpu.usage_user' RENAME
[ '<token>' 'mem.used_percent' { 'app_id' '<id>' } NOW 5 m ] FETCH
MERGE 'mem.used_percent' RENAME
```

No `BUCKETIZE`. Previous versions used `bucketizer.mean` over 60 s
buckets (lag 3-5 min on a sudden CPU drop because old 100% samples
were averaged into the current bucket) and then `bucketizer.last`
over 30 s (half the buckets were empty because CC publishes every
60 s; we emitted 0%). Raw `FETCH + MERGE` and taking `points.last()`
in Rust (`split_cpu_ram`) is the freshest value CC has published —
no aggregation smoothing, no bucket gaps. Convergence on a
100 % → 0 % drop: ≤60 s.

### Status synthesis

CC returns `state = SHOULD_BE_DOWN` for both "stopped" and "never
deployed". We distinguish them using `last_deploy`:

```rust
let state_str = if app.last_deploy.is_none()
    && (raw_state.is_empty() || raw_state == "SHOULD_BE_DOWN" || raw_state == "WANTS_TO_BE_DOWN")
{
    "CREATED"         // frontend swaps to building_stage_B
} else {
    raw_state
};
```

### Sticky failed

`AppState.failed_apps: DashMap<app_id, Instant>`. Written by the
webhook receiver, read by `tick_status`. If the entry is present and
within `FAILED_STICKY_WINDOW` (10 min), the poller **skips** emission
for that app so CC's stale raw state can't overwrite a `failed`
building back to `running` or `deploying`.

Cleared by `DEPLOYMENT_SUCCESS`, `APPLICATION_REDEPLOY`,
`APPLICATION_CREATION`, `APPLICATION_STOP`, `APPLICATION_DELETION`,
`GIT_PUSH` — all events that signal the user took a new action.

### Session expiry

Two different decrypt sites can fail with `aead::Error` when
`ENCRYPTION_KEY` rotates:

1. **Warp10 token cache** (`metrics/tokens::ensure_token`) — the row
   was encrypted with an old key. We catch it, log a warn
   (`stale warp10 token for user=… — invalidating cache`), and
   re-fetch a fresh token from CC. Self-heals transparently; the
   user never notices.
2. **OAuth user tokens** (`poller::decrypt_owner_tokens`) — the
   `users.oauth_token_enc` row can't decrypt. This one really does
   require the user to re-login:

```rust
if is_auth_error(&e) {
    emit_session_expired_and_drop(&state, &cc_org_id, &tx);
    return; // stop the poller task
}
```

`emit_session_expired_and_drop` pushes a `SessionExpired` frame and
removes the org's `OrgChannel` from `ws_bus`. Dropping the last sender
makes existing subscribers see `RecvError::Closed` → the WS closes
→ frontend logs the user out + redirects to `/auth/login`. Next
reconnect creates a fresh channel + fresh poller with post-login
tokens.

Because the Warp10 cache path auto-heals, `SessionExpired` is now
only fired when the user's OAuth tokens themselves are un-decryptable.

## Webhook receiver

`POST /webhooks/cc/:token` — CC posts here when anything lifecycle-y
happens (deploys, stops, addon create/delete). See
[webhooks.md](webhooks.md) for the full catalog.

Order of operations in `receiver::handle`:

1. `webhook_configs::find_by_token(token)` → `(user_id, cc_org_id)`
   or 401.
2. `serde_json::from_str::<WebhookEnvelope>(&body)` — malformed →
   log + 204 (CC retries on 5xx, we don't want re-delivery spam).
3. Deduplication by `(event|resource_id|deployment_id|date)` in a
   60 s window via `DedupCache` (DashMap).
4. Routing check: `envelope.routing().owner_id == cfg.cc_org_id` — a
   webhook registered for org A mustn't accept events for org B.
5. Lifecycle tracking: update `AppState.failed_apps` per event type.
6. `envelope.to_frames(now)` → vector of `WsFrame`s.
7. Push each to `ws_bus.get(org_id).tx.send(frame)`.

Unknown event types (`NETWORK_GROUP_CREATION`, `APPLICATION_SCALE`
once we see them, etc.) log `warn!` and 204. The receiver never
crashes on unexpected payload shapes.

## Session auth

`tower-sessions` with a PostgreSQL store keeps session data
server-side (table created via `PostgresStore::migrate()`), the cookie
only carries a session id.

Cookie settings are computed from `APP_URL` vs `FRONTEND_URL`:

```rust
let cross_site = needs_cross_site(&config);  // different hosts?
let is_https = !is_dev_http(&config);        // APP_URL starts with https?
let same_site = if cross_site && is_https {
    SameSite::None
} else {
    SameSite::Lax
};
```

In prod today, `APP_URL == FRONTEND_URL == https://mycctown.cleverapps.io`
so `cross_site = false` and the session cookie is `SameSite=Lax;
Secure` — good across all browsers.

## Cheat sheets

### Add a new WS frame type

1. Add a variant to `WsFrame` in `src/ws/frame.rs`:
   ```rust
   #[serde(rename_all = "snake_case")]
   pub enum WsFrame {
       …
       MyNewFrame { app_id: String, payload: …, ts: i64 },
   }
   ```
2. Mirror the TypeScript union in `frontend/src/types/ws.ts`:
   ```ts
   | { type: 'my_new_frame'; app_id: string; payload: …; ts: number }
   ```
3. Handle it in `frontend/src/stores/useRealtimeStore.ts` `push()`
   switch, or in `useWsClient.ts` for side-effects.

### Handle a new CC webhook event type

1. Add the top-level block to `WebhookEnvelope` in
   `backend/src/webhooks/event.rs` if the payload brings a new
   field (rare — most events fit the `application` / `deployment` /
   `addon` blocks already defined).
2. Extend the `match self.event.as_str()` in `to_frames()`:
   ```rust
   "NETWORK_GROUP_CREATION" => self.network_group.as_ref().map(|ng| vec![
       WsFrame::NetworkGroupAdded { id: ng.id.clone(), ts },
   ]).unwrap_or_default(),
   ```
3. Wire the `AppState.failed_apps` clearing rule in
   `receiver::handle` if the event represents lifecycle progress.
4. Add the event string to `SUBSCRIBED_EVENTS` so the "Realtime
   setup" modal suggests it to users.

### Add a new DB migration

1. Create `backend/migrations/00N_<name>.sql` — sqlx applies them in
   order on boot (`sqlx::migrate!("./migrations").run(&db).await?`
   in `main.rs`).
2. Add a matching module under `backend/src/db/`. Reuse
   `sqlx::FromRow` + `sqlx::query_as::<_, MyRow>("…")` patterns.
3. Export it from `backend/src/db/mod.rs`.

Always test with `cargo run` locally against a dev PG — sqlx
migrations are append-only, no down scripts.

### Cope with an addon provider that doesn't publish CPU/RAM

Some providers (Cellar S3, config-provider, fs-bucket) have no
running VM to scrape — Warp10 returns empty. Expected behavior:
`split_cpu_ram` doesn't find the `real_id`, `tick_metrics` emits
`AddonMetrics { cpu_pct: 0.0, ram_pct: 0.0 }`, frontend shows the
gauges at 0. No action needed; storage-only services legitimately
have no CPU or memory signal.

If you want to surface "N/A" instead of "0%", the change is
frontend-only: in `useRealtimeStore.push()` for `addon_metrics`,
keep `cpuPct: null` when the incoming value is 0 and the last
known value was also 0 for N consecutive ticks.

### Run a poller tick manually (debugging)

The poller task is self-contained. To reproduce a tick outside axum:

```rust
use mycctown_backend::ws::poller::run;
// or import the tick functions directly if you make them pub(crate)
```

For a one-shot check, run the backend in dev mode with
`RUST_LOG=debug cargo run` and watch the `status tick: emitted N/M`
debug lines.

## Local development

```bash
cd backend
cp .env.example .env         # fill POSTGRESQL_ADDON_URI, CC_OAUTH_*,
                             # ENCRYPTION_KEY (openssl rand -base64 32)
cargo run                    # axum listens on :8080
```

The frontend's Vite dev server (`cd frontend && npm run dev`) proxies
`/api /auth /ws` to `localhost:8080` (see `vite.config.ts`), so the
two run side-by-side without CORS gymnastics.

Tests:

```bash
cargo test webhooks::event::tests    # five unit tests, no PG required
```

No integration tests yet — most "does this talk to CC correctly" is
verified via `curl` against prod-like smoke tests, see
[deployment.md](deployment.md).
