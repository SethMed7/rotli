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
    let config = tempfile::TempDir::new().unwrap().keep();
    let vault = ServedVault::new(&config, Box::new(|| Ok(None)));
    let service = Arc::new(Helper { port, origins, token: token.clone(), children, in_flight, vault });
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
    // file verbs ride /rpc behind the token; there is no route of their own
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
fn model_discovery_is_a_helper_verb_that_refuses_an_unknown_provider() {
    let (port, token, _) = helper();
    let auth = format!("Authorization: Bearer {token}\r\n");
    let answer = rpc(port, &auth, "{\"cmd\":\"cli_models\",\"args\":{\"provider\":\"definitely-not-a-cli\"}}");
    assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
    assert!(answer.contains("unknown provider"), "{answer}");
    let missing = rpc(port, &auth, "{\"cmd\":\"cli_models\",\"args\":{}}");
    assert!(missing.contains("\\\"provider\\\" is required"), "{missing}");
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

/// The vault lane end to end over the wire: behind the token, a paired page
/// writes a real file in the chosen folder; without it, nothing.
#[test]
fn a_paired_page_writes_a_real_file_in_the_chosen_vault_and_nothing_without_the_token() {
    let (port, token, service) = helper();
    let folder = tempfile::TempDir::new().unwrap();
    let id = service.vault.choose(folder.path()).unwrap().id;
    let body = format!("{{\"cmd\":\"vault_write\",\"args\":{{\"path\":\"wiki/hello.md\",\"text\":\"# Hello\\n\",\"vaultId\":\"{id}\"}}}}");
    let refused = rpc(port, "", &body);
    assert!(refused.starts_with("HTTP/1.1 401"), "{refused}");
    assert!(!folder.path().join("wiki/hello.md").exists());
    let written = rpc(port, &format!("Authorization: Bearer {token}\r\n"), &body);
    assert!(written.starts_with("HTTP/1.1 200"), "{written}");
    assert_eq!(std::fs::read_to_string(folder.path().join("wiki/hello.md")).unwrap(), "# Hello\n");
    let escape = rpc(
        port,
        &format!("Authorization: Bearer {token}\r\n"),
        &format!("{{\"cmd\":\"vault_read\",\"args\":{{\"path\":\"../../etc/passwd\",\"vaultId\":\"{id}\"}}}}"),
    );
    assert!(escape.starts_with("HTTP/1.1 400"), "{escape}");
}

/// Completion regressions call the dispatcher directly: no listener or CLI.
fn completion_helper() -> (tempfile::TempDir, tempfile::TempDir, Helper) {
    let folder = tempfile::TempDir::new().unwrap();
    let config = tempfile::TempDir::new().unwrap();
    let vault = ServedVault::new(config.path(), Box::new(|| Ok(None)));
    vault.choose(folder.path()).unwrap();
    let helper = Helper {
        port: 0, origins: vec![], token: "synthetic".into(),
        children: Arc::new(Mutex::new(HashMap::new())),
        in_flight: Mutex::new(HashSet::new()), vault,
    };
    (folder, config, helper)
}

fn completion_refusal(helper: &Helper, prompt: &str) -> (u16, String) {
    let error = helper.dispatch("cli_complete", &json!({
        "requestId": "offline-regression", "provider": "definitely-not-a-cli",
        "model": "synthetic", "prompt": prompt,
    })).unwrap_err();
    assert!(helper.children.lock().unwrap().is_empty());
    assert!(helper.in_flight.lock().unwrap().is_empty());
    error
}

#[test]
fn helper_regression_completion_refreshes_notes_written_through_the_vault() {
    let (_folder, _config, helper) = completion_helper();
    let body = "Synthetic amber observatory postpones imaginary telescope delivery until winter.";
    helper.dispatch("vault_write", &json!({
        "vaultId": helper.vault.current().unwrap().id, "path": "wiki/secure.md",
        "text": format!("---\nsecure: true\n---\n{body}"),
    })).unwrap();
    let refused = completion_refusal(&helper, body);
    assert_eq!(refused.0, 400);
    assert_eq!(refused.1, crate::provider_lane::SECRET_MESSAGE);
}

#[test]
fn helper_regression_completion_refreshes_external_edits() {
    let (folder, _config, helper) = completion_helper();
    let path = folder.path().join("external.md");
    std::fs::write(&path, "ordinary original note").unwrap();
    let body = "Synthetic violet submarine reschedules imaginary harbor inspection until autumn.";
    std::fs::write(&path, format!("---\nsecure: true\n---\n{body}")).unwrap();
    let refused = completion_refusal(&helper, body);
    assert_eq!(refused.1, crate::provider_lane::SECRET_MESSAGE);
}

#[test]
fn helper_regression_completion_rereads_config_even_with_unchanged_mtime() {
    let (_folder, config, helper) = completion_helper();
    let other = tempfile::TempDir::new().unwrap();
    let body = "Synthetic copper airship schedules imaginary glacier expedition after springtime.";
    std::fs::write(other.path().join("secure.md"), format!("---\nsecure: true\n---\n{body}")).unwrap();
    let path = config.path().join(CONFIG_FILE);
    let stamp = std::fs::metadata(&path).unwrap().modified().unwrap();
    crate::helper_vault::choose_config(&path, other.path()).unwrap();
    std::fs::File::open(&path).unwrap().set_times(std::fs::FileTimes::new().set_modified(stamp)).unwrap();
    let refused = completion_refusal(&helper, body);
    assert_eq!(refused.1, crate::provider_lane::SECRET_MESSAGE);
}

#[test]
fn helper_regression_completion_fails_closed_when_refresh_cannot_read_the_vault() {
    let (folder, _config, helper) = completion_helper();
    drop(folder);
    let refused = completion_refusal(&helper, "ordinary synthetic prompt");
    assert_eq!(refused.0, 503);
    assert!(refused.1.contains("secure notes"), "{}", refused.1);
}

#[test]
fn helper_regression_completion_reads_an_oddly_encoded_note_lossily() {
    let (folder, _config, helper) = completion_helper();
    // an ordinary note that isn't UTF-8 doesn't switch chat off…
    std::fs::write(folder.path().join("latin1.md"), [b'c', b'a', b'f', 0xe9]).unwrap();
    assert!(completion_refusal(&helper, "another ordinary synthetic prompt").1.contains("unknown provider"));
    // …and a secure one still reads as secure
    let body = "Synthetic amber lantern guides fictional harbour pilots past the breakwater.";
    let mut bytes = format!("---\nsecure: true\n---\n{body}\n").into_bytes();
    bytes.push(0xff);
    std::fs::write(folder.path().join("odd-secure.md"), bytes).unwrap();
    assert_eq!(completion_refusal(&helper, body).1, crate::provider_lane::SECRET_MESSAGE);
}

#[test]
fn completion_accepts_ordinary_prompts_and_does_not_write_a_vault_index() {
    let (folder, _config, helper) = completion_helper();
    std::fs::write(folder.path().join("ordinary.md"), "A public synthetic note.").unwrap();
    let refused = completion_refusal(&helper, "A public synthetic question.");
    assert!(refused.1.contains("unknown provider"));
    assert!(!folder.path().join(".rotli").exists());
}

#[test]
fn completion_refresh_preserves_malformed_secure_and_chat_taint_policy() {
    let (folder, _config, helper) = completion_helper();
    for (index, field, body) in [
        (0, "secure: maybe", "Synthetic indigo balloon delays fictional meadow survey until midsummer."),
        (1, "secureContext: true", "Synthetic silver caravan postpones fictional desert crossing until midwinter."),
    ] {
        std::fs::write(folder.path().join(format!("secure-{index}.MARKDOWN")), format!("---\n{field}\n---\n{body}")).unwrap();
        assert_eq!(completion_refusal(&helper, body).1, crate::provider_lane::SECRET_MESSAGE);
    }
}

#[test]
fn completion_refuses_an_oversized_note_or_unreadable_config() {
    let (folder, config, helper) = completion_helper();
    let file = std::fs::File::create(folder.path().join("large.md")).unwrap();
    file.set_len(256 * 1024 * 1024 + 1).unwrap();
    assert_eq!(completion_refusal(&helper, "A synthetic oversized note check.").0, 503);
    std::fs::remove_file(folder.path().join("large.md")).unwrap();
    std::fs::write(config.path().join(CONFIG_FILE), "invalid synthetic config").unwrap();
    assert_eq!(completion_refusal(&helper, "A synthetic invalid config check.").0, 503);
}
