//! The headless CLI on a folder it turns into notes (host-seams.md, "The
//! command line makes no unmarked vault"). Each call runs in its own process, as `rotli` does, with
//! `ROTLI_CORPUS_ROOT` and `HOME` set on it: this test binary re-run on
//! `cli_child`. The same tests run in the standalone build and under
//! `ROTLI_APP_IDENTIFIER=com.example.host`.

use super::*;
use crate::app_identity::{claimed_by, owns_shared_state, support_dir, APP_IDENTIFIER};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

const CALL: &str = "ROTLI_TEST_CLI_CALL";
const ANSWER: &str = "ROTLI_TEST_CLI_ANSWER=";

/// The child's half; a no-op in an ordinary test run. `["mcp-tool", name,
/// arguments]` is one MCP tool call; anything else is an argv.
#[test]
fn cli_child() {
    let Ok(call) = std::env::var(CALL) else { return };
    let argv: Vec<String> = serde_json::from_str(&call).unwrap();
    let result = match argv.first().map(String::as_str) {
        Some("mcp-tool") => call_mcp_tool(&argv[1], &serde_json::from_str(&argv[2]).unwrap()),
        _ => run_cli(&argv),
    };
    let answer = match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "error": error }),
    };
    println!("\n{ANSWER}{answer}");
}

struct World {
    _temp: TempDir,
    home: PathBuf,
    base: PathBuf,
}

impl World {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let home = base.join("home");
        fs::create_dir_all(&home).unwrap();
        Self { _temp: temp, home, base }
    }

    fn folder(&self, name: &str) -> PathBuf {
        let path = self.base.join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// One `rotli` process: `pin` is its `ROTLI_CORPUS_ROOT`, if any.
    fn call(&self, pin: Option<&Path>, argv: &[&str]) -> Result<Value, String> {
        let name = format!("{}::cli_child", module_path!().split_once("::").unwrap().1);
        let mut child = std::process::Command::new(std::env::current_exe().unwrap());
        child
            .args([name.as_str(), "--exact", "--nocapture", "--test-threads=1"])
            .env(CALL, serde_json::to_string(argv).unwrap())
            .env("HOME", &self.home)
            .env_remove("ROTLI_CORPUS_CONFIG")
            .env_remove("ROTLI_CORPUS_ROOT");
        if let Some(pin) = pin {
            child.env("ROTLI_CORPUS_ROOT", pin);
        }
        let output = child.output().unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let answer = stdout
            .lines()
            .find_map(|line| line.strip_prefix(ANSWER))
            .unwrap_or_else(|| panic!("no answer: {stdout}{}", String::from_utf8_lossy(&output.stderr)));
        let answer: Value = serde_json::from_str(answer).unwrap();
        match answer.get("error").and_then(Value::as_str) {
            Some(error) => Err(error.to_string()),
            None => Ok(answer["ok"].clone()),
        }
    }

    fn write(&self, pin: Option<&Path>, title: &str) -> Result<Value, String> {
        self.call(pin, &["notes", "create", "--title", title, "--body", "Synthetic body."])
    }
}

/// Every entry below `root`, so "nothing was written" can be checked.
fn tree(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap().flatten() {
            if entry.file_type().unwrap().is_dir() {
                stack.push(entry.path());
            }
            found.push(entry.path().strip_prefix(root).unwrap().to_path_buf());
        }
    }
    found.sort();
    found
}

/// The reported bug: the first write turned an empty folder into a vault with
/// no mark, and every later call refused it.
#[test]
fn an_empty_pinned_folder_takes_a_second_write() {
    for finder_noise in [false, true] {
        let world = World::new();
        let vault = world.folder("notes");
        if finder_noise {
            fs::write(vault.join(".DS_Store"), "").unwrap();
        }
        world.write(Some(&vault), "First").unwrap();
        world.write(Some(&vault), "Second").unwrap();
        world.call(Some(&vault), &["notes", "list"]).unwrap();
        assert_eq!(claimed_by(&vault, APP_IDENTIFIER), !owns_shared_state());
        assert_eq!(vault.join(".rotli/bound-by").exists(), !owns_shared_state());
    }
}

/// A read opens the folder for writing too, so it marks before it scaffolds,
/// and so does an MCP tool call.
#[test]
fn a_first_read_or_mcp_call_leaves_the_folder_usable() {
    let world = World::new();
    let listed = world.folder("listed");
    world.call(Some(&listed), &["notes", "list"]).unwrap();
    world.write(Some(&listed), "After a read").unwrap();

    let tooled = world.folder("tooled");
    for title in ["One", "Two"] {
        let arguments = json!({ "title": title, "body": "Synthetic body." }).to_string();
        world.call(Some(&tooled), &["mcp-tool", "rotli_create_note", &arguments]).unwrap();
    }
    for vault in [listed, tooled] {
        assert_eq!(claimed_by(&vault, APP_IDENTIFIER), !owns_shared_state());
    }
}

/// The commands that promise to write nothing leave an empty folder empty.
#[test]
fn diagnostics_neither_scaffold_nor_mark() {
    let world = World::new();
    let vault = world.folder("untouched");
    world.call(Some(&vault), &["roots"]).unwrap();
    let doctor = world.call(Some(&vault), &["agent", "doctor"]);
    assert_eq!(doctor.is_ok(), crate::feature_policy::agents_enabled(), "{doctor:?}");
    world.call(Some(&vault), &["agent", "config"]).ok();
    assert!(tree(&vault).is_empty(), "{:?}", tree(&vault));
}

/// A vault this build didn't make is refused as before, and untouched.
#[test]
fn an_existing_unmarked_vault_is_refused_as_before() {
    let world = World::new();
    let vault = world.folder("theirs");
    fs::create_dir_all(vault.join(".rotli")).unwrap();
    fs::write(vault.join("note.md"), "# Theirs\n").unwrap();
    let before = tree(&vault);
    let written = world.write(Some(&vault), "Mine");
    if owns_shared_state() {
        written.unwrap();
    } else {
        assert_eq!(written, Err(crate::app_identity::existing_vault_refusal()));
        assert_eq!(tree(&vault), before);
    }
    assert!(!vault.join(".rotli/bound-by").exists());
}

/// No person confirms an environment variable, so a folder that already has
/// files is never adopted by a host's command line: the app's picker does that.
#[test]
fn a_folder_with_files_is_not_turned_into_notes_by_a_host() {
    let world = World::new();
    let project = world.folder("project");
    fs::write(project.join("code.txt"), "synthetic").unwrap();
    let before = tree(&project);
    let written = world.write(Some(&project), "Mine");
    if owns_shared_state() {
        written.unwrap();
        assert!(!project.join(".rotli/bound-by").exists());
    } else {
        assert_eq!(written, Err(crate::app_identity::NOT_EMPTY.to_string()));
        assert_eq!(tree(&project), before);
    }
}

/// The app's other refusals for a new folder hold on the command line too.
#[test]
fn a_host_marks_no_private_folder_and_none_under_a_linked_support_folder() {
    let world = World::new();
    let private = world.home.join(".ssh/notes");
    fs::create_dir_all(&private).unwrap();
    let in_support = support_dir(&world.home).join("notes");
    fs::create_dir_all(&in_support).unwrap();
    for folder in [&private, &in_support] {
        let written = world.write(Some(folder), "Mine");
        if owns_shared_state() {
            written.unwrap();
        } else {
            assert_eq!(written, Err(crate::private_roots::OVERLAPS.to_string()), "{folder:?}");
            assert!(tree(folder).is_empty());
        }
    }

    #[cfg(unix)]
    {
        let world = World::new();
        let support = support_dir(&world.home);
        fs::create_dir_all(support.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(world.folder("elsewhere"), &support).unwrap();
        let vault = world.folder("notes");
        let written = world.write(Some(&vault), "Mine");
        if owns_shared_state() {
            written.unwrap();
        } else {
            assert!(written.as_ref().is_err_and(|e| e.contains("is a link")), "{written:?}");
            assert!(tree(&vault).is_empty());
        }
    }
}

/// The registry fallback: a scratch vault emptied by hand is trusted for being
/// empty, so the command line must mark it before it writes there.
#[test]
fn an_emptied_scratch_vault_takes_a_second_write() {
    let world = World::new();
    let support = support_dir(&world.home);
    let scratch = support.join("Scratch vault");
    fs::create_dir_all(&scratch).unwrap();
    let registry = json!({ "version": 1, "corpus": { "absPath": scratch, "adopted": false }, "brains": [], "folders": [] });
    fs::write(support.join("corpus.json"), registry.to_string()).unwrap();
    world.write(None, "First").unwrap();
    world.write(None, "Second").unwrap();
    assert_eq!(claimed_by(&scratch, APP_IDENTIFIER), !owns_shared_state());
}
