use crate::api::cc_client::{CcAddon, CcApplication, CcClient, CcOrganisation};
use crate::auth::middleware::AuthUser;
use crate::db::webhook_configs;
use crate::error::AppError;
use crate::state::AppState;
use crate::webhooks::event::SUBSCRIBED_EVENTS;
use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/orgs", get(list_orgs))
        .route("/api/orgs/{org_id}/apps", get(list_apps))
        .route("/api/orgs/{org_id}/addons", get(list_addons))
        .route("/api/orgs/{org_id}/dependencies", get(list_dependencies))
        .route("/api/orgs/{org_id}/webhook-setup", get(webhook_setup))
}

async fn me(AuthUser(user): AuthUser) -> Json<crate::db::users::UserInfo> {
    Json(user.into())
}

async fn list_orgs(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<CcOrganisation>>, AppError> {
    let (token, secret) = auth
        .decrypt_cc_tokens(&state.config.encryption_key)
        .map_err(AppError::Internal)?;

    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let orgs_cc = client
        .list_organisations()
        .await
        .map_err(|e| AppError::CcApi(e.to_string()))?;

    Ok(Json(orgs_cc))
}

async fn list_apps(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<Vec<CcApplication>>, AppError> {
    let (token, secret) = auth
        .decrypt_cc_tokens(&state.config.encryption_key)
        .map_err(AppError::Internal)?;

    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let apps = client
        .list_applications(&org_id)
        .await
        .map_err(|e| AppError::CcApi(e.to_string()))?;
    Ok(Json(apps))
}

async fn list_addons(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<Vec<CcAddon>>, AppError> {
    let (token, secret) = auth
        .decrypt_cc_tokens(&state.config.encryption_key)
        .map_err(AppError::Internal)?;

    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let addons = client
        .list_addons(&org_id)
        .await
        .map_err(|e| AppError::CcApi(e.to_string()))?;
    Ok(Json(addons))
}

/// Everything a CC org admin needs to configure a notification webhook pointing
/// at this backend: the signed URL, the list of events to subscribe to, and a
/// shortcut to the CC console page. Token is provisioned lazily (on map fetch
/// when `USE_WEBHOOKS=true`), so this endpoint can only succeed once the user
/// has opened the map for that org at least once.
#[derive(Serialize)]
struct WebhookSetupResponse {
    /// Feature switched off in config — frontend should hide the setup panel.
    enabled: bool,
    /// The exact URL to paste in CC console → Notifications → Create webhook.
    url: Option<String>,
    /// The list of event types the admin should tick. Matches what the
    /// receiver knows how to parse.
    events: Vec<&'static str>,
    /// Deep-link to the CC org notifications page for convenience. For
    /// personal-owner ids (`user_*`) we point to the personal notifications
    /// page instead.
    console_url: String,
    /// Was the hook already registered through CC's API at some point? For
    /// now always false — we removed auto-registration. Kept so the frontend
    /// can show a "not configured yet" vs "configured" hint later.
    configured: bool,
}

async fn webhook_setup(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<WebhookSetupResponse>, AppError> {
    let enabled = state.config.use_webhooks && state.config.webhooks_public_url.is_some();
    if !enabled {
        return Ok(Json(WebhookSetupResponse {
            enabled: false,
            url: None,
            events: SUBSCRIBED_EVENTS.to_vec(),
            console_url: console_url(&org_id),
            configured: false,
        }));
    }

    // Make sure a token exists — this endpoint is the first place where it
    // matters. Keeps setup usable even if the user calls it before opening
    // the map (theoretically impossible today, but future-proof).
    let cfg = webhook_configs::find_by_user_org(&state.db, user.id, &org_id).await?;
    let cfg = match cfg {
        Some(c) => c,
        None => webhook_configs::insert_if_absent(&state.db, user.id, &org_id).await?,
    };

    let public = state
        .config
        .webhooks_public_url
        .as_deref()
        .expect("checked above");
    let url = format!("{}/webhooks/cc/{}", public.trim_end_matches('/'), cfg.token);

    Ok(Json(WebhookSetupResponse {
        enabled: true,
        url: Some(url),
        events: SUBSCRIBED_EVENTS.to_vec(),
        console_url: console_url(&org_id),
        configured: cfg.cc_webhook_id.is_some(),
    }))
}

fn console_url(org_id: &str) -> String {
    if org_id.starts_with("user_") {
        "https://console.clever-cloud.com/users/me/notifications".to_string()
    } else {
        format!(
            "https://console.clever-cloud.com/organisations/{org_id}/notifications"
        )
    }
}

/// For each app in the org, list the addon ids CC says are linked to it.
/// Returned shape: `{ "app_xxx": ["addon_yyy", "addon_zzz"], ... }`.
/// N+1 on CC's API (one /addons call per app) but N is typically small;
/// the frontend only fetches this once per org load.
async fn list_dependencies(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<std::collections::HashMap<String, Vec<String>>>, AppError> {
    let (token, secret) = auth
        .decrypt_cc_tokens(&state.config.encryption_key)
        .map_err(AppError::Internal)?;

    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let apps = client
        .list_applications(&org_id)
        .await
        .map_err(|e| AppError::CcApi(e.to_string()))?;

    let mut graph: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::with_capacity(apps.len());
    for app in apps {
        match client.list_linked_addons(&org_id, &app.id).await {
            Ok(addons) => {
                graph.insert(app.id, addons.into_iter().map(|a| a.id).collect());
            }
            Err(e) => {
                // Per-app failure: log and skip — one broken app shouldn't
                // prevent the whole graph from being returned.
                tracing::warn!(
                    "list_linked_addons failed for app {}: {}",
                    app.id,
                    e
                );
                graph.insert(app.id, Vec::new());
            }
        }
    }
    Ok(Json(graph))
}
