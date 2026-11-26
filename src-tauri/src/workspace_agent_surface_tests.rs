//! The guard for "an agent never learns a protected path" (Opus re-checks of
//! pull request 304: source scans caught none of seven mutations). A
//! behaviour harness: one vault seeded with a decoy in every place a protected
//! name can hide, in every spelling a reviewer found (canonical, keyword
//! folder, `ſ`, case, quoted, `[[…]]`, `root:`-prefixed, nested in Main), then
//! every tool the workspace MCP server and the Librarian route list, and every
//! command `rotli help` names, called for real. Each call states what it must
//! show (a public item, so a call that never reached the vault fails) or the
//! refusal it must give; no protected name may appear in any answer or error.
//! A tool or command the harness doesn't know fails it.

use super::path_protection_tests::put;
use super::tests::test_workspace;
use super::*;
use tempfile::TempDir;

/// Names that exist only in protected places of the seeded vault.
pub(super) const PROTECTED: [&str; 13] = [
    "_secure",
    "ſecure",
    "Juniper",
    "jUNIPER",
    "PrivateProject",
    "DirectExample",
    "Bank plan",
    "Diary",
    "STRASSE",
    "Hidden note",
    "OldHome",
    "01SURFBANK",
    "4242",
];

pub(super) const OPEN: &str = "01SURFOPEN00000000000000000";
pub(super) const AGENT_NOTE: &str = "01SURFAGENT0000000000000000";
pub(super) const AGENT_FREE: &str = "01SURFFREE00000000000000000";
pub(super) const BOARD: &str = "wiki/Projects/b.excalidraw";
pub(super) const PUBLIC_DOCX: &str = "wiki/Projects/plan.docx";
pub(super) const TOP: &str = "01SURFTOP000000000000000000";
pub(super) const HIDDEN_FM: &str = "01SURFFMSECURE0000000000000";
/// Items `seeded` hides where they are (an ordinary folder), not by path.
pub(super) const HIDDEN_IN_PLACE: [&str; 8] = [
    "wiki/Projects/fm.md",
    "wiki/Projects/detected.md",
    "wiki/Projects/trip.md",
    "wiki/Projects/cards.csv",
    "wiki/Projects/secret.excalidraw",
    "wiki/Projects/broken.docx",
    "wiki/Projects/carddoc.docx",
    "wiki/Projects/hard.md",
];

pub(super) fn docx() -> Vec<u8> {
    crate::ai_files::tests::zip_with(&[("word/document.xml", crate::ai_files::tests::XML.as_bytes())], true)
}

pub(super) fn put_bytes(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
}

/// A vault with public notes, a board, a file and a document beside every
/// kind of decoy.
pub(super) fn seeded() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_agent_surface\",\"contract\":\"3.4\",\"apps\":{}}\n").unwrap();
    put(root, ".rotli/settings.json", "{\"librarianRules\":{\"secureKeywords\":[\"Juniper\",\"Straße\"]}}\n");
    let note = |id: &str, extra: &str, title: &str, body: &str| format!("---\nid: {id}\n{extra}---\n# {title}\n\n{body}\n");
    // public: a note, two agent-made notes, a board, a file, a document
    // the second link reads from the vault root through a symlink into the
    // secure home, and from the note's folder as a public file
    put(root, "wiki/Projects/open.md", &note(OPEN, "", "Open", "plain words [f](wiki/Projects/pub.csv) [g](wiki/Link/f.csv) [c](wiki/Projects/cards.csv)"));
    put(root, "wiki/Projects/wiki/Link/f.csv", "a,b\n3,4\n");
    // one public match for a word five secure notes repeat in their titles
    // and bodies (they rank first)
    put(root, "wiki/Projects/ledger.md", &note("01SURFLEDGER000000000000000", "", "Accounts", "the ledger sits among many other plain words here"));
    // items hidden where they are, in an ordinary folder: by frontmatter, by
    // what they hold (the secret detector), by a keyword in the title; a
    // file, a board, and two documents (one unreadable) that listing hides
    put(root, "wiki/Projects/fm.md", &note(HIDDEN_FM, &format!("secure: {}\n", true), "Hidden note eight", "words"));
    put(root, "wiki/Projects/detected.md", &note("01SURFDETECTED0000000000000", "", "Hidden note nine", "card 4242 4242 4242 4242"));
    put(root, "wiki/Projects/trip.md", &note("01SURFTRIP00000000000000000", "", "Juniper trip", "words"));
    put(root, "wiki/Projects/cards.csv", "card,4242 4242 4242 4242\n");
    put(root, "wiki/Projects/secret.excalidraw", "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[{\"id\":\"t\",\"type\":\"text\",\"text\":\"card 4242 4242 4242 4242\",\"x\":0,\"y\":0,\"width\":10,\"height\":10}]}");
    put_bytes(root, "wiki/Projects/broken.docx", b"PK not a package");
    let card = crate::ai_files::tests::XML.replace("Launch &amp; land", "card 4242 4242 4242 4242");
    put_bytes(root, "wiki/Projects/carddoc.docx", &crate::ai_files::tests::zip_with(&[("word/document.xml", card.as_bytes())], true));
    // a note in `wiki` whose links read, from its folder, into the secure
    // home (and through the symlink); from the vault root they name nothing.
    // Past the snippet's length, so no listing shows them
    let filler = "words to fill the start of this note well past the length a listing snippet shows. ".repeat(3);
    put(root, "wiki/top.md", &note(TOP, "", "Top", &format!("{filler}\n\n[h](Link/f.csv) [i](_secure/f.csv) [j](_SECURE/f.csv)")));
    for n in 1..=5 {
        put(root, &format!("wiki/_secure/PrivateProject/l{n}.md"), &note(&format!("01SURFLEDGERS{n}0000000000000"), "", &format!("Hidden note ledger L{n}"), "ledger ledger ledger"));
    }
    put(root, "wiki/Projects/a.md", &note(AGENT_NOTE, "created_by: agent\n", "Agent", "plain words"));
    put(root, "wiki/Projects/free.md", &note(AGENT_FREE, "created_by: agent\n", "Free", "plain words"));
    put(root, BOARD, "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}");
    put(root, "wiki/Projects/pub.csv", "a,b\n1,2\n");
    put_bytes(root, PUBLIC_DOCX, &docx());
    // the secure home, in its canonical spelling
    put(root, "wiki/_secure/PrivateProject/s.md", &note("01SURFSECRET000000000000000", "", "Hidden note", "plain words classified"));
    put(root, "wiki/_secure/Bank plan.md", &note("01SURFBANK00000000000000000", "", "Hidden note two", "plain words classified"));
    put(root, "wiki/_secure/b.excalidraw", "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[{\"id\":\"t\",\"type\":\"text\",\"text\":\"classified\",\"x\":0,\"y\":0,\"width\":10,\"height\":10}]}");
    put(root, "wiki/_secure/f.csv", "a,b\nclassified,2\n");
    put_bytes(root, "wiki/_secure/p.docx", &docx());
    std::os::unix::fs::symlink(root.join("wiki/_secure"), root.join("wiki/Link")).unwrap();
    // the agent's free.md has a namesake in the secure home, and a secure
    // note has a hard link in a public folder
    put(root, "wiki/_secure/free.md", &note("01SURFFREESECURE00000000000", "", "Hidden note seven", "plain words classified"));
    fs::hard_link(root.join("wiki/_secure/Bank plan.md"), root.join("wiki/Projects/hard.md")).unwrap();
    // a locked secure note linking the agent's note by path (S2)
    put(root, "wiki/_secure/Diary of Juniper.md", &note("01SURFDIARY0000000000000000", "locked: true\n", "Diary", "see [a](../Projects/a.md)"));
    // keyword folders, in other spellings and as an ancestor
    put(root, "wiki/Projects/jUNIPER/Ordinary/n.md", &note("01SURFKEYWORD00000000000000", "", "Hidden note three", "plain words"));
    put(root, "wiki/Projects/jUNIPER/Ordinary/f.csv", "a,b\n1,2\n");
    put_bytes(root, "wiki/Projects/jUNIPER/p.docx", &docx());
    put(root, "wiki/STRASSE/n.md", &note("01SURFSTRASSE00000000000000", "", "Hidden note four", "plain words"));
    // public notes whose id, shelf, origin, or other value names a protected
    // place: bare, quoted, in a list, in a wikilink, behind a root prefix
    put(root, "wiki/Projects/decoy.md", &note("wiki/_secure/PrivateProject", "", "Decoy", "plain words"));
    put(root, "wiki/Projects/qdecoy.md", &note("\"wiki/_secure/PrivateProject/q\"", "", "Quoted decoy", "plain words"));
    put(root, "wiki/Projects/pdecoy.md", &note("default:wiki/_secure/PrivateProject/p", "", "Prefixed decoy", "plain words"));
    put(root, "wiki/Projects/bdecoy.md", &note("wiki\\_secure\\PrivateProject", "", "Backslash decoy", "plain words"));
    // any `word:` prefix, once or more (final review threads on #304, hold 1)
    put(root, "wiki/Projects/edecoy.md", &note("evil:wiki/_secure/PrivateProject/e", "", "Evil decoy", "plain words"));
    put(root, "wiki/Projects/xydecoy.md", &note("x:y:wiki/_secure/PrivateProject/xy", "", "Double decoy", "plain words"));
    put(root, "wiki/Projects/eshelved.md", &note("01SURFSHELFE00000000000000", "shelf: [evil:wiki/_secure/DirectExample]\n", "Evil shelf", "plain words"));
    put(root, "archive/gone4.md", &note("01SURFGONE40000000000000000", "origin: x:y:wiki/_secure/OldHome\n", "Gone four", "plain words"));
    // trashed and archived copies of the secure home (hold 2): a note, a
    // board, and a locked linker of the agent's note
    put(root, "trash/wiki/_secure/trashed plan.md", &note("01SURFTRASHED00000000000000", "", "Hidden note five", "plain words classified"));
    put(root, "trash/wiki/_secure/b.excalidraw", "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}");
    put(root, "archive/wiki/_secure/archived plan.md", &note("01SURFARCHIVED0000000000000", "", "Hidden note six", "plain words classified"));
    put(root, "trash/wiki/_secure/Diary.md", &note("01SURFTDIARY000000000000000", "locked: true\n", "Diary two", "see [a](../../../wiki/Projects/a.md)"));
    put(root, "wiki/Projects/shelved.md", &note("01SURFSHELF000000000000000", "shelf: [wiki/_secure/DirectExample]\n", "Shelved", "plain words"));
    put(root, "wiki/Projects/qshelved.md", &note("01SURFSHELFQ00000000000000", "shelf: \"wiki/_secure/DirectExample\"\n", "Quoted shelf", "plain words"));
    put(root, "wiki/Projects/lshelved.md", &note("01SURFSHELFL00000000000000", "shelf: [\"wiki/_secure/DirectExample\"]\n", "Listed shelf", "plain words"));
    put(root, "wiki/Projects/pshelved.md", &note("01SURFSHELFP00000000000000", "shelf: [default:wiki/_secure/DirectExample]\n", "Prefixed shelf", "plain words"));
    put(root, "wiki/Projects/kshelved.md", &note("01SURFSHELFK00000000000000", "shelf: [wiki/Projects/jUNIPER/Ordinary]\n", "Keyword shelf", "plain words"));
    put(root, "wiki/Projects/related.md", &note("01SURFRELATED0000000000000", "related: \"[[wiki/_secure/Bank plan]]\"\nsource: https://example.com/a/b\n", "Related", "plain words"));
    put(root, "archive/gone.md", &note("01SURFGONE00000000000000000", "origin: wiki/Projects/Juniper\n", "Gone", "plain words"));
    put(root, "archive/gone2.md", &note("01SURFGONE20000000000000000", "origin: \"wiki/_secure/OldHome\"\n", "Gone two", "plain words"));
    put(root, "archive/gone3.md", &note("01SURFGONE30000000000000000", "origin: default:wiki/_secure/OldHome\n", "Gone three", "plain words"));
    // Main and a named view holding the path-shaped ids, top level and nested
    let refs = format!(
        "{{\"note\":\"wiki/_secure/PrivateProject\"}},{{\"note\":\"\\\"wiki/_secure/PrivateProject/q\\\"\"}},{{\"note\":\"default:wiki/_secure/PrivateProject/p\"}},{{\"note\":\"{OPEN}\"}}"
    );
    let nested = |outer: &str, inner: &str| format!("{{\"folder\":\"{outer}\",\"children\":[{{\"folder\":\"{inner}\",\"children\":[{refs}]}}]}}");
    put(root, ".rotli/main.json", &format!("{{\"version\":1,\"tree\":[{},{refs}]}}\n", nested("main:Outer", "main:Inner")));
    // a named view holds each item once: the nested copy only
    put(root, ".rotli/views.json", &format!("{{\"version\":1,\"views\":[{{\"name\":\"V\",\"tree\":[{}]}}]}}\n", nested("Outer", "Inner")));
    // the AI journal: rows from when the open note lived in protected places (B2)
    let rows: Vec<String> = ["wiki/_secure/Bank plan.md", "wiki/Projects/jUNIPER/Bank plan.md", "default:wiki/_secure/Bank plan.md"]
        .iter()
        .map(|path| {
            let mut row = crate::corpus::ai_journal::AiEditRow::new("edit", OPEN, path, &crate::corpus::ai_journal::AiEditor::agent(None), "fnv1a64:0");
            row.extra.insert("from".into(), json!("wiki/Projects/Juniper/x.md"));
            serde_json::to_string(&row).unwrap()
        })
        .collect();
    // and a row of the secure note that once lived at the open note's path:
    // another note's edit, never the open note's history
    let mut other = crate::corpus::ai_journal::AiEditRow::new("edit", "01SURFBANK00000000000000000", "wiki/Projects/open.md", &crate::corpus::ai_journal::AiEditor::agent(None), "fnv1a64:0");
    other.patch = Some(crate::corpus::ai_journal::Hunk { line: 1, before: "Hidden note draft".into(), after: "Hidden note final".into() });
    let rows = [rows, vec![serde_json::to_string(&other).unwrap()]].concat();
    put(root, ".rotli/ai-edit-journal.jsonl", &format!("{}\n", rows.join("\n")));
    temp
}

/// What a call must give: an answer that shows this text (so it reached the
/// vault and did its work), or a refusal carrying this text.
#[derive(Clone, Copy)]
pub(super) enum Expect {
    Shows(&'static str),
    Refuses(&'static str),
}

pub(super) fn met(answer: &str, ok: bool, expect: Expect) -> bool {
    match expect {
        Expect::Shows(text) => ok && answer.contains(text),
        Expect::Refuses(text) => !ok && answer.contains(text),
    }
}

/// Each protected name in `answer`, with the text around it. A number name
/// leaks only when the whole run of digits around it is that number repeated
/// (`4242`, or the card with its spaces stripped); inside any other number,
/// a timestamp say, it is chance.
pub(super) fn leaks(from: &str, answer: &str) -> Vec<String> {
    let bytes = answer.as_bytes();
    let leaked = |name: &str, at: usize| {
        if !name.bytes().all(|b| b.is_ascii_digit()) {
            return true;
        }
        let start = bytes[..at].iter().rposition(|b| !b.is_ascii_digit()).map_or(0, |i| i + 1);
        let end = bytes[at..].iter().position(|b| !b.is_ascii_digit()).map_or(bytes.len(), |i| at + i);
        let run = &answer[start..end];
        run.len().is_multiple_of(name.len()) && run == name.repeat(run.len() / name.len())
    };
    PROTECTED
        .iter()
        .filter_map(|name| {
            let (at, _) = answer.match_indices(name).find(|(at, _)| leaked(name, *at))?;
            let start = answer.floor_char_boundary(at.saturating_sub(80));
            let end = answer.ceil_char_boundary((at + name.len() + 80).min(answer.len()));
            Some(format!("{from}: {name} in …{}…", &answer[start..end]))
        })
        .collect()
}

#[test]
fn a_protected_number_inside_a_longer_number_is_not_a_leak() {
    // a millisecond timestamp such as 1795620684242 holds "4242" by chance
    assert!(leaks("t", "\"createdAt\": 1795620684242").is_empty());
    assert!(leaks("t", "id 42420").is_empty());
    // the card with its spaces stripped is still the card, and a timestamp
    // earlier in an answer never hides a real leak after it
    for shown in ["card 4242 4242", "card 4242", "x4242", "\"4242\"", "4242424242424242", "\"createdAt\": 1795620684242, card 4242"] {
        assert_eq!(leaks("t", shown).len(), 1, "{shown}");
    }
}

pub(super) fn check(from: &str, answer: &str, ok: bool, expect: Expect, found: &mut Vec<String>) {
    if !met(answer, ok, expect) {
        let wanted = match expect {
            Expect::Shows(text) => format!("an answer showing {text:?}"),
            Expect::Refuses(text) => format!("a refusal with {text:?}"),
        };
        found.push(format!("{from}: expected {wanted}, got {}", answer.chars().take(300).collect::<String>()));
    }
    found.extend(leaks(from, answer));
}

pub(super) fn revision(temp: &TempDir, id: &str) -> String {
    let mut ws = test_workspace(temp);
    ws.read_note(id).map(|read| read.revision).unwrap_or_default()
}

pub(super) fn board_revision(temp: &TempDir) -> String {
    let mut ws = test_workspace(temp);
    ws.read_board_for_remote(BOARD).map(|board| board.revision).unwrap_or_default()
}

/// An AI edit of the agent's note, journaled with its text, so undo has one.
pub(super) fn edited(temp: &TempDir) -> String {
    let args = json!({"id": AGENT_NOTE, "oldText": "plain", "newText": "simple", "expectedRevision": revision(temp, AGENT_NOTE)});
    pinned(temp, || call(&WORKSPACE_SERVER, "rotli_patch_note", args));
    revision(temp, AGENT_NOTE)
}

/// The calls for each workspace MCP tool. None: the tool isn't known yet.
/// An empty list: not called for real, with the reason; its payload is
/// checked another way below.
pub(super) fn workspace_cases(name: &str, temp: &TempDir) -> Option<Vec<(Value, Expect)>> {
    use Expect::*;
    let one = |args: Value, expect: Expect| Some(vec![(args, expect)]);
    match name {
        "rotli_status" => one(json!({}), Shows("roots")),
        "rotli_metrics" => one(json!({}), Shows("visibleNotes")),
        "rotli_list" => one(json!({"limit": 500}), Shows(OPEN)),
        "rotli_search" => one(json!({"query": "plain"}), Shows(OPEN)),
        "rotli_query" => one(json!({"query": "title:~\"e\""}), Shows("https://example.com/a/b")),
        "rotli_read_note" => one(json!({"id": OPEN}), Shows(OPEN)),
        "rotli_create_note" => one(json!({"title": "New", "body": "plain words"}), Shows("New")),
        "rotli_update_note" => one(json!({"id": AGENT_NOTE, "body": "plain words, again", "expectedRevision": revision(temp, AGENT_NOTE)}), Shows("again")),
        "rotli_patch_note" => one(json!({"id": AGENT_NOTE, "oldText": "plain", "newText": "simple", "expectedRevision": revision(temp, AGENT_NOTE)}), Shows("simple")),
        "rotli_move_note" => Some(vec![
            (json!({"id": AGENT_FREE, "folder": "wiki/Areas"}), Shows("wiki/Areas")),
            (json!({"id": AGENT_NOTE, "folder": "wiki/Areas"}), Refuses("a locked note links to it")),
        ]),
        "rotli_create_folder" => one(json!({"name": "Fresh", "parent": "wiki/Projects", "scope": "disk"}), Shows("Fresh")),
        "rotli_place_in_main" => one(json!({"id": AGENT_NOTE}), Shows(AGENT_NOTE)),
        "rotli_move_in_main" => one(json!({"id": OPEN, "parent": "main:"}), Shows(OPEN)),
        "rotli_remove_from_main" => one(json!({"id": OPEN}), Shows("tree")),
        "rotli_list_main" => one(json!({}), Shows(OPEN)),
        "rotli_list_views" => one(json!({}), Shows(OPEN)),
        "rotli_create_view" => one(json!({"name": "W"}), Shows("\\\"W\\\"")),
        "rotli_rename_view" => one(json!({"name": "V", "nextName": "W"}), Shows("\\\"W\\\"")),
        "rotli_delete_view" => one(json!({"name": "V"}), Shows("views")),
        "rotli_assign_view" => one(json!({"id": AGENT_NOTE, "view": "V"}), Shows(AGENT_NOTE)),
        "rotli_unassign_view" => one(json!({"id": OPEN}), Shows("views")),
        "rotli_create_view_folder" => one(json!({"view": "V", "name": "F"}), Shows("main:F")),
        "rotli_read_board" => one(json!({"id": BOARD}), Shows(BOARD)),
        "rotli_create_board" => one(json!({"name": "Fresh board"}), Shows("Fresh board")),
        "rotli_apply_board" => one(
            json!({"id": BOARD, "expectedRevision": board_revision(temp), "actions": [{"op": "add", "id": "n1", "kind": "text", "x": 0, "y": 0, "width": 40, "height": 20, "text": "hello"}]}),
            Shows("hello"),
        ),
        "rotli_rename" => one(json!({"id": AGENT_NOTE, "title": "Renamed"}), Shows("Renamed")),
        "rotli_trash_note" => one(json!({"id": AGENT_FREE, "expectedRevision": revision(temp, AGENT_FREE)}), Shows("free.md")),
        "rotli_note_history" => one(json!({"id": OPEN}), Shows("wiki/Projects/open.md")),
        "rotli_note_attachments" => one(json!({"id": OPEN, "includeText": true}), Shows("pub.csv")),
        "rotli_undo_ai_edit" => one(json!({"id": AGENT_NOTE, "expectedRevision": edited(temp)}), Shows("plain")),
        // `open -a rotli` would launch the app: its payload is checked through
        // queue_open_request, which writes the request and launches nothing
        "rotli_open" => Some(Vec::new()),
        // these ask the running app over its socket: checked through the
        // bridge's own gate on this vault instead
        "rotli_read_document" | "rotli_apply_document" | "rotli_create_document" => Some(Vec::new()),
        _ => None,
    }
}

/// The Librarian route's tools, in order, in one bound vault: the writes
/// first, so index_read and review have something to show.
pub(super) fn librarian_cases() -> Vec<(&'static str, Value, Expect)> {
    use Expect::*;
    vec![
        ("librarian_search", json!({"query": "plain"}), Shows(OPEN)),
        ("librarian_read", json!({"id": OPEN}), Shows(OPEN)),
        ("librarian_capture", json!({"title": "Source", "body": "plain words"}), Shows("Source")),
        ("librarian_file", json!({"id": OPEN, "folder": "wiki/Areas", "reason": "tidy"}), Shows("wiki/Areas")),
        ("librarian_link", json!({"id": OPEN, "target": "Agent", "reason": "related"}), Shows(OPEN)),
        ("librarian_index", json!({"entries": [{"id": OPEN, "summary": "Quarterly review"}]}), Shows("written")),
        ("librarian_log", json!({"entry": "filed the quarter", "ids": [OPEN]}), Shows("logged")),
        ("librarian_index_read", json!({}), Shows("Quarterly review")),
        ("librarian_review", json!({}), Shows("wiki/Areas")),
    ]
}

pub(super) fn call(server: &McpServer, name: &str, arguments: Value) -> String {
    let request = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}});
    handle_mcp_with(&request, server).map(|response| response.to_string()).unwrap_or_default()
}

pub(super) fn succeeded(answer: &str) -> bool {
    answer.contains("\"isError\":false")
}

pub(super) fn listed(server: &McpServer) -> Vec<String> {
    let request = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}});
    let response = handle_mcp_with(&request, server).unwrap();
    response["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap().to_string()).collect()
}

pub(super) fn pinned<T>(temp: &TempDir, body: impl FnOnce() -> T) -> T {
    CONNECTOR_ROOT.with(|value| *value.borrow_mut() = Some((temp.path().to_path_buf(), false)));
    let out = body();
    CONNECTOR_ROOT.with(|value| *value.borrow_mut() = None);
    out
}

pub(super) fn bound_target(temp: &TempDir) -> RootTarget {
    RootTarget { id: DEFAULT_ROOT_ID.into(), label: "T".into(), path: temp.path().to_path_buf(), read_only: false, is_default: true }
}

/// The document tools' gate (the app's side of the bridge) on this vault:
/// a public document passes; a protected one, in any spelling, is refused
/// without being named.
fn document_gate(found: &mut Vec<String>) {
    let temp = seeded();
    let mut store = crate::corpus::CorpusStore::open(temp.path().to_path_buf()).unwrap();
    let public = crate::agent_bridge::document_gate_for_test(&mut store, PUBLIC_DOCX);
    if public.is_err() {
        found.push(format!("document gate: the public document was refused: {public:?}"));
    }
    for rel in ["wiki/_secure/p.docx", "wiki/_\u{17f}ecure/p.docx", "wiki/Link/p.docx", "wiki/Projects/jUNIPER/p.docx"] {
        match crate::agent_bridge::document_gate_for_test(&mut store, rel) {
            Ok(()) => found.push(format!("document gate: {rel} was allowed")),
            Err(error) => {
                // the refusal may echo the agent's own argument, never more
                found.extend(leaks("document gate", &error.replace(rel, "")));
            }
        }
    }
}

#[test]
fn no_agent_tool_names_a_protected_path() {
    let mut found = Vec::new();
    let mut unknown = Vec::new();
    for name in listed(&WORKSPACE_SERVER) {
        let Some(cases) = workspace_cases(&name, &seeded()) else {
            unknown.push(name);
            continue;
        };
        if cases.is_empty() {
            if name == "rotli_open" {
                let temp = seeded();
                let mut ws = test_workspace(&temp);
                let queued = ws.queue_open_request(OPEN, "note", &[]);
                check(&name, &format!("{queued:?}"), queued.is_ok(), Expect::Shows(OPEN), &mut found);
            }
            continue;
        }
        for case in 0..cases.len() {
            let temp = seeded();
            let (args, expect) = workspace_cases(&name, &temp).unwrap().swap_remove(case);
            let answer = pinned(&temp, || call(&WORKSPACE_SERVER, &name, args));
            check(&name, &answer, succeeded(&answer), expect, &mut found);
        }
    }
    document_gate(&mut found);
    let known: Vec<&str> = librarian_cases().iter().map(|(name, _, _)| *name).collect();
    for name in listed(&super::librarian::SERVER) {
        // static skill text, written in the repository, never vault data
        if name != "librarian_guide" && !known.contains(&name.as_str()) {
            unknown.push(name);
        }
    }
    let temp = seeded();
    super::librarian::with_bound(bound_target(&temp), || {
        for (name, args, expect) in librarian_cases() {
            let answer = call(&super::librarian::SERVER, name, args);
            check(name, &answer, succeeded(&answer), expect, &mut found);
        }
    });
    assert!(unknown.is_empty(), "tools the harness doesn't call yet: {unknown:?}");
    assert!(found.is_empty(), "agent tools went wrong:\n{}", found.join("\n\n"));
}

/// Every command `rotli help` names, by its first two words.
pub(super) fn cli_commands() -> Vec<String> {
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

/// One argv, owned.
pub(super) fn words(argv: &[&str]) -> Vec<String> {
    argv.iter().copied().map(String::from).collect()
}

/// The argv for each command and what it must give. Some(None): not run,
/// with the reason.
pub(super) fn cli_case(command: &str, temp: &TempDir) -> Option<Option<(Vec<String>, Expect)>> {
    use Expect::*;
    let agent_rev = || revision(temp, AGENT_NOTE);
    let plain = |text: &str| text.split(' ').map(String::from).collect::<Vec<_>>();
    let case = match command {
        "roots" => (plain("roots"), Shows("roots")),
        "notes list" => (plain("notes list"), Shows(OPEN)),
        "folders list" => (plain("folders list"), Shows("wiki/Projects")),
        "main list" => (plain("main list"), Shows(OPEN)),
        "views list" => (plain("views list"), Shows(OPEN)),
        "boards list" => (plain("boards list"), Shows(BOARD)),
        "agent doctor" => (plain("agent doctor"), Shows("metrics")),
        "rename" => (words(&["rename", AGENT_NOTE, "Renamed"]), Shows("Renamed")),
        "notes search" => (words(&["notes", "search", "plain"]), Shows(OPEN)),
        "notes query" => (words(&["notes", "query", "title:~\"e\""]), Shows("https://example.com/a/b")),
        "notes read" => (words(&["notes", "read", OPEN]), Shows(OPEN)),
        "notes create" => (words(&["notes", "create", "--title", "New", "--body", "plain"]), Shows("New")),
        "notes update" => (words(&["notes", "update", AGENT_NOTE, "--revision", &agent_rev(), "--body", "plain words, again"]), Shows("again")),
        "notes patch" => (words(&["notes", "patch", AGENT_NOTE, "--revision", &agent_rev(), "--old", "plain", "--new", "simple"]), Shows("simple")),
        "notes move" => (words(&["notes", "move", AGENT_FREE, "--folder", "wiki/Areas"]), Shows("wiki/Areas")),
        "notes attachments" => (words(&["notes", "attachments", OPEN, "--text"]), Shows("pub.csv")),
        "notes trash" => (words(&["notes", "trash", AGENT_FREE, "--revision", &revision(temp, AGENT_FREE)]), Shows("free.md")),
        "notes history" => (words(&["notes", "history", OPEN]), Shows("wiki/Projects/open.md")),
        "notes undo-ai-edit" => (words(&["notes", "undo-ai-edit", AGENT_NOTE, "--revision", &edited(temp)]), Shows("plain")),
        "folders create" => (words(&["folders", "create", "--disk", "--name", "Fresh", "--parent", "wiki/Projects"]), Shows("Fresh")),
        "main add" => (words(&["main", "add", AGENT_NOTE]), Shows(AGENT_NOTE)),
        "main move" => (words(&["main", "move", OPEN, "--parent", "main:"]), Shows(OPEN)),
        "main remove" => (words(&["main", "remove", OPEN]), Shows("tree")),
        "main create-folder" => (words(&["main", "create-folder", "--name", "F"]), Shows("main:")),
        "views create" => (words(&["views", "create", "--name", "W"]), Shows("\"W\"")),
        "views rename" => (words(&["views", "rename", "V", "--to", "W"]), Shows("\"W\"")),
        "views delete" => (words(&["views", "delete", "V"]), Shows("views")),
        "views assign" => (words(&["views", "assign", AGENT_NOTE, "--view", "V"]), Shows(AGENT_NOTE)),
        "views unassign" => (words(&["views", "unassign", OPEN]), Shows("views")),
        "views create-folder" => (words(&["views", "create-folder", "--view", "V", "--name", "F"]), Shows("main:F")),
        "boards read" => (words(&["boards", "read", BOARD]), Shows(BOARD)),
        "boards create" => (words(&["boards", "create", "--name", "Fresh board"]), Shows("Fresh board")),
        "boards update" => (
            words(&["boards", "update", BOARD, "--revision", &board_revision(temp), "--body", "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}"]),
            Shows(BOARD),
        ),
        "boards apply" => (
            words(&["boards", "apply", BOARD, "--revision", &board_revision(temp), "--actions", "[{\"op\":\"add\",\"id\":\"n1\",\"kind\":\"text\",\"x\":0,\"y\":0,\"width\":40,\"height\":20,\"text\":\"hello\"}]"]),
            Shows("hello"),
        ),
        "librarian status" => (plain("librarian status"), Shows("\"onForThisFolder\":true")),
        "librarian proposals" => (plain("librarian proposals"), Shows("[")),
        "librarian on" => (plain("librarian on"), Shows("\"onForThisFolder\":true")),
        "librarian off" => (plain("librarian off"), Shows("\"onForThisFolder\":false")),
        "librarian apply" | "librarian dismiss" => (words(&["librarian", command.split(' ').nth(1).unwrap(), "lp_missing"]), Refuses("no pending proposal")),
        // runs in its own disposable memex, never this vault
        "agent self-test" => (plain("agent self-test"), Shows("checks")),
        // no vault data: the client setup text
        "agent config" | "mcp config" => return Some(None),
        // `rotli open` launches the app (see rotli_open above); `rotli mcp`
        // serves the tools checked above
        "open" | "mcp" => return Some(None),
        _ => return None,
    };
    Some(Some(case))
}

#[test]
fn no_cli_command_names_a_protected_path() {
    let commands = cli_commands();
    assert!(commands.len() > 30, "{commands:?}");
    let mut found = Vec::new();
    let mut unknown = Vec::new();
    for command in commands {
        let temp = seeded();
        super::librarian::switch_on_for_test(temp.path());
        match cli_case(&command, &temp) {
            None => unknown.push(command),
            Some(None) => {}
            Some(Some((args, expect))) => {
                let (answer, ok) = pinned(&temp, || match run_cli(&args) {
                    Ok(value) => (value.to_string(), true),
                    Err(error) => (error, false),
                });
                check(&command, &answer, ok, expect, &mut found);
            }
        }
    }
    assert!(unknown.is_empty(), "commands the harness doesn't run yet: {unknown:?}");
    assert!(found.is_empty(), "commands went wrong:\n{}", found.join("\n\n"));
}

/// What only a protected note, board, or file holds: if it comes back, the
/// gate opened.
const PROTECTED_CONTENT: [&str; 2] = ["classified", "Hidden note"];

/// Protected items asked for by an agent in other spellings, and through a
/// symlink (the request side; the answers above use only public arguments).
const PROTECTED_REQUESTS: [&str; 10] = [
    "wiki/_\u{17f}ecure/Bank plan.md",
    "wiki/_SECURE/Bank plan.md",
    "wiki/Link/Bank plan.md",
    "\"wiki/_secure/Bank plan.md\"",
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
    let mut opened = |from: &str, request: &str, answer: &str| {
        for content in PROTECTED_CONTENT {
            if answer.contains(content) {
                found.push(format!("{from}({request}): {content} in {}", answer.chars().take(300).collect::<String>()));
            }
        }
    };
    for name in listed(&WORKSPACE_SERVER) {
        let Some(cases) = workspace_cases(&name, &seeded()) else { continue };
        if !cases.first().is_some_and(|(args, _)| args.get("id").is_some()) {
            continue;
        }
        for request in PROTECTED_REQUESTS {
            let temp = seeded();
            let (mut args, _) = workspace_cases(&name, &temp).unwrap().swap_remove(0);
            args["id"] = json!(request);
            let answer = pinned(&temp, || call(&WORKSPACE_SERVER, &name, args));
            opened(&name, request, &answer);
        }
    }
    for request in PROTECTED_REQUESTS {
        let temp = seeded();
        let answer = super::librarian::with_bound(bound_target(&temp), || call(&super::librarian::SERVER, "librarian_read", json!({"id": request})));
        opened("librarian_read", request, &answer);
    }
    let temp = seeded();
    let links: String = PROTECTED_REQUESTS.iter().map(|rel| format!("[x]({}) ", rel.trim_matches('"'))).collect();
    put(temp.path(), "wiki/Projects/links.md", &format!("---\nid: 01SURFLINKS0000000000000000\n---\n# Links\n\n{links}\n"));
    let attachments = pinned(&temp, || call(&WORKSPACE_SERVER, "rotli_note_attachments", json!({"id": "01SURFLINKS0000000000000000", "includeText": true})));
    opened("rotli_note_attachments", "links", &attachments);
    // a link may resolve, from the note's folder, to a public file of the
    // same name (wiki/Projects/wiki/Link/f.csv); never to the protected one
    let answer: Value = serde_json::from_str(&attachments).unwrap();
    let listed: Value = serde_json::from_str(answer["result"]["content"][0]["text"].as_str().unwrap_or("{}")).unwrap_or_default();
    for item in listed["attachments"].as_array().into_iter().flatten().filter(|item| item["available"] == json!(true)) {
        if PROTECTED_REQUESTS.iter().any(|rel| item["path"] == json!(rel.trim_matches('"'))) {
            found.push(format!("rotli_note_attachments: a protected link is available: {item}"));
        }
    }
    assert!(found.is_empty(), "a protected item opened:\n{}", found.join("\n\n"));
}
