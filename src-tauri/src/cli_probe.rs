//! A short status probe of an installed CLI (`--version`, `auth status`):
//! stdin closed, and killed at a deadline. Settings → Connections ran these
//! with no deadline and stdin inherited, so a CLI that waited for input or
//! hung left the lane "checking…" forever and held a blocking thread (system
//! audit 2026-09-02 §2 #1).

use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// Long enough for a cold CLI start, short enough that Settings answers.
pub(crate) const PROBE_DEADLINE: Duration = Duration::from_secs(5);

/// Run `bin args`, capturing stdout. None when it can't start, or is still
/// running at `deadline` (it is then killed and reaped).
pub(crate) fn probe(bin: &Path, args: &[&str], deadline: Duration) -> Option<Output> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if started.elapsed() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn a_cli_that_hangs_is_killed_at_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let hangs = script(dir.path(), "hangs", "sleep 30");
        let started = Instant::now();
        assert!(probe(&hangs, &["auth", "status"], Duration::from_millis(300)).is_none());
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    }

    #[test]
    fn a_cli_waiting_on_stdin_sees_it_closed_instead_of_hanging() {
        let dir = tempfile::tempdir().unwrap();
        // `read` returns at once on a closed stdin; on an inherited one it waits
        let asks = script(dir.path(), "asks", "read answer; echo got:$answer");
        let out = probe(&asks, &[], Duration::from_secs(3)).expect("finished");
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "got:");
    }

    #[test]
    fn a_quick_cli_answers_with_its_output_and_status() {
        let dir = tempfile::tempdir().unwrap();
        let ok = script(dir.path(), "ok", "echo 'tool 1.2.3'");
        let out = probe(&ok, &["--version"], PROBE_DEADLINE).expect("finished");
        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "tool 1.2.3");
        let fails = script(dir.path(), "fails", "exit 1");
        assert!(!probe(&fails, &[], PROBE_DEADLINE).unwrap().status.success());
        assert!(probe(Path::new("/nonexistent/cli"), &[], PROBE_DEADLINE).is_none());
    }
}
