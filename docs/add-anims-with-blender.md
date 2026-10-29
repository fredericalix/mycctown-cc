# Prompt: add procedural-animation hooks to KayKit buildings

> Handover doc for an AI agent (or human with Blender + Python) that
> will edit the KayKit Medieval Hexagon Pack `.blend` source and
> re-export subset `.gltf + .bin` files with **named child nodes**
> myCCtown's three.js scene can animate procedurally.

## Prerequisites

- Blender ≥ 4.0 with the official **glTF 2.0 exporter** enabled (it's
  bundled but disabled by default in fresh installs).
- Python 3.10+ available from Blender's `--python`. We script the
  work rather than clicking — every change must be reproducible.
- Repo clone of `mycctown` (this one). Target directory for outputs:
  `frontend/public/assets/gltf/buildings/`.

## Inputs

- **Source .blend**:
  `/Users/frederic/Pictures/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE/SOURCE/Medieval_Hexagons_SOURCE.blend`
  (~34 MB, single file, 27 building types × 4 colors + neutral variants).
- **Current exports** (what we're replacing):
  `frontend/public/assets/gltf/buildings/{green,blue,red,yellow,neutral}/building_*.gltf`
  (each `.gltf` is JSON + a sibling `.bin` + shares `hexagons_medieval.png`).

## Context: how three.js animates today

myCCtown already picks up two named nodes at load time
(`frontend/src/components/scene/HexTile.tsx:103-114`):

```ts
buildingModel.traverse((child) => {
  if (child.name.includes('windmill_top_fan')) register('windmillFans', child);
  if (child.name.includes('watermill_wheel'))  register('watermillWheels', child);
});
```

The registered object is then rotated in `useAnimations.ts` per frame,
modulated by the bound CC app's live CPU (`animationSpeedFor`).

**Goal of this task**: extend that list. Split the merged building
meshes into additional named children — the three.js code will then
animate them using the same pattern (rotation/translation sinusoidal +
CPU-driven speed), with **no further exporter work needed**.

## What to split, per building

Priorities, **must-have first**:

| Building | Child node name to create | Motion three.js will apply |
|---|---|---|
| `building_blacksmith` | `blacksmith_hammer` | `rot.z = -π/6 · (1 + sin(t·3))` — hammer head beats anvil |
| `building_lumbermill` | `lumbermill_sawblade` | Continuous `rot.y` spin |
| `building_well` | `well_bucket` | Vertical `pos.y = -0.2 · sin(t·0.5)` bob |
| `building_tower_cannon` | `cannon_barrel` | Small periodic `rot.x` tilt |
| `building_church` | `church_bell` | Pendulum `rot.z = sin(t·2) · 0.2` |
| `building_windmill_small`/others | *already done* | *— windmill_top_fan + watermill_wheel exist* |

Nice-to-have (do these if budget allows):

| Building | Child node name | Motion |
|---|---|---|
| `building_tavern` | `tavern_door` | Periodic open/close (30 s period) |
| `building_shipyard` | `shipyard_boat` | Gentle rock `rot.z = sin(t·0.8) · 0.05` |
| `building_archeryrange` | `archery_target` | Slow `pos.x` slide |
| `building_tower_catapult` | `catapult_arm` | Wind-up + release cycle |
| `building_stables` | `stables_door` | Similar to tavern |
| `building_tent` | `tent_flag` | Tiny flag wave (we have procedural flags on castle/townhall/church already — tent would use a different hook) |

### Per-building mesh-splitting rules

For each building type in the must-have list:

1. **Find the target sub-mesh** — in Blender, select the mesh, enter
   Edit mode, select the relevant vertices (the hammer head, the saw
   blade, etc.). If Blender source has separate loose parts already,
   use them; otherwise edit-mode split by vertex groups or by visual
   selection.
2. **Separate** (`P > Selection`) into its own object.
3. **Rename** the new object to the exact name listed above
   (`blacksmith_hammer`, `cannon_barrel`, etc.).
4. **Re-parent** the new object to the building's root so transforms
   stay relative (Object Properties → Parent).
5. **Set origin at the pivot point** of motion:
   - Hammer: origin at the handle base.
   - Saw blade: origin at the wheel axis.
   - Bucket: origin at the top of the bucket (where the rope attaches).
   - Cannon barrel: origin at the trunnion (horizontal pivot).
   - Bell: origin at the top (where the yoke is).
6. **Keep UVs intact** — the pack uses a shared atlas
   (`hexagons_medieval.png`). No re-UV; just transfer the existing
   material.
7. **Do this once per color variant** — all four `_green / _blue /
   _red / _yellow` exports must have the same named children at
   matching local positions. Easiest via Blender's **Linked
   Duplicates** or a Python loop over the material slots.

### Color variants — scripting approach

The source `.blend` likely has one master mesh per building, with
four colour slots. Your Python script should:

```python
import bpy
COLORS = ['green', 'blue', 'red', 'yellow']
SPLITS = {
    'building_blacksmith': ['blacksmith_hammer'],
    'building_lumbermill': ['lumbermill_sawblade'],
    'building_well':       ['well_bucket'],
    'building_tower_cannon': ['cannon_barrel'],
    'building_church':     ['church_bell'],
}

for base, children in SPLITS.items():
    # 1. Load the master mesh.
    # 2. Perform edit-mode splits (assumes vertex groups exist;
    #    otherwise fall back to bounding-box filters per child).
    # 3. For each color, duplicate, apply the color-specific material
    #    override, export to
    #    `frontend/public/assets/gltf/buildings/<color>/<base>_<color>.gltf`.
```

Output naming must match the existing pattern exactly so
`assetCatalog.ts` picks them up without code changes. For buildings
not in the SPLITS dict, do **not** re-export — leave the current
`.gltf + .bin` files untouched.

## Export settings (glTF 2.0)

Use these exact flags when calling `bpy.ops.export_scene.gltf`:

```python
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLTF_SEPARATE',    # produces .gltf + .bin + textures
    export_yup=True,
    export_apply=False,               # keep per-object transforms
    export_animations=False,          # we don't bake keyframes
    export_morph=False,
    export_skins=False,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_cameras=False,
    export_lights=False,
    # Critical: preserve empty nodes & hierarchy so our named children
    # survive in the node graph.
    use_selection=False,
    export_extras=False,
)
```

The output must have:

- One root node named `building_<type>_<color>` (matches current).
- Child nodes with the exact names from the SPLITS table, each with
  its local transform applied.
- Same texture reference (`hexagons_medieval.png`) as today — do NOT
  re-embed a new texture. Reuse the file in the destination directory.

## Verification

Once the script finishes, for each new `.gltf`:

1. Load it:
   ```bash
   python3 -c "
   import json, sys
   d = json.load(open(sys.argv[1]))
   print([n.get('name','?') for n in d['nodes']])
   " frontend/public/assets/gltf/buildings/green/building_blacksmith_green.gltf
   ```
   Expected: `['building_blacksmith_green', 'blacksmith_hammer']`
   (order may vary).

2. Check `node.translation` / `node.rotation` / `node.scale` on the
   new child — its pivot should be sane (not at the building's origin).

3. Run `npm run build` in `frontend/`. It must still build; the
   asset catalog paths are unchanged.

4. Load the scene, place a blacksmith app on the map. The hammer
   mesh should appear parented to the building (visible in devtools
   → three.js Inspector extension). **No animation yet** — that's a
   follow-up three.js change, not your job.

## Non-goals

- Don't bake keyframe animations into the glTF. We use procedural
  animation in three.js (`useFrame` + sinus + CPU multiplier) — it's
  cheaper to render and lets us modulate speed at runtime.
- Don't add skeletal rigs. All motion is simple transform on the
  named child nodes.
- Don't change any of: materials, vertex colors, texture atlas,
  bounding boxes, or the root node naming scheme.
- Don't touch the neutral-only buildings
  (`building_bridge_A/B`, `building_stage_A/B/C`, `building_dirt`,
  `building_grain`, `building_scaffolding`, `building_destroyed`).

## Licensing reminder

KayKit Medieval Hexagon Pack is CC BY 4.0. The derivative assets
keep attribution: include a `NOTICES.md` in
`frontend/public/assets/gltf/` crediting "Medieval Hexagon Pack by
[Kay Lousberg](https://kaylousberg.com/), CC BY 4.0" before shipping
the modified exports.

## Deliverables

1. The modified `.gltf + .bin` files dropped in place in
   `frontend/public/assets/gltf/buildings/{green,blue,red,yellow}/`.
2. The Python script used (commit it under
   `scripts/blender/split-buildings.py` so we can re-run if KayKit
   ships an update).
3. A short `scripts/blender/README.md` with the exact Blender
   version + command used to run.
4. A one-line note added to `docs/frontend.md` in the "Cheat sheets"
   section on how to add a new animated node: "split the target sub-
   mesh, rename it `<type>_<part>`, re-export — HexTile's traverse in
   line 103-114 picks it up; register + animate in useAnimations.ts".
5. `docs/TODO.md` updated with the three.js side of the work: a list
   of the new named nodes + which behaviour each expects (so whoever
   picks up can open `HexTile.tsx` + `useAnimations.ts` and wire
   them).

## Hand-off checklist for the requesting dev (you, Frédéric)

Before passing this prompt to a Blender-capable AI:

- [ ] Confirm the priority list above matches your current appetite.
      Trim the "nice-to-have" if you want a minimal PR.
- [ ] Decide whether to commit the generated `.gltf + .bin` to git
      directly (they're small, <50 KB each, ~20 new files = <1 MB) or
      via Git LFS.
- [ ] Provide the AI with shell + Blender install + read-write access
      to the repo. Everything else is in this doc.
