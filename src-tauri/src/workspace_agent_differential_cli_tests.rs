//! The differential harness's second half (`workspace_agent_differential_tests.rs`):
//! every command `rotli help` names, and Rotli's own layout's `Secure notes`.

use super::*;

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
            let is_id = [OPEN, AGENT_NOTE, AGENT_FREE, BOARD].contains(&shape[swap[0].0].as_str());
            alike(&label, Some((&swap[0].1, is_id)), &unswapped, with, &mut found);
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

/// Rotli's own layout keeps its secure home at `Secure notes`: moving an
/// agent's note there named a secure namesake through its `(2)` alias, and a
/// folder made there said whether it was already there.
#[test]
fn the_secure_notes_folder_answers_alike_whether_it_holds_a_namesake_or_not() {
    let run = |protected: bool, call: &dyn Fn(&mut Workspace) -> Result<Value, String>| {
        let temp = TempDir::new().unwrap();
        put(temp.path(), "Inbox/statement.md", "---\nid: 01SURFSTATEMENT000000000000\ncreated_by: agent\n---\n# Statement\n\nplain words\n");
        if protected {
            put(temp.path(), "Secure notes/statement.md", "---\nid: 01SURFSECRETSTATEMENT000000\n---\n# Statement\n\nclassified\n");
            put(temp.path(), "Secure notes/Taxes/n.md", "# Taxes\n\nclassified\n");
        }
        let mut ws = super::tests::test_workspace(&temp);
        observe(&temp, || match call(&mut ws) {
            Ok(value) => (true, value.to_string()),
            Err(error) => (false, error),
        })
    };
    let mut found = Vec::new();
    for folder in ["Secure notes", "Secure notes/Taxes", "secure NOTES"] {
        let call = |ws: &mut Workspace| ws.move_note("01SURFSTATEMENT000000000000", folder).and_then(json_value);
        differ(&format!("move into {folder}"), run(true, &call), run(false, &call), &mut found);
        let call = |ws: &mut Workspace| ws.create_disk_folder("Taxes", Some(folder)).and_then(json_value);
        differ(&format!("folder Taxes in {folder}"), run(true, &call), run(false, &call), &mut found);
    }
    let call = |ws: &mut Workspace| ws.create_disk_folder("Secure notes", None).and_then(json_value);
    differ("folder Secure notes", run(true, &call), run(false, &call), &mut found);
    assert!(found.is_empty(), "{}", found.join("\n\n"));
}

/// An id with a `:` that names no root (a title such as `Plan: Q3`, a Main
/// folder id) is judged as itself: the admit gate once re-entered itself
/// for it without end.
#[test]
fn an_id_with_a_colon_that_names_no_root_answers_and_returns() {
    let temp = world(true);
    put(temp.path(), "wiki/Projects/q3.md", "---\nid: 01SURFQTHREE000000000000000\ncreated_by: agent\n---\n# Plan: Q3\n\nplain words\n");
    for id in ["x:y", "main:Outer", "Plan: Q3", "x:wiki/_secure/Bank plan.md"] {
        let answer = pinned(&temp, || call(&WORKSPACE_SERVER, "rotli_read_note", json!({"id": id})));
        assert!(answer.contains("note not found"), "{id}: {answer}");
    }
    let renamed = pinned(&temp, || call(&WORKSPACE_SERVER, "rotli_rename", json!({"id": "Plan: Q3", "title": "Plan: Q4"})));
    assert!(succeeded(&renamed) && renamed.contains("Plan: Q4"), "{renamed}");
}
