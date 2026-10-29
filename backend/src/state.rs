use crate::config::Config;
use crate::webhooks::receiver::DedupCache;
use crate::ws::OrgBus;
use dashmap::DashMap;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;

/// Per-app_id timestamp of the last observed DEPLOYMENT_FAIL webhook. The
/// poller checks this before emitting a fresh AppStatus: if a recent FAIL is
/// on record, CC API's raw state (which doesn't see deployment results) is
/// suppressed until the next lifecycle event (REDEPLOY/SUCCESS/CREATION/STOP)
/// clears the entry.
pub type FailedAppsMap = Arc<DashMap<String, Instant>>;

/// Per-app_id timestamp of the last observed REDEPLOY/GIT_PUSH webhook. While
/// an entry is present, the poller overrides CC's raw state with `DEPLOYING`
/// — without this the next status tick would flip the building back to UP
/// since CC keeps reporting the previous (still-serving) deployment as
/// `SHOULD_BE_UP` throughout the new build.
pub type DeployingAppsMap = Arc<DashMap<String, Instant>>;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub http_client: reqwest::Client,
    pub config: Arc<Config>,
    pub ws_bus: OrgBus,
    pub webhook_dedup: DedupCache,
    pub failed_apps: FailedAppsMap,
    pub deploying_apps: DeployingAppsMap,
}
