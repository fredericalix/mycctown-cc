import type { MayorMood } from '../stores/useMayorStore';

/** A ready-to-enqueue announcement payload (no id/ts yet). */
export interface MayorPayload {
  mood: MayorMood;
  title: string;
  detail: string;
}

/** Fallback when we can't resolve a friendly name for a resource. */
const UNKNOWN = 'an unnamed holding';

function appName(name: string | null | undefined): string {
  return name && name.trim() ? name : UNKNOWN;
}

/**
 * Lifecycle announcements. The `title` carries the medieval-light flavour;
 * the `detail` stays plainly readable (resource name + what happened) so the
 * popup is useful even if you ignore the role-play. All strings are English
 * (single-locale app — see CLAUDE.md).
 */
export const mayorMessages = {
  deploySuccess: (name: string | null): MayorPayload => ({
    mood: 'happy',
    title: `Victory! The banners fly over ${appName(name)}.`,
    detail: `Deploy succeeded — ${appName(name)}`,
  }),

  deployFail: (name: string | null): MayorPayload => ({
    mood: 'alarmed',
    title: `Alas, my Lord — ${appName(name)} has fallen.`,
    detail: `Deployment failed — ${appName(name)}`,
  }),

  appCreated: (name: string | null): MayorPayload => ({
    mood: 'happy',
    title: `New ground is broken: ${appName(name)} rises.`,
    detail: `App created — ${appName(name)}`,
  }),

  appStopped: (name: string | null): MayorPayload => ({
    mood: 'neutral',
    title: `${appName(name)} has shuttered its gates.`,
    detail: `App stopped — ${appName(name)}`,
  }),

  appRemoved: (name: string | null): MayorPayload => ({
    mood: 'neutral',
    title: `${appName(name)} was razed from the map.`,
    detail: `App removed — ${appName(name)}`,
  }),

  addonAdded: (provider: string | null): MayorPayload => {
    const what = provider && provider.trim() ? provider : 'service';
    return {
      mood: 'happy',
      title: `A new ${what} well now serves the realm.`,
      detail: `Add-on created — ${what}`,
    };
  },

  addonRemoved: (name: string | null): MayorPayload => ({
    mood: 'neutral',
    title: `The ${appName(name)} well was filled in.`,
    detail: `Add-on removed — ${appName(name)}`,
  }),

  addonUnhealthy: (name: string | null): MayorPayload => ({
    mood: 'alarmed',
    title: `The ${appName(name)} well runs foul.`,
    detail: `Add-on unhealthy — ${appName(name)}`,
  }),

  addonRecovered: (name: string | null): MayorPayload => ({
    mood: 'happy',
    title: `The ${appName(name)} well runs clear again.`,
    detail: `Add-on healthy — ${appName(name)}`,
  }),
};

/**
 * Proactive tips — not tied to a WS frame. Kept curated and few so the mayor
 * advises rather than nags.
 */
export const mayorTipMessages = {
  welcome: (orgName: string): MayorPayload => ({
    mood: 'neutral',
    title: `Welcome to ${orgName || 'your realm'}, my Lord.`,
    detail: 'Click any building to inspect the app or add-on it stands for.',
  }),

  viewMode: (): MayorPayload => ({
    mood: 'neutral',
    title: 'Survey your town from on high.',
    detail: 'Switch to View mode for a cinematic tour of the realm.',
  }),

  realtime: (): MayorPayload => ({
    mood: 'neutral',
    title: 'Hear of every deed at once.',
    detail: 'Use ⚡ Realtime setup to get sub-second updates from Clever Cloud.',
  }),

  cityTrouble: (failedCount: number): MayorPayload => ({
    mood: 'alarmed',
    title: `Trouble in the realm.`,
    detail:
      failedCount === 1
        ? '1 app has fallen — check the red building.'
        : `${failedCount} apps have fallen — check the red buildings.`,
  }),

  cityWell: (): MayorPayload => ({
    mood: 'happy',
    title: 'All is well across the realm.',
    detail: 'Every app stands green and healthy.',
  }),
};
