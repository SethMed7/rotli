//! A short status probe of an installed CLI (`--version`, `auth status`):
//! stdin closed, and killed at a deadline. Settings → Connections ran these
//! with no deadline and stdin inherited, so a CLI that waited for input or
//! hung left the lane "checking…" forever and held a blocking thread (system
//! audit 2026-09-02 §2 #1).

use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Generous on purpose. A probe that times out reads as "not signed in", and
/// the lane stays hidden until the next check (a minute later), so a slow cold
/// start of several Node CLIs at once must not trip it. The bug this bounds
/// was "forever".
pub(crate) const PROBE_DEADLINE: Duration = Duration::from_secs(15);

/// How long an exited CLI's stdout may stay open: a background process it left
/// behind can hold the pipe indefinitely, and the deadline must still mean it.
const EXITED_READ_GRACE: Duration = Duration::from_millis(250);

/// Run `bin args`, capturing stdout. None when it can't start, or is still
/// running at `deadline`; it is then killed with everything it started, so a
/// wrapper script can't leave the real CLI behind (Settings re-checks about
/// once a minute). Stdout is drained on a thread, so a chatty CLI can't block
/// on a full pipe. A process the CLI left holding stdout costs only the output.
pub(crate) fn probe(bin: &Path, args: &[&str], deadline: Duration) -> Option<Output> {
    let mut command = Command::new(bin);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().ok()?;
    let mut pipe = child.stdout.take()?;
    let (sender, read) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let _ = sender.send(bytes);
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = read.recv_timeout(EXITED_READ_GRACE).unwrap_or_default();
                return Some(Output { status, stdout, stderr: Vec::new() });
            }
            Ok(None) if started.elapsed() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                kill_tree(&mut child);
                return None;
            }
        }
    }
}

fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    // SAFETY: killpg only sends a signal; the group is the one this child leads
    unsafe {
        libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
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

    fn alive(pid: i32) -> bool {
        // SAFETY: signal 0 only asks whether the process exists
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn a_cli_that_hangs_is_killed_at_the_deadline_with_what_it_started() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        // the shape of an npm shim: a wrapper waiting on the real process
        let hangs = script(dir.path(), "hangs", &format!("sleep 47 &\necho $! > '{}'\nwait", pidfile.display()));
        let started = Instant::now();
        // long enough for the script to write its pid on a loaded test machine
        assert!(probe(&hangs, &["auth", "status"], Duration::from_secs(2)).is_none());
        assert!(started.elapsed() < Duration::from_secs(6), "{:?}", started.elapsed());
        let descendant: i32 = crate::fsutil::read_own_text(&pidfile).unwrap().trim().parse().unwrap();
        let gone_by = Instant::now() + Duration::from_secs(3);
        while alive(descendant) && Instant::now() < gone_by {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(descendant), "the process the wrapper started outlived the probe");
    }

    #[test]
    fn stdin_is_the_null_device() {
        let dir = tempfile::tempdir().unwrap();
        // says what fd 0 really is, so it can't pass on a test runner whose
        // own stdin happens to be closed
        let asks = script(dir.path(), "asks", "[ /dev/fd/0 -ef /dev/null ] && echo null || echo other");
        let out = probe(&asks, &[], Duration::from_secs(3)).expect("finished");
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "null");
    }

    #[test]
    fn a_process_left_holding_stdout_cant_outlast_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        // exits at once, leaving a child with the pipe open
        let leaves = script(dir.path(), "leaves", "sleep 6 &\nexit 0");
        let started = Instant::now();
        let out = probe(&leaves, &[], Duration::from_secs(1)).expect("it exited");
        assert!(out.status.success(), "the exit status is the answer");
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
    }

    #[test]
    fn a_chatty_cli_doesnt_fill_the_pipe_and_time_out() {
        let dir = tempfile::tempdir().unwrap();
        let chatty = script(dir.path(), "chatty", "yes 0123456789 | sed 20000q");
        let out = probe(&chatty, &[], Duration::from_secs(3)).expect("finished");
        assert_eq!(out.stdout.len(), 20000 * 11);
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
