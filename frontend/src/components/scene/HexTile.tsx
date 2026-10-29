import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import type { HexCell } from '../../types/map';
import { hexToWorld, hexRotation } from '../../utils/hexMath';
import { useAssetStore } from '../../stores/useAssetStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { assetIdForStatus } from '../../utils/statusVisual';
import { extractColor } from '../../data/assetCatalog';
import type { ResourceStatus } from '../../types/ws';
import { useAnimationContext, type AnimationRegistry } from './SceneCanvas';
import { StatusBadge } from './StatusBadge';
import { StatusParticles } from './StatusParticles';
import { DeployScaffold } from './DeployScaffold';
import { BuildingEffects } from './BuildingEffects';

// Small decorations that don't need to cast shadows (save shadow pass cost)
const NO_SHADOW_DECO = [
  'rock', 'waterlily', 'waterplant', 'barrel', 'crate', 'bucket',
  'haybale', 'flower', 'anchor', 'trough', 'target', 'weaponrack',
  'wheelbarrow', 'boatrack', 'cannonball', 'projectile',
];

interface HexTileProps {
  cell: HexCell;
  registryRef: React.RefObject<AnimationRegistry>;
}

export function HexTile({ cell, registryRef }: HexTileProps) {
  const groupRef = useRef<THREE.Group>(null);
  const cloneModel = useAssetStore((s) => s.cloneModel);
  const ensureColorLoaded = useAssetStore((s) => s.ensureColorLoaded);
  // Tracking `loadedColors` (a Set reference) re-triggers the placement effect
  // when a lazy-loaded color finally arrives — tiles that were showing a
  // scaffold fallback then swap to the proper colored variant.
  const loadedColors = useAssetStore((s) => s.loadedColors);
  const { register, unregister, villageLightsRef } = useAnimationContext();

  const { x, z } = useMemo(() => hexToWorld(cell.q, cell.r), [cell.q, cell.r]);
  const y = cell.elevation ?? 0;
  const isWater = cell.tile === 'hex_water';

  // Live status drives which colored GLTF we load: green/blue/red/yellow
  // variants for run/deploy/fail/unknown, and `building_stage_B` for
  // `created`/`stopped` to show a scaffolded construction site. Addons don't
  // report status granularity — healthy → running, unhealthy → failed.
  const appStatus = useRealtimeStore((s) =>
    cell.appId ? s.apps[cell.appId]?.status ?? null : null,
  );
  const addonHealthy = useRealtimeStore((s) =>
    cell.addonId ? s.addons[cell.addonId]?.healthy ?? null : null,
  );
  const buildingStatus: ResourceStatus = cell.appId
    ? appStatus ?? 'unknown'
    : cell.addonId
      ? addonHealthy === null
        ? 'unknown'
        : addonHealthy
          ? 'running'
          : 'failed'
      : 'running';

  // Track registered objects for cleanup
  const registeredRef = useRef<Array<{ type: 'windmillFans' | 'watermillWheels' | 'trees' | 'boats' | 'flags' | 'waterTiles'; obj: THREE.Object3D }>>([]);
  const lightRef = useRef<THREE.PointLight | null>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Clear previous children
    while (group.children.length > 0) {
      group.remove(group.children[0]!);
    }

    // Cleanup previous registrations
    for (const { type, obj } of registeredRef.current) {
      unregister(type, obj);
    }
    registeredRef.current = [];

    // Remove previous village light
    if (lightRef.current && villageLightsRef.current) {
      const idx = villageLightsRef.current.indexOf(lightRef.current);
      if (idx >= 0) villageLightsRef.current.splice(idx, 1);
      lightRef.current.parent?.remove(lightRef.current);
      lightRef.current = null;
    }

    // Place tile
    const tileModel = cloneModel(cell.tile);
    if (tileModel) {
      tileModel.rotation.y = hexRotation(cell.rotation ?? 0);

      if (isWater) {
        tileModel.userData.baseY = 0;
        register('waterTiles', tileModel);
        registeredRef.current.push({ type: 'waterTiles', obj: tileModel });
      }

      // Tiles receive shadows but don't cast them
      tileModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });

      // Static tile: freeze matrix (water animates its y position, keep auto)
      if (!isWater) {
        tileModel.matrixAutoUpdate = false;
        tileModel.updateMatrix();
      }

      group.add(tileModel);
    }

    // Place building. For resource-bound cells, swap the GLTF to the
    // color variant that matches the live status (running=green, etc.) or
    // to `building_stage_B` for created/stopped. `assetIdForStatus` returns
    // the authored asset unchanged when no variant applies.
    if (cell.building) {
      const isBoundResource = Boolean(cell.appId || cell.addonId);
      const activeBuildingId = isBoundResource
        ? assetIdForStatus(cell.building, buildingStatus)
        : cell.building;

      // Lazy color load: if the wanted variant isn't cached yet, kick off the
      // fetch and fall back to the neutral scaffolding while it arrives.
      if (!cloneModel(activeBuildingId)) {
        const color = extractColor(activeBuildingId);
        if (color) ensureColorLoaded(color);
      }

      const buildingModel =
        cloneModel(activeBuildingId) ??
        cloneModel('building_stage_B') ??
        cloneModel(cell.building);
      if (buildingModel) {
        buildingModel.rotation.y = hexRotation(cell.buildingRotation ?? 0);

        // Find animatable parts. Stamp the bound CC resource id on each so
        // useAnimations can modulate the rotation speed per-cell based on
        // the live CPU / status of the app/addon.
        const boundResourceId = cell.appId ?? cell.addonId ?? null;
        buildingModel.traverse((child) => {
          if (child.name.includes('windmill_top_fan')) {
            child.userData.resourceId = boundResourceId;
            register('windmillFans', child);
            registeredRef.current.push({ type: 'windmillFans', obj: child });
          }
          if (child.name.includes('watermill_wheel')) {
            child.userData.resourceId = boundResourceId;
            register('watermillWheels', child);
            registeredRef.current.push({ type: 'watermillWheels', obj: child });
          }
        });

        // Every building gets a warm village light — useDayNight ramps its
        // intensity from 0 at noon to 1.5 at night so nothing stays in the
        // dark. No per-type gating (earlier list missed mines, docks,
        // workshops, shrines, stables, …).
        {
          const light = new THREE.PointLight(0xffaa44, 0, 3.5, 2);
          light.position.set(0, 0.5, 0);
          group.add(light);
          villageLightsRef.current?.push(light);
          lightRef.current = light;
        }

        // Building root is static (fan/wheel children rotate independently)
        buildingModel.matrixAutoUpdate = false;
        buildingModel.updateMatrix();

        group.add(buildingModel);
      }
    }

    // Place decorations
    if (cell.decorations) {
      for (const deco of cell.decorations) {
        const decoModel = cloneModel(deco.id);
        if (!decoModel) continue;

        decoModel.position.set(deco.dx ?? 0, 0, deco.dz ?? 0);
        decoModel.rotation.y = hexRotation(deco.rotation ?? 0);

        // Disable shadow casting for small decorations (keeps receiveShadow)
        if (NO_SHADOW_DECO.some((k) => deco.id.includes(k))) {
          decoModel.traverse((child) => {
            if (child instanceof THREE.Mesh) child.castShadow = false;
          });
        }

        // Track animatable decorations
        let animated = false;
        if (deco.id.includes('tree')) {
          decoModel.userData.phase = Math.random() * Math.PI * 2;
          register('trees', decoModel);
          registeredRef.current.push({ type: 'trees', obj: decoModel });
          animated = true;
        }
        if (deco.id === 'boat' || deco.id.includes('ship')) {
          decoModel.userData.baseY = 0;
          decoModel.userData.phase = Math.random() * Math.PI * 2;
          register('boats', decoModel);
          registeredRef.current.push({ type: 'boats', obj: decoModel });
          animated = true;
        }
        if (deco.id.includes('flag')) {
          decoModel.userData.phase = Math.random() * Math.PI * 2;
          register('flags', decoModel);
          registeredRef.current.push({ type: 'flags', obj: decoModel });
          animated = true;
        }

        // Static decorations: freeze matrix
        if (!animated) {
          decoModel.matrixAutoUpdate = false;
          decoModel.updateMatrix();
        }

        group.add(decoModel);
      }
    }

    // Parent tile group position is static once placed
    group.matrixAutoUpdate = false;
    group.updateMatrix();

    return () => {
      for (const { type, obj } of registeredRef.current) {
        unregister(type, obj);
      }
      registeredRef.current = [];
      if (lightRef.current && villageLightsRef.current) {
        const idx = villageLightsRef.current.indexOf(lightRef.current);
        if (idx >= 0) villageLightsRef.current.splice(idx, 1);
        lightRef.current = null;
      }
    };
    // buildingStatus is intentionally a dep so a status change re-clones the
    // building with the right-colored variant. loadedColors triggers a re-clone
    // once a lazily-fetched color batch finishes downloading (scaffold → real).
  }, [cell, cloneModel, ensureColorLoaded, register, unregister, villageLightsRef, isWater, registryRef, buildingStatus, loadedColors]);

  const badgePos: [number, number, number] = [x, y + 1.3, z];
  const particlesPos: [number, number, number] = [x, y + 1.1, z];
  const scaffoldPos: [number, number, number] = [x, y, z];
  const effectsPos: [number, number, number] = [x, y, z];
  const showExtras = Boolean(cell.building && (cell.appId || cell.addonId));

  return (
    <>
      <group ref={groupRef} position={[x, y, z]} />
      {/* Per-building-type ambient/CPU effects — decides internally which
          sub-effects to render based on the building id + resource binding. */}
      {cell.building && (
        <BuildingEffects
          position={effectsPos}
          buildingId={cell.building}
          appId={cell.appId}
          addonId={cell.addonId}
        />
      )}
      {showExtras && (
        <>
          <StatusBadge position={badgePos} appId={cell.appId} addonId={cell.addonId} />
          <StatusParticles
            position={particlesPos}
            appId={cell.appId}
            addonId={cell.addonId}
          />
          <DeployScaffold
            position={scaffoldPos}
            appId={cell.appId}
            addonId={cell.addonId}
          />
        </>
      )}
    </>
  );
}
