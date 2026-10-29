import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useMapStore } from '../../stores/useMapStore';
import { hexToWorld } from '../../utils/hexMath';
import { createParticleData, useParticleAnimation, type ParticleData } from '../../three/useParticles';

const SMOKE_BUILDINGS = ['tavern', 'blacksmith', 'home_A', 'home_B'];

interface Props {
  daylightRef: React.RefObject<number>;
}

export function ParticleEffects({ daylightRef }: Props) {
  const cells = useMapStore((s) => s.cells);
  const dataRef = useRef<ParticleData | null>(null);

  // Compute smoke emitter positions from buildings
  const smokeEmitters = useMemo(() => {
    const emitters: THREE.Vector3[] = [];
    for (const cell of cells.values()) {
      if (cell.building && SMOKE_BUILDINGS.some((name) => cell.building!.includes(name))) {
        const { x, z } = hexToWorld(cell.q, cell.r);
        emitters.push(new THREE.Vector3(x, (cell.elevation ?? 0) + 0.6, z));
      }
    }
    return emitters;
  }, [cells]);

  // Create particle data
  const particleData = useMemo(() => createParticleData(smokeEmitters), [smokeEmitters]);

  useEffect(() => {
    dataRef.current = particleData;
  }, [particleData]);

  useParticleAnimation(dataRef, daylightRef);

  return (
    <>
      <points geometry={particleData.leafGeometry}>
        <pointsMaterial
          size={0.06}
          vertexColors
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </points>
      <points geometry={particleData.smokeGeometry}>
        <pointsMaterial
          size={0.08}
          color={0x999999}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </points>
      <points
        geometry={particleData.fireflyGeometry}
        material={particleData.fireflyMaterial}
      />
    </>
  );
}
