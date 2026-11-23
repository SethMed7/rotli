//! The guard for "an agent never learns whether a protected path exists"
//! (the existence-oracle follow-up to pull request 304). A differential
//! harness over the vault `agent_surface_tests` seeds: every tool the
//! workspace MCP server and the Librarian route list, and every command
//! `rotli help` names, runs twice, once in that vault and once in the same
//! vault with every protected item removed. It runs with its ordinary
//! arguments, and again with a protected id or folder, in every spelling, in
//! place of each id- or path-taking argument. The two runs must give the
//! same status, the same words, the same shape, and change the same files,
//! once fresh ids, timestamps, fresh revisions, and the vault's own path are
//! normalised. Query values a public note hides are checked in pairs, one
//! that names the hidden value and one that names nothing. A tool or command
//! the harness doesn't know fails it.

use super::agent_surface_tests::*;
use super::*;
use std::collections::{BTreeMap, BTreeSet};
use tempfile::TempDir;

/// What the seeded vault holds that an agent may never learn of. Removing
/// them gives the vault where each is missing. The symlink `wiki/Link` stays,
/// dangling: it is a name the vault still holds.
const PROTECTED_ITEMS: [&str; 5] = ["wiki/_secure", "wiki/Projects/jUNIPER", "wiki/STRASSE", "trash/wiki", "archive/wiki"];

/// Protected items as an agent may name them: by path, by id, through the
/// symlink, quoted, root-prefixed, through a hard link, and (on APFS) in
/// another case or as `ſ`. Each beside an ordinary id of the same shape that
/// names nothing: a protected item must answer as that one does.
fn protected_ids() -> Vec<(&'static str, &'static str)> {
    let mut ids = vec![
        ("wiki/_secure/Bank plan.md", "wiki/Projects/Nothing/none.md"),
        ("01SURFBANK00000000000000000", "01SURFNONE00000000000000000"),
        ("wiki/_secure/PrivateProject/l1.md", "wiki/Projects/Nothing/l1.md"),
        ("wiki/_secure/free.md", "wiki/Projects/Nothing/free.md"),
        ("wiki/Projects/jUNIPER/Ordinary/n.md", "wiki/Projects/Nothing/Ordinary/n.md"),
        ("01SURFKEYWORD00000000000000", "01SURFNONE20000000000000000"),
        ("wiki/STRASSE/n.md", "wiki/Nothing/n.md"),
        ("wiki/_secure/b.excalidraw", "wiki/Projects/none.excalidraw"),
        ("wiki/_secure/f.csv", "wiki/Projects/none.csv"),
        ("wiki/Link/Bank plan.md", "wiki/Nothing/Bank plan.md"),
        ("trash/wiki/_secure/trashed plan.md", "trash/wiki/Nothing/trashed plan.md"),
        (HARD_LINK, "wiki/Projects/none.md"),
        ("\"wiki/_secure/Bank plan.md\"", "\"wiki/Projects/Nothing/none.md\""),
        ("default:wiki/_secure/Bank plan.md", "default:wiki/Projects/Nothing/none.md"),
    ];
    if cfg!(target_os = "macos") {
        ids.extend([("wiki/_\u{17f}ecure/Bank plan.md", "wiki/Projects/Nothing/none.md"), ("wiki/_SECURE/Bank plan.md", "wiki/Projects/Nothing/none.md")]);
    }
    ids
}

/// The protected ids alone.
fn ids() -> Vec<&'static str> {
    protected_ids().into_iter().map(|(id, _)| id).collect()
}

/// The ordinary id that names nothing, for a protected one (None for a
/// value that isn't an id).
fn ordinary(value: &str) -> Option<&'static str> {
    protected_ids().into_iter().find(|(id, _)| *id == value).map(|(_, missing)| missing)
}

/// Every spelling `value` may take in an answer: as written, escaped once or
/// twice as a JSON string, and quoted as Rust debug output.
fn spellings(value: &str) -> Vec<String> {
    let escape = |text: &str| serde_json::to_string(text).unwrap().trim_matches('"').to_string();
    let debug = format!("{value:?}");
    let mut out = vec![escape(&escape(&debug)), escape(&debug), debug, escape(&escape(value)), escape(value), value.to_string()];
    out.sort_by_key(|text| std::cmp::Reverse(text.len()));
    out.dedup();
    out
}

fn unechoed(mut outcome: Outcome, value: &str) -> Outcome {
    for spelling in spellings(value) {
        outcome.answer = outcome.answer.replace(&spelling, "<id>");
    }
    outcome
}

/// Protected folders as an agent may name them as a target or a parent.
fn protected_folders() -> Vec<&'static str> {
    let mut folders = vec![
        "wiki/_secure",
        "wiki/_secure/PrivateProject",
        "wiki/Projects/jUNIPER",
        "wiki/Projects/jUNIPER/Ordinary",
        "wiki/STRASSE",
        "wiki/Link",
        "trash/wiki/_secure",
    ];
    if cfg!(target_os = "macos") {
        folders.extend(["wiki/_SECURE/PrivateProject", "wiki/_\u{17f}ecure"]);
    }
    folders
}

/// Titles only protected notes carry (a link target is named by title).
const PROTECTED_TITLES: [&str; 2] = ["Hidden note two", "Diary"];

/// Differences an agent can still see, each a residual row 16k of the threat
/// model names: (the run's label, why).
const RESIDUAL: [(&str, &str); 1] = [(
    "rotli_move_note case 1",
    "a locked note the agent can't see that links to the moved note still refuses the move",
)];

fn world(protected: bool) -> TempDir {
    let temp = seeded();
    if !protected {
        for rel in PROTECTED_ITEMS {
            fs::remove_dir_all(temp.path().join(rel)).unwrap();
        }
        // a hard link of a secure note is that note, and the journal's rows
        // of a removed note go with it
        fs::remove_file(temp.path().join(HARD_LINK)).unwrap();
        let journal = temp.path().join(".rotli/ai-edit-journal.jsonl");
        let kept: String = fs::read_to_string(&journal).unwrap().lines().filter(|row| !row.contains("01SURFBANK")).map(|row| format!("{row}\n")).collect();
        fs::write(&journal, kept).unwrap();
    }
    temp
}

/// A public-looking path that is a hard link of a secure note.
const HARD_LINK: &str = "wiki/Projects/hard.md";

/// Every entry under `root`, without following links: a file by its bytes'
/// hash, a directory or a link by its kind. The search index and the walk's
/// caches are rebuildable projections, not effects.
fn snapshot(root: &Path) -> BTreeMap<String, String> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let rel = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if [".rotli/search", ".rotli/index.json", ".rotli/cache"].iter().any(|skip| rel.starts_with(skip)) {
                continue;
            }
            let Ok(meta) = fs::symlink_metadata(&path) else { continue };
            if meta.file_type().is_symlink() {
                out.insert(rel, "link".into());
            } else if meta.is_dir() {
                out.insert(rel.clone(), "dir".into());
                walk(root, &path, out);
            } else {
                out.insert(rel, crate::fsutil::revision(&fs::read(&path).unwrap_or_default()));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn changes(before: &BTreeMap<String, String>, after: &BTreeMap<String, String>) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for (rel, hash) in after {
        match before.get(rel) {
            None => out.insert(format!("+{rel}")),
            Some(old) if old != hash => out.insert(format!("~{rel}")),
            _ => false,
        };
    }
    out.extend(before.keys().filter(|rel| !after.contains_key(*rel)).map(|rel| format!("-{rel}")));
    out
}

/// One run as an agent sees it, and what it changed on disk.
#[derive(PartialEq)]
struct Outcome {
    ok: bool,
    answer: String,
    changed: BTreeSet<String>,
}

impl std::fmt::Debug for Outcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ok={} changed={:?} answer={}", self.ok, self.changed, self.answer.chars().take(400).collect::<String>())
    }
}

/// The answer with what differs from run to run made plain: the vault's own
/// path, fresh ids, timestamps, and revisions of bytes written by this run
/// (a revision of any file already in the vault stays as it is).
fn normal(answer: &str, root: &Path, known: &BTreeSet<String>) -> String {
    let mut text = answer.to_string();
    for path in [fs::canonicalize(root).unwrap_or_default(), root.to_path_buf()] {
        let shown = path.to_string_lossy().to_string();
        if !shown.is_empty() {
            text = text.replace(&shown, "<vault>");
        }
    }
    let patterns = [
        (r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?", "<time>"),
        (r"\b\d{10,}\b", "<number>"),
        (r"\b[0-9A-HJKMNP-TV-Z]{26}\b", "<ulid>"),
    ];
    for (pattern, with) in patterns {
        text = regex::Regex::new(pattern).unwrap().replace_all(&text, with).into_owned();
    }
    regex::Regex::new(r"fnv1a64:[0-9a-f]+")
        .unwrap()
        .replace_all(&text, |found: &regex::Captures| {
            if known.contains(&found[0]) {
                found[0].to_string()
            } else {
                "<revision>".to_string()
            }
        })
        .into_owned()
}

/// Run one call against `temp`, recording its answer and its effects.
fn observe(temp: &TempDir, run: impl FnOnce() -> (bool, String)) -> Outcome {
    let before = snapshot(temp.path());
    let known: BTreeSet<String> = before.values().cloned().collect();
    let (ok, answer) = run();
    let after = snapshot(temp.path());
    Outcome { ok, answer: normal(&answer, temp.path(), &known), changed: changes(&before, &after) }
}

/// Where two answers part, with the text around it.
fn parting(a: &str, b: &str) -> String {
    let at = a.char_indices().zip(b.chars()).find(|((_, x), y)| x != y).map_or(a.len().min(b.len()), |((i, _), _)| i);
    let around = |text: &str| {
        let start = text.floor_char_boundary(at.saturating_sub(120));
        let end = text.ceil_char_boundary((at + 200).min(text.len()));
        text[start..end].to_string()
    };
    format!("present: …{}…\n    missing: …{}…", around(a), around(b))
}

fn differ(label: &str, present: Outcome, missing: Outcome, found: &mut Vec<String>) {
    if present == missing || RESIDUAL.iter().any(|(residual, _)| *residual == label) {
        return;
    }
    let mut report = format!("{label}:\n    present: {present:?}\n    missing: {missing:?}");
    if present.answer != missing.answer {
        report.push_str(&format!("\n    {}", parting(&present.answer, &missing.answer)));
    }
    found.push(report);
}

/// A protected id must answer as an ordinary id that names nothing does,
/// once each answer's echo of its own id is set aside; and a swap that
/// answers exactly as the unswapped call did never reached its argument.
fn alike(label: &str, swap_value: Option<&str>, base: &Outcome, present: impl Fn(&str) -> Outcome, found: &mut Vec<String>) {
    let Some(value) = swap_value else { return };
    let swapped = present(value);
    if &swapped == base {
        found.push(format!("{label}: answers exactly as the unswapped call, so the swap was never read: {swapped:?}"));
    }
    if let Some(missing) = ordinary(value) {
        differ(&format!("{label} beside {missing}"), unechoed(swapped, value), unechoed(present(missing), missing), found);
    }
}

/// One argument swapped for a protected value: (JSON pointer, value).
type Swap = Vec<(String, Value)>;

/// The swaps for one call's arguments: each id- or path-taking argument in
/// turn takes each protected value of its kind.
fn swaps(name: &str, args: &Value) -> Vec<Swap> {
    let mut out = Vec::new();
    let mut each = |pointer: &str, values: &[&str]| {
        if args.pointer(pointer).is_some() {
            out.extend(values.iter().map(|value| vec![(pointer.to_string(), json!(value))]));
        }
    };
    each("/id", &ids());
    each("/entries/0/id", &ids());
    each("/ids/0", &ids());
    each("/folder", &protected_folders());
    each("/target", &PROTECTED_TITLES);
    // a protected note's name in text the agent writes
    each("/entries/0/summary", &PROTECTED_TITLES);
    each("/entry", &PROTECTED_TITLES);
    each("/title", &PROTECTED_TITLES);
    if name == "rotli_create_board" {
        each("/name", &PROTECTED_TITLES);
    }
    if args.get("scope") == Some(&json!("disk")) {
        each("/parent", &protected_folders());
        // a protected name under a public parent
        out.push(vec![("/name".into(), json!("jUNIPER"))]);
        out.push(vec![("/name".into(), json!("_secure")), ("/parent".into(), json!("wiki"))]);
    }
    if name == "rotli_query" {
        out.extend(["_secure", "wiki/_secure", "jUNIPER"].map(|text| vec![("/query".to_string(), json!(format!("path:~{text}")))]));
    }
    out
}

fn swapped(mut args: Value, swap: &Swap) -> Value {
    for (pointer, value) in swap {
        *args.pointer_mut(pointer).unwrap() = value.clone();
    }
    args
}

fn label(base: &str, swap: &Swap) -> String {
    swap.iter().fold(base.to_string(), |label, (pointer, value)| format!("{label} {pointer}={value}"))
}

/// Calls beyond the ordinary ones: limits small enough that hidden matches
/// ranked first would crowd out the visible ones, and a link read from its
/// note's folder through the symlink.
fn extra_cases(name: &str) -> Vec<Value> {
    match name {
        "rotli_note_attachments" => vec![json!({"id": TOP, "includeText": true})],
        "rotli_search" | "librarian_search" => vec![json!({"query": "ledger", "limit": 1}), json!({"query": "ledger", "limit": 3})],
        "rotli_list" => vec![json!({"limit": 1}), json!({"limit": 3})],
        "rotli_query" => vec![json!({"query": "ledger", "limit": 1})],
        _ => Vec::new(),
    }
}

/// Query clauses on a value only a public note's hidden metadata holds,
/// beside the same clause on a value nothing holds: (field and operator,
/// hidden value, absent value).
const QUERY_PAIRS: [(&str, &str, &str); 6] = [
    ("shelf:", "wiki/_secure/DirectExample", "wiki/_secure/NoSuchPlace"),
    ("shelf:~", "DirectExample", "NoSuchPlace"),
    ("shelf:!=", "wiki/_secure/DirectExample", "wiki/_secure/NoSuchPlace"),
    ("shelf:", "wiki/Projects/jUNIPER/Ordinary", "wiki/Projects/jUNIPER/Nothing"),
    ("text:~", "DirectExample", "NoSuchPlace"),
    ("", "DirectExample", "NoSuchPlace"),
];

fn workspace_run(name: &str, protected: bool, args: impl FnOnce(&TempDir) -> Value) -> Outcome {
    let temp = world(protected);
    let args = args(&temp);
    observe(&temp, || {
        let answer = pinned(&temp, || call(&WORKSPACE_SERVER, name, args));
        (succeeded(&answer), answer)
    })
}

fn librarian_run(name: &str, protected: bool, args: &Value) -> Outcome {
    let temp = world(protected);
    super::librarian::with_bound(bound_target(&temp), || {
        observe(&temp, || {
            let answer = call(&super::librarian::SERVER, name, args.clone());
            (succeeded(&answer), answer)
        })
    })
}

/// `rotli_open`, through the payload builder it shares with the app's
/// mailbox (the tool itself launches the app).
fn open_differential(found: &mut Vec<String>) {
    let run = |protected: bool, id: &str| {
        let temp = world(protected);
        observe(&temp, || {
            let mut ws = super::tests::test_workspace(&temp);
            match ws.queue_open_request(id, "note", &[]) {
                Ok(value) => (true, value.to_string()),
                Err(error) => (false, error),
            }
        })
    };
    let base = run(true, OPEN);
    for id in std::iter::once(OPEN).chain(ids()) {
        let label = format!("rotli_open id={id}");
        differ(&label, run(true, id), run(false, id), found);
        if id != OPEN {
            alike(&label, Some(id), &base, |value| run(true, value), found);
        }
    }
}

/// The document tools, through the bridge's own gate (the app's side): a
/// protected document and a missing one are refused alike.
fn document_differential(found: &mut Vec<String>) {
    let mut files = vec!["wiki/_secure/p.docx", "wiki/Projects/jUNIPER/p.docx", "wiki/Link/p.docx", "default:wiki/_secure/p.docx"];
    if cfg!(target_os = "macos") {
        files.extend(["wiki/_SECURE/p.docx", "wiki/_\u{17f}ecure/p.docx"]);
    }
    let run = |protected: bool, file: &str, editing: bool| {
        let temp = world(protected);
        observe(&temp, || {
            let mut store = crate::corpus::CorpusStore::open(temp.path().to_path_buf()).unwrap();
            match crate::agent_bridge::document_request_gate_for_test(&mut store, file, editing) {
                Ok(()) => (true, String::new()),
                Err(error) => (false, error),
            }
        })
    };
    for file in files {
        for editing in [false, true] {
            let label = format!("document gate file={file} editing={editing}");
            differ(&label, run(true, file, editing), run(false, file, editing), found);
            let missing = "wiki/Projects/none.docx";
            differ(&format!("{label} beside {missing}"), unechoed(run(true, file, editing), file), unechoed(run(true, missing, editing), missing), found);
        }
    }
    // the app opens `file` as written: a prefix naming another root would be
    // judged here as a path of this vault and read there from that root
    for file in ["other:wiki/Projects/plan.docx", "x:y:wiki/Projects/plan.docx", "default:x:wiki/Projects/plan.docx"] {
        if run(true, file, false).ok {
            found.push(format!("document gate: {file} names another root and was allowed"));
        }
    }
    if !run(true, PUBLIC_DOCX, false).ok || !run(true, &format!("default:{PUBLIC_DOCX}"), false).ok {
        found.push("document gate: the public document was refused".into());
    }
}

#[test]
fn no_agent_tool_tells_a_protected_item_from_a_missing_one() {
    let mut found = Vec::new();
    let mut unknown = Vec::new();
    for name in listed(&WORKSPACE_SERVER) {
        let Some(cases) = workspace_cases(&name, &seeded()) else {
            unknown.push(name);
            continue;
        };
        for (case, (shape, _)) in cases.iter().enumerate() {
            let args = |temp: &TempDir| workspace_cases(&name, temp).unwrap().swap_remove(case).0;
            let base = format!("{name} case {case}");
            let unswapped = workspace_run(&name, true, args);
            differ(&base, workspace_run(&name, true, args), workspace_run(&name, false, args), &mut found);
            for swap in swaps(&name, shape) {
                let args = |temp: &TempDir| swapped(args(temp), &swap);
                differ(&label(&base, &swap), workspace_run(&name, true, args), workspace_run(&name, false, args), &mut found);
                let with = |value: &str| {
                    let mut one = swap.clone();
                    one[0].1 = json!(value);
                    workspace_run(&name, true, |temp| swapped(workspace_cases(&name, temp).unwrap().swap_remove(case).0, &one))
                };
                alike(&label(&base, &swap), swap[0].1.as_str(), &unswapped, with, &mut found);
            }
        }
        for args in extra_cases(&name) {
            let base = format!("{name} {args}");
            differ(&base, workspace_run(&name, true, |_| args.clone()), workspace_run(&name, false, |_| args.clone()), &mut found);
        }
    }
    for (prefix, hidden, absent) in QUERY_PAIRS {
        let run = |value: &str| {
            let mut outcome = workspace_run("rotli_query", true, |_| json!({"query": format!("{prefix}{value}")}));
            outcome.answer = outcome.answer.replace(value, "<value>");
            outcome
        };
        differ(&format!("rotli_query {prefix}{hidden}"), run(hidden), run(absent), &mut found);
    }
    open_differential(&mut found);
    document_differential(&mut found);
    let known: Vec<&str> = librarian_cases().iter().map(|(name, _, _)| *name).collect();
    for name in listed(&super::librarian::SERVER) {
        if name != "librarian_guide" && !known.contains(&name.as_str()) {
            unknown.push(name);
        }
    }
    // in order, in one bound vault each, so the index and the review have
    // something to show
    let (present, missing) = (world(true), world(false));
    let steps = |temp: &TempDir| {
        super::librarian::with_bound(bound_target(temp), || {
            librarian_cases()
                .into_iter()
                .map(|(name, args, _)| {
                    observe(temp, || {
                        let answer = call(&super::librarian::SERVER, name, args);
                        (succeeded(&answer), answer)
                    })
                })
                .collect::<Vec<_>>()
        })
    };
    for ((name, _, _), (a, b)) in librarian_cases().into_iter().zip(steps(&present).into_iter().zip(steps(&missing))) {
        differ(&format!("{name} in order"), a, b, &mut found);
    }
    for (name, args, _) in librarian_cases() {
        let unswapped = librarian_run(name, true, &args);
        for swap in swaps(name, &args) {
            let one = swapped(args.clone(), &swap);
            differ(&label(name, &swap), librarian_run(name, true, &one), librarian_run(name, false, &one), &mut found);
            let with = |value: &str| {
                let mut swap = swap.clone();
                swap[0].1 = json!(value);
                librarian_run(name, true, &swapped(args.clone(), &swap))
            };
            alike(&label(name, &swap), swap[0].1.as_str(), &unswapped, with, &mut found);
        }
        for args in extra_cases(name) {
            differ(&format!("{name} {args}"), librarian_run(name, true, &args), librarian_run(name, false, &args), &mut found);
        }
    }
    assert!(unknown.is_empty(), "tools the differential doesn't call yet: {unknown:?}");
    assert!(found.is_empty(), "{} agent calls tell a protected item from a missing one:\n\n{}", found.len(), found.join("\n\n"));
}

/// One argv swap: (position, protected value).
type ArgvSwap = Vec<(usize, String)>;

fn argv_swaps(command: &str, argv: &[String]) -> Vec<ArgvSwap> {
    let mut out = Vec::new();
    for (at, word) in argv.iter().enumerate() {
        if [OPEN, AGENT_NOTE, AGENT_FREE, BOARD].contains(&word.as_str()) {
            out.extend(ids().into_iter().map(|id| vec![(at, id.to_string())]));
        }
        let flag = at.checked_sub(1).map(|before| argv[before].as_str());
        if (command == "rename" && at == 2) || (command == "notes create" && flag == Some("--title")) {
            out.extend(PROTECTED_TITLES.map(|title| vec![(at, title.to_string())]));
        }
        if matches!(flag, Some("--folder")) || (command == "folders create" && flag == Some("--parent")) {
            out.extend(protected_folders().into_iter().map(|folder| vec![(at, folder.to_string())]));
        }
        if command == "folders create" && flag == Some("--name") {
            out.push(vec![(at, "jUNIPER".into())]);
        }
    }
    if command == "notes query" {
        out.extend(["_secure", "wiki/_secure", "jUNIPER"].map(|text| vec![(2, format!("path:~{text}"))]));
    }
    out
}

fn cli_run(protected: bool, argv: impl FnOnce(&TempDir) -> Vec<String>) -> Outcome {
    let temp = world(protected);
    super::librarian::switch_on_for_test(temp.path());
    let argv = argv(&temp);
    observe(&temp, || {
        pinned(&temp, || match run_cli(&argv) {
            Ok(value) => (true, value.to_string()),
            Err(error) => (false, error),
        })
    })
}

#[test]
fn no_cli_command_tells_a_protected_item_from_a_missing_one() {
    let mut found = Vec::new();
    let mut unknown = Vec::new();
    for command in cli_commands() {
        let shape = match cli_case(&command, &seeded()) {
            None => {
                unknown.push(command);
                continue;
            }
            Some(None) => continue,
            Some(Some((argv, _))) => argv,
        };
        let argv = |temp: &TempDir| cli_case(&command, temp).unwrap().unwrap().0;
        let unswapped = cli_run(true, argv);
        differ(&command, cli_run(true, argv), cli_run(false, argv), &mut found);
        for swap in argv_swaps(&command, &shape) {
            fn with_swap<'a>(argv: impl Fn(&TempDir) -> Vec<String> + 'a, swap: &'a ArgvSwap) -> impl FnOnce(&TempDir) -> Vec<String> + 'a {
                move |temp: &TempDir| {
                    let mut argv = argv(temp);
                    for (at, value) in swap {
                        argv[*at] = value.clone();
                    }
                    argv
                }
            }
            let label = swap.iter().fold(command.clone(), |label, (at, value)| format!("{label} [{at}]={value}"));
            differ(&label, cli_run(true, with_swap(argv, &swap)), cli_run(false, with_swap(argv, &swap)), &mut found);
            let with = |value: &str| cli_run(true, with_swap(argv, &vec![(swap[0].0, value.to_string())]));
            alike(&label, Some(&swap[0].1), &unswapped, with, &mut found);
        }
    }
    for argv in ["notes search ledger --limit 1", "notes list --limit 1", "notes query ledger --limit 1"] {
        let words = || argv.split(' ').map(String::from).collect::<Vec<_>>();
        differ(argv, cli_run(true, |_| words()), cli_run(false, |_| words()), &mut found);
    }
    for (prefix, hidden, absent) in QUERY_PAIRS {
        let run = |value: &str| {
            let mut outcome = cli_run(true, |_| vec!["notes".into(), "query".into(), format!("{prefix}{value}")]);
            outcome.answer = outcome.answer.replace(value, "<value>");
            outcome
        };
        differ(&format!("notes query {prefix}{hidden}"), run(hidden), run(absent), &mut found);
    }
    assert!(unknown.is_empty(), "commands the differential doesn't run yet: {unknown:?}");
    assert!(found.is_empty(), "{} commands tell a protected item from a missing one:\n\n{}", found.len(), found.join("\n\n"));
}
