---
name: mycctown
description: Load when working on the myCCtown project — the Clever Cloud organisation viewer rendered as a 3D medieval hex city. Triggers when modifying or debugging the Rust backend (axum 0.8, sqlx, tower-sessions, CC OAuth 1.0a, Warp10 metrics, CC webhooks), the React + @react-three/fiber frontend (Zustand stores, GLTF asset loader, R3F scene, building effects), GlitchTip / Sentry integration, or the dev/prod stack on Clever Cloud. Provides the load-bearing details that complement CLAUDE.md (which holds cardinal rules) and indexes deeper material in docs/.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# myCCtown skill

This skill is the per-domain extension of `CLAUDE.md`. CLAUDE.md (always loaded
into every session) carries the cardinal rules — same-origin cookies, sticky
failed window, cache-bust `?v=N`, Sentry layer order, dev-by-default, and the
other invariants you must not break. This skill carries the **load-bearing
details inside each domain** — function names, file paths, exact constants,
gotchas not big enough to crowd CLAUDE.md but expensive to re-derive every
session.

The body of the skill is the dispatch table below. **Read only the reference
file relevant to the work**; opening all five at once defeats the purpose.

## When to consult each reference

| Working on… | Open |
|---|---|
| `backend/src/auth/oauth.rs`, `backend/src/api/cc.rs`, anything signing / calling the CC API | [`references/backend.md`](references/backend.md) §OAuth 1.0a signing |
| `backend/src/ws/poller.rs`, `backend/src/metrics/`, an `aead::Error` decrypt path, status synthesis | [`references/backend.md`](references/backend.md) §Two-path decrypt + §Status synthesis |
| `backend/src/auth/session.rs`, anything cookie-related | [`references/backend.md`](references/backend.md) §Session cookie scoping |
| `frontend/src/components/scene/**`, building effects, animation speed | [`references/frontend.md`](references/frontend.md) §R3F scene |
| `frontend/src/utils/assetLoader.ts`, `data/assetCatalog.ts`, GLTF cache-bust | [`references/frontend.md`](references/frontend.md) §Asset pipeline |
| Any new Zustand store, selectors, hooks rendering store data | [`references/frontend.md`](references/frontend.md) §Zustand selector golden rule |
| `backend/src/webhooks/**`, adding a CC event, debugging duplicate deliveries | [`references/webhooks.md`](references/webhooks.md) |
| GlitchTip / Sentry config, `frontend/src/utils/debug.ts`, `backend/src/main.rs` Sentry layers | [`references/observability.md`](references/observability.md) |
| `scripts/setup-dev-env.sh`, dev/prod env vars, APP_FOLDER, monorepo deploy mechanics | [`references/deployment-ops.md`](references/deployment-ops.md) |

## Strict no-duplication rule

Anything that's already in `CLAUDE.md` is intentionally absent from this skill.
If you need:

- the same-origin cookie strategy (Public Suffix List + reverse-proxy)
- the sticky failed window (`failed_apps` DashMap, 10 min)
- the Warp10 cache self-heal vs. OAuth-token-decrypt-is-fatal distinction (one-line summary)
- the addon-metrics chunking (`ADDON_BATCH_SIZE = 5`)
- the WarpScript `no-BUCKETIZE` decision
- the cache-bust `?v=N` + non-hashed `Cache-Control` rule
- the meshopt-on-hold note
- the HTTP/2 idle-blip retry backoff
- the Sentry/GlitchTip layer-order + sourcemap-debug-id facts
- the lazy-color and animation-curve summaries
- the dev/prod default rule on CC

…go to `CLAUDE.md`. The skill repeats none of these. The references go one
level deeper (specific function names, line numbers, signatures, decision
tables) without repeating the headline.

## Pointers to docs/

Some material is too long to inline; the skill points at the doc instead:

- `docs/backend.md §Poller` — full tick cadence + env var overrides table.
- `docs/backend.md §Metrics template` — full WarpScript rationale (lag analysis).
- `docs/frontend.md §Scene pipeline` — canvas tree + HexTile lifecycle diagram.
- `docs/frontend.md §Asset system` — GLTF catalog taxonomy + compression status.
- `docs/observability.md §Uptime monitors + alerts` — monitor IDs, alert rules.
- `docs/webhooks.md §Event catalog + §Sniffer` — confirmed events + the sniffer companion.
- `docs/deployment.md §1–7` — full from-scratch app creation (only useful for
  a brand-new third app, almost never).

## How to extend

When you learn a new load-bearing detail (numeric constant, naming rule,
decision rationale that won't fit on one CLAUDE.md line), append it to the
appropriate `references/<domain>.md`. SKILL.md only needs editing when a
whole new domain shows up (e.g. a new mobile client, a new backing service).

When a `references/<domain>.md` exceeds ~400 lines, split by sub-topic — keep
the index in this file synced.

When CLAUDE.md absorbs a topic that was in a reference, **delete it from the
reference** (no duplication ever). The skill always defers to CLAUDE.md.
