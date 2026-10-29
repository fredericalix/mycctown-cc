use chrono::{DateTime, Utc};
use rand::RngCore;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WebhookConfig {
    pub id: i64,
    pub user_id: Uuid,
    pub cc_org_id: String,
    pub token: String,
    pub cc_webhook_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Generate a 48-hex-char token (≈192 bits of entropy) suitable for a
/// URL-embedded shared secret. Matches the convention used by the sniffer
/// (`openssl rand -hex 24`).
pub fn new_token() -> String {
    let mut buf = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub async fn find_by_user_org(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Option<WebhookConfig>, sqlx::Error> {
    sqlx::query_as::<_, WebhookConfig>(
        "SELECT * FROM webhook_configs WHERE user_id = $1 AND cc_org_id = $2",
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_optional(pool)
    .await
}

pub async fn find_by_token(pool: &PgPool, token: &str) -> Result<Option<WebhookConfig>, sqlx::Error> {
    sqlx::query_as::<_, WebhookConfig>("SELECT * FROM webhook_configs WHERE token = $1")
        .bind(token)
        .fetch_optional(pool)
        .await
}

/// Insert a row with a fresh token. Idempotent: if a row already exists for
/// `(user_id, cc_org_id)` the existing row is returned unchanged.
pub async fn insert_if_absent(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<WebhookConfig, sqlx::Error> {
    let token = new_token();
    sqlx::query_as::<_, WebhookConfig>(
        r#"
        INSERT INTO webhook_configs (user_id, cc_org_id, token)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, cc_org_id) DO UPDATE SET cc_org_id = EXCLUDED.cc_org_id
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(token)
    .fetch_one(pool)
    .await
}

