use crate::api::cc_client::CcClient;
use crate::auth::encryption;
use crate::db::warp10_tokens;
use crate::state::AppState;
use chrono::{Duration as CDuration, Utc};
use uuid::Uuid;

/// Get a valid Warp10 token for a (user, org) pair — either cached in DB or freshly
/// fetched from CC. Tokens are scoped per-user: two members of the same org each
/// own their own token so one can't read the other's metrics with a stale cache.
pub async fn ensure_token(
    state: &AppState,
    client: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
) -> anyhow::Result<String> {
    if let Some(existing) = warp10_tokens::find_valid_token(&state.db, user_id, cc_org_id).await? {
        match encryption::decrypt(
            &existing.token_enc,
            &existing.token_nonce,
            &state.config.encryption_key,
        ) {
            Ok(plain) => return Ok(String::from_utf8(plain)?),
            Err(e) => {
                // The cache survives redeploys — if ENCRYPTION_KEY rotated or
                // was ephemerally generated in a past boot, old rows become
                // un-decryptable. Drop and re-fetch instead of poisoning the
                // poller forever.
                tracing::warn!(
                    "stale warp10 token for user={} org={} (can't decrypt with current key: {e}) — invalidating cache",
                    user_id, cc_org_id
                );
            }
        }
    }

    let token = client.get_metrics_token(cc_org_id).await?;
    let (enc, nonce) = encryption::encrypt(token.as_bytes(), &state.config.encryption_key)?;
    // CC metrics tokens expire after ~5 days — keep ours for 4.5 days.
    // `insert_token` DELETEs any existing row for this (user, org) first,
    // so we overwrite a stale un-decryptable entry in place.
    let expires = Utc::now() + CDuration::hours(4 * 24 + 12);
    warp10_tokens::insert_token(&state.db, user_id, cc_org_id, &enc, &nonce, expires).await?;

    Ok(token)
}
