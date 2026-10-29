pub mod frame;
pub mod poller;
pub mod routes;

use dashmap::DashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use frame::WsFrame;

pub struct OrgChannel {
    pub tx: broadcast::Sender<WsFrame>,
    pub subscriber_count: AtomicUsize,
    pub poller_handle: Option<JoinHandle<()>>,
}

pub type OrgBus = Arc<DashMap<String, OrgChannel>>;

pub fn new_bus() -> OrgBus {
    Arc::new(DashMap::new())
}
