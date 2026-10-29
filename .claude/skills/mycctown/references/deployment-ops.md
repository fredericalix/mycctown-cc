# Deployment & ops — load-bearing details

Companion to `CLAUDE.md`. CLAUDE.md owns the dev-by-default rule and the
APP_FOLDER monorepo deploy headline. This file extends them with what CC's
buildpacks actually do, the dev-env script's verbs, and the gotchas that
caught us in May 2026.

## APP_FOLDER buildpack mechanics — the full picture

The [`fredalix.com monorepo article`](https://blog.fredalix.com/p/deploiement-sur-clever-cloud-dun-backend-code-en-go-et-dune-application-web-reactjs/)
formalises the rule. The mechanic, in detail:

- **`APP_FOLDER=./backend`** (or `./frontend`) — CC's runner `cd`s into
  that directory **before** the buildpack runs. The Rust buildpack's
  `cargo build --release` and the Node buildpack's `npm install && npm
  start` both see the subdir as their CWD.
- **`CC_POST_BUILD_HOOK`** — runs **from the repo root**, NOT from
  `APP_FOLDER`. This is why the frontend hook is
  `npm --prefix ./frontend run build` — without `--prefix`, npm would
  look for `package.json` at the repo root and fail.
- **`CC_RUN_COMMAND`** — by the time it runs, `APP_FOLDER` has already
  changed CWD, so the `--prefix` is technically redundant. We keep it as
  a defensive measure (`npm --prefix ./frontend run start`) — if CC
  changes the order in the future, we don't break.
- **`CC_NODE_DEV_DEPENDENCIES=install`** — tells CC to install
  `devDependencies` before the build hook runs (otherwise `vite`,
  `typescript`, `@sentry/vite-plugin` aren't available at build time).

The interaction matrix is real. When you add a third app or rename an
existing one, **read `docs/deployment.md §1–2` end-to-end before touching
env vars**. Several variables interact:

```
APP_FOLDER · CC_POST_BUILD_HOOK · CC_RUN_COMMAND · CC_NODE_DEV_DEPENDENCIES
APP_URL    · FRONTEND_URL       · BACKEND_URL    · VITE_BACKEND_URL
WEBHOOKS_PUBLIC_URL  · USE_WEBHOOKS
```

Specifically: `APP_URL` is the **public frontend URL** (because the
browser hits the frontend's OAuth callback, which the proxy forwards to
the backend); it is NOT the backend's own URL. `WEBHOOKS_PUBLIC_URL` is
the backend's own URL (CC POSTs directly, not through the proxy).

## Build flavor S — load-bearing

Both the backend and the frontend run `--build-flavor S` even though
their run flavors are smaller. **Without it, `cargo build --release`
evicts the run instance** during deploys and the app is unreachable for
the duration of the build.

Don't drop `--build-flavor S` on either app, even on dev. It costs nothing
when the app is stopped (build instances are ephemeral).

## `./scripts/setup-dev-env.sh` — sub-command cheat-sheet

```
./scripts/setup-dev-env.sh <command> [args]
```

| Command | Calls | Notes |
|---|---|---|
| `create` | `clever create` (×2), `clever scale`, `clever domain add`, `clever addon create`, `clever oauth-consumers create`, `clever env set` (×many) | Idempotent. Skips anything that already exists. Reads secrets from `scripts/.env.dev` (gitignored). |
| `status` | `clever status --format json` (×2), `clever addon list`, `clever oauth-consumers list` | Read-only. Shows app states, addon presence, OAuth consumer presence, last commits, flavors. |
| `deploy [side]` | `clever deploy --alias` from `cd <subdir>` | No arg → backend then frontend. Side = `backend` or `frontend` to skip the other build. Encodes the APP_FOLDER `cd` rule. |
| `start` | `clever restart --alias` (×2) | Wakes stopped apps OR restarts running ones (CC's `restart` does both). Apps must have been deployed at least once. |
| `stop` | `clever stop --alias` (×2) | Idempotent (skips already-stopped apps). |
| `restart` | `stop` then `start` | Full cycle. |
| `destroy` | `clever delete -y`, `clever addon delete -y`, `clever oauth-consumers delete -y` | Interactive `Type 'destroy' to confirm:` prompt by default. `--yes` / `-y` to skip. **Local files (`scripts/.env.dev`, `.clever.json` entries) are NOT touched** — clean by hand if needed. |

The script also captures `SCRIPT_PATH` as an absolute path **before** the
`cd "$REPO_ROOT"`, so it can be invoked from anywhere (including from
inside `scripts/`).

## clever-tools 4.8 prompt gotchas (encoded in the script)

clever-tools 4.8 prompts interactively for fields the `--help` lists as
optional. Two known sites:

- **`clever oauth-consumers create`** prompts for `Consumer description:`
  and then `Application logo URL:` even when `--description` and
  `--picture` are not passed. With stdout redirected to `/dev/null`, the
  script silently waits forever.
- The script passes both flags + closes stdin with `</dev/null` as
  belt-and-suspenders against future hidden prompts:

  ```bash
  clever oauth-consumers create "$OAUTH_CONSUMER_NAME" \
    --url … --base-url … --rights … \
    --description "myCCtown dev environment" \
    --picture     "https://$FRONTEND_DOMAIN/favicon.svg" \
    --org … --format json </dev/null >/dev/null
  ```

If you write a new `clever <something>` invocation in a script, **always**
close stdin and capture stderr separately so the next prompt-on-an-optional
field doesn't deadlock you.

## What `create` puts on the backend — env var contract

The backend will refuse to boot without:

- `POSTGRESQL_ADDON_URI` (auto-injected by the addon link)
- `ENCRYPTION_KEY` (32 bytes base64, generated by the script if missing)
- `CC_OAUTH_CONSUMER_KEY` + `_SECRET` (pulled from the freshly-created
  consumer via `oauth-consumers get --with-secret`)
- `APP_URL`, `FRONTEND_URL`, `WEBHOOKS_PUBLIC_URL` (URL contract above)

Everything else (`USE_WEBHOOKS`, `RUST_LOG`, `SENTRY_DSN`,
`SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`) has a sane default if
unset, but the script still sets them so the deployed env matches the
documented one.

## Cellar music bucket — shared with prod

`VITE_MUSIC_BASE_URL` on the dev frontend points to the **same** Cellar
public URL as prod (`<your-music-bucket>.cellar-c2.services.clever-cloud.com`).
There's no `mycctown-music-dev` bucket. The MP3s are public-read and
identical between envs.

If you add tracks, follow `docs/deployment.md §2bis` (s3cmd, public ACL,
update `useAmbientMusic.ts` track list) — there's a single bucket.

## GlitchTip — shared projects, env-tagged

Same DSNs across envs; events are filtered by `SENTRY_ENVIRONMENT` (set
to `production` for prod, `development` for dev). When you triage in
GlitchTip, **always check the env filter first** — otherwise dev errors
mix into prod issue counts.

## Where to defer to docs/

- Full from-scratch app creation (only for a brand-new third app):
  `docs/deployment.md §1–7`.
- Cellar bucket setup (s3cmd commands, ACLs): `docs/deployment.md §2bis`.
- Rollback playbook (`USE_WEBHOOKS=false`, scale-down, previous-version):
  `docs/deployment.md §6`.
