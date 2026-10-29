/// Execute a WarpScript against the Warp10 exec endpoint and return the parsed JSON.
///
/// `debug` toggles a one-line INFO trace (method + URL + status + duration +
/// script length). Wired to `Config::debug_cc_api`.
#[tracing::instrument(skip_all, fields(script_len = script.len(), status))]
pub async fn execute_warpscript(
    http_client: &reqwest::Client,
    warp10_url: &str,
    script: &str,
    debug: bool,
) -> anyhow::Result<serde_json::Value> {
    let started = std::time::Instant::now();
    let resp = http_client
        .post(warp10_url)
        .header("Content-Type", "application/x-warp10-warpscript")
        .body(script.to_string())
        .send()
        .await?;

    let status = resp.status();
    tracing::Span::current().record("status", status.as_u16());
    if debug {
        tracing::info!(
            "cc-trace POST {} -> {} in {} ms (script_len={})",
            warp10_url,
            status.as_u16(),
            started.elapsed().as_millis(),
            script.len()
        );
    }
    let body = resp.text().await?;

    if !status.is_success() {
        tracing::error!(target: "warp10", status = %status, "Warp10 exec returned non-success");
        anyhow::bail!(
            "Warp10 exec failed ({}): {}",
            status,
            &body[..body.len().min(500)]
        );
    }
    serde_json::from_str(&body).map_err(|e| {
        tracing::error!(target: "warp10", err = %e, "Warp10 response JSON parse failed");
        e.into()
    })
}
