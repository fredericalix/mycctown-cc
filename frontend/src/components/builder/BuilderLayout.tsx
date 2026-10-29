import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { SceneCanvas } from '../scene/SceneCanvas';
import { LeftSidebar } from './LeftSidebar';
import { Inspector } from './Inspector';
import { MappingPanel } from './MappingPanel';
import { useMapStore } from '../../stores/useMapStore';
import { useUiModeStore } from '../../stores/useUiModeStore';
import { worldToHex, hexKey, neighbors } from '../../utils/hexMath';

const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _intersection = new THREE.Vector3();

/**
 * Top-level city view: full-screen 3D canvas with overlay panels. Dropped the
 * medicity2 free-form placement loop (ghost preview, raycasted setBuilding/
 * setTile/addDecoration, keyboard rotation) — resources now arrive on the
 * map via the MappingPanel. The only click interaction that remains here is
 * select-to-inspect.
 */
export function BuilderLayout() {
  const cameraRef = useRef<THREE.Camera | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const selectCell = useMapStore((s) => s.selectCell);
  const setCell = useMapStore((s) => s.setCell);
  const cells = useMapStore((s) => s.cells);
  const uiMode = useUiModeStore((s) => s.mode);

  const screenToHex = useCallback((clientX: number, clientY: number) => {
    const camera = cameraRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!camera || !wrapper) return null;
    const canvas = wrapper.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    _mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, camera);
    const hit = _raycaster.ray.intersectPlane(_plane, _intersection);
    if (!hit) return null;
    return worldToHex(hit.x, hit.z);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left-click only
      const hex = screenToHex(e.clientX, e.clientY);
      if (!hex) return;
      const key = hexKey(hex.q, hex.r);
      if (cells.has(key)) {
        selectCell(key);
        return;
      }
      // Empty coord: in builder, a click on a ghost-neighbour of an existing
      // cell adds a grass tile there (growing the map). Clicks on coords
      // far from any cell do nothing — avoids accidental placements while
      // panning the camera.
      if (uiMode === 'builder') {
        const isGhostNeighbour = neighbors(hex.q, hex.r).some((n) =>
          cells.has(hexKey(n.q, n.r)),
        );
        if (isGhostNeighbour) {
          setCell({ q: hex.q, r: hex.r, tile: 'hex_grass' });
          selectCell(key);
          return;
        }
      }
      selectCell(null);
    },
    [screenToHex, selectCell, setCell, cells, uiMode],
  );

  return (
    <div className="w-full h-full relative">
      <div
        ref={canvasWrapperRef}
        className="absolute inset-0"
        onMouseDown={handleMouseDown}
      >
        <SceneCanvas mode="builder" cameraRef={cameraRef} />
      </div>

      <LeftSidebar />
      {uiMode === 'builder' && (
        <>
          <MappingPanel />
          <Inspector />
        </>
      )}
    </div>
  );
}
