use crate::state::AppState;
use crate::webhooks::receiver;
use axum::routing::post;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new().route("/webhooks/cc/{token}", post(receiver::handle))
}
