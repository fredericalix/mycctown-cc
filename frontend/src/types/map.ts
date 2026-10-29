export interface Decoration {
  id: string;
  dx?: number;
  dz?: number;
  rotation?: number;
}

export interface HexCell {
  q: number;
  r: number;
  tile: string;
  rotation?: number;
  elevation?: number;
  building?: string;
  buildingRotation?: number;
  decorations?: Decoration[];
  /** Clever Cloud application id (if this cell represents an app). */
  appId?: string;
  /** Clever Cloud addon id (if this cell represents an addon). */
  addonId?: string;
}

export type AssetCategory = 'tiles' | 'buildings' | 'decoration' | 'units';

export interface AssetEntry {
  id: string;
  path: string;
  category: AssetCategory;
  subcategory: string;
}
