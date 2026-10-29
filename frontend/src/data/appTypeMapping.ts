/**
 * Maps Clever Cloud app types and addon providers to medieval building asset IDs.
 * All defaults use the blue colour variant; the inspector can swap colours later.
 */

type Kind = 'app' | 'addon';

/** CC `type` field on applications → building asset id. */
const APP_TYPE_TO_ASSET: Record<string, string> = {
  // Node
  node: 'building_home_A_blue',
  'node-lts': 'building_home_A_blue',
  // PHP
  php: 'building_home_B_blue',
  // Python
  python: 'building_shrine_blue',
  // Ruby
  ruby: 'building_tavern_blue',
  // Java family → forge
  java: 'building_blacksmith_blue',
  'java-war': 'building_blacksmith_blue',
  'java-jar': 'building_blacksmith_blue',
  maven: 'building_blacksmith_blue',
  gradle: 'building_blacksmith_blue',
  scala: 'building_blacksmith_blue',
  sbt: 'building_blacksmith_blue',
  // Compiled natives → watchtower
  rust: 'building_watchtower_blue',
  go: 'building_watchtower_blue',
  // Containers → castle
  docker: 'building_castle_blue',
  // Static → market
  'static-apache': 'building_market_blue',
  static: 'building_market_blue',
  // Functional
  elixir: 'building_church_blue',
  erlang: 'building_church_blue',
  // .NET
  dotnet: 'building_townhall_blue',
  // Misc
  haskell: 'building_workshop_blue',
};

const APP_DEFAULT_ASSET = 'building_tent_blue';

/** CC addon `provider.id` (slug) → building asset id. */
const ADDON_PROVIDER_TO_ASSET: Record<string, string> = {
  'postgresql-addon': 'building_watermill_blue',
  'mysql-addon': 'building_watermill_blue',
  'mongodb-addon': 'building_watermill_blue',
  'redis-addon': 'building_tower_A_blue',
  'es-addon': 'building_tower_B_blue',
  jenkins: 'building_stables_blue',
  'fs-bucket': 'building_docks_blue',
  'cellar-addon': 'building_docks_blue',
  pulsar: 'building_lumbermill_blue',
  kafka: 'building_lumbermill_blue',
  'addon-pulsar': 'building_lumbermill_blue',
  mailpace: 'building_shipyard_blue',
  'config-provider': 'building_well_blue',
  metabase: 'building_townhall_blue',
  matomo: 'building_townhall_blue',
  keycloak: 'building_tower_cannon_blue',
  heptapod: 'building_workshop_blue',
};

const ADDON_DEFAULT_ASSET = 'building_mine_blue';

export function autoAssetFor(kind: Kind, type: string | null | undefined): string {
  const key = (type ?? '').toLowerCase();
  if (kind === 'app') return APP_TYPE_TO_ASSET[key] ?? APP_DEFAULT_ASSET;
  return ADDON_PROVIDER_TO_ASSET[key] ?? ADDON_DEFAULT_ASSET;
}

/** Default grass tile used when we auto-drop a building on an empty hex. */
export const DEFAULT_BASE_TILE = 'hex_grass';
