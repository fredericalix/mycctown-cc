//! CC notification webhook payloads, parsed just enough to route them to the
//! right `WsFrame`. Everything that isn't a known type is preserved as raw
//! JSON and logged — we want the backend to cope with new CC event types (eg.
//! `NETWORK_GROUP_*`) without crashing.

use crate::ws::frame::WsFrame;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Deserialize;

/// The full set of CC event types we've catalogued from the sniffer.
/// The list of events to subscribe to when creating a webhook.
pub const SUBSCRIBED_EVENTS: &[&str] = &[
    "APPLICATION_CREATION",
    "APPLICATION_DELETION",
    "APPLICATION_REDEPLOY",
    "APPLICATION_STOP",
    "GIT_PUSH",
    "DEPLOYMENT_SUCCESS",
    "DEPLOYMENT_FAIL",
    "ADDON_CREATION",
    "ADDON_DELETION",
];

#[derive(Debug, Deserialize)]
pub struct WebhookEnvelope {
    pub event: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub application: Option<Application>,
    #[serde(default)]
    pub addon: Option<Addon>,
    #[serde(default)]
    pub deployment: Option<Deployment>,
    /// Flat summary CC ships alongside the typed blocks. Used as a fallback
    /// when the typed block is absent (happens for some event variants).
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct Application {
    pub id: String,
    #[serde(default, rename = "ownerId")]
    pub owner_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Addon {
    pub id: String,
    #[serde(default, rename = "ownerId")]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub provider: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct Deployment {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
}

/// Routing info extracted from an event. If `owner_id` is `None` we cannot
/// route the frame — drop the event with a warn log.
pub struct Routing {
    pub owner_id: String,
    pub resource_id: String,
    pub deployment_id: Option<String>,
    pub date: Option<String>,
}

impl WebhookEnvelope {
    pub fn routing(&self) -> Option<Routing> {
        if let Some(app) = &self.application {
            return Some(Routing {
                owner_id: app.owner_id.clone()?,
                resource_id: app.id.clone(),
                deployment_id: self.deployment.as_ref().and_then(|d| d.id.clone()),
                date: self.date.clone(),
            });
        }
        if let Some(addon) = &self.addon {
            return Some(Routing {
                owner_id: addon.owner_id.clone()?,
                resource_id: addon.id.clone(),
                deployment_id: None,
                date: self.date.clone(),
            });
        }
        None
    }

    /// Map a CC event to zero or more `WsFrame`s. `CLEVER_TOOLS_REQUEST` and
    /// unknown event types return an empty vec.
    pub fn to_frames(&self, ts: i64) -> Vec<WsFrame> {
        let event_ts_ms = self
            .date
            .as_deref()
            .and_then(parse_cc_date_to_millis)
            .or(Some(ts * 1000));

        match self.event.as_str() {
            "APPLICATION_CREATION" => single_app(self, "CREATED", None, ts),
            "APPLICATION_DELETION" => self
                .application
                .as_ref()
                .map(|a| {
                    vec![WsFrame::AppRemoved {
                        app_id: a.id.clone(),
                        ts,
                    }]
                })
                .unwrap_or_default(),
            "APPLICATION_REDEPLOY" | "GIT_PUSH" => single_app(self, "DEPLOYING", None, ts),
            "APPLICATION_STOP" => single_app(self, "STOPPED", None, ts),
            "DEPLOYMENT_SUCCESS" => single_app(self, "UP", event_ts_ms, ts),
            "DEPLOYMENT_FAIL" => single_app(self, "FAIL", event_ts_ms, ts),
            "ADDON_CREATION" => self
                .addon
                .as_ref()
                .map(|a| {
                    vec![WsFrame::AddonAdded {
                        addon_id: a.id.clone(),
                        provider: provider_name(&a.provider),
                        ts,
                    }]
                })
                .unwrap_or_default(),
            "ADDON_DELETION" => self
                .addon
                .as_ref()
                .map(|a| {
                    vec![WsFrame::AddonRemoved {
                        addon_id: a.id.clone(),
                        ts,
                    }]
                })
                .unwrap_or_default(),
            "CLEVER_TOOLS_REQUEST" => Vec::new(),
            other => {
                tracing::warn!("unhandled CC webhook event type: {other}");
                Vec::new()
            }
        }
    }
}

fn single_app(env: &WebhookEnvelope, state: &str, last_deploy: Option<i64>, ts: i64) -> Vec<WsFrame> {
    let Some(app) = env.application.as_ref() else {
        return Vec::new();
    };
    vec![WsFrame::AppStatus {
        app_id: app.id.clone(),
        state: state.to_string(),
        last_deploy,
        ts,
    }]
}

fn provider_name(v: &Option<serde_json::Value>) -> Option<String> {
    match v.as_ref()? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(o) => o
            .get("id")
            .or_else(|| o.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        _ => None,
    }
}

/// CC `date` is `2026-04-18T14:05:27.195` — ISO without TZ, treated as UTC.
fn parse_cc_date_to_millis(s: &str) -> Option<i64> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc).timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_application_creation() {
        let raw = r#"{
            "event":"APPLICATION_CREATION",
            "date":"2026-04-18T09:35:39.764",
            "application":{"id":"app_abc","ownerId":"user_xyz","name":"n","instanceType":"magic"}
        }"#;
        let env: WebhookEnvelope = serde_json::from_str(raw).unwrap();
        let frames = env.to_frames(1000);
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            WsFrame::AppStatus { state, app_id, .. } => {
                assert_eq!(state, "CREATED");
                assert_eq!(app_id, "app_abc");
            }
            _ => panic!("wrong frame"),
        }
        let r = env.routing().unwrap();
        assert_eq!(r.owner_id, "user_xyz");
        assert_eq!(r.resource_id, "app_abc");
    }

    #[test]
    fn parses_deployment_success() {
        let raw = r#"{
            "event":"DEPLOYMENT_SUCCESS",
            "date":"2026-04-18T09:19:38.279",
            "application":{"id":"app_abc","ownerId":"orga_xyz"},
            "deployment":{"id":"deployment_1","state":"OK"}
        }"#;
        let env: WebhookEnvelope = serde_json::from_str(raw).unwrap();
        let frames = env.to_frames(1000);
        assert!(matches!(frames[0], WsFrame::AppStatus { ref state, .. } if state == "UP"));
    }

    #[test]
    fn ignores_clever_tools_request() {
        let raw = r#"{"event":"CLEVER_TOOLS_REQUEST","date":"2026-04-18T07:00:00","user":{}}"#;
        let env: WebhookEnvelope = serde_json::from_str(raw).unwrap();
        assert!(env.to_frames(1).is_empty());
    }

    #[test]
    fn addon_creation_with_string_provider() {
        let raw = r#"{
            "event":"ADDON_CREATION",
            "addon":{"id":"addon_1","ownerId":"user_x","provider":"keycloak"}
        }"#;
        let env: WebhookEnvelope = serde_json::from_str(raw).unwrap();
        match &env.to_frames(0)[0] {
            WsFrame::AddonAdded { provider, .. } => {
                assert_eq!(provider.as_deref(), Some("keycloak"));
            }
            _ => panic!(),
        }
    }

    #[test]
    fn unknown_event_does_not_panic() {
        let raw = r#"{"event":"NETWORK_GROUP_CREATION","date":"2026-04-18T07:00:00"}"#;
        let env: WebhookEnvelope = serde_json::from_str(raw).unwrap();
        assert!(env.to_frames(0).is_empty());
    }
}
