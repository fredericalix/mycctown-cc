# Déploiement Clever Cloud

## Deux apps distinctes

| App | Type | Domaine | Config |
|---|---|---|---|
| `mycctown-backend` | Rust | mycctown-backend.cleverapps.io | [backend.md](./backend.md) |
| `mycctown` | Node.js (static) | mycctown.cleverapps.io | [frontend.md](./frontend.md) |

## Premier déploiement

```bash
# Depuis le repo, à la racine mycctown/

# Backend
clever create --type rust --org <ORG> --region par mycctown-backend
clever link mycctown-backend
clever env set POSTGRESQL_ADDON_URI ...   # ou bien : clever addon create postgresql-addon --plan dev mycctown-db && clever service link-addon mycctown-backend mycctown-db
clever env set ENCRYPTION_KEY "$(openssl rand -base64 32)"
clever env set SESSION_SECRET "$(openssl rand -hex 32)"
clever env set CC_OAUTH_CONSUMER_KEY ...
clever env set CC_OAUTH_CONSUMER_SECRET ...
clever env set FRONTEND_URL https://mycctown.cleverapps.io
clever env set APP_URL https://mycctown-backend.cleverapps.io
# ... puis push avec `clever deploy` depuis le dossier backend/

# Frontend
clever create --type node --org <ORG> --region par mycctown
clever link mycctown
clever env set VITE_BACKEND_URL https://mycctown-backend.cleverapps.io
clever env set CC_RUN_COMMAND "npm start"
clever deploy
```

## OAuth consumer CC

Le consumer OAuth `mycctown` doit avoir dans ses callbacks autorisés :
- `https://mycctown-backend.cleverapps.io/auth/callback` (prod)
- `http://localhost:8080/auth/callback` (dev local)

## Sticky sessions

**Activer les sticky sessions** sur l'app backend pour que les clients WS restent
sur la même instance. Nécessaire parce que l'état du bus (`DashMap<OrgChannel>`)
et les broadcast channels sont in-memory par instance.
