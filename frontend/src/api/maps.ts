import { api } from './client';
import type { HexCell } from '../types/map';

export interface MapResponse {
  name: string;
  cells: HexCell[];
  version: number;
}

export interface MapPayload {
  name: string;
  cells: HexCell[];
}

export function getMap(orgId: string): Promise<MapResponse> {
  return api<MapResponse>(`/api/orgs/${encodeURIComponent(orgId)}/map`);
}

export function saveMap(orgId: string, payload: MapPayload): Promise<MapResponse> {
  return api<MapResponse>(`/api/orgs/${encodeURIComponent(orgId)}/map`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
