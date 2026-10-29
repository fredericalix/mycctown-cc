use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MapRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub cc_org_id: String,
    pub name: String,
    pub cells_json: serde_json::Value,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_or_create(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<MapRow, sqlx::Error> {
    if let Some(row) = sqlx::query_as::<_, MapRow>(
        "SELECT * FROM maps WHERE user_id = $1 AND cc_org_id = $2",
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_optional(pool)
    .await?
    {
        return Ok(row);
    }

    sqlx::query_as::<_, MapRow>(
        r#"
        INSERT INTO maps (user_id, cc_org_id, name, cells_json)
        VALUES ($1, $2, 'My City', '[]'::jsonb)
        ON CONFLICT (user_id, cc_org_id) DO UPDATE SET updated_at = maps.updated_at
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_one(pool)
    .await
}

/// Upsert a map's cells in one statement. Increments `version` on update.
pub async fn upsert_cells(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    name: &str,
    cells_json: &serde_json::Value,
) -> Result<MapRow, sqlx::Error> {
    sqlx::query_as::<_, MapRow>(
        r#"
        INSERT INTO maps (user_id, cc_org_id, name, cells_json)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, cc_org_id) DO UPDATE SET
            name = EXCLUDED.name,
            cells_json = EXCLUDED.cells_json,
            version = maps.version + 1,
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(name)
    .bind(cells_json)
    .fetch_one(pool)
    .await
}

/// Read the map's `cells_json` and return the set of `appId`s and `addonId`s
/// bound to a building. Used by the WS poller to know which CC resources it
/// needs to poll state / metrics for.
pub async fn mapped_resource_ids(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<(HashSet<String>, HashSet<String>), sqlx::Error> {
    let cells_json: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT cells_json FROM maps WHERE user_id = $1 AND cc_org_id = $2",
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_optional(pool)
    .await?;

    let mut apps = HashSet::new();
    let mut addons = HashSet::new();
    let Some(serde_json::Value::Array(cells)) = cells_json else {
        return Ok((apps, addons));
    };
    for cell in cells {
        let building_present = cell
            .get("building")
            .map(|v| !v.is_null())
            .unwrap_or(false);
        if !building_present {
            continue;
        }
        if let Some(app_id) = cell.get("appId").and_then(|v| v.as_str()) {
            apps.insert(app_id.to_string());
            continue;
        }
        if let Some(addon_id) = cell.get("addonId").and_then(|v| v.as_str()) {
            addons.insert(addon_id.to_string());
        }
    }
    Ok((apps, addons))
}

/// Does the user have a saved map for this org? Used as the access check for
/// the WebSocket upgrade — it's a cheap proxy for "this user has opened this
/// org at least once via /api/orgs/:id/map".
pub async fn user_has_map(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<bool, sqlx::Error> {
    let row: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM maps WHERE user_id = $1 AND cc_org_id = $2 LIMIT 1")
            .bind(user_id)
            .bind(cc_org_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}
