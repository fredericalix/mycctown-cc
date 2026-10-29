#!/usr/bin/env node
// Verifies that the KayKit 3D assets the city needs are installed under
// frontend/public/assets/gltf. They are NOT part of the public repository (see
// docs/ASSETS.md): install them with `npm run assets:install`.
//
// The required file list is read from the asset catalog itself, so it can
// never drift from what the app actually loads.
//
// Also imported by install-assets.mjs (exports `missingAssets`, `PACK`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(FRONTEND_DIR, 'public');
const CATALOG = path.join(FRONTEND_DIR, 'src', 'data', 'assetCatalog.ts');

/** The KayKit pack, in its paid SOURCE edition. */
export const PACK = {
  name: 'KayKit Medieval Hexagon Pack (SOURCE)',
  url: 'https://kaylousberg.itch.io/kaykit-medieval-hexagon',
  archive: 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip',
  root: 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE',
  sourceMarker: 'SOURCE/Medieval_Hexagons_SOURCE.blend',
  sha256: 'abf18dddf87e70f61617af1aa7463d012d95dca70764cbf5d49a5e30504733e7',
  // Archive `<root>/Assets/gltf/<x>` → `public/assets/gltf/<x>`.
  target: 'assets/gltf',
  // Sub-directories of `target` owned by the pack (wiped on reinstall).
  owns: ['buildings', 'decoration', 'tiles', 'units'],
  // Loaded by path in assetLoader.ts (the shared atlas), not via the catalog.
  extra: ['assets/gltf/tiles/base/hexagons_medieval.png'],
};

/** Asset paths (relative to public/) listed in the catalog + the extras. */
export function requiredAssets() {
  const src = fs.readFileSync(CATALOG, 'utf8');
  const paths = new Set(PACK.extra);
  for (const m of src.matchAll(/path:\s*['`]([^'`]+)['`]/g)) paths.add(m[1]);
  return [...paths];
}

/** Missing files: catalog entries plus the buffers/images each installed
 *  .gltf references (a .gltf without its .bin still fails to load). */
export function missingAssets() {
  const missing = [];
  for (const rel of requiredAssets()) {
    const abs = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    if (!rel.endsWith('.gltf')) continue;
    let gltf;
    try {
      gltf = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      missing.push(`${rel} (unreadable)`);
      continue;
    }
    for (const { uri } of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!uri || uri.startsWith('data:')) continue;
      const dep = path.posix.join(path.posix.dirname(rel), decodeURIComponent(uri));
      if (!fs.existsSync(path.join(PUBLIC_DIR, dep))) missing.push(dep);
    }
  }
  return missing;
}

function main() {
  const missing = missingAssets();
  if (missing.length === 0) {
    console.log(`[assets] ✓ ${PACK.name}`);
    return;
  }
  console.error(`[assets] ✗ ${PACK.name}: ${missing.length} file(s) missing, e.g. public/${missing[0]}

The 3D assets are not bundled with this repository. To install them:
  1. Buy the "Source Files" edition of the KayKit pack (supports the artist):
       ${PACK.url}
  2. Download ${PACK.archive}
  3. Run:  npm run assets:install   (from frontend/)

Full guide: docs/ASSETS.md`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
