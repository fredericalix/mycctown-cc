use crate::auth::middleware::AuthUser;
use crate::db::{maps, webhook_configs};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_http::limit::RequestBodyLimitLayer;

/// 512 KB is plenty for a medieval-sized hex map — maps we've seen in practice
/// sit well under 50 KB. Anything beyond this is either a runaway client bug
/// or an attacker trying to OOM the backend via `PUT /map`.
const MAP_PAYLOAD_LIMIT: usize = 512 * 1024;

/// CC resource ids (`app_<uuid>`, `addon_<uuid>`) and building asset ids are
/// always alphanumeric + dashes/underscores. Anything outside this set is a
/// suspicious injection attempt — notably the Warp10 poller interpolates
/// `appId`s into a WarpScript template, and `building` values are used as
/// GLTF asset paths on the frontend.
fn is_safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/orgs/{org_id}/map", get(get_map).put(put_map))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(MAP_PAYLOAD_LIMIT))
}

#[derive(Debug, Serialize)]
pub struct MapResponse {
    pub name: String,
    pub cells: serde_json::Value,
    pub version: i32,
}

#[derive(Debug, Deserialize)]
pub struct MapPayload {
    #[serde(default = "default_name")]
    pub name: String,
    pub cells: serde_json::Value,
}

fn default_name() -> String {
    "My City".to_string()
}

async fn get_map(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<MapResponse>, AppError> {
    let row = maps::get_or_create(&state.db, user.id, &org_id).await?;

    // Lazily provision a webhook token for this (user, org). No CC API call
    // here — the admin of the CC org configures the hook manually against
    // the URL exposed by `GET /api/orgs/:id/webhook-setup`. Cheap insert +
    // ON CONFLICT, so safe to call on every map fetch.
    if state.config.use_webhooks {
        if let Err(e) = webhook_configs::insert_if_absent(&state.db, user.id, &org_id).await {
            tracing::warn!("webhook_configs provisioning failed: {e}");
        }
    }

    Ok(Json(MapResponse {
        name: row.name,
        cells: row.cells_json,
        version: row.version,
    }))
}

async fn put_map(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(org_id): Path<String>,
    Json(payload): Json<MapPayload>,
) -> Result<Json<MapResponse>, AppError> {
    let cells = payload
        .cells
        .as_array()
        .ok_or_else(|| AppError::BadRequest("cells must be a JSON array".into()))?;

    for cell in cells {
        for field in ["appId", "addonId"] {
            if let Some(id) = cell.get(field).and_then(|v| v.as_str()) {
                if !is_safe_id(id) {
                    return Err(AppError::BadRequest(format!(
                        "invalid {field}: must match ^[A-Za-z0-9_-]+$"
                    )));
                }
            }
        }
        if let Some(building) = cell.get("building").and_then(|v| v.as_str()) {
            if !is_safe_id(building) {
                return Err(AppError::BadRequest(
                    "invalid building asset id: must match ^[A-Za-z0-9_-]+$".into(),
                ));
            }
        }
    }

    let row =
        maps::upsert_cells(&state.db, user.id, &org_id, &payload.name, &payload.cells).await?;
    Ok(Json(MapResponse {
        name: row.name,
        cells: row.cells_json,
        version: row.version,
    }))
}
