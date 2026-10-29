import { create } from 'zustand';
import { getMap, saveMap } from '../api/maps';
import type { HexCell } from '../types/map';
import { debug } from '../utils/debug';
import { generateHexGrid, hexKey } from '../utils/hexMath';

/** Empty-map fallback: hex_grass tiles in a ring so the user sees a canvas,
 *  not an void, the first time they open an org. Radius 3 = 37 tiles. */
function proceduralBase(): Map<string, HexCell> {
  const cells = new Map<string, HexCell>();
  for (const { q, r } of generateHexGrid(3)) {
    cells.set(hexKey(q, r), { q, r, tile: 'hex_grass' });
  }
  return cells;
}

interface MapState {
  cells: Map<string, HexCell>;
  selectedCell: string | null;
  mapName: string;
  currentOrgId: string | null;

  // Persistence status
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  version: number;

  // Mutations — only the ones the auto-placer / inspector need.
  setCell: (cell: HexCell) => void;
  removeCell: (q: number, r: number) => void;
  setBuilding: (q: number, r: number, buildingId: string | null, rotation?: number) => void;
  selectCell: (key: string | null) => void;
  clearMap: () => void;

  assignResource: (
    q: number,
    r: number,
    kind: 'app' | 'addon',
    resourceId: string,
  ) => void;
  clearResource: (q: number, r: number) => void;

  // Server sync
  loadFromServer: (orgId: string) => Promise<void>;
  saveToServer: () => Promise<void>;
  /** Schedule a debounced save (keeps server state in sync after mutations). */
  scheduleSave: () => void;
}

function cellsToArray(cells: Map<string, HexCell>): HexCell[] {
  return Array.from(cells.values());
}

function arrayToCells(arr: HexCell[]): Map<string, HexCell> {
  const map = new Map<string, HexCell>();
  for (const cell of arr) {
    map.set(hexKey(cell.q, cell.r), cell);
  }
  return map;
}

const SAVE_DEBOUNCE_MS = 2000;

export const useMapStore = create<MapState>((set, get) => {
  // Captured in this closure so the timer is bound to this store instance.
  // Previously this was a module-level `let` which leaked across Vite HMR reloads
  // and could fire a save against a reset store.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelSaveTimer = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  return {
  cells: new Map(),
  selectedCell: null,
  mapName: 'My City',
  currentOrgId: null,

  loadStatus: 'idle',
  saveStatus: 'idle',
  version: 0,

  setCell: (cell) => {
    set((state) => {
      const cells = new Map(state.cells);
      cells.set(hexKey(cell.q, cell.r), cell);
      return { cells };
    });
    get().scheduleSave();
  },

  removeCell: (q, r) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      cells.delete(key);
      return {
        cells,
        selectedCell: state.selectedCell === key ? null : state.selectedCell,
      };
    });
    get().scheduleSave();
  },

  setBuilding: (q, r, buildingId, rotation) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      if (buildingId) {
        cells.set(key, {
          ...existing,
          building: buildingId,
          buildingRotation: rotation ?? existing.buildingRotation ?? 0,
        });
      } else {
        const { building: _b, buildingRotation: _br, appId: _a, addonId: _ad, ...rest } =
          existing;
        cells.set(key, rest as HexCell);
      }
      return { cells };
    });
    get().scheduleSave();
  },

  selectCell: (key) => set({ selectedCell: key }),

  clearMap: () => {
    set({ cells: new Map(), selectedCell: null });
    get().scheduleSave();
  },

  assignResource: (q, r, kind, resourceId) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      // Clear other-kind resource to keep one binding per cell.
      const next: HexCell = {
        ...existing,
        appId: kind === 'app' ? resourceId : undefined,
        addonId: kind === 'addon' ? resourceId : undefined,
      };
      cells.set(key, next);
      return { cells };
    });
    get().scheduleSave();
  },

  clearResource: (q, r) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      const { appId: _a, addonId: _b, ...rest } = existing;
      cells.set(key, rest as HexCell);
      return { cells };
    });
    get().scheduleSave();
  },

  loadFromServer: async (orgId) => {
    cancelSaveTimer();
    set({ loadStatus: 'loading', currentOrgId: orgId, selectedCell: null });
    try {
      const resp = await getMap(orgId);
      const loaded = arrayToCells(resp.cells);
      // Seed an empty map with a small grass patch so the scene isn't blank
      // on first open. The auto-save below persists this as the new baseline.
      const cells = loaded.size === 0 ? proceduralBase() : loaded;
      set({
        cells,
        mapName: resp.name,
        version: resp.version,
        loadStatus: 'ready',
        saveStatus: 'idle',
      });
      if (loaded.size === 0) get().scheduleSave();
    } catch (e) {
      debug.error('map', 'loadFromServer failed', e, { orgId });
      set({ loadStatus: 'error', cells: new Map() });
    }
  },

  saveToServer: async () => {
    const { currentOrgId, mapName, cells } = get();
    if (!currentOrgId) return;
    set({ saveStatus: 'saving' });
    try {
      const resp = await saveMap(currentOrgId, {
        name: mapName,
        cells: cellsToArray(cells),
      });
      set({ saveStatus: 'saved', version: resp.version });
    } catch (e) {
      debug.error('map', 'saveToServer failed', e, { orgId: currentOrgId });
      set({ saveStatus: 'error' });
    }
  },

  scheduleSave: () => {
    if (!get().currentOrgId || get().loadStatus !== 'ready') return;
    cancelSaveTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().saveToServer();
    }, SAVE_DEBOUNCE_MS);
  },
  };
});
