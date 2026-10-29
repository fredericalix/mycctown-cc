-- The denormalised asset_mappings table duplicated information already present
-- in maps.cells_json (each HexCell carries appId/addonId fields). Keeping both
-- in sync required a two-step transaction on every PUT and opened a window
-- where the two views could diverge if the tx was interrupted. The poller
-- now parses maps.cells_json directly, so this table is obsolete.

DROP TABLE IF EXISTS asset_mappings;
