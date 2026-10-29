# Backend — load-bearing details

Companion to `CLAUDE.md`. Topics already in CLAUDE.md (Warp10 cache self-heal,
addon batching, WarpScript template, sticky failed window) are not repeated
here; this file dives one level deeper into the parts that aren't.

## OAuth 1.0a signing

CC's `/v2` and `/v4` REST APIs require **OAuth 1.0a request signing** with
HMAC-SHA1, not bearer tokens. The signing helper lives in
`backend/src/auth/oauth.rs` (look for `sign_request` / `sign` / signing
utilities depending on the current shape).

Anatomy of a signed request:
- `oauth_consumer_key` + `oauth_token` + `oauth_signature_method=HMAC-SHA1`
  + `oauth_timestamp` + `oauth_nonce` + `oauth_version=1.0` are folded into
  the signature base string.
- The signing key is `consumer_secret&token_secret` (& is literal, secrets
  are URL-encoded first).
- The signature goes into the `Authorization: OAuth …` header alongside the
  other oauth_ params.

When you add a new CC API call site, **don't reach for `reqwest::Client::get`
directly** — pipe through whatever `signed_get` / `signed_request` helper
already exists. CC rejects unsigned requests with 401, not 403.

Sources of breakage:
- Forgetting to URL-encode the body params before sorting → 401.
- Using a stale `oauth_token_secret` (e.g. after a key rotation) →
  decrypt fails earlier in the chain (see "Two-path decrypt" below).

## Two-path `aead::Error` decrypt semantics

Both the Warp10 metrics token cache and the per-user CC OAuth token store
are encrypted-at-rest with `ENCRYPTION_KEY`. After a key rotation **two
different decrypt failures coexist** and they are intentionally handled at
different layers:

| Site | Behaviour on `aead::Error` | Log line |
|---|---|---|
| `backend/src/metrics/tokens.rs::ensure_token` (line 11) | swallowed → row deleted → fresh token re-fetched on the fly. Self-healing. | `stale warp10 token for user=… org=… (can't decrypt with current key: …) — invalidating cache` |
| `backend/src/ws/poller.rs::decrypt_owner_tokens` (around line 425) | fatal → `tx.send(WsFrame::SessionExpired)` → broadcast channel drops → frontend logs out | `poller: session expired` |

The asymmetry is intentional — we can re-fetch a Warp10 token without the
user noticing, but we cannot re-issue a CC OAuth token without a fresh
browser-side OAuth dance. Don't paper over the second site by mimicking the
first; the user must re-login.

When debugging "everything is yellow after deploy", grep the logs for
`stale warp10 token` first — the cache self-heals within one poll tick. If
instead you see `poller: session expired`, the user really must re-login.

## Status synthesis from raw CC state

CC's `/v2/applications/<id>/instances` returns lifecycle states like
`UP`, `DEPLOYING`, `WANTS_TO_BE_UP`, `SHOULD_BE_DOWN`. Two physical states
collapse to `SHOULD_BE_DOWN`:

- the user explicitly stopped the app
- the app exists but has never been deployed (just `clever create` so far)

We disambiguate by checking `last_deploy.is_none()` and emit a synthetic
`CREATED` status instead. The frontend maps `CREATED` to the scaffold asset
`building_stage_B` (a half-built building) so the city visually conveys
"this app is provisioned but inert".

If you add a new derived status, mirror it in:
- `frontend/src/types/ws.ts` (TS variant of the discriminated union)
- `frontend/src/utils/statusVisual.ts::assetIdForStatus` (which color/stage to
  pick for that status)
- `docs/user-guide.md §3.x` table (end-user documentation, maintained by hand)

## Session cookie scoping

The session cookie's `SameSite` + `Domain` attributes are **derived at boot**
from `APP_URL` (frontend, browser-facing) and `FRONTEND_URL` (set by the
backend, used to compute the same-origin proxy assumption). The decision
table:

| `APP_URL` host vs `FRONTEND_URL` host | `APP_URL` scheme | `SameSite` | Notes |
|---|---|---|---|
| same | https | `Lax` | The standard prod path: frontend reverse-proxies `/api /auth /ws`. |
| different | https | `None` + `Secure` | Only path that survives Safari/Firefox 3rd-party cookie blocking. |
| different | http | `Lax` (defensive) | Browsers reject `SameSite=None` over plain HTTP; the cookie won't survive but at least we don't reject the request. |

Look in `backend/src/auth/session.rs` (or wherever `SessionLayer` /
`tower_sessions::SessionManagerLayer` is configured) for the actual matrix.

The `Domain` attribute is **never set** — leaving it implicit ties the cookie
to the exact host in the response. Setting `Domain=cleverapps.io` would be
rejected since it's a Public Suffix List entry. CLAUDE.md covers the PSL
bite; this is the implementation-level corollary.

## Webhook receiver gotchas

Just the wiring details that aren't already in CLAUDE.md or
`docs/webhooks.md`. For deeper webhook flow knowledge, see
[`webhooks.md`](webhooks.md) in this skill.

- The receiver route is **mounted outside the session-cookie layer** (it has
  no human user; auth is the URL token). Don't add a session extractor to it.
- Always 204 on a known token, even on duplicate-by-dedup. Returning 4xx on
  a duplicate causes CC to retry forever.
- The `webhook_dedup` map is bounded to ~10 k entries and entries TTL out
  after 60 s. Inspect it via `state.webhook_dedup` if delivery seems stuck.

## Adding a poller tick

Don't grow the poll loop linearly. The current shape is:
- `tick_status` (10 s) — cheap, calls `/v2/organisations/.../applications`
- `tick_metrics` (15 s) — Warp10 query, app CPU/RAM
- `tick_addons` (30 s) — `/v4/addon-providers/.../resources` + chunked Warp10

If you add a new tick, decide **what fails it shouldn't take down**. Use
`tokio::select!` + per-tick `JoinHandle` so a single API outage doesn't kill
the loop. The chunked-Warp10 pattern in `tick_metrics::addons` is the
template.

For full cadence + override env vars (`WS_POLL_STATUS_SECS`, …), see
`docs/backend.md §Poller`.
