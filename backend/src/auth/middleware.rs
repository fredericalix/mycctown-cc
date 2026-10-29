use crate::auth::encryption;
use crate::db::users::{self, User};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use tower_sessions::Session;
use uuid::Uuid;

pub struct AuthUser(pub User);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthorized)?;

        let user_id: Option<Uuid> = session
            .get("user_id")
            .await
            .map_err(|_| AppError::Unauthorized)?;

        let user_id = user_id.ok_or(AppError::Unauthorized)?;

        let user = users::find_by_id(&state.db, user_id)
            .await?
            .ok_or(AppError::Unauthorized)?;

        // Tag the per-request Sentry hub (created by NewSentryLayer) so any
        // event/transaction emitted by this request is attributed to the user.
        sentry::configure_scope(|scope| {
            scope.set_user(Some(sentry::User {
                id: Some(user.id.to_string()),
                email: user.email.clone(),
                username: user.name.clone(),
                ..Default::default()
            }));
        });

        Ok(AuthUser(user))
    }
}

impl AuthUser {
    /// Decrypt the stored OAuth access token + secret for this user.
    pub fn decrypt_cc_tokens(
        &self,
        key: &[u8; 32],
    ) -> anyhow::Result<(String, String)> {
        if self.0.oauth_nonce.len() != 24 {
            anyhow::bail!("invalid oauth_nonce length: {}", self.0.oauth_nonce.len());
        }
        let (token_nonce, secret_nonce) = self.0.oauth_nonce.split_at(12);
        let token_bytes = encryption::decrypt(&self.0.oauth_token_enc, token_nonce, key)?;
        let secret_bytes = encryption::decrypt(&self.0.oauth_secret_enc, secret_nonce, key)?;
        Ok((String::from_utf8(token_bytes)?, String::from_utf8(secret_bytes)?))
    }
}
