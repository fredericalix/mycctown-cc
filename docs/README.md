# myCCtown — Docs

Near-real-time **Clever Cloud organisation viewer** rendered as a
medieval 3D hex city. Every app or addon you map onto a hex takes on
a building silhouette; its colour tracks the live status (green = running,
blue = deploying, red = failed, yellow = unknown, scaffolding = created or
stopped).

- **Production** — <https://mycctown.cleverapps.io>
- **Backend** — <https://mycctown-backend.cleverapps.io>
- **Repo** — this one (monorepo: `backend/` Rust, `frontend/` React + R3F)

## Contents

| Doc | Read this if… |
|---|---|
| [architecture.md](architecture.md) | You want the big picture: how the two apps, PostgreSQL, CC OAuth, CC webhooks, and Warp10 fit together. |
| [backend.md](backend.md) | You're contributing to the Rust backend (axum + sqlx + tokio + tower-sessions). Module tour + cheat sheets. |
| [frontend.md](frontend.md) | You're contributing to the React / R3F frontend. Store map + scene components + cheat sheets. |
| [webhooks.md](webhooks.md) | You're wiring CC notification webhooks to myCCtown, or extending the event catalog. |
| [observability.md](observability.md) | You're tracing or debugging an issue: GlitchTip + Sentry SDK setup, sourcemaps, MCP from Claude Code. |
| [SELF_HOSTING.md](SELF_HOSTING.md) | You want to run your own instance (OAuth consumer, local run, deployment, env vars). |
| [ASSETS.md](ASSETS.md) | You need to buy + install the KayKit 3D models (not shipped with the repo). |
| [deployment.md](deployment.md) | You're deploying on Clever Cloud (or cloning the stack for a fork). |
| [user-guide.md](user-guide.md) | You're an end-user: login, build your city, read the live scene, set up real-time updates. |
| [TODO.md](TODO.md) | Docs-specific follow-ups (screenshots to add, sync points between code and docs). |
| [add-anims-with-blender.md](add-anims-with-blender.md) | Prompt to hand to a Blender-capable AI to split merged building meshes into named child nodes for procedural animation. |

Backlog of project-level "next steps" and open design decisions lives
in `a-faire-bientot.md` at the repo root (private repository only — not part of the
open-source mirror).

## Repo map

```
mycctown/
├── backend/         # Rust (axum 0.8, sqlx, tokio, tower-sessions)
│   ├── src/
│   │   ├── api/         # CC API client + REST routes
│   │   ├── auth/        # OAuth 1.0 flow + session middleware
│   │   ├── db/          # sqlx-backed repositories
│   │   ├── metrics/     # Warp10 client + per-(user, org) token cache
│   │   ├── webhooks/    # CC notification receiver (outside session layer)
│   │   ├── ws/          # per-org broadcast channels + status/metrics poller
│   │   └── …
│   └── migrations/      # 001 → 005 (users, maps, warp10_tokens, webhook_configs)
├── frontend/        # React 18 + Vite + Zustand + @react-three/fiber
│   ├── public/
│   │   └── assets/gltf/ # KayKit Medieval Hexagon Pack models (24 MB)
│   ├── src/
│   │   ├── api/         # REST + WS clients
│   │   ├── components/  # builder/ + scene/ + layout/ + auth/
│   │   ├── stores/      # zustand: auth, map, realtime, assets, org, uiMode
│   │   ├── three/       # useAnimations (windmill/wheel/cloud/water)
│   │   └── utils/       # hexMath, statusVisual
│   └── server.mjs       # Express reverse-proxy (same-origin for /api /auth /ws)
├── clevercloud/     # raw prod setup notes (backend.md + frontend.md)
├── a-faire-bientot.md  # backlog (private repo only)
└── docs/            # this folder
```

## Quick facts

- **Single-origin deploy** — the frontend Node server reverse-proxies
  `/api`, `/auth`, `/ws` to the backend, so session cookies are
  first-party (Safari / Firefox third-party cookie blocking was the
  first deploy blocker we fought). See
  [architecture.md#cookie-scope](architecture.md).
- **Webhooks are manual setup** — an org admin pastes a
  `(user, org)`-unique URL into the CC console. No auto-registration —
  scopes are tricky and inconsistent. See [webhooks.md](webhooks.md).
- **Polling is still the primary source** — webhooks give ~1 s latency
  but aren't guaranteed; a 10 s Clever Cloud API poll runs as a safety
  net per org. See [backend.md#poller](backend.md).
- **404 GLTF entries (~22 MB on disk), but ~6 MB at boot** — the loader
  is **lazy-by-color**: only non-color assets + one dominant color
  (`green`) are fetched upfront; other status colors arrive on demand
  the first time a `HexTile` needs them. See
  [frontend.md#asset-system](frontend.md). Asset URLs are
  cache-busted with `?v=ASSET_VERSION` (bump on breaking content
  changes); Vite bundles get `immutable` cache, the rest gets
  `must-revalidate`.
- **Ambient music streams from a separate origin** — a Cellar (S3)
  bucket at `<your-music-bucket>.cellar-c2.services.clever-cloud.com` so
  audio doesn't queue behind the GLTF stream. See
  [deployment.md §2bis](deployment.md).
