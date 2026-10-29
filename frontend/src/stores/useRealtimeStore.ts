import { create } from 'zustand';
import { WsFrame, ResourceStatus, normaliseAppState } from '../types/ws';

export interface MetricPoint {
  t: number;
  v: number;
}

/** How many CPU/RAM points we retain per app. At 15s/tick this is ~15min. */
const METRIC_HISTORY_MAX = 60;

export interface AppSnapshot {
  status: ResourceStatus;
  rawState: string;
  lastDeploy: number | null;
  cpuPct: number | null;
  ramPct: number | null;
  ts: number;
  /** Rolling CPU% history (oldest first). Shared reference when unchanged so
   *  Zustand selectors don't see a "changed" state on every getSnapshot. */
  cpuHistory: MetricPoint[];
  ramHistory: MetricPoint[];
}

export interface AddonSnapshot {
  healthy: boolean;
  ts: number;
  /** Current CPU/RAM percents, or null until first metrics frame. */
  cpuPct: number | null;
  ramPct: number | null;
  /** Rolling history, same shape as apps. Empty for addons CC doesn't
   *  expose CPU/RAM for (config-provider, fs-bucket, etc.). */
  cpuHistory: MetricPoint[];
  ramHistory: MetricPoint[];
}

interface RealtimeState {
  apps: Record<string, AppSnapshot>;
  addons: Record<string, AddonSnapshot>;
  connected: boolean;
  lastError: string | null;

  push: (frame: WsFrame) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

/** Shared empty arrays so first-value snapshots don't allocate fresh [] each
 *  time the store rebuilds a missing-app entry. */
const EMPTY_HISTORY: MetricPoint[] = [];

function trimHistory(prev: MetricPoint[], next: MetricPoint): MetricPoint[] {
  const arr = prev === EMPTY_HISTORY ? [next] : [...prev, next];
  if (arr.length > METRIC_HISTORY_MAX) {
    arr.splice(0, arr.length - METRIC_HISTORY_MAX);
  }
  return arr;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  apps: {},
  addons: {},
  connected: false,
  lastError: null,

  push: (frame) =>
    set((state) => {
      switch (frame.type) {
        case 'hello':
          return { lastError: null };
        case 'app_status': {
          const prev = state.apps[frame.app_id];
          return {
            apps: {
              ...state.apps,
              [frame.app_id]: {
                status: normaliseAppState(frame.state),
                rawState: frame.state,
                lastDeploy: frame.last_deploy,
                cpuPct: prev?.cpuPct ?? null,
                ramPct: prev?.ramPct ?? null,
                ts: frame.ts,
                cpuHistory: prev?.cpuHistory ?? EMPTY_HISTORY,
                ramHistory: prev?.ramHistory ?? EMPTY_HISTORY,
              },
            },
          };
        }
        case 'app_metrics': {
          const prev = state.apps[frame.app_id];
          return {
            apps: {
              ...state.apps,
              [frame.app_id]: {
                status: prev?.status ?? 'unknown',
                rawState: prev?.rawState ?? '',
                lastDeploy: prev?.lastDeploy ?? null,
                cpuPct: frame.cpu_pct,
                ramPct: frame.ram_pct,
                ts: frame.ts,
                cpuHistory: trimHistory(prev?.cpuHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.cpu_pct,
                }),
                ramHistory: trimHistory(prev?.ramHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.ram_pct,
                }),
              },
            },
          };
        }
        case 'addon_status': {
          const prev = state.addons[frame.addon_id];
          return {
            addons: {
              ...state.addons,
              [frame.addon_id]: {
                healthy: frame.healthy,
                ts: frame.ts,
                cpuPct: prev?.cpuPct ?? null,
                ramPct: prev?.ramPct ?? null,
                cpuHistory: prev?.cpuHistory ?? EMPTY_HISTORY,
                ramHistory: prev?.ramHistory ?? EMPTY_HISTORY,
              },
            },
          };
        }
        case 'addon_metrics': {
          const prev = state.addons[frame.addon_id];
          return {
            addons: {
              ...state.addons,
              [frame.addon_id]: {
                healthy: prev?.healthy ?? true,
                ts: frame.ts,
                cpuPct: frame.cpu_pct,
                ramPct: frame.ram_pct,
                cpuHistory: trimHistory(prev?.cpuHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.cpu_pct,
                }),
                ramHistory: trimHistory(prev?.ramHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.ram_pct,
                }),
              },
            },
          };
        }
        case 'app_removed': {
          if (!(frame.app_id in state.apps)) return {};
          const next = { ...state.apps };
          delete next[frame.app_id];
          return { apps: next };
        }
        case 'addon_added': {
          if (frame.addon_id in state.addons) return {};
          return {
            addons: {
              ...state.addons,
              [frame.addon_id]: {
                healthy: true,
                ts: frame.ts,
                cpuPct: null,
                ramPct: null,
                cpuHistory: EMPTY_HISTORY,
                ramHistory: EMPTY_HISTORY,
              },
            },
          };
        }
        case 'addon_removed': {
          if (!(frame.addon_id in state.addons)) return {};
          const next = { ...state.addons };
          delete next[frame.addon_id];
          return { addons: next };
        }
        case 'session_expired':
          // Handled outside the store: useWsClient calls the auth store's
          // logout() + redirects the browser to /auth/login. Here we just
          // surface a user-visible note for the one-frame overlap before
          // the redirect kicks in.
          return { lastError: frame.message };
        case 'error':
          return { lastError: frame.message };
      }
    }),

  setConnected: (connected) => set({ connected }),
  clear: () => set({ apps: {}, addons: {}, connected: false, lastError: null }),
}));
