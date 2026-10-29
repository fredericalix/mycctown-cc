# Backend — déploiement Clever Cloud

App type : **Rust**.
Nom de l'app : `mycctown-backend` (domaine `mycctown-backend.cleverapps.io`).

## Addons
- **PostgreSQL** (plan DEV suffit pour le MVP) lié à l'app → fournit automatiquement `POSTGRESQL_ADDON_URI`.

## Variables d'environnement

```
# Fourni par l'addon PG :
POSTGRESQL_ADDON_URI=

# Clés OAuth + chiffrement
ENCRYPTION_KEY=           # openssl rand -base64 32
SESSION_SECRET=
CC_OAUTH_CONSUMER_KEY=
CC_OAUTH_CONSUMER_SECRET=

# URLs
CC_API_BASE_URL=https://api.clever-cloud.com
WARP10_ENDPOINT=https://c2-warp10-clevercloud-customers.services.clever-cloud.com/api/v0/exec
FRONTEND_URL=https://mycctown.cleverapps.io
APP_URL=https://mycctown-backend.cleverapps.io

# Polling
WS_POLL_STATUS_SECS=10
WS_POLL_METRICS_SECS=15

PORT=8080
RUST_LOG=info,sqlx=warn,tower_http=info
```

## Sticky sessions
**Activer les sticky sessions** sur l'app (le state WebSocket est in-memory par instance). À défaut le reconnect d'un client peut tomber sur une instance différente.

## OAuth consumer CC
Le consumer doit lister `https://mycctown-backend.cleverapps.io/auth/callback` comme callback autorisée (en plus du callback local éventuel pour dev).

## Build & run
Clever Cloud utilise le Cargo par défaut. Rien de spécifique à configurer — push sur la branche cible déclenche le build.

## Scale
1× nano est suffisant pour le MVP.
