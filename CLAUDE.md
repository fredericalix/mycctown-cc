# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

myCCtown is a near-real-time Clever Cloud organisation viewer rendered as a medieval 3D hex city. One map per org, one building per app or addon, live status + CPU/RAM piped in via a per-org WebSocket.

Monorepo with two deployable apps under a single git root:

- `backend/` — Rust 2024 + axum 0.8 + sqlx (PostgreSQL) + tower-sessions
- `frontend/` — React 18 + Vite 6 + TypeScript + @react-three/fiber + Zustand + Tailwind v4 / daisyui
- `docs/` — developer + user documentation (read these **before** touching a module you don't know)

**Two parallel CC environments**, same shape, separate apps + DB + OAuth consumer:

| Env  | Frontend                        | Backend                                 | DB              | OAuth consumer |
|------|---------------------------------|-----------------------------------------|-----------------|----------------|
| prod | `mycctown.cleverapps.io`        | `mycctown-backend.cleverapps.io`        | `mycctown-db`   | `myCCtown`     |
| dev  | `mycctown-dev.cleverapps.io`    | `mycctown-backend-dev.cleverapps.io`    | `mycctown-db-dev` | `myCCtown-dev` |

The prod stack runs on `*-frontend` / `*-backend` aliases (no suffix on the front-end name, but the alias is `mycctown-frontend`). The dev stack mirrors it with a `-dev` suffix on every alias and on the frontend app name. Both share the same Cellar music bucket and the same GlitchTip projects (events tagged via `SENTRY_ENVIRONMENT`).

**Dev is the default working environment.** When working on the code, target the `*-dev` aliases for any mutating command (`clever deploy`, `env set`, `restart`, `scale`, `stop`, `domain`, `addon delete`, `link-addon`). **Prod aliases require explicit, per-session authorization from the user** — a single prior approval does not extend to later prod actions in the same conversation. Read-only commands (`clever logs`, `env`, `applications`, `status`, `activity`, `addon list`) and read-only `psql` SELECTs against prod (per the existing memory) remain free. Local commands that pull a prod secret into the shell (`ENCRYPTION_KEY`, `SENTRY_DSN`, etc. for a local `cargo run` / `npm run dev`) also require asking first.

## Commands

### Backend (Rust)

```bash
cd backend
cp .env.example .env   # fill POSTGRESQL_ADDON_URI, CC_OAUTH_*, ENCRYPTION_KEY
cargo run              # :8080, sqlx auto-migrates on boot
cargo test webhooks::event::tests   # only unit tests that exist; no PG needed
cargo check            # fast feedback
```

### Frontend (React + R3F)

```bash
cd frontend
npm install
npm run dev            # Vite dev on :3000, proxies /api /auth /ws → :8080
npm run typecheck      # tsc --noEmit
npm run build          # tsc + sync-docs-img + sync-music + vite build → dist/
```

The `sync-docs-img` step copies `docs/img/*.png` into `public/docs/img/` so the in-app `/docs` page can serve screenshots — edit a screenshot in `docs/img/` and rebuild. The `sync-music` step copies `music/*.mp3` into `public/music/` (used as a local-dev fallback only — prod streams MP3s from a Cellar bucket; see Gotchas below).

### Deploy to Clever Cloud

This is an `APP_FOLDER` monorepo — one git root, two Clever Cloud apps, each pointed at a subdirectory. The full setup is codified in [docs/deployment.md](docs/deployment.md); the cheat sheet below is the day-to-day deploy and ops.

**Always `cd` into the app subdirectory before every `clever` command** — per the [fredalix.com monorepo rule](https://blog.fredalix.com/p/deploiement-sur-clever-cloud-dun-backend-code-en-go-et-dune-application-web-reactjs/). The CLI picks up the `.clever.json` alias from the current directory, and `clever deploy` pushes the app's subtree to the right CC remote. Running from the repo root with `--alias` alone is **not** guaranteed and has bitten us before.

```bash
# Dev (default) — wrapper handles the cd-to-subdir per app
./scripts/setup-dev-env.sh deploy             # both apps
./scripts/setup-dev-env.sh deploy backend     # one side only

# Prod (only after explicit user authorization in the current session)
cd backend  && clever deploy --alias mycctown-backend
cd frontend && clever deploy --alias mycctown-frontend
```

The dev stack is managed by `./scripts/setup-dev-env.sh <command>`:
- `create` — provision (idempotent: apps + Postgres + OAuth consumer + env vars, no deploy)
- `status` — print state of every dev resource
- `deploy [backend|frontend]` — deploy from the current branch (handles the `cd <subdir>`)
- `start` / `stop` / `restart` — both apps in one go (`start` needs at least one prior deploy)
- `destroy` — delete apps + addon + OAuth consumer (interactive confirm; `--yes` to skip)

See `docs/deployment.md` §9 for what each does + the ops cheat sheet for `-dev` aliases.

#### How APP_FOLDER works (and where it doesn't)

- **`APP_FOLDER=./backend` / `./frontend`** — Clever Cloud `cd`s into that directory before running the build + start commands for the main app. The backend's `cargo build` and the frontend's `node server.mjs` both see the subdir as their CWD.
- **`CC_POST_BUILD_HOOK` runs from the repo root**, *not* from `APP_FOLDER`. That's why the frontend's hook is `npm --prefix ./frontend run build` — the `--prefix` is load-bearing.
- **`CC_RUN_COMMAND="npm --prefix ./frontend run start"`** on the frontend for the same reason (defensive even though APP_FOLDER has changed CWD by start time).
- **`CC_NODE_DEV_DEPENDENCIES=install`** tells CC to install devDependencies before the build hook (we need `vite`, `typescript`, etc. at build time).

If you're adding a third app or renaming one, read `docs/deployment.md` §1–2 end-to-end before touching env vars — several of them interact (APP_FOLDER, CC_*, VITE_BACKEND_URL, BACKEND_URL, APP_URL, FRONTEND_URL, WEBHOOKS_PUBLIC_URL).

#### Common ops (the clever-tools commands we actually use)

```bash
# Substitute -dev for any mutating command. Reads are free against either alias.

# Tail logs (read-only — fine on prod or dev)
clever logs --alias mycctown-backend --since 1h
clever logs --alias mycctown-frontend --search "upgrade|WS|webhook"

# Inspect env vars (read-only)
clever env --alias mycctown-backend

# Change env vars (mutating — default to -dev, ask before targeting prod)
clever env set --alias mycctown-backend-dev MY_VAR value

# SSH into the running backend instance (useful for prod DB reads, see below)
clever ssh --alias mycctown-backend --command 'psql "$POSTGRESQL_ADDON_URI" -c "SELECT …"'

# Restart / scale (mutating — default to -dev)
clever restart --alias mycctown-frontend-dev
clever scale   --alias mycctown-frontend-dev --flavor S --build-flavor S

# Force a rebuild of the same commit (mutating — default to -dev)
clever deploy  --alias mycctown-frontend-dev --same-commit-policy rebuild
```

#### Prod DB reads

For **mycctown only**, the user has authorized pulling `POSTGRESQL_ADDON_URI` into the conversation and running `psql` locally (simpler than the SSH dance). Read-only SELECTs are fine; treat writes as requiring explicit per-query approval. Don't extend this to any other project without asking.

## Architecture in one breath

```
browser ──► mycctown.cleverapps.io (Node + Express reverse proxy)
              │  serves dist/ static (gltf/bin/png + Vite bundle)
              │  proxies  /api /auth /ws → backend  (keeps cookies first-party)
              ▼
            mycctown-backend.cleverapps.io (axum)
              │  OAuth 1.0a ─► Clever Cloud API
              │  per-org poller task (status 10s, metrics 15s, addons 30s)
              │  Warp10 token cache + chunked concurrent metric queries
              │  receiver: POST /webhooks/cc/:token  (outside session layer)
              ▼
            PostgreSQL addon (users, maps, warp10_tokens, webhook_configs)

         (separate origin)
       <your-music-bucket>.cellar-c2.services.clever-cloud.com
              │  Cellar bucket, public-read MP3s
              ▼
            Browser <audio> for ambient music — independent origin
            so the audio stream doesn't queue behind the GLTF fetches
            on the app's HTTP/2 connection.
```

Two sources feed every org's broadcast channel (`broadcast::Sender<WsFrame>`): the poller (safety net, always on) and CC webhooks (sub-second, best effort). A `DashMap<app_id, Instant>` called `failed_apps` is the sticky lock that keeps "red building" from being healed back to "green" by a CC status poll that doesn't see the failure.

**The two docs to read before making architectural changes:**

- `docs/architecture.md` — cookie scoping, data flow, key design choices.
- `docs/backend.md` §Poller and §Session expiry — the `ADDON_BATCH_SIZE = 5 + join_all` chunking, the two `aead::Error` decrypt sites (Warp10 cache self-heals; user OAuth tokens fire `SessionExpired`).

For the frontend, `docs/frontend.md` has the scene-pipeline table and the BuildingEffects / non-linear CPU curve / village-lights details.

## Gotchas that have already bitten us

### Open-source mirror: paid assets stay private

The repo is published as the AGPL-3.0 mirror `fredericalix/mycctown-cc` via `git archive HEAD`, which honours `.gitattributes` `export-ignore`: the KayKit SOURCE assets (`frontend/public/assets/gltf/`), `assets/samples/`, `music/`, `frontend/public/mayor/` and `a-faire-bientot.md` never leave this private repo. They are also listed in `.gitignore` for the public side, so **adding a new file there needs `git add -f`**. Public users install the models with `npm --prefix frontend run assets:install` (reads the purchased `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip`); `predev`/`prebuild` run `assets:check` and fail fast when they are missing — see `docs/ASSETS.md`. Real deployment identifiers (org, app ids, music bucket, GlitchTip) live in the git-ignored `CLAUDE.local.md`; tracked docs use placeholders. Never push this repo's history to the public mirror.

### Same-origin cookies

`cleverapps.io` is on the Public Suffix List → `mycctown.cleverapps.io` and `mycctown-backend.cleverapps.io` count as **different sites**. Safari + Firefox third-party cookie blocking killed session auth. Solution: `frontend/server.mjs` reverse-proxies `/api /auth /ws` so cookies stay first-party. Don't revert to a cross-origin setup.

### Zustand selectors must return primitives or direct refs

Synthesising `{ status, cpu }` inside a selector triggers `Object.is` mismatch on every store update → infinite render loop. Either return a primitive or a direct store reference (not a new object). See the comment block in `StatusBadge.tsx` for the original incident.

### Sticky failed window

Webhook receiver sets `failed_apps[app_id] = Instant::now()` on `DEPLOYMENT_FAIL`. Poller skips emission while inside the 10-min `FAILED_STICKY_WINDOW`. Cleared by lifecycle events that signal user action (`DEPLOYMENT_SUCCESS`, `APPLICATION_REDEPLOY`, `GIT_PUSH`, etc.). If you add a new lifecycle event, wire it into both `to_frames()` AND the `failed_apps` clearing rule in `receiver::handle`.

### Warp10 cache self-heals, OAuth tokens don't

Two different decrypt failures live on `aead::Error`. `metrics/tokens::ensure_token` swallows it, logs `stale warp10 token for user=… — invalidating cache`, refetches. `poller::decrypt_owner_tokens` fires `SessionExpired` → WS closes → frontend forces re-login. Treat these as separate error paths.

### Addon metrics are chunked

A single WarpScript with 60 `FETCH` blocks (30 addons × CPU+RAM) blew past reqwest's 30 s timeout. `backend/src/ws/poller.rs` chunks addon `real_id`s into groups of `ADDON_BATCH_SIZE = 5` and runs them concurrently via `futures_util::future::join_all`. Partial failures tolerated; `chunks_failed` logged separately. Don't collapse back to a single-query script without re-testing on a 30-addon org.

### Metrics template — no BUCKETIZE

`backend/src/metrics/templates.rs` is deliberately plain `FETCH + MERGE` with no `bucketizer.*`. Previous `bucketizer.mean / 60 s` gave 3–5 min lag on a 100 %→0 % drop (old samples averaged into new bucket). `bucketizer.last / 30 s` was empty half the time because CC publishes every 60 s. Current convergence on a sudden drop: ≤60 s. Don't add smoothing without understanding the trade-off.

### `/docs` page scroll container

`html, body, #root { height: 100% }` is set globally so the 3D scene doesn't overflow. That kills window scroll on the docs route. `components/docs/DocsPage.tsx` is its own `overflow-y: auto` container; scroll listeners, `IntersectionObserver` root, and `BackToTop` all use a ref to the container (not `window`). If you change the outer div height, update these three call sites together.

### Non-linear CPU → windmill speed

`frontend/src/three/useAnimations.ts` uses `0.3 + pow(cpu/100, 1.8) × 4.7` — 100 % CPU ≈ 5× idle speed. The linear 0.3→2 version didn't read as saturation from the overview camera. Keep the power curve unless the UX reason changes.

### Every building lights up at night

`HexTile` adds a `PointLight(0xffaa44, 0, 3.5, 2)` to `villageLightsRef` for every cell with a `building`. `useDayNight` ramps all of them together. There used to be a `LIT_BUILDINGS` whitelist; it was removed. Don't reintroduce it.

### Ambient music = different origin

The `<audio>` element in `useAmbientMusic.ts` reads `import.meta.env.VITE_MUSIC_BASE_URL` (set on the frontend CC app to the Cellar public URL) and falls back to `/music` for local dev. Don't fold the MP3s back under the app domain — they'd contend with the GLTF fetches on the same HTTP/2 connection, and the browser would queue the audio behind the assets (we measured >60 s startup that way). When you add tracks, upload them to the Cellar bucket via `s3cmd put --acl-public`; the catalogue list is hardcoded in `useAmbientMusic.ts`. Compression of media files is also explicitly skipped in `server.mjs` because the `compression` middleware mangles 206 Range responses for `<audio>` and triggers `ERR_HTTP2_PROTOCOL_ERROR` behind the CC edge.

### Lazy-load colored building variants

The catalogue has 5 colors × 55 buildings + 184 non-color assets ≈ 404 GLTFs. `assetLoader.loadInitialAssets` only loads the always-needed assets (tiles, decorations, neutral buildings) **plus a single dominant color** (currently `green` — running apps are the common case). Other colors arrive on-demand when a `HexTile` first wants a building variant that isn't cached: it calls `useAssetStore.ensureColorLoaded(color)`, swaps in `building_stage_B` as a scaffold placeholder, and re-renders once the color batch finishes (the `loadedColors: Set` reference change triggers the placement effect). If you change the catalogue layout, keep `BUILDING_COLORS` in `assetCatalog.ts` aligned with `assetIdForStatus` in `statusVisual.ts` — the latter decides which color id to ask for, the former decides which colors are batched-on-demand.

### Cache-bust via `?v=N`, not paths

Static asset paths under `/assets/gltf/` aren't content-hashed (Vite only hashes the JS/CSS bundles). To evict a stale deploy from browser/proxy caches, `assetLoader.ts` sets up a `THREE.LoadingManager.setURLModifier` that appends `?v=${ASSET_VERSION}` to every GLTF/BIN/PNG fetch. **Bump `ASSET_VERSION` in `assetLoader.ts:14` whenever you change the contents of `public/assets/gltf/` in a way that's not backwards-compatible** (e.g., re-encoding `.bin` payloads, swapping the texture atlas). The Vite bundle hash also changes (because the source changed), so `index.html` (which is `no-cache`) pulls the new bundle, and the new bundle requests `xxx.gltf?v=N+1`, an URL that's not in any cache → fresh fetch. Without this, immutable-cache holders are stuck for hours after a content change.

### `Cache-Control: must-revalidate` for non-hashed assets

`server.mjs` distinguishes Vite-hashed bundles (`assets/index-XXX.js|css|woff2`) from the rest of `/assets/` via the `VITE_HASHED` regex. Hashed bundles get `max-age=31536000, immutable` (legitimate — content-addressed); non-hashed (gltf/bin/png) get `max-age=3600, must-revalidate`. **Never put `immutable` on non-hashed paths** — once a bad version reaches a client cache it's locked there until the TTL expires, with no way to revalidate.

### Meshopt compression is on hold (don't re-enable blindly)

`scripts/compress-gltf.mjs` and `gltfpack` are kept in tree but the `compress-gltf` step is **removed from the `build` script** in `package.json`. `gltfpack -cc` (v1.1.0) produces files that crash Three.js 0.172's `MeshoptDecoder` on a subset of assets (`wall_*`, `cloud_*`, `hill_*`, `building_stage_*`, …) with `Malformed buffer data: -1`. Investigation routes are listed in `a-faire-bientot.md` §2 — read that before re-enabling. The cumulative gain expected is ~4× on top of lazy-by-color (~16× total vs. baseline).

### HTTP/2 blips after long idle — retry, don't fail

A tab left idle for ~1–2 h on `mycctown.cleverapps.io` can resume on a stale HTTP/2 session that the CC edge already closed. The first burst of fetches (lazy color load + `/api/orgs/.../addons`) then surfaces as `ERR_HTTP2_PROTOCOL_ERROR` / `Failed to fetch` on the client while the backend logs are completely clean. To self-heal: `loadEntries` in `assetLoader.ts` wraps `loadAsync` in `retryWithBackoff` (3 attempts, 300 ms base, jitter), and `api()` in `client.ts` does the same on idempotent methods (GET/HEAD) for `TypeError` and 502/503/504. Failures past the retries fall through to `debug.error('asset', …)` / `ApiError`. Don't strip these retries — without them an asset stays orange / the addons panel stays empty until the user does a hard reload.

### Debug logger toggle + Sentry forwarding

`frontend/src/utils/debug.ts` exposes `debug.log/warn/error(scope, ...)`. Console output activates when *any* of these is true (evaluated once at module load): `import.meta.env.DEV`, `import.meta.env.VITE_DEBUG_LOGS === 'true'`, `localStorage['mycctown.debug'] === '1'`, or `?debug=1` in the URL (the URL form auto-persists to localStorage so it survives a reload). Disabled = console-silent for `log/warn`; `error` always logs to console.

**Independent of the console toggle**, every `debug.*` call now also goes to GlitchTip via Sentry: `log/warn` → `Sentry.logger.{info,warn}` (visible in the Logs stream), `error` → `Sentry.captureException`/`captureMessage` (creates an issue) **plus** `Sentry.logger.error`. Use `debug.*` for any new instrumentation instead of bare `console.*` — you get the runtime console toggle, GlitchTip Logs, and issue creation from the same call.

### Sentry/GlitchTip wiring

Three load-bearing details (full details in `docs/observability.md`):

1. **Rust SDK has no structured Logs API yet.** `sentry` crate 0.48 only converts `tracing::error!` into events and `tracing::info!`/`warn!` into breadcrumbs. There's no `sentry::logger::info` or `enable_logs: true`. Don't pull `sentry-log` blindly — it would forward `log` crate output as events and double up with `tracing`. Backend logs reach GlitchTip as issue events, not as a dedicated Logs stream.
2. **Axum layer order.** In `backend/src/main.rs` the chain is `.layer(SentryHttpLayer::new().enable_transaction()).layer(NewSentryLayer::<Request>::new_from_top())`. Axum applies layers innermost-first, so `SentryHttpLayer` must be `.layer()`-ed **before** `NewSentryLayer`. Reversing them leaks the per-request hub (per `sentry-tower` docs).
3. **Sourcemap debug IDs are unique per build.** `@sentry/vite-plugin` embeds a UUID in both `.js` and `.js.map` at build time and uploads the bundle to GlitchTip keyed on that UUID. A sourcemap uploaded from your local `npm run build` does NOT match the prod bundle (different UUID). Always rebuild + upload from the same machine where the deployed bundle is built — on Clever Cloud that means `SENTRY_AUTH_TOKEN` set on the frontend app and the CC build hook does the upload. Without the token the plugin is a no-op (silent skip).

## Writing conventions that are load-bearing

- **`docs/user-guide.md` is for end users** — no `.ts` file references, no `WebSocket` / `POST` / `PostgreSQL` / `debounce` / `OAuth` vocabulary. When the app-type→building mapping changes in `frontend/src/data/appTypeMapping.ts`, update the table in user-guide.md §3.2 (sync point tracked in `docs/TODO.md`).
- **`a-faire-bientot.md`** at the repo root (private repo only — `export-ignore`d from the public mirror) holds the project backlog (open design decisions, deferred work). Not a dev-internal dumping ground — add there anything the user should be able to come back to.
- **All user-facing strings are English** (single locale, no i18n framework). Add new strings in English directly in the component.

## Useful pointers

- `.claude/skills/mycctown/` — project-scoped Claude Code skill. SKILL.md is the index; per-domain references under `references/` (backend, frontend, observability, webhooks, deployment-ops). The skill is the per-domain extension of this file — it carries the load-bearing details (function names, line numbers, decision tables) that don't fit on a CLAUDE.md gotcha line. Strict no-duplication with this file.
- `docs/deployment.md` — full CC setup from scratch + env vars + observability log vocabulary + troubleshooting.
- `docs/observability.md` — GlitchTip stack: SDKs, init sites, user/org context, sourcemaps, uptime monitors + alerts, MCP tools available from Claude Code.
- `docs/webhooks.md` — CC webhook event catalog + how to extend it.
- `frontend/src/components/docs/DocsPage.tsx` — the in-app `/docs` renderer (react-markdown + rehype-highlight, Tailwind/Next.js-style 2-column layout).
- `frontend/src/utils/assetLoader.ts` — load pipeline: meshopt decoder hookup, LoadingManager URL modifier (`?v=N` cache-bust), `loadInitialAssets` (always + dominant color) + `loadColorAssets` (lazy on demand). One-stop shop for asset performance changes.
- `frontend/src/utils/debug.ts` + `frontend/src/utils/retry.ts` — runtime-toggleable scoped logger and `retryWithBackoff(fn, opts)`. Used by `assetLoader.ts` and `api/client.ts` to absorb transient HTTP/2 blips.
- `frontend/src/hooks/useAmbientMusic.ts` — audio toggle + shuffle bag. Reads `VITE_MUSIC_BASE_URL` for the Cellar origin; tracks list is hardcoded.
- `backend/src/webhooks/event.rs` — CC payload → `WsFrame` mapping (extend here, then add the TS variant in `frontend/src/types/ws.ts`).
