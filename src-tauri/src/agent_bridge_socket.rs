//! The agent bridge's socket (agent_bridge.rs; docs/decisions/
//! 2026-10-01-agent-app-bridge.md): how a headless `rotli mcp` reaches the
//! running app. One JSON line in, one answer line out, over a Unix socket in a
//! user-only folder of Rotli's app-support folder (never a vault). The app
//! side caps requests in flight and hands each to `agent_bridge::dispatch`.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::agent_bridge::{dispatch, BridgeRequest, ANSWER_MAX, BRIDGE_TOOLS};

/// One request or answer line; mirrors the MCP envelope limits.
const LINE_MAX: u64 = 600_000;
/// Socket requests carried at once; a runaway agent loop gets refusals, not threads.
const IN_FLIGHT_MAX: usize = 8;
const NOT_RUNNING: &str =
    "Rotli isn't running. Open Rotli on this Mac to read or edit Word documents, then try again.";


#[derive(Debug, Serialize, Deserialize)]
struct BridgeAnswer {
    ok: bool,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: Option<String>,
}

/// The socket, inside its own user-only folder in Rotli's app-support folder.
pub(crate) fn socket_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("ROTLI_AGENT_BRIDGE_SOCKET") {
        return Ok(PathBuf::from(path));
    }
    let config = crate::workspace::production_config_path()?;
    let dir = config.parent().ok_or("Rotli's settings folder is unavailable")?;
    Ok(dir.join("agent-bridge").join("bridge.sock"))
}

pub(crate) fn ask_over_socket(path: &Path, request: &BridgeRequest) -> Result<Value, String> {
    use std::os::unix::net::UnixStream;
    let mut stream = UnixStream::connect(path).map_err(|_| NOT_RUNNING.to_string())?;
    let _ = stream.set_read_timeout(Some(ANSWER_MAX + Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut line = serde_json::to_vec(request).map_err(|e| e.to_string())?;
    line.push(b'\n');
    stream.write_all(&line).map_err(|_| NOT_RUNNING.to_string())?;
    let mut answer = String::new();
    BufReader::new(stream.take(LINE_MAX))
        .read_line(&mut answer)
        .map_err(|_| "Rotli didn't answer in time".to_string())?;
    let answer: BridgeAnswer =
        serde_json::from_str(answer.trim()).map_err(|_| "Rotli sent an unreadable answer".to_string())?;
    if answer.ok {
        Ok(answer.result)
    } else {
        Err(answer.error.unwrap_or_else(|| "Rotli refused the request".into()))
    }
}

/// Bind the socket inside a folder only this user can enter (0700), so it is
/// private from the moment it exists, whatever the umask; the socket itself
/// is then 0600. Another Rotli already answering keeps its socket.
fn bind_private(path: &Path) -> Result<std::os::unix::net::UnixListener, String> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    let dir = path.parent().ok_or("the bridge socket has no folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    if UnixStream::connect(path).is_ok() {
        return Err("another Rotli is already listening".into());
    }
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path).map_err(|e| e.to_string())?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    Ok(listener)
}

/// How many socket requests run at once. A ticket frees its place when it
/// drops, a panicking request thread included.
struct InFlight {
    count: AtomicUsize,
    max: usize,
}

struct Ticket(std::sync::Arc<InFlight>);

impl InFlight {
    fn enter(gate: &std::sync::Arc<InFlight>) -> Option<Ticket> {
        if gate.count.fetch_add(1, Ordering::AcqRel) >= gate.max {
            gate.count.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(Ticket(gate.clone()))
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        self.0.count.fetch_sub(1, Ordering::AcqRel);
    }
}

fn write_answer(stream: &mut impl Write, answer: &BridgeAnswer) {
    if let Ok(mut bytes) = serde_json::to_vec(answer) {
        bytes.push(b'\n');
        let _ = stream.write_all(&bytes);
    }
}

pub(crate) fn listen(app: &AppHandle, path: &Path) -> Result<(), String> {
    let listener = bind_private(path)?;
    let gate = std::sync::Arc::new(InFlight { count: AtomicUsize::new(0), max: IN_FLIGHT_MAX });
    for mut stream in listener.incoming().flatten() {
        let Some(ticket) = InFlight::enter(&gate) else {
            write_answer(&mut stream, &refusal(BUSY));
            continue;
        };
        let app = app.clone();
        let _ = std::thread::Builder::new().name("rotli-agent-request".into()).spawn(move || {
            let _ticket = ticket;
            serve(&app, stream);
        });
    }
    Ok(())
}

const BUSY: &str = "Rotli is busy with other agent requests; try again in a moment";

fn refusal(error: &str) -> BridgeAnswer {
    BridgeAnswer { ok: false, result: Value::Null, error: Some(error.into()) }
}

fn serve(app: &AppHandle, stream: std::os::unix::net::UnixStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut line = String::new();
    if BufReader::new(stream.take(LINE_MAX)).read_line(&mut line).is_err() {
        return;
    }
    let answer = match serde_json::from_str::<BridgeRequest>(line.trim()) {
        Ok(request) if BRIDGE_TOOLS.contains(&request.tool.as_str()) => dispatch(app, request),
        Ok(request) => Err(format!("unknown document tool: {}", request.tool)),
        Err(_) => Err("unreadable request".into()),
    };
    let answer = match answer {
        Ok(result) => BridgeAnswer { ok: true, result, error: None },
        Err(error) => refusal(&error),
    };
    write_answer(&mut writer, &answer);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(tool: &str, root: &Path) -> BridgeRequest {
        BridgeRequest {
            tool: tool.into(),
            args: json!({ "file": "storage/rotli/plan.docx" }),
            root: root.to_path_buf(),
            read_only: false,
            agent: "claude-code".into(),
        }
    }

    #[test]
    fn the_socket_is_private_from_the_moment_it_exists() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("agent-bridge").join("bridge.sock");
        let listener = bind_private(&path).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(path.parent().unwrap()), 0o700);
        assert_eq!(mode(&path), 0o600);
        // a live listener keeps its socket; a dead one is replaced
        assert!(bind_private(&path).unwrap_err().contains("already listening"));
        drop(listener);
        assert!(bind_private(&path).is_ok());
    }

    #[test]
    fn too_many_requests_are_refused_and_a_place_frees_even_when_a_request_panics() {
        let gate = std::sync::Arc::new(InFlight { count: AtomicUsize::new(0), max: 2 });
        let first = InFlight::enter(&gate).unwrap();
        let second = InFlight::enter(&gate);
        assert!(second.is_some());
        assert!(InFlight::enter(&gate).is_none(), "busy at the cap");
        drop(first);
        let panicking = {
            let ticket = InFlight::enter(&gate).unwrap();
            std::thread::spawn(move || {
                let _ticket = ticket;
                panic!("a request thread failed");
            })
        };
        assert!(panicking.join().is_err());
        assert!(InFlight::enter(&gate).is_some(), "the panicked request's place came back");
    }

    #[test]
    fn a_headless_agent_hears_when_rotli_isnt_running() {
        let dir = tempfile::TempDir::new().unwrap();
        let error = ask_over_socket(&dir.path().join("none.sock"), &request("read_document", dir.path()))
            .unwrap_err();
        assert_eq!(error, NOT_RUNNING);
    }

    #[test]
    fn the_socket_carries_one_request_and_one_answer() {
        use std::os::unix::net::UnixListener;
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("bridge.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut writer = stream.try_clone().unwrap();
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).unwrap();
            let asked: BridgeRequest = serde_json::from_str(line.trim()).unwrap();
            let answer = BridgeAnswer { ok: false, result: Value::Null, error: Some(format!("refused {}", asked.tool)) };
            writer.write_all(&[serde_json::to_vec(&answer).unwrap(), b"\n".to_vec()].concat()).unwrap();
        });
        let error = ask_over_socket(&path, &request("apply_document", dir.path())).unwrap_err();
        server.join().unwrap();
        assert_eq!(error, "refused apply_document");
    }
}
