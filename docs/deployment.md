# Deployment on Clever Cloud

myCCtown runs as **two apps** under one CC org, with one PostgreSQL
addon shared by the backend only. This doc walks through recreating
the stack from scratch, and day-to-day deploy / rollback commands.

## Environments

We run **two parallel stacks** in the same CC org:

| Env  | Frontend domain                       | Backend domain                                 | DB addon          | OAuth consumer | Aliases (`--alias …`)                   |
|------|---------------------------------------|------------------------------------------------|-------------------|----------------|------------------------------------------|
| prod | `mycctown.cleverapps.io`              | `mycctown-backend.cleverapps.io`               | `mycctown-db`     | `myCCtown`     | `mycctown-backend`, `mycctown-frontend`  |
| dev  | `mycctown-dev.cleverapps.io`          | `mycctown-backend-dev.cleverapps.io`           | `mycctown-db-dev` | `myCCtown-dev` | `mycctown-backend-dev`, `mycctown-frontend-dev` |

Sections §1–§7 below describe the **prod stack** end-to-end. Dev is a
mirror of the same shape, fully scripted in
[`scripts/setup-dev-env.sh`](../scripts/setup-dev-env.sh) — see
[§9. Dev environment](#9-dev-environment).

Dev and prod **share** the Cellar music bucket
(`<your-music-bucket>.cellar-c2.services.clever-cloud.com`, public-read MP3s)
and the GlitchTip projects (events filtered via the `SENTRY_ENVIRONMENT`
tag — `production` vs `development`).

> **Working rule.** When making code changes, target the `*-dev` aliases
> by default. Mutating commands against prod aliases (`clever deploy`,
> `env set`, `restart`, `scale`, `stop`, `domain`, `addon delete`,
> `link-addon`) require explicit per-session authorization — a previous
> approval doesn't extend to later prod actions.

## Prerequisites

```bash
npm i -g clever-tools
clever login
```

- A Clever Cloud **OAuth consumer** with the right scopes
  (see [4. OAuth consumer](#4-oauth-consumer) below).
- The `clever` CLI logged in as a user who's **admin** of the target
  org (you need to create apps + link addons).

## 1. Create the backend

```bash
clever create \
  --type rust \
  --region par \
  --alias mycctown-backend \
  --org <orga_id> \
  mycctown-backend
```

This writes an entry in the repo's `.clever.json` (already committed
— so you usually don't re-run `create` for the prod apps).

### Scale + sticky sessions + domain

```bash
clever scale --alias mycctown-backend --build-flavor S --flavor nano
clever config set sticky-sessions true --alias mycctown-backend
clever domain add mycctown-backend.cleverapps.io --alias mycctown-backend
clever domain favourite set mycctown-backend.cleverapps.io --alias mycctown-backend
```

`--build-flavor S` enables a **dedicated build instance** (separate
from the run flavor). Without it, `cargo build --release` evicts the
run instance and the app is unreachable during deploys.

### Link the PostgreSQL addon

```bash
clever service link-addon <addon_id> --alias mycctown-backend
```

Schema is auto-migrated on boot by `sqlx::migrate!("./migrations")`.
Current migrations: `001_initial.sql` through `005_webhook_configs.sql`.

### Env vars

```bash
# Auto-injected by the addon: POSTGRESQL_ADDON_URI

# Monorepo root — the Rust buildpack cds into this dir
clever env set --alias mycctown-backend APP_FOLDER ./backend

# Session / crypto
clever env set --alias mycctown-backend ENCRYPTION_KEY "$(openssl rand -base64 32)"

# CC OAuth consumer (see §4)
clever env set --alias mycctown-backend CC_OAUTH_CONSUMER_KEY <consumer_key>
clever env set --alias mycctown-backend CC_OAUTH_CONSUMER_SECRET <consumer_secret>

# URLs — APP_URL is the PUBLIC FRONTEND URL because that's where the
# browser-facing OAuth callback lives (the frontend proxies /auth
# back to the backend). FRONTEND_URL is the same value.
clever env set --alias mycctown-backend APP_URL https://mycctown.cleverapps.io
clever env set --alias mycctown-backend FRONTEND_URL https://mycctown.cleverapps.io

# CC webhooks post directly to the backend, not through the proxy, so
# WEBHOOKS_PUBLIC_URL points to the backend's own URL.
clever env set --alias mycctown-backend WEBHOOKS_PUBLIC_URL https://mycctown-backend.cleverapps.io
clever env set --alias mycctown-backend USE_WEBHOOKS true

# Polling cadence — optional overrides
# clever env set --alias mycctown-backend WS_POLL_STATUS_SECS 10
# clever env set --alias mycctown-backend WS_POLL_METRICS_SECS 15

# Observability
clever env set --alias mycctown-backend RUST_LOG "info,sqlx=warn,tower_http=info"

# GlitchTip — error monitoring + tracing. Init is a no-op if SENTRY_DSN unset.
# DSN comes from the GlitchTip project (<org-slug>/mycctown-backend, id 1).
clever env set --alias mycctown-backend SENTRY_DSN "https://<key>@<your-glitchtip-host>/1"
clever env set --alias mycctown-backend SENTRY_ENVIRONMENT production
clever env set --alias mycctown-backend SENTRY_TRACES_SAMPLE_RATE 0.1
```

## 2. Create the frontend

```bash
clever create \
  --type node \
  --region par \
  --alias mycctown-frontend \
  --org <orga_id> \
  mycctown
```

The app **name** is `mycctown` (drives the `mycctown.cleverapps.io`
subdomain). The **alias** is `mycctown-frontend` (local shorthand for
`clever` commands — avoids confusion with the org name).

### Scale + domain

```bash
clever scale --alias mycctown-frontend --build-flavor S --flavor XS
clever domain add mycctown.cleverapps.io --alias mycctown-frontend
clever domain favourite set mycctown.cleverapps.io --alias mycctown-frontend
```

**Flavor XS** (512 MB). Nano (256 MB) isn't enough to serve 24 MB of
GLTF assets concurrently over HTTP/2 without sozu reset-streaming the
browser.

### Env vars

```bash
clever env set --alias mycctown-frontend APP_FOLDER ./frontend
clever env set --alias mycctown-frontend BACKEND_URL https://mycctown-backend.cleverapps.io
# VITE_BACKEND_URL unset (empty) — backend calls go through the proxy
clever env set --alias mycctown-frontend VITE_BACKEND_URL ""
clever env set --alias mycctown-frontend CC_NODE_DEV_DEPENDENCIES install
# POST_BUILD_HOOK runs from repo root (not APP_FOLDER) — use --prefix
clever env set --alias mycctown-frontend CC_POST_BUILD_HOOK "npm --prefix ./frontend run build"
clever env set --alias mycctown-frontend CC_RUN_COMMAND "npm --prefix ./frontend run start"
# Cellar bucket public URL for ambient music — see §2bis
clever env set --alias mycctown-frontend VITE_MUSIC_BASE_URL "https://<your-music-bucket>.cellar-c2.services.clever-cloud.com"

# GlitchTip — VITE_* are inlined at build time, so they must be present
# BEFORE the build hook runs. SENTRY_AUTH_TOKEN is read by
# @sentry/vite-plugin to upload sourcemaps; without it the plugin is
# a no-op (build succeeds, but stack traces in prod stay minified).
clever env set --alias mycctown-frontend VITE_SENTRY_DSN "https://<key>@<your-glitchtip-host>/2"
clever env set --alias mycctown-frontend VITE_SENTRY_ENVIRONMENT production
clever env set --alias mycctown-frontend SENTRY_AUTH_TOKEN "<glitchtip personal auth token>"
# Sourcemap upload also needs the server URL + org slug (skipped if unset).
clever env set --alias mycctown-frontend SENTRY_URL "https://<your-glitchtip-host>"
clever env set --alias mycctown-frontend SENTRY_ORG "<org-slug>"
```

## 2bis. Cellar bucket for ambient music

Ambient music streams from a separate origin so the audio fetch
doesn't queue behind the GLTF assets on the app's HTTP/2 connection.

```bash
# Provision the addon (one-shot, free tier covers our 21 MB)
clever addon create cellar-addon mycctown-music --plan S --region par \
  --link mycctown-frontend

# Get the credentials (KEY_ID, KEY_SECRET, HOST exposed as env vars
# on the linked frontend app)
clever addon env <addon_id>
```

Upload the MP3s once with `s3cmd` (the catalogue is pinned in
`frontend/src/hooks/useAmbientMusic.ts:5` — keep these names in sync):

```bash
brew install s3cmd  # if not already installed

# Pull the credentials into the local shell, no file on disk
eval "$(clever addon env <addon_id> | grep ^CELLAR_)"
S3=(s3cmd
    --access_key="$CELLAR_ADDON_KEY_ID"
    --secret_key="$CELLAR_ADDON_KEY_SECRET"
    --host="$CELLAR_ADDON_HOST"
    --host-bucket='%(bucket)s.'"$CELLAR_ADDON_HOST")

"${S3[@]}" mb s3://mycctown-music
"${S3[@]}" put --acl-public music/*.mp3 s3://mycctown-music/
"${S3[@]}" ls s3://mycctown-music/
```

To add or replace a track later: drop the MP3 in `music/` at the repo
root, run the same `s3cmd put --acl-public music/<file>.mp3
s3://mycctown-music/`, then append the filename to the `TRACKS`
array in `frontend/src/hooks/useAmbientMusic.ts:5` and redeploy.

The bucket holds public-read MP3s only — losing the credentials means
losing write access, not read access. To rotate, regenerate the
addon's credentials in the CC console; clients keep working off the
public URL.

## 3. Deploy

Monorepo in a single git repo, both apps deploy from their
`APP_FOLDER`:

```bash
git add -u && git commit -m "…"
clever deploy --alias mycctown-backend        # ~30-45 s (Rust builds)
clever deploy --alias mycctown-frontend       # ~20-30 s (npm install + vite build)
```

### Same-commit redeploy (force a rebuild)

`clever deploy` refuses by default when the remote HEAD matches local:

```bash
clever deploy --alias mycctown-frontend --same-commit-policy rebuild
```

Options: `error` (default), `ignore`, `restart`, `rebuild`.

## 4. OAuth consumer

In CC console → *Account* → *OAuth consumers* → **Create**:

| Field | Value |
|---|---|
| Name | `myCCtown` |
| Application homepage URL | `https://mycctown.cleverapps.io` |
| Application base URL | `https://mycctown.cleverapps.io` |
| Rights / scopes | **ACCESS_ORGANISATIONS** (minimum). We only do reads: orgs, apps, addons, metrics token, linked addons. |

CC returns a **consumer key + secret**. Paste them into the
`CC_OAUTH_CONSUMER_KEY` / `CC_OAUTH_CONSUMER_SECRET` env vars on the
backend.

The **Application base URL** must be the FRONTEND domain — not the
backend domain. The backend sends callbacks to
`{APP_URL}/auth/callback` and `APP_URL = https://mycctown.cleverapps.io`.
The frontend proxy forwards `/auth/callback` to the backend.

## 5. Smoke tests

```bash
# Backend health
curl -sI https://mycctown-backend.cleverapps.io/health
#   → HTTP/2 200, body "ok"

# OAuth init should redirect (303) to api.clever-cloud.com
curl -sI https://mycctown-backend.cleverapps.io/auth/login
#   → HTTP/2 303, location: https://api.clever-cloud.com/v2/oauth/authorize?oauth_token=…

# Webhook receiver rejects bad token with 401
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  https://mycctown-backend.cleverapps.io/webhooks/cc/nope
#   → 401

# Frontend index loads
curl -sI https://mycctown.cleverapps.io/
#   → HTTP/2 200, cache-control: no-cache, must-revalidate

# Asset serves with gzip on .gltf, must-revalidate on non-hashed paths
curl -s -H "Accept-Encoding: gzip" -v https://mycctown.cleverapps.io/assets/gltf/buildings/green/building_home_A_green.gltf -o /dev/null 2>&1 | grep -iE '(content-encoding|cache-control)'
#   → content-encoding: gzip   cache-control: public, max-age=3600, must-revalidate

# Vite-hashed bundles get the long immutable cache
curl -s "https://mycctown.cleverapps.io/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 | xargs -I{} curl -sI "https://mycctown.cleverapps.io/{}" | grep -i cache-control
#   → cache-control: public, max-age=31536000, immutable

# Music bucket on Cellar serves Range requests for <audio> streaming
curl -sI -H "Range: bytes=0-1023" "https://<your-music-bucket>.cellar-c2.services.clever-cloud.com/First%20Village.mp3" | head -3
#   → HTTP/1.1 206 Partial Content   content-type: audio/mpeg

# Proxy reaches backend via frontend domain
curl -s -o /dev/null -w "%{http_code}\n" https://mycctown.cleverapps.io/api/me
#   → 401 (correct: no session)
```

## 6. Rollback

### Quick: flip USE_WEBHOOKS off

```bash
clever env set --alias mycctown-backend USE_WEBHOOKS false
clever restart --alias mycctown-backend
```

Webhook deliveries still land (route is live) but nothing is
provisioned and the "Realtime setup" UI shows as disabled. Polling
at `WS_POLL_STATUS_SECS` remains the sole source of truth — same as
before Phase 3 went live.

### Scale down

```bash
clever scale --alias mycctown-backend --flavor pico      # off-hours
clever stop --alias mycctown-backend                      # full off
```

### Previous version

Deploy targets the tip of whichever branch is linked. To revert to an
earlier commit:

```bash
git checkout -b rollback <prev-commit-sha>
clever deploy --alias mycctown-backend
# …verify, then clean up the branch
```

CC also exposes app-level "Restart a specific version" in the console
UI if you just want to re-run an earlier build artifact.

## 7. Observability

### Logs (streaming)

```bash
clever logs --alias mycctown-backend
clever logs --alias mycctown-backend --since 10m --search "WS upgrade|session"
clever logs --alias mycctown-frontend --search "upgrade"
```

Backend log vocabulary worth knowing:

- `WS upgrade request org=… session_cookie_present=…` — per connection.
- `webhook <EVENT> for org=… → pushed N/M` — per delivery.
- `app status tick: emitted N/M` — debug only; flip `RUST_LOG=debug`.
- `poller: session expired` — user's OAuth tokens can't decrypt
  (key rotation). Frontend is forced to re-login.
- `stale warp10 token for user=… — invalidating cache` — Warp10
  cache row can't decrypt; `ensure_token` re-fetches on the fly.
  No user action required.
- `addon metrics: fanning out N addons over K chunks of up to 5` —
  per metrics tick, one entry. Tells you the chunk count + expected
  parallelism.
- `addon metrics chunk #i (N ids): Warp10 OK in Xms` (or `failed`)
  — debug only (RUST_LOG=debug). Isolates the slowest / failing
  sub-query.
- `addon metrics tick: N/M addons with data in Xms (K chunks, F
  failed) (hits=[…], misses=[…])` — the summary. `F > 0` means at
  least one chunk timed out — other chunks still delivered.

### Database access

```bash
clever database connect <addon_id>    # psql session
```

Useful queries:

```sql
-- current sessions (tower-sessions table)
SELECT count(*) FROM tower_sessions;

-- webhook tokens per user
SELECT cc_org_id, token, created_at
FROM webhook_configs
WHERE user_id = (SELECT id FROM users WHERE cc_user_id = 'user_...');

-- cached Warp10 tokens (invalidated on decrypt fail)
SELECT user_id, cc_org_id, expires_at FROM warp10_tokens;
```

## 8. Troubleshooting

### "All assets yellow after re-login"

Warp10 token cache encrypted with an old `ENCRYPTION_KEY`. The
backend now self-heals automatically — watch for
`stale warp10 token for user=…` in the logs. No manual action needed.

If you want to force an immediate refresh (e.g. for testing):

```sql
DELETE FROM warp10_tokens WHERE user_id = '<user-uuid>';
```

Next metrics tick re-fetches a fresh token + encrypts with current
key.

### "Metrics appear stuck on an addon-heavy org"

If an org with many mapped addons (20+) sees zero CPU/RAM, look at
the `addon metrics tick` summary log:

- `F failed` column — a timing-out sub-chunk means the global
  `reqwest` 30 s budget was hit. Usually transient. If persistent,
  reduce `ADDON_BATCH_SIZE` from 5 to 3 in `ws::poller::tick_metrics`.
- `hits=[…]` only listing some addons — the misses are either
  genuinely idle (CC publishes sparsely) or metrics-less providers
  (Cellar / fs-bucket / config-provider never expose CPU/RAM,
  expected 0%).

With debug logging on (`RUST_LOG=debug`), `addon metrics chunk #i`
lines pinpoint which chunk is slow.

### "OAuth callback invalid"

OAuth consumer's *Application base URL* doesn't match `APP_URL`.
Ensure both are `https://mycctown.cleverapps.io`.

### "`ERR_HTTP2_PROTOCOL_ERROR` on `.mp3` (audio toggle)"

`compression` middleware in `server.mjs` is mangling a 206 Range
response. Verify the filter still excludes media + Range:

```js
filter: (req, res) => {
  if (req.headers.range) return false;
  if (/\.(bin|png|webp|jpg|jpeg|gif|mp3|wav|ogg|m4a|mp4|webm)$/i.test(req.path)) return false;
  return compression.filter(req, res);
}
```

Don't add audio extensions back into the gzip path — the bug is
deterministic behind the CC edge.

### "Browser cache holds a broken deploy of `.gltf`/`.bin`"

You released a deploy with bad assets, then fixed it, but users still
see the old broken files. Two things to check:

1. **`Cache-Control` of non-hashed assets** must be
   `must-revalidate`, never `immutable`. The `VITE_HASHED` regex in
   `server.mjs` separates the two profiles. Test with `curl -sI` —
   `immutable` on a `.gltf` is a bug.
2. **Bump `ASSET_VERSION`** in
   `frontend/src/utils/assetLoader.ts:14` and redeploy. The
   `LoadingManager.setURLModifier` adds `?v=N` to every asset URL,
   so a bump invalidates every cached entry across all clients
   without waiting for `max-age` to expire. The Vite bundle hash
   shifts too (source changed), so HTML pulls the new bundle which
   requests fresh URLs nobody has cached.

### "Frontend instance saturated under concurrent asset load"

Bump the flavor:

```bash
clever scale --alias mycctown-frontend --flavor S
```

Also verify gzip is on (`curl -H "Accept-Encoding: gzip" -v …`) and
the asset payload at boot is sane (we should be loading ~239 GLTFs
under the lazy-by-color regime, not 404 — see
`frontend/src/utils/assetLoader.ts`).

### "WS keeps reconnecting, frames never arrive"

1. Check `clever logs --alias mycctown-backend --search "WS upgrade"`
   — cookie present on upgrade? If not, the frontend proxy dropped it.
2. If present, look for `WS access denied … no map yet` — user needs
   to `GET /api/orgs/:id/map` first (the frontend does this on org
   select).
3. Look for repeated `session expired` — user's OAuth tokens can't
   decrypt; force logout via the browser's `[ws] session expired` flow
   or clear the session cookie manually.

## 9. Dev environment

A second stack identical in shape to prod, used for working on the
code without touching real users. Provisioning is fully automated by
[`scripts/setup-dev-env.sh`](../scripts/setup-dev-env.sh).

### What the script provisions

| Resource       | Name / alias                  | Notes |
|----------------|-------------------------------|-------|
| Backend app    | `mycctown-backend-dev`        | Rust, build `S` / run `nano`, sticky-sessions on, domain `mycctown-backend-dev.cleverapps.io` |
| Frontend app   | name `mycctown-dev`, alias `mycctown-frontend-dev` | Node, build `S` / run `XS`, domain `mycctown-dev.cleverapps.io` |
| PostgreSQL     | `mycctown-db-dev`             | Plan `dev` (free tier), linked to the backend |
| OAuth consumer | `myCCtown-dev`                | Created via `clever oauth-consumers create`, scope `access-organisations`, base URL = the dev frontend |

Re-runable: each step checks for prior existence (alias in
`.clever.json`, addon by name, OAuth consumer by name) and skips
creation. Env vars are always re-applied.

The script also exposes the dev stack's lifecycle as sub-commands:

| Sub-command | What it does |
|---|---|
| `create`    | Provision (idempotent). Default if no command is given on first install (legacy behavior). |
| `status`    | Print each resource's state — app `running` / `stopped` / `not created`, last commit, addon presence, OAuth consumer presence. |
| `start`     | `clever restart` both apps (works whether they were stopped or already running). Apps must have been deployed at least once. |
| `stop`      | `clever stop` both apps. |
| `restart`   | `stop` then `start`. |
| `deploy [backend\|frontend]` | Deploy from the current branch. No argument = backend then frontend. Pick a side to skip the other's build (~20–45 s). Handles the `cd <subdir>` required by the APP_FOLDER monorepo rule. |
| `destroy`   | Delete the two apps, the PostgreSQL addon, and the OAuth consumer. Asks for an interactive `Type 'destroy' to confirm:` prompt; pass `--yes` / `-y` to skip. Leaves `scripts/.env.dev` and `.clever.json` entries alone — clean those up manually. |
| `help`      | Show usage. |

### What dev reuses from prod

- The **Cellar music bucket** (`VITE_MUSIC_BASE_URL` points at the
  same public-read URL — no second bucket).
- The **GlitchTip projects**. Dev events are isolated by
  `SENTRY_ENVIRONMENT=development` (filterable in the GlitchTip UI).
  The same `VITE_SENTRY_DSN`, `SENTRY_DSN`, and `SENTRY_AUTH_TOKEN`
  values from prod can be reused — paste them into `scripts/.env.dev`.

### Setup, end to end

```bash
# 1. clever-tools, jq, openssl, logged-in CC user
clever login

# 2. Local dev secrets (only GlitchTip DSNs + auth token)
cp scripts/.env.dev.example scripts/.env.dev
# edit scripts/.env.dev — fill SENTRY_DSN_BACKEND_DEV, VITE_SENTRY_DSN_DEV, SENTRY_AUTH_TOKEN_DEV
# (ENCRYPTION_KEY_DEV is auto-generated and persisted on first run)

# 3. Provision (idempotent, no deploy)
./scripts/setup-dev-env.sh create

# 4. Deploy (first time = also "starts" the apps)
./scripts/setup-dev-env.sh deploy

# 5. Sanity check
./scripts/setup-dev-env.sh status
```

The OAuth consumer is created automatically (`clever oauth-consumers
create myCCtown-dev …`) and its key + secret are pulled back via
`oauth-consumers get --with-secret` and injected as
`CC_OAUTH_CONSUMER_KEY` / `CC_OAUTH_CONSUMER_SECRET` on the backend.
No manual step in the CC console.

### Day-to-day ops on dev

The lifecycle wrapper handles both apps in one go:

```bash
./scripts/setup-dev-env.sh status              # current state
./scripts/setup-dev-env.sh deploy              # backend then frontend
./scripts/setup-dev-env.sh deploy backend      # one side only
./scripts/setup-dev-env.sh deploy frontend
./scripts/setup-dev-env.sh stop                # both apps
./scripts/setup-dev-env.sh start               # both apps (needs at least one prior deploy)
./scripts/setup-dev-env.sh restart             # stop + start
./scripts/setup-dev-env.sh destroy             # nuke everything (interactive confirm)
```

For per-app actions, fall back to `clever`:

```bash
# Tail logs
clever logs --alias mycctown-backend-dev  --since 10m
clever logs --alias mycctown-frontend-dev --since 10m

# Redeploy after a config change (no source change)
clever deploy --alias mycctown-backend-dev --same-commit-policy rebuild

# DB shell
clever database connect <addon_id_for_mycctown-db-dev>
```

### Working rule: dev by default

When working on the code, target the `*-dev` aliases. Mutating
commands against prod aliases (any of `deploy`, `env set`, `restart`,
`scale`, `stop`, `domain`, `addon delete`, `link-addon`) require
explicit, per-session user approval — a previous prod approval doesn't
extend to later prod actions.

Read-only commands stay free against either env (`clever logs`,
`clever env`, `clever applications`, `clever activity`, `clever addon
list`). Read-only `psql` SELECTs against the prod DB also remain
allowed (see §"Prod DB reads" in `CLAUDE.md`).

Local commands that pull a prod secret into the shell (`ENCRYPTION_KEY`,
`SENTRY_DSN`, etc. for a local `cargo run` / `npm run dev`) require
asking first.

### Tearing down

```bash
./scripts/setup-dev-env.sh destroy        # interactive confirm
./scripts/setup-dev-env.sh destroy --yes  # skip the prompt
```

This deletes the two apps, the PostgreSQL addon, and the OAuth
consumer in that order. It does **not** touch:

- `scripts/.env.dev` (still on disk so you can re-`create` later)
- the `*-dev` entries in `.clever.json` (`clever delete` removes them
  automatically anyway, but if any line lingers, edit by hand)
- the prod stack, the Cellar music bucket, or the GlitchTip projects

The stack is also cheap to keep around (stopped apps cost nothing,
the `dev` Postgres plan is free), so `stop` is often enough.
