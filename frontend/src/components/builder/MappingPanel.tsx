import { useMemo } from 'react';
import { CcAddon, CcApplication, appTypeSlug } from '../../types/cc';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { autoAssetFor, DEFAULT_BASE_TILE } from '../../data/appTypeMapping';
import { hexKey, parseHexKey } from '../../utils/hexMath';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import type { HexCell } from '../../types/map';

const PANEL_WIDTH = 280;

interface BoundResource {
  kind: 'app' | 'addon';
  id: string;
  name: string;
  type: string | null | undefined;
  cell: HexCell;
}

interface FreeResource {
  kind: 'app' | 'addon';
  id: string;
  name: string;
  type: string | null | undefined;
}

export function MappingPanel() {
  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);

  const cells = useMapStore((s) => s.cells);
  const selectedCell = useMapStore((s) => s.selectedCell);
  const setCell = useMapStore((s) => s.setCell);
  const setBuilding = useMapStore((s) => s.setBuilding);
  const assignResource = useMapStore((s) => s.assignResource);
  const selectCellAction = useMapStore((s) => s.selectCell);

  // Anchor right by default; once the user drags, localStorage remembers the new spot.
  const defaultX =
    typeof window !== 'undefined' ? Math.max(0, window.innerWidth - PANEL_WIDTH - 12) : 900;
  const { pos, dragging, dragProps } = useDraggablePanel(
    'mycctown.mappingPanelPos',
    { x: defaultX, y: 64 },
    PANEL_WIDTH,
  );

  const { bound, free } = useMemo(() => buildLists(apps, addons, cells), [
    apps,
    addons,
    cells,
  ]);

  const placeResource = (kind: 'app' | 'addon', id: string, type: string | null | undefined) => {
    const totalN = bound.length + free.length;
    const target = selectedCell
      ? parseHexKey(selectedCell)
      : findNextFreeHex(cells, bound.length, totalN);
    ensureCellAt(target.q, target.r, cells, setCell);
    const assetId = autoAssetFor(kind, type);
    setBuilding(target.q, target.r, assetId, 0);
    assignResource(target.q, target.r, kind, id);
    selectCellAction(hexKey(target.q, target.r));
  };

  const autoPlaceAll = () => {
    const snapshot = [...free];
    const totalN = bound.length + snapshot.length;
    let freeCellsUsed = 0;
    for (const res of snapshot) {
      const currentCells = useMapStore.getState().cells;
      const target = findNextFreeHex(currentCells, freeCellsUsed, totalN);
      freeCellsUsed++;
      ensureCellAt(target.q, target.r, currentCells, setCell);
      const assetId = autoAssetFor(res.kind, res.type);
      setBuilding(target.q, target.r, assetId, 0);
      assignResource(target.q, target.r, res.kind, res.id);
    }
  };

  const locate = (cell: HexCell) => {
    selectCellAction(hexKey(cell.q, cell.r));
  };

  return (
    <aside
      className="cc-panel absolute z-10 rounded-2xl flex flex-col pointer-events-auto"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        maxHeight: 'calc(100vh - 120px)',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b cc-border-soft select-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        {...dragProps}
      >
        <div>
          <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
            Resources
          </div>
          <div className="text-sm font-semibold">
            {bound.length} placed · {free.length} to place
          </div>
        </div>
        <button
          data-no-drag
          className="btn-cc text-xs !py-1.5 !px-3"
          onClick={autoPlaceAll}
          disabled={free.length === 0}
          style={{ opacity: free.length === 0 ? 0.4 : 1 }}
        >
          Auto-place
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {free.length > 0 && (
          <Section title={`Unplaced (${free.length})`}>
            {free.map((r) => (
              <ResourceRow
                key={`${r.kind}:${r.id}`}
                name={r.name}
                type={r.type ?? '—'}
                kind={r.kind}
                onClick={() => placeResource(r.kind, r.id, r.type)}
                actionLabel={selectedCell ? 'Place here' : 'Place'}
              />
            ))}
          </Section>
        )}
        {bound.length > 0 && (
          <Section title={`Placed (${bound.length})`}>
            {bound.map((r) => (
              <ResourceRow
                key={`${r.kind}:${r.id}`}
                name={r.name}
                type={r.type ?? '—'}
                kind={r.kind}
                onClick={() => locate(r.cell)}
                actionLabel={`${r.cell.q},${r.cell.r}`}
                muted
              />
            ))}
          </Section>
        )}
        {bound.length === 0 && free.length === 0 && (
          <div className="p-6 text-center cc-muted text-sm">
            No apps or addons in this organisation.
          </div>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="font-overtitle text-[10px] cc-muted px-1">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function ResourceRow({
  name,
  type,
  kind,
  onClick,
  actionLabel,
  muted,
}: {
  name: string;
  type: string;
  kind: 'app' | 'addon';
  onClick: () => void;
  actionLabel: string;
  muted?: boolean;
}) {
  return (
    <button
      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5 transition"
      onClick={onClick}
      style={{ opacity: muted ? 0.75 : 1 }}
    >
      <div className="min-w-0 flex flex-col">
        <span className="text-sm truncate">{name}</span>
        <span className="text-[10px] cc-muted">
          {kind === 'app' ? 'app' : 'addon'} · {type}
        </span>
      </div>
      <span
        className="font-overtitle text-[10px] rounded px-2 py-1"
        style={{
          background: muted ? 'rgba(222,221,238,0.06)' : 'var(--cc-primary)',
          color: muted ? 'var(--cc-gray-soft)' : 'var(--cc-white)',
        }}
      >
        {actionLabel}
      </span>
    </button>
  );
}

function buildLists(
  apps: CcApplication[],
  addons: CcAddon[],
  cells: Map<string, HexCell>,
): { bound: BoundResource[]; free: FreeResource[] } {
  const placedAppIds = new Set<string>();
  const placedAddonIds = new Set<string>();
  const bound: BoundResource[] = [];

  for (const cell of cells.values()) {
    if (cell.appId) placedAppIds.add(cell.appId);
    if (cell.addonId) placedAddonIds.add(cell.addonId);
  }

  for (const cell of cells.values()) {
    if (cell.appId) {
      const app = apps.find((a) => a.id === cell.appId);
      if (app) {
        bound.push({
          kind: 'app',
          id: app.id,
          name: app.name,
          type: appTypeSlug(app),
          cell,
        });
      }
    }
    if (cell.addonId) {
      const addon = addons.find((a) => a.id === cell.addonId);
      if (addon) {
        bound.push({
          kind: 'addon',
          id: addon.id,
          name: addon.name,
          type: addon.provider?.id ?? addon.provider?.name,
          cell,
        });
      }
    }
  }

  const free: FreeResource[] = [];
  for (const a of apps) {
    if (!placedAppIds.has(a.id)) {
      free.push({ kind: 'app', id: a.id, name: a.name, type: appTypeSlug(a) });
    }
  }
  for (const a of addons) {
    if (!placedAddonIds.has(a.id)) {
      free.push({
        kind: 'addon',
        id: a.id,
        name: a.name,
        type: a.provider?.id ?? a.provider?.name,
      });
    }
  }

  return { bound, free };
}

function ensureCellAt(
  q: number,
  r: number,
  cells: Map<string, HexCell>,
  setCell: (cell: HexCell) => void,
) {
  const existing = cells.get(hexKey(q, r));
  if (existing) return;
  setCell({ q, r, tile: DEFAULT_BASE_TILE });
}

/**
 * Walk outward from origin in spiral order and return the first hex that has no
 * building (either empty or just a base tile).
 *
 * `skip` lets the caller advance by N already-used slots when placing several
 * resources in one go without waiting for React state flushes.
 */
function findNextFreeHex(
  cells: Map<string, HexCell>,
  skip: number,
  totalResources: number,
): { q: number; r: number } {
  const isFree = (q: number, r: number) => {
    const c = cells.get(hexKey(q, r));
    return !c?.building;
  };

  // A hex grid of radius R has 3R(R+1)+1 cells, so radius √(N/3) covers N
  // resources. Add +2 for breathing room and clamp to a reasonable floor/ceiling.
  const radius = Math.max(6, Math.min(20, Math.ceil(Math.sqrt(totalResources / 3)) + 2));

  let skipped = 0;
  for (const { q, r } of spiral(radius)) {
    if (!isFree(q, r)) continue;
    if (skipped < skip) {
      skipped++;
      continue;
    }
    return { q, r };
  }
  return { q: 0, r: 0 };
}

/** Axial hex spiral up to `radius` rings, starting at origin. */
function* spiral(radius: number): Generator<{ q: number; r: number }> {
  yield { q: 0, r: 0 };
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  for (let k = 1; k <= radius; k++) {
    let q = -k;
    let r = k;
    for (let dir = 0; dir < 6; dir++) {
      for (let step = 0; step < k; step++) {
        yield { q, r };
        q += dirs[dir]![0];
        r += dirs[dir]![1];
      }
    }
  }
}
