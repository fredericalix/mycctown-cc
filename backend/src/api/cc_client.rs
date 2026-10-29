use crate::auth::oauth::sign_api_request;
use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcOrganisation {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcApplication {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type", default)]
    pub app_type: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub instance: Option<CcInstance>,
    #[serde(default)]
    pub zone: Option<String>,
    #[serde(default)]
    pub last_deploy: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcInstance {
    #[serde(rename = "type")]
    pub instance_type: Option<String>,
    pub variant: Option<CcVariant>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcVariant {
    pub name: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcAddon {
    pub id: String,
    pub name: String,
    #[serde(rename = "realId", default)]
    pub real_id: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub provider: Option<CcAddonProvider>,
    #[serde(rename = "creationDate", default)]
    pub creation_date: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcAddonProvider {
    pub id: Option<String>,
    pub name: Option<String>,
}

pub struct CcClient<'a> {
    http: &'a reqwest::Client,
    config: &'a Config,
    access_token: String,
    access_secret: String,
}

impl<'a> CcClient<'a> {
    pub fn new(
        http: &'a reqwest::Client,
        config: &'a Config,
        access_token: String,
        access_secret: String,
    ) -> Self {
        CcClient {
            http,
            config,
            access_token,
            access_secret,
        }
    }

    fn sign(&self, method: &str, url: &str) -> String {
        sign_api_request(
            method,
            url,
            &self.config.cc_consumer_key,
            &self.config.cc_consumer_secret,
            &self.access_token,
            &self.access_secret,
        )
    }

    async fn get_signed(&self, url: &str) -> anyhow::Result<String> {
        let auth = self.sign("GET", url);
        let started = Instant::now();
        let resp = match self
            .http
            .get(url)
            .header("Authorization", &auth)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                if self.config.debug_cc_api {
                    tracing::info!(
                        "cc-trace GET {} -> network error in {} ms ({})",
                        url,
                        started.elapsed().as_millis(),
                        e
                    );
                }
                return Err(e.into());
            }
        };
        let status = resp.status();
        if self.config.debug_cc_api {
            tracing::info!(
                "cc-trace GET {} -> {} in {} ms",
                url,
                status.as_u16(),
                started.elapsed().as_millis()
            );
        }
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("CC API GET {} failed ({}): {}", url, status, body);
        }
        Ok(body)
    }

    pub async fn list_organisations(&self) -> anyhow::Result<Vec<CcOrganisation>> {
        let url = format!("{}/v2/organisations", self.config.cc_api_base_url);
        let body = self.get_signed(&url).await?;
        Ok(serde_json::from_str(&body)?)
    }

    pub async fn list_applications(&self, org_id: &str) -> anyhow::Result<Vec<CcApplication>> {
        let url = format!(
            "{}/v2/organisations/{}/applications",
            self.config.cc_api_base_url, org_id
        );
        let body = self.get_signed(&url).await?;
        serde_json::from_str(&body).map_err(|e| {
            tracing::error!("parse applications: {} body={}", e, &body[..body.len().min(300)]);
            anyhow::anyhow!("JSON parse error: {}", e)
        })
    }

    pub async fn list_addons(&self, org_id: &str) -> anyhow::Result<Vec<CcAddon>> {
        let url = format!(
            "{}/v2/organisations/{}/addons",
            self.config.cc_api_base_url, org_id
        );
        let body = self.get_signed(&url).await?;
        serde_json::from_str(&body).map_err(|e| {
            tracing::error!("parse addons: {} body={}", e, &body[..body.len().min(300)]);
            anyhow::anyhow!("JSON parse error: {}", e)
        })
    }

    pub async fn get_metrics_token(&self, org_id: &str) -> anyhow::Result<String> {
        let url = format!(
            "{}/v2/metrics/read/{}",
            self.config.cc_api_base_url, org_id
        );
        let body = self.get_signed(&url).await?;
        Ok(body.trim().trim_matches('"').to_string())
    }

    /// Addons linked to a given application. Used by the dependency graph to
    /// correlate addon health to app health (e.g. if a postgres addon is
    /// stopped, the linked app gets tinted orange in the 3D scene).
    pub async fn list_linked_addons(
        &self,
        org_id: &str,
        app_id: &str,
    ) -> anyhow::Result<Vec<CcAddon>> {
        let url = format!(
            "{}/v2/organisations/{}/applications/{}/addons",
            self.config.cc_api_base_url, org_id, app_id
        );
        let body = self.get_signed(&url).await?;
        serde_json::from_str(&body).map_err(|e| {
            tracing::error!(
                "parse linked addons for app {}: {} body={}",
                app_id,
                e,
                &body[..body.len().min(300)]
            );
            anyhow::anyhow!("JSON parse error: {}", e)
        })
    }
}
