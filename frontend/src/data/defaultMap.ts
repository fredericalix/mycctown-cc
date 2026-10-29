import type { HexCell } from '../types/map';

/**
 * "L'Île du Royaume" — Default showcase map.
 *
 * 7-ring island with medieval village, meandering river from NW hills
 * to the eastern sea, bridge on the main road, castle on a hill, windmill,
 * watermill, forests, docks, and coastline.
 *
 * Pointy-top hex grid: x = 2q + r, z = sqrt(3) * r
 * Neighbor directions:
 *   dir 0: (q+1, r)   → right       (flat edge)
 *   dir 1: (q, r+1)   → lower-right
 *   dir 2: (q-1, r+1) → lower-left
 *   dir 3: (q-1, r)   → left        (flat edge)
 *   dir 4: (q, r-1)   → upper-left
 *   dir 5: (q+1, r-1) → upper-right
 *
 * River flow: source at (-3,-1) sloped hill, stream curves NE/E along
 * northern outskirts, detours east around the castle hill, returns west
 * through the watermill at (3,0), crosses the bridge at (3,1), empties
 * into the bay at (3,2).
 */
export const DEFAULT_MAP: HexCell[] = [

  // ============================================================
  // RING 0 — Town Square
  // ============================================================
  {
    q: 0, r: 0, tile: 'hex_road_D', rotation: 0,
    building: 'building_townhall_blue', buildingRotation: 0,
  },

  // ============================================================
  // RING 1 — Village Core (roads + key buildings, mixed colors)
  // ============================================================
  {
    q: 1, r: 0, tile: 'hex_road_A', rotation: 0,
    building: 'building_market_green', buildingRotation: 0,
    decorations: [
      { id: 'barrel', dx: 0.45, dz: 0.3 },
      { id: 'crate_A_big', dx: -0.4, dz: 0.4 },
    ],
  },
  {
    q: 0, r: 1, tile: 'hex_road_A', rotation: 1,
    building: 'building_tavern_red', buildingRotation: 1,
    decorations: [{ id: 'barrel', dx: 0.35, dz: -0.3 }],
  },
  {
    q: -1, r: 1, tile: 'hex_grass',
    building: 'building_home_B_green', buildingRotation: 2,
  },
  {
    q: -1, r: 0, tile: 'hex_road_A', rotation: 0,
    building: 'building_well_blue', buildingRotation: 0,
  },
  {
    q: 0, r: -1, tile: 'hex_road_A', rotation: 1,
    building: 'building_home_A_blue', buildingRotation: 4,
    decorations: [{ id: 'bucket_water', dx: 0.4, dz: 0.2 }],
  },
  {
    q: 1, r: -1, tile: 'hex_grass',
    building: 'building_home_B_blue', buildingRotation: 5,
  },

  // ============================================================
  // RING 2 — Inner Village (homes, church, forge, workshop)
  // ============================================================
  {
    q: 2, r: 0, tile: 'hex_road_A', rotation: 0,
    building: 'building_church_blue', buildingRotation: 0,
    decorations: [
      { id: 'tree_single_A', dx: 0.5, dz: 0.4 },
      { id: 'crate_A_small', dx: 0.4, dz: -0.35 },
    ],
  },
  {
    q: 2, r: -1, tile: 'hex_grass',
    building: 'building_home_A_green', buildingRotation: 5,
    decorations: [{ id: 'trough', dx: -0.4, dz: 0.3 }],
  },
  {
    q: 2, r: -2, tile: 'hex_grass',
    building: 'building_stables_blue', buildingRotation: 5,
  },
  {
    q: 1, r: -2, tile: 'hex_grass',
    decorations: [
      { id: 'tree_single_B', dx: 0.3, dz: 0.2 },
      { id: 'rock_single_A', dx: -0.3, dz: -0.2 },
    ],
  },
  {
    q: 0, r: -2, tile: 'hex_road_A', rotation: 1,
    building: 'building_blacksmith_red', buildingRotation: 3,
    decorations: [{ id: 'crate_B_small', dx: 0.45, dz: -0.2 }],
  },
  {
    q: -1, r: -1, tile: 'hex_grass',
    building: 'building_home_A_blue', buildingRotation: 3,
  },
  {
    q: -2, r: 0, tile: 'hex_road_A', rotation: 0,
    decorations: [{ id: 'haybale', dx: 0.3, dz: 0.4 }],
  },
  {
    q: -2, r: 1, tile: 'hex_grass',
    building: 'building_home_A_red', buildingRotation: 2,
    decorations: [{ id: 'bucket_water', dx: -0.4, dz: -0.3 }],
  },
  {
    q: -2, r: 2, tile: 'hex_grass',
    decorations: [
      { id: 'trees_A_small', dx: 0.1, dz: 0.1 },
    ],
  },
  {
    q: -1, r: 2, tile: 'hex_grass',
    building: 'building_home_B_red', buildingRotation: 2,
  },
  {
    q: 0, r: 2, tile: 'hex_road_A', rotation: 1,
    building: 'building_home_A_blue', buildingRotation: 1,
  },
  {
    q: 1, r: 1, tile: 'hex_grass',
    building: 'building_workshop_green', buildingRotation: 1,
    decorations: [{ id: 'wheelbarrow', dx: 0.5, dz: 0.1 }],
  },

  // ============================================================
  // RING 3 — Village Edge (windmill, barracks, castle, nature)
  // ============================================================

  // West — Windmill & fields
  {
    q: -3, r: 0, tile: 'hex_road_M', rotation: 0,
    decorations: [{ id: 'tree_single_A', dx: 0.4, dz: -0.4 }],
  },
  {
    q: -3, r: 1, tile: 'hex_grass',
    building: 'building_windmill_blue', buildingRotation: 2,
    decorations: [
      { id: 'haybale', dx: 0.5, dz: 0.4 },
      { id: 'haybale', dx: 0.3, dz: 0.65, rotation: 1 },
    ],
  },
  {
    q: -3, r: 2, tile: 'hex_grass',
    decorations: [{ id: 'haybale', dx: 0, dz: 0 }],
  },
  {
    q: -3, r: 3, tile: 'hex_grass',
    decorations: [{ id: 'trees_B_medium', dx: 0, dz: 0 }],
  },

  // Northwest — Forest (around river source)
  {
    q: -2, r: -1, tile: 'hex_grass',
    decorations: [{ id: 'trees_A_medium', dx: 0.1, dz: 0.1 }],
  },
  {
    q: -1, r: -2, tile: 'hex_grass',
    building: 'building_archeryrange_green', buildingRotation: 3,
  },

  // North — Barracks area
  {
    q: 0, r: -3, tile: 'hex_grass',
    building: 'building_barracks_blue', buildingRotation: 4,
    decorations: [{ id: 'weaponrack', dx: 0.5, dz: 0.3 }],
  },
  {
    q: 1, r: -3, tile: 'hex_grass',
    building: 'building_tower_A_blue', buildingRotation: 5,
    decorations: [{ id: 'target', dx: 0.5, dz: -0.2 }],
  },

  // Northeast — Castle on hill
  {
    q: 2, r: -3, tile: 'hex_grass_sloped_low', elevation: 0.15,
    building: 'building_watchtower_blue', buildingRotation: 5,
  },
  {
    q: 3, r: -3, tile: 'hex_grass_sloped_high', elevation: 0.3,
    building: 'building_castle_blue', buildingRotation: 0,
    decorations: [{ id: 'flag_blue', dx: 0.5, dz: -0.3 }],
  },
  {
    q: 3, r: -2, tile: 'hex_grass_sloped_low', elevation: 0.15,
    building: 'wall_straight', buildingRotation: 1,
    decorations: [{ id: 'flag_blue', dx: -0.3, dz: -0.3 }],
  },
  {
    q: 3, r: -1, tile: 'hex_grass',
    building: 'wall_corner_A_outside', buildingRotation: 1,
  },

  // East — Watermill on river (end of main river, feeds into bay)
  {
    q: 3, r: 0, tile: 'hex_river_A', rotation: 1,
    building: 'building_watermill_blue', buildingRotation: 0,
    decorations: [{ id: 'waterplant_A', dx: -0.35, dz: 0.5 }],
  },

  // Southeast — path approach to bridge + scattered nature
  {
    q: 2, r: 1, tile: 'hex_road_B', rotation: 5,
    decorations: [{ id: 'tree_single_A', dx: 0.4, dz: -0.35 }],
  },
  {
    q: 1, r: 2, tile: 'hex_grass',
    decorations: [{ id: 'trees_A_small', dx: 0, dz: 0 }],
  },
  {
    q: -2, r: 3, tile: 'hex_grass',
    decorations: [{ id: 'tree_single_A', dx: 0.1, dz: -0.1 }],
  },
  {
    q: -1, r: 3, tile: 'hex_grass',
    building: 'building_home_B_green', buildingRotation: 2,
  },

  // South — Port area
  {
    q: 0, r: 3, tile: 'hex_road_A', rotation: 1,
    building: 'building_docks_blue', buildingRotation: 1,
    decorations: [{ id: 'anchor', dx: -0.3, dz: 0.4 }],
  },

  // ============================================================
  // RING 4 — Nature, river corridor, port fringe
  // ============================================================

  // --- River corridor (from NW source through N outskirts) ---
  // Source hill (NW): small slope, hills/trees decoration
  {
    q: -3, r: -1, tile: 'hex_grass_sloped_high', elevation: 0.15,
    decorations: [
      { id: 'hills_A_trees', dx: 0, dz: 0 },
      { id: 'tree_single_B', dx: 0.55, dz: 0.3 },
    ],
  },
  // Stream emerges, curves eastward
  {
    q: -2, r: -2, tile: 'hex_river_A_curvy', rotation: 2,
    decorations: [{ id: 'waterplant_B', dx: 0.25, dz: -0.2 }],
  },
  {
    q: -1, r: -3, tile: 'hex_river_B', rotation: 2,
  },
  {
    q: 0, r: -4, tile: 'hex_river_C', rotation: 3,
    decorations: [{ id: 'waterlily_A', dx: -0.15, dz: 0.1 }],
  },
  {
    q: 1, r: -4, tile: 'hex_river_A', rotation: 2,
  },
  {
    q: 2, r: -4, tile: 'hex_river_A', rotation: 0,
    decorations: [{ id: 'waterplant_C', dx: 0.25, dz: 0.2 }],
  },
  {
    q: 3, r: -4, tile: 'hex_river_B', rotation: 3,
  },
  {
    q: 4, r: -4, tile: 'hex_river_C', rotation: 4,
    decorations: [{ id: 'waterlily_B', dx: 0.15, dz: -0.1 }],
  },
  {
    q: 4, r: -3, tile: 'hex_river_A', rotation: 0,
  },
  {
    q: 4, r: -2, tile: 'hex_river_A', rotation: 1,
    decorations: [{ id: 'waterplant_A', dx: -0.2, dz: -0.25 }],
  },
  {
    q: 4, r: -1, tile: 'hex_river_C', rotation: 5,
  },

  // --- Bridge (on path from village southeast to quay) ---
  {
    q: 3, r: 1, tile: 'hex_river_A', rotation: 1,
    building: 'building_bridge_A', buildingRotation: 0,
  },

  // --- Other ring-4 nature cells ---
  { q: 4, r: 0, tile: 'hex_grass' },
  {
    q: -4, r: 0, tile: 'hex_grass',
    decorations: [{ id: 'trees_B_small', dx: 0, dz: 0 }],
  },
  {
    q: -4, r: 1, tile: 'hex_grass',
    decorations: [{ id: 'rock_single_C', dx: 0.2, dz: 0.1 }],
  },
  {
    q: -4, r: 2, tile: 'hex_grass',
    decorations: [{ id: 'trees_A_medium', dx: 0, dz: 0 }],
  },
  // Second small hill on west side (relief doux)
  {
    q: -4, r: 3, tile: 'hex_grass',
    decorations: [{ id: 'hills_B_trees', dx: 0, dz: 0 }],
  },
  {
    q: -4, r: 4, tile: 'hex_grass',
    decorations: [{ id: 'trees_A_large', dx: 0, dz: 0 }],
  },
  {
    q: -3, r: 4, tile: 'hex_grass',
    decorations: [{ id: 'trees_A_medium', dx: 0, dz: 0 }],
  },
  {
    q: -2, r: 4, tile: 'hex_grass',
    decorations: [{ id: 'trees_B_medium', dx: 0, dz: 0 }],
  },
  {
    q: -1, r: 4, tile: 'hex_grass',
    decorations: [{ id: 'rock_single_B', dx: 0, dz: 0 }],
  },
  {
    q: 0, r: 4, tile: 'hex_grass',
    decorations: [{ id: 'trees_A_small', dx: 0, dz: 0 }],
  },
  {
    q: 1, r: 4, tile: 'hex_grass',
    decorations: [{ id: 'tree_single_A', dx: 0, dz: 0 }],
  },
  {
    q: 2, r: 3, tile: 'hex_grass',
    decorations: [{ id: 'boat', dx: 0, dz: 0.3, rotation: 2 }],
  },
  {
    q: 1, r: 3, tile: 'hex_grass',
    building: 'building_shipyard_blue', buildingRotation: 1,
  },
  {
    q: 2, r: 2, tile: 'hex_grass',
    decorations: [{ id: 'rock_single_B', dx: 0, dz: 0 }],
  },

  // ============================================================
  // RING 5 — Coastline
  // ============================================================

  // North coast
  { q: -3, r: -2, tile: 'hex_coast_A', rotation: 4 },
  { q: -2, r: -3, tile: 'hex_coast_A', rotation: 4 },
  { q: -1, r: -4, tile: 'hex_coast_A', rotation: 5 },
  { q: 0, r: -5, tile: 'hex_coast_A', rotation: 5 },
  { q: 1, r: -5, tile: 'hex_coast_A', rotation: 5 },
  { q: 2, r: -5, tile: 'hex_coast_A', rotation: 0 },
  { q: 3, r: -5, tile: 'hex_coast_B', rotation: 0 },
  { q: 4, r: -5, tile: 'hex_coast_A', rotation: 0 },

  // East coast
  { q: 5, r: -5, tile: 'hex_coast_A', rotation: 1 },
  { q: 5, r: -4, tile: 'hex_coast_A', rotation: 1 },
  { q: 5, r: -3, tile: 'hex_coast_A', rotation: 1 },
  { q: 5, r: -2, tile: 'hex_coast_A', rotation: 1 },
  { q: 5, r: -1, tile: 'hex_coast_A', rotation: 2 },
  { q: 5, r: 0, tile: 'hex_coast_A', rotation: 2 },
  { q: 4, r: 1, tile: 'hex_coast_A', rotation: 2 },

  // South coast
  // Bay just south of the bridge — river empties here into open water
  {
    q: 3, r: 2, tile: 'hex_water',
    decorations: [{ id: 'waterplant_B', dx: 0.2, dz: -0.3 }],
  },
  {
    q: 3, r: 4, tile: 'hex_coast_A', rotation: 2,
    decorations: [{ id: 'waterlily_B', dx: 0.2, dz: 0.3 }],
  },
  { q: 2, r: 4, tile: 'hex_coast_A', rotation: 3 },
  { q: 1, r: 5, tile: 'hex_coast_A', rotation: 3 },
  {
    q: 0, r: 5, tile: 'hex_coast_B', rotation: 3,
    decorations: [{ id: 'boat', dx: 0, dz: 0.3, rotation: 4 }],
  },
  { q: -1, r: 5, tile: 'hex_coast_A', rotation: 3 },
  { q: -2, r: 5, tile: 'hex_coast_A', rotation: 3 },
  { q: -3, r: 5, tile: 'hex_coast_A', rotation: 4 },

  // West coast
  { q: -4, r: 5, tile: 'hex_coast_A', rotation: 4 },
  { q: -5, r: 5, tile: 'hex_coast_A', rotation: 4 },
  { q: -5, r: 4, tile: 'hex_coast_A', rotation: 5 },
  { q: -5, r: 3, tile: 'hex_coast_A', rotation: 5 },
  { q: -5, r: 2, tile: 'hex_coast_A', rotation: 5 },
  { q: -5, r: 1, tile: 'hex_coast_A', rotation: 0 },
  { q: -5, r: 0, tile: 'hex_coast_A', rotation: 0 },
  { q: -4, r: -1, tile: 'hex_coast_A', rotation: 0 },

  // ============================================================
  // RING 6 — Outer water (a few decorations, all 36 cells filled)
  // ============================================================
  { q: -4, r: -2, tile: 'hex_water' },
  { q: -3, r: -3, tile: 'hex_water' },
  { q: -2, r: -4, tile: 'hex_water' },
  { q: -1, r: -5, tile: 'hex_water' },
  { q: 0, r: -6, tile: 'hex_water' },
  { q: 1, r: -6, tile: 'hex_water' },
  { q: 2, r: -6, tile: 'hex_water' },
  { q: 3, r: -6, tile: 'hex_water' },
  { q: 4, r: -6, tile: 'hex_water' },
  { q: 5, r: -6, tile: 'hex_water' },
  { q: 6, r: -6, tile: 'hex_water' },
  { q: 6, r: -5, tile: 'hex_water' },
  { q: 6, r: -4, tile: 'hex_water' },
  { q: 6, r: -3, tile: 'hex_water' },
  { q: 6, r: -2, tile: 'hex_water' },
  { q: 6, r: -1, tile: 'hex_water' },
  // Fix hole: (6,0) was missing
  { q: 6, r: 0, tile: 'hex_water' },
  { q: 5, r: 1, tile: 'hex_water' },
  { q: 4, r: 2, tile: 'hex_water' },
  {
    q: 3, r: 3, tile: 'hex_water',
    decorations: [{ id: 'waterlily_A', dx: -0.2, dz: 0.2 }],
  },
  { q: 4, r: 3, tile: 'hex_water' },
  {
    q: 2, r: 5, tile: 'hex_water',
    decorations: [{ id: 'ship_blue_full', dx: 0, dz: 0, rotation: 3 }],
  },
  { q: 1, r: 6, tile: 'hex_water' },
  { q: 0, r: 6, tile: 'hex_water' },
  {
    q: -1, r: 6, tile: 'hex_water',
    decorations: [{ id: 'waterlily_A', dx: 0.3, dz: 0 }],
  },
  { q: -2, r: 6, tile: 'hex_water' },
  { q: -3, r: 6, tile: 'hex_water' },
  { q: -4, r: 6, tile: 'hex_water' },
  { q: -5, r: 6, tile: 'hex_water' },
  { q: -6, r: 6, tile: 'hex_water' },
  { q: -6, r: 5, tile: 'hex_water' },
  { q: -6, r: 4, tile: 'hex_water' },
  { q: -6, r: 3, tile: 'hex_water' },
  { q: -6, r: 2, tile: 'hex_water' },
  { q: -6, r: 1, tile: 'hex_water' },
  { q: -6, r: 0, tile: 'hex_water' },
  { q: -5, r: -1, tile: 'hex_water' },

  // ============================================================
  // RING 7 — Deep water
  // ============================================================
  { q: -5, r: -2, tile: 'hex_water' },
  { q: -4, r: -3, tile: 'hex_water' },
  { q: -3, r: -4, tile: 'hex_water' },
  { q: -2, r: -5, tile: 'hex_water' },
  { q: -1, r: -6, tile: 'hex_water' },
  { q: 0, r: -7, tile: 'hex_water' },
  { q: 1, r: -7, tile: 'hex_water' },
  { q: 2, r: -7, tile: 'hex_water' },
  { q: 3, r: -7, tile: 'hex_water' },
  { q: 4, r: -7, tile: 'hex_water' },
  { q: 5, r: -7, tile: 'hex_water' },
  { q: 6, r: -7, tile: 'hex_water' },
  { q: 7, r: -7, tile: 'hex_water' },
  { q: 7, r: -6, tile: 'hex_water' },
  { q: 7, r: -5, tile: 'hex_water' },
  { q: 7, r: -4, tile: 'hex_water' },
  { q: 7, r: -3, tile: 'hex_water' },
  { q: 7, r: -2, tile: 'hex_water' },
  { q: 7, r: -1, tile: 'hex_water' },
  { q: 7, r: 0, tile: 'hex_water' },
  { q: 6, r: 1, tile: 'hex_water' },
  { q: 5, r: 2, tile: 'hex_water' },
  { q: 4, r: 4, tile: 'hex_water' },
  { q: 3, r: 5, tile: 'hex_water' },
  { q: 2, r: 6, tile: 'hex_water' },
  { q: 1, r: 7, tile: 'hex_water' },
  { q: 0, r: 7, tile: 'hex_water' },
  { q: -1, r: 7, tile: 'hex_water' },
  { q: -2, r: 7, tile: 'hex_water' },
  { q: -3, r: 7, tile: 'hex_water' },
  { q: -4, r: 7, tile: 'hex_water' },
  { q: -5, r: 7, tile: 'hex_water' },
  { q: -6, r: 7, tile: 'hex_water' },
  { q: -7, r: 7, tile: 'hex_water' },
  { q: -7, r: 6, tile: 'hex_water' },
  { q: -7, r: 5, tile: 'hex_water' },
  { q: -7, r: 4, tile: 'hex_water' },
  { q: -7, r: 3, tile: 'hex_water' },
  { q: -7, r: 2, tile: 'hex_water' },
  { q: -7, r: 1, tile: 'hex_water' },
  { q: -7, r: 0, tile: 'hex_water' },
  { q: -6, r: -1, tile: 'hex_water' },
];
