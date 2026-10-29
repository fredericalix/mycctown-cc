import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useAnimationStore } from '../stores/useAnimationStore';

const CYCLE_DURATION = 120;

const SKY_COLORS = {
  dawn: new THREE.Color(0xffb366),
  noon: new THREE.Color(0x87ceeb),
  dusk: new THREE.Color(0xff7744),
  night: new THREE.Color(0x0a0a2e),
};
const FOG_COLORS = {
  dawn: new THREE.Color(0xffd4a0),
  noon: new THREE.Color(0xc8ddf0),
  dusk: new THREE.Color(0xff9966),
  night: new THREE.Color(0x0e0e30),
};
const SUN_COLORS = {
  dawn: new THREE.Color(0xffaa55),
  noon: new THREE.Color(0xfff4e0),
  dusk: new THREE.Color(0xff6633),
  night: new THREE.Color(0x222244),
};
const HEMI_SKY = {
  dawn: new THREE.Color(0xffcc88),
  noon: new THREE.Color(0x87ceeb),
  dusk: new THREE.Color(0xff8855),
  night: new THREE.Color(0x111133),
};
const HEMI_GROUND = {
  dawn: new THREE.Color(0x8b7355),
  noon: new THREE.Color(0x8b7355),
  dusk: new THREE.Color(0x6b5335),
  night: new THREE.Color(0x222222),
};

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

type ColorPreset = { dawn: THREE.Color; noon: THREE.Color; dusk: THREE.Color; night: THREE.Color };

function lerpColorCycle(colors: ColorPreset, t: number, target: THREE.Color): THREE.Color {
  if (t < 0.25) {
    const f = t / 0.25;
    _c1.copy(colors.dawn);
    _c2.copy(colors.noon);
    target.copy(_c1).lerp(_c2, f);
  } else if (t < 0.5) {
    const f = (t - 0.25) / 0.25;
    _c1.copy(colors.noon);
    _c2.copy(colors.dusk);
    target.copy(_c1).lerp(_c2, f);
  } else if (t < 0.75) {
    const f = (t - 0.5) / 0.25;
    _c1.copy(colors.dusk);
    _c2.copy(colors.night);
    target.copy(_c1).lerp(_c2, f);
  } else {
    const f = (t - 0.75) / 0.25;
    _c1.copy(colors.night);
    _c2.copy(colors.dawn);
    target.copy(_c1).lerp(_c2, f);
  }
  return target;
}

function getDaylight(t: number): number {
  return Math.max(0, Math.cos((t - 0.25) * Math.PI * 2) * 0.5 + 0.5);
}

export interface DayNightRefs {
  sun: React.RefObject<THREE.DirectionalLight | null>;
  hemisphere: React.RefObject<THREE.HemisphereLight | null>;
  fill: React.RefObject<THREE.DirectionalLight | null>;
  ambient: React.RefObject<THREE.AmbientLight | null>;
  villageLights: React.RefObject<THREE.PointLight[]>;
}

const UPDATE_INTERVAL = 1 / 15;

export function useDayNight(refs: DayNightRefs) {
  const { scene } = useThree();
  const timeRef = useRef(CYCLE_DURATION * 0.05);
  const accRef = useRef(0);
  const tempColor = useRef(new THREE.Color());
  const daylightRef = useRef(1);

  useFrame((_, delta) => {
    if (!useAnimationStore.getState().dayNightEnabled) return;

    timeRef.current += delta;
    accRef.current += delta;
    if (accRef.current < UPDATE_INTERVAL) return;
    accRef.current = 0;

    const t = (timeRef.current % CYCLE_DURATION) / CYCLE_DURATION;
    const daylight = getDaylight(t);
    daylightRef.current = daylight;
    const tc = tempColor.current;

    // Sun
    const sun = refs.sun.current;
    if (sun) {
      const angle = t * Math.PI * 2;
      const sunRadius = 14;
      const sunHeight = Math.sin(angle) * 10 + 4;
      sun.position.set(
        Math.cos(angle) * sunRadius,
        Math.max(1, sunHeight),
        Math.sin(angle) * sunRadius * 0.5,
      );
      sun.intensity = Math.max(0, Math.sin(angle)) * 1.2 + 0.1;
      lerpColorCycle(SUN_COLORS, t, tc);
      sun.color.copy(tc);
    }

    // Hemisphere
    const hemi = refs.hemisphere.current;
    if (hemi) {
      lerpColorCycle(HEMI_SKY, t, tc);
      hemi.color.copy(tc);
      lerpColorCycle(HEMI_GROUND, t, tc);
      hemi.groundColor.copy(tc);
      hemi.intensity = 0.3 + daylight * 0.4;
    }

    // Ambient
    const ambient = refs.ambient.current;
    if (ambient) {
      ambient.intensity = 0.15 + (1 - daylight) * 0.25;
    }

    // Fill
    const fill = refs.fill.current;
    if (fill) {
      fill.intensity = daylight * 0.3;
    }

    // Sky background
    lerpColorCycle(SKY_COLORS, t, tc);
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(tc);
    }

    // Fog
    if (scene.fog instanceof THREE.Fog) {
      lerpColorCycle(FOG_COLORS, t, tc);
      scene.fog.color.copy(tc);
    }

    // Village lights
    const nightness = 1 - daylight;
    const lightIntensity = Math.max(0, Math.min(1, (nightness - 0.3) / 0.4)) * 1.5;
    const lights = refs.villageLights.current;
    if (lights) {
      for (const light of lights) {
        light.intensity = lightIntensity;
      }
    }
  });

  return daylightRef;
}
