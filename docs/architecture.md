# Architecture

## One picture

```
  Browser (mycctown.cleverapps.io)                Clever Cloud
  ┌───────────────────────────┐
  │  Node + Express           │
  │  - serves dist/ (static)  │
  │  - proxy /api /auth /ws   │  ───────►  backend
  └───────────────────────────┘                   │
                                                  ▼
                                   ┌──────────────────────────┐
                                   │  Rust + axum             │
                                   │  - /auth/login (OAuth)   │
                                   │  - /api/orgs, apps, …    │
                                   │  - /ws/orgs/:id/stream   │
                                   │  - /webhooks/cc/:token   │
                                   └──┬─────────┬─────────────┘
                                      │         │
                     OAuth signed     │         │    SELECT / INSERT
                                      ▼         ▼
                        Clever Cloud API   PostgreSQL addon
                        (/v2/organisations,  (mycctown-db: users,
                         apps, addons,        maps, warp10_tokens,
                         metrics token)       webhook_configs)

                    ◄─── Webhooks (POST)
                        CC Notification Hooks ──►  /webhooks/cc/:token
                                                   (outside session layer;
                                                    token auth only)

   Browser <audio>  ──►  <your-music-bucket>.cellar-c2.services.clever-cloud.com
                         (Cellar bucket — public-read MP3 ambient tracks,
                          separate origin so audio doesn't queue on the
                          app's HTTP/2 connection)
```

## The two apps

We run **two Clever Cloud apps** under the same org, on two subdomains of
`cleverapps.io`:

| App | Type | Domain | Role |
|---|---|---|---|
| `mycctown` | Node 24 | `mycctown.cleverapps.io` | Static assets + reverse proxy |
| `mycctown-backend` | Rust (stable) | `mycctown-backend.cleverapps.io` | OAuth, REST, WS, webhooks |

The browser talks to `mycctown.cleverapps.io` for the app shell, the
REST API and the WebSocket. The only resource served from a different
origin is the ambient music — MP3s sit in a Cellar (S3-compatible)
bucket at `<your-music-bucket>.cellar-c2.services.clever-cloud.com` and are
streamed via standard `<audio>`. Keeping audio off the app domain
matters: when both shared the same HTTP/2 connection, the browser
queued audio fetches behind the ~404 GLTF requests at boot and music
took a minute to start.

The Node server (`frontend/server.mjs`) does four things:

1. Serve the built Vite bundle (`dist/`). Vite-hashed bundles
   (`assets/index-XYZ.js|css|woff2`) get `Cache-Control: max-age=
   31536000, immutable` (legitimate — content-addressed URLs); every
   other asset (gltf, bin, png) gets `max-age=3600, must-revalidate`.
   `index.html` is `no-cache, must-revalidate` so a fresh deploy lands
   on the next page load. Don't put `immutable` on non-hashed paths —
   we got bitten when a broken deploy got pinned in browser caches
   for hours with no way to revalidate.
2. Gzip everything except already-compressed binaries (`.bin`, `.png`,
   `.mp3`, …) and any request carrying a `Range:` header. The latter
   matters because `compression` mangles 206 responses (drops
   Content-Length, forces chunked) and HTTP/2 framing breaks behind
   the CC edge → `<audio>` Range requests would hit
   `ERR_HTTP2_PROTOCOL_ERROR`.
3. Forward `/api/*`, `/auth/*`, `/ws/*` to the backend with
   `http-proxy-middleware` (`pathFilter` keeps the URL prefix intact).
4. Upgrade WebSocket connections at `server.on('upgrade', proxy.upgrade)`.

### Why same-origin?

`cleverapps.io` sits on the Public Suffix List, so browsers treat
`mycctown.cleverapps.io` and `mycctown-backend.cleverapps.io` as
**independent sites**. Cross-site cookies need `SameSite=None; Secure`
AND the user's browser to allow third-party cookies — Safari and Firefox
block them by default. A session cookie scoped to the backend domain
never reached `/api/me` fetched from the frontend, and OAuth silently
failed for half our users.

The proxy moves `Set-Cookie` onto the frontend domain, so the cookie is
first-party everywhere. `APP_URL` = `https://mycctown.cleverapps.io`
(the backend's own `APP_URL` is set to the frontend domain, because
that's where the browser-facing callback URL lives).

## Data flow

### 1. Login

1. User hits `GET /auth/login` on `mycctown.cleverapps.io` (proxy →
   backend).
2. Backend requests a temporary OAuth token from CC
   (`/v2/oauth/request_token_query`, signed HMAC-SHA1 with consumer
   key + secret), stashes it in an `oauth_state` cookie, redirects to
   `https://api.clever-cloud.com/v2/oauth/authorize?oauth_token=…`.
3. User approves on CC. CC 302s back to
   `{APP_URL}/auth/callback?oauth_token=…&oauth_verifier=…`.
4. Backend validates the state cookie, exchanges the temporary token
   for an **access token + secret**, AES-GCM encrypts both with
   `ENCRYPTION_KEY`, `UPSERT INTO users (…)`, then writes `user_id`
   into the tower-sessions session and 303s back to `{FRONTEND_URL}/`.

The session cookie is `mycctown.sid`, `HttpOnly; Secure; SameSite=Lax`
(because `APP_URL == FRONTEND_URL`, `cross_site` is false).

### 2. Opening an org

1. Frontend calls `GET /api/orgs`. Backend signs an OAuth request to
   `/v2/organisations`, returns the list.
2. User picks an org → frontend calls `GET /api/orgs/:org_id/map` which
   `get_or_create`s a row in the `maps` table. When
   `USE_WEBHOOKS=true`, the same call also lazy-provisions a row in
   `webhook_configs` (one fresh token per `(user, org)`).
3. Frontend opens `wss://mycctown.cleverapps.io/ws/orgs/:org_id/stream`.
   Backend validates the session and that the user has a map for the
   org (403 otherwise), spawns or reuses a **per-org poller**, and
   starts broadcasting `WsFrame`s.

### 3. Live status

Two sources feed the same `broadcast::Sender<WsFrame>`:

**Poller** (`backend/src/ws/poller.rs`) — one tokio task per active
org. Three ticks in `tokio::select!`:

- `tick_status` (default every 10 s): `GET /v2/organisations/:id/applications`,
  emits `WsFrame::AppStatus` per mapped app. Skips emission for apps
  still in the sticky-failed window (see below).
- `tick_metrics` (every 15 s): fetches a Warp10 token (cached 4.5 days
  in DB, self-heals + re-fetches on decrypt failure). Addon `real_id`s
  are chunked into groups of 5 and queried concurrently via
  `futures_util::future::join_all` — the wall time of the tick is the
  slowest chunk, partial failures are tolerated. Emits
  `WsFrame::AppMetrics` / `WsFrame::AddonMetrics`.
- `tick_addons` (every 30 s): `GET /v2/organisations/:id/addons`,
  derives "healthy" from membership in the list, emits
  `WsFrame::AddonStatus`.

**Webhooks** (`backend/src/webhooks/receiver.rs`) — `POST
/webhooks/cc/:token`. Looks up the token in `webhook_configs`, parses
the CC envelope, deduplicates on
`(event, resource_id, deployment_id, date)` within a 60 s window, maps
the event to one or more `WsFrame`s, and pushes them on the same
broadcast channel the poller uses.

Both sources share a `AppState.failed_apps: DashMap<app_id, Instant>`.
Set by the receiver on `DEPLOYMENT_FAIL`, cleared by
`DEPLOYMENT_SUCCESS / APPLICATION_REDEPLOY / GIT_PUSH / STOP /
CREATION / DELETION`. The poller checks it before emitting, so a
red-building asset can't be "healed" back to green by a CC lifecycle
poll that doesn't see deployment failures.

### 4. Frontend receives

`frontend/src/ws/useWsClient.ts` opens the WS, writes each frame into
`useRealtimeStore`. Every `HexTile` selector-subscribes on just the
fields it needs (status, cpuPct) so one frame touches a handful of
React nodes, not the whole scene. Status drives the GLTF variant
swap (`frontend/src/utils/statusVisual.ts`) and the particle effects
(`frontend/src/components/scene/StatusParticles.tsx`, which is the
"on fire" effect we went hard on for `failed`).

## Key design choices

### Cookie scope
`APP_URL == FRONTEND_URL` → `cross_site = false` → `SameSite=Lax` →
same-origin cookies. A separate `WEBHOOKS_PUBLIC_URL` = backend domain
tells the backend what URL to embed in webhook registrations (CC posts
directly to the backend, no need to go via the proxy).

### Webhook auth
No HMAC on CC webhooks. Our only secret is a 48-hex token in the URL
(`openssl rand -hex 24` shape), unique per `(user, org)`. Lost-token
recovery = delete the row, user opens the app → fresh token generated
on next map load.

### Sticky sessions
`clever config set sticky-sessions true` on the backend. The WS bus
(`ws::OrgBus`) is in-memory per instance. With multiple instances and
no stickiness, a WS reconnect could land on an instance that never
received the webhook that was routed to another.

### Encryption
`ENCRYPTION_KEY` is AES-GCM 256-bit base64. Applied to:

- `users.oauth_token_enc` / `.oauth_secret_enc` — user CC access token.
- `warp10_tokens.token_enc` — cached Warp10 read token.

If the key rotates, existing rows become un-decryptable. We treat the
two cases differently:

- **Warp10 cache decrypt fails** → `ensure_token` logs
  `stale warp10 token for user=… — invalidating cache`, deletes the
  row, re-fetches from CC. Self-heals transparently; the user sees
  no disruption.
- **OAuth user token decrypt fails** → poller can't call the CC API
  on behalf of the user. Emits `WsFrame::SessionExpired`, frontend
  logs the user out + redirects to OAuth. Next login re-encrypts the
  tokens with the current key.

### Addon metrics scaling
CC's Warp10 `FETCH` gets expensive per-query; a single WarpScript
containing 60 FETCH blocks (30 addons × CPU+RAM) regularly exceeded
our 30 s `reqwest` timeout on the ES-heavy org we tested with. The
poller chunks the addons into batches of 5 and runs the sub-queries
concurrently with `join_all`. Wall time ≈ slowest sub-query
(typically 6–9 s), not the sum. Partial failures are counted
separately so a one-off hiccup doesn't blank the whole tick.

### Same-origin proxy strategy on CC
We looked at `git subtree push` for monorepo deploys, then found the
`APP_FOLDER` env var (per
[fredalix.com blog](https://blog.fredalix.com/p/deploiement-sur-clever-cloud-dun-backend-code-en-go-et-dune-application-web-reactjs/)).
Each app runs `cd $APP_FOLDER && npm/cargo …`. One commit, one push,
two apps deploy from their own subtree.

## Component lifecycle cheat sheet

When a new WS connection opens for an org:

1. `ws::routes::stream()` validates session + map ownership.
2. `ensure_channel()` either returns the existing `OrgChannel.tx` or
   creates a new one and spawns `poller::run(…)` as a detached tokio
   task.
3. `handle_socket()` bumps `subscriber_count`, subscribes to `tx`,
   forwards frames to the WS client.
4. On WS close → `cleanup()` fetch_subs the counter; if zero
   remaining, schedules a 30 s grace timer. If no one reconnects in
   that window, the channel is removed and the poller is aborted.
5. On OAuth auth failure from inside the poller → send
   `SessionExpired`, remove the channel, return. Clients get
   `RecvError::Closed` → WS close → reconnect path → fresh poller
   with post-login tokens.
