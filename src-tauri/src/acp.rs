//! The Agent Client Protocol transport Rotli drives for its ACP lanes.
//!
//! Two vendors speak it today: Cursor (`agent acp`, read-only Ask mode) and
//! Google's official Antigravity agent (`agy_acp_server.par`, the registry
//! build). One process per chat turn, deliberately: Rotli's Markdown transcript
//! is the durable history and the normal chat loop replays it, so switching
//! providers never needs vendor-owned session state. The client advertises no
//! filesystem or terminal capability, starts the agent in an empty scratch
//! directory, and answers every permission request with the agent's own reject
//! option — three independent defenses on top of the lane's argv posture.
//!
//! Split out of provider.rs on 2026-09-03 when Antigravity joined (ADR
//! docs/decisions/2026-09-03-antigravity-official-acp-lane.md).

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::{with_stderr_tail, Running, NEXT_TOKEN};

/// The plain-text line Google's agent prints on stdout when `authenticate`
/// needs a browser. It is not JSON-RPC; the reader recognizes it by prefix.
pub(crate) const ANTIGRAVITY_AUTH_PREFIX: &str =
    "Open the following link to authenticate the ACP server: ";
/// What a chat turn says when the agent asks for a browser instead of a
/// session — sign-in is a Settings action, never something a chat starts.
pub(crate) const ANTIGRAVITY_SIGN_IN_REQUIRED: &str =
    "Sign in to Antigravity in Settings → AI Models before chatting with it.";
/// Antigravity's own tools are never granted; the model must follow Rotli's
/// text protocol. The old `agy` lane learned this the hard way — Gemini
/// occasionally ignored the protocol and reached for native tools, which the
/// client then had to reject.
const ANTIGRAVITY_NO_TOOLS_OVERRIDE: &str = "IMPORTANT: You have NO native tools, no shell, and no filesystem access in this environment — never request tool permissions or ask the client to run anything. Reply ONLY according to the protocol in the message below.\n\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AcpLane {
    Cursor,
    Antigravity,
}

impl AcpLane {
    pub(crate) fn for_provider(provider: &str) -> Option<Self> {
        match provider {
            "cursor" => Some(Self::Cursor),
            "antigravity" => Some(Self::Antigravity),
            _ => None,
        }
    }

    /// The provider id, as the chat picker names the lane.
    fn label(self) -> &'static str {
        match self {
            Self::Cursor => "cursor",
            Self::Antigravity => "antigravity",
        }
    }

    /// The ACP `authenticate` method id each vendor documents.
    pub(crate) fn auth_method_id(self) -> &'static str {
        match self {
            Self::Cursor => "cursor_login",
            Self::Antigravity => "oauth-personal",
        }
    }

    /// Cursor picks its model on argv; Antigravity exposes it as a session
    /// config option that must be selected after `session/new`.
    fn selects_model_in_session(self) -> bool {
        matches!(self, Self::Antigravity)
    }

    fn prompt_prefix(self) -> &'static str {
        match self {
            Self::Cursor => "",
            Self::Antigravity => ANTIGRAVITY_NO_TOOLS_OVERRIDE,
        }
    }
}

pub(crate) fn write_json_line(
    writer: &mut impl Write,
    value: &serde_json::Value,
) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, value)
        .map_err(|e| format!("couldn't encode ACP request: {e}"))?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|e| format!("couldn't write ACP request: {e}"))
}

/// An agent can ask the client to authorize a tool. Rotli never grants one:
/// Ask mode / the no-tools override is defense one, this protocol answer is
/// defense two, and the empty scratch cwd is defense three. Antigravity's
/// native questions ride the same method with an `interaction_` tool-call id;
/// those are cancelled, not answered — the next user turn is the answer.
pub(crate) fn client_response(message: &serde_json::Value) -> Option<serde_json::Value> {
    let id = message.get("id")?.clone();
    let method = message.get("method")?.as_str()?;
    let result = match method {
        "session/request_permission" => {
            let interaction = message
                .pointer("/params/toolCall/toolCallId")
                .and_then(|v| v.as_str())
                .is_some_and(|tool_call| tool_call.starts_with("interaction_"));
            let rejection = message
                .pointer("/params/options")
                .and_then(|v| v.as_array())
                .and_then(|options| {
                    options.iter().find(|option| {
                        option
                            .get("kind")
                            .and_then(|v| v.as_str())
                            .is_some_and(|kind| kind.contains("reject"))
                            || option
                                .get("optionId")
                                .and_then(|v| v.as_str())
                                .is_some_and(|option_id| option_id.contains("reject"))
                    })
                })
                .and_then(|option| option.get("optionId"))
                .and_then(|v| v.as_str());
            match rejection {
                Some(option_id) if !interaction => serde_json::json!({
                    "outcome": { "outcome": "selected", "optionId": option_id }
                }),
                _ => serde_json::json!({ "outcome": { "outcome": "cancelled" } }),
            }
        }
        "cursor/ask_question" => serde_json::json!({
            "outcome": {
                "outcome": "skipped",
                "reason": "Rotli code chat accepts clarification in the next user turn."
            }
        }),
        "cursor/create_plan" => serde_json::json!({
            "outcome": {
                "outcome": "rejected",
                "reason": "Rotli runs Cursor in read-only code-chat mode."
            }
        }),
        _ => {
            return Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "method not available in Rotli code chat" }
            }));
        }
    };
    Some(serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// What to do with a stdout line that is not JSON-RPC. Google's agent prints
/// its sign-in URL that way; the sign-in flow wants it, a chat turn refuses.
pub(crate) type PlainLineHook<'a> = &'a mut dyn FnMut(&str) -> Result<(), String>;

/// One live agent process: its pipes, the lane, the accumulating assistant
/// text, and what to do with a non-JSON stdout line.
pub(crate) struct AcpConn<'a, W: Write, R: BufRead> {
    pub(crate) lane: AcpLane,
    pub(crate) writer: &'a mut W,
    pub(crate) reader: &'a mut R,
    pub(crate) assistant: &'a mut String,
    pub(crate) on_plain_line: PlainLineHook<'a>,
}

impl<W: Write, R: BufRead> AcpConn<'_, W, R> {
    pub(crate) fn request(
        &mut self,
        id: u64,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        acp_request(self, id, method, params)
    }
}

fn acp_request<W: Write, R: BufRead>(
    conn: &mut AcpConn<'_, W, R>,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let label = conn.lane.label();
    let writer = &mut *conn.writer;
    let reader = &mut *conn.reader;
    write_json_line(
        writer,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }),
    )?;

    loop {
        let mut line = String::new();
        if reader
            .read_line(&mut line)
            .map_err(|e| format!("couldn't read {label} ACP response: {e}"))?
            == 0
        {
            return Err(format!("{label} ACP closed before completing the request"));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let message: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(e) if trimmed.starts_with('{') => {
                return Err(format!("{label} ACP returned malformed JSON: {e}"));
            }
            Err(_) => {
                // Google's agent writes its OAuth line (and nothing else) to
                // stdout as plain text; any other stray line is skipped.
                (conn.on_plain_line)(trimmed)?;
                continue;
            }
        };

        if message.get("method").is_some() && message.get("id").is_some() {
            if let Some(response) = client_response(&message) {
                write_json_line(writer, &response)?;
            }
            continue;
        }

        if message.get("method").and_then(|v| v.as_str()) == Some("session/update") {
            let update = message.pointer("/params/update");
            if update
                .and_then(|v| v.get("sessionUpdate"))
                .and_then(|v| v.as_str())
                == Some("agent_message_chunk")
            {
                if let Some(text) = update
                    .and_then(|v| v.pointer("/content/text"))
                    .and_then(|v| v.as_str())
                {
                    conn.assistant.push_str(text);
                }
            }
            continue;
        }

        if message.get("id").and_then(|v| v.as_u64()) != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("ACP request failed")
                .to_string());
        }
        return Ok(message.get("result").cloned().unwrap_or_default());
    }
}

/// The `model` config option's selectable values from a `session/new` result
/// (groups are flattened). Empty when the agent exposes no model option.
pub(crate) fn session_model_options(session: &serde_json::Value) -> (Option<String>, Vec<String>) {
    let Some(option) = session
        .get("configOptions")
        .and_then(|v| v.as_array())
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("id").and_then(|v| v.as_str()) == Some("model"))
        })
    else {
        return (None, Vec::new());
    };
    let current = option
        .get("currentValue")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut values = Vec::new();
    fn collect(entries: &serde_json::Value, values: &mut Vec<String>) {
        for entry in entries.as_array().into_iter().flatten() {
            if let Some(value) = entry.get("value").and_then(|v| v.as_str()) {
                values.push(value.to_string());
            } else if let Some(nested) = entry.get("options") {
                collect(nested, values);
            }
        }
    }
    if let Some(options) = option.get("options") {
        collect(options, &mut values);
    }
    (current, values)
}

/// Everything one ACP turn needs beyond the binary: extra env (Antigravity's
/// private profile) and, for lanes that pick the model in-session, the id.
pub(crate) struct AcpTurn<'a> {
    pub(crate) lane: AcpLane,
    pub(crate) bin: &'a Path,
    pub(crate) args: &'a [String],
    pub(crate) env: Vec<(String, OsString)>,
    pub(crate) env_remove: Vec<String>,
    pub(crate) model: &'a str,
}

/// One turn through the vendor's ACP agent, registered for cancel and the
/// watchdog under `request_id`.
pub(crate) fn run_acp_registered(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    turn: AcpTurn<'_>,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    let lane = turn.lane;
    let label = lane.label();
    let scratch = tempfile::Builder::new()
        .prefix("rotli-acp-")
        .tempdir()
        .map_err(|e| format!("couldn't create the {label} scratch workspace: {e}"))?;
    let mut cmd = Command::new(turn.bin);
    cmd.args(turn.args)
        .current_dir(scratch.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in &turn.env_remove {
        cmd.env_remove(key);
    }
    cmd.envs(turn.env.iter().map(|(k, v)| (k.as_str(), v.as_os_str())));
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("couldn't launch the {label} client: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("{label} ACP did not open stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{label} ACP did not open stdout"))?;
    let mut stderr = child.stderr.take();

    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    children
        .lock()
        .unwrap()
        .insert(request_id.to_string(), Running { token, child });
    let map = Arc::clone(children);
    let id_for_watchdog = request_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        if let Some(r) = map.lock().unwrap().get_mut(&id_for_watchdog) {
            if r.token == token {
                let _ = r.child.kill();
            }
        }
    });

    let err_thread = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(pipe) = stderr.as_mut() {
            let _ = pipe.read_to_string(&mut text);
        }
        text
    });
    let mut reader = BufReader::new(stdout);
    let mut assistant = String::new();
    // a chat turn never signs in: the agent asking for a browser is a refusal
    let mut refuse_sign_in = |line: &str| -> Result<(), String> {
        if line.starts_with(ANTIGRAVITY_AUTH_PREFIX) {
            Err(ANTIGRAVITY_SIGN_IN_REQUIRED.into())
        } else {
            Ok(())
        }
    };
    let prompt = format!("{}{prompt}", lane.prompt_prefix());
    let mut conn = AcpConn {
        lane,
        writer: &mut stdin,
        reader: &mut reader,
        assistant: &mut assistant,
        on_plain_line: &mut refuse_sign_in,
    };
    let protocol: Result<String, String> = (|| -> Result<String, String> {
        handshake(&mut conn)?;
        let session = conn.request(
            3,
            "session/new",
            serde_json::json!({
                "cwd": scratch.path().to_string_lossy(),
                "mcpServers": []
            }),
        )?;
        let session_id = session
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{label} ACP did not return a session id"))?
            .to_string();
        if lane.selects_model_in_session() {
            let (current, available) = session_model_options(&session);
            if !available.is_empty() && !available.iter().any(|value| value == turn.model) {
                return Err(format!(
                    "Antigravity model \"{}\" is not available for this Google account. Available: {}",
                    turn.model,
                    available.join(", ")
                ));
            }
            if current.as_deref() != Some(turn.model) {
                conn.request(
                    4,
                    "session/set_config_option",
                    serde_json::json!({
                        "sessionId": session_id,
                        "configId": "model",
                        "value": turn.model
                    }),
                )?;
            }
        }
        conn.request(
            5,
            "session/prompt",
            serde_json::json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": prompt }]
            }),
        )?;
        let answer = conn.assistant.trim().to_string();
        if answer.is_empty() {
            Err(format!("{label} returned no assistant message"))
        } else {
            Ok(answer)
        }
    })();

    drop(stdin);
    let reaped = {
        let mut map = children.lock().unwrap();
        match map.get(request_id) {
            Some(r) if r.token == token => map.remove(request_id),
            _ => None,
        }
    };
    if let Some(mut running) = reaped {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
    let stderr = err_thread.join().unwrap_or_default();
    protocol.map_err(|e| with_stderr_tail(&e, &stderr, " — ", ""))
}

/// `initialize` + `authenticate` — the same two requests for a chat turn and
/// for the Antigravity sign-in flow, so a setup process can never advertise
/// more than a chat turn does; only the plain-line hook differs.
pub(crate) fn handshake<W: Write, R: BufRead>(conn: &mut AcpConn<'_, W, R>) -> Result<(), String> {
    conn.request(1, "initialize", initialize_params())?;
    conn.request(
        2,
        "authenticate",
        serde_json::json!({ "methodId": conn.lane.auth_method_id() }),
    )?;
    Ok(())
}

/// The one `initialize` Rotli ever sends: protocol 1, no filesystem, no
/// terminal.
pub(crate) fn initialize_params() -> serde_json::Value {
    serde_json::json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": { "readTextFile": false, "writeTextFile": false },
            "terminal": false
        },
        "clientInfo": { "name": "rotli", "version": env!("CARGO_PKG_VERSION") }
    })
}

/// Path helper for the lanes that keep sibling files beside the binary.
pub(crate) fn sibling(bin: &Path, name: &str) -> PathBuf {
    bin.parent().map(|dir| dir.join(name)).unwrap_or_else(|| PathBuf::from(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_plain_lines(line: &str) -> Result<(), String> {
        Err(format!("unexpected plain line: {line}"))
    }

    #[test]
    fn acp_collects_only_assistant_chunks() {
        let inbound = concat!(
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello "}}}}"#,
            "\n",
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"(thinking)"}}}}"#,
            "\n",
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"there."}}}}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}"#,
            "\n",
        );
        let mut reader = std::io::Cursor::new(inbound.as_bytes());
        let mut written = Vec::new();
        let mut assistant = String::new();
        let mut hook = no_plain_lines;
        let mut conn = AcpConn {
            lane: AcpLane::Cursor,
            writer: &mut written,
            reader: &mut reader,
            assistant: &mut assistant,
            on_plain_line: &mut hook,
        };
        let result = conn
            .request(4, "session/prompt", serde_json::json!({"sessionId":"s","prompt":[]}))
            .unwrap();
        assert_eq!(assistant, "Hello there.");
        assert_eq!(result["stopReason"], "end_turn");
        let request: serde_json::Value =
            serde_json::from_slice(written.strip_suffix(b"\n").unwrap()).unwrap();
        assert_eq!(request["method"], "session/prompt");
    }

    #[test]
    fn acp_rejects_permission_requests_and_cancels_native_questions() {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 91,
            "method": "session/request_permission",
            "params": {
                "toolCall": { "toolCallId": "call_7" },
                "options": [
                    { "optionId": "allow-once", "kind": "allow_once" },
                    { "optionId": "reject-once", "kind": "reject_once" }
                ]
            }
        });
        let response = client_response(&request).unwrap();
        assert_eq!(response["id"], 91);
        assert_eq!(response["result"]["outcome"]["outcome"], "selected");
        assert_eq!(response["result"]["outcome"]["optionId"], "reject-once");

        let mut question = request.clone();
        question["params"]["toolCall"]["toolCallId"] = "interaction_2".into();
        let response = client_response(&question).unwrap();
        assert_eq!(response["result"]["outcome"]["outcome"], "cancelled");
    }

    #[test]
    fn a_chat_turn_refuses_the_agents_sign_in_line_and_skips_other_noise() {
        let inbound = concat!(
            "some stray non-json line\n",
            r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#,
            "\n",
        );
        let mut reader = std::io::Cursor::new(inbound.as_bytes());
        let mut written = Vec::new();
        let mut assistant = String::new();
        let mut seen = Vec::new();
        let mut hook = |line: &str| -> Result<(), String> {
            seen.push(line.to_string());
            Ok(())
        };
        let mut conn = AcpConn {
            lane: AcpLane::Antigravity,
            writer: &mut written,
            reader: &mut reader,
            assistant: &mut assistant,
            on_plain_line: &mut hook,
        };
        let result = conn.request(1, "initialize", initialize_params()).unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(seen, ["some stray non-json line"]);

        let auth_line = format!("{ANTIGRAVITY_AUTH_PREFIX}https://accounts.google.com/o/oauth2/v2/auth?x=1\n");
        let mut reader = std::io::Cursor::new(auth_line.as_bytes());
        let mut refuse = |line: &str| -> Result<(), String> {
            if line.starts_with(ANTIGRAVITY_AUTH_PREFIX) {
                Err(ANTIGRAVITY_SIGN_IN_REQUIRED.into())
            } else {
                Ok(())
            }
        };
        let mut conn = AcpConn {
            lane: AcpLane::Antigravity,
            writer: &mut written,
            reader: &mut reader,
            assistant: &mut assistant,
            on_plain_line: &mut refuse,
        };
        let error = conn
            .request(2, "authenticate", serde_json::json!({ "methodId": "oauth-personal" }))
            .unwrap_err();
        assert_eq!(error, ANTIGRAVITY_SIGN_IN_REQUIRED);
    }

    #[test]
    fn session_model_options_flatten_groups_and_keep_the_current_value() {
        let session = serde_json::json!({
            "sessionId": "s",
            "configOptions": [
                { "id": "mode", "type": "select", "currentValue": "default", "options": [] },
                {
                    "id": "model",
                    "type": "select",
                    "currentValue": "gemini-3.7-flash-high",
                    "options": [
                        { "value": "gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (High)" },
                        { "name": "Legacy", "options": [
                            { "value": "gemini-3.7-flash-high", "name": "Gemini 3.7 Flash (High)" }
                        ] }
                    ]
                }
            ]
        });
        let (current, available) = session_model_options(&session);
        assert_eq!(current.as_deref(), Some("gemini-3.7-flash-high"));
        assert_eq!(available, ["gemini-3.8-flash-high", "gemini-3.7-flash-high"]);
        assert_eq!(session_model_options(&serde_json::json!({})), (None, Vec::new()));
    }

    #[test]
    fn lanes_document_their_auth_method_and_posture() {
        assert_eq!(AcpLane::for_provider("cursor"), Some(AcpLane::Cursor));
        assert_eq!(AcpLane::for_provider("antigravity"), Some(AcpLane::Antigravity));
        assert_eq!(AcpLane::for_provider("claude"), None);
        assert_eq!(AcpLane::Cursor.auth_method_id(), "cursor_login");
        assert_eq!(AcpLane::Antigravity.auth_method_id(), "oauth-personal");
        assert!(AcpLane::Antigravity.prompt_prefix().contains("NO native tools"));
        assert!(AcpLane::Cursor.prompt_prefix().is_empty());
        let init = initialize_params();
        assert_eq!(init["clientCapabilities"]["fs"]["readTextFile"], false);
        assert_eq!(init["clientCapabilities"]["terminal"], false);
    }
}
