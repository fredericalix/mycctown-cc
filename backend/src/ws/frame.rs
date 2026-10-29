use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsFrame {
    Hello {
        org_id: String,
        ts: i64,
    },
    AppStatus {
        app_id: String,
        state: String,
        last_deploy: Option<i64>,
        ts: i64,
    },
    AppMetrics {
        app_id: String,
        cpu_pct: f32,
        ram_pct: f32,
        ts: i64,
    },
    AddonStatus {
        addon_id: String,
        healthy: bool,
        ts: i64,
    },
    AddonMetrics {
        addon_id: String,
        cpu_pct: f32,
        ram_pct: f32,
        ts: i64,
    },
    /// Emitted when CC sends APPLICATION_DELETION — lets the frontend drop the
    /// entry without waiting for the next map refresh.
    AppRemoved {
        app_id: String,
        ts: i64,
    },
    /// Emitted on ADDON_CREATION so the user sees a fresh addon pop in before
    /// the 30 s polling tick picks it up.
    AddonAdded {
        addon_id: String,
        provider: Option<String>,
        ts: i64,
    },
    AddonRemoved {
        addon_id: String,
        ts: i64,
    },
    /// Pushed when the server can't decrypt the user's stored OAuth tokens
    /// (ENCRYPTION_KEY rotated out from under them) — frontend reacts by
    /// forcing a logout/redirect to /auth/login so the user's tokens get
    /// re-encrypted with the current key on next login.
    SessionExpired {
        message: String,
    },
    Error {
        message: String,
    },
}
