//! The guard for "an agent never learns a protected path" (Opus re-check of
//! pull request 304: source scans caught none of seven mutations, and missed
//! Main, note history, and an error text). A behaviour harness instead: one
//! vault seeded with a decoy in every place a protected name can hide, then
//! every tool the workspace MCP server and the Librarian route list, and every
//! command `rotli help` names, called for real; no protected name may appear
//! in any answer or error. A tool or command the harness doesn't know fails
//! the test, so a new one is covered the day it lands.

use super::tests::test_workspace;
use super::*;
use tempfile::TempDir;

/// Names that exist only in protected places of the seeded vault.
const PROTECTED: [&str; 10] =
    ["_secure", "ſecure", "Juniper", "jUNIPER", "PrivateProject", "DirectExample", "Bank plan", "Diary", "STRASSE", "Hidden note"];

const OPEN: &str = "01SURFOPEN00000000000000000";
const AGENT_NOTE: &str = "01SURFAGENT0000000000000000";
const BOARD: &str = "wiki/Projects/b.excalidraw";

fn put(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, text).unwrap();
}

/// A vault with a public note, board, and file beside every kind of decoy.
fn seeded() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_agent_surface\",\"contract\":\"3.4\",\"apps\":{}}\n").unwrap();
    put(root, ".rotli/settings.json", "{\"librarianRules\":{\"secureKeywords\":[\"Juniper\",\"Straße\"]},\"librarianMcp\":true}\n");
    let note = |id: &str, extra: &str, title: &str, body: &str| format!("---\nid: {id}\n{extra}---\n# {title}\n\n{body}\n");
    // public: a note, an agent-made note, a board, a file, links to each
    put(root, "wiki/Projects/open.md", &note(OPEN, "", "Open", "plain words [f](wiki/Projects/pub.csv)"));
    put(root, "wiki/Projects/a.md", &note(AGENT_NOTE, "created_by: agent\n", "Agent", "plain words"));
    put(root, BOARD, "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}");
    put(root, "wiki/Projects/pub.csv", "a,b\n1,2\n");
    // the secure home, in its canonical spelling
    put(root, "wiki/_secure/PrivateProject/s.md", &note("01SURFSECRET000000000000000", "", "Hidden note", "plain words classified"));
    put(root, "wiki/_secure/Bank plan.md", &note("01SURFBANK00000000000000000", "", "Hidden note two", "plain words classified"));
    put(root, "wiki/_secure/b.excalidraw", "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[{\"id\":\"t\",\"type\":\"text\",\"text\":\"classified\",\"x\":0,\"y\":0,\"width\":10,\"height\":10}]}");
    put(root, "wiki/_secure/f.csv", "a,b\nclassified,2\n");
    std::os::unix::fs::symlink(root.join("wiki/_secure"), root.join("wiki/Link")).unwrap();
    // a locked secure note linking the agent's note by path (S2)
    put(root, "wiki/_secure/Diary of Juniper.md", &note("01SURFDIARY0000000000000000", "locked: true\n", "Diary", "see [a](../Projects/a.md)"));
    // keyword folders, in other spellings and as an ancestor
    put(root, "wiki/Projects/jUNIPER/Ordinary/n.md", &note("01SURFKEYWORD00000000000000", "", "Hidden note three", "plain words"));
    put(root, "wiki/Projects/jUNIPER/Ordinary/f.csv", "a,b\n1,2\n");
    put(root, "wiki/STRASSE/n.md", &note("01SURFSTRASSE00000000000000", "", "Hidden note four", "plain words"));
    // public notes whose id, shelf, or origin names a protected place
    put(root, "wiki/Projects/decoy.md", &note("wiki/_secure/PrivateProject", "", "Decoy", "plain words"));
    put(root, "wiki/Projects/shelved.md", &note("01SURFSHELF000000000000000", "shelf: [wiki/_secure/DirectExample]\n", "Shelved", "plain words"));
    put(root, "archive/gone.md", &note("01SURFGONE00000000000000000", "origin: wiki/Projects/Juniper\n", "Gone", "plain words"));
    // Main and a named view holding the path-shaped id (B1)
    let tree = format!("[{{\"note\":\"wiki/_secure/PrivateProject\"}},{{\"note\":\"{OPEN}\"}}]");
    put(root, ".rotli/main.json", &format!("{{\"version\":1,\"tree\":{tree}}}\n"));
    put(root, ".rotli/views.json", &format!("{{\"version\":1,\"views\":[{{\"name\":\"V\",\"tree\":{tree}}}]}}\n"));
    // the AI journal: a row from when the open note lived in the secure home (B2)
    let mut row = crate::corpus::ai_journal::AiEditRow::new("edit", OPEN, "wiki/_secure/Bank plan.md", &crate::corpus::ai_journal::AiEditor::agent(None), "fnv1a64:0");
    row.extra.insert("from".into(), json!("wiki/Projects/Juniper/x.md"));
    put(root, ".rotli/ai-edit-journal.jsonl", &format!("{}\n", serde_json::to_string(&row).unwrap()));
    super::librarian::record_consent(root, true).unwrap();
    temp
}

/// Answers that mean the harness, not the tool, was wrong: the call never
/// reached the vault, so it proved nothing.
const SETUP_FAILURES: [&str; 3] = ["outside the range rotli supports", "is not an argument this tool takes", "while parsing"];

fn setup_failure(from: &str, answer: &str) -> Option<String> {
    SETUP_FAILURES.iter().find(|text| answer.contains(**text)).map(|text| format!("{from}: never reached the vault ({text})"))
}

/// Each protected name in `answer`, with the text around it.
fn leaks(from: &str, answer: &str) -> Vec<String> {
    PROTECTED
        .iter()
        .filter_map(|name| {
            let at = answer.find(name)?;
            let start = answer.floor_char_boundary(at.saturating_sub(80));
            let end = answer.ceil_char_boundary((at + name.len() + 80).min(answer.len()));
            Some(format!("{from}: {name} in …{}…", &answer[start..end]))
        })
        .collect()
}

fn revision(temp: &TempDir, id: &str) -> String {
    let mut ws = test_workspace(temp);
    ws.read_note(id).map(|read| read.revision).unwrap_or_default()
}

/// Arguments for each workspace MCP tool. None: not called for real, with the
/// reason; the payload it would return is checked another way below.
fn workspace_tool_args(name: &str, temp: &TempDir) -> Option<Option<Value>> {
    let rev = || revision(temp, OPEN);
    Some(Some(match name {
        "rotli_status" | "rotli_metrics" | "rotli_list_main" | "rotli_list_views" => json!({}),
        "rotli_list" => json!({"limit": 500}),
        "rotli_search" => json!({"query": "plain"}),
        "rotli_query" => json!({"query": "title:~\"e\""}),
        "rotli_read_note" => json!({"id": OPEN}),
        "rotli_create_note" => json!({"title": "New", "body": "plain words"}),
        "rotli_update_note" => json!({"id": OPEN, "body": "plain words", "expectedRevision": rev()}),
        "rotli_patch_note" => json!({"id": OPEN, "oldText": "plain", "newText": "simple", "expectedRevision": rev()}),
        "rotli_move_note" => json!({"id": AGENT_NOTE, "folder": "wiki/Areas"}),
        "rotli_create_folder" => json!({"name": "Fresh", "parent": "wiki/Projects", "scope": "disk"}),
        "rotli_place_in_main" => json!({"id": OPEN}),
        "rotli_move_in_main" => json!({"id": OPEN, "parent": "main:"}),
        "rotli_remove_from_main" => json!({"id": OPEN}),
        "rotli_create_view" => json!({"name": "W"}),
        "rotli_rename_view" => json!({"name": "V", "nextName": "W"}),
        "rotli_delete_view" => json!({"name": "V"}),
        "rotli_assign_view" => json!({"id": OPEN, "view": "V"}),
        "rotli_unassign_view" => json!({"id": OPEN}),
        "rotli_create_view_folder" => json!({"view": "V", "name": "F"}),
        "rotli_read_board" => json!({"id": BOARD}),
        "rotli_create_board" => json!({"name": "Fresh board"}),
        "rotli_apply_board" => json!({"id": BOARD, "expectedRevision": "fnv1a64:0", "actions": [{"op": "remove", "id": "x"}]}),
        "rotli_rename" => json!({"id": AGENT_NOTE, "title": "Renamed"}),
        "rotli_trash_note" => json!({"id": AGENT_NOTE, "expectedRevision": revision(temp, AGENT_NOTE)}),
        "rotli_note_history" => json!({"id": OPEN}),
        "rotli_note_attachments" => json!({"id": OPEN, "includeText": true}),
        "rotli_undo_ai_edit" => json!({"id": OPEN, "expectedRevision": rev()}),
        // `open -a rotli` would launch the app: its payload is checked through
        // queue_open_request, which writes the request and launches nothing
        "rotli_open" => return Some(None),
        // these ask the running app over its socket: checked through the
        // bridge's own gate on this vault instead
        "rotli_read_document" | "rotli_apply_document" | "rotli_create_document" => return Some(None),
        _ => return None,
    }))
}

fn librarian_tool_args(name: &str) -> Option<Option<Value>> {
    Some(Some(match name {
        // static skill text, written in the repository, never vault data
        "librarian_guide" => return Some(None),
        "librarian_search" => json!({"query": "plain"}),
        "librarian_read" => json!({"id": OPEN}),
        "librarian_capture" => json!({"title": "Source", "body": "plain words"}),
        "librarian_file" => json!({"id": OPEN, "folder": "wiki/Areas", "reason": "tidy"}),
        "librarian_link" => json!({"id": OPEN, "target": "Agent", "reason": "related"}),
        "librarian_index" => json!({"entries": [{"id": OPEN, "summary": "plain"}]}),
        "librarian_log" => json!({"entry": "filed", "ids": [OPEN]}),
        "librarian_index_read" | "librarian_review" => json!({}),
        _ => return None,
    }))
}

fn call(server: &McpServer, name: &str, arguments: Value) -> String {
    let request = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}});
    handle_mcp_with(&request, server).map(|response| response.to_string()).unwrap_or_default()
}

fn listed(server: &McpServer) -> Vec<String> {
    let request = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}});
    let response = handle_mcp_with(&request, server).unwrap();
    response["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap().to_string()).collect()
}

fn pinned<T>(temp: &TempDir, body: impl FnOnce() -> T) -> T {
    CONNECTOR_ROOT.with(|value| *value.borrow_mut() = Some((temp.path().to_path_buf(), false)));
    let out = body();
    CONNECTOR_ROOT.with(|value| *value.borrow_mut() = None);
    out
}

#[test]
fn no_agent_tool_names_a_protected_path() {
    let mut found = Vec::new();
    let mut unknown = Vec::new();
    for name in listed(&WORKSPACE_SERVER) {
        let temp = seeded();
        let Some(args) = workspace_tool_args(&name, &temp) else {
            unknown.push(name);
            continue;
        };
        let answer = match args {
            Some(args) => pinned(&temp, || call(&WORKSPACE_SERVER, &name, args)),
            None if name == "rotli_open" => {
                let mut ws = test_workspace(&temp);
                format!("{:?}", ws.queue_open_request(OPEN, "note", &[]))
            }
            None => {
                let mut store = crate::corpus::CorpusStore::open(temp.path().to_path_buf()).unwrap();
                ["wiki/Projects/pub.csv", "wiki/Projects/plan.docx"]
                    .iter()
                    .map(|rel| format!("{:?}", crate::agent_bridge::document_gate_for_test(&mut store, rel)))
                    .collect()
            }
        };
        found.extend(setup_failure(&name, &answer));
        found.extend(leaks(&name, &answer));
    }
    for name in listed(&super::librarian::SERVER) {
        let Some(args) = librarian_tool_args(&name) else {
            unknown.push(name);
            continue;
        };
        let Some(args) = args else { continue };
        let temp = seeded();
        let target = RootTarget { id: DEFAULT_ROOT_ID.into(), label: "T".into(), path: temp.path().to_path_buf(), read_only: false, is_default: true };
        let answer = super::librarian::with_bound(target, || call(&super::librarian::SERVER, &name, args));
        found.extend(setup_failure(&name, &answer));
        found.extend(leaks(&name, &answer));
    }
    assert!(unknown.is_empty(), "tools the harness doesn't call yet: {unknown:?}");
    assert!(found.is_empty(), "protected names reached an agent:\n{}", found.join("\n\n"));
}

/// Every command `rotli help` names, by its first two words.
fn cli_commands() -> Vec<String> {
    let mut out = Vec::new();
    for line in crate::workspace_help::CLI_HELP.lines().filter_map(|line| line.strip_prefix("rotli ")) {
        let words: Vec<&str> = line.split_whitespace().collect();
        let Some(command) = words.first().filter(|word| !word.starts_with('-')) else { continue };
        match words.get(1).filter(|word| word.chars().next().is_some_and(|c| c.is_ascii_lowercase())) {
            Some(subs) => out.extend(subs.split('|').map(|sub| format!("{command} {sub}"))),
            None => out.push(command.to_string()),
        }
    }
    out.sort();
    out.dedup();
    out
}

fn cli_args(command: &str, temp: &TempDir) -> Option<Option<Vec<String>>> {
    let rev = || revision(temp, OPEN);
    let words: Vec<String> = match command {
        "roots" | "notes list" | "folders list" | "main list" | "views list" | "boards list" | "agent doctor" | "librarian status" | "librarian proposals" => {
            command.split(' ').map(String::from).collect()
        }
        "rename" => vec!["rename".into(), AGENT_NOTE.into(), "Renamed".into()],
        "notes search" => vec!["notes".into(), "search".into(), "plain".into()],
        "notes query" => vec!["notes".into(), "query".into(), "title:~\"e\"".into()],
        "notes read" => vec!["notes".into(), "read".into(), OPEN.into()],
        "notes create" => vec!["notes".into(), "create".into(), "--title".into(), "New".into(), "--body".into(), "plain".into()],
        "notes update" => vec!["notes".into(), "update".into(), OPEN.into(), "--revision".into(), rev(), "--body".into(), "plain".into()],
        "notes patch" => vec!["notes".into(), "patch".into(), OPEN.into(), "--revision".into(), rev(), "--old".into(), "plain".into(), "--new".into(), "simple".into()],
        "notes move" => vec!["notes".into(), "move".into(), AGENT_NOTE.into(), "--folder".into(), "wiki/Areas".into()],
        "notes attachments" => vec!["notes".into(), "attachments".into(), OPEN.into(), "--text".into()],
        "notes trash" => vec!["notes".into(), "trash".into(), AGENT_NOTE.into(), "--revision".into(), revision(temp, AGENT_NOTE)],
        "notes history" => vec!["notes".into(), "history".into(), OPEN.into()],
        "notes undo-ai-edit" => vec!["notes".into(), "undo-ai-edit".into(), OPEN.into(), "--revision".into(), rev()],
        "folders create" => vec!["folders".into(), "create".into(), "--disk".into(), "--name".into(), "Fresh".into(), "--parent".into(), "wiki/Projects".into()],
        "main add" => vec!["main".into(), "add".into(), OPEN.into()],
        "main move" => vec!["main".into(), "move".into(), OPEN.into(), "--parent".into(), "main:".into()],
        "main remove" => vec!["main".into(), "remove".into(), OPEN.into()],
        "main create-folder" => vec!["main".into(), "create-folder".into(), "--name".into(), "F".into()],
        "views create" => vec!["views".into(), "create".into(), "--name".into(), "W".into()],
        "views rename" => vec!["views".into(), "rename".into(), "V".into(), "--to".into(), "W".into()],
        "views delete" => vec!["views".into(), "delete".into(), "V".into()],
        "views assign" => vec!["views".into(), "assign".into(), OPEN.into(), "--view".into(), "V".into()],
        "views unassign" => vec!["views".into(), "unassign".into(), OPEN.into()],
        "views create-folder" => vec!["views".into(), "create-folder".into(), "--view".into(), "V".into(), "--name".into(), "F".into()],
        "boards read" => vec!["boards".into(), "read".into(), BOARD.into()],
        "boards create" => vec!["boards".into(), "create".into(), "--name".into(), "Fresh board".into()],
        "boards update" => vec!["boards".into(), "update".into(), BOARD.into(), "--revision".into(), "fnv1a64:0".into(), "--body".into(), "{\"type\":\"excalidraw\",\"elements\":[]}".into()],
        "boards apply" => vec!["boards".into(), "apply".into(), BOARD.into(), "--revision".into(), "fnv1a64:0".into(), "--actions".into(), "[{\"op\":\"remove\",\"id\":\"x\"}]".into()],
        "librarian on" | "librarian off" => command.split(' ').map(String::from).collect(),
        "librarian apply" | "librarian dismiss" => vec!["librarian".into(), command.split(' ').nth(1).unwrap().into(), "lp_missing".into()],
        // runs in its own disposable memex, never this vault
        "agent self-test" => vec!["agent".into(), "self-test".into()],
        // no vault data: the client setup text
        "agent config" | "mcp config" => return Some(None),
        // `rotli open` launches the app (see rotli_open above); `rotli mcp`
        // serves the tools checked above
        "open" | "mcp" => return Some(None),
        _ => return None,
    };
    Some(Some(words))
}

#[test]
fn no_cli_command_names_a_protected_path() {
    let commands = cli_commands();
    assert!(commands.len() > 30, "{commands:?}");
    let mut found = Vec::new();
    let mut unknown = Vec::new();
    for command in commands {
        let temp = seeded();
        match cli_args(&command, &temp) {
            None => unknown.push(command),
            Some(None) => {}
            Some(Some(args)) => {
                let answer = pinned(&temp, || match run_cli(&args) {
                    Ok(value) => value.to_string(),
                    Err(error) => error,
                });
                found.extend(setup_failure(&command, &answer));
                found.extend(leaks(&command, &answer));
            }
        }
    }
    assert!(unknown.is_empty(), "commands the harness doesn't run yet: {unknown:?}");
    assert!(found.is_empty(), "protected names reached an agent:\n{}", found.join("\n\n"));
}

/// What only a protected note, board, or file holds: if it comes back, the
/// gate opened.
const PROTECTED_CONTENT: [&str; 2] = ["classified", "Hidden note"];

/// Protected items asked for by an agent in other spellings, and through a
/// symlink (the request side; the answers above use only public arguments).
const PROTECTED_REQUESTS: [&str; 9] = [
    "wiki/_\u{17f}ecure/Bank plan.md",
    "wiki/_SECURE/Bank plan.md",
    "wiki/Link/Bank plan.md",
    "wiki/_\u{17f}ecure/b.excalidraw",
    "wiki/_Secure/b.excalidraw",
    "wiki/Link/b.excalidraw",
    "wiki/_\u{17f}ecure/f.csv",
    "wiki/Link/f.csv",
    "01SURFBANK00000000000000000",
];

#[cfg(target_os = "macos")]
#[test]
fn no_agent_tool_opens_a_protected_item_asked_for_by_another_spelling() {
    let mut found = Vec::new();
    for name in listed(&WORKSPACE_SERVER) {
        let probe = seeded();
        let Some(Some(base)) = workspace_tool_args(&name, &probe) else { continue };
        if base.get("id").is_none() {
            continue;
        }
        for request in PROTECTED_REQUESTS {
            let temp = seeded();
            let mut args = workspace_tool_args(&name, &temp).unwrap().unwrap();
            args["id"] = json!(request);
            let answer = pinned(&temp, || call(&WORKSPACE_SERVER, &name, args));
            for content in PROTECTED_CONTENT {
                if answer.contains(content) {
                    found.push(format!("{name}({request}): {content} in {}", answer.chars().take(300).collect::<String>()));
                }
            }
        }
    }
    let attachments = {
        let temp = seeded();
        let links: String = PROTECTED_REQUESTS.iter().map(|rel| format!("[x]({rel}) ")).collect();
        put(temp.path(), "wiki/Projects/links.md", &format!("---\nid: 01SURFLINKS0000000000000000\n---\n# Links\n\n{links}\n"));
        pinned(&temp, || call(&WORKSPACE_SERVER, "rotli_note_attachments", json!({"id": "01SURFLINKS0000000000000000", "includeText": true})))
    };
    for content in PROTECTED_CONTENT {
        if attachments.contains(content) || attachments.contains(r#""available":true"#) {
            found.push(format!("rotli_note_attachments: {content} or an available protected link in {attachments}"));
        }
    }
    assert!(found.is_empty(), "a protected item opened:\n{}", found.join("\n\n"));
}
