import { useEffect, useRef } from 'react';
import { useMayorStore } from '../stores/useMayorStore';
import { useOrgStore } from '../stores/useOrgStore';
import { useRealtimeStore } from '../stores/useRealtimeStore';
import { mayorTipMessages } from './mayorMessages';

/** Once-per-browser onboarding guard. */
const ONBOARDING_KEY = 'mycctown.mayor.tips';
/** Delay before the city-status tip so the WS baseline has time to land. */
const CITY_STATUS_DELAY_MS = 5_500;

function onboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'done';
  } catch {
    return false;
  }
}

function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done');
  } catch {
    // ignore
  }
}

/**
 * Proactive mayor tips, decoupled from the WS frame stream:
 *  - a one-time (per browser) onboarding nudge the first time a town loads,
 *  - a per-org-visit "city status" check that warns when apps have fallen.
 *
 * Mount once near the app root and feed it the current org id.
 */
export function useMayorTips(orgId: string | null): void {
  // Tracks which org we've already run the city-status check for, so switching
  // away and back re-checks but a re-render doesn't double-fire.
  const checkedOrg = useRef<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      checkedOrg.current = null;
      return;
    }
    if (checkedOrg.current === orgId) return;
    checkedOrg.current = orgId;

    const mayor = useMayorStore.getState();
    if (!mayor.enabled) return;

    const orgName =
      useOrgStore.getState().orgs.find((o) => o.id === orgId)?.name ?? '';

    // One-time onboarding, only on the very first town a user opens.
    if (!onboardingDone()) {
      markOnboardingDone();
      mayor.notify(mayorTipMessages.welcome(orgName));
      mayor.notify(mayorTipMessages.realtime());
    }

    // City-status check after the realtime baseline has had time to arrive.
    const timer = setTimeout(() => {
      // Re-read enabled at fire time — the user may have muted meanwhile.
      if (!useMayorStore.getState().enabled) return;
      const apps = useRealtimeStore.getState().apps;
      const failed = Object.values(apps).filter((a) => a.status === 'failed').length;
      if (failed > 0) {
        useMayorStore.getState().notify(mayorTipMessages.cityTrouble(failed));
      }
    }, CITY_STATUS_DELAY_MS);

    return () => clearTimeout(timer);
  }, [orgId]);
}
