import { create } from 'zustand';

/** The mayor's mood drives which portrait + accent colour the popup shows. */
export type MayorMood = 'happy' | 'neutral' | 'alarmed';

export interface MayorMessage {
  id: string;
  mood: MayorMood;
  /** Short flavour headline (medieval-light). */
  title: string;
  /** Plain, readable technical line (app/addon name + what happened). */
  detail: string;
  ts: number;
}

/** How many past announcements the history panel retains. */
const HISTORY_MAX = 30;

interface MayorState {
  /** Announcements waiting to be shown, oldest first. */
  queue: MayorMessage[];
  /** The announcement currently displayed in the popup, or null. */
  current: MayorMessage | null;
  /** Past announcements, newest first. */
  history: MayorMessage[];
  /** Whether the history panel is open. */
  historyOpen: boolean;
  /** Master switch — when false, notify() is a no-op (the mayor is muted). */
  enabled: boolean;

  /** Enqueue an announcement (shows immediately if nothing is on screen). */
  notify: (msg: Omit<MayorMessage, 'id' | 'ts'> & { ts?: number }) => void;
  /** Dismiss the current popup and pull the next queued announcement in. */
  next: () => void;
  /** Dismiss the current popup without pulling the next one. */
  dismiss: () => void;
  setHistoryOpen: (open: boolean) => void;
  toggleHistory: () => void;
  clearHistory: () => void;
  setEnabled: (v: boolean) => void;
}

const ENABLED_STORAGE_KEY = 'mycctown.mayor.enabled';

function readStoredEnabled(): boolean {
  try {
    // Default ON: only an explicit "false" mutes the mayor.
    return localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Monotonic id counter — Date.now()/Math.random() avoided so ids stay
 *  deterministic and collision-free even within the same millisecond. */
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `mayor-${idCounter}`;
}

function archive(history: MayorMessage[], msg: MayorMessage): MayorMessage[] {
  const next = [msg, ...history];
  if (next.length > HISTORY_MAX) next.length = HISTORY_MAX;
  return next;
}

export const useMayorStore = create<MayorState>((set) => ({
  queue: [],
  current: null,
  history: [],
  historyOpen: false,
  enabled: readStoredEnabled(),

  notify: (msg) =>
    set((state) => {
      if (!state.enabled) return {};
      const full: MayorMessage = {
        id: nextId(),
        mood: msg.mood,
        title: msg.title,
        detail: msg.detail,
        ts: msg.ts ?? Date.now(),
      };
      // Record in history immediately so muting later still keeps the trail.
      const history = archive(state.history, full);
      // Nothing on screen → show it now; otherwise queue behind the current one.
      if (state.current === null) {
        return { current: full, history };
      }
      return { queue: [...state.queue, full], history };
    }),

  next: () =>
    set((state) => {
      if (state.queue.length === 0) return { current: null };
      const [head, ...rest] = state.queue;
      return { current: head ?? null, queue: rest };
    }),

  dismiss: () => set({ current: null }),

  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  toggleHistory: () => set((state) => ({ historyOpen: !state.historyOpen })),
  clearHistory: () => set({ history: [] }),

  setEnabled: (enabled) => {
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    // Muting also clears anything pending so it doesn't surface later.
    set(enabled ? { enabled } : { enabled, queue: [], current: null });
  },
}));
