# myCCtown

Your Clever Cloud organisations, rendered as a living medieval 3D hex city. One map per
organisation, one building per application or add-on, with live status and CPU / RAM
streamed over WebSocket. A deploy that fails sets the building on fire; a busy app
spins its windmill faster.

- **Hosted instance**: <https://mycctown.cleverapps.io>

## Features

- **Builder mode**: lay out your own town on a hex grid. Place each app or add-on as a
  building, choose its skin, add roads, rivers and scenery.
- **View mode**: watch the city live. Status colours, fire on failure, CPU-driven
  animations, day/night, and a mayor who comments on what happens.
- **Real-time**: per-org poller (status and Warp10 metrics), plus optional Clever Cloud
  webhooks for sub-second updates.
- **Sign in with Clever Cloud** (OAuth 1.0a). Every user sees only their own
  organisations.

## Self-hosting

You can run your own instance, locally or in production.

👉 **[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)**: the complete guide
(prerequisites, Clever Cloud OAuth consumer, local run, deployment on Clever Cloud or
any server, environment variables, troubleshooting).

### 3D assets: not included, buy them first

The city is built from the **KayKit Medieval Hexagon Pack** by
[Kay Lousberg](https://www.kaylousberg.com). It is **not** in this repository. Buy the
**Source Files** edition, download `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip`, and
let the installer put the files in place:

```bash
cd frontend && npm install && npm run assets:install   # reads the zip from ~/Downloads
```

Store page: <https://kaylousberg.itch.io/kaykit-medieval-hexagon>. Step-by-step guide,
production notes and troubleshooting: **[`docs/ASSETS.md`](docs/ASSETS.md)**.

### Quick start (local)

Short version of [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) §4. You need Rust,
Node 20+, PostgreSQL, a [Clever Cloud OAuth consumer](docs/SELF_HOSTING.md#3-create-a-clever-cloud-oauth-consumer)
with base URL `http://localhost:3000`, and the KayKit archive.

```bash
# 1. Backend (:8080, applies migrations on boot)
cd backend
cp .env.example .env   # set POSTGRESQL_ADDON_URI + CC_OAUTH_CONSUMER_KEY/SECRET
cargo run

# 2. Frontend (another terminal; Vite on :3000 proxies /api /auth /ws → :8080)
cd frontend
npm install
npm run assets:install
npm run dev
```

Open <http://localhost:3000> and click **Login with Clever Cloud**.

## Stack

- **Backend**: Rust 2024, axum 0.8, sqlx (PostgreSQL), tower-sessions, AES-256-GCM
  encrypted OAuth tokens.
- **Frontend**: React 18, Vite 6, TypeScript, @react-three/fiber, Zustand,
  Tailwind v4 / daisyUI, served by a small Express proxy (`frontend/server.mjs`).

## Documentation

| Doc | For |
|---|---|
| [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) | Running your own instance. |
| [`docs/ASSETS.md`](docs/ASSETS.md) | Buying and installing the KayKit 3D assets. |
| [`docs/user-guide.md`](docs/user-guide.md) | End users: login, build your city, read the live scene. |
| [`docs/README.md`](docs/README.md) | Developer documentation index (architecture, backend, frontend, webhooks, deployment, observability). |

## License

The myCCtown source code is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run a
modified version as a network service, you must offer its source code to your users.

The license covers the code only. The KayKit 3D assets (© Kay Lousberg, distributed by
their author under CC0), the ambient music and the mayor portraits are **not** part of
this repository and are **not** covered by it. See [`docs/ASSETS.md`](docs/ASSETS.md).
