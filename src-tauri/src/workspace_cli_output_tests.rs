//! How the CLI ends when it can't write its answer (audit of 2026-11-24, nit:
//! `rotli notes list | head` panicked with a backtrace).

use super::*;
use std::io::{Error, ErrorKind, Write};

/// A reader that has gone away, or a disk that is full.
struct Failing(ErrorKind);

impl Write for Failing {
    fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
        Err(Error::from(self.0))
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Err(Error::from(self.0))
    }
}

#[test]
fn a_closed_pipe_ends_the_command_quietly() {
    assert_eq!(print_result(&mut Failing(ErrorKind::BrokenPipe), &json!({"notes": [1, 2, 3]})), 0);
}

#[test]
fn any_other_write_failure_is_still_an_error() {
    assert_eq!(print_result(&mut Failing(ErrorKind::StorageFull), &json!({"notes": []})), 1);
}

#[test]
fn an_answer_is_one_pretty_json_document_and_null_prints_nothing() {
    let mut out = Vec::new();
    assert_eq!(print_result(&mut out, &json!({"ok": true})), 0);
    assert_eq!(String::from_utf8(out).unwrap(), "{\n  \"ok\": true\n}\n");
    let mut out = Vec::new();
    assert_eq!(print_result(&mut out, &Value::Null), 0);
    assert!(out.is_empty());
}

#[test]
fn agent_config_names_the_registered_vault_in_its_deny_rules() {
    let temp = tempfile::TempDir::new().unwrap();
    let setup = super::agent_surface_tests::pinned(&temp, || agent_config().unwrap());
    let path = temp.path().display().to_string();
    assert_eq!(setup["vaultAccess"]["registered"], true);
    assert_eq!(setup["vaultAccess"]["vaults"][0]["path"], path.as_str());
    assert_eq!(setup["vaultAccess"]["claudeCode"]["anySession"]["settings"]["permissions"]["deny"][0], format!("Read(/{path}/**)"));
}

#[test]
fn agent_doctor_keeps_every_other_vaults_path_out_of_its_setup() {
    let temp = tempfile::TempDir::new().unwrap();
    std::fs::write(temp.path().join("memex.json"), "{\"id\":\"mx_doctor\"}\n").unwrap();
    let doctor = super::agent_surface_tests::pinned(&temp, || agent_doctor(None).unwrap());
    assert!(doctor["configuration"].get("vaultAccess").is_none());
    assert!(doctor["configuration"]["claudeDesktop"].is_object());
}

/// The instruction Settings > Connections hands to Claude Code, run as
/// written against a synthetic vault: the folder is made, the body (no
/// frontmatter) is filed through the CLI, and it lands in that Main folder.
#[test]
fn the_docs_extension_instruction_files_a_note_into_a_main_folder() {
    let temp = tempfile::TempDir::new().unwrap();
    std::fs::write(temp.path().join("memex.json"), "{\"id\":\"mx_docs_extension\",\"contract\":\"3.4\",\"apps\":{}}\n").unwrap();
    let body = temp.path().join("draft.txt");
    std::fs::write(&body, "# Plan\n\nplain words\n").unwrap();
    let words = |list: &[&str]| list.iter().map(|word| word.to_string()).collect::<Vec<_>>();
    let main = super::agent_surface_tests::pinned(&temp, || {
        run_cli(&words(&["folders", "create", "--name", "Project"])).unwrap();
        run_cli(&words(&["notes", "create", "--title", "Plan", "--body-file", body.to_str().unwrap(), "--main", "main:Project"])).unwrap();
        run_cli(&words(&["main", "list"])).unwrap()
    });
    // the note sits under the Project folder in Main, filed by the CLI
    assert_eq!(main["tree"][0]["folder"], "Project", "{main}");
    assert_eq!(main["tree"][0]["children"].as_array().map(Vec::len), Some(1), "{main}");
}
