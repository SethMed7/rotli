//! A connected client's process, registered under the chat request id so the
//! composer's stop (`cli_cancel`) and a deadline watchdog can both kill it —
//! the lifecycle the ACP lanes and Claude's native session share.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, ChildStderr};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::provider::{Running, NEXT_TOKEN};

/// Register `child` under `request_id` and arm a watchdog that kills it after
/// `deadline` — only if THIS run is still the one registered (the token keeps a
/// stale watchdog from shooting a newer child under a reused id).
pub(crate) fn register(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    child: Child,
    deadline: Duration,
) -> u64 {
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    children.lock().unwrap().insert(request_id.to_string(), Running { token, child });
    let map = Arc::clone(children);
    let id = request_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(deadline);
        if let Some(r) = map.lock().unwrap().get_mut(&id) {
            if r.token == token {
                let _ = r.child.kill();
            }
        }
    });
    token
}

/// Take this run back out of the registry — None when a stop already raced it.
pub(crate) fn reap(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    token: u64,
) -> Option<Running> {
    let mut map = children.lock().unwrap();
    match map.get(request_id) {
        Some(r) if r.token == token => map.remove(request_id),
        _ => None,
    }
}

/// Drain stderr on its own thread so a chatty client can't deadlock stdout.
pub(crate) fn collect_stderr(pipe: Option<ChildStderr>) -> JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut p) = pipe {
            let _ = p.read_to_string(&mut text);
        }
        text
    })
}
