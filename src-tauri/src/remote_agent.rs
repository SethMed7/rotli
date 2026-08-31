//! Opt-in remote-agent connector.
//!
//! The app never listens publicly. It long-polls the relay over an outbound
//! authenticated connection, then hands each JSON-RPC frame to workspace.rs —
//! the same application service used by stdio and loopback HTTP MCP.

use std::io::Read as IoRead;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

use crate::keychain::REMOTE_AGENT_TOKEN_ACCOUNT;

const PAIRING_VERSION: u8 = 2;
const RELAY_REQUEST_ID_MAX_BYTES: usize = 64;
const RELAY_RESPONSE_ENVELOPE_BYTES: usize = 256;
const RELAY_MAX_DEVICE_FRAME_BYTES: usize =
    crate::workspace::MCP_MAX_OUTPUT_BYTES + RELAY_RESPONSE_ENVELOPE_BYTES;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteAgentStatus {
    paired: bool,
    active: bool,
    connected: bool,
    relay_url: Option<String>,
    last_error: Option<String>,
}

pub(crate) struct RemoteAgentState {
    status: Arc<Mutex<RemoteAgentStatus>>,
    stop: Mutex<Option<Arc<AtomicBool>>>,
    generation: Arc<AtomicU64>,
    dispatch: Arc<Mutex<()>>,
}

impl Default for RemoteAgentState {
    fn default() -> Self {
        let pairing = load_pairing();
        Self {
            status: Arc::new(Mutex::new(RemoteAgentStatus {
                paired: pairing.is_some(),
                active: false,
                connected: false,
                relay_url: pairing.as_ref().map(pairing_mcp_url),
                last_error: None,
            })),
            stop: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
            dispatch: Arc::new(Mutex::new(())),
        }
    }
}

impl RemoteAgentState {
    fn stop_connector(&self) -> Result<(), String> {
        if let Some(stop) = self
            .stop
            .lock()
            .map_err(|_| "remote agent stop lock poisoned")?
            .take()
        {
            stop.store(true, Ordering::Release);
        }
        self.generation.fetch_add(1, Ordering::AcqRel);
        // A request that already entered the shared workspace dispatcher may
        // finish on its pinned root, but a disconnect/vault switch does not
        // complete until both that dispatch and its response delivery finish.
        // New dispatches observe the generation bump after taking this lock.
        let _dispatch = self
            .dispatch
            .lock()
            .map_err(|_| "remote agent dispatch lock poisoned")?;
        if let Ok(mut status) = self.status.lock() {
            status.active = false;
            status.connected = false;
            status.last_error = None;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPairing {
    version: u8,
    relay_base: String,
    client_token: String,
    device_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteAgentPairing {
    mcp_url: String,
    authorization_header: String,
}

fn token(role: &str, pair_id: &str) -> String {
    format!(
        "rotli_{role}_{pair_id}_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn new_pairing(relay_base: &str) -> StoredPairing {
    let pair_id = uuid::Uuid::new_v4().simple().to_string();
    StoredPairing {
        version: PAIRING_VERSION,
        relay_base: relay_base.to_string(),
        client_token: token("client", &pair_id),
        device_token: token("device", &pair_id),
    }
}

fn load_pairing() -> Option<StoredPairing> {
    let encoded = crate::keychain::get_secret(REMOTE_AGENT_TOKEN_ACCOUNT)?;
    let pairing: StoredPairing = serde_json::from_str(&encoded).ok()?;
    (pairing.version == PAIRING_VERSION).then_some(pairing)
}

fn pairing_mcp_url(pairing: &StoredPairing) -> String {
    format!("{}/mcp", pairing.relay_base)
}

fn require_pairing_relay(pairing: &StoredPairing, base: &str) -> Result<(), String> {
    if pairing.relay_base == base {
        Ok(())
    } else {
        Err(format!(
            "this pairing belongs to {}; create a new pairing before connecting to another relay",
            pairing_mcp_url(pairing)
        ))
    }
}

fn relay_base(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let base = value.strip_suffix("/mcp").unwrap_or(value);
    let parsed = tauri::Url::parse(base).map_err(|_| "enter a valid relay HTTPS URL")?;
    let local_dev = parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"));
    if parsed.scheme() != "https" && !local_dev {
        return Err(
            "the relay must use HTTPS (HTTP is allowed only on loopback for development)".into(),
        );
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("the relay URL must not contain a query or fragment".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("the relay URL must not contain credentials".into());
    }
    Ok(base.to_string())
}

fn require_main_webview(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("remote agents can be paired or connected only from the main Settings window".into())
    }
}

#[tauri::command]
pub(crate) fn remote_agent_status(
    state: tauri::State<'_, RemoteAgentState>,
) -> Result<RemoteAgentStatus, String> {
    let pairing = load_pairing();
    let mut status = state
        .status
        .lock()
        .map_err(|_| "remote agent status lock poisoned")?
        .clone();
    status.paired = pairing.is_some();
    if !status.active {
        status.relay_url = pairing.as_ref().map(pairing_mcp_url);
    }
    Ok(status)
}

#[tauri::command]
pub(crate) fn remote_agent_pair(
    window: tauri::WebviewWindow,
    relay_url: String,
    state: tauri::State<'_, RemoteAgentState>,
) -> Result<RemoteAgentPairing, String> {
    require_main_webview(&window)?;
    let base = relay_base(&relay_url)?;
    state.stop_connector()?;
    let pairing = new_pairing(&base);
    let encoded = serde_json::to_string(&pairing)
        .map_err(|error| format!("encode remote agent pairing: {error}"))?;
    crate::keychain::store_secret(REMOTE_AGENT_TOKEN_ACCOUNT, &encoded)?;
    if let Ok(mut status) = state.status.lock() {
        status.paired = true;
        status.relay_url = Some(format!("{base}/mcp"));
    }
    Ok(RemoteAgentPairing {
        mcp_url: format!("{base}/mcp"),
        authorization_header: format!("Bearer {}", pairing.client_token),
    })
}

#[tauri::command]
pub(crate) fn remote_agent_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    relay_url: String,
    state: tauri::State<'_, RemoteAgentState>,
) -> Result<RemoteAgentStatus, String> {
    require_main_webview(&window)?;
    let base = relay_base(&relay_url)?;
    let pairing = load_pairing().ok_or("pair this Mac before connecting")?;
    require_pairing_relay(&pairing, &base)?;
    let root = app
        .state::<crate::corpus::CorpusState>()
        .default_root_path()?;
    let read_only = crate::development_read_only(&app);

    state.stop_connector()?;
    let generation = state.generation.load(Ordering::Acquire);
    let stop = Arc::new(AtomicBool::new(false));
    *state
        .stop
        .lock()
        .map_err(|_| "remote agent stop lock poisoned")? = Some(stop.clone());
    if let Ok(mut status) = state.status.lock() {
        status.active = true;
        status.connected = false;
        status.relay_url = Some(format!("{base}/mcp"));
        status.last_error = None;
    }
    let status = state.status.clone();
    let active_generation = state.generation.clone();
    let dispatch = state.dispatch.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("rotli-remote-agent".into())
        .spawn(move || {
            connector_loop(
                &base,
                &pairing,
                root,
                read_only,
                stop,
                status,
                active_generation,
                dispatch,
                generation,
            )
        })
    {
        state.stop_connector()?;
        return Err(format!("start remote agent connector: {error}"));
    }
    remote_agent_status(state)
}

#[tauri::command]
pub(crate) fn remote_agent_stop(
    state: tauri::State<'_, RemoteAgentState>,
) -> Result<RemoteAgentStatus, String> {
    state.stop_connector()?;
    remote_agent_status(state)
}

#[tauri::command]
pub(crate) fn remote_agent_unpair(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RemoteAgentState>,
) -> Result<RemoteAgentStatus, String> {
    require_main_webview(&window)?;
    remove_pairing(&state)?;
    remote_agent_status(state)
}

fn remove_pairing(state: &RemoteAgentState) -> Result<(), String> {
    state.stop_connector()?;
    crate::keychain::delete_secret(REMOTE_AGENT_TOKEN_ACCOUNT)?;
    let mut status = state
        .status
        .lock()
        .map_err(|_| "remote agent status lock poisoned")?;
    status.paired = false;
    status.relay_url = None;
    Ok(())
}

pub(crate) fn disconnect_for_vault_change(app: &tauri::AppHandle) -> Result<(), String> {
    stop_for_vault_change(app.try_state::<RemoteAgentState>().as_deref())
}

fn stop_for_vault_change(state: Option<&RemoteAgentState>) -> Result<(), String> {
    if let Some(state) = state {
        state.stop_connector()?;
    }
    Ok(())
}

fn relay_agent() -> ureq::Agent {
    // A relay redirect is a new destination and therefore a new trust decision.
    // Never carry the device credential or a released MCP frame across it.
    ureq::AgentBuilder::new().redirects(0).build()
}

fn read_relay_json(response: ureq::Response) -> Result<Value, String> {
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take((crate::workspace::MCP_MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "relay response could not be read".to_string())?;
    if bytes.len() > crate::workspace::MCP_MAX_REQUEST_BYTES {
        return Err("relay response exceeds the 256 KB limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "relay returned invalid JSON".into())
}

fn begin_dispatch<'a>(
    dispatch: &'a Mutex<()>,
    stop: &AtomicBool,
    active_generation: &AtomicU64,
    generation: u64,
) -> Result<Option<MutexGuard<'a, ()>>, String> {
    let guard = dispatch
        .lock()
        .map_err(|_| "remote agent dispatch lock poisoned")?;
    if stop.load(Ordering::Acquire) || active_generation.load(Ordering::Acquire) != generation {
        return Ok(None);
    }
    Ok(Some(guard))
}

fn relay_response_envelope(request_id: &str, response: Option<Value>) -> Result<Value, String> {
    if request_id.len() > RELAY_REQUEST_ID_MAX_BYTES || !request_id.is_ascii() {
        return Err("relay returned an invalid request id".into());
    }
    let response = response.map(crate::workspace::bounded_mcp_response);
    let envelope = json!({ "requestId": request_id, "response": response });
    if serde_json::to_vec(&envelope)
        .is_ok_and(|encoded| encoded.len() <= RELAY_MAX_DEVICE_FRAME_BYTES)
    {
        Ok(envelope)
    } else {
        Err("workspace response exceeds the relay envelope limit".into())
    }
}

#[allow(clippy::too_many_arguments)]
fn connector_loop(
    base: &str,
    pairing: &StoredPairing,
    root: PathBuf,
    read_only: bool,
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<RemoteAgentStatus>>,
    active_generation: Arc<AtomicU64>,
    dispatch: Arc<Mutex<()>>,
    generation: u64,
) {
    let poll_url = format!("{base}/device/poll");
    let response_url = format!("{base}/device/respond");
    let agent = relay_agent();
    while !stop.load(Ordering::Acquire) {
        let response = agent
            .post(&poll_url)
            .set("Authorization", &format!("Bearer {}", pairing.device_token))
            .timeout(Duration::from_secs(30))
            .send_json(json!({
                "device": "rotli-workspace",
                "clientToken": pairing.client_token,
            }));
        match response {
            Ok(response) if response.status() == 204 => {
                set_connected(&status, &active_generation, generation, true, None)
            }
            Ok(response) => match read_relay_json(response) {
                Ok(envelope) => {
                    // Regeneration and vault switching stop the old connector.
                    // Never dispatch a request released from an outstanding poll
                    // after either boundary changes.
                    if stop.load(Ordering::Acquire)
                        || active_generation.load(Ordering::Acquire) != generation
                    {
                        break;
                    }
                    set_connected(&status, &active_generation, generation, true, None);
                    let Some(request_id) = envelope.get("requestId").and_then(Value::as_str) else {
                        set_connected(
                            &status,
                            &active_generation,
                            generation,
                            false,
                            Some("relay returned an invalid request envelope"),
                        );
                        continue;
                    };
                    let Some(request) = envelope.get("request") else {
                        set_connected(
                            &status,
                            &active_generation,
                            generation,
                            false,
                            Some("relay returned an invalid request envelope"),
                        );
                        continue;
                    };
                    // Hold this guard through dispatch AND response delivery.
                    // A disconnect or vault switch first invalidates the
                    // generation, then waits here, so no old-root result can
                    // be written or released after the boundary completes.
                    let _dispatch =
                        match begin_dispatch(&dispatch, &stop, &active_generation, generation) {
                            Ok(Some(guard)) => guard,
                            Ok(None) => break,
                            Err(_) => {
                                set_connected(
                                    &status,
                                    &active_generation,
                                    generation,
                                    false,
                                    Some("remote agent dispatch is unavailable"),
                                );
                                break;
                            }
                        };
                    let response = crate::workspace::handle_mcp_request_for_root(
                        request,
                        root.clone(),
                        read_only,
                    );
                    let response_envelope = match relay_response_envelope(request_id, response) {
                        Ok(envelope) => envelope,
                        Err(_) => {
                            set_connected(
                                &status,
                                &active_generation,
                                generation,
                                false,
                                Some("workspace response exceeded the relay limit"),
                            );
                            continue;
                        }
                    };
                    let delivered = agent
                        .post(&response_url)
                        .set("Authorization", &format!("Bearer {}", pairing.device_token))
                        .timeout(Duration::from_secs(10))
                        .send_json(response_envelope);
                    if delivered.is_err() {
                        set_connected(
                            &status,
                            &active_generation,
                            generation,
                            false,
                            Some("the relay did not accept Rotli's response"),
                        );
                    }
                }
                Err(_) => set_connected(
                    &status,
                    &active_generation,
                    generation,
                    false,
                    Some("relay returned invalid JSON"),
                ),
            },
            Err(ureq::Error::Status(408, _)) => {
                set_connected(&status, &active_generation, generation, true, None)
            }
            Err(_) => {
                set_connected(
                    &status,
                    &active_generation,
                    generation,
                    false,
                    Some("could not reach the relay"),
                );
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }
    if active_generation.load(Ordering::Acquire) == generation {
        if let Ok(mut status) = status.lock() {
            status.active = false;
            status.connected = false;
        }
    }
}

fn set_connected(
    status: &Arc<Mutex<RemoteAgentStatus>>,
    active_generation: &AtomicU64,
    generation: u64,
    connected: bool,
    error: Option<&str>,
) {
    if active_generation.load(Ordering::Acquire) != generation {
        return;
    }
    if let Ok(mut status) = status.lock() {
        status.connected = connected;
        status.last_error = error.map(str::to_string);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{BufRead, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;
    use tempfile::TempDir;

    fn read_request(stream: &mut TcpStream) -> (String, Value) {
        let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
        let mut headers = String::new();
        let mut content_length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" || line.is_empty() {
                break;
            }
            if let Some(value) = line
                .strip_prefix("Content-Length:")
                .or_else(|| line.strip_prefix("content-length:"))
            {
                content_length = value.trim().parse().unwrap();
            }
            headers.push_str(&line);
        }
        let mut body = vec![0; content_length];
        reader.read_exact(&mut body).unwrap();
        (headers, serde_json::from_slice(&body).unwrap())
    }

    fn write_json(stream: &mut TcpStream, value: &Value) {
        let body = serde_json::to_vec(value).unwrap();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        stream.write_all(&body).unwrap();
        stream.flush().unwrap();
    }

    #[test]
    fn relay_requires_https_except_for_loopback_development() {
        assert_eq!(
            relay_base("https://relay.example/mcp").unwrap(),
            "https://relay.example"
        );
        assert!(relay_base("http://127.0.0.1:8787/mcp").is_ok());
        assert!(relay_base("http://relay.example/mcp").is_err());
        assert!(relay_base("https://relay.example/mcp?device=x").is_err());
    }

    #[test]
    fn pairing_uses_independent_role_bound_tokens() {
        let pairing = new_pairing("https://relay.example");
        let client = pairing.client_token.split('_').collect::<Vec<_>>();
        let device = pairing.device_token.split('_').collect::<Vec<_>>();
        assert_eq!(client.len(), 4);
        assert_eq!(device.len(), 4);
        assert_eq!(client[1], "client");
        assert_eq!(device[1], "device");
        assert_eq!(client[2], device[2]);
        assert_ne!(client[3], device[3]);
        assert_eq!(client[2].len(), 32);
        assert_eq!(client[3].len(), 64);
        assert_eq!(pairing_mcp_url(&pairing), "https://relay.example/mcp");
        assert!(require_pairing_relay(&pairing, "https://relay.example").is_ok());
        assert!(require_pairing_relay(&pairing, "https://hostile.example")
            .unwrap_err()
            .contains("create a new pairing"));
    }

    #[test]
    fn stopping_a_connector_invalidates_its_generation() {
        let state = RemoteAgentState {
            status: Arc::new(Mutex::new(RemoteAgentStatus {
                paired: true,
                active: true,
                connected: true,
                relay_url: Some("https://relay.example/mcp".into()),
                last_error: Some("old error".into()),
            })),
            stop: Mutex::new(Some(Arc::new(AtomicBool::new(false)))),
            generation: Arc::new(AtomicU64::new(7)),
            dispatch: Arc::new(Mutex::new(())),
        };
        let stop = state.stop.lock().unwrap().as_ref().unwrap().clone();
        state.stop_connector().unwrap();
        let status = state.status.lock().unwrap();
        assert!(stop.load(Ordering::Acquire));
        assert_eq!(state.generation.load(Ordering::Acquire), 8);
        assert!(!status.active);
        assert!(!status.connected);
        assert!(status.last_error.is_none());
    }

    #[test]
    fn removing_a_pairing_disconnects_and_deletes_the_keychain_bundle() {
        let pairing = new_pairing("https://relay.example");
        crate::keychain::store_secret(
            REMOTE_AGENT_TOKEN_ACCOUNT,
            &serde_json::to_string(&pairing).unwrap(),
        )
        .unwrap();
        let state = RemoteAgentState {
            status: Arc::new(Mutex::new(RemoteAgentStatus {
                paired: true,
                active: true,
                connected: true,
                relay_url: Some("https://relay.example/mcp".into()),
                last_error: None,
            })),
            stop: Mutex::new(Some(Arc::new(AtomicBool::new(false)))),
            generation: Arc::new(AtomicU64::new(3)),
            dispatch: Arc::new(Mutex::new(())),
        };
        let stop = state.stop.lock().unwrap().as_ref().unwrap().clone();

        remove_pairing(&state).unwrap();

        assert!(stop.load(Ordering::Acquire));
        assert_eq!(state.generation.load(Ordering::Acquire), 4);
        assert!(load_pairing().is_none());
        let status = state.status.lock().unwrap();
        assert!(!status.paired);
        assert!(!status.active);
        assert!(!status.connected);
        assert!(status.relay_url.is_none());
    }

    #[test]
    fn vault_change_refuses_to_continue_when_the_connector_cannot_stop() {
        let state = RemoteAgentState::default();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.stop.lock().unwrap();
            panic!("poison the stop lock");
        }));
        assert_eq!(
            stop_for_vault_change(Some(&state)).unwrap_err(),
            "remote agent stop lock poisoned"
        );
        assert!(stop_for_vault_change(None).is_ok());
    }

    #[test]
    fn relay_transport_refuses_redirects_and_oversized_frames() {
        let redirected = TcpListener::bind("127.0.0.1:0").unwrap();
        redirected.set_nonblocking(true).unwrap();
        let redirected_address = redirected.local_addr().unwrap();
        let relay = TcpListener::bind("127.0.0.1:0").unwrap();
        let relay_address = relay.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = relay.accept().unwrap();
            let _ = read_request(&mut stream);
            write!(
                stream,
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{redirected_address}/device/poll\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            stream.flush().unwrap();
        });
        let result = relay_agent()
            .post(&format!("http://{relay_address}/device/poll"))
            .timeout(Duration::from_millis(500))
            .send_json(json!({}));
        match result {
            Ok(response) => assert_eq!(response.status(), 307),
            Err(ureq::Error::Status(status, _)) => assert_eq!(status, 307),
            Err(error) => panic!("unexpected redirect result: {error}"),
        }
        server.join().unwrap();
        assert!(matches!(
            redirected.accept(),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock
        ));

        let relay = TcpListener::bind("127.0.0.1:0").unwrap();
        let relay_address = relay.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = relay.accept().unwrap();
            let _ = read_request(&mut stream);
            write_json(
                &mut stream,
                &json!({ "padding": "x".repeat(crate::workspace::MCP_MAX_REQUEST_BYTES) }),
            );
        });
        let response = relay_agent()
            .post(&format!("http://{relay_address}/device/poll"))
            .send_json(json!({}))
            .unwrap();
        assert!(read_relay_json(response)
            .unwrap_err()
            .contains("exceeds the 256 KB limit"));
        server.join().unwrap();
    }

    #[test]
    fn connector_bounds_the_complete_response_envelope() {
        let envelope = relay_response_envelope(
            "relay-request-1",
            Some(json!({
                "jsonrpc": "2.0",
                "id": 7,
                "result": { "content": "x".repeat(crate::workspace::MCP_MAX_OUTPUT_BYTES) }
            })),
        )
        .unwrap();
        assert_eq!(
            envelope
                .pointer("/response/error/code")
                .and_then(Value::as_i64),
            Some(-32603)
        );
        assert!(serde_json::to_vec(&envelope).unwrap().len() <= RELAY_MAX_DEVICE_FRAME_BYTES);
        assert!(
            relay_response_envelope(&"x".repeat(RELAY_REQUEST_ID_MAX_BYTES + 1), None).is_err()
        );
    }

    #[test]
    fn disconnect_waits_for_an_in_flight_dispatch_and_blocks_the_next_one() {
        let state = Arc::new(RemoteAgentState {
            status: Arc::new(Mutex::new(RemoteAgentStatus {
                paired: true,
                active: true,
                connected: true,
                relay_url: Some("https://relay.example/mcp".into()),
                last_error: None,
            })),
            stop: Mutex::new(Some(Arc::new(AtomicBool::new(false)))),
            generation: Arc::new(AtomicU64::new(4)),
            dispatch: Arc::new(Mutex::new(())),
        });
        let in_flight = state.dispatch.lock().unwrap();
        let (stopped_tx, stopped_rx) = mpsc::channel();
        let stopping = std::thread::spawn({
            let state = state.clone();
            move || {
                state.stop_connector().unwrap();
                stopped_tx.send(()).unwrap();
            }
        });

        while state.generation.load(Ordering::Acquire) == 4 {
            std::thread::yield_now();
        }
        assert!(stopped_rx.try_recv().is_err());
        drop(in_flight);
        stopped_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        stopping.join().unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        assert!(begin_dispatch(&state.dispatch, &stop, &state.generation, 4)
            .unwrap()
            .is_none());
    }

    #[test]
    fn stopping_an_outstanding_poll_blocks_dispatch_into_the_old_vault() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("wiki/_inbox")).unwrap();
        fs::write(
            temp.path().join("memex.json"),
            r#"{"id":"mx_remote_stop_test","contract":"3.4","apps":{}}"#,
        )
        .unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let pairing = new_pairing(&base);
        let (polled_tx, polled_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let relay = std::thread::spawn(move || {
            let (mut poll, _) = listener.accept().unwrap();
            let _ = read_request(&mut poll);
            polled_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            write_json(
                &mut poll,
                &json!({
                    "requestId": "stale-vault-request",
                    "request": {
                        "jsonrpc": "2.0",
                        "id": 9,
                        "method": "tools/call",
                        "params": {
                            "name": "rotli_create_note",
                            "arguments": { "title": "Must not land", "body": "stale connector" }
                        }
                    }
                }),
            );
        });

        let stop = Arc::new(AtomicBool::new(false));
        let state = RemoteAgentState {
            status: Arc::new(Mutex::new(RemoteAgentStatus {
                paired: true,
                active: true,
                connected: false,
                relay_url: Some(format!("{base}/mcp")),
                last_error: None,
            })),
            stop: Mutex::new(Some(stop.clone())),
            generation: Arc::new(AtomicU64::new(0)),
            dispatch: Arc::new(Mutex::new(())),
        };
        let connector = std::thread::spawn({
            let base = base.clone();
            let root = temp.path().to_path_buf();
            let status = state.status.clone();
            let generation = state.generation.clone();
            let dispatch = state.dispatch.clone();
            move || {
                connector_loop(
                    &base, &pairing, root, false, stop, status, generation, dispatch, 0,
                )
            }
        });

        polled_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        state.stop_connector().unwrap();
        release_tx.send(()).unwrap();
        relay.join().unwrap();
        connector.join().unwrap();
        assert!(!temp.path().join("wiki/_inbox/must-not-land.md").exists());
    }

    #[test]
    fn connector_round_trips_a_relay_frame_into_a_temporary_vault() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("wiki/_inbox")).unwrap();
        fs::create_dir_all(temp.path().join("storage/excalidraw")).unwrap();
        fs::write(
            temp.path().join("memex.json"),
            r#"{"id":"mx_remote_network_test","contract":"3.4","apps":{}}"#,
        )
        .unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let pairing = new_pairing(&base);
        let expected_device = pairing.device_token.clone();
        let expected_client = pairing.client_token.clone();
        let (delivered_tx, delivered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let relay = std::thread::spawn(move || {
            let (mut poll, _) = listener.accept().unwrap();
            let (headers, body) = read_request(&mut poll);
            assert!(headers.contains(&format!("Bearer {expected_device}")));
            assert_eq!(
                body.get("clientToken").and_then(Value::as_str),
                Some(expected_client.as_str())
            );
            write_json(
                &mut poll,
                &json!({
                    "requestId": "relay-request-1",
                    "request": {
                        "jsonrpc": "2.0",
                        "id": 7,
                        "method": "tools/call",
                        "params": {
                            "name": "rotli_create_note",
                            "arguments": { "title": "From network relay", "body": "complete relay round trip" }
                        }
                    }
                }),
            );

            let (mut response, _) = listener.accept().unwrap();
            let (headers, body) = read_request(&mut response);
            assert!(headers.contains(&format!("Bearer {expected_device}")));
            delivered_tx.send(body).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            write_json(&mut response, &json!({ "accepted": true }));
        });

        let stop = Arc::new(AtomicBool::new(false));
        let status = Arc::new(Mutex::new(RemoteAgentStatus {
            paired: true,
            active: true,
            connected: false,
            relay_url: Some(format!("{base}/mcp")),
            last_error: None,
        }));
        let active_generation = Arc::new(AtomicU64::new(0));
        let dispatch = Arc::new(Mutex::new(()));
        let connector_stop = stop.clone();
        let connector = std::thread::spawn({
            let base = base.clone();
            let root = temp.path().to_path_buf();
            let status = status.clone();
            let active_generation = active_generation.clone();
            let dispatch = dispatch.clone();
            move || {
                connector_loop(
                    &base,
                    &pairing,
                    root,
                    false,
                    connector_stop,
                    status,
                    active_generation,
                    dispatch,
                    0,
                )
            }
        });

        let delivered = delivered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            delivered
                .pointer("/response/result/isError")
                .and_then(Value::as_bool),
            Some(false)
        );
        let note_id = delivered
            .pointer("/response/result/structuredContent/note/id")
            .and_then(Value::as_str)
            .unwrap()
            .to_string();
        stop.store(true, Ordering::Release);
        release_tx.send(()).unwrap();
        relay.join().unwrap();
        connector.join().unwrap();

        let note =
            fs::read_to_string(temp.path().join("wiki/_inbox/from-network-relay.md")).unwrap();
        assert!(note.contains("complete relay round trip"));
        let main = fs::read_to_string(temp.path().join(".rotli/main.json")).unwrap();
        assert!(main.contains(&note_id));
    }
}
