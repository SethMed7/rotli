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

use crate::helper_args::{normalize_origin, parse_args};
use std::collections::{HashMap, HashSet};
use std::io::BufReader;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::helper_token::{load_or_create_token, token_dir};
use crate::loopback_http::{
    bearer_authorized, drain_http_body, malformed_head, not_found, read_http_body, read_http_head, unauthorized,
    write_http_response_with_headers, HttpHead,
};
use crate::provider::Running;

/// The MCP adapter's 256 KB is a tool-call budget; a chat turn needs headroom.
const HELPER_MAX_REQUEST_BYTES: usize = 24 * 1024 * 1024;
/// A completion holds its connection for up to ten minutes. Cancel and health
/// must stay answerable, so connections are threaded — and capped, so a flood
/// cannot take every thread and starve the cancel that would end the flood.
const MAX_CONNECTIONS: usize = 16;
const HEAD_READ_TIMEOUT: Duration = Duration::from_secs(10);

struct Helper {
    port: u16,
    origins: Vec<String>,
    token: String,
    /// request id → the live child, shared across connections so a cancel that
    /// arrives on a SECOND connection can kill a run in flight on the first.
    children: Arc<Mutex<HashMap<String, Running>>>,
    /// Request ids with a run in flight. Reserved BEFORE the spawn and released
    /// on every exit path, so two concurrent turns cannot share an id.
    in_flight: Mutex<HashSet<String>>,
}

/// A request id held for one run. Taking it is atomic with the duplicate test
/// (one `HashSet::insert`, one lock) and `Drop` gives it back on every path.
struct Reservation<'a> {
    ids: &'a Mutex<HashSet<String>>,
    id: String,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        self.ids.lock().unwrap().remove(&self.id);
    }
}

fn reserve<'a>(ids: &'a Mutex<HashSet<String>>, id: &str) -> Option<Reservation<'a>> {
    let taken = ids.lock().unwrap().insert(id.to_string());
    taken.then(|| Reservation { ids, id: id.to_string() })
}

/// What `Origin` means here. `Absent` = a non-browser caller.
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
    let origins = options.origins;
    let in_flight = Mutex::new(HashSet::new());
    serve(listener, Arc::new(Helper { port, origins, token, children, in_flight }))
}

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
    let head = match read_http_head(&mut reader) {
        Ok(head) => head,
        // no Origin was parsed, so no CORS headers can be trusted onto this one
        Err(_) => return respond(&mut stream, &[], 400, malformed_head()),
    };
    let origin = match helper.origin_verdict(&head) {
        OriginVerdict::Denied => {
            let refusal = json!({"error":"this origin is not paired with Rotli Helper"});
            return refuse(&mut stream, &mut reader, &head, &[], 403, refusal);
        }
        OriginVerdict::Absent => None,
        OriginVerdict::Allowed(origin) => Some(origin),
    };
    let cors = cors_headers(origin.as_deref());
    if !helper.host_is_loopback(&head) {
        let refusal = json!({"error":"unexpected Host header"});
        return refuse(&mut stream, &mut reader, &head, &cors, 400, refusal);
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
        _ => refuse(&mut stream, &mut reader, &head, &cors, 404, not_found()),
    }
}

fn cors_headers(origin: Option<&str>) -> Vec<(&'static str, String)> {
    let Some(origin) = origin else { return Vec::new() };
    // the matching origin, echoed — never `*`, which would pair the helper with
    // every site the user visits
    vec![
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

/// A refusal that precedes `read_http_body`: the declared body is read and
/// discarded first, so the answer reaches the page instead of a reset.
fn refuse(
    stream: &mut TcpStream,
    reader: &mut BufReader<TcpStream>,
    head: &HttpHead,
    cors: &[(&str, String)],
    status: u16,
    body: Value,
) -> Result<(), String> {
    drain_http_body(reader, head, HELPER_MAX_REQUEST_BYTES);
    respond(stream, cors, status, body)
}

fn serve_rpc(
    stream: &mut TcpStream,
    reader: &mut BufReader<TcpStream>,
    head: &HttpHead,
    helper: &Helper,
    cors: &[(&str, String)],
) -> Result<(), String> {
    if !bearer_authorized(head, &helper.token) {
        return refuse(stream, reader, head, cors, 401, unauthorized());
    }
    let media = head.header("content-type").unwrap_or_default();
    if !media.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case("application/json") {
        return refuse(stream, reader, head, cors, 415, json!({"error":"send application/json"}));
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
            // the sidebar's usage panel: this computer's CLI transcripts,
            // aggregated — counts and models only, never content or paths
            "model_usage" => {
                let range = text_argument(arguments, "range")?;
                let refresh = arguments
                    .get("refresh")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let summary =
                    crate::usage::model_usage_blocking(&range, refresh).map_err(|e| (400, e))?;
                serde_json::to_value(summary).map_err(|e| (500, e.to_string()))
            }
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
        let Some(_held) = reserve(&self.in_flight, &request_id) else {
            return Err((409, format!("a run is already in flight for \"{request_id}\"")));
        };
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
    use std::io::{Read as _, Write as _};

    use super::*;
    use crate::helper_args::DEFAULT_ORIGINS;
    use crate::helper_token::new_token;

    /// A real helper on an ephemeral loopback port. No CLI is ever spawned:
    /// every test below stops at a gate or at an unknown provider.
    fn helper() -> (u16, String, Arc<Helper>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = new_token();
        let origins = DEFAULT_ORIGINS.iter().map(|o| (*o).to_string()).collect();
        let children = Arc::new(Mutex::new(HashMap::new()));
        let in_flight = Mutex::new(HashSet::new());
        let service = Arc::new(Helper { port, origins, token: token.clone(), children, in_flight });
        let serving = Arc::clone(&service);
        std::thread::spawn(move || drop(serve(listener, serving)));
        (port, token, service)
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
        let (port, _, _) = helper();
        let answer = raw_request(port, &format!("GET /health HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"));
        assert!(answer.starts_with("HTTP/1.1 200 OK"), "{answer}");
        assert!(answer.contains("\"name\":\"rotli-helper\""), "{answer}");
        assert!(answer.contains(env!("CARGO_PKG_VERSION")), "{answer}");
    }

    #[test]
    fn rpc_refuses_a_missing_or_wrong_token() {
        let (port, _, _) = helper();
        let anonymous = rpc(port, "", "{\"cmd\":\"chat_models\",\"args\":{}}");
        assert!(anonymous.starts_with("HTTP/1.1 401"), "{anonymous}");
        let wrong = rpc(port, "Authorization: Bearer not-the-token\r\n", "{\"cmd\":\"chat_models\"}");
        assert!(wrong.starts_with("HTTP/1.1 401"), "{wrong}");
    }

    /// The page's chat requests carry notes as context, so they are large. A
    /// refusal written before that body is read closes the socket on unread
    /// data; the kernel answers with a reset, and the browser reports a network
    /// error instead of the refusal (the owner, 2026-09-18: "Broken pipe").
    #[test]
    fn a_refusal_still_reaches_a_page_that_sent_a_large_body() {
        let (port, _, _) = helper();
        let body = format!("{{\"cmd\":\"chat_models\",\"pad\":\"{}\"}}", "x".repeat(4 * 1024 * 1024));
        let request = format!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://rotli.co\r\nAuthorization: Bearer not-the-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(request.as_bytes()).expect("the helper must read the whole request before it closes");
        let mut answer = String::new();
        stream.read_to_string(&mut answer).expect("the refusal must arrive, not a reset");
        assert!(answer.starts_with("HTTP/1.1 401"), "{answer}");
        assert!(answer.contains("Access-Control-Allow-Origin: https://rotli.co"), "{answer}");
    }

    #[test]
    fn a_preflight_from_an_allowlisted_origin_needs_no_token() {
        let (port, _, _) = helper();
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
        let (port, token, _) = helper();
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
        let (port, _, _) = helper();
        let answer = raw_request(port, "GET /health HTTP/1.1\r\nHost: attacker.example\r\n\r\n");
        assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
    }

    #[test]
    fn an_unknown_command_is_a_404_and_an_unknown_route_too() {
        let (port, token, _) = helper();
        let authorization = format!("Authorization: Bearer {token}\r\n");
        let unknown = rpc(port, &authorization, "{\"cmd\":\"corpus_read\",\"args\":{}}");
        assert!(unknown.starts_with("HTTP/1.1 404"), "{unknown}");
        assert!(unknown.contains("unknown command"), "{unknown}");
        let route = raw_request(port, &format!("GET /vault HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"));
        assert!(route.starts_with("HTTP/1.1 404"), "{route}");
    }

    #[test]
    fn detect_reports_an_unknown_provider_as_an_error() {
        let (port, token, _) = helper();
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
        let (port, token, _) = helper();
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
        let (port, token, _) = helper();
        // 26 MB > the 24 MiB cap, and no body follows: the length alone ends it
        let answer = raw_request(
            port,
            &format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: 26000000\r\n\r\n"),
        );
        assert!(answer.starts_with("HTTP/1.1 413"), "{answer}");
    }

    #[test]
    fn a_missing_length_or_wrong_media_type_is_refused() {
        let (port, token, _) = helper();
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

    /// The reservation, not the children map, makes an id exclusive: the old
    /// check-then-act let two turns pass, and the second child then replaced
    /// the first in `children`, leaving it unkillable by watchdog or cancel.
    #[test]
    fn a_second_run_under_one_request_id_is_refused_while_the_first_holds_it() {
        let (port, token, service) = helper();
        let held = reserve(&service.in_flight, "busy").expect("the first run takes the id");
        assert!(reserve(&service.in_flight, "busy").is_none(), "nobody else may take it");
        let answer = rpc(
            port,
            &format!("Authorization: Bearer {token}\r\n"),
            "{\"cmd\":\"cli_complete\",\"args\":{\"requestId\":\"busy\",\"provider\":\"claude\",\"model\":\"sonnet\",\"prompt\":\"hi\"}}",
        );
        assert!(answer.starts_with("HTTP/1.1 409"), "{answer}");
        assert!(answer.contains("already in flight"), "{answer}");
        assert!(service.in_flight.lock().unwrap().contains("busy"), "the first run keeps it");
        drop(held);
        assert!(service.in_flight.lock().unwrap().is_empty(), "Drop gives the id back");
        assert!(reserve(&service.in_flight, "busy").is_some(), "and the id is takeable again");
    }

    #[test]
    fn a_junk_head_line_is_answered_400_and_a_flood_stops_at_the_first() {
        let (port, _, _) = helper();
        // nothing follows the junk line, so the server consumes the whole
        // request and closes cleanly — the body is readable
        let one = raw_request(port, &format!("GET /health HTTP/1.1\r\nHost: localhost:{port}\r\nnope\r\n"));
        assert!(one.starts_with("HTTP/1.1 400"), "{one}");
        assert!(one.contains("malformed request head"), "{one}");
        // A flood is REFUSED at the first junk line rather than absorbed. Only
        // the status is asserted: bytes the helper deliberately never read are
        // still in flight, so the close can reset and drop the body.
        let flood = "nonsense-with-no-colon\r\n".repeat(500);
        let many = raw_request(port, &format!("GET /health HTTP/1.1\r\nHost: localhost:{port}\r\n{flood}"));
        assert!(many.starts_with("HTTP/1.1 400"), "{many}");
    }

}
