import { useMemo } from 'react';
import * as THREE from 'three';
import { useMapStore } from '../../stores/useMapStore';
import { parseHexKey, hexToWorld } from '../../utils/hexMath';

// Create a flat hexagonal ring shape
function createHexRingGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const innerR = 0.85;
  const outerR = 1.0;

  for (let i = 0; i <= 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    points.push(new THREE.Vector3(cos * innerR, 0, sin * innerR));
    points.push(new THREE.Vector3(cos * outerR, 0, sin * outerR));
  }

  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];

  for (let i = 0; i < 6; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i * 2 + 2) % 14;
    const d = (i * 2 + 3) % 14;

    // Two triangles per side
    vertices.push(
      points[a]!.x, points[a]!.y, points[a]!.z,
      points[b]!.x, points[b]!.y, points[b]!.z,
      points[c]!.x, points[c]!.y, points[c]!.z,
    );
    vertices.push(
      points[b]!.x, points[b]!.y, points[b]!.z,
      points[d]!.x, points[d]!.y, points[d]!.z,
      points[c]!.x, points[c]!.y, points[c]!.z,
    );
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function SelectionIndicator() {
  const selectedCell = useMapStore((s) => s.selectedCell);
  const cells = useMapStore((s) => s.cells);

  const geometry = useMemo(() => createHexRingGeometry(), []);

  if (!selectedCell) return null;

  const cell = cells.get(selectedCell);
  if (!cell) return null;

  const { q, r } = parseHexKey(selectedCell);
  const { x, z } = hexToWorld(q, r);
  const y = (cell.elevation ?? 0) + 0.02;

  return (
    <mesh geometry={geometry} position={[x, y, z]}>
      <meshBasicMaterial color={0x00aaff} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}
