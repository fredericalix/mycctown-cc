import type { ResourceStatus } from '../types/ws';
import {
  BUILDING_COLORS,
  buildingId,
  parseBuildingId,
  type BuildingColor,
} from '../data/buildingSkins';

/**
 * Status → asset variant mapping.
 *
 * The KayKit Medieval Hexagon Pack ships colored copies of every building
 * (blue/green/red/yellow) — swapping the whole GLTF at status change is
 * visually richer than tinting a shared material (distinct textures, baked
 * lighting variations) and keeps the art style consistent. For `created`
 * and `stopped` we override with `building_stage_B` (scaffolding) to
 * communicate "not in production" regardless of the building type.
 *
 *   running    → _green
 *   deploying  → _blue
 *   failed     → _red
 *   warning    → _red   (app up but linked addon unhealthy)
 *   unknown    → _yellow
 *   stopped    → building_stage_B  (always, overrides color)
 *   created    → building_stage_B  (always, overrides color)
 *
 * Buildings without a color variant (bridges, stage_A/C, destroyed, dirt,
 * grain, scaffolding) stay visually unchanged for every status EXCEPT
 * `created`/`stopped` where we still swap to building_stage_B.
 */

const STATUS_COLOR: Partial<Record<ResourceStatus, BuildingColor>> = {
  running: 'green',
  deploying: 'blue',
  failed: 'red',
  warning: 'red',
  unknown: 'yellow',
};

const STAGE_B = 'building_stage_B';

export function assetIdForStatus(
  baseAssetId: string,
  status: ResourceStatus,
): string {
  // Under-construction states force the scaffolding building.
  if (status === 'created' || status === 'stopped') return STAGE_B;

  const parsed = parseBuildingId(baseAssetId);
  const targetColor = STATUS_COLOR[status];
  // Not a colored building (e.g. bridge, stage_A) or status has no color
  // mapping → keep the authored asset as-is.
  if (!parsed || !targetColor) return baseAssetId;

  return buildingId(parsed.type, targetColor);
}

export { BUILDING_COLORS };
