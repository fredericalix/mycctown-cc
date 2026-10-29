# Frontend (React + @react-three/fiber)

`frontend/` is a Vite-built React 18 SPA. The 3D scene is
[@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) on top of
three.js, with [@react-three/drei](https://github.com/pmndrs/drei) for
camera controls + HTML overlays. State is in
[zustand](https://github.com/pmndrs/zustand). No Redux, no context
providers besides the R3F `useThree` one.

## Stack

| Purpose | Package |
|---|---|
| UI framework | `react@18` |
| Build | `vite@6` |
| 3D | `three@0.172` + `@react-three/fiber@8` + `@react-three/drei@9` |
| Camera input | `camera-controls` |
| Styling | Tailwind v4 via `@tailwindcss/vite` + `daisyui@5` |
| State | `zustand@5` |
| Audio | Plain `HTMLAudioElement` (no Web Audio API) |
| Prod server | `express` + `http-proxy-middleware` + `compression` |
| GLTF compression (deferred) | `gltfpack` devDep + `MeshoptDecoder` (pipeline disabled — see `a-faire-bientot.md` §2, private backlog) |

## Source tree

```
frontend/
├── public/assets/gltf/       # KayKit Medieval Hexagon Pack (~24 MB)
├── server.mjs                # Production reverse proxy (see deployment.md)
├── src/
│   ├── main.tsx              # ReactDOM + router root
│   ├── App.tsx               # Routing shell + AuthGate
│   ├── api/
│   │   ├── client.ts         # fetch() with credentials: 'include'
│   │   ├── auth.ts           # /auth/me, logout, loginHref
│   │   ├── orgs.ts           # /api/orgs, /api/orgs/:id/…, webhook-setup
│   │   └── maps.ts           # /api/orgs/:id/map
│   ├── ws/
│   │   └── useWsClient.ts    # WebSocket connect + backoff reconnect
│   ├── stores/
│   │   ├── useAuthStore.ts
│   │   ├── useOrgStore.ts
│   │   ├── useMapStore.ts
│   │   ├── useRealtimeStore.ts
│   │   ├── useAssetStore.ts
│   │   ├── useAnimationStore.ts
│   │   ├── useMusicStore.ts
│   │   └── useUiModeStore.ts
│   ├── types/
│   │   ├── cc.ts             # CcApplication, CcAddon, …
│   │   ├── map.ts            # HexCell, Decoration
│   │   └── ws.ts             # WsFrame union + ResourceStatus + normaliseAppState
│   ├── data/
│   │   ├── assetCatalog.ts   # ASSET_CATALOG[] (tiles + buildings + deco + units)
│   │   ├── buildingSkins.ts  # buildingId / parseBuildingId (type + color)
│   │   └── appTypeMapping.ts # CcApplication.type → default KayKit building
│   ├── utils/
│   │   ├── hexMath.ts        # axial <→ world, neighbors, rotation
│   │   ├── statusVisual.ts   # status → asset variant
│   │   └── assetLoader.ts    # GLTF lazy-by-color loader + ?v=N cache-bust
│   ├── three/
│   │   └── useAnimations.ts  # windmill / wheel / cloud / water / flag loop
│   ├── hooks/
│   │   ├── useAssetLoader.ts # boots loadInitialAssets once at mount
│   │   └── useAmbientMusic.ts # HTMLAudioElement, shuffle bag, autoplay retry
│   ├── scripts/
│   │   └── compress-gltf.mjs # gltfpack post-build (DISABLED, see backlog)
│   └── components/
│       ├── auth/             # LoginPage, AuthGate
│       ├── layout/           # TopBar, OrgSelector, WebhookSetupModal,
│       │                     # MusicToggle
│       ├── builder/          # BuilderLayout, Inspector, MappingPanel,
│       │                     # LeftSidebar, LiveResource, AssetPreview
│       └── scene/            # SceneCanvas, HexGrid, HexTile, GhostHexes,
│                             # StatusBadge, StatusParticles, DeployScaffold,
│                             # CloudLayer, DayNightController, GroundPlane,
│                             # SelectionIndicator, ParticleEffects,
│                             # FloatingInspector
```

## State: stores

Zustand slices, all flat, no redux-style actions. Read with narrow
selectors to avoid re-renders:

| Store | Owns | When it updates |
|---|---|---|
| `useAuthStore` | `status`, `user` | `refresh()` on app mount; `logout()` on expiry |
| `useOrgStore` | `orgs`, `apps`, `addons`, `currentOrgId`, `appDependencies` | `loadOrgs()`, `refreshResources()` |
| `useMapStore` | `cells: Map<key, HexCell>`, `selectedCell`, save status | `setCell`, `setBuilding`, `assignResource`, `loadFromServer`, debounced `saveToServer` |
| `useRealtimeStore` | `apps: Record<id, AppSnapshot>`, `addons: Record<id, AddonSnapshot>`, `connected`, `lastError` | Every incoming `WsFrame` via `push()` |
| `useAssetStore` | GLTF cache `Map<id, GLTF>`, `sharedTexture`, `loadedColors: Set`, `loadingColors: Set` | `loadInitialAssets()` at boot (always-needed + dominant color), then `ensureColorLoaded(color)` on demand from HexTile |
| `useAnimationStore` | Toggle flags (wind, water, day-night, clouds, particles) | LeftSidebar controls |
| `useMusicStore` | `enabled: boolean` (persisted in localStorage), `currentTrack: string \| null` | Toggle in TopBar; `useAmbientMusic` hook updates `currentTrack` on each track change |
| `useUiModeStore` | `mode: 'builder' \| 'view'` | LeftSidebar toggle |
| `useMayorStore` | `queue`, `current`, `history` (cap 30), `historyOpen`, `enabled` (persisted) | `notify()` from `mayorObserve`/tips; `next()`/`dismiss()` from the popup; `toggleHistory()` from TopBar |

### The golden rule: selectors return primitives

Synthesising a fresh object inside a selector causes Zustand's
`Object.is` comparator to fire on every store update, which causes an
infinite render loop. Always return either a primitive or a direct
store reference:

```ts
// ✅ primitive
const status = useRealtimeStore((s) => s.apps[id]?.status ?? null);

// ✅ direct ref
const app = useOrgStore((s) => s.apps.find((a) => a.id === id) ?? null);

// ❌ synthesises {status, cpu} each call — infinite loop
const bad = useRealtimeStore((s) => ({ status: s.apps[id]?.status, cpu: s.apps[id]?.cpuPct }));
```

See `StatusBadge.tsx` comments for the original bug that drilled this
lesson into us.

## Scene pipeline

```
SceneCanvas (<Canvas>)
├── <CameraControls/>
├── <HexGrid/>            # maps cells to <HexTile>s
│   └── <HexTile/> × N
│       ├── tile model    (cloneModel(cell.tile), rotation + elevation)
│       ├── building model (cloneModel(assetIdForStatus(cell.building, status)))
│       ├── village PointLight (always; intensity ramped by useDayNight)
│       ├── <BuildingEffects/>    # per-type ambient + CPU-driven effects
│       └── {showExtras && <StatusBadge/> + <StatusParticles/> + <DeployScaffold/>}
├── <GhostHexes/>         # only in builder mode (see below)
├── <CloudLayer/>
├── <GroundPlane/>
├── <DayNightController/>
├── <ParticleEffects/>    # global scene particles (fireflies at night)
├── <SelectionIndicator/> # ring around selected hex, builder only
└── <ViewModeFloatingInspector/>
```

### Status drives asset choice + particles

A `HexTile` reads `buildingStatus` via two selectors
(`s.apps[appId]?.status`, `s.addons[addonId]?.healthy`). The derived
enum is `'running' | 'deploying' | 'failed' | 'warning' | 'stopped' |
'unknown' | 'created'`. Then:

```ts
const activeBuildingId = assetIdForStatus(cell.building, buildingStatus);
// running → building_<type>_green
// deploying → building_<type>_blue
// failed/warning → building_<type>_red
// unknown → building_<type>_yellow
// created/stopped → building_stage_B (always)
```

`assetIdForStatus` is in `src/utils/statusVisual.ts`. If the base
building has no color variant (`building_bridge_A`, `building_stage_A`,
etc.), the function leaves it unchanged except for `created/stopped`.

`StatusParticles.tsx` renders smoke for `deploying` and full-bonfire
(80 particles, hot→cool color lerp, pulsing orange point light, red
ground halo) for `failed`. `DeployScaffold.tsx` adds a wooden frame
around the building while deploying.

### BuildingEffects (per-type ambient + CPU-driven)

`components/scene/BuildingEffects.tsx` is mounted from every
`HexTile` with a `cell.building`. It parses the building type with
`parseBuildingId` and dispatches to sub-effects:

| Effect | Triggers on | What it does |
|---|---|---|
| **ChimneySmoke** | `running` apps with a building type in `CHIMNEY_OFFSETS` (home_A/B, tavern, blacksmith, workshop, townhall) | Grey particle column rising from a per-type local offset. Density scales with the live `cpuPct`. |
| **MineDust** | `running` apps on `building_mine_*` | Low, forward-drifting brown particles from the entrance. Density ∝ CPU. |
| **BlacksmithSparks** | Always on `building_blacksmith_*` | 20 yellow-orange sparks bursting every ~1.3 s with gravity + drag, plus a pulsing orange `pointLight` at the forge synchronized to the hammer beat. Brighter when `running`. |
| **ProceduralFlag** | Always on `castle`, `townhall`, `church` | Thin wooden pole + `a51050` cloth plane waving in a sinus loop. No glTF flag mesh exists — we build it in-code. |
| **WatchtowerLight** | Always on `watchtower`, `tower_A/B`, `tower_base`, `tower_cannon`, `tower_catapult` | A warm-orange `spotLight` at the roof, rotating on Y at 0.8 rad/s. Very visible at night. |

Offset positions are hand-tuned (KayKit meshes are merged so there's
no named sub-node to pick up; see `CHIMNEY_OFFSETS`, `MINE_ENTRANCE`,
`FORGE_ORIGIN`, `FLAG_TOP`, `LANTERN_TOP` in the same file). Tweak
those constants and hot-reload to realign any effect visually.

### Village lights

Every cell with a `cell.building` pushes a
`THREE.PointLight(0xffaa44, 0, 3.5, 2)` into the shared
`villageLightsRef`. `useDayNight` iterates that ref each frame and
ramps `intensity` from 0 at noon to 1.5 at midnight — so every
building has a warm lantern glow at night, including mines, docks,
workshops and scaffolding. There used to be a `LIT_BUILDINGS`
whitelist that missed roughly half the catalog; we removed it.

On very large maps (>100 bound buildings) this starts to push
three.js's per-fragment light limit (defaults to 8). If night
rendering ever looks patchy on a huge city, consider swapping the
point lights for a single `InstancedMesh` of halo quads.

### Ghost hexes (builder)

`GhostHexes.tsx` renders translucent `hex_grass` clones at every empty
neighbour of an existing cell. Click detection is NOT on the ghost
mesh — `BuilderLayout.tsx` raycasts the Y=0 plane, converts to axial
coords, and if the coord is empty AND is a neighbour of an existing
cell, calls `setCell({ tile: 'hex_grass' })`.

Guarded by `useUiModeStore(s => s.mode) === 'builder'` inside the
component (the parent `SceneCanvas` receives `mode="builder"` from
`BuilderLayout` unconditionally, so we can't rely on the prop alone).

### Animation registry

`SceneCanvas` exposes an `AnimationContext` with `register(type, obj)`
/ `unregister`. `HexTile` registers windmill fans, watermill wheels,
water tiles, trees, boats, flags via `userData.resourceId = appId`
stamped on each animatable child.

`three/useAnimations.ts` runs a single `useFrame` that iterates each
registry list and applies per-object deltas. `animationSpeedFor()`
looks up the resource's live status + CPU to modulate rotation
speed. For `running` apps the curve is **non-linear**:

```ts
const norm = Math.min(1, Math.max(0, app.cpuPct / 100));
return 0.3 + Math.pow(norm, 1.8) * 4.7;
// 0%   → 0.3×  (barely turning)
// 50%  → ~1.6×
// 80%  → ~3.4×
// 90%  → ~4.4×
// 100% → 5.0×  (clearly ripping)
```

We chose a power of 1.8 so the 80-100% zone feels noticeably
"turbo" compared to idle — a linear 0.3→2 range did exist but
didn't read as saturation from the overview camera. `deploying`
stutters, `failed`/`stopped` freeze.

Clouds wrap bidirectionally on both X and Z at ±20 m so they never
drift to infinity.

## Asset system

The catalogue (`src/data/assetCatalog.ts`) has 404 entries — 5 colors ×
~55 colored building variants + ~184 always-needed assets (tiles,
decorations, neutral buildings, props, scaffolding). Loading them all
upfront stalls the first paint for ~25 s on a typical connection, so
the loader runs in two phases.

### Phase 1: `loadInitialAssets(initialColor)` (boot)

Fetches every entry whose `subcategory` is **not** in
`BUILDING_COLORS = ['blue','green','red','yellow']`, plus the entries
of one dominant color (`green` — running apps are the common case).
That's ~239 GLTFs at boot instead of 404. Each model has its
embedded texture replaced by the shared `hexagons_medieval.png` atlas.

### Phase 2: `loadColorAssets(color)` (lazy)

Triggered from `useAssetStore.ensureColorLoaded(color)`, called by
`HexTile` the first time a building wants a variant whose color isn't
in `loadedColors` yet. The fetched GLTFs are merged into a
freshly-allocated `cache` Map (Zustand sees the reference change and
re-renders subscribers); `loadedColors` itself is also a fresh `Set`
so the placement effect of every `HexTile` re-runs and swaps the
scaffold placeholder for the proper colored variant.

While a color is downloading, `HexTile` falls back to
`cloneModel('building_stage_B')` (a neutral scaffold that's always
loaded). Status changes that need an as-yet-unloaded color get the
scaffold for a few hundred ms and then snap to the real building.

### Cache-bust via `?v=ASSET_VERSION`

Static asset paths under `/assets/gltf/` aren't content-hashed by
Vite, so a deploy that changes a `.bin` content can't expire stale
caches by URL alone. `assetLoader.ts` installs a
`THREE.LoadingManager.setURLModifier` that appends `?v=${ASSET_VERSION}`
to every fetched URL (gltf, bin, png) — the modifier is shared by the
GLTFLoader and the TextureLoader so the bundled `.bin` URIs that
GLTFLoader resolves internally also pick up the suffix. **Bump
`ASSET_VERSION`** (`src/utils/assetLoader.ts:14`) on any non-backwards-
compatible change to `public/assets/gltf/`. The Vite bundle hash also
changes (the source did), so HTML (`no-cache`) pulls the new bundle,
which requests new URLs nobody has cached → fresh fetch.

URLs that already carry `?v=` or are absolute (e.g. the Cellar music
URL) are passed through unchanged.

### Compression pipeline (currently disabled)

`scripts/compress-gltf.mjs` runs `gltfpack -cc` in 8-way parallel on
every `dist/assets/gltf/**/*.gltf` after `vite build`. It cuts
`.bin` payloads by ~74 % (22 MB → 5.9 MB measured) and is wired up
behind `npm run compress-gltf`. The step is **not** in the `build`
script today because `gltfpack 1.1.0` produces files that crash
Three.js 0.172's `MeshoptDecoder` on a subset of assets — see
`a-faire-bientot.md` §2 (private backlog, not in the public mirror) for the diagnosis and four ranked routes
to retry. The `setMeshoptDecoder(MeshoptDecoder)` call stays in the
loader so we can re-enable without code surgery.

`AssetPreview.tsx` inside Inspector mounts a second `<Canvas>` at
~120×120 and renders the currently-hovered-or-selected asset with an
orbit. `CenteredModel` uses a `Box3` to re-center and rescale
arbitrary GLTFs into a 1.6-unit cube.

## Ambient music

`useAmbientMusic.ts` owns a single `HTMLAudioElement`. State machine:

- **Boot**: read `enabled` from localStorage (`mycctown.music.enabled`).
  Audio element is created with `volume = 0.4`, `preload = 'auto'`, no
  `src` until enabled.
- **Toggle on**: pick a track from a shuffle bag, set `audio.src` to
  `${VITE_MUSIC_BASE_URL}/${encodeURIComponent(track)}`, call
  `audio.play()`. The shuffle bag holds the 6 tracks; when empty it's
  reshuffled with a swap-first-element guard so the same track can't
  play twice in a row across cycle boundaries.
- **Track ends**: pick next from the bag, swap `src`, `play()`.
- **Browser autoplay block**: if `audio.play()` rejects (typical after
  a reload with `enabled=true` and no prior interaction), a one-shot
  `pointerdown`/`keydown` listener on `document` retries.
- **Toggle off**: `audio.pause()`.

The `MusicToggle` button in `TopBar.tsx` flips `enabled` on click.
`title` shows the currently-playing track (without the `.mp3`).

`VITE_MUSIC_BASE_URL` is set on the frontend CC app to the public
Cellar URL (`https://<your-music-bucket>.cellar-c2.services.clever-cloud.com`).
Falls back to `/music` for local dev (the `sync-music` build step
copies `music/*.mp3` from the repo root into `public/music/`). Adding
a track means uploading it to Cellar (`s3cmd put --acl-public ...`)
**and** appending it to the `TRACKS` array in `useAmbientMusic.ts:5`.

## Mayor advisor

A SimCity-style advisor that pops up to announce lifecycle events and give
occasional tips. All files live under `src/mayor/` and `src/components/mayor/`.

Data flow:

```
WS frame ──► useWsClient.onmessage
               ├── mayorObserve(frame)   ← reads PRE-push realtime state
               │     └── useMayorStore.notify({mood,title,detail})
               └── useRealtimeStore.push(frame)
useMayorStore (queue → current → history)
   ├──► <MayorPopup/>     bottom-left overlay in App's <main>, auto-dismiss + queue
   ├──► <MayorHistory/>   chronicle panel (portal, z-100) + mute toggle, from TopBar
   └──► <MayorToggle/>    🏛️ button in TopBar
```

- **`mayorObserve.ts`** is the single hook point, called **before** `push` so it
  can compare the incoming frame to the previous snapshot. It only announces
  genuine *transitions* (prev exists + status changed); the connection replay
  burst has no prev, and a `WARMUP_MS` window after the `hello` frame swallows
  first-sightings so a fresh connection / org switch doesn't flood. After
  warm-up, a first-sighting `app_status` / `addon_added` is treated as a real
  arrival. Metrics frames are ignored (no CPU/RAM triggers by design).
- **`mayorMessages.ts`** maps each event kind to `{mood, title, detail}` —
  medieval-light flavour in `title`, plain readable info in `detail`. English
  only (single locale).
- **`useMayorTips.ts`** drives proactive tips: a one-time onboarding nudge
  (localStorage `mycctown.mayor.tips`) and a per-org-visit city-status check
  (warns when apps are `failed`, on a delay so the WS baseline has landed).
- **`useMayorStore`** queues announcements so they show one at a time; `enabled`
  (localStorage `mycctown.mayor.enabled`, default on) is the mute switch.
- **Portraits** live in `public/mayor/mayor_{happy,neutral,alarmed}.png`. They're
  static (not under `/assets/gltf/`), so no `ASSET_VERSION` bump is needed.
  `MayorPortrait.tsx` falls back to a crowned emoji medallion if a PNG is absent.

To add a new announcement: add a builder to `mayorMessages.ts`, then call it
from the relevant `case` in `mayorObserve.ts` (or `useMayorTips.ts` for a tip).

## Prod serving

The frontend app runs `node server.mjs` (not `serve` anymore — we
needed a real proxy). Roles:

1. Same-origin reverse proxy for `/api`, `/auth`, `/ws` (see
   [architecture.md#cookie-scope](architecture.md)).
2. Static server for `dist/` with **two cache profiles**:
   - **Vite-hashed bundles** (`assets/index-*.js|css|woff2`):
     `max-age=31536000, immutable` — content-addressed, safe to pin.
   - **Everything else under `/assets/`** (gltf, bin, png):
     `max-age=3600, must-revalidate`. **Do not** mark these
     `immutable` — non-content-addressed paths can change between
     deploys, and `immutable` would seal a broken version into client
     caches with no way to revalidate.
   - **`index.html`**: `no-cache, must-revalidate` so deploys land on
     next page load.
3. Gzip middleware **skipping**:
   - already-compressed binaries: `.bin .png .webp .jpg .jpeg .gif
     .mp3 .wav .ogg .m4a .mp4 .webm`
   - any request carrying a `Range:` header — `compression` mangles
     206 responses (drops Content-Length, chunks the body), and the
     resulting HTTP/2 framing breaks behind the CC edge:
     `<audio>`/`<video>` Range fetches surface as
     `ERR_HTTP2_PROTOCOL_ERROR`.

## Cheat sheets

### Add a new ground tile

1. Drop the GLTF + `.bin` into `frontend/public/assets/gltf/tiles/<sub>/`.
2. Add an entry to `ASSET_CATALOG` in `src/data/assetCatalog.ts`:
   ```ts
   { id: 'hex_my_new_tile', path: 'assets/gltf/tiles/base/hex_my_new_tile.gltf',
     category: 'tiles', subcategory: 'base' },
   ```
3. That's it — the Inspector's tile palette groups by
   `subcategory` so the new option appears automatically under Base/
   Coast/Rivers/Roads once the asset is loaded.

### Add a new decoration

Same as above but `category: 'decoration'`, `subcategory: 'nature' |
'props'`. Then add an entry to `DECOR_OPTIONS` in
`src/components/builder/Inspector.tsx`:

```ts
{ group: 'Nature', items: [
    { id: 'my_new_deco', label: 'Pretty thing' },
    …
]}
```

### Add a new status (visual)

1. Extend `ResourceStatus` in `src/types/ws.ts`.
2. Map CC raw state strings in `normaliseAppState()`.
3. Add a case to the `STATUS_COLOR` map in
   `src/utils/statusVisual.ts`:
   ```ts
   const STATUS_COLOR: Partial<Record<ResourceStatus, BuildingColor>> = {
       …
       my_new_status: 'green',
   };
   ```
   Or handle fully in `assetIdForStatus` if the status swaps to a
   neutral asset like stage_B.
4. Update `StatusBadge.tsx` COLORS + animation case.
5. Optional: add a particle/effect case in `StatusParticles.tsx`.

### Add a new Inspector section

`Inspector.tsx` is a single file today. Add a new `<div className="mt-4
pt-3 border-t cc-border-soft">` block inside the component, gated on
`!hasResource` or whatever condition makes sense, and hook it to a
store mutation. Each palette button should call `setHoveredId(item.id)`
on `onMouseEnter` / `null` on `onMouseLeave` so the `<AssetPreview>`
at the top of the inspector mirrors the hover.

### Add a BuildingEffects case for a new building type

`components/scene/BuildingEffects.tsx` dispatches effects based on
the parsed building type (from `parseBuildingId`). Drop-in patterns:

- **A new chimney-smoking building** — add an entry to
  `CHIMNEY_OFFSETS` with the `[x, y, z]` local offset of the chimney
  top. The existing `ChimneySmoke` kicks in automatically when
  status becomes `running`.
- **An ambient animated mesh (flag, antenna, lantern)** — add a
  constant like `FLAG_TOP: Record<string, [number, number, number]>`,
  then mount a new sub-component conditional on `buildingType in
  THAT_MAP`. Follow `ProceduralFlag` / `WatchtowerLight` for the
  shape.
- **A new CPU-driven particle** — take `MineDust` as a template:
  `cpuPct`-derived density multiplier, rebuild a small
  `bufferGeometry` of ≤30 positions, mutate in `useFrame`.

### i18n

All user-facing strings are English. There's no i18n framework
today (single locale); if you add a new UI string, write it in
English directly in the component.

### Subscribe to a new WS frame

1. Add the TypeScript variant in `src/types/ws.ts` (keep the union
   `| { type: 'foo'; … }` matching the backend's serde tag).
2. Handle it in `useRealtimeStore.push()` — usually a new slice in
   the state record keyed by app_id / addon_id.
3. Consume it in a component via a narrow selector (primitive or
   store ref only).

## Local development

```bash
cd frontend
npm install
npm run dev          # Vite dev server on :3000 proxying to :8080 backend
```

Vite proxies `/api /auth /ws` to the backend, so no VITE_BACKEND_URL
needed in dev. The backend runs separately with `cargo run`.

Type-check:

```bash
npm run typecheck    # tsc --noEmit
```

Production build:

```bash
npm run build        # tsc + vite build → dist/
```

## Debug aids

### Runtime-toggleable scoped logger

`src/utils/debug.ts` exposes `debug.log/warn/error(scope, ...args)`.
The instance is enabled if **any** of these are true (evaluated once
at module load):

- `import.meta.env.DEV` (Vite dev server)
- `import.meta.env.VITE_DEBUG_LOGS === 'true'` (build-time opt-in)
- `localStorage.getItem('mycctown.debug') === '1'`
- `?debug=1` in the URL — auto-persisted to localStorage so a
  subsequent reload without the param keeps logs on. Clear with
  `localStorage.removeItem('mycctown.debug')`.

When the console toggle is off, `log/warn` skip the `console.*` call;
`error` always logs to console. Output is `console.debug('[scope]', …)`
so you can filter by scope name in DevTools (set the level filter to
"Verbose").

Independent of that toggle, every `debug.*` call also forwards to
GlitchTip via Sentry: `log/warn` → `Sentry.logger.{info,warn}`
(GlitchTip Logs stream), `error` → `Sentry.captureException` /
`captureMessage` (creates a GlitchTip issue) **plus**
`Sentry.logger.error`. So `?debug=1` is for *console-side* visibility
during a live incident; the events reach the dashboard either way.
Full setup in [observability.md](observability.md).

Scopes already wired up: `ws`, `api`, `org`, `asset`, `asset:color`,
`asset:initial`, `asset:<id>` (per-asset retry attempts), `map`.

Don't add bare `console.log`/`console.warn` in new code paths — go
through `debug.*` so the prod console stays quiet by default but a
field incident can be diagnosed live with `?debug=1`, and so events
land in GlitchTip without extra wiring.

### Self-heal on transient HTTP/2 / network blips

`src/utils/retry.ts` provides `retryWithBackoff(fn, { attempts,
baseDelayMs, shouldRetry, scope })` (default 3 attempts, 250 ms base
+ jitter, retry on every error). Two call sites:

- **Asset loader** (`assetLoader.ts:loadEntries`) — wraps
  `gltfLoader.loadAsync(entry.path)` with 3 attempts at 300 ms base.
  This covers the `.gltf` fetch *and* the child `.bin`/`.png`
  fetches (GLTFLoader resolves them inside `loadAsync`, so a child
  failure rejects the top-level promise, and the retry replays the
  whole load — including the children).
- **API client** (`api/client.ts`) — wraps `fetch` for idempotent
  methods (GET/HEAD) only. Retries on `TypeError` (= browser-level
  network errors like `ERR_HTTP2_PROTOCOL_ERROR` and
  `Failed to fetch`) and on transient HTTP statuses 502/503/504.
  4xx fall straight through (sematically final), POST/PUT/DELETE/
  PATCH never auto-retry.

Concrete failure mode this guards against: a tab left idle for ~1–
2 h on `mycctown.cleverapps.io` resumes on a stale HTTP/2 session
that the CC edge has already torn down. The browser doesn't see the
RST until it reuses the connection, so the first burst of fetches
(lazy color load + `/api/orgs/.../addons`) all surface as
`ERR_HTTP2_PROTOCOL_ERROR`. Without retries, the asset cache stayed
incomplete (orange placeholder material) and the addons panel
empty until a hard reload. With retries, the second attempt sees
the dead socket, the third opens a fresh H2 connection, and the
load succeeds — invisibly to the user unless `?debug=1` is on.

### Manual smoke

- **DevTools → Network → Offline** during initial asset load: the
  console (with debug on) shows
  `[asset:hex_coast_A] attempt 1/3 failed, retrying in 320ms` and
  the asset arrives once you flip back to Online.
- **DevTools → Network → block `/api/orgs/.../addons`** once: the
  api scope logs the retry, and the addons panel populates after
  the second attempt instead of staying empty.

