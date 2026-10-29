import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { type BuildingColor, getAlwaysLoadedAssets, getAssetsByColor } from '../data/assetCatalog';
import type { AssetEntry } from '../types/map';
import { debug } from './debug';
import { retryWithBackoff } from './retry';

// Bump this when the asset catalogue (gltf/bin/png on disk) changes in a
// breaking way. Appended as `?v=N` to every asset URL — GLTFs we name
// directly, and `.bin`/`.png` referenced from inside .gltf via the loader's
// URL modifier (those URIs are resolved by GLTFLoader internally and would
// otherwise miss the cache-bust). Static-asset paths aren't content-hashed
// by Vite, so this is the only reliable way to retire a previous deploy's
// files from browser/proxy caches that pinned them under `immutable`.
const ASSET_VERSION = '3';

function appendVersion(url: string): string {
  // Skip URLs that already carry our bust (avoid `?v=3?v=3`) and absolute
  // URLs that don't belong to this origin (Cellar music, blob:, data:).
  if (url.includes('?v=') || /^[a-z]+:/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${ASSET_VERSION}`;
}

function makeLoadingManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(appendVersion);
  return manager;
}

function makeGltfLoader(manager: THREE.LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

async function loadEntries(
  entries: AssetEntry[],
  gltfLoader: GLTFLoader,
  sharedTexture: THREE.Texture,
  onItem?: () => void,
): Promise<Map<string, GLTF>> {
  const cache = new Map<string, GLTF>();
  const batchSize = 8;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          // Retry covers the .gltf fetch AND its child .bin/.png fetches —
          // GLTFLoader resolves them inside loadAsync, so a child-fetch failure
          // surfaces as a top-level rejection.
          const gltf = await retryWithBackoff(() => gltfLoader.loadAsync(entry.path), {
            attempts: 3,
            baseDelayMs: 300,
            scope: `asset:${entry.id}`,
          });
          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial;
              if (mat.map && mat.map !== sharedTexture) {
                mat.map.dispose();
                mat.map = sharedTexture;
              }
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          cache.set(entry.id, gltf);
        } catch (e) {
          debug.error('asset', `gave up loading "${entry.id}" from ${entry.path}`, e);
        }
        onItem?.();
      }),
    );
  }
  return cache;
}

/** Initial load: every non-color asset + one dominant color of building variants.
 *  Other colors are fetched on-demand by `useAssetStore.ensureColorLoaded`. */
export async function loadInitialAssets(
  initialColor: BuildingColor,
  onProgress: (pct: number) => void,
): Promise<{ cache: Map<string, GLTF>; texture: THREE.Texture }> {
  const manager = makeLoadingManager();
  const gltfLoader = makeGltfLoader(manager);
  const textureLoader = new THREE.TextureLoader(manager);

  const sharedTexture = await textureLoader.loadAsync(
    'assets/gltf/tiles/base/hexagons_medieval.png',
  );
  sharedTexture.flipY = false;
  sharedTexture.colorSpace = THREE.SRGBColorSpace;

  const entries = [...getAlwaysLoadedAssets(), ...getAssetsByColor(initialColor)];
  const total = entries.length;
  let loaded = 0;

  const cache = await loadEntries(entries, gltfLoader, sharedTexture, () => {
    loaded++;
    onProgress((loaded / total) * 100);
  });

  return { cache, texture: sharedTexture };
}

/** Lazy load: only the GLTFs for one color of building variants.
 *  Returned cache must be merged into the existing one. */
export async function loadColorAssets(
  color: BuildingColor,
  sharedTexture: THREE.Texture,
): Promise<Map<string, GLTF>> {
  const manager = makeLoadingManager();
  const gltfLoader = makeGltfLoader(manager);
  return loadEntries(getAssetsByColor(color), gltfLoader, sharedTexture);
}
