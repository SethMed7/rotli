//! `rotli-helper` — the loopback bridge that lets Rotli Web drive the connected
//! AI CLIs the user already has installed.
//!
//! A browser tab cannot spawn `claude`. This small program, run by the user on
//! their own computer, can — and it runs the SAME lane the Mac app uses
//! (`provider::complete_connected` → `provider_lane::complete_blocking`), so
//! every gate applies identically. It is a second binary from this crate and
//! needs no Rotli installation.
//!
//! # Threat model
//!
//! Exposed: three provider verbs — detect a CLI, run one completion, cancel a
//! running one — plus an unauthenticated liveness probe carrying a name and a
//! version. NOT exposed: no vault, no corpus, no note read or write, no
//! filesystem browsing, no Keychain, no settings, no on-device model lane, no
//! MCP surface, no shell. The helper never opens a vault and has no vault path.
//!
//! Defences, in the order a request meets them:
//! - **Loopback only.** The listener refuses a non-loopback address, so nothing
//!   on the LAN can reach it.
//! - **Origin allowlist.** A browser always sends `Origin`; only configured
//!   origins are answered, on `/health` too. Anything else — including the
//!   literal `null` (a sandboxed frame, a `file://` page) — is 403. A request
//!   with NO `Origin` is a non-browser caller (curl) and is allowed; it still
//!   needs the bearer token for anything but `/health`.
//! - **DNS-rebinding guard.** `Host` must be `127.0.0.1:<port>` or
//!   `localhost:<port>`; an attacker hostname rebound to 127.0.0.1 is 400.
//! - **Bearer token.** 64 random characters, compared in constant time,
//!   persisted 0600 under `$HOME/.rotli-helper/token` so a restart keeps the
//!   pairing. Required for every `/rpc` call.
//! - **CORS that names names.** The matching origin is echoed, never `*`, on
//!   every response including the failures (or the browser cannot read the
//!   error). `Access-Control-Allow-Private-Network: true` answers Chrome's
//!   legacy private-network preflight; recent Chrome/Edge/Brave replaced that
//!   with a "local network access" permission prompt NOTHING server-side can
//!   bypass — hence the banner line asking the user to allow it.
//! - **Bounded everything.** 16 concurrent connections (503 beyond), 64 headers
//!   of at most 8 KB, a 24 MB `/rpc` body, a 10 s head-read timeout, and one
//!   live run per request id (409 on a duplicate).
//! - **Text only in v1.** Attached images are refused: the image lanes hand the
//!   CLI a file-reading tool, unreachable-by-design from a browser prompt.
//! - **Secure notes fail closed.** `complete_connected` runs
//!   `crate::secret::blocked_for_remote` before anything is spawned.
//!
//! # Wire contract
//!
//! `GET /health` → 200 `{"ok":true,"name":"rotli-helper","version":"…"}`, no
//! auth, so a page can see "something is there" before pairing. `POST /rpc`
//! `{"cmd":string,"args":object}` → 200 `{"result":…}`, else a 4xx/5xx
//! `{"error":string}`. Error convention: a dispatch refusal (a protected
//! prompt, an uninstalled CLI, a bad argument) is 400, an unknown command 404,
//! a duplicate run 409, the helper's own faults 500. The page treats any
//! non-2xx as an Error carrying `error`; `result` is the command's own shape —
//! a string for `cli_complete`, an object for `cli_detect`, `null` for
//! `cli_cancel`, `[]` for `chat_models`.

use std::collections::HashMap;
use std::io::{BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::loopback_http::{
    bearer_authorized, not_found, read_http_body, read_http_head, unauthorized,
    write_http_response_with_headers, HttpHead,
};
use crate::provider::Running;

const DEFAULT_PORT: u16 = 43111;
/// The MCP adapter's 256 KB is a tool-call budget; a chat turn needs headroom.
const HELPER_MAX_REQUEST_BYTES: usize = 24 * 1024 * 1024;
/// A completion holds its connection for up to ten minutes. Cancel and health
/// must stay answerable, so connections are threaded — and capped, so a flood
/// cannot take every thread and starve the cancel that would end the flood.
const MAX_CONNECTIONS: usize = 16;
const HEAD_READ_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_ORIGINS: &[&str] = &[
    "https://rotli.co",
    "https://dev.rotli.co",
    "http://localhost:1437",
    "http://127.0.0.1:1437",
];
const USAGE: &str = "rotli-helper [--port N] [--origin URL]... [--print-code] [--reset-token]";

struct Options {
    port: u16,
    origins: Vec<String>,
    print_code: bool,
    reset_token: bool,
}

struct Helper {
    port: u16,
    origins: Vec<String>,
    token: String,
    /// request id → the live child, shared across connections so a cancel that
    /// arrives on a SECOND connection can kill a run in flight on the first.
    children: Arc<Mutex<HashMap<String, Running>>>,
}

/// What the request's `Origin` header means. `Absent` = a non-browser caller.
enum OriginVerdict {
    Absent,
    Allowed(String),
    Denied,
}

pub fn run(args: &[String]) -> Result<(), String> {
    let options = parse_args(args)?;
    let token = load_or_create_token(&token_dir()?, options.reset_token)?;
    if options.print_code {
        println!("Pairing code: {}:{token}", options.port);
        return Ok(());
    }
    let address = SocketAddr::from(([127, 0, 0, 1], options.port));
    if !address.ip().is_loopback() {
        return Err("rotli-helper binds loopback only".into());
    }
    let listener = TcpListener::bind(address)
        .map_err(|error| format!("couldn't listen on {address}: {error}"))?;
    println!("Rotli Helper is running on this computer.");
    println!("Pairing code: {}:{token}", options.port);
    println!("Paste it into Rotli Web → Chat → Connect. Press Ctrl+C to stop.");
    println!("If your browser asks to allow local network access, allow it.");
    let port = options.port;
    let children = Arc::new(Mutex::new(HashMap::new()));
    serve(listener, Arc::new(Helper { port, origins: options.origins, token, children }))
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut options = Options {
        port: DEFAULT_PORT,
        origins: DEFAULT_ORIGINS.iter().map(|origin| (*origin).to_string()).collect(),
        print_code: false,
        reset_token: false,
    };
    let mut index = 0;
    while index < args.len() {
        let value = |at: usize, what: &str| {
            args.get(at + 1).cloned().ok_or(format!("{what} needs a value\n{USAGE}"))
        };
        match args[index].as_str() {
            "--port" => {
                options.port = value(index, "--port")?
                    .parse()
                    .map_err(|_| format!("--port must be a TCP port number\n{USAGE}"))?;
                index += 1;
            }
            "--origin" => {
                options.origins.push(normalize_origin(&value(index, "--origin")?));
                index += 1;
            }
            "--print-code" => options.print_code = true,
            "--reset-token" => options.reset_token = true,
            // asking for help is not an error
            "--help" | "-h" => { println!("{USAGE}"); std::process::exit(0) }
            other => return Err(format!("unknown option \"{other}\"\n{USAGE}")),
        }
        index += 1;
    }
    Ok(options)
}

/// Origins compare exactly, so both sides are normalized the way a browser
/// writes one: lowercase, no trailing slash, no path.
fn normalize_origin(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_ascii_lowercase()
}

// ── the token ─────────────────────────────────────────────────────────────────

fn token_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "couldn't find your home directory".to_string())?;
    Ok(PathBuf::from(home).join(".rotli-helper"))
}

/// Two v4 UUIDs without hyphens: 64 characters from the OS CSPRNG.
fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn load_or_create_token(dir: &Path, reset: bool) -> Result<String, String> {
    let path = dir.join("token");
    if !reset {
        if let Ok(existing) = std::fs::read_to_string(&path) {
            let existing = existing.trim().to_string();
            // a truncated or hand-edited file is replaced, never trusted short
            if existing.len() >= 32 {
                return Ok(existing);
            }
        }
    }
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("couldn't create {}: {error}", dir.display()))?;
    set_private(dir, 0o700);
    let token = new_token();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    // created private — never world-readable for even an instant
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|error| format!("couldn't write {}: {error}", path.display()))?;
    file.write_all(token.as_bytes()).map_err(|error| error.to_string())?;
    // an existing file keeps its old mode through O_CREAT, so say it again
    set_private(&path, 0o600);
    Ok(token)
}

#[cfg(unix)]
fn set_private(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt as _;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn set_private(_path: &Path, _mode: u32) {}

// ── the service ───────────────────────────────────────────────────────────────

fn serve(listener: TcpListener, helper: Arc<Helper>) -> Result<(), String> {
    let live = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        if live.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
            let _ = respond(&mut stream, &[], 503, json!({"error":"too many connections"}));
            continue;
        }
        live.fetch_add(1, Ordering::SeqCst);
        let helper = Arc::clone(&helper);
        let live = Arc::clone(&live);
        // a thread per connection: `cli_complete` can hold one for ten minutes,
        // and a cancel or a health probe must not queue behind it
        std::thread::spawn(move || {
            if let Err(error) = handle(stream, &helper) {
                eprintln!("rotli-helper: {error}");
            }
            live.fetch_sub(1, Ordering::SeqCst);
        });
    }
    Ok(())
}

fn handle(mut stream: TcpStream, helper: &Helper) -> Result<(), String> {
    stream.set_read_timeout(Some(HEAD_READ_TIMEOUT)).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let head = read_http_head(&mut reader)?;
    let origin = match helper.origin_verdict(&head) {
        OriginVerdict::Denied => {
            let refusal = json!({"error":"this origin is not paired with Rotli Helper"});
            return respond(&mut stream, &[], 403, refusal);
        }
        OriginVerdict::Absent => None,
        OriginVerdict::Allowed(origin) => Some(origin),
    };
    let cors = cors_headers(origin.as_deref());
    if !helper.host_is_loopback(&head) {
        return respond(&mut stream, &cors, 400, json!({"error":"unexpected Host header"}));
    }
    if head.method == "OPTIONS" {
        // the preflight carries no credential by design — answer before auth
        return write_http_response_with_headers(&mut stream, 204, &cors, None);
    }
    let version = env!("CARGO_PKG_VERSION");
    match (head.method.as_str(), head.path.as_str()) {
        ("GET", "/health") => {
            let alive = json!({"ok": true, "name": "rotli-helper", "version": version});
            respond(&mut stream, &cors, 200, alive)
        }
        ("POST", "/rpc") => serve_rpc(&mut stream, &mut reader, &head, helper, &cors),
        _ => respond(&mut stream, &cors, 404, not_found()),
    }
}

fn cors_headers(origin: Option<&str>) -> Vec<(&'static str, String)> {
    let Some(origin) = origin else { return Vec::new() };
    vec![
        // the matching origin, echoed — never `*`, which would pair the helper
        // with every site the user visits
        ("Access-Control-Allow-Origin", origin.to_string()),
        ("Vary", "Origin".to_string()),
        ("Access-Control-Allow-Headers", "authorization, content-type".to_string()),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS".to_string()),
        ("Access-Control-Allow-Private-Network", "true".to_string()),
        ("Access-Control-Max-Age", "600".to_string()),
    ]
}

fn respond(s: &mut TcpStream, cors: &[(&str, String)], status: u16, body: Value) -> Result<(), String> {
    write_http_response_with_headers(s, status, cors, Some(body))
}

fn serve_rpc(
    stream: &mut TcpStream,
    reader: &mut BufReader<TcpStream>,
    head: &HttpHead,
    helper: &Helper,
    cors: &[(&str, String)],
) -> Result<(), String> {
    if !bearer_authorized(head, &helper.token) {
        return respond(stream, cors, 401, unauthorized());
    }
    let media = head.header("content-type").unwrap_or_default();
    if !media.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case("application/json") {
        return respond(stream, cors, 415, json!({"error":"send application/json"}));
    }
    let raw = match read_http_body(reader, head, HELPER_MAX_REQUEST_BYTES) {
        Ok(raw) => raw,
        Err((status, refusal)) => return respond(stream, cors, status, refusal),
    };
    let Ok(request) = serde_json::from_slice::<Value>(&raw) else {
        return respond(stream, cors, 400, json!({"error":"the request body must be JSON"}));
    };
    let command = request.get("cmd").and_then(Value::as_str).unwrap_or_default().to_string();
    let arguments = request.get("args").cloned().unwrap_or(Value::Null);
    // the run may take minutes and nothing else reads this socket until it
    // ends; a head-read deadline must not cut the answer short
    let _ = stream.set_read_timeout(None);
    match helper.dispatch(&command, &arguments) {
        Ok(result) => respond(stream, cors, 200, json!({ "result": result })),
        Err((status, message)) => respond(stream, cors, status, json!({ "error": message })),
    }
}

fn text_argument(arguments: &Value, key: &str) -> Result<String, (u16, String)> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| (400, format!("\"{key}\" is required")))
}

impl Helper {
    fn origin_verdict(&self, head: &HttpHead) -> OriginVerdict {
        let Some(origin) = head.header("origin") else { return OriginVerdict::Absent };
        let normalized = normalize_origin(origin);
        // "null" is what a sandboxed frame or a file:// page sends; it names no
        // site, so it can never be on an allowlist
        if normalized == "null" || !self.origins.contains(&normalized) {
            return OriginVerdict::Denied;
        }
        OriginVerdict::Allowed(normalized)
    }

    /// A DNS-rebinding guard: an attacker page whose hostname resolves to
    /// 127.0.0.1 reaches this socket, but its `Host` header names the attacker.
    fn host_is_loopback(&self, head: &HttpHead) -> bool {
        let Some(host) = head.header("host") else { return false };
        let host = host.trim().to_ascii_lowercase();
        [format!("127.0.0.1:{}", self.port), format!("localhost:{}", self.port)].contains(&host)
    }

    fn dispatch(&self, command: &str, arguments: &Value) -> Result<Value, (u16, String)> {
        match command {
            "cli_detect" => {
                let provider = text_argument(arguments, "provider")?;
                let detected = crate::provider::detect(&provider).map_err(|e| (400, e))?;
                serde_json::to_value(detected).map_err(|e| (500, e.to_string()))
            }
            "cli_complete" => self.complete(arguments).map(Value::String),
            "cli_cancel" => {
                let request_id = text_argument(arguments, "requestId")?;
                if let Some(running) = self.children.lock().unwrap().get_mut(&request_id) {
                    let _ = running.child.kill();
                }
                Ok(Value::Null)
            }
            // on-device models are the app's lane, not the helper's; the page
            // asks so it can render an empty local section rather than guess
            "chat_models" => Ok(json!([])),
            _ => Err((404, "unknown command".into())),
        }
    }

    fn complete(&self, arguments: &Value) -> Result<String, (u16, String)> {
        let request_id = text_argument(arguments, "requestId")?;
        let provider = text_argument(arguments, "provider")?;
        let model = text_argument(arguments, "model")?;
        let prompt = text_argument(arguments, "prompt")?;
        // v1 is TEXT ONLY: the image lanes enable a file-reading tool on the CLI,
        // unreachable-by-design from a browser prompt. Refused before disk.
        if arguments.get("images").and_then(Value::as_array).is_some_and(|i| !i.is_empty()) {
            return Err((400, "Images are not sent through Rotli Helper in this release.".into()));
        }
        if self.children.lock().unwrap().contains_key(&request_id) {
            return Err((409, format!("a run is already in flight for \"{request_id}\"")));
        }
        let effort = arguments.get("reasoningEffort").and_then(Value::as_str);
        let tier = arguments.get("serviceTier").and_then(Value::as_str);
        let timeout = arguments.get("timeoutMs").and_then(Value::as_u64);
        crate::provider::complete_connected(
            &self.children, &request_id, &provider, &model, &prompt, timeout, effort, tier, &[],
        )
        .map_err(|error| (400, error))
    }
}

#[cfg(test)]
mod tests {
    use std::io::Read as _;

    use super::*;

    /// A real helper on an ephemeral loopback port. No CLI is ever spawned:
    /// every test below stops at a gate or at an unknown provider.
    fn helper() -> (u16, String) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = new_token();
        let origins = DEFAULT_ORIGINS.iter().map(|o| (*o).to_string()).collect();
        let children = Arc::new(Mutex::new(HashMap::new()));
        let service = Helper { port, origins, token: token.clone(), children };
        std::thread::spawn(move || drop(serve(listener, Arc::new(service))));
        (port, token)
    }

    fn raw_request(port: u16, request: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        stream.flush().unwrap();
        let mut answer = String::new();
        let _ = stream.read_to_string(&mut answer);
        answer
    }

    fn rpc(port: u16, authorization: &str, body: &str) -> String {
        raw_request(
            port,
            &format!(
                "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{authorization}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        )
    }

    #[test]
    fn health_answers_without_a_token() {
        let (port, _) = helper();
        let answer = raw_request(port, &format!("GET /health HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"));
        assert!(answer.starts_with("HTTP/1.1 200 OK"), "{answer}");
        assert!(answer.contains("\"name\":\"rotli-helper\""), "{answer}");
        assert!(answer.contains(env!("CARGO_PKG_VERSION")), "{answer}");
    }

    #[test]
    fn rpc_refuses_a_missing_or_wrong_token() {
        let (port, _) = helper();
        let anonymous = rpc(port, "", "{\"cmd\":\"chat_models\",\"args\":{}}");
        assert!(anonymous.starts_with("HTTP/1.1 401"), "{anonymous}");
        let wrong = rpc(port, "Authorization: Bearer not-the-token\r\n", "{\"cmd\":\"chat_models\"}");
        assert!(wrong.starts_with("HTTP/1.1 401"), "{wrong}");
    }

    #[test]
    fn a_preflight_from_an_allowlisted_origin_needs_no_token() {
        let (port, _) = helper();
        let answer = raw_request(
            port,
            &format!("OPTIONS /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://localhost:1437\r\nAccess-Control-Request-Method: POST\r\n\r\n"),
        );
        assert!(answer.starts_with("HTTP/1.1 204 No Content"), "{answer}");
        assert!(!answer.contains("Access-Control-Allow-Origin: *"), "{answer}");
        for expected in [
            "Access-Control-Allow-Origin: http://localhost:1437",
            "Vary: Origin",
            "Access-Control-Allow-Headers: authorization, content-type",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Private-Network: true",
            "Access-Control-Max-Age: 600",
        ] {
            assert!(answer.contains(expected), "{expected} missing from {answer}");
        }
    }

    #[test]
    fn an_unlisted_origin_is_refused_everywhere() {
        let (port, token) = helper();
        for request in [
            format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\n\r\n"),
            format!("OPTIONS /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: null\r\n\r\n"),
            format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\nAuthorization: Bearer {token}\r\nContent-Length: 2\r\n\r\n{{}}"),
        ] {
            let answer = raw_request(port, &request);
            assert!(answer.starts_with("HTTP/1.1 403"), "{answer}");
            assert!(!answer.contains("Access-Control-Allow-Origin"), "{answer}");
        }
    }

    #[test]
    fn a_rebound_host_header_is_refused() {
        let (port, _) = helper();
        let answer = raw_request(port, "GET /health HTTP/1.1\r\nHost: attacker.example\r\n\r\n");
        assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
    }

    #[test]
    fn an_unknown_command_is_a_404_and_an_unknown_route_too() {
        let (port, token) = helper();
        let authorization = format!("Authorization: Bearer {token}\r\n");
        let unknown = rpc(port, &authorization, "{\"cmd\":\"corpus_read\",\"args\":{}}");
        assert!(unknown.starts_with("HTTP/1.1 404"), "{unknown}");
        assert!(unknown.contains("unknown command"), "{unknown}");
        let route = raw_request(port, &format!("GET /vault HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"));
        assert!(route.starts_with("HTTP/1.1 404"), "{route}");
    }

    #[test]
    fn detect_reports_an_unknown_provider_as_an_error() {
        let (port, token) = helper();
        let answer = rpc(
            port,
            &format!("Authorization: Bearer {token}\r\n"),
            "{\"cmd\":\"cli_detect\",\"args\":{\"provider\":\"definitely-not-a-cli\"}}",
        );
        assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
        assert!(answer.contains("unknown provider"), "{answer}");
    }

    #[test]
    fn a_completion_with_images_is_refused_before_anything_is_staged() {
        let (port, token) = helper();
        let answer = rpc(
            port,
            &format!("Authorization: Bearer {token}\r\n"),
            "{\"cmd\":\"cli_complete\",\"args\":{\"requestId\":\"r1\",\"provider\":\"claude\",\"model\":\"sonnet\",\"prompt\":\"hi\",\"images\":[\"AAAA\"]}}",
        );
        assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
        assert!(answer.contains("Images are not sent through Rotli Helper"), "{answer}");
    }

    #[test]
    fn an_oversized_body_is_refused_on_the_header() {
        let (port, token) = helper();
        // 26 MB > the 24 MiB cap, and no body follows: the length alone ends it
        let answer = raw_request(
            port,
            &format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: 26000000\r\n\r\n"),
        );
        assert!(answer.starts_with("HTTP/1.1 413"), "{answer}");
    }

    #[test]
    fn a_missing_length_or_wrong_media_type_is_refused() {
        let (port, token) = helper();
        let no_length = raw_request(
            port,
            &format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\n\r\n"),
        );
        assert!(no_length.starts_with("HTTP/1.1 411"), "{no_length}");
        let wrong_media = raw_request(
            port,
            &format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\n{{}}"),
        );
        assert!(wrong_media.starts_with("HTTP/1.1 415"), "{wrong_media}");
    }

    #[test]
    fn the_token_file_is_private_and_a_restart_reuses_it() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".rotli-helper");
        let first = load_or_create_token(&dir, false).unwrap();
        assert!(first.len() >= 32, "a pairing token must be at least 32 characters");
        let second = load_or_create_token(&dir, false).unwrap();
        assert_eq!(first, second, "a restart must keep the pairing");
        let third = load_or_create_token(&dir, true).unwrap();
        assert_ne!(first, third, "--reset-token must issue a new one");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(dir.join("token")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "the token file must be owner-only");
        }
    }

    #[test]
    fn arguments_parse_into_the_documented_options() {
        let typed = ["--port", "43999", "--origin", "https://Example.test/", "--print-code"];
        let parsed = parse_args(&typed.map(String::from)).unwrap();
        assert_eq!(parsed.port, 43999);
        assert!(parsed.print_code);
        assert!(parsed.origins.contains(&"https://example.test".to_string()));
        assert!(parsed.origins.contains(&"https://rotli.co".to_string()));
        assert!(parse_args(&["--nope".into()]).is_err());
        assert!(parse_args(&["--port".into()]).is_err());
    }
}
