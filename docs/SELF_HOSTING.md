# Self-hosting myCCtown

This guide takes you from a fresh clone to your own running instance, first on your
machine and then in production (Clever Cloud, or any server). For the full operational
detail of the reference deployment (smoke tests, rollback, observability), see
[`deployment.md`](deployment.md).

**Contents**

1. [What you are going to run](#1-what-you-are-going-to-run)
2. [Prerequisites](#2-prerequisites)
3. [Create a Clever Cloud OAuth consumer](#3-create-a-clever-cloud-oauth-consumer)
4. [Run it locally](#4-run-it-locally)
5. [Deploy on Clever Cloud](#5-deploy-on-clever-cloud)
6. [Deploy anywhere else](#6-deploy-anywhere-else)
7. [Environment variables reference](#7-environment-variables-reference)
8. [Optional features](#8-optional-features)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What you are going to run

```text
 browser ──HTTPS──▶ frontend (Node, frontend/server.mjs)        ← public entry point
                     ├─ serves the Vite build (frontend/dist/, incl. the 3D models)
                     └─ proxies /api /auth /ws → backend (keeps cookies first-party)
                              │
                              ▼
                    backend (Rust/axum, :8080) ──▶ PostgreSQL
                              │
                              ▼
                    Clever Cloud API + Warp10 metrics (with each user's OAuth token)
```

- **Users sign in with their own Clever Cloud account** (OAuth 1.0a). The instance
  then reads *their* organisations, applications, add-ons and metrics with *their*
  token. Anyone with a Clever Cloud account can use your instance and sees only what
  their own account can see.
- The **backend** runs the per-org pollers, the WebSocket hub and the optional
  Clever Cloud webhooks receiver. It applies its database migrations on boot.
- The **frontend** is a Vite build plus a small Express server.
- The **3D models are not in the repository.** You buy and install them as described
  in [`ASSETS.md`](ASSETS.md).

---

## 2. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Rust | stable, edition 2024 (1.85+) | backend |
| Node.js | 20+ | frontend build + server, asset installer |
| PostgreSQL | 14+ (Docker is fine) | backend state |
| `unzip` (or bsdtar) | — | asset installer |
| A Clever Cloud account | — | OAuth login; also the deployment target in §5 |
| The KayKit Medieval Hexagon SOURCE pack | — | the 3D city ([`ASSETS.md`](ASSETS.md)) |

---

## 3. Create a Clever Cloud OAuth consumer

The login flow needs an **OAuth consumer**: a key/secret pair that identifies your
instance to Clever Cloud.

### How the callback is checked

The backend asks Clever Cloud to send users back to **`<APP_URL>/auth/callback`**.
Clever Cloud accepts that callback only if its **scheme and host** match the
consumer's *base URL*. Port and path are ignored. So:

- `http://localhost` covers local development on any port;
- `https://mycctown.example.com` covers your production instance.

The scheme must match too. Create **one consumer per environment**.

### Option A — Console

1. Open the [Clever Cloud Console](https://console.clever-cloud.com) and select the
   organisation (or personal space) that should own the consumer.
2. Click **Create…** → **an OAuth consumer**.
3. Fill the form:
   - **Name / description**: shown to users on the consent screen.
   - **Application homepage URL**: your instance's public URL.
   - **Application base URL**: your **frontend** URL, for example
     `http://localhost:3000` or `https://mycctown.example.com`.
   - **Rights**: **Access organisations**. myCCtown only reads: organisations,
     applications, add-ons, metrics token and linked add-ons.
4. Save, then copy the **consumer key** and **consumer secret**.

### Option B — CLI (`clever-tools` 4.8+)

```bash
clever oauth-consumers create "myCCtown (local)" \
  --description "Self-hosted myCCtown" \
  --url http://localhost:3000 \
  --base-url http://localhost:3000 \
  --rights access-organisations

clever oauth-consumers get <consumer-key> --with-secret   # prints the secret
```

Add `--org <org-id|org-name>` to make an organisation own the consumer.

> Keep the **consumer secret** private. It belongs in the backend's environment only,
> never in the frontend, a commit or a ticket.

---

## 4. Run it locally

### 4.1 Database

Any PostgreSQL works. With Docker:

```bash
docker run -d --name mycctown-pg -p 5432:5432 \
  -e POSTGRES_USER=mycctown -e POSTGRES_PASSWORD=mycctown -e POSTGRES_DB=mycctown \
  postgres:16
```

### 4.2 Backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```dotenv
POSTGRESQL_ADDON_URI=postgresql://mycctown:mycctown@localhost:5432/mycctown
# openssl rand -base64 32   (optional locally; without it sessions die on restart)
ENCRYPTION_KEY=
CC_OAUTH_CONSUMER_KEY=<your local consumer key>
CC_OAUTH_CONSUMER_SECRET=<your local consumer secret>
FRONTEND_URL=http://localhost:3000
APP_URL=http://localhost:8080
```

```bash
cargo run            # :8080, migrations auto-apply
```

### 4.3 Frontend

```bash
cd frontend
npm install
npm run assets:install       # once, see docs/ASSETS.md
npm run dev                  # Vite on :3000, proxies /api /auth /ws → :8080
```

Open **<http://localhost:3000>**, click **Login with Clever Cloud**, approve the
consent screen, pick an organisation and start building (see the
[user guide](user-guide.md)).

---

## 5. Deploy on Clever Cloud

This is how the reference instance runs: **two applications** (Rust backend + Node
frontend) from one repository (`APP_FOLDER` monorepo) plus a **PostgreSQL** add-on.
[`deployment.md`](deployment.md) has every detail. Here is the short path.

> **Assets first.** Clever Cloud builds from your git repository, which does not
> contain the git-ignored 3D models. Deploy from a **private** fork or branch where you
> committed them with `git add -f frontend/public/assets/gltf` (see
> [`ASSETS.md`](ASSETS.md) §4). Never push that branch to a public remote.

Replace `<org>` with your organisation id or name, and `<front>` / `<back>` with
your domains (for example `mycctown-xyz.cleverapps.io` and
`mycctown-xyz-backend.cleverapps.io`). Run each `clever` command **from the app's
subdirectory** (`cd backend` / `cd frontend`), as `deployment.md` explains.

### 5.1 Backend

```bash
cd backend
clever create --type rust --region par --org <org> --alias mycctown-backend mycctown-backend
clever scale --alias mycctown-backend --build-flavor S --flavor nano
clever config set sticky-sessions true --alias mycctown-backend
clever addon create postgresql-addon mycctown-db --plan <plan> --org <org> --region par \
  --link mycctown-backend                                  # injects POSTGRESQL_ADDON_URI

clever env set --alias mycctown-backend APP_FOLDER ./backend
clever env set --alias mycctown-backend ENCRYPTION_KEY "$(openssl rand -base64 32)"
clever env set --alias mycctown-backend CC_OAUTH_CONSUMER_KEY    <prod consumer key>
clever env set --alias mycctown-backend CC_OAUTH_CONSUMER_SECRET <prod consumer secret>
# Both point at the FRONTEND public URL (it proxies /auth; cookies live there).
clever env set --alias mycctown-backend APP_URL      https://<front>
clever env set --alias mycctown-backend FRONTEND_URL https://<front>
clever env set --alias mycctown-backend RUST_LOG "info,sqlx=warn,tower_http=info"
```

> Keep `ENCRYPTION_KEY` stable and backed up. It encrypts the users' Clever Cloud
> tokens at rest. If you change it, every user has to sign in again.

### 5.2 Frontend

```bash
cd frontend
clever create --type node --region par --org <org> --alias mycctown-frontend <front-app-name>
clever scale --alias mycctown-frontend --build-flavor S --flavor XS   # nano is too small to serve the models

clever env set --alias mycctown-frontend APP_FOLDER ./frontend
clever env set --alias mycctown-frontend BACKEND_URL https://<back>
clever env set --alias mycctown-frontend VITE_BACKEND_URL ""
clever env set --alias mycctown-frontend CC_NODE_DEV_DEPENDENCIES install
clever env set --alias mycctown-frontend CC_POST_BUILD_HOOK "npm --prefix ./frontend run build"
clever env set --alias mycctown-frontend CC_RUN_COMMAND "npm --prefix ./frontend run start"
```

### 5.3 Deploy

```bash
(cd backend  && clever deploy --alias mycctown-backend)
(cd frontend && clever deploy --alias mycctown-frontend)
```

Open `https://<front>` and sign in. Prefer a script? `scripts/setup-dev-env.sh`
provisions a complete stack (apps, Postgres, OAuth consumer, env vars) and is a good
template: adapt the names at the top of the file.

---

## 6. Deploy anywhere else

Any host that can run a Linux binary, Node.js and PostgreSQL works:

1. **Backend**: `cargo build --release` in `backend/`, then run
   `target/release/mycctown-backend` with the environment from §7. It does not need to
   be reachable from the internet, only from the frontend (and from Clever Cloud if
   you enable webhooks, §8).
2. **Frontend**: in `frontend/`, run `npm ci && npm run assets:install && npm run build`,
   then `BACKEND_URL=http://127.0.0.1:8080 PORT=3000 node server.mjs`.
3. **HTTPS**: put a TLS reverse proxy (Caddy, nginx, Traefik…) in front of the
   frontend server. It must pass **WebSocket upgrades** on `/ws`. Session cookies are
   `Secure` when `APP_URL` is `https://`.
4. Set `APP_URL` and `FRONTEND_URL` to the public HTTPS URL, and use an OAuth consumer
   whose base URL matches it.

> **Single-process alternative.** The backend can also serve the built frontend
> itself: set `STATIC_DIR` to the path of `frontend/dist`, expose only the backend,
> and set `APP_URL` = `FRONTEND_URL` = its public URL.

---

## 7. Environment variables reference

### Backend (`backend/.env` locally)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `POSTGRESQL_ADDON_URI` (or `DATABASE_URL`) | **yes** | — | PostgreSQL connection string |
| `CC_OAUTH_CONSUMER_KEY` / `CC_OAUTH_CONSUMER_SECRET` | **yes** | — | from §3 |
| `ENCRYPTION_KEY` | prod | random per process | base64 of exactly 32 bytes (`openssl rand -base64 32`) |
| `APP_URL` | yes | `http://localhost:<PORT>` | URL users hit for `/auth`. In production, the **frontend** URL. The OAuth callback is `<APP_URL>/auth/callback` |
| `FRONTEND_URL` | yes | `http://localhost:<PORT>` | where users land after sign-in |
| `PORT` | no | `8080` | |
| `STATIC_DIR` | no | — | serve a built frontend from the backend (single origin) |
| `WS_POLL_STATUS_SECS` / `WS_POLL_METRICS_SECS` | no | `10` / `15` | poller cadence |
| `USE_WEBHOOKS`, `WEBHOOKS_PUBLIC_URL` | no | `false` | §8 |
| `CC_API_BASE_URL`, `WARP10_ENDPOINT` | no | Clever Cloud public endpoints | |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | no | — | error reporting (GlitchTip / Sentry) |
| `RUST_LOG`, `DEBUG_CC_API` | no | — | logging / API tracing |

### Frontend

| Variable | When | Notes |
|---|---|---|
| `BACKEND_URL` | run time, **required** | where `server.mjs` proxies `/api /auth /ws` |
| `PORT` | run time | default `8080` |
| `VITE_BACKEND_URL` | build time | leave empty in production (calls go through the proxy); local Vite dev proxy target |
| `VITE_MUSIC_BASE_URL` | build time | public base URL of your MP3 bucket (§8). Unset = `/music` |
| `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE` | build time | frontend error reporting |
| `SENTRY_AUTH_TOKEN`, `SENTRY_URL`, `SENTRY_ORG`, `SENTRY_PROJECT` | build time | sourcemap upload (skipped unless token + URL + org are set) |

---

## 8. Optional features

- **Real-time updates via Clever Cloud webhooks**: sub-second status changes instead
  of polling only. Set `USE_WEBHOOKS=true` and `WEBHOOKS_PUBLIC_URL` to the
  **backend's** public URL (Clever Cloud posts to it directly). An org admin then
  pastes the per-org webhook URL shown in the app into the Clever Cloud console. See
  [`webhooks.md`](webhooks.md) and the [user guide](user-guide.md).
- **Ambient music**: not shipped. Host your own MP3s (names in
  [`ASSETS.md`](ASSETS.md) §5) on a public bucket and set `VITE_MUSIC_BASE_URL` at
  build time. A separate origin keeps the audio from queuing behind the model
  downloads ([`deployment.md`](deployment.md) §2bis). Without music, the Music button
  hides itself.
- **Error monitoring**: `SENTRY_DSN` (backend), `VITE_SENTRY_DSN` (frontend) and the
  sourcemap variables above. Any Sentry-compatible server works (for example
  GlitchTip). See [`observability.md`](observability.md).

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Clever Cloud shows `OAuth callback is invalid` (`13502`) | The consumer's base URL does not match `APP_URL` on **scheme + host**. Use one consumer per environment. |
| After approving, you come back logged out | `APP_URL` does not point at the origin the browser used for `/auth/login` (in production: the frontend URL), so the temporary OAuth cookie is lost. Behind HTTPS, check that `APP_URL` starts with `https://`. |
| Everyone is logged out after each backend restart | No `ENCRYPTION_KEY` set, so a random one is generated per process. Set a stable one. |
| `npm run dev` / `build` stops with `[assets] ✗ …` | 3D models not installed. See [`ASSETS.md`](ASSETS.md). |
| Clever Cloud frontend build fails at `prebuild` | The deployed branch has no models (they are git-ignored). Deploy from a private branch with the assets force-added (§5). |
| `BACKEND_URL env var is required` on frontend start | Set `BACKEND_URL` to the backend URL. |
| Buildings stay grey / orange for a while | Expected on first load. They update on the next poll (≤10 s for status, ≤60 s for metrics). Check the backend logs (`DEBUG_CC_API=true`) if they never update. |
| More symptoms | [`deployment.md`](deployment.md) §8 *Troubleshooting*. |
