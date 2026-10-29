import { useRef, useMemo, createContext, useContext, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import * as THREE from 'three';
import { HexGrid } from './HexGrid';
import { GhostHexes } from './GhostHexes';
import { CloudLayer } from './CloudLayer';
import { SelectionIndicator } from './SelectionIndicator';
import { DayNightController } from './DayNightController';
import { ParticleEffects } from './ParticleEffects';
import { GroundPlane } from './GroundPlane';
import { FloatingInspector } from './FloatingInspector';
import { useAnimations } from '../../three/useAnimations';
import { useCinematicCamera } from '../../three/useCinematicCamera';
import { useAnimationStore } from '../../stores/useAnimationStore';
import { useUiModeStore } from '../../stores/useUiModeStore';

export type SceneMode = 'builder' | 'viewer';

/** Syncs the R3F camera to an external ref so it can be used outside the Canvas */
function CameraSync({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree();
  cameraRef.current = camera;
  return null;
}

type AnimType = 'windmillFans' | 'watermillWheels' | 'clouds' | 'trees' | 'boats' | 'flags' | 'waterTiles';

export interface AnimationRegistry {
  windmillFans: THREE.Object3D[];
  watermillWheels: THREE.Object3D[];
  clouds: THREE.Object3D[];
  trees: THREE.Object3D[];
  boats: THREE.Object3D[];
  flags: THREE.Object3D[];
  waterTiles: THREE.Object3D[];
}

interface AnimationContextValue {
  register: (type: AnimType, obj: THREE.Object3D) => void;
  unregister: (type: AnimType, obj: THREE.Object3D) => void;
  villageLightsRef: React.RefObject<THREE.PointLight[]>;
  daylightRef: React.RefObject<number>;
  registryRef: React.RefObject<AnimationRegistry>;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  cameraControlsRef: React.RefObject<CameraControlsImpl | null>;
}

export const AnimationContext = createContext<AnimationContextValue>(null!);
export const useAnimationContext = () => useContext(AnimationContext);

function SceneInner({ mode }: { mode: SceneMode }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  const { villageLightsRef, daylightRef, registryRef, cameraControlsRef } = useAnimationContext();
  const cameraControlsLocalRef = useRef<CameraControlsImpl>(null);
  const cloudsEnabled = useAnimationStore((s) => s.cloudsEnabled);

  // Sync local camera-controls ref to context
  if (cameraControlsLocalRef.current && cameraControlsRef.current !== cameraControlsLocalRef.current) {
    (cameraControlsRef as React.MutableRefObject<CameraControlsImpl | null>).current = cameraControlsLocalRef.current;
  }

  useAnimations(registryRef);
  useCinematicCamera(cameraControlsLocalRef);

  const dayNightRefs = useMemo(
    () => ({
      sun: sunRef,
      hemisphere: hemiRef,
      fill: fillRef,
      ambient: ambientRef,
      villageLights: villageLightsRef,
    }),
    [villageLightsRef],
  );

  return (
    <>
      <hemisphereLight ref={hemiRef} args={[0x87ceeb, 0x8b7355, 0.6]} />
      <directionalLight
        ref={sunRef}
        color={0xfff4e0}
        intensity={1.2}
        position={[8, 12, 4]}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-bias={-0.001}
      />
      <directionalLight ref={fillRef} color={0x8ec8f0} intensity={0.3} position={[-6, 4, -8]} />
      <ambientLight ref={ambientRef} color={0x404040} intensity={0.2} />

      <CameraControls
        ref={cameraControlsLocalRef}
        minDistance={6}
        maxDistance={30}
        minPolarAngle={Math.PI / 7}
        maxPolarAngle={Math.PI / 2.3}
        mouseButtons={{
          left: CameraControlsImpl.ACTION.NONE,
          right: CameraControlsImpl.ACTION.TRUCK,
          middle: CameraControlsImpl.ACTION.ROTATE,
          wheel: CameraControlsImpl.ACTION.DOLLY,
        }}
        touches={{
          one: CameraControlsImpl.ACTION.TOUCH_TRUCK,
          two: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,
          three: CameraControlsImpl.ACTION.TOUCH_ROTATE,
        }}
      />

      <HexGrid />
      {mode === 'builder' && <GhostHexes />}
      {cloudsEnabled && <CloudLayer />}
      <GroundPlane mode={mode} />
      <DayNightController refs={dayNightRefs} daylightRef={daylightRef} />
      <ParticleEffects daylightRef={daylightRef} />
      {mode === 'builder' && <SelectionIndicator />}
      <ViewModeFloatingInspector />
    </>
  );
}

/** Renders the FloatingInspector only when uiMode === 'view'. Kept inside
 *  the r3f tree so drei's <Html> can project to screen coordinates. */
function ViewModeFloatingInspector() {
  const uiMode = useUiModeStore((s) => s.mode);
  if (uiMode !== 'view') return null;
  return <FloatingInspector />;
}

export function SceneCanvas({ mode, cameraRef }: { mode: SceneMode; cameraRef?: React.MutableRefObject<THREE.Camera | null> }) {
  const villageLightsRef = useRef<THREE.PointLight[]>([]);
  const daylightRef = useRef(1);
  const internalCameraRef = useRef<THREE.Camera | null>(null);
  const usedCameraRef = cameraRef ?? internalCameraRef;
  const cameraControlsRef = useRef<CameraControlsImpl | null>(null);

  const registryRef = useRef<AnimationRegistry>({
    windmillFans: [],
    watermillWheels: [],
    clouds: [],
    trees: [],
    boats: [],
    flags: [],
    waterTiles: [],
  });

  const register = useCallback((type: AnimType, obj: THREE.Object3D) => {
    const arr = registryRef.current[type];
    if (!arr.includes(obj)) arr.push(obj);
  }, []);

  const unregister = useCallback((type: AnimType, obj: THREE.Object3D) => {
    const arr = registryRef.current[type];
    const idx = arr.indexOf(obj);
    if (idx >= 0) arr.splice(idx, 1);
  }, []);

  const contextValue = useMemo(
    () => ({ register, unregister, villageLightsRef, daylightRef, registryRef, cameraRef: usedCameraRef, cameraControlsRef }),
    [register, unregister, usedCameraRef],
  );

  return (
    <AnimationContext.Provider value={contextValue}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 45, near: 0.1, far: 100, position: [14, 12, 14] }}
        scene={{ background: new THREE.Color(0x87ceeb), fog: new THREE.Fog(0xc8ddf0, 20, 45) }}
      >
        <CameraSync cameraRef={usedCameraRef} />
        <SceneInner mode={mode} />
      </Canvas>
    </AnimationContext.Provider>
  );
}
