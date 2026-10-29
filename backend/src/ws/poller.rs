use crate::api::cc_client::CcClient;
use crate::auth::encryption;
use crate::db::{maps, users};
use crate::metrics::{templates, tokens, warp10_client};
use crate::state::AppState;
use crate::ws::frame::WsFrame;
use chrono::Utc;
use futures_util::future::join_all;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::time::{interval, MissedTickBehavior};
use uuid::Uuid;

/// Maximum number of `real_id`s packed into a single WarpScript FETCH block.
/// A 30-addon single query takes >30 s at Warp10 and blows our reqwest
/// timeout; 5 per chunk × tokio::join_all keeps each sub-query fast and
/// gives the whole metrics tick a wall time proportional to the slowest
/// chunk, not to the total addon count.
const ADDON_BATCH_SIZE: usize = 5;

/// How long the mapped-id sets (apps / addons) are cached before the poller
/// re-reads `maps.cells_json`. The user's map only changes when they save it,
/// so a 60s TTL is largely overkill — the real benefit is replacing
/// 4 reads/min with 1 read/min per subscribed org.
const MAPPED_IDS_TTL: Duration = Duration::from_secs(60);

/// Once we've seen a DEPLOYMENT_FAIL for an app, we keep the "failed" sticky
/// for this long so tick_status can't overwrite it with CC's raw lifecycle
/// state. Any REDEPLOY / SUCCESS / STOP / CREATION event before the window
/// expires also clears the entry.
const FAILED_STICKY_WINDOW: Duration = Duration::from_secs(10 * 60);

/// While an app sits in `deploying_apps`, tick_status overrides CC's raw state
/// with `DEPLOYING` so the building keeps its scaffold/blue look throughout
/// the new build. The entry is normally cleared by a DEPLOYMENT_SUCCESS /
/// DEPLOYMENT_FAIL / STOP / DELETION webhook; this constant is just the
/// safety net for the case where that final webhook never arrives — past
/// this window we fall back to CC's raw state.
const DEPLOYING_STICKY_WINDOW: Duration = Duration::from_secs(15 * 60);

struct MappedIdsCache {
    apps: HashSet<String>,
    addons: HashSet<String>,
    fetched_at: Instant,
}

impl MappedIdsCache {
    fn fresh(&self) -> bool {
        self.fetched_at.elapsed() < MAPPED_IDS_TTL
    }
}

async fn cached_mapped_ids(
    cache: &mut Option<MappedIdsCache>,
    state: &AppState,
    user_id: Uuid,
    cc_org_id: &str,
) -> anyhow::Result<(HashSet<String>, HashSet<String>)> {
    if let Some(c) = cache.as_ref() {
        if c.fresh() {
            return Ok((c.apps.clone(), c.addons.clone()));
        }
    }
    let (apps, addons) = maps::mapped_resource_ids(&state.db, user_id, cc_org_id).await?;
    *cache = Some(MappedIdsCache {
        apps: apps.clone(),
        addons: addons.clone(),
        fetched_at: Instant::now(),
    });
    Ok((apps, addons))
}

/// Long-running task that polls Clever Cloud for status + Warp10 for metrics,
/// and fans both streams of frames to subscribers via `tx`.
///
/// When webhooks are the primary source of truth for app status, the caller
/// passes a longer `status_interval` (≈60 s) so this tick acts as a safety-net
/// resync in case a webhook got dropped.
pub async fn run(
    state: AppState,
    cc_org_id: String,
    owner_user_id: Uuid,
    tx: broadcast::Sender<WsFrame>,
    status_interval: Duration,
    metrics_interval: Duration,
) {
    let mut status_tick = interval(status_interval);
    status_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut metrics_tick = interval(metrics_interval);
    metrics_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    // Addon health moves slowly — check every 30s regardless of the faster app ticks.
    let mut addon_tick = interval(Duration::from_secs(30));
    addon_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);

    let mut mapped_cache: Option<MappedIdsCache> = None;

    loop {
        tokio::select! {
            _ = status_tick.tick() => {
                if tx.receiver_count() == 0 { continue; }
                if let Err(e) = tick_status(&state, &cc_org_id, owner_user_id, &tx, &mut mapped_cache).await {
                    if is_auth_error(&e) {
                        emit_session_expired_and_drop(&state, &cc_org_id, &tx);
                        return;
                    }
                    tracing::warn!("poller status tick failed: {e:#}");
                }
            }
            _ = metrics_tick.tick() => {
                if tx.receiver_count() == 0 { continue; }
                if let Err(e) = tick_metrics(&state, &cc_org_id, owner_user_id, &tx, &mut mapped_cache).await {
                    if is_auth_error(&e) {
                        emit_session_expired_and_drop(&state, &cc_org_id, &tx);
                        return;
                    }
                    // Metrics failures are best-effort — log only, no WS Error
                    // frame (used to pollute the UI's lastError banner).
                    tracing::warn!("poller metrics tick failed: {e:#}");
                }
            }
            _ = addon_tick.tick() => {
                if tx.receiver_count() == 0 { continue; }
                if let Err(e) = tick_addons(&state, &cc_org_id, owner_user_id, &tx, &mut mapped_cache).await {
                    if is_auth_error(&e) {
                        emit_session_expired_and_drop(&state, &cc_org_id, &tx);
                        return;
                    }
                    tracing::warn!("poller addon tick failed: {e:#}");
                }
            }
        }
    }
}

/// Returns true for errors that indicate the user's encrypted OAuth tokens
/// can't be decrypted with the current ENCRYPTION_KEY. The most common cause
/// is a key rotation after the user's tokens were written to the DB; they
/// need to re-log in so the fresh tokens encrypt with the current key.
///
/// Warp10 token cache decryption failures are caught and self-healed inside
/// `metrics::tokens::ensure_token` before they ever bubble up here — so an
/// error reaching this point really is the user's root OAuth material.
fn is_auth_error(err: &anyhow::Error) -> bool {
    let msg = format!("{err:#}");
    msg.contains("decryption failed") || msg.contains("aead::Error")
}

/// Tell the client to re-auth, then drop the org's channel entry so the next
/// reconnection spawns a fresh poller using post-login tokens. Without this,
/// the poller would self-exit while `ws_bus` still held a stale `OrgChannel`,
/// and subsequent `ensure_channel` calls would silently reuse that dead
/// channel (no ticks, everything stuck on "unknown" in the UI).
fn emit_session_expired_and_drop(
    state: &AppState,
    cc_org_id: &str,
    tx: &broadcast::Sender<WsFrame>,
) {
    tracing::warn!(
        "poller: session expired for org={} (can't decrypt user's OAuth tokens) — signalling client + dropping channel",
        cc_org_id
    );
    let _ = tx.send(WsFrame::SessionExpired {
        message: "Your session needs a refresh — signing you out.".to_string(),
    });
    // Removing the entry drops the last `broadcast::Sender`, which makes
    // existing subscribers observe `RecvError::Closed` → they exit cleanly.
    // Next WS upgrade will re-spawn a new poller with fresh tokens.
    state.ws_bus.remove(cc_org_id);
}

async fn tick_status(
    state: &AppState,
    cc_org_id: &str,
    owner_user_id: Uuid,
    tx: &broadcast::Sender<WsFrame>,
    cache: &mut Option<MappedIdsCache>,
) -> anyhow::Result<()> {
    let (mapped, _) = cached_mapped_ids(cache, state, owner_user_id, cc_org_id).await?;
    if mapped.is_empty() {
        return Ok(());
    }

    let (token, secret) = decrypt_owner_tokens(state, owner_user_id).await?;
    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let apps = client.list_applications(cc_org_id).await?;

    let now = Utc::now().timestamp();
    // Emit on every tick, not only on change: a broadcast::Sender does not
    // replay past frames to new subscribers, so a client that connects
    // *between* two real state changes would otherwise never see a status
    // for any app. Volume is small (≈ mapped.len() frames per ~10s) so no
    // throttling is needed at this scale.
    let mut emitted = 0usize;
    let mut suppressed = 0usize;
    for app in apps {
        if !mapped.contains(&app.id) {
            continue;
        }
        // Sticky failed: skip re-emission if a DEPLOYMENT_FAIL webhook for
        // this app is still in the grace window. CC's `state` field doesn't
        // reflect deployment success/failure, so without this suppression
        // tick_status would flip a red building back to deploying/running.
        if let Some(failed_at) = state.failed_apps.get(&app.id) {
            if failed_at.elapsed() < FAILED_STICKY_WINDOW {
                suppressed += 1;
                continue;
            }
            drop(failed_at);
            state.failed_apps.remove(&app.id);
        }
        // Sticky deploying: while a REDEPLOY/GIT_PUSH is in flight, CC keeps
        // reporting the previous (still-serving) deployment as SHOULD_BE_UP,
        // which would visually erase the blue/scaffold animation. Override
        // with DEPLOYING until SUCCESS/FAIL/STOP/DELETION clears the entry
        // (or the safety window expires).
        if let Some(deploying_at) = state.deploying_apps.get(&app.id) {
            if deploying_at.elapsed() < DEPLOYING_STICKY_WINDOW {
                let _ = tx.send(WsFrame::AppStatus {
                    app_id: app.id.clone(),
                    state: "DEPLOYING".to_string(),
                    last_deploy: app.last_deploy,
                    ts: now,
                });
                emitted += 1;
                continue;
            }
            drop(deploying_at);
            state.deploying_apps.remove(&app.id);
        }
        // CC API returns state=`SHOULD_BE_DOWN` for apps that have never been
        // deployed as well as for apps that have been stopped. Distinguish by
        // presence of a past deployment — an app without `last_deploy` has
        // never run. Surface it as `CREATED` so the frontend renders the
        // in-progress stage-B building instead of a regular stopped house.
        let raw_state = app.state.clone().unwrap_or_default();
        let state_str = if app.last_deploy.is_none()
            && (raw_state.is_empty()
                || raw_state.eq_ignore_ascii_case("SHOULD_BE_DOWN")
                || raw_state.eq_ignore_ascii_case("WANTS_TO_BE_DOWN"))
        {
            "CREATED".to_string()
        } else {
            raw_state
        };
        let _ = tx.send(WsFrame::AppStatus {
            app_id: app.id,
            state: state_str,
            last_deploy: app.last_deploy,
            ts: now,
        });
        emitted += 1;
    }
    if suppressed > 0 {
        tracing::debug!(
            "status tick: {} emitted, {} suppressed (sticky failed)",
            emitted,
            suppressed,
        );
    }
    tracing::debug!("app status tick: emitted {}/{}", emitted, mapped.len());
    Ok(())
}

async fn tick_metrics(
    state: &AppState,
    cc_org_id: &str,
    owner_user_id: Uuid,
    tx: &broadcast::Sender<WsFrame>,
    cache: &mut Option<MappedIdsCache>,
) -> anyhow::Result<()> {
    let (apps_set, addons_set) = cached_mapped_ids(cache, state, owner_user_id, cc_org_id).await?;
    let apps: Vec<String> = apps_set.into_iter().collect();
    let addons: Vec<String> = addons_set.into_iter().collect();
    if apps.is_empty() && addons.is_empty() {
        return Ok(());
    }

    let (token, secret) = decrypt_owner_tokens(state, owner_user_id).await?;
    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let warp10_token = tokens::ensure_token(state, &client, owner_user_id, cc_org_id).await?;
    let now = Utc::now().timestamp();

    // Apps and addons have the same cpu/mem metric classes but different label
    // names ("app_id" vs "addon_id"). We fetch them in two passes so the split
    // can cleanly key by the right label.
    if !apps.is_empty() {
        let script = templates::cpu_ram_last_script(&warp10_token, "app_id", &apps);
        let resp = warp10_client::execute_warpscript(
            &state.http_client,
            &state.config.warp10_endpoint,
            &script,
            state.config.debug_cc_api,
        )
        .await?;
        let split = templates::split_cpu_ram(&resp, "app_id");
        for app_id in &apps {
            let (cpu, ram) = split.get(app_id).copied().unwrap_or((None, None));
            let _ = tx.send(WsFrame::AppMetrics {
                app_id: app_id.clone(),
                cpu_pct: cpu.unwrap_or(0.0),
                ram_pct: ram.unwrap_or(0.0),
                ts: now,
            });
        }
    }

    if !addons.is_empty() {
        // CC's Warp10 unifies apps and addons under a single label, literally
        // called `app_id`. For apps the value is `app_XXX`; for addons the
        // value is the provider-specific realId (`postgresql_XXX`,
        // `redis_XXX`, `cellar_XXX`, …) — NOT the abstract `addon_XXX` id.
        // So we resolve realIds via list_addons, then query with `app_id`
        // = realId. Addons without a running process (config-provider,
        // fs-bucket, …) simply return no data and fall back to the
        // "waiting…" placeholder on the frontend.
        let cc_addons = client
            .list_addons(cc_org_id)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!("addon metrics: list_addons failed: {e}");
                Vec::new()
            });
        let real_id_to_addon_id: HashMap<String, String> = cc_addons
            .into_iter()
            .filter(|a| addons.contains(&a.id))
            .filter_map(|a| a.real_id.clone().map(|r| (r, a.id)))
            .collect();
        let real_ids: Vec<String> = real_id_to_addon_id.keys().cloned().collect();

        if !real_ids.is_empty() {
            // Chunk the real_ids to keep each WarpScript short. A single big
            // query for ~30 addons blows the reqwest timeout (see commit
            // history for context). tokio::join_all runs them concurrently so
            // wall time ≈ worst single-chunk latency, not sum of chunks.
            let chunks: Vec<Vec<String>> = real_ids
                .chunks(ADDON_BATCH_SIZE)
                .map(|c| c.to_vec())
                .collect();
            let tick_started = Instant::now();
            tracing::debug!(
                "addon metrics: fanning out {} addons over {} chunks of up to {}",
                real_ids.len(),
                chunks.len(),
                ADDON_BATCH_SIZE,
            );

            let futures = chunks.iter().enumerate().map(|(idx, chunk)| {
                let script = templates::cpu_ram_last_script(&warp10_token, "app_id", chunk);
                let http = state.http_client.clone();
                let endpoint = state.config.warp10_endpoint.clone();
                let debug = state.config.debug_cc_api;
                let chunk_ids = chunk.clone();
                async move {
                    let started = Instant::now();
                    let out = warp10_client::execute_warpscript(&http, &endpoint, &script, debug).await;
                    let ms = started.elapsed().as_millis();
                    match &out {
                        Ok(_) => tracing::debug!(
                            "addon metrics chunk #{} ({} ids): Warp10 OK in {} ms",
                            idx, chunk_ids.len(), ms
                        ),
                        Err(e) => tracing::warn!(
                            "addon metrics chunk #{} ({} ids): Warp10 failed in {} ms: {e:#} (ids={:?})",
                            idx, chunk_ids.len(), ms, chunk_ids
                        ),
                    }
                    out
                }
            });
            let results = join_all(futures).await;

            let mut hits: Vec<String> = Vec::new();
            let mut misses: Vec<String> = Vec::new();
            let mut chunks_failed = 0usize;
            let mut merged: HashMap<String, (Option<f32>, Option<f32>)> = HashMap::new();
            for result in results {
                match result {
                    Ok(resp) => {
                        let split = templates::split_cpu_ram(&resp, "app_id");
                        merged.extend(split);
                    }
                    Err(_) => chunks_failed += 1,
                }
            }

            for (real_id, addon_id) in &real_id_to_addon_id {
                if let Some((cpu, ram)) = merged.get(real_id).copied() {
                    hits.push(real_id.clone());
                    let _ = tx.send(WsFrame::AddonMetrics {
                        addon_id: addon_id.clone(),
                        cpu_pct: cpu.unwrap_or(0.0),
                        ram_pct: ram.unwrap_or(0.0),
                        ts: now,
                    });
                } else {
                    misses.push(real_id.clone());
                }
            }
            tracing::info!(
                "addon metrics tick: {}/{} addons with data in {} ms ({} chunks, {} failed) (hits={:?}, misses={:?})",
                hits.len(),
                real_id_to_addon_id.len(),
                tick_started.elapsed().as_millis(),
                chunks.len(),
                chunks_failed,
                hits,
                misses
            );
        }
    }

    Ok(())
}

/// CC doesn't expose an addon-health endpoint directly. The closest proxy signal
/// we can get cheaply is: the addon is listed in `/v2/organisations/:id/addons`.
/// If it ever disappears from the list, we mark it unhealthy. It's a coarse
/// signal but it catches addon deletions and large-scale outages — for finer
/// status we'd need provider-specific probing (redis PING, postgres SELECT 1…).
async fn tick_addons(
    state: &AppState,
    cc_org_id: &str,
    owner_user_id: Uuid,
    tx: &broadcast::Sender<WsFrame>,
    cache: &mut Option<MappedIdsCache>,
) -> anyhow::Result<()> {
    let (_, mapped) = cached_mapped_ids(cache, state, owner_user_id, cc_org_id).await?;
    if mapped.is_empty() {
        return Ok(());
    }

    let (token, secret) = decrypt_owner_tokens(state, owner_user_id).await?;
    let client = CcClient::new(&state.http_client, &state.config, token, secret);
    let addons = client.list_addons(cc_org_id).await?;

    let present: HashSet<String> = addons.into_iter().map(|a| a.id).collect();
    let now = Utc::now().timestamp();

    // Always emit, for the same reason as tick_status: broadcast subscribers
    // that joined between state changes would otherwise never see an addon
    // health frame.
    for addon_id in &mapped {
        let healthy = present.contains(addon_id);
        let _ = tx.send(WsFrame::AddonStatus {
            addon_id: addon_id.clone(),
            healthy,
            ts: now,
        });
    }
    Ok(())
}

async fn decrypt_owner_tokens(
    state: &AppState,
    owner_user_id: Uuid,
) -> anyhow::Result<(String, String)> {
    let user = users::find_by_id(&state.db, owner_user_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("owner user not found"))?;
    if user.oauth_nonce.len() != 24 {
        anyhow::bail!("invalid oauth_nonce length");
    }
    let (tn, sn) = user.oauth_nonce.split_at(12);
    let t = encryption::decrypt(&user.oauth_token_enc, tn, &state.config.encryption_key)?;
    let s = encryption::decrypt(&user.oauth_secret_enc, sn, &state.config.encryption_key)?;
    Ok((String::from_utf8(t)?, String::from_utf8(s)?))
}

