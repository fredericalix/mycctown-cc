// Post-build pass: rewrite every dist/assets/gltf/**/*.gltf in-place using
// gltfpack with EXT_meshopt_compression + quantization. Keeps the .gltf+.bin
// pair format intact (no .glb conversion) so the existing assetCatalog paths
// stay valid. Three.js GLTFLoader needs `MeshoptDecoder` at runtime to read
// the result.
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const GLTFPACK = './node_modules/.bin/gltfpack';
const ROOT = 'dist/assets/gltf';
const BATCH = 8;

function* walkGltf(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walkGltf(p);
    else if (p.endsWith('.gltf')) yield p;
  }
}

function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) total += dirSize(p);
    else total += s.size;
  }
  return total;
}

async function compress(file) {
  try {
    await exec(GLTFPACK, ['-i', file, '-o', file, '-cc']);
    return { file, ok: true };
  } catch (e) {
    return { file, ok: false, err: e.stderr?.toString() ?? e.message };
  }
}

const before = dirSize(ROOT);
const files = [...walkGltf(ROOT)];
let done = 0;
let failed = 0;

for (let i = 0; i < files.length; i += BATCH) {
  const results = await Promise.all(files.slice(i, i + BATCH).map(compress));
  for (const r of results) {
    if (!r.ok) {
      console.warn(`  fail ${r.file}: ${r.err?.split('\n')[0] ?? '?'}`);
      failed++;
    }
  }
  done += results.length;
  process.stdout.write(`\rcompress-gltf: ${done}/${files.length}`);
}

const after = dirSize(ROOT);
const saved = ((1 - after / before) * 100).toFixed(0);
process.stdout.write(
  `\rcompress-gltf: ${done}/${files.length} (${failed} failed) — ${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB (${saved}% saved)\n`,
);
