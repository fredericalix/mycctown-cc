import { create } from 'zustand';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { type BuildingColor } from '../data/assetCatalog';
import { loadColorAssets } from '../utils/assetLoader';
import { debug } from '../utils/debug';

interface AssetState {
  loadingProgress: number;
  isLoaded: boolean;
  sharedTexture: THREE.Texture | null;
  cache: Map<string, GLTF>;
  /** Building-color subcategories already in `cache` (lazy-loaded variants). */
  loadedColors: Set<BuildingColor>;
  /** Building-color subcategories currently being fetched. */
  loadingColors: Set<BuildingColor>;

  setProgress: (pct: number) => void;
  setLoaded: (
    texture: THREE.Texture,
    cache: Map<string, GLTF>,
    initialColor: BuildingColor,
  ) => void;
  cloneModel: (assetId: string) => THREE.Group | null;
  hasModel: (assetId: string) => boolean;
  /** Trigger lazy load of one building color variant if not already cached/loading. */
  ensureColorLoaded: (color: BuildingColor) => void;
}

export const useAssetStore = create<AssetState>((set, get) => ({
  loadingProgress: 0,
  isLoaded: false,
  sharedTexture: null,
  cache: new Map(),
  loadedColors: new Set(),
  loadingColors: new Set(),

  setProgress: (pct) => set({ loadingProgress: pct }),

  setLoaded: (texture, cache, initialColor) =>
    set({
      sharedTexture: texture,
      cache,
      isLoaded: true,
      loadingProgress: 100,
      loadedColors: new Set([initialColor]),
    }),

  cloneModel: (assetId) => {
    const gltf = get().cache.get(assetId);
    if (!gltf) return null;
    return gltf.scene.clone();
  },

  hasModel: (assetId) => get().cache.has(assetId),

  ensureColorLoaded: (color) => {
    const state = get();
    if (state.loadedColors.has(color) || state.loadingColors.has(color)) return;
    if (!state.sharedTexture) return;

    set({ loadingColors: new Set(state.loadingColors).add(color) });
    debug.log('asset:color', `lazy-load start "${color}"`);

    loadColorAssets(color, state.sharedTexture)
      .then((newAssets) => {
        const current = get();
        const newCache = new Map(current.cache);
        for (const [id, gltf] of newAssets) newCache.set(id, gltf);
        const newLoaded = new Set(current.loadedColors);
        newLoaded.add(color);
        const newLoading = new Set(current.loadingColors);
        newLoading.delete(color);
        set({ cache: newCache, loadedColors: newLoaded, loadingColors: newLoading });
        debug.log('asset:color', `lazy-load done "${color}" (+${newAssets.size})`);
      })
      .catch((e) => {
        debug.warn('asset:color', `lazy-load failed "${color}"`, e);
        const current = get();
        const newLoading = new Set(current.loadingColors);
        newLoading.delete(color);
        set({ loadingColors: newLoading });
      });
  },
}));
