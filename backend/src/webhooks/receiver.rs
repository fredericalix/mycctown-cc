//! Entry point for CC webhook deliveries. Lives under `/webhooks/cc/:token`
//! outside the session middleware — CC itself authenticates via the opaque
//! token in the URL (there is no HMAC on CC webhooks as of 2026-04).

use crate::db::webhook_configs;
use crate::state::AppState;
use crate::webhooks::event::WebhookEnvelope;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
// (Instant is reused below to timestamp DEPLOYMENT_FAIL entries in AppState.)

/// Window during which a repeat of the same `(event, resource_id, date)`
/// is treated as a duplicate and dropped. CC occasionally sends two or three
/// `APPLICATION_REDEPLOY`s within a few hundred ms for the same action — we
/// want the 3D scene to update once, not three times.
const DEDUP_WINDOW: Duration = Duration::from_secs(60);

/// Maximum number of dedup entries. The key is small; capping prevents a
/// pathological flood from growing the map without bound.
const DEDUP_MAX_ENTRIES: usize = 10_000;

#[derive(Clone, Default)]
pub struct DedupCache(Arc<DashMap<String, Instant>>);

impl DedupCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if the key was inserted (i.e. not a duplicate). A return
    /// of false means "we've seen this recently — drop it".
    pub fn record(&self, key: String) -> bool {
        let now = Instant::now();
        // Lazy GC: on every ~1000th insertion, prune expired entries.
        if self.0.len() > DEDUP_MAX_ENTRIES {
            self.0.retain(|_, seen| now.duration_since(*seen) < DEDUP_WINDOW);
        }
        match self.0.get(&key) {
            Some(seen) if now.duration_since(*seen) < DEDUP_WINDOW => false,
            _ => {
                self.0.insert(key, now);
                true
            }
        }
    }
}

/// Handler for `POST /webhooks/cc/:token`.
///
/// Always returns `204` on "we processed it" and `401` only when the token is
/// unknown. Parse/validation failures still return `204` (with a warn log)
/// because CC treats non-2xx as a delivery failure and will retry; we prefer
/// to eat malformed payloads rather than get the same junk redelivered.
pub async fn handle(
    State(state): State<AppState>,
    Path(token): Path<String>,
    body: String,
) -> StatusCode {
    // 1. Auth: token → (user_id, cc_org_id). Short-circuit before parsing
    // so an invalid token never triggers expensive JSON work.
    let cfg = match webhook_configs::find_by_token(&state.db, &token).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            tracing::warn!("webhook POST with unknown token");
            return StatusCode::UNAUTHORIZED;
        }
        Err(e) => {
            tracing::error!("webhook token lookup failed: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    };

    // 2. Parse envelope. Anything malformed gets logged and dropped (204).
    let envelope: WebhookEnvelope = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(
                "webhook payload not valid JSON envelope: {e} — body={}",
                &body[..body.len().min(200)]
            );
            return StatusCode::NO_CONTENT;
        }
    };

    // 3. Dedup key before doing anything expensive (the channel lookup is
    // cheap but this also protects the log line volume).
    let dedup_key = format!(
        "{}|{}|{}|{}",
        envelope.event,
        envelope
            .application
            .as_ref()
            .map(|a| a.id.as_str())
            .unwrap_or_else(|| envelope
                .addon
                .as_ref()
                .map(|a| a.id.as_str())
                .unwrap_or("")),
        envelope
            .deployment
            .as_ref()
            .and_then(|d| d.id.as_deref())
            .unwrap_or(""),
        envelope.date.as_deref().unwrap_or(""),
    );
    if !state.webhook_dedup.record(dedup_key) {
        tracing::debug!("webhook duplicate dropped: {}", envelope.event);
        return StatusCode::NO_CONTENT;
    }

    // 4. Check the owner_id on the event matches the config's cc_org_id — we
    // don't want a webhook registered for org A to accept events about org B.
    let Some(routing) = envelope.routing() else {
        tracing::debug!("webhook event with no routable owner: {}", envelope.event);
        return StatusCode::NO_CONTENT;
    };
    if routing.owner_id != cfg.cc_org_id {
        tracing::warn!(
            "webhook event for owner {} arrived on config for {} — dropping",
            routing.owner_id,
            cfg.cc_org_id
        );
        return StatusCode::NO_CONTENT;
    }

    // 5. Map → WsFrame(s) and push on the OrgBus. If no subscribers are
    // connected right now there's no channel in the bus — we simply drop the
    // frames; the poller's resync tick catches the next WS client up within
    // ~60 s.
    let now = Utc::now().timestamp();
    let frames = envelope.to_frames(now);
    if frames.is_empty() {
        return StatusCode::NO_CONTENT;
    }

    // Track lifecycle state so the poller doesn't immediately overwrite the
    // webhook-driven view with CC's raw state (which lags reality: it keeps
    // the previous deployment marked "running"/"wanting to be up" until a
    // new DEPLOYMENT_SUCCESS lands). `failed_apps` keeps the red building
    // sticky; `deploying_apps` keeps the blue/scaffold building visible
    // throughout the build.
    match envelope.event.as_str() {
        "DEPLOYMENT_FAIL" => {
            state.failed_apps.insert(routing.resource_id.clone(), Instant::now());
            state.deploying_apps.remove(&routing.resource_id);
        }
        "APPLICATION_REDEPLOY" | "GIT_PUSH" => {
            state.failed_apps.remove(&routing.resource_id);
            state.deploying_apps.insert(routing.resource_id.clone(), Instant::now());
        }
        "DEPLOYMENT_SUCCESS"
        | "APPLICATION_STOP"
        | "APPLICATION_DELETION" => {
            state.failed_apps.remove(&routing.resource_id);
            state.deploying_apps.remove(&routing.resource_id);
        }
        "APPLICATION_CREATION" => {
            state.failed_apps.remove(&routing.resource_id);
            // Not deploying — emits CREATED, scaffold handled via stage_B.
        }
        _ => {}
    }

    let pushed = if let Some(channel) = state.ws_bus.get(&cfg.cc_org_id) {
        let mut n = 0;
        for frame in &frames {
            if channel.tx.send(frame.clone()).is_ok() {
                n += 1;
            }
        }
        n
    } else {
        0
    };

    tracing::info!(
        "webhook {} for org={} resource={} → pushed {}/{}",
        envelope.event,
        cfg.cc_org_id,
        routing.resource_id,
        pushed,
        frames.len()
    );

    StatusCode::NO_CONTENT
}
