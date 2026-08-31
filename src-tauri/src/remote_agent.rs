//! Opt-in remote-agent connector.
//!
//! The app never listens publicly. It long-polls the relay over an outbound
//! authenticated connection, then hands each JSON-RPC frame to workspace.rs —
//! the same application service used by stdio and loopback HTTP MCP.

use std::io::Read as IoRead;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

use crate::keychain::REMOTE_AGENT_TOKEN_ACCOUNT;

const PAIRING_VERSION: u8 = 1;

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
}

impl Default for RemoteAgentState {
    fn default() -> Self {
        Self {
            status: Arc::new(Mutex::new(RemoteAgentStatus {
                paired: load_pairing().is_some(),
                active: false,
                connected: false,
                relay_url: None,
                last_error: None,
            })),
            stop: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
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

fn new_pairing() -> StoredPairing {
    let pair_id = uuid::Uuid::new_v4().simple().to_string();
    StoredPairing {
        version: PAIRING_VERSION,
        client_token: token("client", &pair_id),
        device_token: token("device", &pair_id),
    }
}

fn load_pairing() -> Option<StoredPairing> {
    let encoded = crate::keychain::get_secret(REMOTE_AGENT_TOKEN_ACCOUNT)?;
    let pairing: StoredPairing = serde_json::from_str(&encoded).ok()?;
    (pairing.version == PAIRING_VERSION).then_some(pairing)
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
    let mut status = state
        .status
        .lock()
        .map_err(|_| "remote agent status lock poisoned")?
        .clone();
    status.paired = load_pairing().is_some();
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
    let pairing = new_pairing();
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

#[allow(clippy::too_many_arguments)]
fn connector_loop(
    base: &str,
    pairing: &StoredPairing,
    root: PathBuf,
    read_only: bool,
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<RemoteAgentStatus>>,
    active_generation: Arc<AtomicU64>,
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
                    let response = crate::workspace::handle_mcp_request_for_root(
                        request,
                        root.clone(),
                        read_only,
                    );
                    let delivered = agent
                        .post(&response_url)
                        .set("Authorization", &format!("Bearer {}", pairing.device_token))
                        .timeout(Duration::from_secs(10))
                        .send_json(json!({ "requestId": request_id, "response": response }));
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
        let pairing = new_pairing();
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
        let pairing = new_pairing();
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
        };
        let connector = std::thread::spawn({
            let base = base.clone();
            let root = temp.path().to_path_buf();
            let status = state.status.clone();
            let generation = state.generation.clone();
            move || connector_loop(&base, &pairing, root, false, stop, status, generation, 0)
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
        let pairing = new_pairing();
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
        let connector_stop = stop.clone();
        let connector = std::thread::spawn({
            let base = base.clone();
            let root = temp.path().to_path_buf();
            let status = status.clone();
            let active_generation = active_generation.clone();
            move || {
                connector_loop(
                    &base,
                    &pairing,
                    root,
                    false,
                    connector_stop,
                    status,
                    active_generation,
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
