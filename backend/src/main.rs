mod api;
mod auth;
mod config;
mod db;
mod error;
mod metrics;
mod state;
mod webhooks;
mod ws;

use axum::extract::Request;
use axum::http::{header, HeaderValue, Method};
use axum::routing::get;
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tower_sessions::cookie::SameSite;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    let config = config::Config::from_env()?;

    // Sentry init must happen before tracing init so the tracing→Sentry layer
    // has a hub to send to. _guard lives for the whole `main` body — drop on
    // exit flushes pending events.
    let _sentry_guard = config.sentry_dsn.as_ref().map(|dsn| {
        sentry::init((
            dsn.as_str(),
            sentry::ClientOptions {
                release: sentry::release_name!(),
                environment: Some(config.sentry_environment.clone().into()),
                traces_sample_rate: config.sentry_traces_sample_rate,
                attach_stacktrace: true,
                ..Default::default()
            },
        ))
    });

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,sqlx=warn,tower_http=info".into());
    let fmt_layer = tracing_subscriber::fmt::layer().with_target(false);
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(sentry::integrations::tracing::layer())
        .init();

    if _sentry_guard.is_some() {
        tracing::info!(
            "Sentry/GlitchTip enabled (env={}, sample_rate={})",
            config.sentry_environment,
            config.sentry_traces_sample_rate
        );
    }

    tracing::info!("Starting myCCtown backend on port {}", config.port);

    let db = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;
    tracing::info!("Database migrations applied");

    let session_store = PostgresStore::new(db.clone());
    session_store.migrate().await?;

    use tower_sessions::session_store::ExpiredDeletion;
    let deletion_task = tokio::task::spawn(
        session_store
            .clone()
            .continuously_delete_expired(Duration::from_secs(3600)),
    );

    let cross_site = needs_cross_site(&config);
    let is_https = !is_dev_http(&config);
    // Browsers reject SameSite=None cookies without Secure=true, so we only
    // downgrade to None in production (https) when the frontend is cross-site.
    // Dev always uses Lax — the Vite proxy makes requests same-origin anyway.
    let same_site = if cross_site && is_https {
        SameSite::None
    } else {
        SameSite::Lax
    };
    let session_layer = SessionManagerLayer::new(session_store)
        .with_name("mycctown.sid")
        .with_http_only(true)
        .with_secure(is_https)
        .with_same_site(same_site)
        .with_expiry(Expiry::OnInactivity(time::Duration::days(7)));

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let app_state = AppState {
        db,
        http_client,
        config: Arc::new(config.clone()),
        ws_bus: ws::new_bus(),
        webhook_dedup: webhooks::receiver::DedupCache::new(),
        failed_apps: Arc::new(dashmap::DashMap::new()),
        deploying_apps: Arc::new(dashmap::DashMap::new()),
    };

    // Webhook receiver lives on its own sub-router so we can mount it
    // OUTSIDE the session layer below — CC posts with no cookie; auth is the
    // opaque token in the URL path.
    let webhooks_router = webhooks::routes::router();

    let mut app = Router::new()
        .route("/health", get(health))
        .merge(auth::routes::router())
        .merge(api::routes::router())
        .merge(api::map_routes::router())
        .merge(ws::routes::router());

    // Two-origin deployment (frontend on a different domain than backend) needs CORS
    // and SameSite=None cookies so the browser sends the session cookie on cross-site
    // requests. Only enabled when FRONTEND_URL and APP_URL clearly differ.
    let cors_layer = if cross_site {
        let origin = config.frontend_url.parse::<HeaderValue>().ok();
        origin.map(|origin| {
            tracing::info!(
                "Enabling CORS for cross-origin frontend at {}",
                config.frontend_url
            );
            CorsLayer::new()
                .allow_origin(origin)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
                .allow_credentials(true)
        })
    } else {
        None
    };

    // Serve the built frontend from STATIC_DIR if configured (single-origin deploy).
    if let Some(static_dir) = &config.static_dir {
        tracing::info!("Serving static frontend from {static_dir}");
        let serve = tower_http::services::ServeDir::new(static_dir)
            .append_index_html_on_directories(true)
            .fallback(tower_http::services::ServeFile::new(format!(
                "{static_dir}/index.html"
            )));
        app = app.fallback_service(serve);
    }

    // Attach session layer ONLY to the authenticated routes, then merge the
    // webhook receiver on top. Merging after `.layer()` means the webhook
    // route never sees SessionManagerLayer — CC posts with no cookie and we
    // don't want an empty-session write on every delivery.
    //
    // Sentry layers wrap the whole router (auth routes + webhooks). Order in
    // axum: layers are applied innermost-first, so SentryHttpLayer (transaction)
    // sits inside NewSentryLayer (per-request hub). Reversing this order leaks.
    let mut app = app
        .layer(session_layer)
        .merge(webhooks_router)
        .layer(TraceLayer::new_for_http())
        .layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
        .layer(sentry_tower::NewSentryLayer::<Request>::new_from_top());
    if let Some(cors) = cors_layer {
        app = app.layer(cors);
    }
    let app = app.with_state(app_state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    deletion_task.abort();
    Ok(())
}

fn is_dev_http(config: &config::Config) -> bool {
    config.app_url.starts_with("http://")
}

fn needs_cross_site(config: &config::Config) -> bool {
    fn host(u: &str) -> Option<&str> {
        u.split("://").nth(1).map(|s| s.split('/').next().unwrap_or(""))
    }
    match (host(&config.app_url), host(&config.frontend_url)) {
        (Some(a), Some(b)) => !a.is_empty() && !b.is_empty() && a != b,
        _ => false,
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install CTRL+C handler");
    tracing::info!("Shutdown signal received");
}
