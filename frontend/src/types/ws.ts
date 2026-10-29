export type WsFrame =
  | { type: 'hello'; org_id: string; ts: number }
  | {
      type: 'app_status';
      app_id: string;
      state: string;
      last_deploy: number | null;
      ts: number;
    }
  | { type: 'app_metrics'; app_id: string; cpu_pct: number; ram_pct: number; ts: number }
  | { type: 'addon_status'; addon_id: string; healthy: boolean; ts: number }
  | { type: 'addon_metrics'; addon_id: string; cpu_pct: number; ram_pct: number; ts: number }
  /** CC APPLICATION_DELETION — emitted by the webhook receiver. */
  | { type: 'app_removed'; app_id: string; ts: number }
  /** CC ADDON_CREATION — lets the scene pop in a newly-created addon
   *  without waiting for the 30 s addon polling tick. */
  | { type: 'addon_added'; addon_id: string; provider: string | null; ts: number }
  | { type: 'addon_removed'; addon_id: string; ts: number }
  /** Backend can't decrypt our OAuth tokens (ENCRYPTION_KEY rotated) — we
   *  need to log out and log back in so fresh tokens get encrypted with
   *  the current key. */
  | { type: 'session_expired'; message: string }
  | { type: 'error'; message: string };

/** Normalised resource state used by visuals. `warning` is synthesised on the
 *  frontend when an app is otherwise healthy but one of its linked addons is
 *  unhealthy — the app itself is fine, but the dependency is broken.
 *  `created` is emitted when an app exists on CC but has never been
 *  deployed — we render the building-in-progress asset for it. */
export type ResourceStatus =
  | 'running'
  | 'deploying'
  | 'stopped'
  | 'failed'
  | 'warning'
  | 'created'
  | 'unknown';

/** Map Clever Cloud raw app state strings to a small enum we can render. */
export function normaliseAppState(raw: string): ResourceStatus {
  const s = raw.toUpperCase();
  if (s === 'CREATED') return 'created';
  if (s === 'SHOULD_BE_UP' || s === 'UP' || s === 'RUNNING') return 'running';
  if (s === 'WANTS_TO_BE_UP' || s === 'RESTARTING' || s.includes('DEPLOY')) return 'deploying';
  if (s === 'SHOULD_BE_DOWN' || s === 'DOWN' || s === 'STOPPED') return 'stopped';
  if (s.includes('FAIL') || s.includes('ERROR')) return 'failed';
  return 'unknown';
}
