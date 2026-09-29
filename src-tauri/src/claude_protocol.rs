//! The stream-json control protocol for one Claude chat turn, free of processes
//! so every line can be tested: the `initialize` handshake that declares
//! Rotli's in-process MCP server, the MCP JSON-RPC it answers, the
//! `can_use_tool` permission decision, and how a turn ends (answer, error, or
//! a safety refusal). claude_session.rs runs it against the real CLI.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::workspace::{mcp_initialized, mcp_success, mcp_tools_listed, mcp_unknown_method};

const SERVER: &str = "rotli";
const TOOL_PREFIX: &str = "mcp__rotli__";
const INIT_ID: &str = "rotli-init";
/// A single tool result's cap before it reaches the model.
const RESULT_CAP: usize = crate::workspace::MCP_MAX_REQUEST_BYTES;

/// What the user reads when Claude's safety filter declines a turn. The raw
/// "API Error: … safeguards flagged this message" is Claude Code's copy.
pub(crate) const REFUSAL_MESSAGE: &str = "Claude's safety filter declined this message. That sometimes happens with ordinary requests — try rewording it, or pick another model for this chat.";
const WITHHELD: &str = "withheld: this result carries secret-shaped or secure text, so Rotli did not send it to the remote model.";

/// One Rotli tool as the model sees it.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// The side effects the protocol needs: write a line to the CLI, and run a
/// tool in the webview (None = it never answered).
pub(crate) trait Wire {
    fn send(&mut self, msg: &Value);
    fn call_tool(&mut self, call_id: &str, name: &str, args: &Value) -> Option<String>;
}

pub(crate) enum Step {
    Continue,
    Done(Result<String, String>),
}

pub(crate) struct Protocol {
    system_prompt: String,
    user_text: String,
    tools: Vec<ToolSpec>,
    refused: bool,
    calls: u64,
}

impl Protocol {
    pub(crate) fn new(system_prompt: String, user_text: String, tools: Vec<ToolSpec>) -> Self {
        Self { system_prompt, user_text, tools, refused: false, calls: 0 }
    }

    fn offers(&self, name: &str) -> bool {
        self.tools.iter().any(|t| t.name == name)
    }

    pub(crate) fn initialize(&self) -> Value {
        json!({"type": "control_request", "request_id": INIT_ID, "request": {
            "subtype": "initialize", "sdkMcpServers": [SERVER], "systemPrompt": [self.system_prompt],
        }})
    }

    fn user_message(&self) -> Value {
        json!({"type": "user", "session_id": "", "parent_tool_use_id": null,
            "message": {"role": "user", "content": [{"type": "text", "text": self.user_text}]}})
    }

    pub(crate) fn on_line(&mut self, line: &str, wire: &mut dyn Wire) -> Step {
        let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
            return Step::Continue;
        };
        match msg["type"].as_str().unwrap_or("") {
            "control_response" if msg["response"]["request_id"] == INIT_ID => {
                if msg["response"]["subtype"] != "success" {
                    let why = msg["response"]["error"].as_str().unwrap_or("no reason given");
                    return Step::Done(Err(format!("claude couldn't start the chat ({why})")));
                }
                wire.send(&self.user_message());
            }
            "control_request" => {
                let reply = match self.control(&msg["request"], wire) {
                    Ok(response) => json!({"subtype": "success", "request_id": msg["request_id"], "response": response}),
                    Err(error) => json!({"subtype": "error", "request_id": msg["request_id"], "error": error}),
                };
                wire.send(&json!({"type": "control_response", "response": reply}));
            }
            "system" if msg["subtype"] == "model_refusal_no_fallback" => self.refused = true,
            "assistant" if msg["message"]["stop_reason"] == "refusal" => self.refused = true,
            "result" => return Step::Done(self.finish(&msg)),
            _ => {}
        }
        Step::Continue
    }

    fn control(&mut self, req: &Value, wire: &mut dyn Wire) -> Result<Value, String> {
        match req["subtype"].as_str().unwrap_or("") {
            "mcp_message" if req["server_name"] == SERVER => {
                let m = &req["message"];
                let is_request = m.get("method").is_some() && m.get("id").is_some_and(|id| !id.is_null());
                // a notification is acknowledged with an empty result, as the SDK does
                let response = if is_request { self.jsonrpc(m, wire) } else { mcp_success(json!(0), json!({})) };
                Ok(json!({"mcp_response": response}))
            }
            "can_use_tool" => {
                let name = req["tool_name"].as_str().unwrap_or("");
                let ours = name.strip_prefix(TOOL_PREFIX).is_some_and(|n| self.offers(n));
                Ok(if ours {
                    json!({"behavior": "allow", "updatedInput": req["input"], "toolUseID": req["tool_use_id"]})
                } else {
                    json!({"behavior": "deny", "message": "Rotli runs only its own tools in chat.", "toolUseID": req["tool_use_id"]})
                })
            }
            other => Err(format!("rotli does not handle \"{other}\"")),
        }
    }

    fn jsonrpc(&mut self, m: &Value, wire: &mut dyn Wire) -> Value {
        let id = m["id"].clone();
        match m["method"].as_str().unwrap_or("") {
            "initialize" => mcp_success(id, mcp_initialized(SERVER)),
            "tools/list" => {
                let tools: Vec<Value> = self
                    .tools
                    .iter()
                    .map(|t| json!({"name": t.name, "description": t.description, "inputSchema": t.input_schema}))
                    .collect();
                mcp_tools_listed(id, tools)
            }
            "tools/call" => mcp_success(id, self.tool_call(&m["params"], wire)),
            _ => mcp_unknown_method(id),
        }
    }

    fn tool_call(&mut self, params: &Value, wire: &mut dyn Wire) -> Value {
        let tool_error = |text: &str| json!({"content": [{"type": "text", "text": text}], "isError": true});
        let name = params["name"].as_str().unwrap_or("");
        if !self.offers(name) {
            return tool_error("that tool isn't available in this chat");
        }
        let args = if params["arguments"].is_object() { params["arguments"].clone() } else { json!({}) };
        if crate::secret::blocked_for_remote(&args.to_string()) {
            return tool_error("blocked: that input looks like it carries a secret or secure text.");
        }
        self.calls += 1;
        let Some(text) = wire.call_tool(&format!("c{}", self.calls), name, &args) else {
            return tool_error("the tool didn't answer in time");
        };
        // a result no longer rides back inside a rescanned prompt — scan it here
        let text = cap_bytes(text, RESULT_CAP);
        if crate::secret::blocked_for_remote(&text) {
            return tool_error(WITHHELD);
        }
        json!({"content": [{"type": "text", "text": text}]})
    }

    fn finish(&self, msg: &Value) -> Result<String, String> {
        let text = msg["result"].as_str().unwrap_or("").trim().to_string();
        let is_error = msg["is_error"].as_bool() == Some(true);
        if self.refused || (is_error && text.contains("safeguards flagged")) {
            return Err(REFUSAL_MESSAGE.into());
        }
        if !is_error {
            return Ok(text);
        }
        if msg["subtype"] == "error_max_turns" {
            return Err("Claude used every step this turn allows without finishing — ask again, or narrow the question.".into());
        }
        let errors: Vec<&str> = msg["errors"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        Err(match (text.is_empty(), errors.is_empty()) {
            (false, _) => text,
            (true, false) => errors.join("; "),
            (true, true) => "claude returned an error".into(),
        })
    }
}

fn cap_bytes(mut s: String, cap: usize) -> String {
    if s.len() <= cap {
        return s;
    }
    let mut end = cap;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s.truncate(end);
    s.push_str("\n[…truncated]");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    type Answer = Box<dyn FnMut(&str, &Value) -> Option<String>>;

    /// Records what the protocol writes; answers tool calls from a closure.
    struct FakeWire {
        sent: Vec<Value>,
        calls: Vec<(String, String, Value)>,
        answer: Answer,
    }

    impl FakeWire {
        fn answering(answer: impl FnMut(&str, &Value) -> Option<String> + 'static) -> Self {
            Self { sent: Vec::new(), calls: Vec::new(), answer: Box::new(answer) }
        }
        fn last(&self) -> &Value {
            self.sent.last().expect("something was sent")
        }
        fn mcp_reply(&self) -> &Value {
            &self.last()["response"]["response"]["mcp_response"]
        }
        fn tool_error(&self) -> String {
            let r = &self.mcp_reply()["result"];
            assert_eq!(r["isError"], true);
            r["content"][0]["text"].as_str().unwrap().to_string()
        }
    }

    impl Wire for FakeWire {
        fn send(&mut self, msg: &Value) {
            self.sent.push(msg.clone());
        }
        fn call_tool(&mut self, call_id: &str, name: &str, args: &Value) -> Option<String> {
            self.calls.push((call_id.into(), name.into(), args.clone()));
            (self.answer)(name, args)
        }
    }

    fn spec(name: &str) -> ToolSpec {
        ToolSpec { name: name.into(), description: format!("{name} tool"), input_schema: json!({"type": "object"}) }
    }

    fn proto() -> Protocol {
        Protocol::new("SYSTEM".into(), "Review this link".into(), vec![spec("web_fetch"), spec("read_note")])
    }

    fn mcp(id: Value, method: &str, params: Value) -> String {
        json!({"type": "control_request", "request_id": "r1", "request": {
            "subtype": "mcp_message", "server_name": SERVER,
            "message": {"jsonrpc": "2.0", "id": id, "method": method, "params": params},
        }})
        .to_string()
    }

    fn call(name: &str, args: Value) -> String {
        mcp(json!(7), "tools/call", json!({"name": name, "arguments": args}))
    }

    fn done(step: Step) -> Result<String, String> {
        match step {
            Step::Done(r) => r,
            Step::Continue => panic!("expected the turn to finish"),
        }
    }

    #[test]
    fn initialize_declares_the_sdk_server_and_the_system_prompt() {
        let init = proto().initialize();
        assert_eq!(init["request"]["sdkMcpServers"], json!([SERVER]));
        assert_eq!(init["request"]["systemPrompt"], json!(["SYSTEM"]));
    }

    #[test]
    fn the_user_message_goes_out_only_after_initialize_succeeds() {
        let mut w = FakeWire::answering(|_, _| None);
        let reply = |subtype: &str| json!({"type": "control_response", "response": {"subtype": subtype, "request_id": INIT_ID, "error": "not signed in"}}).to_string();
        assert!(matches!(proto().on_line(&reply("success"), &mut w), Step::Continue));
        assert_eq!(w.last()["message"]["content"][0]["text"], "Review this link");
        assert!(done(proto().on_line(&reply("error"), &mut w)).unwrap_err().contains("not signed in"));
    }

    #[test]
    fn the_mcp_handshake_lists_only_the_offered_tools() {
        let mut p = proto();
        let mut w = FakeWire::answering(|_, _| None);
        p.on_line(&mcp(json!(0), "initialize", json!({"protocolVersion": "2025-11-25"})), &mut w);
        assert_eq!(w.mcp_reply()["result"], mcp_initialized(SERVER));
        assert_eq!(w.last()["response"]["request_id"], "r1");
        p.on_line(&mcp(json!(1), "tools/list", json!({})), &mut w);
        let listed = w.mcp_reply()["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].clone()).collect::<Vec<_>>();
        assert_eq!(listed, [json!("web_fetch"), json!("read_note")]);
        p.on_line(&mcp(json!(2), "resources/list", json!({})), &mut w);
        assert_eq!(*w.mcp_reply(), mcp_unknown_method(json!(2)));
        let note = json!({"type": "control_request", "request_id": "n1", "request": {
            "subtype": "mcp_message", "server_name": SERVER, "message": {"method": "notifications/initialized"}}});
        p.on_line(&note.to_string(), &mut w);
        assert_eq!(w.mcp_reply()["result"], json!({}));
        assert!(w.calls.is_empty(), "no tool ran during the handshake");
    }

    #[test]
    fn only_offered_rotli_tools_are_permitted() {
        let mut p = proto();
        let mut w = FakeWire::answering(|_, _| None);
        let ask = |tool: &str| {
            json!({"type": "control_request", "request_id": "p1", "request": {
                "subtype": "can_use_tool", "tool_name": tool, "input": {"url": "u"}, "tool_use_id": "t1"}})
            .to_string()
        };
        p.on_line(&ask(&format!("{TOOL_PREFIX}web_fetch")), &mut w);
        let allow = &w.last()["response"]["response"];
        assert_eq!((allow["behavior"].as_str(), allow["updatedInput"]["url"].as_str()), (Some("allow"), Some("u")));
        for tool in [format!("{TOOL_PREFIX}create_note"), "Bash".into(), "WebFetch".into(), "mcp__other__web_fetch".into()] {
            p.on_line(&ask(&tool), &mut w);
            assert_eq!(w.last()["response"]["response"]["behavior"], "deny", "{tool} must be denied");
        }
        for req in [json!({"subtype": "mcp_message", "server_name": "evil", "message": {"id": 1}}), json!({"subtype": "hook_callback"})] {
            p.on_line(&json!({"type": "control_request", "request_id": "x", "request": req}).to_string(), &mut w);
            assert_eq!(w.last()["response"]["subtype"], "error");
        }
    }

    #[test]
    fn a_tool_call_runs_in_the_webview_and_returns_its_text() {
        let mut p = proto();
        let mut w = FakeWire::answering(|name, args| Some(format!("{name} read {}", args["url"])));
        p.on_line(&call("web_fetch", json!({"url": "https://a.example"})), &mut w);
        assert_eq!((w.calls.len(), w.calls[0].0.as_str()), (1, "c1"));
        assert_eq!(w.mcp_reply()["result"]["content"][0]["text"], "web_fetch read \"https://a.example\"");
        assert!(w.mcp_reply()["result"].get("isError").is_none());
    }

    #[test]
    fn tool_calls_that_break_a_gate_never_reach_the_webview_or_the_model() {
        let mut p = proto();
        let mut w = FakeWire::answering(|_, _| Some("fine".into()));
        p.on_line(&call("create_note", json!({})), &mut w);
        assert!(w.tool_error().contains("isn't available"));
        p.on_line(&call("web_fetch", json!({"url": "https://x.example/?k=sk-ant-abcdefghijklmnop"})), &mut w);
        assert!(w.tool_error().contains("blocked"));
        assert!(w.calls.is_empty(), "neither call reached the webview");
        let mut leaky = FakeWire::answering(|_, _| Some("token: sk-ant-abcdefghijklmnop".into()));
        p.on_line(&call("read_note", json!({"id": "n1"})), &mut leaky);
        assert!(leaky.tool_error().starts_with("withheld"));
        let mut silent = FakeWire::answering(|_, _| None);
        p.on_line(&call("read_note", json!({"id": "n1"})), &mut silent);
        assert!(silent.tool_error().contains("didn't answer"));
    }

    #[test]
    fn an_oversized_result_is_capped_on_a_char_boundary() {
        let capped = cap_bytes("é".repeat(RESULT_CAP), RESULT_CAP);
        assert!(capped.len() <= RESULT_CAP + 20 && capped.ends_with("[…truncated]"));
        assert_eq!(cap_bytes("short".into(), RESULT_CAP), "short");
    }

    #[test]
    fn the_result_line_finishes_the_turn() {
        let mut w = FakeWire::answering(|_, _| None);
        let end = |v: Value| done(proto().on_line(&v.to_string(), &mut FakeWire::answering(|_, _| None)));
        assert_eq!(end(json!({"type": "result", "is_error": false, "result": "  The answer.  "})).unwrap(), "The answer.");
        assert!(end(json!({"type": "result", "is_error": true, "result": "bad model"})).unwrap_err().contains("bad model"));
        assert!(end(json!({"type": "result", "subtype": "error_max_turns", "is_error": true})).unwrap_err().contains("every step"));
        assert_eq!(end(json!({"type": "result", "is_error": true, "errors": ["boom"]})).unwrap_err(), "boom");
        assert!(matches!(proto().on_line("not json", &mut w), Step::Continue));
        assert!(w.sent.is_empty());
    }

    #[test]
    fn a_safety_refusal_reads_as_one_plain_message_whichever_signal_carries_it() {
        let mut w = FakeWire::answering(|_, _| None);
        let api = "API Error: Opus 5.5 (1M context)'s safeguards flagged this message (https://www.anthropic.com/legal/aup).";
        let refused = json!({"type": "result", "is_error": true, "result": api});
        assert_eq!(done(proto().on_line(&refused.to_string(), &mut w)).unwrap_err(), REFUSAL_MESSAGE);
        let quiet = json!({"type": "result", "is_error": false, "result": api}).to_string();
        let frame = json!({"type": "assistant", "message": {"stop_reason": "refusal", "content": []}});
        let system = json!({"type": "system", "subtype": "model_refusal_no_fallback", "api_refusal_category": "reasoning_extraction"});
        for signal in [frame, system] {
            let mut p = proto();
            p.on_line(&signal.to_string(), &mut w);
            assert_eq!(done(p.on_line(&quiet, &mut w)).unwrap_err(), REFUSAL_MESSAGE);
        }
    }
}
