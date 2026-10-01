//! The agent bridge (docs/decisions/2026-10-01-agent-app-bridge.md): agents
//! (`rotli mcp` in Claude Code or Codex, the paired relay's Grok bot) reach
//! Word documents through the RUNNING app, so one codec reads and writes them
//! and every rule the app keeps applies.
//!
//! `ask_app` is the one entry. Inside the app (the relay) it dispatches in
//! process; a headless `rotli mcp` sends the request over a Unix socket in the
//! per-user app-support folder (never the vault) to the app's listener. Both
//! meet in `dispatch`, which owns the Rust-side rules before and after the
//! webview does the codec work: an agent counts as remote, so a secure or
//! secret-shaped document is refused before the webview reads it and every
//! answer passes the egress check before it leaves; writes need a writable
//! vault and a document an AI made (`ai_files.rs`), and save through
//! `corpus_write_file_ai`'s own gates.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// The tools the bridge carries; anything else is refused before the app sees it.
pub(crate) const BRIDGE_TOOLS: [&str; 3] = ["read_document", "apply_document", "create_document"];
/// How long an agent waits for the app's answer (a big document's save included).
pub(crate) const ANSWER_MAX: Duration = Duration::from_secs(30);
/// The largest .docx an agent gets: the editor's own cap
/// (`DOCUMENT_EDIT_MAX_BYTES`, src/documents/kinds.ts; parity.json), so Rust
/// refuses what the webview would, before reading it.
pub(crate) const DOCX_MAX_BYTES: u64 = 12_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeRequest {
    pub tool: String,
    pub args: Value,
    /// The vault the agent was pointed at; the app refuses any other.
    pub root: PathBuf,
    /// The agent's own read-only flag (the relay's, or a read-only root).
    pub read_only: bool,
    /// Who is asking (MCP `clientInfo.name`), recorded on what it creates.
    pub agent: String,
}

static IN_APP: OnceLock<AppHandle> = OnceLock::new();
static CLIENT: Mutex<Option<String>> = Mutex::new(None);

/// Remember the MCP client's name from `initialize` (sanitized, short).
pub(crate) fn remember_client(params: &Value) {
    let name = params
        .pointer("/clientInfo/name")
        .and_then(Value::as_str)
        .map(agent_name)
        .filter(|name| !name.is_empty());
    if let Ok(mut client) = CLIENT.lock() {
        *client = name;
    }
}

fn agent_name(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
        .take(64)
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn client_name() -> String {
    CLIENT
        .lock()
        .ok()
        .and_then(|client| client.clone())
        .unwrap_or_else(|| "agent".into())
}

/// Ask the running app to carry out one document tool.
pub(crate) fn ask_app(request: BridgeRequest) -> Result<Value, String> {
    if !BRIDGE_TOOLS.contains(&request.tool.as_str()) {
        return Err(format!("unknown document tool: {}", request.tool));
    }
    match IN_APP.get() {
        Some(app) => dispatch(app, request),
        None => crate::agent_bridge_socket::ask_over_socket(&crate::agent_bridge_socket::socket_path()?, &request),
    }
}

/// Start the app's side: remember the app for in-process asks and listen on
/// the socket. Only development builds carry agents; stable opens nothing.
pub(crate) fn start(app: &AppHandle) {
    if !crate::feature_policy::agents_enabled() {
        return;
    }
    let _ = IN_APP.set(app.clone());
    let path = match crate::agent_bridge_socket::socket_path() {
        Ok(path) => path,
        Err(error) => return eprintln!("rotli: agent bridge has no socket path ({error})"),
    };
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("rotli-agent-bridge".into())
        .spawn(move || {
            if let Err(error) = crate::agent_bridge_socket::listen(&app, &path) {
                eprintln!("rotli: agent bridge is not listening ({error})");
            }
        });
}

/// The vault and write rules, from what the agent asked and what the app has open.
fn admit(request: &BridgeRequest, app_root: &Path, app_read_only: bool) -> Result<(), String> {
    // both must exist: two missing folders would otherwise compare as strings
    let same = |path: &Path| std::fs::canonicalize(path).ok();
    let (asked, open) = (same(&request.root), same(app_root));
    if asked.is_none() || asked != open {
        return Err("Rotli has a different vault open. Switch Rotli to the agent's vault, or point the agent at the open one.".into());
    }
    if request.tool != "read_document" && (request.read_only || app_read_only) {
        return Err("this vault is read-only for agents".into());
    }
    Ok(())
}

/// A document's file id inside the vault, or why it isn't one.
fn document_rel(request: &BridgeRequest) -> Result<String, String> {
    let file = request
        .args
        .get("file")
        .and_then(Value::as_str)
        .ok_or("name the document's file id (from rotli_list)")?;
    let (_, rel) = crate::corpus::split_root_id(file);
    crate::corpus::validate_rel(&rel)?;
    if !rel.to_ascii_lowercase().ends_with(".docx") {
        return Err("Rotli's agents read and edit Word documents (.docx)".into());
    }
    Ok(rel)
}

/// What a remote reader may never receive, by the vault's own records (held
/// under the corpus lock): a document hidden from agents or named with a
/// secure keyword, and, for an edit, one no AI made. Returns its path.
fn document_records_gate(
    store: &mut crate::corpus::CorpusStore,
    rel: &str,
    editing: bool,
) -> Result<PathBuf, String> {
    if !store.agent_listable(rel) {
        return Err("that document isn't available to agents".into());
    }
    let title = Path::new(rel).file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    if store.secure_by_name(title, rel) {
        return Err("blocked: that document is named as secure; Rotli never gives it to an agent".into());
    }
    let path = store.guard_rel(rel)?;
    if editing && !crate::ai_files::ai_may_edit(store.root(), rel) {
        return Err("that Word document is a person's: agents edit only documents an AI created. Ask for a new document instead".into());
    }
    Ok(path)
}

/// ...and by its contents (read outside the corpus lock): too large for the
/// editor, or holding secret-shaped text.
fn document_contents_gate(path: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|_| "that document doesn't exist".to_string())?;
    if meta.len() > DOCX_MAX_BYTES {
        return Err("that document is too large for an agent".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if crate::secret::blocked_for_remote(&crate::ai_files::docx_text(&bytes)?) {
        return Err("blocked: that document holds secret-shaped text; Rotli never gives it to an agent".into());
    }
    Ok(())
}

const EGRESS_BLOCKED: &str = "blocked: the answer would carry secret-shaped text";

/// Every answer leaves Rust only after the same egress check every reader
/// gets: a result, and a refusal's own words too.
fn egress(answer: Result<Value, String>) -> Result<Value, String> {
    match answer {
        Ok(result) => {
            let text = serde_json::to_string(&result).map_err(|e| e.to_string())?;
            if crate::secret::blocked_for_remote(&text) {
                return Err(EGRESS_BLOCKED.into());
            }
            Ok(result)
        }
        Err(error) if crate::secret::blocked_for_remote(&error) => Err(EGRESS_BLOCKED.into()),
        Err(error) => Err(error),
    }
}

pub(crate) fn dispatch(app: &AppHandle, request: BridgeRequest) -> Result<Value, String> {
    crate::feature_policy::require_agents()?;
    let corpus = app.state::<crate::corpus::CorpusState>();
    let root_id = corpus.default_root_id()?;
    let app_root = corpus.default_root_path()?;
    admit(&request, &app_root, crate::development_read_only(app))?;
    if request.tool == "create_document" {
        let title = request.args.get("title").and_then(Value::as_str).unwrap_or_default().trim().to_string();
        let rel = format!("storage/rotli/{title}.docx");
        if corpus.route(&root_id, |store| Ok(store.secure_by_name(&title, &rel)))? {
            return Err("blocked: that name is one of the vault's secure keywords; agents don't make documents named as secure".into());
        }
    } else {
        let rel = document_rel(&request)?;
        let editing = request.tool == "apply_document";
        let path = corpus.route(&root_id, |store| document_records_gate(store, &rel, editing))?;
        document_contents_gate(&path)?;
    }
    egress(app.state::<Pending>().ask(app, &request))
}

/// Requests the main webview owes an answer, by id (several agents at once).
#[derive(Default)]
pub(crate) struct Pending {
    /// The main webview listens for requests (`agent_bridge_ready`); until
    /// then a request is refused at once instead of waiting out the timeout.
    listening: std::sync::atomic::AtomicBool,
    next: AtomicU64,
    answers: Mutex<HashMap<u64, Option<Result<Value, String>>>>,
    ready: Condvar,
}

impl Pending {
    fn begin(&self) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut answers) = self.answers.lock() {
            answers.insert(id, None);
        }
        id
    }

    /// An answer for a request still waiting; any other id is ignored.
    fn finish(&self, id: u64, answer: Result<Value, String>) {
        let Ok(mut answers) = self.answers.lock() else { return };
        if let Some(slot) = answers.get_mut(&id) {
            if slot.is_none() {
                *slot = Some(answer);
                self.ready.notify_all();
            }
        }
    }

    fn wait(&self, id: u64, max: Duration) -> Result<Value, String> {
        let deadline = Instant::now() + max;
        let mut answers = self.answers.lock().map_err(|_| "agent bridge lock poisoned")?;
        loop {
            if let Some(Some(_)) = answers.get(&id) {
                return answers.remove(&id).flatten().unwrap_or_else(|| Err("no answer".into()));
            }
            let now = Instant::now();
            if now >= deadline {
                answers.remove(&id);
                return Err("Rotli didn't answer in time. Is a dialog open in Rotli?".into());
            }
            answers = self
                .ready
                .wait_timeout(answers, deadline - now)
                .map_err(|_| "agent bridge lock poisoned")?
                .0;
        }
    }

    fn listening(&self) -> Result<(), String> {
        if self.listening.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err("Rotli is still starting; try again in a moment".into())
        }
    }

    fn ask(&self, app: &AppHandle, request: &BridgeRequest) -> Result<Value, String> {
        self.listening()?;
        let id = self.begin();
        let event = json!({
            "requestId": id,
            "tool": request.tool,
            "args": request.args,
            "agent": request.agent,
        });
        if app.emit_to("main", "rotli:agent-request", event).is_err() {
            self.finish(id, Err("Rotli's window didn't receive the request".into()));
        }
        self.wait(id, ANSWER_MAX)
    }
}

/// The main webview now listens for agent requests.
#[tauri::command]
pub(crate) fn agent_bridge_ready(window: tauri::WebviewWindow, pending: tauri::State<'_, Pending>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only Rotli's main window answers agents".into());
    }
    pending.listening.store(true, Ordering::Release);
    Ok(())
}

/// The main webview's answer to a `rotli:agent-request`.
#[tauri::command]
pub(crate) fn agent_bridge_reply(
    window: tauri::WebviewWindow,
    pending: tauri::State<'_, Pending>,
    request_id: u64,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only Rotli's main window answers agents".into());
    }
    let answer = if ok {
        Ok(result.unwrap_or(Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "Rotli refused the request".into()))
    };
    pending.finish(request_id, answer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(tool: &str, root: &Path, read_only: bool) -> BridgeRequest {
        BridgeRequest {
            tool: tool.into(),
            args: json!({ "file": "storage/rotli/plan.docx" }),
            root: root.to_path_buf(),
            read_only,
            agent: "claude-code".into(),
        }
    }

    #[test]
    fn answers_meet_their_own_request_and_a_silent_app_times_out() {
        let pending = std::sync::Arc::new(Pending::default());
        let (first, second) = (pending.begin(), pending.begin());
        let waiter = {
            let pending = pending.clone();
            std::thread::spawn(move || pending.wait(first, Duration::from_secs(2)))
        };
        pending.finish(999, Ok(json!("stray")));
        pending.finish(second, Ok(json!("second")));
        pending.finish(first, Ok(json!("first")));
        // a second answer for the same id never replaces the first
        pending.finish(first, Ok(json!("late")));
        assert_eq!(waiter.join().unwrap(), Ok(json!("first")));
        assert_eq!(pending.wait(second, Duration::from_millis(10)), Ok(json!("second")));
        let silent = pending.begin();
        assert!(pending.wait(silent, Duration::from_millis(20)).unwrap_err().contains("in time"));
        // a timed-out request is forgotten: its late answer goes nowhere
        pending.finish(silent, Ok(json!("too late")));
        assert!(pending.answers.lock().unwrap().is_empty());
    }

    #[test]
    fn only_the_open_vault_and_writes_only_where_writable() {
        let open = tempfile::TempDir::new().unwrap();
        let other = tempfile::TempDir::new().unwrap();
        assert!(admit(&request("read_document", open.path(), false), open.path(), false).is_ok());
        assert!(admit(&request("read_document", other.path(), false), open.path(), false)
            .unwrap_err()
            .contains("different vault"));
        // a vault that isn't there is never the open one, even by the same name
        let gone = open.path().join("gone");
        assert!(admit(&request("read_document", &gone, false), &gone, false).is_err());
        // reads stay open on a read-only vault; writes don't
        assert!(admit(&request("read_document", open.path(), true), open.path(), true).is_ok());
        for tool in ["apply_document", "create_document"] {
            assert!(admit(&request(tool, open.path(), true), open.path(), false).is_err());
            assert!(admit(&request(tool, open.path(), false), open.path(), true).is_err());
            assert!(admit(&request(tool, open.path(), false), open.path(), false).is_ok());
        }
    }

    #[test]
    fn a_document_id_stays_a_docx_inside_the_vault() {
        let mut bad = request("read_document", Path::new("/v"), false);
        for file in ["../outside.docx", "/etc/passwd", "storage/rotli/notes.md"] {
            bad.args = json!({ "file": file });
            assert!(document_rel(&bad).is_err(), "{file}");
        }
        bad.args = json!({});
        assert!(document_rel(&bad).is_err());
        assert_eq!(
            document_rel(&request("read_document", Path::new("/v"), false)).unwrap(),
            "storage/rotli/plan.docx"
        );
    }

    /// Both halves of the document check, as dispatch runs them.
    fn document_gate(store: &mut crate::corpus::CorpusStore, rel: &str, editing: bool) -> Result<(), String> {
        let path = document_records_gate(store, rel, editing)?;
        document_contents_gate(&path)
    }

    #[test]
    fn a_document_reaches_an_agent_only_when_clean_and_edits_only_when_ai_made() {
        use crate::ai_files::tests::{zip_with, XML};
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().join("brain");
        std::fs::create_dir_all(root.join(".rotli")).unwrap();
        std::fs::write(root.join("memex.json"), r#"{"id":"mx_bridge","contract":"3.4","apps":{}}"#).unwrap();
        for folder in ["self", "wiki", "history", "chats", "archive", "trash"] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
        }
        std::fs::write(root.join(".rotli/settings.json"), r#"{"librarianRules":{"secureKeywords":["bank"]}}"#)
            .unwrap();
        let mut store = crate::corpus::CorpusStore::open(root.clone()).unwrap();
        let docx = |xml: &str| zip_with(&[("word/document.xml", xml.as_bytes())], true);
        let plan = store.create_managed_file("plan.docx", &docx(XML)).unwrap();
        let bank = store.create_managed_file("bank details.docx", &docx(XML)).unwrap();
        let secret = XML.replace("Launch &amp; land", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        let keys = store.create_managed_file("keys.docx", &docx(&secret)).unwrap();

        assert!(document_gate(&mut store, &plan, false).is_ok());
        assert!(document_gate(&mut store, &bank, false).unwrap_err().contains("secure"));
        assert!(document_gate(&mut store, &keys, false).unwrap_err().contains("secret-shaped"));
        assert!(document_gate(&mut store, "storage/rotli/missing.docx", false).is_err());
        // a person's document reads, but never edits
        assert!(document_gate(&mut store, &plan, true).unwrap_err().contains("a person's"));
        std::fs::write(
            root.join(".rotli/file-grants.json"),
            format!(r#"{{"v":1,"files":{{"{plan}":{{"createdBy":"agent","agent":"Codex","aiEdit":true}}}}}}"#),
        )
        .unwrap();
        assert!(document_gate(&mut store, &plan, true).is_ok());
        // over the editor's own cap: refused before it is read
        let big = root.join("storage/rotli/big.docx");
        std::fs::File::create(&big).unwrap().set_len(DOCX_MAX_BYTES + 1).unwrap();
        assert!(document_contents_gate(&big).unwrap_err().contains("too large"));
    }

    #[test]
    fn no_answer_leaves_with_secret_shaped_text() {
        let key = "key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        assert!(egress(Ok(json!({ "blocks": "[1] paragraph: Launch" }))).is_ok());
        assert_eq!(egress(Ok(json!({ "blocks": key }))).unwrap_err(), EGRESS_BLOCKED);
        // a refusal's own words are checked too
        assert_eq!(egress(Err(format!("error: no block 9 in {key}"))).unwrap_err(), EGRESS_BLOCKED);
        assert_eq!(egress(Err("error: no block 9".into())).unwrap_err(), "error: no block 9");
    }

    #[test]
    fn a_request_before_the_window_listens_is_refused_at_once() {
        let pending = Pending::default();
        assert!(pending.listening().unwrap_err().contains("still starting"));
        pending.listening.store(true, Ordering::Release);
        assert!(pending.listening().is_ok());
    }

    #[test]
    fn an_agent_is_named_by_its_client_never_by_markup() {
        assert_eq!(agent_name("Claude Code <script>"), "Claude Code script");
        assert_eq!(agent_name(&"x".repeat(200)).len(), 64);
    }


}
