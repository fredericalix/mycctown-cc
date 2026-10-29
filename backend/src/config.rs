use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub frontend_url: String,
    pub app_url: String,
    pub cc_consumer_key: String,
    pub cc_consumer_secret: String,
    pub encryption_key: [u8; 32],
    pub cc_api_base_url: String,
    pub warp10_endpoint: String,
    pub static_dir: Option<String>,
    pub ws_poll_status_secs: u64,
    pub ws_poll_metrics_secs: u64,
    /// Public URL the backend is reachable at for CC webhook callbacks.
    /// In prod: `https://mycctown-backend.cleverapps.io`. In dev: tunnel URL
    /// (cloudflared/ngrok) or empty to disable webhook registration.
    pub webhooks_public_url: Option<String>,
    /// When true, status changes come from CC webhooks and the poller's
    /// `tick_status` slows to a safety-net resync (~60 s). When false (dev
    /// default), the poller keeps its normal status tick cadence.
    pub use_webhooks: bool,
    /// Sentry/GlitchTip DSN. None disables error reporting (init is no-op).
    pub sentry_dsn: Option<String>,
    pub sentry_environment: String,
    pub sentry_traces_sample_rate: f32,
    /// When true, every outgoing request to the Clever Cloud REST API and to
    /// the Warp10 exec endpoint is logged at INFO with method + URL + status
    /// + duration (no headers, no body). Used to catalogue endpoints + return
    /// codes when investigating OAuth scope quirks. Toggle via `DEBUG_CC_API`.
    pub debug_cc_api: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let encryption_key_b64 = env::var("ENCRYPTION_KEY").unwrap_or_else(|_| {
            use base64::Engine;
            let mut key = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
            tracing::warn!(
                "ENCRYPTION_KEY not set — generated ephemeral key (sessions will be lost on restart)"
            );
            base64::engine::general_purpose::STANDARD.encode(key)
        });

        let key_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &encryption_key_b64,
        )?;
        let encryption_key: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("ENCRYPTION_KEY must decode to exactly 32 bytes"))?;

        let port: u16 = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse()?;

        let app_url = env::var("APP_URL").unwrap_or_else(|_| format!("http://localhost:{port}"));

        Ok(Config {
            database_url: env::var("DATABASE_URL")
                .or_else(|_| env::var("POSTGRESQL_ADDON_URI"))?,
            port,
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| format!("http://localhost:{port}")),
            app_url,
            cc_consumer_key: env::var("CC_OAUTH_CONSUMER_KEY").unwrap_or_default(),
            cc_consumer_secret: env::var("CC_OAUTH_CONSUMER_SECRET").unwrap_or_default(),
            encryption_key,
            cc_api_base_url: env::var("CC_API_BASE_URL")
                .unwrap_or_else(|_| "https://api.clever-cloud.com".to_string()),
            warp10_endpoint: env::var("WARP10_ENDPOINT").unwrap_or_else(|_| {
                "https://c2-warp10-clevercloud-customers.services.clever-cloud.com/api/v0/exec"
                    .to_string()
            }),
            static_dir: env::var("STATIC_DIR").ok(),
            ws_poll_status_secs: env::var("WS_POLL_STATUS_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            ws_poll_metrics_secs: env::var("WS_POLL_METRICS_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            webhooks_public_url: env::var("WEBHOOKS_PUBLIC_URL").ok().filter(|s| !s.is_empty()),
            use_webhooks: env::var("USE_WEBHOOKS")
                .ok()
                .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
                .unwrap_or(false),
            sentry_dsn: env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty()),
            sentry_environment: env::var("SENTRY_ENVIRONMENT")
                .unwrap_or_else(|_| "development".to_string()),
            sentry_traces_sample_rate: env::var("SENTRY_TRACES_SAMPLE_RATE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.1),
            debug_cc_api: env::var("DEBUG_CC_API")
                .ok()
                .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
                .unwrap_or(false),
        })
    }

    pub fn callback_url(&self) -> String {
        format!("{}/auth/callback", self.app_url)
    }
}
