import { useState } from 'react';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { parseHexKey } from '../../utils/hexMath';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import {
  BUILDING_COLORS,
  BUILDING_COLOR_SWATCH,
  BUILDING_TYPES,
  buildingId,
  parseBuildingId,
  buildingTypeLabel,
} from '../../data/buildingSkins';
import { ASSET_CATALOG } from '../../data/assetCatalog';
import type { Decoration } from '../../types/map';
import { AssetPreview } from './AssetPreview';
import { LiveResource } from './LiveResource';

const PANEL_WIDTH = 300;

/** Tile palette, grouped by asset-catalog subcategory. Built once from the
 *  catalog so adding new tiles to assetCatalog.ts surfaces them automatically.
 *  Skip the sloped variants in Base — they're meant to be placed at map
 *  edges for elevation and would confuse a non-authored map. */
const TILE_GROUPS = [
  { label: 'Base', sub: 'base' },
  { label: 'Coast', sub: 'coast' },
  { label: 'Rivers', sub: 'rivers' },
  { label: 'Roads', sub: 'roads' },
] as const;

const TILES_BY_GROUP: Record<string, Array<{ id: string; label: string }>> =
  Object.fromEntries(
    TILE_GROUPS.map(({ sub }) => {
      const rows = ASSET_CATALOG.filter(
        (a) =>
          a.category === 'tiles' &&
          a.subcategory === sub &&
          !a.id.includes('_sloped'),
      )
        .map((a) => ({ id: a.id, label: humaniseTileId(a.id) }))
        .sort((x, y) => x.label.localeCompare(y.label));
      return [sub, rows];
    }),
  );

function humaniseTileId(id: string): string {
  // "hex_river_A_curvy" → "River A curvy"
  return id
    .replace(/^hex_/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Decoration sets, grouped by theme. */
const DECOR_OPTIONS: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  {
    group: 'Nature',
    items: [
      { id: 'tree_single_A', label: 'Tree' },
      { id: 'trees_A_small', label: 'Trees (small)' },
      { id: 'trees_A_medium', label: 'Trees (medium)' },
      { id: 'rock_single_A', label: 'Rock' },
      { id: 'hills_A_trees', label: 'Hills' },
      { id: 'mountain_A_grass_trees', label: 'Mountain' },
      { id: 'waterlily_A', label: 'Waterlily' },
    ],
  },
  {
    group: 'Props',
    items: [
      { id: 'barrel', label: 'Barrel' },
      { id: 'crate_A_big', label: 'Crate' },
      { id: 'haybale', label: 'Haybale' },
      { id: 'sack', label: 'Sack' },
      { id: 'tent', label: 'Tent' },
    ],
  },
];

/** Hex-aligned rotation steps (0..5); HexTile converts each to 60° of yaw
 *  via `hexRotation(step)`. We label them in degrees for users. */
const ROTATION_STEPS = [0, 1, 2, 3, 4, 5] as const;

/**
 * Docked inspector for builder mode. Draggable by its header; position is
 * persisted to localStorage across page reloads.
 */
export function Inspector() {
  const selectedCell = useMapStore((s) => s.selectedCell);
  const cells = useMapStore((s) => s.cells);
  const clearResource = useMapStore((s) => s.clearResource);
  const setBuilding = useMapStore((s) => s.setBuilding);
  const setCell = useMapStore((s) => s.setCell);

  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);

  const { pos, dragging, dragProps } = useDraggablePanel(
    'mycctown.inspectorPos',
    { x: 86, y: 12 },
    PANEL_WIDTH,
  );

  // Track the palette button we're hovering so the 3D preview up top can
  // mirror it. Falling back to the cell's current building/tile keeps the
  // preview useful even when no hover is active.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!selectedCell) return null;
  const cell = cells.get(selectedCell);
  if (!cell) return null;

  const { q, r } = parseHexKey(selectedCell);
  const hasResource = Boolean(cell.appId || cell.addonId);
  const previewId = hoveredId ?? cell.building ?? cell.tile ?? null;

  const resource = cell.appId
    ? { kind: 'app' as const, data: apps.find((a) => a.id === cell.appId) }
    : cell.addonId
      ? { kind: 'addon' as const, data: addons.find((a) => a.id === cell.addonId) }
      : null;

  const setTile = (tileId: string) => {
    setCell({ ...cell, tile: tileId });
  };

  const addDecoration = (decoId: string) => {
    // Random jitter within the hex so multiple decorations don't stack on
    // the centre — looks more organic at a glance.
    const deco: Decoration = {
      id: decoId,
      dx: (Math.random() - 0.5) * 0.6,
      dz: (Math.random() - 0.5) * 0.6,
      rotation: Math.floor(Math.random() * 6),
    };
    setCell({
      ...cell,
      decorations: [...(cell.decorations ?? []), deco],
    });
  };

  const removeDecoration = (idx: number) => {
    const next = (cell.decorations ?? []).filter((_, i) => i !== idx);
    setCell({ ...cell, decorations: next.length > 0 ? next : undefined });
  };

  const resetCell = () => {
    // Keep the hex visible (grass tile) but wipe everything the user put on it.
    setCell({ q, r, tile: 'hex_grass' });
  };

  return (
    <aside
      className="cc-panel absolute z-10 rounded-2xl p-4 text-[13px] pointer-events-auto"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
      }}
    >
      <div
        className="flex items-center justify-between mb-3 select-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        {...dragProps}
      >
        <div>
          <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
            Selected cell
          </div>
          <div className="font-semibold">
            ({q}, {r})
          </div>
        </div>
        <button
          data-no-drag
          className="cc-muted hover:text-white"
          onClick={() => useMapStore.getState().selectCell(null)}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="mb-3">
        <AssetPreview assetId={previewId} />
      </div>

      {resource?.data && (
        <LiveResource
          kind={resource.kind}
          data={resource.data}
          orgId={currentOrgId}
          onUnbind={() => clearResource(q, r)}
        />
      )}

      {!hasResource && !cell.building && (
        <div className="cc-muted text-[12px] mb-3">
          No CC resource bound here. Pick one from the Resources panel on the
          right to place it on this hex, or use the Scenery section below to
          dress up the tile.
        </div>
      )}

      {cell.building && (
        <div className="flex flex-col gap-2 mt-3">
          <div className="font-overtitle text-[10px] cc-muted">Building</div>
          <SkinPicker
            current={cell.building}
            lockColor={hasResource}
            onChange={(id) => setBuilding(q, r, id, cell.buildingRotation ?? 0)}
          />
          <div className="font-overtitle text-[10px] cc-muted mt-1">
            Rotation
          </div>
          <RotationPicker
            current={cell.buildingRotation ?? 0}
            onChange={(rot) => setBuilding(q, r, cell.building!, rot)}
          />
          {!hasResource && (
            <button
              onClick={() => setBuilding(q, r, null)}
              className="w-full rounded-lg py-1.5 text-[11px] transition"
              style={{ background: 'rgba(230,63,72,0.15)', color: 'var(--cc-red-1)' }}
            >
              Remove building
            </button>
          )}
        </div>
      )}

      {/* Scenery — tile + decorations — only for cells that aren't used
          as a CC resource slot, so the inspector stays focused when live. */}
      {!hasResource && (
        <div className="mt-4 pt-3 border-t cc-border-soft flex flex-col gap-3">
          <div>
            <div className="font-overtitle text-[10px] cc-muted mb-1.5">
              Ground tile
            </div>
            {TILE_GROUPS.map(({ label, sub }) => {
              const items = TILES_BY_GROUP[sub] ?? [];
              if (items.length === 0) return null;
              // Auto-open the group that contains the current tile so the
              // user lands on it when reopening the inspector.
              const containsCurrent = items.some((t) => t.id === cell.tile);
              return (
                <details
                  key={sub}
                  open={containsCurrent || sub === 'base'}
                  className="mb-2"
                >
                  <summary
                    className="cursor-pointer select-none text-[11px] cc-muted py-1"
                    style={{ color: 'var(--cc-white)' }}
                  >
                    {label}{' '}
                    <span className="cc-muted">({items.length})</span>
                  </summary>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTile(t.id)}
                        onMouseEnter={() => setHoveredId(t.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className="rounded-lg px-2 py-1 text-[11px] transition"
                        style={{
                          background:
                            cell.tile === t.id
                              ? 'var(--cc-primary)'
                              : 'rgba(241,240,251,0.06)',
                          color: 'var(--cc-white)',
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
            <div className="font-overtitle text-[10px] cc-muted mt-2 mb-1">
              Tile rotation
            </div>
            <RotationPicker
              current={cell.rotation ?? 0}
              onChange={(rot) => setCell({ ...cell, rotation: rot })}
            />
          </div>

          <div>
            <div className="font-overtitle text-[10px] cc-muted mb-1.5">
              Add decoration
            </div>
            {DECOR_OPTIONS.map((group) => (
              <div key={group.group} className="mb-2">
                <div className="text-[10px] cc-muted mb-1">{group.group}</div>
                <div className="flex flex-wrap gap-1">
                  {group.items.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => addDecoration(d.id)}
                      onMouseEnter={() => setHoveredId(d.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className="rounded-lg px-2 py-1 text-[11px] transition hover:bg-white/10"
                      style={{
                        background: 'rgba(241,240,251,0.06)',
                        color: 'var(--cc-white)',
                      }}
                    >
                      + {d.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {(cell.decorations?.length ?? 0) > 0 && (
            <div>
              <div className="font-overtitle text-[10px] cc-muted mb-1.5">
                Placed decorations ({cell.decorations!.length})
              </div>
              <div className="flex flex-col gap-1">
                {cell.decorations!.map((d, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg px-2 py-1 text-[11px]"
                    style={{ background: 'rgba(241,240,251,0.04)' }}
                  >
                    <span className="truncate">{d.id}</span>
                    <button
                      onClick={() => removeDecoration(idx)}
                      className="cc-muted hover:text-white ml-2"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={resetCell}
        className="mt-3 w-full rounded-lg py-1.5 text-[11px] transition"
        style={{ background: 'rgba(230,63,72,0.2)', color: 'var(--cc-red-1)' }}
        title="Clear building and decorations; keep a grass tile so the cell stays visible."
      >
        Reset cell (keep as grass)
      </button>
    </aside>
  );
}

function SkinPicker({
  current,
  lockColor,
  onChange,
}: {
  current: string;
  /** When a resource is bound to this cell, the color is driven by status.
   *  Hide the color picker and surface that to the user. */
  lockColor: boolean;
  onChange: (id: string) => void;
}) {
  const parsed = parseBuildingId(current);
  const currentType = parsed?.type ?? null;
  const currentColor = parsed?.color ?? 'blue';

  return (
    <div className="flex flex-col gap-2">
      {!lockColor && (
        <div className="flex items-center gap-1.5">
          {BUILDING_COLORS.map((c) => {
            const selected = c === currentColor;
            return (
              <button
                key={c}
                title={c}
                onClick={() =>
                  currentType && onChange(buildingId(currentType, c))
                }
                disabled={!currentType}
                className="h-6 w-6 rounded-full transition"
                style={{
                  background: BUILDING_COLOR_SWATCH[c],
                  outline: selected
                    ? '2px solid var(--cc-white)'
                    : '2px solid transparent',
                  outlineOffset: 1,
                  opacity: currentType ? 1 : 0.4,
                  cursor: currentType ? 'pointer' : 'not-allowed',
                }}
              />
            );
          })}
        </div>
      )}
      {lockColor && (
        <div
          className="text-[10px] cc-muted italic"
          title="Building color is driven by the live status (running=green, deploying=blue, failed=red, unknown=yellow, created/stopped=scaffolding)."
        >
          Color is auto — follows the app/addon status.
        </div>
      )}

      <select
        value={currentType ?? ''}
        onChange={(e) =>
          onChange(
            buildingId(
              e.target.value as (typeof BUILDING_TYPES)[number],
              currentColor,
            ),
          )
        }
        className="w-full rounded-lg px-2 py-2 text-[12px]"
        style={{
          background: 'rgba(241,240,251,0.08)',
          color: 'var(--cc-white)',
          border: '1px solid rgba(241,240,251,0.12)',
        }}
      >
        {currentType === null && <option value="">(custom asset)</option>}
        {BUILDING_TYPES.map((t) => (
          <option key={t} value={t}>
            {buildingTypeLabel(t)}
          </option>
        ))}
      </select>
    </div>
  );
}

function RotationPicker({
  current,
  onChange,
}: {
  current: number;
  onChange: (rotationStep: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {ROTATION_STEPS.map((step) => {
        const selected = step === current;
        const deg = step * 60;
        return (
          <button
            key={step}
            onClick={() => onChange(step)}
            className="flex-1 rounded-lg py-1 text-[11px] transition"
            style={{
              background: selected
                ? 'var(--cc-primary)'
                : 'rgba(241,240,251,0.06)',
              color: 'var(--cc-white)',
            }}
            title={`Rotate to ${deg}°`}
          >
            {deg}°
          </button>
        );
      })}
    </div>
  );
}
