use crate::auth::middleware::AuthUser;
use crate::db::maps;
use crate::error::AppError;
use crate::state::AppState;
use crate::ws::frame::WsFrame;
use crate::ws::{poller, OrgChannel};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use chrono::Utc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::Instrument;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws/orgs/{org_id}/stream", get(stream))
}

async fn stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(org_id): Path<String>,
    headers: HeaderMap,
    auth: Result<AuthUser, AppError>,
) -> Result<impl IntoResponse, AppError> {
    // Explicit tracing so we can tell exactly where a WS upgrade is failing
    // (Vite proxy cookie-forwarding issues look the same as a real 401 from
    // the browser side — this lets us distinguish them in the backend log).
    let has_cookie = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains("mycctown.sid"))
        .unwrap_or(false);
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<none>");
    tracing::info!(
        "WS upgrade request org={} session_cookie_present={} origin={}",
        org_id,
        has_cookie,
        origin
    );

    let user = match auth {
        Ok(AuthUser(u)) => u,
        Err(e) => {
            tracing::warn!("WS auth failed for org={}: {:?}", org_id, e);
            return Err(e);
        }
    };

    // A user can open a WS stream for any org they have a saved map for.
    // The REST `/api/orgs/:id/map` endpoint creates this row on first access,
    // so the frontend always fetches the map before opening the WS.
    if !maps::user_has_map(&state.db, user.id, &org_id).await? {
        tracing::warn!(
            "WS access denied for org={} user={} (no map yet — GET /api/orgs/:id/map first)",
            org_id,
            user.id
        );
        return Err(AppError::Forbidden);
    }

    tracing::info!("WS upgrade accepted for org={} user={}", org_id, user.id);
    let tx = ensure_channel(&state, &org_id, user.id);

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, org_id, tx)))
}

fn ensure_channel(state: &AppState, org_id: &str, owner_user_id: Uuid) -> broadcast::Sender<WsFrame> {
    let entry = state.ws_bus.entry(org_id.to_string()).or_insert_with(|| {
        let (tx, _rx) = broadcast::channel::<WsFrame>(64);
        let tx_cloned = tx.clone();
        let state_cloned = state.clone();
        let org_id_cloned = org_id.to_string();
        // Status poller cadence is user-controlled via WS_POLL_STATUS_SECS.
        // With webhooks configured on an org, the poller acts as a safety-net
        // resync (set WS_POLL_STATUS_SECS=60 in prod once the admin has
        // wired up the hook). Without webhooks it remains the primary source.
        let status_interval = Duration::from_secs(state.config.ws_poll_status_secs.max(3));
        let metrics_interval = Duration::from_secs(state.config.ws_poll_metrics_secs.max(5));
        let handle = tokio::spawn(poller::run(
            state_cloned,
            org_id_cloned,
            owner_user_id,
            tx_cloned,
            status_interval,
            metrics_interval,
        ));
        OrgChannel {
            tx,
            subscriber_count: AtomicUsize::new(0),
            poller_handle: Some(handle),
        }
    });
    entry.tx.clone()
}

async fn handle_socket(
    mut socket: WebSocket,
    state: AppState,
    org_id: String,
    tx: broadcast::Sender<WsFrame>,
) {
    // Bump the subscriber counter before handing out a receiver.
    if let Some(channel) = state.ws_bus.get(&org_id) {
        channel.subscriber_count.fetch_add(1, Ordering::SeqCst);
    }

    let mut rx = tx.subscribe();

    let hello = WsFrame::Hello {
        org_id: org_id.clone(),
        ts: Utc::now().timestamp(),
    };
    if let Ok(json) = serde_json::to_string(&hello) {
        if socket.send(Message::Text(json.into())).await.is_err() {
            cleanup(&state, &org_id);
            return;
        }
    }

    loop {
        tokio::select! {
            // Server-pushed frames
            frame = rx.recv() => {
                match frame {
                    Ok(f) => {
                        let Ok(json) = serde_json::to_string(&f) else { continue };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("ws client lagged by {} frames", n);
                        let err = WsFrame::Error { message: format!("lagged by {n} frames") };
                        if let Ok(json) = serde_json::to_string(&err) {
                            let _ = socket.send(Message::Text(json.into())).await;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            // Incoming (mostly pings / close)
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Ok(_)) => { /* ignore other inbound frames */ }
                    Some(Err(_)) => break,
                }
            }
        }
    }

    cleanup(&state, &org_id);
}

fn cleanup(state: &AppState, org_id: &str) {
    if let Some(channel) = state.ws_bus.get(org_id) {
        let remaining = channel.subscriber_count.fetch_sub(1, Ordering::SeqCst);
        // `fetch_sub` returns the previous value — so 1 means we were the last.
        if remaining <= 1 {
            drop(channel);
            // Give potential reconnects a short grace period before tearing down.
            let bus = state.ws_bus.clone();
            let key = org_id.to_string();
            let span = tracing::info_span!("ws_cleanup", org_id = %key);
            tokio::spawn(
                async move {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    if let Some(ch) = bus.get(&key) {
                        if ch.subscriber_count.load(Ordering::SeqCst) == 0 {
                            drop(ch);
                            if let Some((_, mut ch)) = bus.remove(&key) {
                                if let Some(h) = ch.poller_handle.take() {
                                    tracing::info!("aborting poller after grace period");
                                    h.abort();
                                }
                            }
                        }
                    }
                }
                .instrument(span),
            );
        }
    }
}
