//! Claude chat over Claude Code's native agent protocol — the stream-json
//! control protocol the official Agent SDK speaks (and T3 Code drives), instead
//! of one tool-less `claude -p` per loop step with a JSON action protocol
//! written into the prompt.
//!
//! Rotli's tools reach the model as an in-process MCP server named `rotli`
//! (claude_protocol.rs). Claude Code's own tools stay OFF (`--tools ""`,
//! `--safe-mode`, `--strict-mcp-config`), and every tool call passes three
//! gates before the webview runs it or the model sees its result:
//!   1. `can_use_tool` — allow only `mcp__rotli__<name>` for a name this turn
//!      offered; deny everything else.
//!   2. the call's arguments — `blocked_for_remote` (secret shapes + the
//!      secure-prose ledger), exactly as the whole-prompt scan saw them before.
//!   3. the call's RESULT — the same scan, because a result no longer rides
//!      back inside a rescanned prompt; a hit is withheld from the model.
//!
//! The webview executes the tool itself (src/ai/nativeLoop.ts, with the loop's
//! own egress guards) and answers through `claude_session_tool_result`. A
//! `tool_call` event names the call; its arguments, which can be long, come
//! back through `claude_session_tool_args`.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use crate::claude_protocol::{Protocol, Step, ToolSpec, Wire, NO_ANSWER};
use crate::event_channel::EventChannel;
use crate::provider::{self, ProviderState, Running};

const MAX_TOOLS: usize = 32;
/// How long one tool may take in the webview before the model hears it failed.
const TOOL_WAIT: Duration = Duration::from_secs(300);
/// The whole turn's hard ceiling, whatever the per-step timeout × turns says.
const SESSION_CEILING: Duration = Duration::from_secs(30 * 60);

/// What the model hears when a tool call couldn't be handed to the webview.
const UNSENT: &str = "that tool call couldn't be handed to Rotli";

/// One tool call waiting on the webview: the window that started its session,
/// its arguments until that window reads them, and where its answer goes.
struct Pending {
    owner: String,
    args: Option<String>,
    answer: Sender<String>,
}

type PendingCalls = Arc<Mutex<HashMap<String, Pending>>>;
type RunningIds = Arc<Mutex<HashSet<String>>>;

/// Tool calls waiting on the webview, keyed `<request_id>:<call_id>`, and the
/// request ids of the sessions running now.
#[derive(Default)]
pub struct SessionState {
    pending: PendingCalls,
    running: RunningIds,
}

/// A running session's hold on its request id, given back when it ends.
struct Claim {
    running: RunningIds,
    request_id: String,
}

impl Drop for Claim {
    fn drop(&mut self) {
        self.running.lock().unwrap().remove(&self.request_id);
    }
}

fn claim(running: &RunningIds, request_id: &str) -> Result<Claim, String> {
    if !running.lock().unwrap().insert(request_id.to_string()) {
        return Err("a Claude turn with this id is already running".into());
    }
    Ok(Claim { running: Arc::clone(running), request_id: request_id.to_string() })
}

/// One chat turn on Claude's native protocol. Resolves with the final answer.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn claude_session_run(
    webview: tauri::Webview,
    providers: tauri::State<'_, ProviderState>,
    sessions: tauri::State<'_, SessionState>,
    request_id: String,
    model: String,
    system_prompt: String,
    user_text: String,
    tools: Vec<ToolSpec>,
    max_turns: u32,
    timeout_ms: Option<u64>,
    reasoning_effort: Option<String>,
    // the person's own messages they chose to send anyway (remote_block.rs)
    consent: Option<Vec<String>>,
    on_event: EventChannel,
) -> Result<String, String> {
    provider::connected_provider_execution_allowed("claude")?;
    // the lane is remote by definition — the same egress law as cli_complete
    let consented = consent.unwrap_or_default();
    if let Some(block) = crate::remote_block::first_block(&[&system_prompt, &user_text], &consented) {
        return Err(block.message());
    }
    check_tools(&tools)?;
    let claim = claim(&sessions.running, &request_id)?;
    let owner = webview.label().to_string();
    let turns = max_turns.clamp(1, 24);
    let step = Duration::from_millis(timeout_ms.unwrap_or(provider::DEFAULT_TIMEOUT_MS).min(provider::MAX_TIMEOUT_MS));
    let deadline = (step * turns).min(SESSION_CEILING);
    let children = Arc::clone(&providers.children);
    let pending = Arc::clone(&sessions.pending);
    tauri::async_runtime::spawn_blocking(move || {
        // a discovered id the cache has not seen since launch is re-read from the
        // client before the argv builder (which reads the cache only) decides —
        // the same refresh complete_blocking does; it may spawn the CLI briefly
        let _ = crate::provider_lane::model_allowed("claude", &model);
        let args = session_args(&model, reasoning_effort.as_deref(), turns)?;
        let proto = Protocol::new(system_prompt, user_text, tools);
        let answer = run_session(&children, &pending, (&request_id, &owner), &args, proto, deadline, on_event);
        drop(claim);
        answer
    })
    .await
    .map_err(|e| format!("claude session task failed: {e}"))?
}

/// The webview's answer to one `tool_call` event. Unknown ids are a no-op
/// (the turn was stopped, or the wait already timed out).
#[tauri::command]
pub fn claude_session_tool_result(
    sessions: tauri::State<'_, SessionState>,
    request_id: String,
    call_id: String,
    result: String,
) -> Result<(), String> {
    if let Some(call) = sessions.pending.lock().unwrap().remove(&format!("{request_id}:{call_id}")) {
        let _ = call.answer.send(result);
    }
    Ok(())
}

/// The arguments of one `tool_call` event, as JSON text, read once and only by
/// the window that started the session.
#[tauri::command]
pub fn claude_session_tool_args(
    webview: tauri::Webview,
    sessions: tauri::State<'_, SessionState>,
    request_id: String,
    call_id: String,
) -> Result<String, String> {
    take_args(&sessions.pending, &format!("{request_id}:{call_id}"), webview.label())
}

fn take_args(pending: &PendingCalls, key: &str, caller: &str) -> Result<String, String> {
    let mut calls = pending.lock().unwrap();
    calls
        .get_mut(key)
        .filter(|call| call.owner == caller)
        .and_then(|call| call.args.take())
        .ok_or_else(|| "that tool call has ended".into())
}

fn check_tools(tools: &[ToolSpec]) -> Result<(), String> {
    if tools.len() > MAX_TOOLS {
        return Err("too many tools for one chat turn".into());
    }
    for t in tools {
        let shaped = !t.name.is_empty() && t.name.len() <= 40 && t.name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
        if !shaped || !t.input_schema.is_object() || t.description.len() > 4000 {
            return Err(format!("tool \"{}\" isn't a valid Rotli tool", t.name));
        }
    }
    Ok(())
}

/// The argv: Claude Code's own tools, ambient MCP servers, hooks, and session
/// files all off; every permission question comes to this process. The model
/// and effort flags come from the one-shot lane's allowlisted builder, so both
/// lanes accept exactly the same models and efforts.
pub(crate) fn session_args(model: &str, effort: Option<&str>, max_turns: u32) -> Result<Vec<String>, String> {
    let (checked, _) = provider::build_args_tuned("claude", model, "", 0, effort, None, None)?;
    let mut args: Vec<String> = [
        "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--tools", "", "--safe-mode", "--strict-mcp-config",
        "--permission-prompt-tool", "stdio", "--no-session-persistence",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(["--max-turns".to_string(), max_turns.to_string()]);
    for flag in ["--model", "--effort"] {
        if let Some(i) = checked.iter().position(|a| a == flag) {
            args.extend([flag.to_string(), checked[i + 1].clone()]);
        }
    }
    Ok(args)
}

struct LiveWire<'a> {
    stdin: Option<ChildStdin>,
    events: EventChannel,
    pending: &'a PendingCalls,
    children: &'a Arc<Mutex<HashMap<String, Running>>>,
    request_id: &'a str,
    /// The label of the window that started the session.
    owner: &'a str,
    token: u64,
}

impl LiveWire<'_> {
    /// The CLI is still ours and still running (a stop or the deadline kills it).
    fn alive(&self) -> bool {
        match self.children.lock().unwrap().get_mut(self.request_id) {
            Some(r) if r.token == self.token => matches!(r.child.try_wait(), Ok(None)),
            _ => false,
        }
    }
}

impl Wire for LiveWire<'_> {
    fn send(&mut self, msg: &Value) {
        if let Some(stdin) = self.stdin.as_mut() {
            // a dead child is noticed by the stdout reader, not here
            let _ = writeln!(stdin, "{msg}").and_then(|_| stdin.flush());
        }
    }

    fn call_tool(&mut self, call_id: &str, name: &str, args: &Value) -> Result<String, String> {
        let key = format!("{}:{call_id}", self.request_id);
        let (tx, rx) = mpsc::channel();
        let call = Pending { owner: self.owner.to_string(), args: Some(args.to_string()), answer: tx };
        self.pending.lock().unwrap().insert(key.clone(), call);
        let event = json!({"type": "tool_call", "callId": call_id, "name": name});
        let started = Instant::now();
        let mut answer = Err(NO_ANSWER.to_string());
        if self.events.send(&event.to_string()).is_err() {
            answer = Err(UNSENT.to_string());
        } else {
            while started.elapsed() < TOOL_WAIT {
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(text) => {
                        answer = Ok(text);
                        break;
                    }
                    Err(RecvTimeoutError::Timeout) if self.alive() => {}
                    Err(_) => break,
                }
            }
        }
        self.pending.lock().unwrap().remove(&key);
        answer
    }
}

/// The pair is the session's request id and the label of the window that started it.
fn run_session(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    pending: &PendingCalls,
    (request_id, owner): (&str, &str),
    args: &[String],
    mut proto: Protocol,
    deadline: Duration,
    events: EventChannel,
) -> Result<String, String> {
    let bin = provider::resolve_bin(provider::spec("claude")?).ok_or("claude isn't installed (checked its usual homes)")?;
    // a scratch cwd: no project CLAUDE.md or hooks from wherever Rotli launched
    let scratch = tempfile::Builder::new()
        .prefix("rotli-claude-")
        .tempdir()
        .map_err(|e| format!("couldn't create the claude scratch dir: {e}"))?;
    let mut cmd = Command::new(&bin);
    crate::cli_isolation::apply_claude_env(&mut cmd);
    let mut child = cmd
        .args(args)
        .current_dir(scratch.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't launch the CLI: {e}"))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("the CLI has no stdout")?;
    let err_thread = crate::child_run::collect_stderr(child.stderr.take());
    let token = crate::child_run::register(children, request_id, child, deadline);

    let mut wire = LiveWire { stdin, events, pending, children, request_id, owner, token };
    wire.send(&proto.initialize());
    let mut outcome = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if let Step::Done(result) = proto.on_line(&line, &mut wire) {
            outcome = Some(result);
            break;
        }
    }
    drop(wire.stdin.take()); // end of input: the CLI exits on its own
    if let Some(mut running) = crate::child_run::reap(children, request_id, token) {
        let exited = (0..40).any(|_| {
            let done = matches!(running.child.try_wait(), Ok(Some(_)));
            if !done {
                std::thread::sleep(Duration::from_millis(50));
            }
            done
        });
        if !exited {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
    let stderr = err_thread.join().unwrap_or_default();
    outcome.unwrap_or_else(|| Err(provider::with_stderr_tail("claude ended without an answer", &stderr, " — ", "")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The webview's side of a session: read each call's arguments by command,
    /// run `tool` on them, and answer.
    /// The label of the window that starts each test session.
    const OWNER: &str = "main";

    fn wire<'a>(events: EventChannel, pending: &'a PendingCalls, children: &'a Arc<Mutex<HashMap<String, Running>>>) -> LiveWire<'a> {
        LiveWire { stdin: None, events, pending, children, request_id: "r", owner: OWNER, token: 0 }
    }

    fn webview(pending: &PendingCalls, request_id: &str, tool: fn(&Value) -> String) -> EventChannel {
        webview_seeing(pending, request_id, |_| {}, tool)
    }

    fn webview_seeing(
        pending: &PendingCalls,
        request_id: &str,
        see: impl Fn(&str) + Send + Sync + 'static,
        tool: fn(&Value) -> String,
    ) -> EventChannel {
        let (pending, request_id) = (Arc::clone(pending), request_id.to_string());
        EventChannel::from_fn(move |raw| {
            see(&raw);
            let ev: Value = serde_json::from_str(&serde_json::from_str::<String>(&raw).unwrap()).unwrap();
            let key = format!("{request_id}:{}", ev["callId"].as_str().unwrap());
            assert!(take_args(&pending, &key, "finder_1").is_err(), "another window can't read them");
            let args: Value = serde_json::from_str(&take_args(&pending, &key, OWNER).unwrap()).unwrap();
            assert!(take_args(&pending, &key, OWNER).is_err(), "arguments are read once");
            if let Some(call) = pending.lock().unwrap().remove(&key) {
                let _ = call.answer.send(tool(&args));
            }
        })
    }

    fn spec(name: &str) -> ToolSpec {
        ToolSpec { name: name.into(), description: "d".into(), input_schema: json!({"type": "object"}) }
    }

    #[test]
    fn the_argv_keeps_claude_codes_own_tools_and_ambient_config_off() {
        let args = session_args("opus[1m]", None, 9).unwrap();
        let has = |pair: [&str; 2]| args.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1]);
        assert!(has(["--tools", ""]) && has(["--permission-prompt-tool", "stdio"]));
        assert!(has(["--input-format", "stream-json"]) && has(["--max-turns", "9"]) && has(["--model", "opus[1m]"]));
        for flag in ["--safe-mode", "--strict-mcp-config", "--no-session-persistence"] {
            assert!(args.iter().any(|a| a == flag), "missing {flag}");
        }
        assert!(!args.iter().any(|a| a == "--allowedTools" || a == "-p"), "every call must reach can_use_tool");
        // the account default passes no --model, and both lanes share one allowlist
        assert!(!session_args("default", None, 3).unwrap().iter().any(|a| a == "--model"));
        assert!(session_args("not-a-model", None, 3).is_err());
        assert!(session_args("opus[1m]", Some("ludicrous"), 3).is_err());
    }

    /// The real CLI end to end: handshake, the in-process server, a permitted
    /// tool call answered through the pending map, and the final answer.
    /// `cargo test --lib live_round_trip -- --ignored` (spends one haiku turn).
    #[test]
    #[ignore = "spawns the installed claude CLI"]
    fn live_round_trip_with_the_real_cli() {
        let children = Arc::new(Mutex::new(HashMap::new()));
        let pending = PendingCalls::default();
        let events = webview(&pending, "live", |args| format!("ECHO:{}", args["query"].as_str().unwrap_or("")));
        let tool = ToolSpec {
            name: "search_notes".into(),
            description: "Search the user's notes.".into(),
            input_schema: json!({"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}),
        };
        let proto = Protocol::new(
            "You are a terse test agent.".into(),
            "Call search_notes once with the query kiwi, then reply with exactly the text it returned.".into(),
            vec![tool],
        );
        let args = session_args("haiku", None, 4).unwrap();
        let answer = run_session(&children, &pending, ("live", OWNER), &args, proto, Duration::from_secs(120), events).unwrap();
        assert!(answer.contains("ECHO:kiwi"), "got: {answer}");
        assert!(children.lock().unwrap().is_empty() && pending.lock().unwrap().is_empty());
    }

    /// Every streamed message stays under 8 KiB as Tauri serializes it.
    const SMALL: usize = 8192;

    #[test]
    fn a_large_tool_call_reaches_the_webview_in_small_messages() {
        let children = Arc::new(Mutex::new(HashMap::new()));
        let pending = PendingCalls::default();
        let sizes = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&sizes);
        let events = webview_seeing(&pending, "r", move |raw| seen.lock().unwrap().push(raw.len()), |args| {
            format!("{}:{}", args["title"].as_str().unwrap(), args["body"].as_str().unwrap().len())
        });
        let mut wire = wire(events, &pending, &children);
        // quotes and newlines are escaped twice on the way: 5 KiB of them serializes past 11 KiB
        let quoted = "\"line\"\n".repeat(768);
        for (i, body) in ["x".repeat(9000), quoted].into_iter().enumerate() {
            let expected = format!("Long note:{}", body.len());
            let args = json!({"title": "Long note", "body": body});
            assert_eq!(wire.call_tool(&format!("c{i}"), "create_note", &args), Ok(expected));
        }
        let sizes = sizes.lock().unwrap();
        assert!(!sizes.is_empty() && sizes.iter().all(|&n| n < SMALL), "message sizes: {sizes:?}");
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn arguments_no_one_read_are_dropped_when_the_call_ends() {
        let children = Arc::new(Mutex::new(HashMap::new()));
        let pending = PendingCalls::default();
        let events = EventChannel::from_fn(|_| {});
        let mut wire = wire(events, &pending, &children);
        assert_eq!(wire.call_tool("c1", "read_note", &json!({"id": "n1"})), Err(NO_ANSWER.into()));
        assert!(pending.lock().unwrap().is_empty());
        assert!(take_args(&pending, "r:c1", OWNER).is_err());
    }

    #[test]
    fn arguments_are_read_only_by_the_window_that_started_the_session() {
        let pending = PendingCalls::default();
        let (answer, _) = mpsc::channel();
        let call = Pending { owner: OWNER.into(), args: Some("{\"id\":\"n1\"}".into()), answer };
        pending.lock().unwrap().insert("r:c1".into(), call);
        assert_eq!(take_args(&pending, "r:c1", "finder_1"), Err("that tool call has ended".into()));
        assert_eq!(take_args(&pending, "r:c1", OWNER), Ok("{\"id\":\"n1\"}".into()));
    }

    #[test]
    fn a_tool_call_that_cant_be_sent_is_answered_at_once_and_not_as_a_timeout() {
        let children = Arc::new(Mutex::new(HashMap::new()));
        let pending = PendingCalls::default();
        let sent = Arc::new(Mutex::new(0));
        let count = Arc::clone(&sent);
        let mut wire = wire(EventChannel::from_fn(move |_| *count.lock().unwrap() += 1), &pending, &children);
        let started = Instant::now();
        let answer = wire.call_tool(&"c".repeat(crate::event_channel::LIMIT), "read_note", &json!({}));
        assert_eq!(answer, Err(UNSENT.into()));
        assert_ne!(UNSENT, NO_ANSWER);
        assert!(started.elapsed() < Duration::from_millis(200), "it doesn't wait for an answer");
        assert_eq!(*sent.lock().unwrap(), 0);
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn a_session_whose_request_id_is_already_running_is_refused() {
        let running = RunningIds::default();
        let first = claim(&running, "r1").unwrap();
        assert!(claim(&running, "r1").is_err());
        let other = claim(&running, "r2").unwrap();
        drop(first);
        assert!(claim(&running, "r1").is_ok(), "the id is free once its session ends");
        drop(other);
        assert!(running.lock().unwrap().is_empty());
    }

    #[test]
    fn tool_specs_must_look_like_rotli_tools() {
        assert!(check_tools(&[spec("web_fetch")]).is_ok());
        assert!(check_tools(&[spec("Bash")]).is_err());
        assert!(check_tools(&[spec("mcp__x__y-z")]).is_err());
        let mut bad = spec("read_note");
        bad.input_schema = json!("nope");
        assert!(check_tools(&[bad]).is_err());
        assert!(check_tools(&vec![spec("a"); MAX_TOOLS + 1]).is_err());
    }
}
