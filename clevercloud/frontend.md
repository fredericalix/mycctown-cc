# Frontend — déploiement Clever Cloud

App type : **Node.js** (build Vite + serveur statique via `serve`).
Nom de l'app : `mycctown` (domaine `mycctown.cleverapps.io`).

## Variables d'environnement

```
VITE_BACKEND_URL=https://mycctown-backend.cleverapps.io
```

Cette variable est lue au moment du build. Elle indique à `api/client.ts` et
`ws/useWsClient.ts` où tape le backend. En dev, on la laisse vide — Vite proxifie
`/api /auth /ws` vers `localhost:8080`.

## Build & run

Le `package.json` expose :
- `build` → `tsc && vite build` (produit `dist/`)
- `start` → `serve dist -s -l 8080`

`CC_RUN_COMMAND` : `npm start`

Les assets GLTF sont copiés dans `dist/assets/gltf/` par `vite-plugin-static-copy`
au moment du `vite build` (`assets/` étant au niveau parent du dossier `frontend/`).

## Note CORS / cookies

Le backend est sur un domaine différent → cookies `SameSite=None; Secure` sont
émis automatiquement par le backend (détecté via FRONTEND_URL ≠ APP_URL). Le
serveur statique n'a rien de particulier à configurer côté CORS — il ne fait
que servir les fichiers.

## Scale
1× nano est suffisant.
