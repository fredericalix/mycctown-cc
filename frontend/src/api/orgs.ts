import { api } from './client';
import { CcAddon, CcApplication, CcOrganisation } from '../types/cc';

export function listOrgs(): Promise<CcOrganisation[]> {
  return api<CcOrganisation[]>('/api/orgs');
}

export function listApps(orgId: string): Promise<CcApplication[]> {
  return api<CcApplication[]>(`/api/orgs/${encodeURIComponent(orgId)}/apps`);
}

export function listAddons(orgId: string): Promise<CcAddon[]> {
  return api<CcAddon[]>(`/api/orgs/${encodeURIComponent(orgId)}/addons`);
}

/** `{ appId: [addonId, ...] }` — addons linked to each app in the org. */
export function listDependencies(orgId: string): Promise<Record<string, string[]>> {
  return api<Record<string, string[]>>(
    `/api/orgs/${encodeURIComponent(orgId)}/dependencies`,
  );
}

export interface WebhookSetupInfo {
  enabled: boolean;
  url: string | null;
  events: string[];
  console_url: string;
  configured: boolean;
}

export function getWebhookSetup(orgId: string): Promise<WebhookSetupInfo> {
  return api<WebhookSetupInfo>(
    `/api/orgs/${encodeURIComponent(orgId)}/webhook-setup`,
  );
}
