# Frontend — load-bearing details

Companion to `CLAUDE.md`. Topics already in CLAUDE.md (Zustand selector
golden rule headline, BuildingEffects existence, animation curve formula,
asset cache-bust mechanism, lazy-color phasing, debug logger toggle) are
not repeated; this file extends them with the implementation-level
specifics.

## Zustand selector golden rule (extended)

CLAUDE.md states the rule. Here are the corollaries you'll trip on if
unfamiliar:

- **Returning store fields directly is fine**: `useFooStore((s) => s.bar)`
  works even if `bar` is an object — the reference is stable across updates
  unless `bar` itself changes.
- **Returning a computed primitive is fine**: `useFooStore((s) => s.list.length)`.
- **Returning a fresh object is broken**: `useFooStore((s) => ({ a: s.a, b: s.b }))`
  always fails the default `Object.is` equality check, even when `s` didn't
  change → infinite render loop.
- The escape hatch when you genuinely need a tuple is `shallow` (Zustand's
  custom equality): `useFooStore(selector, shallow)`. Use sparingly — most
  uses can be split into two single-field selectors.
- **Hooks called inside a component re-render must follow the same rule.**
  The `StatusBadge.tsx` original incident was a `useStore((s) => ({ status, cpu }))`
  that re-created the object on every store push.

When you write a new hook, run it through:
- "Does this selector close over a literal object/array/Map/Set?" → fix.
- "Could two unrelated stores update at different times and require both?" →
  use two `useStore` calls, derive in the component.

## R3F scene — BuildingEffects dispatch

`frontend/src/components/scene/BuildingEffects.tsx` mounts up to **5 ambient
effects** depending on the building's parsed type:

| Effect | Building family | Tuned constant(s) |
|---|---|---|
| ChimneySmoke | `house`, `cottage`, … (chimneyed) | `CHIMNEY_OFFSETS` (per-family vec3) |
| MineDust | `mine` | `MINE_ENTRANCE` (vec3) |
| BlacksmithSparks | `blacksmith` / `forge` | `FORGE_ORIGIN` (vec3) |
| ProceduralFlag | `tower`, `castle`, civic banners | `FLAG_TOP` (vec3) |
| WatchtowerLight | `watchtower`, `lighthouse` | `LANTERN_TOP` (vec3) + light cone |

Type detection runs through `parseBuildingId(assetId)` exported from
`frontend/src/data/buildingSkins.ts`. Same parser is also used by
`statusVisual.ts::assetIdForStatus` and the builder Inspector — keep it
authoritative.

The offsets are **hand-tuned per family** (no named submeshes in the GLTFs).
When a building's chimney smoke comes out of the wrong tile, the fix is to
adjust the constant in `BuildingEffects.tsx`, not to edit the GLTF. Hot-reload
to realign visually.

If you add a new effect:
- Extend `parseBuildingId` if the family classification is new.
- Add a constant block + a child component in `BuildingEffects.tsx`.
- Gate the effect by `status === 'running'` (so dead/scaffold buildings stay
  inert) unless you specifically want it on `CREATED` / `STOPPED`.

## R3F scene — ghost hex (builder mode)

Builder mode is a Zustand-gated overlay. Two non-obvious mechanics:

- **Raycasting target is the Y=0 plane**, not the ghost mesh. Ghost
  positions move every frame; raycasting the mesh would lag a frame behind
  the cursor.
- The hit point is converted to **axial coordinates** via the standard
  `pixelToAxial` utility, then validated against the placed-buildings store
  + neighbour rule (must touch an existing tile).
- The ghost component is mounted unconditionally but no-ops when
  `useUiModeStore.mode !== 'builder'`. Don't conditionally mount it — losing
  the component instance would also lose the cursor-tracking refs.

## Animation speed curve

`frontend/src/three/useAnimations.ts::animationSpeedFor` (line 24) returns:

```ts
0.3 + Math.pow(cpu / 100, 1.8) * 4.7
```

…for `running` apps. Other statuses return `0` (idle) or specific values for
`deploying` / `restarting`. The formula is documented in CLAUDE.md (don't
make it linear); the unspoken corollary: **don't multiply by `delta` outside
the helper** — the caller already does (see windmill rotation at line 94,
mill wheel at line 97). Doubling the delta multiplication makes the curve
feel right at 60 FPS but wrong at 120 FPS.

## Asset pipeline (cache-bust + lazy color)

CLAUDE.md covers the `?v=N` cache-bust and the lazy-by-color load. The
implementation details that aren't in CLAUDE.md:

- `ASSET_VERSION` is at `frontend/src/utils/assetLoader.ts:16` (currently
  `'3'`). The **string type matters** — bumping to a number breaks the
  `${url}${sep}v=${ASSET_VERSION}` template (it works, but a future
  `if (ASSET_VERSION === '3')` check wouldn't).
- The URL modifier is registered on the global `THREE.LoadingManager` at
  module load (`manager.setURLModifier(appendVersion)`). Any GLTF load that
  bypasses the global manager (e.g. a one-off `new GLTFLoader()` without
  passing the manager) **won't get the cache-bust query string**. Always
  use the helpers in `assetLoader.ts`.
- `loadInitialAssets` (line 83) and `loadColorAssets` (line 111) are the two
  public entry points. The asset store's `ensureColorLoaded` (in
  `useAssetStore.ts:57`) is what `HexTile.tsx:131` calls when it discovers
  it needs a color batch that wasn't preloaded.
- The placement effect re-runs on `loadedColors` reference change (it's a
  `Set`, so the store mutates by `new Set([...prev, color])` to give a new
  reference). If you add a similar batched-load mechanism, mirror this
  reference-changing pattern — mutating the existing Set won't trigger any
  re-render.

## Frontend / backend boundary (the proxy)

`frontend/server.mjs` reverse-proxies `/api`, `/auth`, `/ws` to the backend.
Three load-bearing details past CLAUDE.md's headline:

- The proxy uses `http-proxy-middleware`. The WebSocket upgrade is a separate
  call; if you add a new WS endpoint, double-check `ws: true` is set on its
  proxy entry.
- The compression middleware filter **excludes media + Range responses**
  explicitly (gzipping a 206 mangles content-length and triggers
  `ERR_HTTP2_PROTOCOL_ERROR` on `<audio>`). The filter regex hardcodes
  `mp3|wav|ogg|m4a|mp4|webm` + the binary 3D formats. Adding a new media
  format means extending this regex.
- Vite-hashed paths get `Cache-Control: max-age=31536000, immutable`;
  everything else under `/assets/` gets `must-revalidate`. The discriminator
  is the `VITE_HASHED` regex. **Don't add `immutable` on a non-hashed path** —
  CLAUDE.md says it; the corollary in code is: extend the regex if Vite
  starts emitting a new hashed-path shape.

## Where to defer to docs/

- Full canvas tree + HexTile lifecycle + scene order: `docs/frontend.md §Scene pipeline`.
- Asset catalog taxonomy + BUILDING_COLORS palette + compression status:
  `docs/frontend.md §Asset system`.
